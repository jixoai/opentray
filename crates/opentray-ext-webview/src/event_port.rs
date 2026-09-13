//! D19 Extension EventPort producer side (phase 1 batch B, phase 2 batch C).
//!
//! This module is platform-neutral: both the macOS and Windows producers
//! submit through the same frozen classification tables and the same bounded
//! Edge retry queue. The classifications are normative
//! (`openspec/changes/d19-extension-event-port/plans/design-reference.md`,
//! "Normative WebView Event Class Table"; batch C adds the legacy
//! window-event family):
//!
//! | Kind / phase                | Class      | Overflow rule                    |
//! | --------------------------- | ---------- | -------------------------------- |
//! | urlChange                   | Latest     | key `<webviewId>/url`, replace   |
//! | titleChange                 | Latest     | key `<webviewId>/title`, replace |
//! | focused                     | Edge       | backpressure, producer retries   |
//! | geometryChange              | Edge       | backpressure, producer retries   |
//! | loadState started/fin/failed| Edge       | backpressure, producer retries   |
//! | loadState progress obs.     | BestEffort | drop newest, still EXT_OK        |
//!
//! Window-event family (batch C; wire shape `{ "type": <event>, ... }`):
//!
//! | Event                                    | Class      | Overflow rule                  |
//! | ---------------------------------------- | ---------- | ------------------------------ |
//! | focus / blur                             | Edge       | key-state edges, no replay     |
//! | visibleChange / closed                   | Edge       | operational lifecycle, no query|
//! | stylechange                              | Edge       | style facts, no query replay   |
//! | windowinteractionchange                  | Edge       | drag begin/end lifecycle       |
//! | downloadstarted/completed/failed/canceled| Edge       | download lifecycle             |
//! | downloadprogress                         | BestEffort | observation; terminal edge owns|
//!
//! No window-family member is `Latest`: none of them has a `(value, seq)`
//! query/resync route in this release, and the design law freezes that
//! state truth without a replay query must be Edge (a coalesced replace
//! could silently lose an operational `visibleChange(false)`).
//!
//! Discipline (B'' "one standard, four extension shapes"):
//! - Native callbacks never block on hub capacity and never wait: an Edge
//!   record that receives `EXT_ERR_BACKPRESSURE` moves into this extension's
//!   bounded retry queue and is re-submitted on the next producer callback or
//!   after the next handled command, in per-source FIFO order.
//! - `Latest` backpressure is NOT retried through the same coalesce key: a
//!   delayed older snapshot must never replace a newer pending value. The
//!   contract's `(value, seq)` query pair plus the facade gap-resync is the
//!   repair route.
//! - When no port was ever attached (legacy H0 host), `submit_frame` reports
//!   [`SubmitStatus::LegacyFlush`] and the caller keeps the declared legacy
//!   outbox/response-flush delivery; a frame is never delivered through both
//!   paths. The window-event family has no legacy fallback: the 16 ms drain
//!   queue was its only pre-port delivery and is retired with the poll
//!   (one compatibility decision, contract-3). An H0 host running a
//!   contract-3 artifact is out of the lockstep graph by manifest identity,
//!   so `submit_window_event` drops the record and the caller logs.
//! - Subscription gating stays at the producer: the per-view families gate in
//!   `ViewEvents` (batch A semantics); the window family gates on the
//!   per-window `subscribeWindowEvents`/`unsubscribeWindowEvents` protocol
//!   (batch C, same producer-gating law — no facade listener, no native
//!   observation record).
//!
//! Per-instance state (D19 final review B1): the port and the Edge retry
//! queue are NOT process globals. Every `opentray_ext_init` instance owns one
//! [`InstancePortState`]; `opentray_ext_attach_event_port_v1` fills exactly
//! that instance's state, and every producer handle (window bridge, per-view
//! event core) captures the `Arc` at creation time. A second mount/reload
//! attaches its own state and can never retarget the first instance's
//! producers: an old generation's records keep flowing to the port it
//! captured, where the hub's revoked source answers `EXT_ERR_PORT_CLOSED`
//! (the intentional death of that generation's in-flight records — the same
//! semantics the legacy outbox had when its session closed). Dropping the
//! instance box drops the last runtime-held `Arc`; producer clones in native
//! callbacks keep the state allocated but can only observe the closed port,
//! so unloading cleans the mapping without a process-wide registry.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use opentray_spec::webview::{
    WebviewEventFrame, WebviewEventKind, WebviewEventPayload, WebviewLoadPhase,
};
use opentray_spec::{
    EXT_ERR_BACKPRESSURE, EXT_ERR_PORT_CLOSED, EXT_EVENT_PORT_ABI_V1, EXT_OK, ExtBytes,
    ExtEventClassV1, ExtEventInputV1, ExtEventPortV1, ExtEventRouteV1,
};

/// Coalesce-key bound shared with the hub (the design reference freezes a
/// 128-byte tray/coalesce key). A key that cannot fit degrades to Edge — the
/// frame is still never silently dropped at the hub.
const COALESCE_KEY_MAX_BYTES: usize = 128;
/// Extension-owned bounded Edge retry depth. Backpressured Edge records wait
/// here (never blocking a native callback) and are re-submitted in order on
/// the next producer callback or after the next handled command. Overflow
/// drops the newest record with a diagnostic counter.
const EDGE_RETRY_MAX_RECORDS: usize = 64;

/// The port value is host-owned, process-lifetime, and documented safe to
/// call from any thread (`try_submit` points at broker code, never at this
/// library); copying the small value across threads is the ABI's own
/// transfer rule, so the wrapper only re-asserts what the host guarantees.
#[repr(transparent)]
struct SharedPort(ExtEventPortV1);
// Safety: `port_data` addresses host-owned process-lifetime state and
// `try_submit` is multi-producer safe by the frozen EventPort contract.
// No field of the copied value is ever dereferenced as extension memory.
unsafe impl Send for SharedPort {}

/// Process-wide diagnostic counters (never routing state): they only count
/// drops/rejections for observability, so concurrent instances may safely
/// increment the same atoms.
static RETRY_OVERFLOW_DROPS: AtomicU64 = AtomicU64::new(0);
static RETRY_CLOSED_DROPS: AtomicU64 = AtomicU64::new(0);
static REJECTED_SUBMITS: AtomicU64 = AtomicU64::new(0);

/// Per-loaded-instance EventPort state (B1): the attached port plus that
/// instance's bounded Edge retry queue. One instance per
/// `opentray_ext_init`; producers capture an `Arc` clone at creation so a
/// later attach for a different instance cannot retarget them.
pub(crate) struct InstancePortState {
    port: Mutex<Option<SharedPort>>,
    retry_queue: Mutex<Vec<EdgeRetryRecord>>,
}

impl Default for InstancePortState {
    fn default() -> Self {
        Self::new()
    }
}

impl InstancePortState {
    pub(crate) fn new() -> Self {
        Self {
            port: Mutex::new(None),
            retry_queue: Mutex::new(Vec::new()),
        }
    }

    /// Stores the immutable port value transferred by the host through the
    /// attach symbol. The host invokes this exactly once per instance after
    /// `init`; a hypothetical re-attach replaces the value and retires the
    /// queued records of the previous source (they can only have belonged to
    /// the revoked source the old port addressed).
    pub(crate) fn attach(&self, port: ExtEventPortV1) -> Result<(), String> {
        if port.abi_version != EXT_EVENT_PORT_ABI_V1 {
            return Err(format!(
                "event port abi version {} does not match {EXT_EVENT_PORT_ABI_V1}",
                port.abi_version
            ));
        }
        if port.struct_size as usize != std::mem::size_of::<ExtEventPortV1>() {
            return Err(format!(
                "event port struct size {} does not match host layout {}",
                port.struct_size,
                std::mem::size_of::<ExtEventPortV1>()
            ));
        }
        if port.port_data.is_null() {
            return Err("event port port_data is null".to_string());
        }
        let mut slot = self.port.lock().unwrap_or_else(|error| error.into_inner());
        *slot = Some(SharedPort(port));
        drop(slot);
        let mut queue = self
            .retry_queue
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        queue.clear();
        Ok(())
    }

    /// True once this instance's port has been attached (direct EventPort
    /// delivery mode for the producers that captured this state).
    pub(crate) fn has_port(&self) -> bool {
        self.port
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
    }

    fn port_snapshot(&self) -> Option<ExtEventPortV1> {
        self.port
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .map(|shared| shared.0)
    }

    /// Submits one frame through the EventPort when attached. Never blocks:
    /// the single FFI call is bounded and lock-free from the producer's view.
    pub(crate) fn submit_frame(&self, frame: &WebviewEventFrame) -> SubmitStatus {
        let Some(port) = self.port_snapshot() else {
            return SubmitStatus::LegacyFlush;
        };
        let Ok(data_json) = serde_json::to_vec(frame) else {
            REJECTED_SUBMITS.fetch_add(1, Ordering::Relaxed);
            return SubmitStatus::Rejected;
        };
        self.submit_record(&port, frame.owner.tray_id.as_str(), data_json, &classify_frame(frame))
    }

    /// Submits one legacy window-event family record (`{ "type": event, ... }`
    /// wire shape, frozen from the retired drain queue payloads) through the
    /// EventPort under the batch C classification table. The caller owns the
    /// subscription gate: an unsubscribed event must not call this.
    pub(crate) fn submit_window_event(
        &self,
        tray_id: &str,
        event: &str,
        payload: &serde_json::Value,
    ) -> SubmitStatus {
        let Some(port) = self.port_snapshot() else {
            return SubmitStatus::LegacyFlush;
        };
        let data = window_event_value(event, payload);
        let Ok(data_json) = serde_json::to_vec(&data) else {
            REJECTED_SUBMITS.fetch_add(1, Ordering::Relaxed);
            return SubmitStatus::Rejected;
        };
        self.submit_record(&port, tray_id, data_json, &classify_window_event(event))
    }

    /// Shared submit core: ordered retry flush, one classified FFI submission,
    /// Edge retry enqueueing on backpressure.
    fn submit_record(
        &self,
        port: &ExtEventPortV1,
        tray_id: &str,
        data_json: Vec<u8>,
        class: &EventPortClass,
    ) -> SubmitStatus {
        // Opportunistic ordered retry flush: older backpressured Edge records
        // ride the same wake before the newer record (per-source FIFO).
        self.flush_edge_retries();
        let status = submit_bytes(port, tray_id, &data_json, class);
        if status == SubmitStatus::Backpressured && *class == EventPortClass::Edge {
            self.enqueue_edge_retry(tray_id.to_string(), data_json);
        }
        status
    }

    /// Post-command retry flush: gives backpressured Edge records another
    /// bounded chance after every handled command without waiting in a
    /// callback.
    pub(crate) fn flush_edge_retries_after_command(&self) {
        self.flush_edge_retries();
    }

    /// Drains the retry queue in FIFO order. The whole drain holds the retry
    /// lock (B2): `try_submit` is a bounded thread-safe hub ingress, and
    /// holding the per-instance lock across the batch linearizes it — a
    /// concurrent producer cannot submit past the lock, so a new record can
    /// never overtake the retry batch at the hub. Stops at the first
    /// backpressured record (per-source linearization must not reorder);
    /// discards everything on port closure (the source is revoked; the
    /// records cannot route).
    fn flush_edge_retries(&self) {
        let mut queue = self
            .retry_queue
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if queue.is_empty() {
            return;
        }
        let Some(port) = self.port_snapshot() else {
            // Unreachable while a queue is non-empty: attach clears the queue
            // and only attach ever stores a port. Defensive no-op.
            return;
        };
        let mut index = 0;
        let mut closed_drops = 0u64;
        while index < queue.len() {
            let record = &queue[index];
            match submit_bytes(
                &port,
                &record.tray_id,
                &record.data_json,
                &EventPortClass::Edge,
            ) {
                SubmitStatus::Direct => {
                    index += 1;
                }
                SubmitStatus::Backpressured => break,
                SubmitStatus::PortClosed => {
                    // The whole queue belongs to the revoked source.
                    closed_drops = (queue.len() - index) as u64;
                    index = queue.len();
                }
                SubmitStatus::Rejected | SubmitStatus::LegacyFlush => {
                    // LegacyFlush is unreachable here (port present); a rejected
                    // retry is malformed input that can never succeed — drop it.
                    index += 1;
                }
            }
        }
        if closed_drops > 0 {
            RETRY_CLOSED_DROPS.fetch_add(closed_drops, Ordering::Relaxed);
        }
        // Retained records (the backpressured head onwards) keep their FIFO
        // positions; records enqueued concurrently with this drain blocked on
        // the lock and land strictly after it.
        queue.drain(..index);
    }

    fn enqueue_edge_retry(&self, tray_id: String, data_json: Vec<u8>) -> bool {
        let mut queue = self
            .retry_queue
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if queue.len() >= EDGE_RETRY_MAX_RECORDS {
            RETRY_OVERFLOW_DROPS.fetch_add(1, Ordering::Relaxed);
            eprintln!(
                "opentray-ext-webview event port: edge retry queue full ({}), dropping newest record",
                EDGE_RETRY_MAX_RECORDS
            );
            return false;
        }
        queue.push(EdgeRetryRecord { tray_id, data_json });
        true
    }
}

struct EdgeRetryRecord {
    tray_id: String,
    data_json: Vec<u8>,
}

/// Ingress classification for one frame, selected by the frozen table above.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EventPortClass {
    Edge,
    Latest { coalesce_key: Vec<u8> },
    BestEffort,
}

/// Outcome of one [`InstancePortState::submit_frame`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubmitStatus {
    /// Accepted by the hub (enqueued, coalesced, or a counted BestEffort
    /// drop — both return EXT_OK).
    Direct,
    /// Edge record moved into the bounded retry queue.
    Backpressured,
    /// Source revoked (session close / reload / shutdown); the record is
    /// intentionally gone, matching the legacy outbox dying with its session.
    PortClosed,
    /// Structured rejection at ingress (malformed input); counted.
    Rejected,
    /// No port was ever attached: the caller must keep the declared legacy
    /// response-flush delivery for this frame.
    LegacyFlush,
}

/// Classifies one frame per the normative table. Pure: no port, no state.
pub(crate) fn classify_frame(frame: &WebviewEventFrame) -> EventPortClass {
    match frame.kind {
        WebviewEventKind::UrlChange => latest_key(&frame.webview_id, b"/url"),
        WebviewEventKind::TitleChange => latest_key(&frame.webview_id, b"/title"),
        WebviewEventKind::Focused | WebviewEventKind::GeometryChange => EventPortClass::Edge,
        WebviewEventKind::LoadState => match &frame.payload {
            // One wire kind, two ingress classes: the phase is always an
            // Edge; a progress observation rides the `started` phase with a
            // `progress` value and is BestEffort.
            WebviewEventPayload::LoadState {
                phase: WebviewLoadPhase::Started,
                progress: Some(_),
                ..
            } => EventPortClass::BestEffort,
            _ => EventPortClass::Edge,
        },
    }
}

fn latest_key(webview_id: &str, field: &[u8]) -> EventPortClass {
    let mut key = webview_id.as_bytes().to_vec();
    key.extend_from_slice(field);
    if key.len() > COALESCE_KEY_MAX_BYTES {
        // Coalescing is not expressible for this id; degrade to Edge so the
        // record is still never silently dropped at the hub.
        EventPortClass::Edge
    } else {
        EventPortClass::Latest { coalesce_key: key }
    }
}

/// Classifies one legacy window-event family member per the frozen batch C
/// table above. Unknown names cannot come from a contract-3 facade (the
/// subscription protocol validates against the family list); a name that
/// reaches this function anyway degrades to Edge — never a silent drop.
pub(crate) fn classify_window_event(event: &str) -> EventPortClass {
    match event {
        // Progress observations are explicitly non-authoritative: the
        // terminal download edge carries the truth (mirrors the frozen
        // loadState.progress ruling).
        "downloadprogress" => EventPortClass::BestEffort,
        _ => EventPortClass::Edge,
    }
}

/// Merges the drained-event wire shape `{ "type": event, ...payload }` —
/// byte-compatible with the payloads the retired drain queue delivered, so
/// the facade `listenExtension` filter (`data.type === event`) matches
/// unchanged.
fn window_event_value(event: &str, payload: &serde_json::Value) -> serde_json::Value {
    let mut value = serde_json::json!({ "type": event });
    if let (Some(target), Some(source)) = (value.as_object_mut(), payload.as_object()) {
        for (key, payload_value) in source {
            target.insert(key.clone(), payload_value.clone());
        }
    }
    value
}

/// Pure FFI submission: no retry bookkeeping, so the flush path can call it
/// without re-entering the retry queue. Retry enqueueing is owned by
/// [`InstancePortState::submit_record`] (new producer records) and the flush
/// loop (re-drain of the same records).
fn submit_bytes(
    port: &ExtEventPortV1,
    tray_id: &str,
    data_json: &[u8],
    class: &EventPortClass,
) -> SubmitStatus {
    let class_code = match class {
        EventPortClass::Edge => ExtEventClassV1::Edge,
        EventPortClass::Latest { .. } => ExtEventClassV1::Latest,
        EventPortClass::BestEffort => ExtEventClassV1::BestEffort,
    };
    let coalesce_key_storage;
    let coalesce_key = match class {
        EventPortClass::Latest { coalesce_key } => {
            coalesce_key_storage = coalesce_key.clone();
            ExtBytes {
                ptr: coalesce_key_storage.as_ptr().cast(),
                len: coalesce_key_storage.len(),
            }
        }
        _ => ExtBytes {
            ptr: std::ptr::null(),
            len: 0,
        },
    };
    // All byte fields are borrowed only for the duration of the call; the
    // hub copies bounded bytes before returning.
    let input = ExtEventInputV1 {
        route: ExtEventRouteV1 {
            tray_id: ExtBytes {
                ptr: tray_id.as_ptr().cast(),
                len: tray_id.len(),
            },
        },
        data_json: ExtBytes {
            ptr: data_json.as_ptr().cast(),
            len: data_json.len(),
        },
        class: class_code.as_u32(),
        coalesce_key,
    };
    let code = (port.try_submit)(port.port_data, input);
    match code {
        EXT_OK => SubmitStatus::Direct,
        EXT_ERR_BACKPRESSURE => SubmitStatus::Backpressured,
        EXT_ERR_PORT_CLOSED => SubmitStatus::PortClosed,
        _ => {
            REJECTED_SUBMITS.fetch_add(1, Ordering::Relaxed);
            SubmitStatus::Rejected
        }
    }
}

#[cfg(test)]
pub(crate) mod diagnostics {
    use super::{REJECTED_SUBMITS, RETRY_CLOSED_DROPS, RETRY_OVERFLOW_DROPS};
    use std::sync::atomic::Ordering;

    pub(crate) fn retry_overflow_drops() -> u64 {
        RETRY_OVERFLOW_DROPS.load(Ordering::Relaxed)
    }

    pub(crate) fn retry_closed_drops() -> u64 {
        RETRY_CLOSED_DROPS.load(Ordering::Relaxed)
    }

    pub(crate) fn rejected_submits() -> u64 {
        REJECTED_SUBMITS.load(Ordering::Relaxed)
    }

    /// Serializes a test with this module's fixture state. State is
    /// per-instance now (B1), so this guard only protects the process-wide
    /// diagnostic counters tests assert on; sibling module tests that build
    /// bridges against a fake-attached instance state take it too so counter
    /// assertions cannot interleave.
    pub(crate) fn state_guard() -> std::sync::MutexGuard<'static, ()> {
        super::TEST_STATE_GUARD
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

/// Test-only serializer for the diagnostic counters (the same lock the
/// module's own fixtures take through `diagnostics::state_guard`).
#[cfg(test)]
static TEST_STATE_GUARD: Mutex<()> = Mutex::new(());

#[cfg(test)]
impl EventPortClass {
    fn class_code(&self) -> u32 {
        match self {
            EventPortClass::Edge => ExtEventClassV1::Edge.as_u32(),
            EventPortClass::Latest { .. } => ExtEventClassV1::Latest.as_u32(),
            EventPortClass::BestEffort => ExtEventClassV1::BestEffort.as_u32(),
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::tests::{FakePort, reset_diagnostics};
    use super::{InstancePortState, TEST_STATE_GUARD};

    /// Installs one fresh instance state with a fake port attached, for
    /// cross-module producer tests (window-bridge submit paths). The guard
    /// serializes the process-wide diagnostic counters with this module's
    /// own tests.
    pub(crate) fn install_fake_port_for_module_tests() -> ModuleTestPort {
        let guard = TEST_STATE_GUARD
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_diagnostics();
        let fake = FakePort::new();
        let state = std::sync::Arc::new(InstancePortState::new());
        state.attach(fake.port_value()).expect("valid fake port");
        ModuleTestPort {
            _guard: guard,
            state,
            fake,
        }
    }

    /// Holds one fake-attached instance state plus the serialization guard
    /// for one cross-module test; dropping it releases the guard.
    pub(crate) struct ModuleTestPort {
        _guard: std::sync::MutexGuard<'static, ()>,
        /// The per-instance EventPort state producers captured (hand this to
        /// bridge/session fixtures).
        pub(crate) state: InstancePortStateHandle,
        pub(crate) fake: FakePort,
    }

    /// Alias so sibling modules can name the handle without importing the
    /// private state type through two paths.
    pub(crate) type InstancePortStateHandle = std::sync::Arc<InstancePortState>;

    impl ModuleTestPort {
        pub(crate) fn submits(&self) -> Vec<super::tests::FakeSubmit> {
            self.fake.submits()
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use opentray_spec::ExtResultCode;
    use opentray_spec::webview::WebviewOwnerTuple;
    use std::ffi::c_void;
    use std::sync::Arc;
    use std::sync::atomic::AtomicI32;

    /// The private helper stays honest: classification round-trips into the
    /// frozen C discriminants the wire carries.
    #[test]
    fn class_discriminants_round_trip() {
        assert_eq!(
            EventPortClass::Edge.class_code(),
            ExtEventClassV1::Edge.as_u32()
        );
        assert_eq!(
            EventPortClass::Latest {
                coalesce_key: Vec::new()
            }
            .class_code(),
            ExtEventClassV1::Latest.as_u32()
        );
        assert_eq!(
            EventPortClass::BestEffort.class_code(),
            ExtEventClassV1::BestEffort.as_u32()
        );
    }

    /// Tests share the diagnostic-counter statics; serialized through the
    /// module-level `TEST_STATE_GUARD`.
    fn lock_state() -> std::sync::MutexGuard<'static, ()> {
        super::diagnostics::state_guard()
    }

    pub(super) fn reset_diagnostics() {
        RETRY_OVERFLOW_DROPS.store(0, Ordering::Relaxed);
        RETRY_CLOSED_DROPS.store(0, Ordering::Relaxed);
        REJECTED_SUBMITS.store(0, Ordering::Relaxed);
    }

    // -- fake port -----------------------------------------------------------

    /// Per-port hub fake (B1): `port_data` addresses this recorder, exactly
    /// like the real hub's per-source port data, so two instances attaching
    /// two fakes get two isolated submit logs.
    pub(crate) struct FakePort {
        inner: Arc<FakePortInner>,
    }

    struct FakePortInner {
        submits: Mutex<Vec<FakeSubmit>>,
        script: Mutex<std::collections::VecDeque<ExtResultCode>>,
        default_result: AtomicI32,
    }

    impl FakePort {
        pub(crate) fn new() -> Self {
            Self {
                inner: Arc::new(FakePortInner {
                    submits: Mutex::new(Vec::new()),
                    script: Mutex::new(std::collections::VecDeque::new()),
                    default_result: AtomicI32::new(EXT_OK),
                }),
            }
        }

        pub(crate) fn port_value(&self) -> ExtEventPortV1 {
            ExtEventPortV1 {
                abi_version: EXT_EVENT_PORT_ABI_V1,
                struct_size: std::mem::size_of::<ExtEventPortV1>() as u32,
                // `Arc::as_ptr` is stable while the Arc lives; the fixture
                // outlives every submit through the port value it handed out.
                port_data: (Arc::as_ptr(&self.inner) as *mut u8).cast::<c_void>(),
                try_submit: fake_try_submit,
            }
        }

        pub(crate) fn set_result(&self, code: ExtResultCode) {
            self.inner
                .default_result
                .store(code, Ordering::Relaxed);
        }

        pub(crate) fn script(&self, codes: impl IntoIterator<Item = ExtResultCode>) {
            self.inner
                .script
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .extend(codes);
        }

        pub(crate) fn submits(&self) -> Vec<FakeSubmit> {
            self.inner
                .submits
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        }
    }

    extern "C" fn fake_try_submit(data: *mut c_void, input: ExtEventInputV1) -> ExtResultCode {
        // Copy everything under the call: the input is borrowed only for the
        // duration of try_submit, exactly like the real hub ingress.
        let inner = unsafe { &*data.cast::<FakePortInner>() };
        let tray = read_bytes(input.route.tray_id);
        let payload = read_bytes(input.data_json);
        let key = if input.coalesce_key.ptr.is_null() {
            None
        } else {
            Some(read_bytes(input.coalesce_key))
        };
        let tray_id = String::from_utf8(tray).expect("utf-8 tray");
        let value: serde_json::Value = serde_json::from_slice(&payload).expect("json payload");
        inner
            .submits
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(FakeSubmit {
                tray_id,
                // Unified frames carry `kind`; window-family records carry the
                // drained-event wire tag under `type`.
                payload_tag: value["kind"]
                    .as_str()
                    .or_else(|| value["type"].as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                seq: value["seq"].as_u64().unwrap_or_default(),
                class: input.class,
                coalesce_key: key,
            });
        let scripted = inner
            .script
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pop_front();
        scripted.unwrap_or_else(|| inner.default_result.load(Ordering::Relaxed))
    }

    fn read_bytes(bytes: ExtBytes) -> Vec<u8> {
        assert!(!bytes.ptr.is_null(), "non-null ExtBytes pointer");
        unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) }.to_vec()
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct FakeSubmit {
        pub(crate) tray_id: String,
        /// Wire `type` tag of the submitted record.
        pub(crate) payload_tag: String,
        pub(crate) seq: u64,
        pub(crate) class: u32,
        pub(crate) coalesce_key: Option<Vec<u8>>,
    }

    fn attached_state(fake: &FakePort) -> InstancePortState {
        let state = InstancePortState::new();
        state.attach(fake.port_value()).expect("valid fake port");
        state
    }

    fn retry_queue_len(state: &InstancePortState) -> usize {
        state
            .retry_queue
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    // -- fixtures ------------------------------------------------------------

    fn owner_tuple() -> WebviewOwnerTuple {
        WebviewOwnerTuple {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
        }
    }

    fn url_frame(webview_id: &str, seq: u64) -> WebviewEventFrame {
        WebviewEventFrame::new_url_change(owner_tuple(), "win", webview_id, seq, "https://a.test/1")
    }

    fn title_frame(webview_id: &str, seq: u64) -> WebviewEventFrame {
        WebviewEventFrame::new_title_change(owner_tuple(), "win", webview_id, seq, "Title")
    }

    fn focused_frame(webview_id: &str, seq: u64) -> WebviewEventFrame {
        WebviewEventFrame::new_focused(owner_tuple(), "win", webview_id, seq, true)
    }

    fn geometry_frame(webview_id: &str, seq: u64) -> WebviewEventFrame {
        WebviewEventFrame::new_geometry_change(owner_tuple(), "win", webview_id, seq, None)
    }

    fn load_frame(webview_id: &str, seq: u64, progress: Option<f64>) -> WebviewEventFrame {
        WebviewEventFrame::new_load_state(
            owner_tuple(),
            "win",
            webview_id,
            seq,
            WebviewLoadPhase::Started,
            "https://a.test/1",
            None,
            progress,
        )
    }

    fn failed_frame(webview_id: &str, seq: u64) -> WebviewEventFrame {
        WebviewEventFrame::new_load_state(
            owner_tuple(),
            "win",
            webview_id,
            seq,
            WebviewLoadPhase::Failed,
            "https://a.test/1",
            Some(-1003),
            None,
        )
    }

    // -- classification table --------------------------------------------------

    #[test]
    fn classification_table_follows_the_frozen_normative_table() {
        assert_eq!(
            classify_frame(&url_frame("content", 1)),
            EventPortClass::Latest {
                coalesce_key: b"content/url".to_vec()
            }
        );
        assert_eq!(
            classify_frame(&title_frame("content", 1)),
            EventPortClass::Latest {
                coalesce_key: b"content/title".to_vec()
            }
        );
        assert_eq!(
            classify_frame(&focused_frame("content", 1)),
            EventPortClass::Edge
        );
        assert_eq!(
            classify_frame(&geometry_frame("content", 1)),
            EventPortClass::Edge
        );
        // loadState phases are Edge; only a progress observation is BestEffort.
        assert_eq!(
            classify_frame(&load_frame("content", 1, None)),
            EventPortClass::Edge
        );
        assert_eq!(
            classify_frame(&load_frame("content", 1, Some(0.4))),
            EventPortClass::BestEffort
        );
        assert_eq!(
            classify_frame(&failed_frame("content", 1)),
            EventPortClass::Edge
        );
    }

    #[test]
    fn oversized_coalesce_key_degrades_to_edge() {
        let long_id = "v".repeat(COALESCE_KEY_MAX_BYTES);
        assert_eq!(
            classify_frame(&url_frame(&long_id, 1)),
            EventPortClass::Edge,
            "an id that cannot form a bounded key must not fabricate Latest"
        );
        // The largest expressible id still coalesces.
        let fitting_id = "v".repeat(COALESCE_KEY_MAX_BYTES - "/url".len());
        assert!(matches!(
            classify_frame(&url_frame(&fitting_id, 1)),
            EventPortClass::Latest { .. }
        ));
    }

    // -- window-event family (batch C) -----------------------------------

    #[test]
    fn window_family_classification_is_edge_except_download_progress() {
        for event in [
            "focus",
            "blur",
            "visibleChange",
            "closed",
            "stylechange",
            "windowinteractionchange",
            "downloadstarted",
            "downloadcompleted",
            "downloadfailed",
            "downloadcanceled",
        ] {
            assert_eq!(
                classify_window_event(event),
                EventPortClass::Edge,
                "{event} has no query/resync route and must never coalesce or drop"
            );
        }
        assert_eq!(
            classify_window_event("downloadprogress"),
            EventPortClass::BestEffort
        );
        // An unknown name degrades to Edge, never a silent drop.
        assert_eq!(classify_window_event("anythingelse"), EventPortClass::Edge);
    }

    #[test]
    fn window_event_submissions_keep_the_drained_wire_shape() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_OK);

        assert_eq!(
            state.submit_window_event(
                "tray-1",
                "visibleChange",
                &serde_json::json!({ "visible": false })
            ),
            SubmitStatus::Direct
        );
        assert_eq!(
            state.submit_window_event("tray-1", "focus", &serde_json::json!({})),
            SubmitStatus::Direct
        );
        assert_eq!(
            state.submit_window_event(
                "tray-1",
                "downloadprogress",
                &serde_json::json!({ "receivedBytes": 10, "totalBytes": 100 })
            ),
            SubmitStatus::Direct
        );

        let submits = fake.submits();
        assert_eq!(submits.len(), 3);
        assert!(submits.iter().all(|submit| submit.tray_id == "tray-1"));
        // Wire tags are exactly the drained-event names, so the facade's
        // `data.type === event` listener filter matches unchanged.
        assert_eq!(
            submits.iter().map(|s| s.payload_tag.as_str()).collect::<Vec<_>>(),
            vec!["visibleChange", "focus", "downloadprogress"]
        );
        assert_eq!(submits[0].class, ExtEventClassV1::Edge.as_u32());
        assert_eq!(submits[1].class, ExtEventClassV1::Edge.as_u32());
        assert_eq!(submits[2].class, ExtEventClassV1::BestEffort.as_u32());
        assert!(submits.iter().all(|submit| submit.coalesce_key.is_none()));
    }

    #[test]
    fn window_event_edge_backpressure_retries_like_the_five_families() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_ERR_BACKPRESSURE);

        assert_eq!(
            state.submit_window_event("tray-1", "focus", &serde_json::json!({})),
            SubmitStatus::Backpressured
        );
        assert_eq!(retry_queue_len(&state), 1, "window-family Edge records retry too");

        fake.set_result(EXT_OK);
        assert_eq!(
            state.submit_window_event("tray-1", "blur", &serde_json::json!({})),
            SubmitStatus::Direct
        );
        let submits = fake.submits();
        let tail = &submits[submits.len() - 2..];
        assert_eq!(
            (tail[0].payload_tag.as_str(), tail[1].payload_tag.as_str()),
            ("focus", "blur"),
            "the queued focus edge is retried before the newer blur record"
        );
        assert_eq!(retry_queue_len(&state), 0);
    }

    #[test]
    fn window_event_without_a_port_reports_legacy_flush() {
        let _state = lock_state();
        reset_diagnostics();
        let state = InstancePortState::new();
        assert_eq!(
            state.submit_window_event("tray-1", "focus", &serde_json::json!({})),
            SubmitStatus::LegacyFlush
        );
        assert_eq!(retry_queue_len(&state), 0);
    }

    // -- attach ----------------------------------------------------------------

    #[test]
    fn attach_validates_the_nested_port_and_stores_the_value() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = InstancePortState::new();
        assert!(!state.has_port());

        let mut bad = fake.port_value();
        bad.abi_version = EXT_EVENT_PORT_ABI_V1 + 1;
        assert!(state.attach(bad).is_err());

        let mut bad = fake.port_value();
        bad.struct_size = 0;
        assert!(state.attach(bad).is_err());

        let mut bad = fake.port_value();
        bad.port_data = std::ptr::null_mut();
        assert!(state.attach(bad).is_err());

        assert!(!state.has_port(), "rejected ports are never stored");
        state.attach(fake.port_value()).expect("valid port");
        assert!(state.has_port());
    }

    // -- per-instance isolation (B1) --------------------------------------

    #[test]
    fn dual_instances_route_producers_to_their_own_ports() {
        let _state = lock_state();
        reset_diagnostics();
        let fake_a = FakePort::new();
        let state_a = attached_state(&fake_a);
        let fake_b = FakePort::new();
        let state_b = attached_state(&fake_b);

        // Producer of instance A submits through A's captured state: only
        // A's hub source sees the record — B's attach never retargeted it.
        assert_eq!(
            state_a.submit_window_event("tray-a", "focus", &serde_json::json!({})),
            SubmitStatus::Direct
        );
        assert_eq!(fake_a.submits().len(), 1);
        assert_eq!(fake_a.submits()[0].tray_id, "tray-a");
        assert!(fake_b.submits().is_empty(), "instance B's source saw nothing");

        assert_eq!(
            state_b.submit_window_event("tray-b", "blur", &serde_json::json!({})),
            SubmitStatus::Direct
        );
        let b_submits = fake_b.submits();
        assert_eq!(b_submits.len(), 1);
        assert_eq!(b_submits[0].tray_id, "tray-b");
        assert_eq!(fake_a.submits().len(), 1, "instance A's source is unchanged");
    }

    #[test]
    fn old_generation_records_never_reach_the_new_source() {
        let _state = lock_state();
        reset_diagnostics();
        // Instance A attaches a port whose hub source will be revoked (reload).
        let fake_a = FakePort::new();
        let state_a = attached_state(&fake_a);
        fake_a.set_result(EXT_ERR_BACKPRESSURE);
        assert_eq!(
            state_a.submit_window_event("tray-a", "focus", &serde_json::json!({})),
            SubmitStatus::Backpressured
        );
        assert_eq!(retry_queue_len(&state_a), 1);

        // The reload mounts instance B and attaches B's port. A's producers
        // still hold A's state.
        let fake_b = FakePort::new();
        let state_b = attached_state(&fake_b);
        fake_b.set_result(EXT_OK);

        // A's source answers PORT_CLOSED now; A's queued record must die in
        // A's flush — never leak into B's source.
        fake_a.set_result(EXT_ERR_PORT_CLOSED);
        state_a.flush_edge_retries_after_command();
        assert_eq!(retry_queue_len(&state_a), 0);
        assert!(
            fake_b.submits().is_empty(),
            "the old generation's records never reach the new source"
        );
        assert_eq!(diagnostics::retry_closed_drops(), 1);

        // And a live producer of A still routes to A's (closed) port only.
        assert_eq!(
            state_a.submit_window_event("tray-a", "closed", &serde_json::json!({})),
            SubmitStatus::PortClosed
        );
        assert!(fake_b.submits().is_empty());

        // B keeps working on its own source.
        assert_eq!(
            state_b.submit_window_event("tray-b", "focus", &serde_json::json!({})),
            SubmitStatus::Direct
        );
        assert_eq!(fake_b.submits().len(), 1);
    }

    #[test]
    fn retry_queues_are_per_instance() {
        let _state = lock_state();
        reset_diagnostics();
        let fake_a = FakePort::new();
        let state_a = attached_state(&fake_a);
        let fake_b = FakePort::new();
        let state_b = attached_state(&fake_b);

        fake_a.set_result(EXT_ERR_BACKPRESSURE);
        assert_eq!(
            state_a.submit_window_event("tray-a", "focus", &serde_json::json!({})),
            SubmitStatus::Backpressured
        );
        fake_b.set_result(EXT_ERR_BACKPRESSURE);
        assert_eq!(
            state_b.submit_window_event("tray-b", "focus", &serde_json::json!({})),
            SubmitStatus::Backpressured
        );
        assert_eq!(retry_queue_len(&state_a), 1);
        assert_eq!(retry_queue_len(&state_b), 1);

        // A recovers alone: only A's record is replayed; B's queue stays.
        fake_a.set_result(EXT_OK);
        state_a.flush_edge_retries_after_command();
        assert_eq!(retry_queue_len(&state_a), 0);
        assert_eq!(retry_queue_len(&state_b), 1);
        let a_submits = fake_a.submits();
        // Two attempts on A's port: the seeding submit plus the flush replay.
        assert_eq!(a_submits.len(), 2);
        assert!(a_submits.iter().all(|submit| submit.tray_id == "tray-a"));
        assert!(fake_b.submits().iter().all(|submit| submit.tray_id == "tray-b"));
    }

    // -- submit routing ----------------------------------------------------------

    #[test]
    fn submit_without_a_port_reports_legacy_flush() {
        let _state = lock_state();
        reset_diagnostics();
        let state = InstancePortState::new();
        assert_eq!(
            state.submit_frame(&url_frame("content", 1)),
            SubmitStatus::LegacyFlush
        );
        assert_eq!(retry_queue_len(&state), 0);
    }

    #[test]
    fn latest_submits_carry_the_coalesce_key_and_edge_records_do_not() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_OK);

        assert_eq!(state.submit_frame(&url_frame("content", 1)), SubmitStatus::Direct);
        assert_eq!(
            state.submit_frame(&focused_frame("content", 2)),
            SubmitStatus::Direct
        );
        assert_eq!(
            state.submit_frame(&load_frame("content", 3, Some(0.5))),
            SubmitStatus::Direct
        );

        let submits = fake.submits();
        assert_eq!(submits.len(), 3);
        // All frames route under the frame's own tray id.
        assert!(submits.iter().all(|submit| submit.tray_id == "tray-1"));
        assert_eq!(submits[0].class, ExtEventClassV1::Latest.as_u32());
        assert_eq!(
            submits[0].coalesce_key.as_deref(),
            Some(&b"content/url"[..])
        );
        assert_eq!(submits[1].class, ExtEventClassV1::Edge.as_u32());
        assert_eq!(submits[1].coalesce_key, None);
        assert_eq!(submits[2].class, ExtEventClassV1::BestEffort.as_u32());
        assert_eq!(submits[2].coalesce_key, None);
        // The serialized payload is the frozen frame JSON.
        assert_eq!(submits[0].payload_tag, "urlChange");
        assert_eq!(diagnostics::rejected_submits(), 0);
    }

    #[test]
    fn edge_backpressure_queues_for_ordered_retry_and_latest_does_not() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_ERR_BACKPRESSURE);

        assert_eq!(
            state.submit_frame(&focused_frame("content", 1)),
            SubmitStatus::Backpressured
        );
        assert_eq!(
            retry_queue_len(&state),
            1,
            "Edge record waits in the bounded retry queue"
        );
        // Latest backpressure must NOT be retried: a delayed older snapshot
        // could otherwise replace a newer pending value under the same key.
        assert_eq!(
            state.submit_frame(&url_frame("content", 2)),
            SubmitStatus::Backpressured
        );
        assert_eq!(
            retry_queue_len(&state),
            1,
            "Latest records never enter the retry queue"
        );
        // BestEffort backpressure (not producible by the real hub) is simply
        // not retried either.
        assert_eq!(
            state.submit_frame(&load_frame("content", 3, Some(0.5))),
            SubmitStatus::Backpressured
        );
        assert_eq!(retry_queue_len(&state), 1);

        // Recovery: the next callback flushes the queued Edge record first
        // (per-source FIFO), then submits the new record.
        fake.set_result(EXT_OK);
        assert_eq!(
            state.submit_frame(&focused_frame("content", 4)),
            SubmitStatus::Direct
        );
        let submits = fake.submits();
        // Every earlier call also re-attempted the queued record (constant
        // backpressure); what matters for FIFO law is the final two entries:
        // the older queued record right before the newer callback record.
        let tail = &submits[submits.len() - 2..];
        assert_eq!(tail[0].class, ExtEventClassV1::Edge.as_u32());
        assert_eq!(tail[1].class, ExtEventClassV1::Edge.as_u32());
        assert_eq!(
            (tail[0].seq, tail[1].seq),
            (1, 4),
            "the older queued record is retried before the newer callback record"
        );
        assert_eq!(retry_queue_len(&state), 0);
    }

    #[test]
    fn retry_flush_stops_at_backpressure_keeping_fifo_order() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=3 {
            assert_eq!(
                state.submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        assert_eq!(retry_queue_len(&state), 3);

        // Script: the first retry succeeds, the second backpressures. The
        // flush must stop there — record 3 and the newest callback record
        // must not jump ahead of the still-queued record 2.
        fake.script([EXT_OK, EXT_ERR_BACKPRESSURE]);
        fake.set_result(EXT_ERR_BACKPRESSURE);
        assert_eq!(
            state.submit_frame(&focused_frame("content", 4)),
            SubmitStatus::Backpressured
        );
        let submits = fake.submits();
        // Attempt trace under constant backpressure: submit 1 attempts 1;
        // submit 2's flush re-attempts 1, then 2; submit 3's flush
        // re-attempts 1, then 3. Record 4's flush runs under the scripted
        // results — queued 1 ok, queued 2 backpressure (stops the flush) —
        // then record 4 itself backpressures and joins the retry tail.
        assert_eq!(
            submits.iter().map(|submit| submit.seq).collect::<Vec<_>>(),
            vec![1, 1, 2, 1, 3, 1, 2, 4]
        );
        assert_eq!(
            retry_queue_len(&state),
            3,
            "records 2, 3 stay queued in order; the backpressured record 4 joins the tail"
        );

        // Full recovery drains 2, 3, 4 in FIFO order before anything new.
        fake.set_result(EXT_OK);
        state.flush_edge_retries_after_command();
        assert_eq!(retry_queue_len(&state), 0);
        let submits = fake.submits();
        assert_eq!(
            submits.iter().map(|submit| submit.seq).collect::<Vec<_>>(),
            vec![1, 1, 2, 1, 3, 1, 2, 4, 2, 3, 4],
            "retries replay 2 then 3 then 4 after the earlier attempts"
        );
    }

    #[test]
    fn port_closure_discards_the_retry_queue() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=2 {
            assert_eq!(
                state.submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        fake.set_result(EXT_ERR_PORT_CLOSED);
        assert_eq!(
            state.submit_frame(&focused_frame("content", 3)),
            SubmitStatus::PortClosed
        );
        assert_eq!(retry_queue_len(&state), 0, "closure clears the whole queue");
        assert_eq!(diagnostics::retry_closed_drops(), 2);
    }

    #[test]
    fn retry_queue_is_bounded_and_counts_overflow() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = attached_state(&fake);
        fake.set_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=(EDGE_RETRY_MAX_RECORDS as u64 + 2) {
            assert_eq!(
                state.submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        assert_eq!(retry_queue_len(&state), EDGE_RETRY_MAX_RECORDS);
        assert_eq!(diagnostics::retry_overflow_drops(), 2);
    }

    // -- concurrent linearization (B2) ------------------------------------

    #[test]
    fn concurrent_producers_cannot_overtake_the_retry_batch() {
        let _state = lock_state();
        reset_diagnostics();
        let fake = FakePort::new();
        let state = Arc::new(attached_state(&fake));

        // Seed the retry queue with a backpressured batch, in order.
        fake.set_result(EXT_ERR_BACKPRESSURE);
        const SEEDED: u64 = 8;
        for seq in 1..=SEEDED {
            assert_eq!(
                state.submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        assert_eq!(retry_queue_len(&state), SEEDED as usize);

        // Recovery: everything the hub sees from now on succeeds. Threads
        // interleave fresh producer submissions and post-command flushes; a
        // fresh record must never reach the hub before the seeded retry
        // batch, and the batch must keep its relative order (per-source FIFO
        // linearization, B2).
        fake.set_result(EXT_OK);
        const THREADS: u64 = 8;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(THREADS as usize));
        let mut handles = Vec::new();
        for worker in 0..THREADS {
            let state = Arc::clone(&state);
            let barrier = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for round in 0..4u64 {
                    if worker % 2 == 0 {
                        // Fresh producer record (Edge; flush-first routing).
                        let frame =
                            focused_frame("content", 100 + worker * 10 + round);
                        let _ = state.submit_frame(&frame);
                    } else {
                        // Post-command flush of the same instance.
                        state.flush_edge_retries_after_command();
                    }
                }
            }));
        }
        for handle in handles {
            handle.join().expect("worker thread");
        }
        assert_eq!(retry_queue_len(&state), 0, "recovery drained the queue");

        let submits = fake.submits();
        // Seeding under constant backpressure re-attempts earlier queued
        // records on every seed submit (the documented single-producer
        // trace); what the linearization law demands is that the recovery
        // drain replays the whole batch exactly once, in order, as the last
        // seeded subsequence the hub observed.
        let seeded_filter: Vec<u64> = submits
            .iter()
            .filter(|submit| submit.seq <= SEEDED)
            .map(|submit| submit.seq)
            .collect();
        assert!(seeded_filter.len() >= SEEDED as usize);
        let drain: Vec<u64> = (1..=SEEDED).collect();
        assert_eq!(
            &seeded_filter[seeded_filter.len() - SEEDED as usize..],
            drain.as_slice(),
            "the recovery drain replays the retry batch in seeded order"
        );
        // Every fresh record observed strictly after the whole seeded batch.
        let last_seeded_position = submits
            .iter()
            .rposition(|submit| submit.seq <= SEEDED)
            .expect("seeded records were submitted");
        let fresh_positions: Vec<usize> = submits
            .iter()
            .enumerate()
            .filter(|(_, submit)| submit.seq > SEEDED)
            .map(|(position, _)| position)
            .collect();
        assert!(!fresh_positions.is_empty(), "fresh records were submitted");
        assert!(
            fresh_positions.iter().all(|position| *position > last_seeded_position),
            "a concurrent fresh record overtook the retry batch: {:?}",
            submits.iter().map(|submit| submit.seq).collect::<Vec<_>>()
        );
        // Every fresh record reached the hub exactly once (direct accept).
        assert_eq!(fresh_positions.len(), 16);
    }
}
