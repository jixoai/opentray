// DeferredPort hub (add-ext-dialog design section 5.1).
//
// Orthogonal intents (maintained 2026-09-17; original user requests:
// long-running extension commands must settle through one broker-owned
// deferred transaction whose only terminal channel is a by-value FFI port):
// 1. One linearizable lifecycle critical section per port: open, revoke,
//    and enqueue never interleave into an OPEN resurrection or a post-revoke
//    queue mutation.
// 2. Bounded, closed-before-copy ingress: PENDING/REVOKED ports reject
//    before any payload byte is read; oversized payloads reject before any
//    byte is copied.
// 3. Owner-loop drains are bounded and re-arm themselves while any queue
//    remains, so multi-port over-quota records can never strand.
// 4. A closing session is purged before any drain delivers frames, so close
//    itself never settles a terminal into the closing socket.
// Compromise: ports are process-lifetime and append-only in phase 1 (no
// unload/dlclose protocol), matching the EventPort law; revocation, not
// deallocation, is the only lifecycle exit.
//
// The single ext -> host ingress for deferred-operation terminals. The port
// handed to an extension through `opentray_ext_attach_deferred_completion_port_v1`
// is BY VALUE (EventPort pattern): `port_data` addresses process-lifetime
// `PortState` the hub never frees in phase 1, so a stale worker thread from a
// dropped or reloaded extension always reaches live memory and observes
// REVOKED (`EXT_ERR_PORT_CLOSED`) before any payload byte is read.
//
// Ingress contract (frozen):
// - PENDING (pre-ACK) or REVOKED ports reject with `EXT_ERR_PORT_CLOSED`;
// - payloads above `EXTENSION_EVENT_RECORD_MAX_BYTES` reject with
//   `EXT_ERR_OVERSIZED` before any byte is copied;
// - handles the core registry does not accept for this owner reject with
//   `EXT_ERR_INVALID_HANDLE` (fabricated, replayed, or foreign);
// - accepted records are bounded-copied, parsed as one frozen
//   `ExtOperationPayload`, enqueued, and wake the owner loop; settlement is
//   the owner loop's one-shot CAS -- this module never writes frames.

use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use opentray_core::operations::{DeferredOperationRegistry, DeferredPortOwner};
use opentray_spec::{
    AppId, ExtDeferredPortV1, ExtOperationPayload, ExtResultCode, SessionId,
    EXT_DEFERRED_PORT_ABI_V1, EXT_ERR_BACKPRESSURE, EXT_ERR_INVALID_HANDLE, EXT_ERR_OVERSIZED,
    EXT_ERR_PORT_CLOSED, EXT_ERR_REJECTED, EXT_OK, EXTENSION_EVENT_RECORD_MAX_BYTES,
};

use crate::event_hub::RuntimeWake;

const PHASE_PENDING: u8 = 0;
const PHASE_OPEN: u8 = 1;
const PHASE_REVOKED: u8 = 2;

/// Per-port queue bound. Each operation may legitimately queue at most one
/// terminal (duplicates are dropped at settlement), so this bound only stops
/// a runaway producer; overflow rejects with `EXT_ERR_BACKPRESSURE`.
pub(crate) const DEFERRED_PORT_MAX_QUEUED: usize = 64;
/// Owner-loop drain quantum per wake.
pub(crate) const DEFERRED_DRAIN_MAX_RECORDS: usize = 64;

/// The single extern "C" terminal ingress transferred with every port.
/// Points at broker code, so dropping the extension library can never
/// invalidate the function pointer.
pub(crate) unsafe extern "C" fn submit(
    port_data: *mut c_void,
    operation_handle: u64,
    payload_ptr: *const u8,
    payload_len: usize,
) -> ExtResultCode {
    if port_data.is_null() {
        return EXT_ERR_PORT_CLOSED;
    }
    // Safety: port_data addresses a process-lifetime PortState that the hub
    // never frees in phase 1 (see module law above).
    let state = unsafe { &*(port_data.cast::<PortState>()) };
    state.submit_ffi(operation_handle, payload_ptr, payload_len)
}

#[derive(Default)]
pub(crate) struct DeferredPortMetrics {
    pub(crate) accepted: AtomicUsize,
    pub(crate) rejected_closed: AtomicUsize,
    pub(crate) rejected_oversized: AtomicUsize,
    pub(crate) rejected_invalid_handle: AtomicUsize,
    pub(crate) rejected_backpressure: AtomicUsize,
    pub(crate) rejected_invalid_payload: AtomicUsize,
}

struct PortShared {
    wake: Box<dyn RuntimeWake + Send + Sync>,
    /// Coalesced wake bit: set when a drain has been requested and not yet
    /// consumed by the next `drain`.
    wake_pending: AtomicBool,
    /// Latched after a failed wake, cleared by any drain: a submit is never
    /// accepted against a delivery path the hub knows is dead.
    wake_failed: AtomicBool,
    metrics: DeferredPortMetrics,
}

impl PortShared {
    /// Requests one owner-loop drain, coalescing repeated requests through
    /// the pending bit (EventPort `request_drain_once` pattern). A failed
    /// wake latches `wake_failed` so ingress stops accepting records
    /// without an active delivery path.
    fn request_drain_once(&self) {
        if self.wake_failed.load(Ordering::Acquire) {
            // Delivery path unavailable: new submits already reject as
            // PORT_CLOSED at admission; accepted records wait for the next
            // drain through any path or shutdown revocation.
            return;
        }
        if !self.wake_pending.swap(true, Ordering::AcqRel) && !self.wake.wake() {
            self.wake_failed.store(true, Ordering::Release);
        }
    }
}

/// The one per-port lifecycle critical section (review P1-1): phase, session
/// binding, and the terminal queue mutate only under a single mutex, so
/// open-vs-revoke and submit-vs-revoke interleave as strict linear orders --
/// an OPEN write can never land after a revoke, and an enqueue can never
/// mutate a queue after the port observed REVOKED.
struct PortLifecycle {
    /// PENDING -> OPEN -> REVOKED; guarded here, not atomic.
    phase: u8,
    /// Host fact bound at the LoadExt ACK; None while PENDING.
    session: Option<SessionId>,
    queue: VecDeque<QueuedTerminal>,
}

struct PortState {
    shared: Arc<PortShared>,
    registry: Arc<DeferredOperationRegistry>,
    app_id: AppId,
    instance: String,
    generation: u64,
    lifecycle: Mutex<PortLifecycle>,
}

struct QueuedTerminal {
    handle: u64,
    payload: ExtOperationPayload,
}

impl PortState {
    fn submit_ffi(
        &self,
        handle: u64,
        payload_ptr: *const u8,
        payload_len: usize,
    ) -> ExtResultCode {
        // Phase gate first, inside the lifecycle critical section: no
        // payload bytes are read on a closed port.
        {
            let lifecycle = self.lock_lifecycle();
            if lifecycle.phase != PHASE_OPEN {
                self.shared.metrics.rejected_closed.fetch_add(1, Ordering::Relaxed);
                return EXT_ERR_PORT_CLOSED;
            }
        }
        // Bounded-copy law: reject the oversize before reading any byte.
        if payload_len > EXTENSION_EVENT_RECORD_MAX_BYTES {
            self.shared.metrics.rejected_oversized.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_OVERSIZED;
        }
        if payload_ptr.is_null() {
            self.shared.metrics.rejected_invalid_payload.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_REJECTED;
        }
        // Handle law: fabricated/replayed/foreign handles reject with
        // INVALID_HANDLE and a structured diagnostic (never a frame).
        let owner = self.owner_snapshot();
        match self.registry.validate_submit(handle, &owner) {
            opentray_core::operations::SubmitValidation::Accepted => {}
            opentray_core::operations::SubmitValidation::UnknownHandle => {
                self.shared.metrics.rejected_invalid_handle.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "opentray deferred terminal rejected: handle {handle:#018x} was never issued \
                     to {}/{} or its operation already ended",
                    self.app_id, self.instance
                );
                return EXT_ERR_INVALID_HANDLE;
            }
            opentray_core::operations::SubmitValidation::ForeignOwner => {
                self.shared.metrics.rejected_invalid_handle.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "opentray deferred terminal rejected: handle {handle:#018x} belongs to a \
                     different owner than port {}/{} generation {}",
                    self.app_id, self.instance, self.generation
                );
                return EXT_ERR_INVALID_HANDLE;
            }
        }
        // Bounded copy + frozen-shape validation before enqueue.
        let bytes = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        let payload = match serde_json::from_slice::<ExtOperationPayload>(bytes) {
            Ok(payload) => payload,
            Err(error) => {
                self.shared.metrics.rejected_invalid_payload.fetch_add(1, Ordering::Relaxed);
                eprintln!(
                    "opentray deferred terminal rejected: payload for handle {handle:#018x} is \
                     not one frozen TerminalPayload: {error}"
                );
                return EXT_ERR_REJECTED;
            }
        };
        if self.shared.wake_failed.load(Ordering::Acquire) {
            // Same law as the EventPort hub: never accept a record against a
            // delivery path known to be dead.
            self.shared.metrics.rejected_closed.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_PORT_CLOSED;
        }
        // Authoritative enqueue inside the same lifecycle critical section
        // (review P1-1): a revoke that landed after the early phase check is
        // observed here, so a REVOKED port's queue is never mutated.
        let mut lifecycle = self.lock_lifecycle();
        if lifecycle.phase != PHASE_OPEN {
            self.shared.metrics.rejected_closed.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_PORT_CLOSED;
        }
        if lifecycle.queue.len() >= DEFERRED_PORT_MAX_QUEUED {
            self.shared.metrics.rejected_backpressure.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_BACKPRESSURE;
        }
        lifecycle.queue.push_back(QueuedTerminal { handle, payload });
        drop(lifecycle);
        self.shared.metrics.accepted.fetch_add(1, Ordering::Relaxed);
        self.shared.request_drain_once();
        EXT_OK
    }

    fn lock_lifecycle(&self) -> std::sync::MutexGuard<'_, PortLifecycle> {
        self.lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn owner_snapshot(&self) -> DeferredPortOwner {
        let lifecycle = self.lock_lifecycle();
        DeferredPortOwner {
            app_id: self.app_id.clone(),
            instance: self.instance.clone(),
            generation: self.generation,
            session_id: lifecycle.session.clone(),
        }
    }

    /// PENDING -> OPEN transition at the LoadExt ACK. One critical section
    /// with `revoke`: if a revoke linearized first (from PENDING), the port
    /// stays REVOKED -- an OPEN write can never resurrect it.
    fn bind_session_and_open(&self, session_id: &str) -> bool {
        let mut lifecycle = self.lock_lifecycle();
        if lifecycle.phase != PHASE_PENDING || lifecycle.session.is_some() {
            return false;
        }
        lifecycle.session = Some(session_id.to_string());
        lifecycle.phase = PHASE_OPEN;
        true
    }

    /// Terminal lifecycle exit (idempotent). One critical section with
    /// `bind_session_and_open` and the enqueue path: after this returns
    /// true, no later-open or enqueue can mutate the port.
    fn revoke(&self) -> bool {
        let mut lifecycle = self.lock_lifecycle();
        if lifecycle.phase == PHASE_REVOKED {
            return false;
        }
        lifecycle.phase = PHASE_REVOKED;
        true
    }
}

/// One drained terminal with the host facts of the port that accepted it.
pub(crate) struct DrainedTerminal {
    pub(crate) owner: DeferredPortOwner,
    pub(crate) handle: u64,
    pub(crate) payload: ExtOperationPayload,
}

struct PortTable {
    /// Append-only, process-lifetime port slots (phase-1 law).
    slots: Vec<Arc<PortState>>,
    /// Latest slot per `(app, instance)`; each attach overwrites.
    latest: HashMap<(AppId, String), usize>,
}

struct HubInner {
    registry: Arc<DeferredOperationRegistry>,
    shared: Arc<PortShared>,
    ports: Mutex<PortTable>,
}

/// Owner-loop and loader handle around the process-lifetime port registry.
/// Cheap to clone; cloning never duplicates queue state.
#[derive(Clone)]
pub(crate) struct DeferredPortHub {
    inner: Arc<HubInner>,
}

impl std::fmt::Debug for DeferredPortHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeferredPortHub").finish_non_exhaustive()
    }
}

/// Loader-owned handle to one attached deferred port. Dropping it does not
/// free the backing state (process-lifetime by law); `revoke` is the only
/// transition.
pub(crate) struct DeferredPortHandle {
    state: Arc<PortState>,
}

impl std::fmt::Debug for DeferredPortHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeferredPortHandle")
            .field("app_id", &self.state.app_id)
            .field("instance", &self.state.instance)
            .field("generation", &self.state.generation)
            .finish_non_exhaustive()
    }
}

impl DeferredPortHandle {
    /// The immutable port value handed to the extension through the attach
    /// symbol, BY VALUE.
    pub(crate) fn port(&self) -> ExtDeferredPortV1 {
        ExtDeferredPortV1 {
            abi_version: EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
            port_data: Arc::as_ptr(&self.state) as *mut c_void,
            submit,
        }
    }

    /// Revoke this port (idempotent). The lifecycle law requires this to run
    /// before instance `deinit`, library drop, and session cleanup.
    pub(crate) fn revoke(&self) -> bool {
        self.state.revoke()
    }
}

pub(crate) enum DeferredPortValidationError {
    AbiVersion(u32),
    StructSize(u32),
    NullPortData,
}

/// Defensive validation of the port about to be transferred by value: exact
/// nested ABI version, matching struct size, non-null host state.
pub(crate) fn validate_deferred_port(
    port: &ExtDeferredPortV1,
) -> Result<(), DeferredPortValidationError> {
    if port.abi_version != EXT_DEFERRED_PORT_ABI_V1 {
        return Err(DeferredPortValidationError::AbiVersion(port.abi_version));
    }
    if port.struct_size as usize != std::mem::size_of::<ExtDeferredPortV1>() {
        return Err(DeferredPortValidationError::StructSize(port.struct_size));
    }
    if port.port_data.is_null() {
        return Err(DeferredPortValidationError::NullPortData);
    }
    Ok(())
}

impl DeferredPortHub {
    pub(crate) fn new(
        wake: Box<dyn RuntimeWake + Send + Sync>,
        registry: Arc<DeferredOperationRegistry>,
    ) -> Self {
        Self {
            inner: Arc::new(HubInner {
                registry,
                shared: Arc::new(PortShared {
                    wake,
                    wake_pending: AtomicBool::new(false),
                    wake_failed: AtomicBool::new(false),
                    metrics: DeferredPortMetrics::default(),
                }),
                ports: Mutex::new(PortTable {
                    slots: Vec::new(),
                    latest: HashMap::new(),
                }),
            }),
        }
    }

    /// Attaches one PENDING deferred-port owner for a loading instance and
    /// records its fresh generation in the shared operation registry. The
    /// submit channel opens only at the LoadExt ACK (`open_port`).
    pub(crate) fn attach_port(&self, app_id: AppId, instance: String) -> DeferredPortHandle {
        let generation = self
            .inner
            .registry
            .note_instance_attached(app_id.clone(), instance.clone());
        let state = Arc::new(PortState {
            shared: self.inner.shared.clone(),
            registry: self.inner.registry.clone(),
            app_id,
            instance,
            generation,
            lifecycle: Mutex::new(PortLifecycle {
                phase: PHASE_PENDING,
                session: None,
                queue: VecDeque::new(),
            }),
        });
        let mut ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let index = ports.slots.len();
        ports.slots.push(state.clone());
        ports.latest.insert(
            (state.app_id.clone(), state.instance.clone()),
            index,
        );
        DeferredPortHandle { state }
    }

    /// LoadExt-ACK transition: binds the owning session and opens the latest
    /// PENDING port for the instance. Only a successful ACK may call this.
    pub(crate) fn open_port(&self, app_id: &str, instance: &str, session_id: &str) -> bool {
        let ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(index) = ports.latest.get(&(app_id.to_string(), instance.to_string())) else {
            return false;
        };
        ports.slots[*index].bind_session_and_open(session_id)
    }

    /// Revokes every port bound to a closing session BEFORE core
    /// session_closed runs (its cleanup pushes then observe PORT_CLOSED).
    pub(crate) fn revoke_session(&self, session_id: &str) {
        let ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for slot in &ports.slots {
            let bound = slot.lock_lifecycle().session.as_deref() == Some(session_id);
            if bound {
                slot.revoke();
            }
        }
    }

    /// Shutdown law: revoke every port; there is no flush promise to keep.
    pub(crate) fn revoke_all(&self) {
        let ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for slot in &ports.slots {
            slot.revoke();
        }
    }

    /// Ingress counters for the stub-FFI decision-table tests; production
    /// diagnostics flow through the broker log.
    #[cfg(test)]
    pub(crate) fn metrics(&self) -> &DeferredPortMetrics {
        &self.inner.shared.metrics
    }

    /// Takes one bounded batch of queued terminals (oldest first across
    /// ports) and clears the coalesced wake bit. Owner loop only.
    pub(crate) fn drain(&self, max_records: usize) -> Vec<DrainedTerminal> {
        // Clearing the pending bit before draining means records submitted
        // during the drain re-arm the wake themselves; nothing strands.
        self.inner.shared.wake_pending.store(false, Ordering::Release);
        self.inner.shared.wake_failed.store(false, Ordering::Release);
        let ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut drained = Vec::new();
        'outer: loop {
            let mut progressed = false;
            for slot in &ports.slots {
                if drained.len() >= max_records {
                    break 'outer;
                }
                let mut lifecycle = slot.lock_lifecycle();
                if let Some(record) = lifecycle.queue.pop_front() {
                    // Owner facts are read from the same guard: re-locking
                    // through `owner_snapshot` would deadlock the
                    // non-reentrant lifecycle mutex.
                    drained.push(DrainedTerminal {
                        owner: DeferredPortOwner {
                            app_id: slot.app_id.clone(),
                            instance: slot.instance.clone(),
                            generation: slot.generation,
                            session_id: lifecycle.session.clone(),
                        },
                        handle: record.handle,
                        payload: record.payload,
                    });
                    progressed = true;
                }
            }
            if !progressed {
                break;
            }
        }
        drained
    }

    /// Re-arms the wake when drainable work remains (review P1-8, the
    /// EventPort `rewake_if_ready` pattern): the per-wake drain quantum is
    /// global across ports, so one wake can leave records queued on later
    /// ports. Without this re-arm, those records would wait for a producer
    /// that may never come; with it, the owner loop keeps waking until every
    /// queue is empty. Records on PENDING or REVOKED ports still count as
    /// drainable -- their settlement classification (UnknownHandle after a
    /// purge, stale after a reload) is the owner loop's diagnostic drop.
    pub(crate) fn rewake_if_ready(&self) {
        let ports = self
            .inner
            .ports
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        for slot in &ports.slots {
            if !slot.lock_lifecycle().queue.is_empty() {
                self.inner.shared.request_drain_once();
                return;
            }
        }
    }
}

/// Owner-loop drain: settles each terminal through the shared registry's
/// one-shot CAS and writes the `ext-operation-terminal` frame to the
/// still-matching session writer. Duplicate, foreign-owner, stale-
/// generation, and unknown-handle records drop with structured diagnostics;
/// there is never a second frame for one operation. Delivery order is the
/// transport write order -- no event barrier is promised.
///
/// Close-ordering law (add-ext-dialog design section 5.7 ruling 7, review
/// P1-2): when `closing_session` is `Some`, that session's pending
/// operations are purged BEFORE any drain runs, so a terminal queued before
/// the close settles as an UnknownHandle diagnostic drop instead of being
/// written into the closing socket. Both owner loops (the native winit loop
/// and the Linux blocking loop) route their Exit/close paths through this
/// parameter; `None` is the ordinary post-dispatch drain.
///
/// Budget law (review P1-8): a drain that leaves any queue non-empty
/// re-requests the wake, so over-quota records keep flowing until every
/// queue is empty even when producers go quiet.
pub(crate) fn drain_deferred_terminals<B, L>(
    hub: &DeferredPortHub,
    broker: &opentray_core::BrokerKernel<B, L>,
    closing_session: Option<&str>,
    write: &mut dyn FnMut(&str, opentray_spec::ServerFrame) -> bool,
) where
    B: opentray_core::AppBackend,
    L: opentray_core::ExtensionLoader,
{
    use opentray_core::operations::OperationSettlement;
    use opentray_spec::ServerFrame;

    if let Some(session_id) = closing_session {
        let purged = broker.operations().purge_session(session_id);
        if purged > 0 {
            eprintln!(
                "opentray deferred terminal purge: {purged} operations of closing session \
                 {session_id} ended with the transport (no terminal delivery)"
            );
        }
    }
    for record in hub.drain(DEFERRED_DRAIN_MAX_RECORDS) {
        let operations = broker.operations();
        match operations.settle(record.handle, &record.owner) {
            OperationSettlement::Settled {
                operation_id,
                scope,
            } => {
                let frame = ServerFrame::ExtOperationTerminal {
                    operation_id,
                    payload: record.payload,
                };
                if !write(&scope.session_id, frame) {
                    eprintln!(
                        "opentray deferred terminal dropped: owning client session {} is closed",
                        scope.session_id
                    );
                }
            }
            OperationSettlement::Duplicate { operation_id } => {
                eprintln!(
                    "opentray deferred terminal dropped: operation {operation_id} already \
                     settled (duplicate terminal for port {}/{} generation {})",
                    record.owner.app_id, record.owner.instance, record.owner.generation
                );
            }
            OperationSettlement::ForeignOwner { operation_id } => {
                eprintln!(
                    "opentray deferred terminal dropped: operation {operation_id} belongs to a \
                     different owner than port {}/{} generation {}",
                    record.owner.app_id, record.owner.instance, record.owner.generation
                );
            }
            OperationSettlement::StaleGeneration { operation_id } => {
                eprintln!(
                    "opentray deferred terminal dropped: operation {operation_id} belongs to a \
                     stale generation (port {}/{} generation {})",
                    record.owner.app_id, record.owner.instance, record.owner.generation
                );
            }
            OperationSettlement::UnknownHandle { handle } => {
                eprintln!(
                    "opentray deferred terminal dropped: handle {handle:#018x} is unknown to the \
                     settlement (port {}/{} generation {})",
                    record.owner.app_id, record.owner.instance, record.owner.generation
                );
            }
        }
    }
    hub.rewake_if_ready();
}

#[cfg(test)]
pub(crate) mod deferred_port_test_support {
    use super::*;

    /// Wake adapter that records nothing and always succeeds; for unit tests.
    pub(crate) struct NoopWake;
    impl RuntimeWake for NoopWake {
        fn wake(&self) -> bool {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deferred_port::deferred_port_test_support::NoopWake;
    use opentray_core::operations::IssuedOperation;
    use opentray_spec::{CommandScope, ServerFrame, TypedExtensionError};

    fn registry() -> Arc<DeferredOperationRegistry> {
        Arc::new(DeferredOperationRegistry::new())
    }

    fn hub(registry: &Arc<DeferredOperationRegistry>) -> DeferredPortHub {
        DeferredPortHub::new(Box::new(NoopWake), registry.clone())
    }

    fn opened_port(registry: &Arc<DeferredOperationRegistry>, hub: &DeferredPortHub) -> (DeferredPortHandle, IssuedOperation) {
        let handle = hub.attach_port("app-1".to_string(), "dialog".to_string());
        assert!(hub.open_port("app-1", "dialog", "session-1"));
        let generation = registry.current_generation("app-1", "dialog");
        let issued = registry.register_pending(
            CommandScope {
                app_id: "app-1".to_string(),
                tray_id: "tray-1".to_string(),
                session_id: "session-1".to_string(),
                instance_generation: generation,
            },
            "dialog".to_string(),
        );
        (handle, issued)
    }

    fn result_payload() -> ExtOperationPayload {
        ExtOperationPayload::Result {
            value: serde_json::json!({ "response": 0 }),
        }
    }

    #[test]
    fn malformed_details_in_terminal_errors_reject_ingress_without_queue_mutation() {
        let registry = registry();
        let hub = hub(&registry);
        let (_handle, issued) = opened_port(&registry, &hub);
        let ports = hub.inner.ports.lock().unwrap();
        let state = ports.slots[0].clone();
        drop(ports);

        // The synchronous error frame rejects non-object details; the deferred
        // terminal path must accept exactly the same language (impl review R2).
        let malformed = [
            r#"{"kind":"error","error":{"code":"x","message":"m","details":null}}"#,
            r#"{"kind":"error","error":{"code":"x","message":"m","details":1}}"#,
            r#"{"kind":"error","error":{"code":"x","message":"m","details":[]}}"#,
            r#"{"kind":"error","error":{"code":"x","message":"m","details":"str"}}"#,
        ];
        for raw in malformed {
            let bytes = raw.as_bytes();
            assert_eq!(
                unsafe {
                    submit(
                        Arc::as_ptr(&state) as *mut c_void,
                        issued.handle,
                        bytes.as_ptr(),
                        bytes.len(),
                    )
                },
                EXT_ERR_REJECTED,
                "must reject non-object terminal details: {raw}"
            );
        }
        // The operation stays pending and, decisively, no queue record was
        // appended for any malformed submit: drain the port and assert it is
        // empty before the well-formed payload goes through.
        assert_eq!(registry.session_operation_count("session-1"), 1);
        assert!(
            hub.drain(64).is_empty(),
            "malformed details must not enqueue any terminal record"
        );
        let good = serde_json::to_vec(&ExtOperationPayload::Error {
            error: TypedExtensionError {
                code: "dialog_dismissal_unavailable".to_string(),
                message: "platform cannot observe dismissal".to_string(),
                details: Some(serde_json::json!({"variant":"none"})),
            },
        })
        .unwrap();
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, issued.handle, good.as_ptr(), good.len()) },
            EXT_OK
        );
        let drained = hub.drain(64);
        assert_eq!(drained.len(), 1, "the valid terminal drains exactly once");
        assert_eq!(drained[0].handle, issued.handle);
    }

    #[test]
    fn port_layout_and_validation_mirror_the_event_port_family() {
        let registry = registry();
        let hub = hub(&registry);
        let handle = hub.attach_port("app-1".to_string(), "dialog".to_string());
        let port = handle.port();

        assert_eq!(port.abi_version, EXT_DEFERRED_PORT_ABI_V1);
        assert_eq!(
            port.struct_size as usize,
            std::mem::size_of::<ExtDeferredPortV1>()
        );
        assert!(!port.port_data.is_null());
        assert!(validate_deferred_port(&port).is_ok());

        let mut bad_abi = port;
        bad_abi.abi_version += 1;
        assert!(matches!(
            validate_deferred_port(&bad_abi),
            Err(DeferredPortValidationError::AbiVersion(_))
        ));
        let mut bad_size = port;
        bad_size.struct_size = 0;
        assert!(matches!(
            validate_deferred_port(&bad_size),
            Err(DeferredPortValidationError::StructSize(0))
        ));
        let mut null_data = port;
        null_data.port_data = std::ptr::null_mut();
        assert!(matches!(
            validate_deferred_port(&null_data),
            Err(DeferredPortValidationError::NullPortData)
        ));
    }

    #[test]
    fn submit_channel_stays_closed_until_the_load_ack() {
        let registry = registry();
        let hub = hub(&registry);
        let handle = hub.attach_port("app-1".to_string(), "dialog".to_string());
        let port = handle.port();

        // Pre-ACK: PENDING ports reject closed before reading any byte.
        let payload = serde_json::to_vec(&result_payload()).unwrap();
        assert_eq!(
            unsafe {
                submit(
                    port.port_data,
                    1,
                    payload.as_ptr(),
                    payload.len(),
                )
            },
            EXT_ERR_PORT_CLOSED
        );
        assert_eq!(hub.metrics().rejected_closed.load(Ordering::Relaxed), 1);

        // After the ACK the same submit is accepted.
        assert!(hub.open_port("app-1", "dialog", "session-1"));
        let generation = registry.current_generation("app-1", "dialog");
        let issued = registry.register_pending(
            CommandScope {
                app_id: "app-1".to_string(),
                tray_id: "tray-1".to_string(),
                session_id: "session-1".to_string(),
                instance_generation: generation,
            },
            "dialog".to_string(),
        );
        assert_eq!(
            unsafe { submit(port.port_data, issued.handle, payload.as_ptr(), payload.len()) },
            EXT_OK
        );
        assert_eq!(hub.metrics().accepted.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn revoke_closes_the_submit_channel_permanently() {
        let registry = registry();
        let hub = hub(&registry);
        let (handle, issued) = opened_port(&registry, &hub);
        let port = handle.port();
        let payload = serde_json::to_vec(&result_payload()).unwrap();

        assert_eq!(
            unsafe { submit(port.port_data, issued.handle, payload.as_ptr(), payload.len()) },
            EXT_OK
        );
        assert!(handle.revoke());
        assert!(!handle.revoke(), "revoke is idempotent");
        assert_eq!(
            unsafe { submit(port.port_data, issued.handle, payload.as_ptr(), payload.len()) },
            EXT_ERR_PORT_CLOSED
        );
    }

    #[test]
    fn oversized_payloads_reject_before_any_byte_is_copied() {
        let registry = registry();
        let hub = hub(&registry);
        let (_handle, issued) = opened_port(&registry, &hub);
        let ports = hub.inner.ports.lock().unwrap();
        let state = ports.slots[0].clone();
        drop(ports);

        let oversized = vec![b'x'; EXTENSION_EVENT_RECORD_MAX_BYTES + 1];
        assert_eq!(
            unsafe {
                submit(
                    Arc::as_ptr(&state) as *mut c_void,
                    issued.handle,
                    oversized.as_ptr(),
                    oversized.len(),
                )
            },
            EXT_ERR_OVERSIZED
        );
        assert_eq!(hub.metrics().rejected_oversized.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn forged_and_foreign_handles_reject_with_invalid_handle() {
        let registry = registry();
        let hub = hub(&registry);
        let (_handle, _issued) = opened_port(&registry, &hub);
        let ports = hub.inner.ports.lock().unwrap();
        let state = ports.slots[0].clone();
        drop(ports);
        let payload = serde_json::to_vec(&result_payload()).unwrap();

        // Fabricated: never issued.
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, 0xfeed_face, payload.as_ptr(), payload.len()) },
            EXT_ERR_INVALID_HANDLE
        );
        // Foreign: issued, but to another session (wrong port).
        let other = registry.register_pending(
            CommandScope {
                app_id: "app-1".to_string(),
                tray_id: "tray-1".to_string(),
                session_id: "session-2".to_string(),
                instance_generation: registry.current_generation("app-1", "dialog"),
            },
            "dialog".to_string(),
        );
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, other.handle, payload.as_ptr(), payload.len()) },
            EXT_ERR_INVALID_HANDLE
        );
        assert_eq!(
            hub.metrics().rejected_invalid_handle.load(Ordering::Relaxed),
            2
        );
    }

    #[test]
    fn malformed_payloads_reject_without_touching_the_queue() {
        let registry = registry();
        let hub = hub(&registry);
        let (_handle, issued) = opened_port(&registry, &hub);
        let ports = hub.inner.ports.lock().unwrap();
        let state = ports.slots[0].clone();
        drop(ports);

        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, issued.handle, b"not json".as_ptr(), 8) },
            EXT_ERR_REJECTED
        );
        // Valid JSON but not a frozen TerminalPayload branch.
        let unknown_kind = br#"{"kind":"cancel"}"#;
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, issued.handle, unknown_kind.as_ptr(), unknown_kind.len()) },
            EXT_ERR_REJECTED
        );
        assert_eq!(hub.metrics().rejected_invalid_payload.load(Ordering::Relaxed), 2);
        assert!(hub.drain(DEFERRED_DRAIN_MAX_RECORDS).is_empty());
    }

    #[test]
    fn drained_terminals_settle_once_and_deliver_to_the_matching_writer() {
        let registry = registry();
        let hub = hub(&registry);
        let (_handle, issued) = opened_port(&registry, &hub);
        let ports = hub.inner.ports.lock().unwrap();
        let state = ports.slots[0].clone();
        drop(ports);

        let error_payload = ExtOperationPayload::Error {
            error: TypedExtensionError {
                code: "dialog_dismissal_unavailable".to_string(),
                message: "unobservable".to_string(),
                details: None,
            },
        };
        let bytes = serde_json::to_vec(&error_payload).unwrap();
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, issued.handle, bytes.as_ptr(), bytes.len()) },
            EXT_OK
        );
        // A duplicate terminal is ingress-accepted and settlement-dropped.
        assert_eq!(
            unsafe { submit(Arc::as_ptr(&state) as *mut c_void, issued.handle, bytes.as_ptr(), bytes.len()) },
            EXT_OK
        );

        let backend = opentray_core::FakeBackend::new(opentray_core::BackendCapabilities::full());
        let broker = opentray_core::BrokerKernel::with_default_app_options_and_operations(
            backend,
            opentray_core::UnsupportedExtensionLoader,
            default_options(),
            test_artifact_identity(),
            registry.clone(),
        );

        let mut delivered: Vec<(String, ServerFrame)> = Vec::new();
        drain_deferred_terminals(&hub, &broker, None, &mut |owner, frame| {
            delivered.push((owner.to_string(), frame));
            true
        });

        assert_eq!(delivered.len(), 1, "exactly one terminal frame");
        let (owner, frame) = &delivered[0];
        assert_eq!(owner, "session-1");
        let ServerFrame::ExtOperationTerminal {
            operation_id,
            payload,
        } = frame
        else {
            panic!("expected terminal frame: {frame:?}");
        };
        assert_eq!(operation_id, &issued.operation_id);
        assert_eq!(payload, &error_payload);
    }

    // -- Linearization race fixtures (review P1-1) ---------------------------

    use std::sync::Barrier;

    /// open-vs-revoke, barrier-controlled: whatever interleaving the
    /// scheduler picks, a revoked port is never resurrected to OPEN. Both
    /// linear orders are legal outcomes; an OPEN-write-after-revoke is not.
    /// The assertions hold for every interleaving, so the test is
    /// deterministic in outcome (no sleep-based coordination).
    #[test]
    fn open_vs_revoke_never_resurrects_the_open_phase() {
        for round in 0..64 {
            let registry = registry();
            let hub = hub(&registry);
            let handle = hub.attach_port("app-1".to_string(), "dialog".to_string());
            let port = handle.port();
            let opened = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let revoked = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let barrier = Arc::new(Barrier::new(2));

            let open_barrier = barrier.clone();
            let open_flag = opened.clone();
            let open_hub = hub.clone();
            let opener = std::thread::spawn(move || {
                open_barrier.wait();
                open_flag.store(
                    open_hub.open_port("app-1", "dialog", "session-1"),
                    Ordering::SeqCst,
                );
            });

            let revoke_barrier = barrier.clone();
            let revoke_flag = revoked.clone();
            let revoker = std::thread::spawn(move || {
                revoke_barrier.wait();
                revoke_flag.store(handle.revoke(), Ordering::SeqCst);
            });

            opener.join().expect("opener");
            revoker.join().expect("revoker");

            assert!(
                revoked.load(Ordering::SeqCst),
                "round {round}: revoke from PENDING or OPEN always wins"
            );
            // Whatever the interleaving, the port ends REVOKED: a submit for
            // a live operation is rejected closed -- never accepted against
            // a resurrected OPEN phase.
            let generation = registry.current_generation("app-1", "dialog");
            let issued = registry.register_pending(
                CommandScope {
                    app_id: "app-1".to_string(),
                    tray_id: "tray-1".to_string(),
                    session_id: "session-1".to_string(),
                    instance_generation: generation,
                },
                "dialog".to_string(),
            );
            let payload = serde_json::to_vec(&result_payload()).unwrap();
            assert_eq!(
                unsafe { submit(port.port_data, issued.handle, payload.as_ptr(), payload.len()) },
                EXT_ERR_PORT_CLOSED,
                "round {round}: no OPEN resurrection after revoke (open={})",
                opened.load(Ordering::SeqCst)
            );
            // A second open attempt can never succeed either: the port is
            // no longer PENDING.
            assert!(
                !hub.open_port("app-1", "dialog", "session-1"),
                "round {round}: a revoked port is not openable"
            );
        }
    }

    /// submit-vs-revoke, barrier-controlled: every EXT_OK is accounted for
    /// by exactly one queued record, and a revoke observed by the enqueue
    /// path rejects closed. There is no interleaving in which a submit
    /// returns OK but mutates nothing, or mutates a REVOKED queue.
    #[test]
    fn submit_vs_revoke_never_mutates_the_queue_after_revoke() {
        for round in 0..32 {
            let registry = registry();
            let hub = hub(&registry);
            let (handle, issued) = opened_port(&registry, &hub);
            // The port struct carries a raw pointer (not Send); the
            // process-lifetime `Arc<PortState>` is, and `submit` accepts
            // its address directly.
            let state = handle.state.clone();
            let payload = serde_json::to_vec(&result_payload()).unwrap();

            let barrier = Arc::new(Barrier::new(2));
            let ok_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let closed_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

            let submit_barrier = barrier.clone();
            let submit_ok = ok_count.clone();
            let submit_closed = closed_count.clone();
            let submitter = std::thread::spawn(move || {
                let port_data: *mut c_void = Arc::as_ptr(&state).cast_mut().cast();
                submit_barrier.wait();
                let mut oks = 0usize;
                let mut closed = 0usize;
                for _ in 0..8 {
                    let code = unsafe {
                        submit(port_data, issued.handle, payload.as_ptr(), payload.len())
                    };
                    match code {
                        EXT_OK => oks += 1,
                        EXT_ERR_PORT_CLOSED => closed += 1,
                        other => panic!("round {round}: unexpected submit code {other}"),
                    }
                }
                submit_ok.store(oks, Ordering::SeqCst);
                submit_closed.store(closed, Ordering::SeqCst);
            });

            let revoke_barrier = barrier.clone();
            let revoker = std::thread::spawn(move || {
                revoke_barrier.wait();
                assert!(handle.revoke());
            });

            submitter.join().expect("submitter");
            revoker.join().expect("revoker");

            // Linearization invariant: exactly the OK submits mutated the
            // queue. One operation handle settles once; duplicates stay
            // queued for the CAS, so the drained total equals the OK count.
            let drained = hub.drain(DEFERRED_DRAIN_MAX_RECORDS).len();
            let oks = ok_count.load(Ordering::SeqCst);
            let closed = closed_count.load(Ordering::SeqCst);
            assert_eq!(
                drained, oks,
                "round {round}: every EXT_OK left exactly one queued record"
            );
            assert_eq!(oks + closed, 8);
            // After the joined revoke, the channel is permanently closed.
            let payload = serde_json::to_vec(&result_payload()).unwrap();
            let state = {
                let ports = hub.inner.ports.lock().unwrap();
                ports.slots[0].clone()
            };
            assert_eq!(
                unsafe {
                    submit(
                        Arc::as_ptr(&state) as *mut c_void,
                        issued.handle,
                        payload.as_ptr(),
                        payload.len(),
                    )
                },
                EXT_ERR_PORT_CLOSED,
                "round {round}: post-revoke submit is closed"
            );
        }
    }

    // -- Close ordering (design section 5.7 ruling 7, review P1-2) ----------

    /// The Exit-path drain helper purges the closing session BEFORE any
    /// terminal delivery: a record queued before the close settles as an
    /// UnknownHandle drop and the closing session observes ZERO
    /// ext-operation-terminal frames, while another session's live record
    /// still settles normally.
    #[test]
    fn closing_session_drain_delivers_zero_terminal_frames_for_that_session() {
        let registry = registry();
        let hub = hub(&registry);
        // Two ports: one owned by the closing session, one by a survivor.
        let closing = hub.attach_port("app-1".to_string(), "dialog".to_string());
        let survivor = hub.attach_port("app-2".to_string(), "dialog".to_string());
        assert!(hub.open_port("app-1", "dialog", "session-1"));
        assert!(hub.open_port("app-2", "dialog", "session-2"));

        let generation_one = registry.current_generation("app-1", "dialog");
        let generation_two = registry.current_generation("app-2", "dialog");
        let issued_closing = registry.register_pending(
            CommandScope {
                app_id: "app-1".to_string(),
                tray_id: "tray-1".to_string(),
                session_id: "session-1".to_string(),
                instance_generation: generation_one,
            },
            "dialog".to_string(),
        );
        let issued_survivor = registry.register_pending(
            CommandScope {
                app_id: "app-2".to_string(),
                tray_id: "tray-2".to_string(),
                session_id: "session-2".to_string(),
                instance_generation: generation_two,
            },
            "dialog".to_string(),
        );

        // Terminal records queued BEFORE the close on both ports.
        let payload = serde_json::to_vec(&result_payload()).unwrap();
        let closing_port = closing.port();
        assert_eq!(
            unsafe {
                submit(
                    closing_port.port_data,
                    issued_closing.handle,
                    payload.as_ptr(),
                    payload.len(),
                )
            },
            EXT_OK
        );
        let survivor_port = survivor.port();
        assert_eq!(
            unsafe {
                submit(
                    survivor_port.port_data,
                    issued_survivor.handle,
                    payload.as_ptr(),
                    payload.len(),
                )
            },
            EXT_OK
        );

        // The Exit path's pre-dispatch step: the closing session's ports are
        // revoked first, then the kernel runs, then the closing-aware drain.
        hub.revoke_session("session-1");

        let backend = opentray_core::FakeBackend::new(opentray_core::BackendCapabilities::full());
        let broker = opentray_core::BrokerKernel::with_default_app_options_and_operations(
            backend,
            opentray_core::UnsupportedExtensionLoader,
            default_options(),
            test_artifact_identity(),
            registry.clone(),
        );

        let mut delivered: Vec<(String, ServerFrame)> = Vec::new();
        drain_deferred_terminals(&hub, &broker, Some("session-1"), &mut |owner, frame| {
            delivered.push((owner.to_string(), frame));
            true
        });

        let closing_frames = delivered
            .iter()
            .filter(|(owner, _)| owner == "session-1")
            .count();
        assert_eq!(
            closing_frames, 0,
            "the closing session receives zero terminal frames: {delivered:?}"
        );
        assert_eq!(delivered.len(), 1, "the survivor's record still settles");
        assert_eq!(delivered[0].0, "session-2");
        // The closing session's operation is gone: a later settle is a
        // replayed-handle rejection.
        let owner = DeferredPortOwner {
            app_id: "app-1".to_string(),
            instance: "dialog".to_string(),
            generation: generation_one,
            session_id: Some("session-1".to_string()),
        };
        assert!(matches!(
            registry.settle(issued_closing.handle, &owner),
            opentray_core::operations::OperationSettlement::UnknownHandle { .. }
        ));
    }

    // -- Drain re-arm (review P1-8) ------------------------------------------

    /// Wake adapter that counts requested wakes; always succeeds.
    struct CountingWakeInner {
        counter: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl RuntimeWake for CountingWakeInner {
        fn wake(&self) -> bool {
            self.counter.fetch_add(1, Ordering::SeqCst);
            true
        }
    }

    /// Multi-port over-quota: three ports each queue more than a third of
    /// the global 64-record drain quantum, so one drain cannot empty them.
    /// Every incomplete drain must re-request the wake, and repeatedly
    /// following the wake drains the hub to empty without any new producer
    /// -- over-quota records can never strand.
    #[test]
    fn budget_exhausted_drains_rearm_until_every_queue_is_empty() {
        let registry = registry();
        let wake_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let hub = DeferredPortHub::new(
            Box::new(CountingWakeInner {
                counter: wake_calls.clone(),
            }),
            registry.clone(),
        );

        let ports: Vec<(DeferredPortHandle, Vec<opentray_core::operations::IssuedOperation>)> =
            (0..3)
                .map(|index| {
                    let app = format!("app-{index}");
                    let handle = hub.attach_port(app.clone(), "dialog".to_string());
                    assert!(hub.open_port(&app, "dialog", &format!("session-{index}")));
                    let generation = registry.current_generation(&app, "dialog");
                    let issued = (0..30)
                        .map(|_| {
                            registry.register_pending(
                                CommandScope {
                                    app_id: app.clone(),
                                    tray_id: "tray-1".to_string(),
                                    session_id: format!("session-{index}"),
                                    instance_generation: generation,
                                },
                                "dialog".to_string(),
                            )
                        })
                        .collect();
                    (handle, issued)
                })
                .collect();

        let payload = serde_json::to_vec(&result_payload()).unwrap();
        let mut total = 0usize;
        for (handle, issued) in &ports {
            let port = handle.port();
            for operation in issued {
                assert_eq!(
                    unsafe {
                        submit(
                            port.port_data,
                            operation.handle,
                            payload.as_ptr(),
                            payload.len(),
                        )
                    },
                    EXT_OK
                );
                total += 1;
            }
        }
        assert_eq!(total, 90, "90 records exceed the 64-record drain quantum");

        // Owner loop: drain, then follow the re-armed wake (the CountingWake
        // records each requested wake; rewake_if_ready must have requested
        // another one whenever records REMAINED after a drain -- the final
        // drain that empties the hub correctly requests none).
        let mut drained_total = 0usize;
        loop {
            let before = wake_calls.load(Ordering::SeqCst);
            let drained = hub.drain(DEFERRED_DRAIN_MAX_RECORDS).len();
            drained_total += drained;
            let remaining = total - drained_total;
            hub.rewake_if_ready();
            let after = wake_calls.load(Ordering::SeqCst);
            if remaining > 0 {
                assert!(
                    after > before,
                    "a drain that leaves {remaining} records must re-request the wake"
                );
            }
            if drained == 0 {
                break;
            }
        }
        assert_eq!(
            drained_total, total,
            "re-armed drains empty every port's queue"
        );
        // The hub is empty: no further wake is requested.
        let settled = wake_calls.load(Ordering::SeqCst);
        hub.rewake_if_ready();
        assert_eq!(
            wake_calls.load(Ordering::SeqCst),
            settled,
            "an empty hub does not spin"
        );
    }

    fn default_options() -> opentray_spec::AppOptions {
        opentray_spec::AppOptions {
            id: Some("app-1".to_string()),
            name: None,
            app_icon: None,
            default: true,
        }
    }

    fn test_artifact_identity() -> opentray_spec::BrokerArtifactIdentity {
        opentray_spec::BrokerArtifactIdentity {
            package_version: "0.1.0".to_string(),
            target: opentray_spec::BrokerArtifactTarget {
                os: "darwin".to_string(),
                arch: "arm64".to_string(),
            },
            executable_hash: "0".repeat(64),
            build_identity: "test-broker".to_string(),
        }
    }
}
