//! Broker-owned dialog poll scheduler skeleton (add-ext-dialog §5.2, batch A).
//!
//! The scheduling contract is frozen: the owner loop holds ONE merged
//! `DialogPollDue(generation)` user event and sleeps through
//! `ControlFlow::WaitUntil(min deadline)`; native callbacks may only move an
//! atomic deadline (never a broker pointer, never an unbounded self-wake,
//! never a winit call), and when a deadline moves EARLIER the broker-side
//! re-arm watcher re-delivers `DialogPollDue` so the loop recomputes its
//! sleep — the "slept past an already-earlier deadline" starvation path is
//! unrepresentable. Same-generation due events coalesce into one poll, and
//! each owner-loop iteration performs at most
//! [`DIALOG_POLL_MAX_OWNERS_PER_ITERATION`] owner steps (one modal step per
//! owner) so menu/transport frames are never starved.
//!
//! Batch A ships the generic skeleton (merge, WaitUntil inputs, re-arm
//! signaling, quota, generation-token staleness); the dialog extension's
//! `poll_owner` producer wiring is batch B.

use std::collections::HashMap;
use std::time::Instant;

/// Frozen quota (§5.2): at most four owners step once per owner-loop
/// iteration.
pub(crate) const DIALOG_POLL_MAX_OWNERS_PER_ITERATION: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PollDeadline {
    pub(crate) deadline: Instant,
    /// Diagnostic reason for the deadline (which producer armed it).
    pub(crate) wake_reason: String,
}

#[derive(Debug, Default)]
pub(crate) struct PollScheduler {
    /// Generation token carried by `DialogPollDue` events; stale tokens
    /// (from before a revoke-all) drop without any poll.
    generation: u64,
    /// One next-deadline entry per scheduled owner; producers re-arm by
    /// scheduling again.
    deadlines: HashMap<String, PollDeadline>,
}

impl PollScheduler {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    /// Schedules (or re-arms) one owner's next deadline. Returns `true` when
    /// the entry strictly lowered the merged MINIMUM deadline — the signal
    /// that a fresh `DialogPollDue` must be re-delivered, because the loop
    /// may already be sleeping to a later instant. Raising one owner's
    /// deadline or adding a later owner never fires the signal.
    ///
    /// Batch A note: no producer calls this yet (the dialog extension's
    /// native poll path lands in batch B); the owner-loop wiring consumes
    /// `min_deadline`/`take_due`/`revoke_all` today.
    #[allow(dead_code)]
    pub(crate) fn schedule(
        &mut self,
        owner: impl Into<String>,
        deadline: Instant,
        wake_reason: impl Into<String>,
    ) -> bool {
        let owner = owner.into();
        let entry = PollDeadline {
            deadline,
            wake_reason: wake_reason.into(),
        };
        let lowered_minimum = match self.min_deadline() {
            None => true,
            Some(current_min) => entry.deadline < current_min,
        };
        self.deadlines.insert(owner, entry);
        lowered_minimum
    }

    /// Cancels one owner's scheduled poll (the §5.2 revoke order: remove
    /// from the schedule first; a stale due event then drops on its
    /// generation/absence check). Batch A: producers arrive in batch B.
    #[allow(dead_code)]
    pub(crate) fn cancel(&mut self, owner: &str) -> bool {
        self.deadlines.remove(owner).is_some()
    }

    /// The merged minimum deadline: the `ControlFlow::WaitUntil` input.
    /// `None` means plain `Wait`.
    pub(crate) fn min_deadline(&self) -> Option<Instant> {
        self.deadlines.values().map(|entry| entry.deadline).min()
    }

    /// Removes and returns the due owners, oldest deadline first, bounded by
    /// the frozen per-iteration quota. Entries that re-arm simply schedule
    /// again through their producer path.
    pub(crate) fn take_due(&mut self, now: Instant) -> Vec<(String, String)> {
        let mut due: Vec<(String, PollDeadline)> = self
            .deadlines
            .iter()
            .filter(|(_, entry)| entry.deadline <= now)
            .map(|(owner, entry)| (owner.clone(), entry.clone()))
            .collect();
        due.sort_by_key(|(_, entry)| entry.deadline);
        due.truncate(DIALOG_POLL_MAX_OWNERS_PER_ITERATION);
        due.into_iter()
            .map(|(owner, entry)| {
                self.deadlines.remove(&owner);
                (owner, entry.wake_reason)
            })
            .collect()
    }

    /// Drops every scheduled poll and bumps the generation token so stale
    /// `DialogPollDue` events delivered after the revoke drop without any
    /// poll (§5.2 revoke order; exit/revoke races must not step modal
    /// sessions).
    pub(crate) fn revoke_all(&mut self) -> u64 {
        self.deadlines.clear();
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn soon(offset_ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(offset_ms)
    }

    #[test]
    fn scheduling_merges_to_the_minimum_deadline() {
        let mut scheduler = PollScheduler::new();
        assert_eq!(scheduler.min_deadline(), None, "no deadlines means Wait");

        assert!(scheduler.schedule("owner-a", soon(100), "modal-step"));
        assert!(!scheduler.schedule("owner-b", soon(200), "modal-step"));

        // `soon` recomputes `now` per call, so assert the merge property:
        // the min is the earlier owner's deadline, not the later one's.
        let min = scheduler.min_deadline().expect("min deadline");
        let earlier = soon(101);
        let later = soon(199);
        assert!(
            min < later,
            "the merged minimum tracks the earliest armed deadline"
        );
        assert!(min <= earlier);
    }

    #[test]
    fn earlier_re_arms_signal_a_fresh_due_event() {
        let mut scheduler = PollScheduler::new();
        assert!(scheduler.schedule("owner-a", soon(500), "armed"));
        // A later re-arm never lowers the merged minimum: no new due event.
        assert!(!scheduler.schedule("owner-a", soon(600), "later"));
        assert!(!scheduler.schedule("owner-b", soon(700), "later owner"));
        // An earlier re-arm lowers the minimum and must re-deliver
        // DialogPollDue (the loop may already sleep to the later instant).
        assert!(scheduler.schedule("owner-a", soon(100), "earlier"));
        assert!(scheduler.min_deadline().unwrap() <= soon(101));
    }

    #[test]
    fn take_due_respects_the_frozen_owner_quota() {
        let mut scheduler = PollScheduler::new();
        let past = Instant::now() - Duration::from_millis(1);
        for index in 0..(DIALOG_POLL_MAX_OWNERS_PER_ITERATION + 3) {
            scheduler.schedule(format!("owner-{index}"), past, format!("reason-{index}"));
        }

        let due = scheduler.take_due(Instant::now());
        assert_eq!(
            due.len(),
            DIALOG_POLL_MAX_OWNERS_PER_ITERATION,
            "one iteration steps at most four owners"
        );
        // The taken owners left the schedule; the rest stay scheduled.
        assert_eq!(
            scheduler.deadlines.len(),
            3,
            "untaken owners remain scheduled for the next iteration"
        );
        // The next iteration takes the rest (only three remain).
        assert_eq!(scheduler.take_due(Instant::now()).len(), 3);
    }

    #[test]
    fn take_due_returns_only_due_owners_once_each() {
        let mut scheduler = PollScheduler::new();
        let past = Instant::now() - Duration::from_millis(1);
        scheduler.schedule("due-owner", past, "due");
        scheduler.schedule("future-owner", soon(10_000), "future");

        let due = scheduler.take_due(Instant::now());
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0, "due-owner");
        assert_eq!(due[0].1, "due");
        assert_eq!(scheduler.deadlines.len(), 1, "future owner stays");
    }

    #[test]
    fn revoke_all_bumps_the_generation_and_clears_the_schedule() {
        let mut scheduler = PollScheduler::new();
        scheduler.schedule("owner-a", soon(10), "armed");
        let old_generation = scheduler.generation();

        let new_generation = scheduler.revoke_all();

        assert_ne!(old_generation, new_generation);
        assert_eq!(scheduler.min_deadline(), None);
        // A stale due event (old generation token) finds nothing scheduled.
        assert!(scheduler
            .take_due(Instant::now() + Duration::from_secs(10))
            .is_empty());
    }

    #[test]
    fn cancel_removes_exactly_one_owner() {
        let mut scheduler = PollScheduler::new();
        scheduler.schedule("owner-a", soon(10), "a");
        scheduler.schedule("owner-b", soon(10), "b");
        assert!(scheduler.cancel("owner-a"));
        assert!(!scheduler.cancel("owner-a"));
        assert_eq!(scheduler.deadlines.len(), 1);
        assert!(scheduler.deadlines.contains_key("owner-b"));
    }
}
