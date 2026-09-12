//! D19 Extension EventPort producer side (phase 1, batch B).
//!
//! This module is platform-neutral: both the macOS and Windows producers
//! submit through the same frozen classification table and the same bounded
//! Edge retry queue. The classification is normative
//! (`openspec/changes/d19-extension-event-port/plans/design-reference.md`,
//! "Normative WebView Event Class Table"):
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
//!   paths.
//! - Subscription gating stays in `ViewEvents` (the hub has no subscription
//!   concept; batch A semantics gate at the producer).

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

static EVENT_PORT: Mutex<Option<SharedPort>> = Mutex::new(None);
static EDGE_RETRY_QUEUE: Mutex<Vec<EdgeRetryRecord>> = Mutex::new(Vec::new());
static RETRY_OVERFLOW_DROPS: AtomicU64 = AtomicU64::new(0);
static RETRY_CLOSED_DROPS: AtomicU64 = AtomicU64::new(0);
static REJECTED_SUBMITS: AtomicU64 = AtomicU64::new(0);

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

/// Outcome of one [`submit_frame`] call.
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

/// Stores the immutable port value transferred by the optional attach
/// symbol. Each successful load attaches the current generation's port; the
/// stored value always addresses the newest source, so stale producers after
/// a reload observe the previous generation's revoked state only through a
/// port value they captured earlier — this process-wide view is the live one.
pub(crate) fn attach_port(port: ExtEventPortV1) -> Result<(), String> {
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
    let mut slot = EVENT_PORT.lock().unwrap_or_else(|error| error.into_inner());
    *slot = Some(SharedPort(port));
    Ok(())
}

/// True once a port has been attached (direct EventPort delivery mode).
pub(crate) fn port_attached() -> bool {
    EVENT_PORT
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .is_some()
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

/// Submits one frame through the EventPort when attached. Never blocks: the
/// single FFI call is bounded and lock-free from the producer's view.
pub(crate) fn submit_frame(frame: &WebviewEventFrame) -> SubmitStatus {
    let Some(port) = current_port() else {
        return SubmitStatus::LegacyFlush;
    };
    // Opportunistic ordered retry flush: older backpressured Edge records
    // ride the same wake before the newer record (per-source FIFO).
    flush_edge_retries(&port);
    let Ok(data_json) = serde_json::to_vec(frame) else {
        REJECTED_SUBMITS.fetch_add(1, Ordering::Relaxed);
        return SubmitStatus::Rejected;
    };
    let class = classify_frame(frame);
    let status = submit_bytes(&port, frame.owner.tray_id.as_str(), &data_json, &class);
    if status == SubmitStatus::Backpressured && class == EventPortClass::Edge {
        enqueue_edge_retry(frame.owner.tray_id.clone(), data_json);
    }
    status
}

/// Post-command retry flush: gives backpressured Edge records another
/// bounded chance after every handled command without waiting in a callback.
pub(crate) fn flush_edge_retries_after_command() {
    if let Some(port) = current_port() {
        flush_edge_retries(&port);
    }
}

fn current_port() -> Option<ExtEventPortV1> {
    EVENT_PORT
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .map(|shared| shared.0)
}

/// Pure FFI submission: no retry bookkeeping, so the flush path can call it
/// without re-entering the retry queue. Retry enqueueing is owned by
/// [`submit_frame`] (new producer records) and [`flush_edge_retries`]
/// (reinsertion of the same records).
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

fn enqueue_edge_retry(tray_id: String, data_json: Vec<u8>) -> bool {
    let mut queue = EDGE_RETRY_QUEUE
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

/// Drains the retry queue in FIFO order. Stops at the first backpressured
/// record (per-source linearization must not reorder), discards everything on
/// port closure (the source is revoked; the records cannot route), and keeps
/// the queue bounded when records arrived while flushing.
fn flush_edge_retries(port: &ExtEventPortV1) {
    let mut batch: Vec<EdgeRetryRecord> = {
        let mut queue = EDGE_RETRY_QUEUE
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        std::mem::take(&mut *queue)
    };
    if batch.is_empty() {
        return;
    }
    let mut index = 0;
    let mut closed_drops = 0u64;
    while index < batch.len() {
        let record = &batch[index];
        match submit_bytes(
            port,
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
                closed_drops = (batch.len() - index) as u64;
                index = batch.len();
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
    let remaining = batch.len() - index;
    if remaining > 0 {
        let mut queue = EDGE_RETRY_QUEUE
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // Final order is [remaining retried records (older), records that a
        // concurrent producer enqueued while flushing (newer)]; overflow
        // drops the newest tail against the bounded cap.
        let mut combined: Vec<EdgeRetryRecord> = batch.drain(index..).collect();
        combined.extend(queue.drain(..));
        if combined.len() > EDGE_RETRY_MAX_RECORDS {
            RETRY_OVERFLOW_DROPS.fetch_add(
                (combined.len() - EDGE_RETRY_MAX_RECORDS) as u64,
                Ordering::Relaxed,
            );
            combined.truncate(EDGE_RETRY_MAX_RECORDS);
        }
        *queue = combined;
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
}

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
mod tests {
    use super::*;
    use opentray_spec::ExtResultCode;
    use opentray_spec::webview::WebviewOwnerTuple;
    use std::ffi::c_void;

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

    /// Tests share process-wide statics; this guard serializes them.
    static GUARD: Mutex<()> = Mutex::new(());

    fn lock_state() -> std::sync::MutexGuard<'static, ()> {
        GUARD.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn reset_state() {
        *EVENT_PORT.lock().unwrap_or_else(|error| error.into_inner()) = None;
        EDGE_RETRY_QUEUE
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        RETRY_OVERFLOW_DROPS.store(0, Ordering::Relaxed);
        RETRY_CLOSED_DROPS.store(0, Ordering::Relaxed);
        REJECTED_SUBMITS.store(0, Ordering::Relaxed);
    }

    fn retry_queue_len() -> usize {
        EDGE_RETRY_QUEUE
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    // -- fake port -----------------------------------------------------------

    static FAKE_RESULT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(EXT_OK);
    static FAKE_SCRIPT: Mutex<std::collections::VecDeque<ExtResultCode>> =
        Mutex::new(std::collections::VecDeque::new());
    static FAKE_SUBMITS: Mutex<Vec<FakeSubmit>> = Mutex::new(Vec::new());

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct FakeSubmit {
        tray_id: String,
        payload_tag: String,
        seq: u64,
        class: u32,
        coalesce_key: Option<Vec<u8>>,
    }

    extern "C" fn fake_try_submit(_data: *mut c_void, input: ExtEventInputV1) -> ExtResultCode {
        // Copy everything under the call: the input is borrowed only for the
        // duration of try_submit, exactly like the real hub ingress.
        let tray = read_bytes(input.route.tray_id);
        let payload = read_bytes(input.data_json);
        let key = if input.coalesce_key.ptr.is_null() {
            None
        } else {
            Some(read_bytes(input.coalesce_key))
        };
        let tray_id = String::from_utf8(tray).expect("utf-8 tray");
        let value: serde_json::Value = serde_json::from_slice(&payload).expect("json payload");
        FAKE_SUBMITS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(FakeSubmit {
                tray_id,
                payload_tag: value["kind"].as_str().unwrap_or("unknown").to_string(),
                seq: value["seq"].as_u64().unwrap_or_default(),
                class: input.class,
                coalesce_key: key,
            });
        let scripted = FAKE_SCRIPT
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pop_front();
        scripted.unwrap_or_else(|| FAKE_RESULT.load(Ordering::Relaxed))
    }

    fn read_bytes(bytes: ExtBytes) -> Vec<u8> {
        assert!(!bytes.ptr.is_null(), "non-null ExtBytes pointer");
        unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) }.to_vec()
    }

    fn fake_port() -> ExtEventPortV1 {
        ExtEventPortV1 {
            abi_version: EXT_EVENT_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtEventPortV1>() as u32,
            port_data: std::ptr::NonNull::<u8>::dangling()
                .as_ptr()
                .cast::<c_void>(),
            try_submit: fake_try_submit,
        }
    }

    fn install_fake_port() {
        attach_port(fake_port()).expect("valid fake port");
        FAKE_SUBMITS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    fn fake_submits() -> Vec<FakeSubmit> {
        FAKE_SUBMITS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn set_fake_result(code: ExtResultCode) {
        FAKE_RESULT.store(code, Ordering::Relaxed);
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

    // -- attach ----------------------------------------------------------------

    #[test]
    fn attach_validates_the_nested_port_and_stores_the_value() {
        let _state = lock_state();
        reset_state();
        assert!(!port_attached());

        let mut bad = fake_port();
        bad.abi_version = EXT_EVENT_PORT_ABI_V1 + 1;
        assert!(attach_port(bad).is_err());

        let mut bad = fake_port();
        bad.struct_size = 0;
        assert!(attach_port(bad).is_err());

        let mut bad = fake_port();
        bad.port_data = std::ptr::null_mut();
        assert!(attach_port(bad).is_err());

        assert!(!port_attached(), "rejected ports are never stored");
        attach_port(fake_port()).expect("valid port");
        assert!(port_attached());
        reset_state();
    }

    // -- submit routing ----------------------------------------------------------

    #[test]
    fn submit_without_a_port_reports_legacy_flush() {
        let _state = lock_state();
        reset_state();
        assert_eq!(
            submit_frame(&url_frame("content", 1)),
            SubmitStatus::LegacyFlush
        );
        assert_eq!(retry_queue_len(), 0);
    }

    #[test]
    fn latest_submits_carry_the_coalesce_key_and_edge_records_do_not() {
        let _state = lock_state();
        reset_state();
        install_fake_port();
        set_fake_result(EXT_OK);

        assert_eq!(submit_frame(&url_frame("content", 1)), SubmitStatus::Direct);
        assert_eq!(
            submit_frame(&focused_frame("content", 2)),
            SubmitStatus::Direct
        );
        assert_eq!(
            submit_frame(&load_frame("content", 3, Some(0.5))),
            SubmitStatus::Direct
        );

        let submits = fake_submits();
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
        reset_state();
    }

    #[test]
    fn edge_backpressure_queues_for_ordered_retry_and_latest_does_not() {
        let _state = lock_state();
        reset_state();
        install_fake_port();
        set_fake_result(EXT_ERR_BACKPRESSURE);

        assert_eq!(
            submit_frame(&focused_frame("content", 1)),
            SubmitStatus::Backpressured
        );
        assert_eq!(
            retry_queue_len(),
            1,
            "Edge record waits in the bounded retry queue"
        );
        // Latest backpressure must NOT be retried: a delayed older snapshot
        // could otherwise replace a newer pending value under the same key.
        assert_eq!(
            submit_frame(&url_frame("content", 2)),
            SubmitStatus::Backpressured
        );
        assert_eq!(
            retry_queue_len(),
            1,
            "Latest records never enter the retry queue"
        );
        // BestEffort backpressure (not producible by the real hub) is simply
        // not retried either.
        assert_eq!(
            submit_frame(&load_frame("content", 3, Some(0.5))),
            SubmitStatus::Backpressured
        );
        assert_eq!(retry_queue_len(), 1);

        // Recovery: the next callback flushes the queued Edge record first
        // (per-source FIFO), then submits the new record.
        set_fake_result(EXT_OK);
        assert_eq!(
            submit_frame(&focused_frame("content", 4)),
            SubmitStatus::Direct
        );
        let submits = fake_submits();
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
        assert_eq!(retry_queue_len(), 0);
        reset_state();
    }

    #[test]
    fn retry_flush_stops_at_backpressure_keeping_fifo_order() {
        let _state = lock_state();
        reset_state();
        install_fake_port();
        set_fake_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=3 {
            assert_eq!(
                submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        assert_eq!(retry_queue_len(), 3);

        // Script: the first retry succeeds, the second backpressures. The
        // flush must stop there — record 3 and the newest callback record
        // must not jump ahead of the still-queued record 2.
        FAKE_SCRIPT
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .extend([EXT_OK, EXT_ERR_BACKPRESSURE]);
        set_fake_result(EXT_ERR_BACKPRESSURE);
        assert_eq!(
            submit_frame(&focused_frame("content", 4)),
            SubmitStatus::Backpressured
        );
        let submits = fake_submits();
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
            retry_queue_len(),
            3,
            "records 2, 3 stay queued in order; the backpressured record 4 joins the tail"
        );

        // Full recovery drains 2, 3, 4 in FIFO order before anything new.
        set_fake_result(EXT_OK);
        flush_edge_retries_after_command();
        assert_eq!(retry_queue_len(), 0);
        let submits = fake_submits();
        assert_eq!(
            submits.iter().map(|submit| submit.seq).collect::<Vec<_>>(),
            vec![1, 1, 2, 1, 3, 1, 2, 4, 2, 3, 4],
            "retries replay 2 then 3 then 4 after the earlier attempts"
        );
        reset_state();
    }

    #[test]
    fn port_closure_discards_the_retry_queue() {
        let _state = lock_state();
        reset_state();
        install_fake_port();
        set_fake_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=2 {
            assert_eq!(
                submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        set_fake_result(EXT_ERR_PORT_CLOSED);
        assert_eq!(
            submit_frame(&focused_frame("content", 3)),
            SubmitStatus::PortClosed
        );
        assert_eq!(retry_queue_len(), 0, "closure clears the whole queue");
        assert_eq!(diagnostics::retry_closed_drops(), 2);
        reset_state();
    }

    #[test]
    fn retry_queue_is_bounded_and_counts_overflow() {
        let _state = lock_state();
        reset_state();
        install_fake_port();
        set_fake_result(EXT_ERR_BACKPRESSURE);
        for seq in 1..=(EDGE_RETRY_MAX_RECORDS as u64 + 2) {
            assert_eq!(
                submit_frame(&focused_frame("content", seq)),
                SubmitStatus::Backpressured
            );
        }
        assert_eq!(retry_queue_len(), EDGE_RETRY_MAX_RECORDS);
        assert_eq!(diagnostics::retry_overflow_drops(), 2);
        reset_state();
    }
}
