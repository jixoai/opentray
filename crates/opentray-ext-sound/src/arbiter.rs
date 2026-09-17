//! Process-wide PlaybackArbiter (design section 1.4, R2 P0-4 law).
//!
//! Orthogonal intents (maintained 2026-09-17; original user request:
//! session close must stop exactly the playback its session owns on the
//! win32 single-channel sound device):
//! 1. ONE mutex critical section linearizes, as an indivisible unit:
//!    native `PlaySound` call -> return-value handling -> submit or clear
//!    the `(sessionId, instanceGeneration, sequence)` token.
//! 2. The token covers ALL `PlaySound` paths (`SND_ALIAS` and
//!    `SND_FILENAME`), never `MessageBeep`.
//! 3. Session close, under the SAME lock, compares the FULL token: a
//!    match is the only path to `PlaySound(NULL, SND_PURGE)` + clear; a
//!    mismatch never purges.
//! 4. New playback atomically replaces the old token and cancels the
//!    prior playback per win32 single-channel semantics; the internal
//!    state records "accepted but prior owner superseded" and never
//!    pretends the superseded playback is still alive.
//!
//! Compromise: metadata-only `Atomic*::swap` bookkeeping is outlawed —
//! the "A swap -> B swap+play -> A play" interleave would point the token
//! at B while A is actually playing, so B's close purge would stop A.
//! Because that guarantee is pure ordering logic, the core is
//! platform-neutral behind the [`SoundChannel`] seam: the win32 production
//! channel (static winmm imports) plugs in on Windows, and the
//! deterministic race family runs on any host with recording spies.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, TryLockError};

/// The ownership token of one accepted native playback (design section
/// 1.4). Full equality — all three fields — is the only purge authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlaybackToken {
    pub session_id: String,
    pub instance_generation: u64,
    pub sequence: u64,
}

/// Which native `PlaySound` path a request takes. The flag family of each
/// path is frozen (design section 1.2: alias playback always
/// `SND_ALIAS | SND_ASYNC | SND_NODEFAULT`; file playback
/// `SND_FILENAME | SND_ASYNC`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlayMode {
    Alias,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlayRequest {
    pub mode: PlayMode,
    pub sound: String,
}

/// The native single-channel seam: production is the static winmm import
/// pair; deterministic tests inject recording spies with gates.
pub(crate) trait SoundChannel: Send + Sync {
    /// One native `PlaySound` call; returns the native BOOL acceptance.
    fn play(&self, request: &PlayRequest) -> bool;
    /// `PlaySound(NULL, SND_PURGE)`: stops the current playback.
    fn purge(&self);
}

/// Outcome of one indivisible play critical section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlayOutcome {
    /// The native call was accepted and the token committed. `superseded`
    /// names the prior live owner that win32 single-channel semantics
    /// canceled ("accepted but prior owner superseded").
    Accepted {
        token: PlaybackToken,
        superseded: Option<PlaybackToken>,
    },
    /// The native call returned false. NO token changed hands: the prior
    /// accepted playback (if any) stays the live owner. The attempted
    /// sequence number is consumed (uniqueness is all the token needs).
    NativeRejected { attempted: PlaybackToken },
}

/// Outcome of one session-close critical section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CloseOutcome {
    /// Full-token match: the channel was purged and the token cleared.
    Purged(PlaybackToken),
    /// Mismatch: no purge. `expected` is the closing session's last
    /// accepted token; `current` is the live owner, if any.
    NoPurge {
        expected: PlaybackToken,
        current: Option<PlaybackToken>,
    },
    /// The session never had an accepted playback: nothing to compare,
    /// nothing to purge.
    NoPlayback,
}

/// Per-(instance, session) ledger: the last ACCEPTED token (the only one
/// of that session that can still be live on the single channel) and the
/// monotonic sequence counter.
#[derive(Debug, Default)]
struct SessionLedger {
    sequence: u64,
    last: Option<PlaybackToken>,
}

#[derive(Debug, Default)]
struct ArbiterInner {
    current: Option<PlaybackToken>,
    /// Instance key of the current token's submitter.
    current_owner: Option<u64>,
    /// Count of accepted plays that superseded a prior live owner
    /// (diagnostic state; never an ownership authority).
    superseded_owners: u64,
    /// instance key -> session id -> ledger.
    ledgers: HashMap<u64, HashMap<String, SessionLedger>>,
}

/// The process-wide arbiter. Every method is one indivisible critical
/// section; nothing mutates playback metadata outside the lock.
pub(crate) struct PlaybackArbiter {
    channel: Arc<dyn SoundChannel>,
    inner: Mutex<ArbiterInner>,
}

impl PlaybackArbiter {
    pub(crate) fn new(channel: Arc<dyn SoundChannel>) -> Self {
        Self {
            channel,
            inner: Mutex::new(ArbiterInner::default()),
        }
    }

    /// One indivisible critical section (the law): native call, return
    /// handling, token submit.
    pub(crate) fn play(
        &self,
        instance_key: u64,
        session_id: &str,
        instance_generation: u64,
        request: &PlayRequest,
    ) -> PlayOutcome {
        let mut inner = self.lock();
        // Ledger phase: assign the sequence and run the NATIVE CALL while
        // the lock is held. The native call happens INSIDE the critical
        // section: the token can never be observed pointing at a playback
        // that has not happened, and a native call can never race a
        // metadata commit.
        let (token, accepted) = {
            let ledger = inner
                .ledgers
                .entry(instance_key)
                .or_default()
                .entry(session_id.to_string())
                .or_default();
            ledger.sequence += 1;
            let token = PlaybackToken {
                session_id: session_id.to_string(),
                instance_generation,
                sequence: ledger.sequence,
            };
            let accepted = self.channel.play(request);
            (token, accepted)
        };
        if accepted {
            let superseded = inner.current.take();
            if superseded.is_some() {
                inner.superseded_owners += 1;
            }
            inner.current_owner = Some(instance_key);
            inner.current = Some(token.clone());
            if let Some(ledger) = inner
                .ledgers
                .get_mut(&instance_key)
                .and_then(|sessions| sessions.get_mut(session_id))
            {
                ledger.last = Some(token.clone());
            }
            PlayOutcome::Accepted { token, superseded }
        } else {
            PlayOutcome::NativeRejected { attempted: token }
        }
    }

    /// Session close under the same lock: FULL-token comparison is the
    /// only purge authority. A mismatch must not purge (the live owner is
    /// another playback); a never-accepted session has nothing to purge.
    pub(crate) fn close_session(&self, instance_key: u64, session_id: &str) -> CloseOutcome {
        let mut inner = self.lock();
        let expected = {
            let Some(sessions) = inner.ledgers.get_mut(&instance_key) else {
                return CloseOutcome::NoPlayback;
            };
            let Some(ledger) = sessions.get_mut(session_id) else {
                return CloseOutcome::NoPlayback;
            };
            match ledger.last.clone() {
                Some(expected) => expected,
                None => {
                    sessions.remove(session_id);
                    return CloseOutcome::NoPlayback;
                }
            }
        };
        if inner.current == Some(expected.clone()) {
            self.channel.purge();
            inner.current = None;
            inner.current_owner = None;
            if let Some(sessions) = inner.ledgers.get_mut(&instance_key) {
                sessions.remove(session_id);
            }
            CloseOutcome::Purged(expected)
        } else {
            CloseOutcome::NoPurge {
                expected,
                current: inner.current.clone(),
            }
        }
    }

    /// Instance teardown (deinit): releases the instance ledger; if the
    /// current playback belongs to this instance it is purged first (the
    /// darwin mirror: dropping the instance state stops its sounds).
    /// Returns the purged token when a purge happened.
    pub(crate) fn unregister_instance(&self, instance_key: u64) -> Option<PlaybackToken> {
        let mut inner = self.lock();
        let purged = match (&inner.current_owner, &inner.current) {
            (Some(owner), Some(token)) if *owner == instance_key => {
                self.channel.purge();
                let token = token.clone();
                inner.current = None;
                inner.current_owner = None;
                Some(token)
            }
            _ => None,
        };
        inner.ledgers.remove(&instance_key);
        purged
    }

    /// The live owner token under the same lock (diagnostic accessor).
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn current_token(&self) -> Option<PlaybackToken> {
        self.lock().current.clone()
    }

    /// Non-blocking variant for the interleave proof: `Err(())` means the
    /// lock is momentarily held — a critical section is in flight, so NO
    /// metadata can be observed at all.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn try_current_token(&self) -> Result<Option<PlaybackToken>, ()> {
        match self.inner.try_lock() {
            Ok(inner) => Ok(inner.current.clone()),
            Err(TryLockError::WouldBlock) => Err(()),
            Err(TryLockError::Poisoned(_)) => Ok(self.lock().current.clone()),
        }
    }

    /// How many accepted plays superseded a prior live owner (diagnostic
    /// accessor).
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn superseded_owner_count(&self) -> u64 {
        self.lock().superseded_owners
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ArbiterInner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc;

    /// One recorded native call, byte-exact for assertions.
    #[derive(Debug, Clone, PartialEq, Eq)]
    enum SpyCall {
        Play(PlayRequest),
        Purge,
    }

    /// A deterministic gate: the spied native call announces itself and
    /// then blocks (inside the critical section) until the test releases
    /// it, making two-thread interleavings fully deterministic.
    struct Gate {
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }

    struct SpyChannel {
        calls: Mutex<Vec<SpyCall>>,
        /// Queued native results for upcoming play calls (default accept).
        results: Mutex<VecDeque<bool>>,
        /// Queued gates: the next play call consumes one.
        gates: Mutex<VecDeque<Gate>>,
    }

    impl SpyChannel {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                results: Mutex::new(VecDeque::new()),
                gates: Mutex::new(VecDeque::new()),
            })
        }

        fn calls(&self) -> Vec<SpyCall> {
            self.calls.lock().unwrap().clone()
        }

        /// Queues the native result of the next play call.
        fn queue_result(self: &Arc<Self>, result: bool) {
            self.results.lock().unwrap().push_back(result);
        }

        /// Queues a gate for the next play call; returns the watcher that
        /// observes the call entering the native boundary and the releaser
        /// that unblocks it.
        fn queue_gate(self: &Arc<Self>) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            self.gates.lock().unwrap().push_back(Gate {
                entered: entered_tx,
                release: release_rx,
            });
            (entered_rx, release_tx)
        }
    }

    impl SoundChannel for SpyChannel {
        fn play(&self, request: &PlayRequest) -> bool {
            let gate = self.gates.lock().unwrap().pop_front();
            if let Some(gate) = gate {
                gate.entered
                    .send(())
                    .expect("test watches every queued gate");
                gate.release
                    .recv()
                    .expect("test releases every queued gate");
            }
            let result = self.results.lock().unwrap().pop_front().unwrap_or(true);
            self.calls.lock().unwrap().push(SpyCall::Play(request.clone()));
            result
        }

        fn purge(&self) {
            self.calls.lock().unwrap().push(SpyCall::Purge);
        }
    }

    fn alias(name: &str) -> PlayRequest {
        PlayRequest {
            mode: PlayMode::Alias,
            sound: name.to_string(),
        }
    }

    fn file(path: &str) -> PlayRequest {
        PlayRequest {
            mode: PlayMode::File,
            sound: path.to_string(),
        }
    }

    fn token(session: &str, generation: u64, sequence: u64) -> PlaybackToken {
        PlaybackToken {
            session_id: session.to_string(),
            instance_generation: generation,
            sequence,
        }
    }

    /// Race family 1 — the swap/play interleave (design section 1.4):
    /// thread A's native call is paused inside the critical section, so
    /// B cannot commit ANY token before A's native call completes. The
    /// outlawed Atomic-swap metadata would let B's token land mid-flight;
    /// the law makes that observation impossible, and the final token
    /// equals the LAST native call in the exact spy order.
    #[test]
    fn two_thread_interleave_commits_tokens_in_native_call_order() {
        let spy = SpyChannel::new();
        let (entered_a, release_a) = spy.queue_gate();
        let arbiter = PlaybackArbiter::new(spy.clone());

        let request_a = alias("SystemAsterisk");
        let request_b = file("C:/sounds/late.wav");
        let (outcome_a, outcome_b) = std::thread::scope(|scope| {
            let thread_a = scope.spawn(|| arbiter.play(1, "session-a", 10, &request_a));
            entered_a
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("thread A enters the native call");

            // A holds the lock inside its native call: no metadata is
            // observable (the lock itself is the serialization proof) and
            // no second thread can have committed anything.
            assert!(
                arbiter.try_current_token().is_err(),
                "the critical section spans the native call: metadata cannot \
                 commit while the native call is in flight"
            );

            let thread_b = scope.spawn(|| arbiter.play(2, "session-b", 20, &request_b));
            // B cannot enter while A holds the lock; release A and both
            // critical sections complete in order.
            release_a.send(()).expect("release thread A");
            (
                thread_a.join().expect("thread A completes"),
                thread_b.join().expect("thread B completes"),
            )
        });

        assert_eq!(
            outcome_a,
            PlayOutcome::Accepted {
                token: token("session-a", 10, 1),
                superseded: None,
            }
        );
        assert_eq!(
            outcome_b,
            PlayOutcome::Accepted {
                token: token("session-b", 20, 1),
                superseded: Some(token("session-a", 10, 1)),
            }
        );
        // Byte-exact native order: exactly two plays, A then B, and the
        // live token belongs to the LAST native call.
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemAsterisk")),
                SpyCall::Play(file("C:/sounds/late.wav")),
            ]
        );
        assert_eq!(arbiter.current_token(), Some(token("session-b", 20, 1)));
        assert_eq!(arbiter.superseded_owner_count(), 1);
    }

    /// Race family 2 — alias-vs-file token alternation (design section
    /// 1.4): a later file playback atomically replaces the alias token and
    /// cancels the prior owner; the superseded session's close sees a
    /// full-token MISMATCH and must not purge (a purge would stop the
    /// live file playback), while the live owner's close purges exactly
    /// once.
    #[test]
    fn alias_vs_file_alternation_replaces_tokens_and_gates_the_purge() {
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        let first = arbiter.play(1, "session-a", 3, &alias("SystemHand"));
        assert_eq!(
            first,
            PlayOutcome::Accepted {
                token: token("session-a", 3, 1),
                superseded: None,
            }
        );
        let second = arbiter.play(2, "session-b", 4, &file("C:/sounds/tone.wav"));
        assert_eq!(
            second,
            PlayOutcome::Accepted {
                token: token("session-b", 4, 1),
                superseded: Some(token("session-a", 3, 1)),
            }
        );
        // Single-channel semantics: two plays, no purge between them (the
        // new call itself cancels the old playback).
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemHand")),
                SpyCall::Play(file("C:/sounds/tone.wav")),
            ]
        );

        // The superseded alias owner closes: full-token mismatch, no
        // purge — stopping here would eat the live file playback.
        assert_eq!(
            arbiter.close_session(1, "session-a"),
            CloseOutcome::NoPurge {
                expected: token("session-a", 3, 1),
                current: Some(token("session-b", 4, 1)),
            }
        );
        assert_eq!(spy.calls().len(), 2, "mismatched close made no native call");

        // The live file owner closes: exactly one purge.
        assert_eq!(
            arbiter.close_session(2, "session-b"),
            CloseOutcome::Purged(token("session-b", 4, 1))
        );
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemHand")),
                SpyCall::Play(file("C:/sounds/tone.wav")),
                SpyCall::Purge,
            ]
        );
        assert_eq!(arbiter.current_token(), None);
    }

    /// Race family 3 — the native-false path (design section 1.2): an
    /// unplayable request returns native false, NO token changes hands,
    /// and the prior accepted playback stays the live owner: its session
    /// close still purges, while the rejected session has nothing
    /// purgeable.
    #[test]
    fn native_false_leaves_the_prior_owner_live() {
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        assert_eq!(
            arbiter.play(1, "session-a", 5, &alias("SystemExclamation")),
            PlayOutcome::Accepted {
                token: token("session-a", 5, 1),
                superseded: None,
            }
        );
        spy.queue_result(false);
        assert_eq!(
            arbiter.play(2, "session-b", 6, &alias("NoSuchAlias")),
            PlayOutcome::NativeRejected {
                attempted: token("session-b", 6, 1),
            }
        );
        // Both native calls happened (the rejected one is recorded), but
        // the token still names the accepted alias.
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemExclamation")),
                SpyCall::Play(alias("NoSuchAlias")),
            ]
        );
        assert_eq!(arbiter.current_token(), Some(token("session-a", 5, 1)));
        assert_eq!(arbiter.superseded_owner_count(), 0);

        // The rejected session never submitted a token: nothing to purge.
        assert_eq!(
            arbiter.close_session(2, "session-b"),
            CloseOutcome::NoPlayback
        );
        // A never-played session is the same honest answer.
        assert_eq!(
            arbiter.close_session(2, "session-never"),
            CloseOutcome::NoPlayback
        );
        // The accepted owner still purges.
        assert_eq!(
            arbiter.close_session(1, "session-a"),
            CloseOutcome::Purged(token("session-a", 5, 1))
        );
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemExclamation")),
                SpyCall::Play(alias("NoSuchAlias")),
                SpyCall::Purge,
            ]
        );
    }

    /// Race family 4 — close racing a fresh play (design section 1.4):
    /// gated deterministically, the fresh play commits while the stale
    /// close waits on the lock; the close then compares the FULL token,
    /// sees the new owner, and refuses to purge. The converse order (the
    /// close completing first) never eats the later playback either.
    #[test]
    fn close_race_never_purges_a_fresh_owners_playback() {
        // Order 1: session-a owns the channel; session-b's play pauses
        // inside its native call; session-a's close queues behind the
        // lock; the play commits; the close must see the mismatch.
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        assert_eq!(
            arbiter.play(1, "session-a", 7, &alias("SystemAsterisk")),
            PlayOutcome::Accepted {
                token: token("session-a", 7, 1),
                superseded: None,
            }
        );

        // The gate is queued only now so the UNGATED initial play above
        // cannot consume it (a queued gate blocks the next native call
        // while holding the arbiter lock — that is the determinism
        // mechanism).
        let (entered_b, release_b) = spy.queue_gate();
        let request_b = file("C:/sounds/fresh.wav");
        let (play_outcome, close_outcome) = std::thread::scope(|scope| {
            let thread_b = scope.spawn(|| arbiter.play(2, "session-b", 8, &request_b));
            entered_b
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("session-b's play entered the native call");

            let thread_close = scope.spawn(|| arbiter.close_session(1, "session-a"));
            // The close is queued on the lock (b holds it); release b so
            // the play commits first and the close observes the fresh
            // token.
            release_b.send(()).expect("release session-b's play");
            (
                thread_b.join().expect("session-b's play completes"),
                thread_close.join().expect("close completes"),
            )
        });
        assert_eq!(
            play_outcome,
            PlayOutcome::Accepted {
                token: token("session-b", 8, 1),
                superseded: Some(token("session-a", 7, 1)),
            }
        );
        assert_eq!(
            close_outcome,
            CloseOutcome::NoPurge {
                expected: token("session-a", 7, 1),
                current: Some(token("session-b", 8, 1)),
            }
        );
        // Byte-exact: two plays, ZERO purges — the fresh playback is
        // untouched by the stale close.
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemAsterisk")),
                SpyCall::Play(file("C:/sounds/fresh.wav")),
            ]
        );
        assert_eq!(arbiter.current_token(), Some(token("session-b", 8, 1)));

        // Order 2: the close completes first; the later play starts on a
        // clean channel and stays live.
        assert_eq!(
            arbiter.close_session(2, "session-b"),
            CloseOutcome::Purged(token("session-b", 8, 1))
        );
        assert_eq!(
            arbiter.play(3, "session-c", 9, &alias("SystemHand")),
            PlayOutcome::Accepted {
                token: token("session-c", 9, 1),
                superseded: None,
            }
        );
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemAsterisk")),
                SpyCall::Play(file("C:/sounds/fresh.wav")),
                SpyCall::Purge,
                SpyCall::Play(alias("SystemHand")),
            ]
        );
        assert_eq!(arbiter.current_token(), Some(token("session-c", 9, 1)));
    }

    /// A same-session reclaim keeps the purge authority with the session's
    /// LATEST accepted token: superseded self-tokens never match.
    #[test]
    fn same_session_replay_updates_the_purge_authority() {
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        assert_eq!(
            arbiter.play(1, "session-a", 2, &alias("SystemHand")),
            PlayOutcome::Accepted {
                token: token("session-a", 2, 1),
                superseded: None,
            }
        );
        assert_eq!(
            arbiter.play(1, "session-a", 2, &file("C:/sounds/second.wav")),
            PlayOutcome::Accepted {
                token: token("session-a", 2, 2),
                superseded: Some(token("session-a", 2, 1)),
            }
        );
        // The live purge authority is the session's second token, not the
        // superseded first.
        assert_eq!(
            arbiter.close_session(1, "session-a"),
            CloseOutcome::Purged(token("session-a", 2, 2))
        );
        assert_eq!(arbiter.current_token(), None);
    }

    /// Instance teardown (deinit) purges only its OWN current playback:
    /// another instance's live owner survives an unrelated unregister,
    /// and the owning instance's unregister purges and clears.
    #[test]
    fn unregister_purges_only_the_current_owner_instance() {
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        assert_eq!(
            arbiter.play(1, "session-a", 1, &alias("SystemAsterisk")),
            PlayOutcome::Accepted {
                token: token("session-a", 1, 1),
                superseded: None,
            }
        );
        // Second mount instance (generation 2) supersedes on the single
        // channel — distinct full token, distinct instance owner.
        assert_eq!(
            arbiter.play(2, "session-a", 2, &file("C:/sounds/other.wav")),
            PlayOutcome::Accepted {
                token: token("session-a", 2, 1),
                superseded: Some(token("session-a", 1, 1)),
            }
        );
        // Unregistering the superseded instance must not stop the live
        // owner.
        assert_eq!(arbiter.unregister_instance(1), None);
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemAsterisk")),
                SpyCall::Play(file("C:/sounds/other.wav")),
            ]
        );
        assert_eq!(arbiter.current_token(), Some(token("session-a", 2, 1)));
        // The live owner's unregister purges.
        assert_eq!(
            arbiter.unregister_instance(2),
            Some(token("session-a", 2, 1))
        );
        assert_eq!(arbiter.current_token(), None);
        assert_eq!(
            spy.calls(),
            vec![
                SpyCall::Play(alias("SystemAsterisk")),
                SpyCall::Play(file("C:/sounds/other.wav")),
                SpyCall::Purge,
            ]
        );
        // After unregister, the instance's sessions have no ledger.
        assert_eq!(
            arbiter.close_session(1, "session-a"),
            CloseOutcome::NoPlayback
        );
    }

    /// Sequences are unique per (instance, session) and monotonically
    /// increase across rejections; tokens differing in any field never
    /// compare equal (the full-token law).
    #[test]
    fn sequences_are_unique_and_full_token_equality_is_exact() {
        let spy = SpyChannel::new();
        let arbiter = PlaybackArbiter::new(spy.clone());

        spy.queue_result(true);
        let first = arbiter.play(1, "session-a", 4, &file("C:/a.wav"));
        spy.queue_result(false); // rejected attempt consumes a sequence
        arbiter.play(1, "session-a", 4, &file("C:/bad.wav"));
        let third = arbiter.play(1, "session-a", 4, &file("C:/c.wav"));

        let PlayOutcome::Accepted { token: first, .. } = first else {
            panic!("first play accepted");
        };
        let PlayOutcome::Accepted { token: third, .. } = third else {
            panic!("third play accepted");
        };
        assert_eq!(first.sequence, 1);
        assert_eq!(third.sequence, 3, "the rejected attempt consumed 2");
        assert_ne!(first, third);
        // Any single field differing breaks equality (generation, session,
        // sequence).
        assert_ne!(first, token("session-a", 5, 1));
        assert_ne!(first, token("session-b", 4, 1));
        assert_ne!(first, token("session-a", 4, 2));
        // Different instances keep independent ledgers.
        let other = arbiter.play(2, "session-a", 4, &file("C:/x.wav"));
        assert_eq!(
            other,
            PlayOutcome::Accepted {
                token: token("session-a", 4, 1),
                superseded: Some(third.clone()),
            }
        );
    }
}
