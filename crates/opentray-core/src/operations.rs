//! DeferredOperation registry (add-ext-dialog §5.1/§5.5, batch A).
//!
//! One broker-owned table of deferred extension commands. The kernel
//! pre-registers an operation BEFORE dispatching the command FFI (so a
//! terminal submitted by the extension during the call already resolves),
//! retires it when the disposition is Immediate or the dispatch fails, and
//! keeps it pending until the single terminal settles it. Handles are u64
//! nonces issued only through the seeded `ExtCommandDispositionV1`; their
//! wire form is the lowercase-hex `operationId` used by
//! `ext-command-accepted`/`ext-operation-terminal`.
//!
//! Settlement is a one-shot CAS performed by the owner loop: the first
//! terminal for a live operation wins; duplicates, foreign-owner submits,
//! and stale-generation submits are stateless drops surfaced as structured
//! outcomes so the composition layer can log diagnostics without framing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use opentray_spec::{AppId, CommandScope, SessionId};

/// Owner identity of one attached deferred port. Host facts only: an
/// extension can never supply or override any field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeferredPortOwner {
    pub app_id: AppId,
    pub instance: String,
    pub generation: u64,
    /// Bound at the LoadExt ACK; `None` while the port is only pending.
    pub session_id: Option<SessionId>,
}

/// The broker-issued identity of one command dispatch. `handle` crosses the
/// FFI (seeded into the disposition struct); `operation_id` is its wire
/// projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedOperation {
    pub operation_id: String,
    pub handle: u64,
}

impl IssuedOperation {
    /// The frozen wire projection of a handle: a 16-digit lowercase hex
    /// string (JSON-safe on the Node side).
    pub fn operation_id_for_handle(handle: u64) -> String {
        format!("{handle:016x}")
    }
}

/// Outcome of the owner-loop settlement CAS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationSettlement {
    /// First terminal for a live, matching operation: the caller writes the
    /// `ext-operation-terminal` frame for this operation.
    Settled {
        operation_id: String,
        scope: CommandScope,
    },
    /// A terminal already settled this operation: stateless drop with a
    /// diagnostic, no second frame.
    Duplicate { operation_id: String },
    /// The handle resolves to a live operation owned by a different port
    /// owner: drop with a diagnostic, no frame.
    ForeignOwner { operation_id: String },
    /// The operation belongs to an instance generation that is no longer
    /// current: drop with a diagnostic, no frame.
    StaleGeneration { operation_id: String },
    /// The handle was never issued, or its operation was retired/purged:
    /// forged-or-replayed handle rejection.
    UnknownHandle { handle: u64 },
}

/// Ingress validation result for one deferred-port submit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitValidation {
    /// The handle resolves to a live operation owned by this port. (It may
    /// already be settled — duplicate detection is the owner loop's CAS,
    /// not an ingress rejection.)
    Accepted,
    /// Never issued / retired / purged handle.
    UnknownHandle,
    /// A live handle owned by a different port owner.
    ForeignOwner,
}

struct OperationState {
    handle: u64,
    instance: String,
    scope: CommandScope,
    settled: bool,
}

#[derive(Default)]
struct OperationTable {
    operations: HashMap<String, OperationState>,
    /// Latest attached generation per `(app, instance)`; 0 when never attached.
    generations: HashMap<(AppId, String), u64>,
    next_generation: u64,
}

struct RegistryInner {
    nonce_base: u64,
    next_handle: AtomicU64,
    table: Mutex<OperationTable>,
}

/// Shared deferred-operation table. Cheap to clone through `Arc` handles;
/// every entry point is a bounded critical section safe to call from
/// extension ingress threads and the owner loop alike.
#[derive(Clone)]
pub struct DeferredOperationRegistry {
    inner: Arc<RegistryInner>,
}

impl std::fmt::Debug for DeferredOperationRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeferredOperationRegistry").finish_non_exhaustive()
    }
}

/// Unguessable per-process handle base. `RandomState` seeds a hasher from
/// OS entropy; finishing it before any write exposes only that seed.
fn random_nonce_base() -> u64 {
    use std::hash::{BuildHasher, Hasher, RandomState};
    RandomState::new().build_hasher().finish()
}

impl Default for DeferredOperationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl DeferredOperationRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RegistryInner {
                nonce_base: random_nonce_base(),
                next_handle: AtomicU64::new(1),
                table: Mutex::new(OperationTable::default()),
            }),
        }
    }

    /// Records a newly attached deferred-port owner and returns its
    /// generation. Each attach (each load/reload) is a fresh generation;
    /// operations and ports both compare against this number.
    pub fn note_instance_attached(&self, app_id: AppId, instance: String) -> u64 {
        let mut table = self.lock_table();
        table.next_generation += 1;
        let generation = table.next_generation;
        table.generations.insert((app_id, instance), generation);
        generation
    }

    /// The current attached generation for one instance (`0` when the
    /// instance has no deferred port, e.g. V1-only or test instances).
    pub fn current_generation(&self, app_id: &str, instance: &str) -> u64 {
        self.lock_table()
            .generations
            .get(&(app_id.to_string(), instance.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// Pre-registers the pending operation for one command dispatch and
    /// issues its handle. Must run BEFORE the command FFI so a terminal
    /// submitted during the call already resolves.
    pub fn register_pending(&self, scope: CommandScope, instance: String) -> IssuedOperation {
        let mut table = self.lock_table();
        // Handle 0 must never be issued: it is indistinguishable from the
        // all-zero Immediate disposition value.
        let mut handle = self
            .inner
            .nonce_base
            .wrapping_add(self.inner.next_handle.fetch_add(1, Ordering::Relaxed));
        while handle == 0 {
            handle = self
                .inner
                .nonce_base
                .wrapping_add(self.inner.next_handle.fetch_add(1, Ordering::Relaxed));
        }
        let operation_id = IssuedOperation::operation_id_for_handle(handle);
        table.operations.insert(
            operation_id.clone(),
            OperationState {
                handle,
                instance,
                scope,
                settled: false,
            },
        );
        IssuedOperation {
            operation_id,
            handle,
        }
    }

    /// Removes a pre-registered operation whose dispatch completed
    /// Immediately (or failed): the handle was never observed by the client
    /// and any later submit with it is a forged-or-replayed rejection.
    pub fn retire(&self, operation_id: &str) -> bool {
        self.lock_table().operations.remove(operation_id).is_some()
    }

    /// Ingress validation for one deferred-port submit. Duplicate terminals
    /// of live operations stay `Accepted` — exactly-once is enforced by the
    /// settlement CAS, not by ingress. Generation staleness is likewise a
    /// settlement classification: an unrevoked old-generation port submits
    /// successfully and its record is statelessly dropped by the owner loop.
    pub fn validate_submit(&self, handle: u64, owner: &DeferredPortOwner) -> SubmitValidation {
        let table = self.lock_table();
        let Some(state) = table
            .operations
            .values()
            .find(|state| state.handle == handle)
        else {
            return SubmitValidation::UnknownHandle;
        };
        if !owner_identity_matches(state, owner) {
            return SubmitValidation::ForeignOwner;
        }
        SubmitValidation::Accepted
    }

    /// Owner-loop one-shot settlement CAS. See [`OperationSettlement`].
    pub fn settle(&self, handle: u64, owner: &DeferredPortOwner) -> OperationSettlement {
        let mut table = self.lock_table();
        // Classification is read-only; the same guard then flips the
        // settled bit, so check-then-set is atomic for concurrent settlers.
        let Some(state) = table
            .operations
            .values()
            .find(|state| state.handle == handle)
        else {
            return OperationSettlement::UnknownHandle { handle };
        };
        let operation_id = IssuedOperation::operation_id_for_handle(handle);
        if !owner_identity_matches(state, owner) {
            return OperationSettlement::ForeignOwner { operation_id };
        }
        // Generation law: once the instance's current generation moved past
        // the operation's, no port — old or new — may settle it. This covers
        // both an unrevoked old port racing a reload and a new port being
        // fed an overheard old handle.
        let current_generation = table
            .generations
            .get(&(state.scope.app_id.clone(), state.instance.clone()))
            .copied()
            .unwrap_or(0);
        if state.scope.instance_generation != current_generation {
            return OperationSettlement::StaleGeneration { operation_id };
        }
        if state.settled {
            return OperationSettlement::Duplicate { operation_id };
        }
        let scope = state.scope.clone();
        let state = table
            .operations
            .get_mut(&operation_id)
            .expect("classification and CAS share one table lock");
        state.settled = true;
        OperationSettlement::Settled { operation_id, scope }
    }

    /// Drops every operation (pending and settled tombstones) belonging to a
    /// closing session. Their client promise died with the transport, and
    /// later submits for those handles are forged-or-replayed rejections.
    pub fn purge_session(&self, session_id: &str) -> usize {
        let mut table = self.lock_table();
        let before = table.operations.len();
        table
            .operations
            .retain(|_, state| state.scope.session_id != session_id);
        before - table.operations.len()
    }

    /// Live (registered, settled or not) operation count for one session —
    /// test/diagnostic accessor.
    pub fn session_operation_count(&self, session_id: &str) -> usize {
        self.lock_table()
            .operations
            .values()
            .filter(|state| state.scope.session_id == session_id)
            .count()
    }

    fn lock_table(&self) -> std::sync::MutexGuard<'_, OperationTable> {
        self.inner
            .table
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

/// Identity check between one port owner and the operation its handle
/// resolves to. Session, app, and instance must agree; a pending (pre-ACK)
/// port owns nothing.
fn owner_identity_matches(state: &OperationState, owner: &DeferredPortOwner) -> bool {
    let Some(owner_session) = owner.session_id.as_deref() else {
        return false;
    };
    state.scope.session_id == owner_session
        && state.scope.app_id == owner.app_id
        && state.instance == owner.instance
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(session: &str, generation: u64) -> CommandScope {
        CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
            instance_generation: generation,
        }
    }

    fn owner(generation: u64, session: Option<&str>) -> DeferredPortOwner {
        DeferredPortOwner {
            app_id: "app-1".to_string(),
            instance: "dialog".to_string(),
            generation,
            session_id: session.map(str::to_string),
        }
    }

    #[test]
    fn operation_ids_are_sixteen_digit_hex_of_their_handles() {
        assert_eq!(
            IssuedOperation::operation_id_for_handle(0x0000_0000_0000_000f),
            "000000000000000f"
        );
        assert_eq!(
            IssuedOperation::operation_id_for_handle(u64::MAX),
            "ffffffffffffffff"
        );
    }

    #[test]
    fn register_pending_issues_distinct_nonzero_handles() {
        let registry = DeferredOperationRegistry::new();
        let first = registry.register_pending(scope("session-1", 0), "dialog".to_string());
        let second = registry.register_pending(scope("session-1", 0), "dialog".to_string());

        assert_ne!(first.handle, second.handle);
        assert_ne!(first.handle, 0);
        assert_ne!(second.handle, 0);
        assert_eq!(first.operation_id.len(), 16);
    }

    #[test]
    fn settlement_is_a_one_shot_cas_for_the_matching_owner() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let issued = registry.register_pending(scope("session-1", generation), "dialog".to_string());
        let bound = owner(generation, Some("session-1"));

        assert_eq!(
            registry.settle(issued.handle, &bound),
            OperationSettlement::Settled {
                operation_id: issued.operation_id.clone(),
                scope: scope("session-1", generation),
            }
        );
        assert_eq!(
            registry.settle(issued.handle, &bound),
            OperationSettlement::Duplicate {
                operation_id: issued.operation_id.clone(),
            },
            "the second terminal is a stateless drop, never a second frame"
        );
    }

    #[test]
    fn forged_and_retired_handles_are_unknown() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let bound = owner(generation, Some("session-1"));

        // Never issued.
        assert_eq!(
            registry.settle(0xdead_beef, &bound),
            OperationSettlement::UnknownHandle { handle: 0xdead_beef }
        );

        // Retired after an Immediate outcome: replaying its handle is unknown.
        let issued = registry.register_pending(scope("session-1", generation), "dialog".to_string());
        assert!(registry.retire(&issued.operation_id));
        assert_eq!(
            registry.settle(issued.handle, &bound),
            OperationSettlement::UnknownHandle { handle: issued.handle }
        );
    }

    #[test]
    fn foreign_owners_and_pending_sessions_cannot_settle() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let issued = registry.register_pending(scope("session-1", generation), "dialog".to_string());

        // A different session submitting the same handle.
        let foreign_session = owner(generation, Some("session-2"));
        assert_eq!(
            registry.settle(issued.handle, &foreign_session),
            OperationSettlement::ForeignOwner {
                operation_id: issued.operation_id.clone(),
            }
        );

        // A pre-ACK (pending) owner cannot settle its own operation either:
        // the submit channel opens only at the LoadExt ACK.
        let pending = owner(generation, None);
        assert_eq!(
            registry.settle(issued.handle, &pending),
            OperationSettlement::ForeignOwner {
                operation_id: issued.operation_id.clone(),
            }
        );

        // The rightful owner still settles first.
        let bound = owner(generation, Some("session-1"));
        assert!(matches!(
            registry.settle(issued.handle, &bound),
            OperationSettlement::Settled { .. }
        ));
    }

    #[test]
    fn stale_generation_submits_drop_without_settling() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let issued = registry.register_pending(scope("session-1", generation), "dialog".to_string());

        // A reload attaches a fresh generation; the operation was issued
        // under the old one.
        let new_generation =
            registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let old_owner = owner(generation, Some("session-1"));
        let new_owner = owner(new_generation, Some("session-1"));

        assert_eq!(
            registry.settle(issued.handle, &old_owner),
            OperationSettlement::StaleGeneration {
                operation_id: issued.operation_id.clone(),
            },
            "the unrevoked old-generation port is a stale drop, not a foreign owner"
        );
        assert_eq!(
            registry.settle(issued.handle, &new_owner),
            OperationSettlement::StaleGeneration {
                operation_id: issued.operation_id.clone(),
            },
            "a new-generation port fed an old handle is stale too: once the \
             generation moved, no port may settle the operation"
        );
        // Ingress still accepts the stale submit (identity matches); the
        // drop is the settlement classification.
        assert_eq!(
            registry.validate_submit(issued.handle, &old_owner),
            SubmitValidation::Accepted
        );
    }

    #[test]
    fn purge_session_removes_pending_and_settled_operations() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let pending = registry.register_pending(scope("session-1", generation), "dialog".to_string());
        let settled = registry.register_pending(scope("session-1", generation), "dialog".to_string());
        let other = registry.register_pending(scope("session-2", generation), "dialog".to_string());
        let bound = owner(generation, Some("session-1"));
        assert!(matches!(
            registry.settle(settled.handle, &bound),
            OperationSettlement::Settled { .. }
        ));

        assert_eq!(registry.purge_session("session-1"), 2);
        assert_eq!(registry.session_operation_count("session-1"), 0);
        assert_eq!(registry.session_operation_count("session-2"), 1);
        assert_eq!(
            registry.settle(pending.handle, &bound),
            OperationSettlement::UnknownHandle { handle: pending.handle },
            "a submit after the session purge is a replayed handle"
        );
        drop(other);
    }

    #[test]
    fn ingress_validation_accepts_live_duplicates_but_rejects_foreign() {
        let registry = DeferredOperationRegistry::new();
        let generation = registry.note_instance_attached("app-1".to_string(), "dialog".to_string());
        let issued = registry.register_pending(scope("session-1", generation), "dialog".to_string());
        let bound = owner(generation, Some("session-1"));

        assert_eq!(
            registry.validate_submit(issued.handle, &bound),
            SubmitValidation::Accepted
        );
        assert!(matches!(
            registry.settle(issued.handle, &bound),
            OperationSettlement::Settled { .. }
        ));
        // A duplicate terminal stays ingress-accepted: exactly-once is the
        // settlement CAS's job.
        assert_eq!(
            registry.validate_submit(issued.handle, &bound),
            SubmitValidation::Accepted
        );
        assert_eq!(
            registry.validate_submit(issued.handle, &owner(generation, Some("session-9"))),
            SubmitValidation::ForeignOwner
        );
        assert_eq!(
            registry.validate_submit(0xfeed_face, &bound),
            SubmitValidation::UnknownHandle
        );
    }
}
