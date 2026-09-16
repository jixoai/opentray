// DeferredPort hub (add-ext-dialog §5.1, batch A).
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
//   the owner loop's one-shot CAS — this module never writes frames.

use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
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
    /// consumed by `begin_drain`.
    wake_pending: AtomicBool,
    /// Latched after a failed wake, cleared by any drain: a submit is never
    /// accepted against a delivery path the hub knows is dead.
    wake_failed: AtomicBool,
    metrics: DeferredPortMetrics,
}

struct PortState {
    shared: Arc<PortShared>,
    registry: Arc<DeferredOperationRegistry>,
    app_id: AppId,
    instance: String,
    generation: u64,
    /// Host fact bound at the LoadExt ACK; None while PENDING.
    session: Mutex<Option<SessionId>>,
    /// PENDING -> OPEN -> REVOKED. Stores use Release, loads use Acquire.
    phase: AtomicU8,
    queue: Mutex<VecDeque<QueuedTerminal>>,
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
        // Phase gate first: no payload bytes are read on a closed port.
        if self.phase.load(Ordering::Acquire) != PHASE_OPEN {
            self.shared.metrics.rejected_closed.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_PORT_CLOSED;
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
        let mut queue = self.queue.lock().unwrap_or_else(|error| error.into_inner());
        if queue.len() >= DEFERRED_PORT_MAX_QUEUED {
            self.shared.metrics.rejected_backpressure.fetch_add(1, Ordering::Relaxed);
            return EXT_ERR_BACKPRESSURE;
        }
        queue.push_back(QueuedTerminal { handle, payload });
        drop(queue);
        self.shared.metrics.accepted.fetch_add(1, Ordering::Relaxed);
        if !self.shared.wake_pending.swap(true, Ordering::AcqRel) && !self.shared.wake.wake() {
            self.shared.wake_failed.store(true, Ordering::Release);
        }
        EXT_OK
    }

    fn owner_snapshot(&self) -> DeferredPortOwner {
        DeferredPortOwner {
            app_id: self.app_id.clone(),
            instance: self.instance.clone(),
            generation: self.generation,
            session_id: self
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone(),
        }
    }

    fn bind_session_and_open(&self, session_id: &str) -> bool {
        let mut session = self.session.lock().unwrap_or_else(|error| error.into_inner());
        if self.phase.load(Ordering::Acquire) != PHASE_PENDING || session.is_some() {
            return false;
        }
        *session = Some(session_id.to_string());
        drop(session);
        self.phase.store(PHASE_OPEN, Ordering::Release);
        true
    }

    fn revoke(&self) -> bool {
        self.phase.swap(PHASE_REVOKED, Ordering::AcqRel) != PHASE_REVOKED
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
            session: Mutex::new(None),
            phase: AtomicU8::new(PHASE_PENDING),
            queue: Mutex::new(VecDeque::new()),
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
            let bound = slot
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .as_deref()
                == Some(session_id);
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
                let mut queue = slot.queue.lock().unwrap_or_else(|error| error.into_inner());
                if let Some(record) = queue.pop_front() {
                    drained.push(DrainedTerminal {
                        owner: slot.owner_snapshot(),
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
}

/// Owner-loop drain: settles each terminal through the shared registry's
/// one-shot CAS and writes the `ext-operation-terminal` frame to the
/// still-matching session writer. Duplicate, foreign-owner, stale-
/// generation, and unknown-handle records drop with structured diagnostics;
/// there is never a second frame for one operation. Delivery order is the
/// transport write order — no event barrier is promised.
pub(crate) fn drain_deferred_terminals<B, L>(
    hub: &DeferredPortHub,
    broker: &opentray_core::BrokerKernel<B, L>,
    write: &mut dyn FnMut(&str, opentray_spec::ServerFrame) -> bool,
) where
    B: opentray_core::AppBackend,
    L: opentray_core::ExtensionLoader,
{
    use opentray_core::operations::OperationSettlement;
    use opentray_spec::ServerFrame;

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
        drain_deferred_terminals(&hub, &broker, &mut |owner, frame| {
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
