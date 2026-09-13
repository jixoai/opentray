// D19 Extension EventPort hub (phase 1, B'').
//
// Law: every asynchronous ext -> host event enters through one bounded,
// source-bound ingress. The hub keys each source by host facts
// {generation, owner_session_id, app_id, instance_name}; a submitted record
// carries only a tray route and extension-defined JSON data. Ingress never
// calls into an extension, never enters core, never touches a writer lock, a
// socket, or an OS GUI handle, and never blocks. The only synchronization is
// one short per-source queue gate plus lock-free global accounting.
//
// Phase 1 has no retain/release and no detach: port backing state
// (`SourceState`) is owned by the process-lifetime ingress registry and is
// deliberately never reclaimed, even after revoke. A stale producer thread
// from a dropped or reloaded extension therefore always reaches live memory
// and observes REVOKED, returning EXT_ERR_PORT_CLOSED before any payload
// byte is read. The `EVENT_HUB_MAX_SOURCES` cap bounds those retained
// generations.
//
// Wake-failure law (D19 final review): a submit is never accepted while the
// hub has no active delivery path. When the owner-loop wake fails, ingress
// rejects new submits with EXT_ERR_PORT_CLOSED (undeliverable); records
// accepted before the failure are handled by the next drain through any
// path or by shutdown revocation. The hub never returns "accepted" against
// a delivery path it knows is dead.

use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::sync::atomic::{
    AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering, Ordering::Relaxed,
};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use opentray_spec::{
    AppId, ExtBytes, ExtEventClassV1, ExtEventInputV1, ExtEventPortV1, ExtResultCode, SessionId,
    EXT_ERR_BACKPRESSURE, EXT_ERR_PORT_CLOSED, EXT_ERR_REJECTED, EXT_EVENT_PORT_ABI_V1, EXT_OK,
};

// ---------------------------------------------------------------------------
// Compile-time budgets (design-reference "Crate Ownership and Compile-Time
// Budgets" table, adopted value for value). These are release constants, not
// tuning knobs: changing one is a code/spec review because it changes memory,
// fairness, and drop behavior.
// ---------------------------------------------------------------------------

/// Bounds one extension's callback burst while allowing normal navigation
/// and focus churn.
pub(crate) const EVENT_SOURCE_MAX_RECORDS: usize = 128;
/// Caps retained JSON memory per loaded source.
pub(crate) const EVENT_SOURCE_MAX_BYTES: usize = 256 * 1024;
/// Leaves room for multiple ext-* sources without unbounded process growth.
pub(crate) const EVENT_HUB_MAX_RECORDS: usize = 1024;
/// Caps aggregate ingress memory independently of record count.
pub(crate) const EVENT_HUB_MAX_BYTES: usize = 2 * 1024 * 1024;
/// Bounds permanently retained phase-1 source generations (revoked states
/// are not reclaimed).
pub(crate) const EVENT_HUB_MAX_SOURCES: usize = 4096;
/// Keeps one broker-loop wake bounded so tray/UI work stays responsive.
pub(crate) const EVENT_DRAIN_MAX_RECORDS: usize = 64;
/// Pairs with the record quantum to bound JSON routing work per wake.
pub(crate) const EVENT_DRAIN_MAX_BYTES: usize = 128 * 1024;
/// Rejects pathological one-event payloads while covering ordinary envelopes.
pub(crate) const EVENT_DATA_MAX_BYTES: usize = 64 * 1024;
/// Makes Latest-key memory and comparison bounded. Tray ids share this
/// bound (the design freezes "128-byte tray/coalesce key").
pub(crate) const EVENT_COALESCE_KEY_MAX_BYTES: usize = 128;

const PHASE_PENDING: u8 = 0;
const PHASE_OPEN: u8 = 1;
const PHASE_REVOKED: u8 = 2;

/// Host facts identifying one loaded extension source. An extension can
/// never supply or override any field; submitted records carry only a tray
/// route and data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceKey {
    pub(crate) generation: u64,
    pub(crate) owner_session_id: SessionId,
    pub(crate) app_id: AppId,
    pub(crate) instance_name: String,
}

/// One record handed to the owner loop, with its host-bound source identity.
#[derive(Debug, Clone)]
pub(crate) struct DrainedRecord {
    pub(crate) key: SourceKey,
    pub(crate) tray_id: String,
    /// Raw JSON bytes copied at ingress and validated there; parsed again
    /// only when the routed `ext-event` frame is constructed.
    pub(crate) data_json: Vec<u8>,
}

/// Outcome of one submit, shared by the C `try_submit` ingress and the
/// command-time `send_event` ingress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubmitOutcome {
    Enqueued,
    Coalesced,
    Backpressure,
    Closed,
    Invalid,
    DroppedBestEffort,
}

impl SubmitOutcome {
    fn result_code(self) -> ExtResultCode {
        match self {
            SubmitOutcome::Enqueued
            | SubmitOutcome::Coalesced
            | SubmitOutcome::DroppedBestEffort => EXT_OK,
            SubmitOutcome::Backpressure => EXT_ERR_BACKPRESSURE,
            SubmitOutcome::Closed => EXT_ERR_PORT_CLOSED,
            SubmitOutcome::Invalid => EXT_ERR_REJECTED,
        }
    }
}

/// Platform wake adapter owned by the broker composition layer. macOS and
/// Windows send a Winit `UserEvent::ExtensionEventsReady` through the event
/// loop proxy; Linux sends a broker event through the blocking mpsc receive
/// loop. This is a host adapter, never a C ABI difference: no extension
/// surface may expose AppKit, Win32, CFRunLoop, eventfd, or broker internals.
pub(crate) trait RuntimeWake: Send + Sync {
    /// Requests one owner-loop drain. Returns `false` when the wake could
    /// not be delivered (owner loop gone); the hub then marks ingress
    /// unavailable instead of spinning, and subsequent submits reject with
    /// `EXT_ERR_PORT_CLOSED` (undeliverable) until any drain runs again.
    fn wake(&self) -> bool;
}

/// The single extern "C" ingress transferred with every port. Points at
/// broker code, so dropping the extension library can never invalidate it.
pub(crate) extern "C" fn try_submit(
    port_data: *mut c_void,
    input: ExtEventInputV1,
) -> ExtResultCode {
    if port_data.is_null() {
        return EXT_ERR_PORT_CLOSED;
    }
    // Safety: port_data addresses a process-lifetime SourceState that the
    // ingress registry never frees in phase 1 (see module law above).
    let state = unsafe { &*(port_data.cast::<SourceState>()) };
    state.submit_ffi(input).result_code()
}

/// Shared ingress interior reachable from both the owner-loop registry
/// (`HubInner`) and every process-lifetime `SourceState` (so the raw-FFI
/// path can account, mark ready, and wake without a back-pointer cycle).
struct HubShared {
    wake: Box<dyn RuntimeWake + Send + Sync>,
    /// Coalesced wake bit: set when a drain has been requested and not yet
    /// consumed by `begin_drain`.
    wake_pending: AtomicBool,
    /// Set after a failed wake: the owner-loop delivery path is unavailable.
    /// Submits then reject as PORT_CLOSED (undeliverable — the hub must not
    /// accept records with no active delivery path) until any drain clears
    /// the marker; records accepted before the failure are handled by that
    /// drain or by shutdown revocation.
    wake_failed: AtomicBool,
    global_records: AtomicUsize,
    global_bytes: AtomicUsize,
    /// FIFO round-robin list of slots with (possibly) drainable records.
    ready: Mutex<VecDeque<u32>>,
    metrics: HubMetricsCounters,
}

/// Owner-loop and loader handle around the process-lifetime ingress
/// registry. Cheap to clone; cloning never duplicates queue state.
#[derive(Clone)]
pub(crate) struct EventHub {
    inner: Arc<HubInner>,
}

impl std::fmt::Debug for EventHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EventHub").finish_non_exhaustive()
    }
}

struct HubInner {
    shared: Arc<HubShared>,
    generation: AtomicU64,
    /// Process-lifetime source registry. Slots are append-only; revoked
    /// states stay addressable so stale producers read REVOKED, never freed
    /// memory.
    sources: Mutex<SourceTable>,
}

struct SourceTable {
    slots: Vec<Arc<SourceState>>,
    /// Reserved generations, never decremented in phase 1.
    reserved: usize,
    /// Latest slot per (app, instance); a reload moves the mapping to the
    /// fresh generation.
    current: HashMap<(AppId, String), u32>,
}

struct SourceState {
    shared: Arc<HubShared>,
    slot: u32,
    generation: u64,
    app_id: AppId,
    instance_name: String,
    /// Host fact filled at `note_loaded_and_open`; None while PENDING.
    owner: Mutex<Option<SessionId>>,
    /// PENDING -> OPEN -> REVOKED. Stores use Release, loads use Acquire.
    phase: AtomicU8,
    /// The short ingress/revoke gate. Held for bounded validate/copy/enqueue
    /// work only, and always released before `mark_ready` so the queue and
    /// ready locks are never nested.
    queue: Mutex<SourceQueue>,
    /// True while the slot is present in the shared ready deque.
    in_ready: AtomicBool,
}

struct SourceQueue {
    records: VecDeque<QueuedRecord>,
    /// coalesce key -> seq of the one pending Latest record for that key.
    latest: HashMap<Vec<u8>, u64>,
    next_seq: u64,
    /// Accounted retained bytes (tray id + data JSON + coalesce key).
    bytes: usize,
}

struct QueuedRecord {
    seq: u64,
    coalesce_key: Option<Vec<u8>>,
    tray_id: String,
    data_json: Vec<u8>,
    accounted: usize,
    enqueued_at: Instant,
}

impl QueuedRecord {
    fn accounted_parts(tray_id: &str, data_json: &[u8], key: Option<&[u8]>) -> usize {
        tray_id.len() + data_json.len() + key.map(|key| key.len()).unwrap_or(0)
    }
}

struct PreparedRecord {
    class: ExtEventClassV1,
    tray_id: String,
    coalesce_key: Option<Vec<u8>>,
    data_json: Vec<u8>,
}

impl PreparedRecord {
    fn accounted(&self) -> usize {
        QueuedRecord::accounted_parts(&self.tray_id, &self.data_json, self.coalesce_key.as_deref())
    }
}

/// Loader-owned handle to one reserved source. Dropping it does not free the
/// backing state (process-lifetime by law); `revoke` is the only transition.
pub(crate) struct SourceHandle {
    inner: Arc<HubInner>,
    state: Arc<SourceState>,
}

impl std::fmt::Debug for SourceHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SourceHandle")
            .field("key", &self.key())
            .finish_non_exhaustive()
    }
}

impl SourceHandle {
    /// The immutable port value handed to the extension through the attach
    /// symbol. `port_data` addresses state the registry keeps for the whole
    /// broker process.
    pub(crate) fn port(&self) -> ExtEventPortV1 {
        ExtEventPortV1 {
            abi_version: EXT_EVENT_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtEventPortV1>() as u32,
            port_data: Arc::as_ptr(&self.state) as *mut c_void,
            try_submit,
        }
    }

    pub(crate) fn key(&self) -> SourceKey {
        SourceKey {
            generation: self.state.generation,
            owner_session_id: self
                .state
                .owner
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
                .unwrap_or_default(),
            app_id: self.state.app_id.clone(),
            instance_name: self.state.instance_name.clone(),
        }
    }

    /// Revoke this source (idempotent). The lifecycle law requires this to
    /// run before instance `deinit`, library drop, and session cleanup.
    pub(crate) fn revoke(&self) -> bool {
        self.inner.revoke_state(&self.state)
    }

    /// Command-time `send_event` ingress: submits one Edge-class,
    /// source-bound record from already-parsed host-side data. Scheduled by
    /// the loops at the existing post-response barrier.
    pub(crate) fn submit_push(&self, tray_id: &str, data: &serde_json::Value) -> SubmitOutcome {
        let Ok(data_json) = serde_json::to_vec(data) else {
            return SubmitOutcome::Invalid;
        };
        if data_json.len() > EVENT_DATA_MAX_BYTES {
            return SubmitOutcome::Invalid;
        }
        let state = &self.state;
        let mut queue = state.queue.lock().unwrap_or_else(|e| e.into_inner());
        if state.phase.load(Ordering::Acquire) == PHASE_REVOKED {
            drop(queue);
            state
                .shared
                .metrics
                .port_closed_submits
                .fetch_add(1, Relaxed);
            return SubmitOutcome::Closed;
        }
        if state.shared.wake_failed.load(Ordering::Acquire) {
            // Undeliverable (same law as the FFI ingress): the wake failed,
            // so accepting this push would strand it without a path.
            drop(queue);
            return SubmitOutcome::Closed;
        }
        let prepared = PreparedRecord {
            class: ExtEventClassV1::Edge,
            tray_id: tray_id.to_string(),
            coalesce_key: None,
            data_json,
        };
        let outcome = state.shared.enqueue_locked(&mut queue, prepared);
        drop(queue);
        state.shared.after_enqueue(state, outcome);
        outcome
    }
}

impl EventHub {
    pub(crate) fn new(wake: Box<dyn RuntimeWake + Send + Sync>) -> Self {
        Self {
            inner: Arc::new(HubInner {
                shared: Arc::new(HubShared {
                    wake,
                    wake_pending: AtomicBool::new(false),
                    wake_failed: AtomicBool::new(false),
                    global_records: AtomicUsize::new(0),
                    global_bytes: AtomicUsize::new(0),
                    ready: Mutex::new(VecDeque::new()),
                    metrics: HubMetricsCounters::default(),
                }),
                generation: AtomicU64::new(0),
                sources: Mutex::new(SourceTable {
                    slots: Vec::new(),
                    reserved: 0,
                    current: HashMap::new(),
                }),
            }),
        }
    }

    /// Reserves one PENDING source slot for a loading extension instance.
    /// Fails with a structured source-limit rejection before any port is
    /// constructed or attached.
    pub(crate) fn reserve_source(
        &self,
        app_id: AppId,
        instance_name: String,
    ) -> Result<SourceHandle, SourceLimitReached> {
        self.inner.reserve_source(app_id, instance_name)
    }

    /// Resolves the current source handle for one loaded instance, used by
    /// the command-time `send_event` ingress to bind pushes to host facts.
    pub(crate) fn current_source(&self, app_id: &str, instance: &str) -> Option<SourceHandle> {
        self.inner.current_source(app_id, instance)
    }

    /// LoadExt-ACK transition: records the owner session (host fact) and
    /// opens the PENDING source for delivery. Only a successful ACK may call
    /// this; a failed load must `revoke` instead.
    pub(crate) fn note_loaded_and_open(
        &self,
        app_id: &str,
        instance: &str,
        owner_session_id: &str,
    ) -> bool {
        self.inner
            .note_loaded_and_open(app_id, instance, owner_session_id)
    }

    /// Revokes every source owned by a closing client session. Must run
    /// before core `session_closed` cleanup so cleanup pushes observe
    /// `PORT_CLOSED` instead of queueing across the close.
    pub(crate) fn revoke_session(&self, session_id: &str) -> usize {
        self.inner.revoke_session(session_id)
    }

    /// Broker-shutdown transition: revoke all sources and discard queued
    /// records. There is no flush promise on shutdown.
    pub(crate) fn revoke_all(&self) -> usize {
        self.inner.revoke_all()
    }

    /// Owner-loop drain: takes records round-robin across ready sources in
    /// one bounded quantum (records OR bytes, whichever first). PENDING
    /// records never escape; revoked/empty slots are skipped. Only the
    /// broker owner loop may call this.
    pub(crate) fn drain_round_robin(
        &self,
        max_records: usize,
        max_bytes: usize,
    ) -> Vec<DrainedRecord> {
        let shared = &self.inner.shared;
        shared.begin_drain();
        let mut drained = Vec::new();
        let mut drained_bytes = 0usize;
        'outer: loop {
            if drained.len() >= max_records || drained_bytes >= max_bytes {
                break;
            }
            let mut progressed = false;
            let rotation = {
                let ready = shared.ready.lock().unwrap_or_else(|e| e.into_inner());
                ready.len()
            };
            for _ in 0..rotation {
                let maybe_slot = shared
                    .ready
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .pop_front();
                let Some(slot) = maybe_slot else {
                    break;
                };
                let Some(state) = self.inner.lookup(slot) else {
                    continue;
                };
                if let Some((record, accounted)) = shared.take_one(&state) {
                    drained_bytes += accounted;
                    drained.push(record);
                    progressed = true;
                    if drained.len() >= max_records || drained_bytes >= max_bytes {
                        break 'outer;
                    }
                }
            }
            if !progressed {
                break;
            }
        }
        drained
    }

    /// Re-arms the wake when drainable work remains (budget-exhausted
    /// drains must continue until empty; PENDING-only work does not wake).
    pub(crate) fn rewake_if_ready(&self) {
        self.inner
            .shared
            .rewake_if_ready(&|slot| self.inner.lookup(slot))
    }

    /// Records the delivery capability the loader observed for one load, so
    /// diagnostics can distinguish direct EventPort delivery from legacy
    /// response flushing.
    pub(crate) fn note_capability(&self, direct: bool) {
        let metrics = &self.inner.shared.metrics;
        if direct {
            metrics.direct_sources.fetch_add(1, Relaxed);
        } else {
            metrics.legacy_sources.fetch_add(1, Relaxed);
        }
    }

    /// Counts one drain-time drop whose route was revoked, stale, or not
    /// owned by the source session (source-tagged diagnostic).
    pub(crate) fn note_stale_drop(&self) {
        self.inner
            .shared
            .metrics
            .dropped_stale
            .fetch_add(1, Relaxed);
    }

    pub(crate) fn metrics(&self) -> HubMetricsSnapshot {
        self.inner.shared.metrics.snapshot(&self.inner.shared)
    }

    /// Shutdown diagnostic line for broker.log: capability mix, retained
    /// generation pressure, and wake health. Reading these fields here is
    /// also what keeps the counters honest parts of the release surface.
    pub(crate) fn log_shutdown_diagnostics(&self) {
        let metrics = self.metrics();
        eprintln!(
            "opentray event hub shutdown: direct_sources={} legacy_sources={} drained={} coalesced={} backpressured={} best_effort_dropped={} dropped_stale={} discarded_on_revoke={} high_water_records={} high_water_bytes={} drain_latency_max_ns={} wake_calls={} wake_failures={} source_limit_rejects={} global_records={} global_bytes={}",
            metrics.direct_sources,
            metrics.legacy_sources,
            metrics.drained,
            metrics.coalesced,
            metrics.backpressured,
            metrics.best_effort_dropped,
            metrics.dropped_stale,
            metrics.discarded_on_revoke,
            metrics.high_water_records,
            metrics.high_water_bytes,
            metrics.drain_latency_max_ns,
            metrics.wake_calls,
            metrics.wake_failures,
            metrics.source_limit_rejects,
            metrics.global_records,
            metrics.global_bytes,
        );
    }
}

/// Structured rejection used before any port is handed out: the phase-1
/// retained-generation budget is exhausted and the broker must be replaced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceLimitReached;

impl HubInner {
    fn reserve_source(
        self: &Arc<Self>,
        app_id: AppId,
        instance_name: String,
    ) -> Result<SourceHandle, SourceLimitReached> {
        let mut table = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        if table.reserved >= EVENT_HUB_MAX_SOURCES {
            drop(table);
            self.shared
                .metrics
                .source_limit_rejects
                .fetch_add(1, Relaxed);
            return Err(SourceLimitReached);
        }
        let slot = table.slots.len() as u32;
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let state = Arc::new(SourceState {
            shared: self.shared.clone(),
            slot,
            generation,
            app_id: app_id.clone(),
            instance_name: instance_name.clone(),
            owner: Mutex::new(None),
            phase: AtomicU8::new(PHASE_PENDING),
            queue: Mutex::new(SourceQueue {
                records: VecDeque::new(),
                latest: HashMap::new(),
                next_seq: 0,
                bytes: 0,
            }),
            in_ready: AtomicBool::new(false),
        });
        table.slots.push(state.clone());
        table.reserved += 1;
        table.current.insert((app_id, instance_name), slot);
        Ok(SourceHandle {
            inner: Arc::clone(self),
            state,
        })
    }

    fn current_source(self: &Arc<Self>, app_id: &str, instance: &str) -> Option<SourceHandle> {
        let table = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        let slot = *table
            .current
            .get(&(app_id.to_string(), instance.to_string()))?;
        let state = table.slots.get(slot as usize)?.clone();
        Some(SourceHandle {
            inner: Arc::clone(self),
            state,
        })
    }

    fn note_loaded_and_open(
        self: &Arc<Self>,
        app_id: &str,
        instance: &str,
        owner_session_id: &str,
    ) -> bool {
        let Some(state) = self
            .current_source(app_id, instance)
            .map(|handle| handle.state)
        else {
            return false;
        };
        *state.owner.lock().unwrap_or_else(|e| e.into_inner()) = Some(owner_session_id.to_string());
        match state.phase.compare_exchange(
            PHASE_PENDING,
            PHASE_OPEN,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                // Records may have queued while PENDING; deliver them now.
                state.shared.request_drain_once();
                true
            }
            Err(_) => false,
        }
    }

    fn revoke_session(&self, session_id: &str) -> usize {
        let states = {
            let table = self.sources.lock().unwrap_or_else(|e| e.into_inner());
            table.slots.clone()
        };
        let mut revoked = 0;
        for state in &states {
            let owned = state
                .owner
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_deref()
                == Some(session_id);
            if owned && self.revoke_state(state) {
                revoked += 1;
            }
        }
        revoked
    }

    fn revoke_all(&self) -> usize {
        let states = {
            let table = self.sources.lock().unwrap_or_else(|e| e.into_inner());
            table.slots.clone()
        };
        states
            .iter()
            .filter(|state| self.revoke_state(state))
            .count()
    }

    /// Revokes one source under the queue gate: the linearization point
    /// either precedes an in-flight submit (which then completes its bounded
    /// copy/enqueue before this discard) or follows it (the record is
    /// discarded here). Idempotent.
    fn revoke_state(&self, state: &Arc<SourceState>) -> bool {
        let mut queue = state.queue.lock().unwrap_or_else(|e| e.into_inner());
        if state.phase.swap(PHASE_REVOKED, Ordering::AcqRel) == PHASE_REVOKED {
            return false;
        }
        let discarded = queue.records.len();
        let bytes = queue.bytes;
        queue.records.clear();
        queue.latest.clear();
        queue.bytes = 0;
        drop(queue);
        let shared = &state.shared;
        shared.global_records.fetch_sub(discarded, Ordering::AcqRel);
        shared.global_bytes.fetch_sub(bytes, Ordering::AcqRel);
        shared
            .metrics
            .discarded_on_revoke
            .fetch_add(discarded as u64, Relaxed);
        state.in_ready.store(false, Ordering::Release);
        true
    }

    fn lookup(&self, slot: u32) -> Option<Arc<SourceState>> {
        let table = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        table.slots.get(slot as usize).cloned()
    }
}

impl HubShared {
    fn mark_ready(&self, state: &SourceState) {
        if !state.in_ready.swap(true, Ordering::AcqRel) {
            self.ready
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push_back(state.slot);
        }
    }

    /// Pops at most one record from a ready source. PENDING sources stay
    /// ready (their records are private until the LoadExt ACK); revoked and
    /// empty sources leave the ready list.
    fn take_one(&self, state: &Arc<SourceState>) -> Option<(DrainedRecord, usize)> {
        // The caller popped this slot from the ready deque; take ownership of
        // the in_ready bit so a later re-mark actually re-queues the slot.
        state.in_ready.store(false, Ordering::Release);
        let phase = state.phase.load(Ordering::Acquire);
        if phase == PHASE_REVOKED {
            state.in_ready.store(false, Ordering::Release);
            return None;
        }
        let mut queue = state.queue.lock().unwrap_or_else(|e| e.into_inner());
        if queue.records.is_empty() {
            state.in_ready.store(false, Ordering::Release);
            return None;
        }
        if phase == PHASE_PENDING {
            drop(queue);
            self.mark_ready(state);
            return None;
        }
        let record = queue.records.pop_front().expect("checked non-empty");
        queue.bytes -= record.accounted;
        if let Some(key) = &record.coalesce_key {
            if queue.latest.get(key) == Some(&record.seq) {
                queue.latest.remove(key);
            }
        }
        let still_drainable = !queue.records.is_empty();
        drop(queue);
        if still_drainable {
            self.mark_ready(state);
        } else {
            state.in_ready.store(false, Ordering::Release);
        }
        self.global_records.fetch_sub(1, Ordering::AcqRel);
        self.global_bytes
            .fetch_sub(record.accounted, Ordering::AcqRel);
        self.metrics.drained.fetch_add(1, Relaxed);
        let latency = record.enqueued_at.elapsed().as_nanos() as u64;
        self.metrics
            .drain_latency_max_ns
            .fetch_max(latency, Relaxed);
        let owner = state
            .owner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let Some(owner_session_id) = owner else {
            // OPEN with no owner is impossible by construction; treat any
            // observation as a stale drop rather than forging an owner.
            self.metrics.dropped_stale.fetch_add(1, Relaxed);
            return None;
        };
        Some((
            DrainedRecord {
                key: SourceKey {
                    generation: state.generation,
                    owner_session_id,
                    app_id: state.app_id.clone(),
                    instance_name: state.instance_name.clone(),
                },
                tray_id: record.tray_id,
                data_json: record.data_json,
            },
            record.accounted,
        ))
    }

    fn begin_drain(&self) {
        // Clearing the pending bit before draining means records submitted
        // during the drain re-arm the wake themselves; nothing strands.
        self.wake_pending.store(false, Ordering::Release);
        self.wake_failed.store(false, Ordering::Release);
    }

    fn request_drain_once(&self) {
        if self.wake_failed.load(Ordering::Acquire) {
            // Delivery path unavailable: new submits already reject as
            // PORT_CLOSED at admission; accepted records wait for the next
            // drain through any path or shutdown revocation.
            return;
        }
        if !self.wake_pending.swap(true, Ordering::AcqRel) {
            if self.wake.wake() {
                self.metrics.wake_calls.fetch_add(1, Relaxed);
            } else {
                // Owner loop gone: keep wake_pending set (no spin), record
                // the failure, and mark ingress unavailable so no further
                // submit is accepted without an active delivery path.
                // Records accepted before this point are handled by the
                // next drain (any path) or shutdown revocation.
                self.wake_failed.store(true, Ordering::Release);
                self.metrics.wake_failures.fetch_add(1, Relaxed);
            }
        }
    }

    fn rewake_if_ready(&self, lookup: &dyn Fn(u32) -> Option<Arc<SourceState>>) {
        let slots: Vec<u32> = {
            let ready = self.ready.lock().unwrap_or_else(|e| e.into_inner());
            ready.iter().copied().collect()
        };
        for slot in slots {
            let Some(state) = lookup(slot) else {
                continue;
            };
            if state.phase.load(Ordering::Acquire) != PHASE_OPEN {
                continue;
            }
            let has_records = {
                let queue = state.queue.lock().unwrap_or_else(|e| e.into_inner());
                !queue.records.is_empty()
            };
            if has_records {
                self.request_drain_once();
                return;
            }
        }
    }

    fn after_enqueue(&self, state: &SourceState, outcome: SubmitOutcome) {
        match outcome {
            SubmitOutcome::Enqueued | SubmitOutcome::Coalesced => {
                self.mark_ready(state);
                self.request_drain_once();
            }
            SubmitOutcome::Backpressure
            | SubmitOutcome::Closed
            | SubmitOutcome::Invalid
            | SubmitOutcome::DroppedBestEffort => {}
        }
    }

    /// Capacity accounting and enqueue under the caller-held queue gate.
    fn enqueue_locked(&self, queue: &mut SourceQueue, prepared: PreparedRecord) -> SubmitOutcome {
        let accounted = prepared.accounted();
        let source_full = |queue: &SourceQueue, accounted: usize| {
            queue.records.len() >= EVENT_SOURCE_MAX_RECORDS
                || queue.bytes + accounted > EVENT_SOURCE_MAX_BYTES
        };

        // Latest replacement path: keep the pending position, re-account
        // both per-source and global bytes for the new payload. The hub
        // never evicts another key to make room.
        if prepared.class == ExtEventClassV1::Latest {
            if let Some(key) = prepared.coalesce_key.as_ref() {
                if let Some(&pending_seq) = queue.latest.get(key) {
                    let index = queue
                        .records
                        .iter()
                        .position(|record| record.seq == pending_seq)
                        .expect("latest map tracks a queued record");
                    let old_accounted = queue.records[index].accounted;
                    let delta = accounted as isize - old_accounted as isize;
                    if queue.bytes as isize + delta > EVENT_SOURCE_MAX_BYTES as isize {
                        self.metrics.backpressured.fetch_add(1, Relaxed);
                        return SubmitOutcome::Backpressure;
                    }
                    if delta > 0 && !self.reserve_global_bytes(delta as usize) {
                        self.metrics.backpressured.fetch_add(1, Relaxed);
                        return SubmitOutcome::Backpressure;
                    }
                    if delta < 0 {
                        self.global_bytes
                            .fetch_sub((-delta) as usize, Ordering::AcqRel);
                    }
                    let seq = queue.records[index].seq;
                    queue.records[index] = QueuedRecord {
                        seq,
                        coalesce_key: prepared.coalesce_key.clone(),
                        tray_id: prepared.tray_id,
                        data_json: prepared.data_json,
                        accounted,
                        enqueued_at: Instant::now(),
                    };
                    queue.bytes = (queue.bytes as isize + delta) as usize;
                    self.metrics.coalesced.fetch_add(1, Relaxed);
                    self.metrics.submitted.fetch_add(1, Relaxed);
                    self.record_high_water();
                    return SubmitOutcome::Coalesced;
                }
            }
        }

        let full_new_record = source_full(queue, accounted);
        match prepared.class {
            ExtEventClassV1::BestEffort => {
                if full_new_record || !self.reserve_global(accounted) {
                    // Drop newest with a metric and report success so a lossy
                    // producer cannot turn backpressure into a hot loop.
                    self.metrics.best_effort_dropped.fetch_add(1, Relaxed);
                    return SubmitOutcome::DroppedBestEffort;
                }
            }
            ExtEventClassV1::Edge | ExtEventClassV1::Latest => {
                if full_new_record || !self.reserve_global(accounted) {
                    self.metrics.backpressured.fetch_add(1, Relaxed);
                    return SubmitOutcome::Backpressure;
                }
            }
        }

        let seq = queue.next_seq;
        queue.next_seq += 1;
        if let Some(key) = prepared.coalesce_key.clone() {
            queue.latest.insert(key, seq);
        }
        queue.bytes += accounted;
        queue.records.push_back(QueuedRecord {
            seq,
            coalesce_key: prepared.coalesce_key,
            tray_id: prepared.tray_id,
            data_json: prepared.data_json,
            accounted,
            enqueued_at: Instant::now(),
        });
        self.metrics.submitted.fetch_add(1, Relaxed);
        self.record_high_water();
        SubmitOutcome::Enqueued
    }

    /// Reserves one record plus its bytes against the broker-global caps,
    /// rolling back on overflow so concurrent producers cannot overshoot.
    fn reserve_global(&self, bytes: usize) -> bool {
        let records = self.global_records.fetch_add(1, Ordering::AcqRel);
        if records + 1 > EVENT_HUB_MAX_RECORDS {
            self.global_records.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        let current = self.global_bytes.fetch_add(bytes, Ordering::AcqRel);
        if current + bytes > EVENT_HUB_MAX_BYTES {
            self.global_bytes.fetch_sub(bytes, Ordering::AcqRel);
            self.global_records.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        true
    }

    /// Byte-only reservation for a Latest replacement (record count is
    /// unchanged; a smaller replacement is refunded by the caller).
    fn reserve_global_bytes(&self, bytes: usize) -> bool {
        let current = self.global_bytes.fetch_add(bytes, Ordering::AcqRel);
        if current + bytes > EVENT_HUB_MAX_BYTES {
            self.global_bytes.fetch_sub(bytes, Ordering::AcqRel);
            return false;
        }
        true
    }

    fn record_high_water(&self) {
        self.metrics
            .high_water_records
            .fetch_max(self.global_records.load(Ordering::Acquire) as u64, Relaxed);
        self.metrics
            .high_water_bytes
            .fetch_max(self.global_bytes.load(Ordering::Acquire) as u64, Relaxed);
    }
}

impl SourceState {
    /// The C ingress gate. REVOKED returns PORT_CLOSED before any payload
    /// byte is read; a failed wake (no active delivery path) rejects the
    /// same way at admission, so the hub never accepts a record it cannot
    /// deliver. Admitted submits complete their bounded copy and queue
    /// mutation before a concurrent revoke's linearization point (both take
    /// the queue gate).
    fn submit_ffi(&self, input: ExtEventInputV1) -> SubmitOutcome {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if self.phase.load(Ordering::Acquire) == PHASE_REVOKED {
            // Do not dereference input after revoke.
            drop(queue);
            self.shared
                .metrics
                .port_closed_submits
                .fetch_add(1, Relaxed);
            return SubmitOutcome::Closed;
        }
        if self.shared.wake_failed.load(Ordering::Acquire) {
            // Undeliverable: the owner-loop wake failed, so there is no
            // active delivery path. Reject without reading the payload.
            drop(queue);
            self.shared
                .metrics
                .port_closed_submits
                .fetch_add(1, Relaxed);
            return SubmitOutcome::Closed;
        }
        let Some(prepared) = validate_and_copy_bounded(input) else {
            drop(queue);
            self.shared.metrics.invalid_input.fetch_add(1, Relaxed);
            return SubmitOutcome::Invalid;
        };
        let outcome = self.shared.enqueue_locked(&mut queue, prepared);
        drop(queue);
        self.shared.after_enqueue(self, outcome);
        outcome
    }
}

/// Validates and copies one bounded FFI record. Reads foreign memory only
/// after the caller confirmed the source is not revoked, and only after each
/// byte field's length passes its frozen upper bound: an oversized or
/// null-with-length borrow is rejected without ever forming the raw slice.
/// All rejections are structured input errors (`EXT_ERR_REJECTED` at the ABI
/// boundary).
fn validate_and_copy_bounded(input: ExtEventInputV1) -> Option<PreparedRecord> {
    let class = ExtEventClassV1::from_u32(input.class)?;

    let tray_bytes = borrowed_bytes_bounded(input.route.tray_id, EVENT_COALESCE_KEY_MAX_BYTES)?;
    if tray_bytes.is_empty() {
        return None;
    }
    let tray_id = std::str::from_utf8(tray_bytes).ok()?.to_string();

    let data_bytes = borrowed_bytes_bounded(input.data_json, EVENT_DATA_MAX_BYTES)?;
    // Ingress validation: the payload must be a parseable JSON value (an
    // empty borrow fails here). The raw bytes are preserved behind this
    // internal abstraction; routing parses again only when constructing the
    // frame.
    serde_json::from_slice::<serde_json::Value>(data_bytes).ok()?;

    let coalesce_key = match class {
        ExtEventClassV1::Latest => {
            // Only Latest reads the coalesce key. Edge and BestEffort ignore
            // the field entirely — not even its length is inspected.
            let key =
                borrowed_bytes_bounded(input.coalesce_key, EVENT_COALESCE_KEY_MAX_BYTES)?;
            if key.is_empty() {
                return None;
            }
            Some(key.to_vec())
        }
        ExtEventClassV1::Edge | ExtEventClassV1::BestEffort => None,
    };

    Some(PreparedRecord {
        class,
        tray_id,
        coalesce_key,
        data_json: data_bytes.to_vec(),
    })
}

/// Safety contract (caller `validate_and_copy_bounded`, reached only under
/// the non-revoked gate): the bytes are borrowed for the duration of the FFI
/// call only; the returned slice never escapes validation and copying.
///
/// Memory-safety law: the length is checked against `max_len` BEFORE the
/// slice is constructed. `slice::from_raw_parts` is undefined behavior for a
/// range that cannot be a valid allocation, so a pathological length (or a
/// null pointer with a claimed positive length) must be rejected unread —
/// never first wrapped into a slice. Null with length zero is an empty
/// borrow; semantic checks reject it where a non-empty field is required.
fn borrowed_bytes_bounded(bytes: ExtBytes, max_len: usize) -> Option<&'static [u8]> {
    if bytes.ptr.is_null() {
        return if bytes.len == 0 { Some(&[]) } else { None };
    }
    if bytes.len > max_len {
        return None;
    }
    // Safety: bounded by the FFI borrow documented above and by `max_len`.
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

#[derive(Default)]
struct HubMetricsCounters {
    submitted: AtomicU64,
    coalesced: AtomicU64,
    backpressured: AtomicU64,
    best_effort_dropped: AtomicU64,
    invalid_input: AtomicU64,
    port_closed_submits: AtomicU64,
    drained: AtomicU64,
    dropped_stale: AtomicU64,
    discarded_on_revoke: AtomicU64,
    source_limit_rejects: AtomicU64,
    wake_calls: AtomicU64,
    wake_failures: AtomicU64,
    high_water_records: AtomicU64,
    high_water_bytes: AtomicU64,
    drain_latency_max_ns: AtomicU64,
    direct_sources: AtomicU64,
    legacy_sources: AtomicU64,
}

impl HubMetricsCounters {
    fn snapshot(&self, shared: &HubShared) -> HubMetricsSnapshot {
        HubMetricsSnapshot {
            submitted: self.submitted.load(Relaxed),
            coalesced: self.coalesced.load(Relaxed),
            backpressured: self.backpressured.load(Relaxed),
            best_effort_dropped: self.best_effort_dropped.load(Relaxed),
            invalid_input: self.invalid_input.load(Relaxed),
            port_closed_submits: self.port_closed_submits.load(Relaxed),
            drained: self.drained.load(Relaxed),
            dropped_stale: self.dropped_stale.load(Relaxed),
            discarded_on_revoke: self.discarded_on_revoke.load(Relaxed),
            source_limit_rejects: self.source_limit_rejects.load(Relaxed),
            wake_calls: self.wake_calls.load(Relaxed),
            wake_failures: self.wake_failures.load(Relaxed),
            high_water_records: self.high_water_records.load(Relaxed),
            high_water_bytes: self.high_water_bytes.load(Relaxed),
            drain_latency_max_ns: self.drain_latency_max_ns.load(Relaxed),
            direct_sources: self.direct_sources.load(Relaxed),
            legacy_sources: self.legacy_sources.load(Relaxed),
            global_records: shared.global_records.load(Ordering::Acquire) as u64,
            global_bytes: shared.global_bytes.load(Ordering::Acquire) as u64,
        }
    }
}

/// Point-in-time counters for diagnostics and deterministic assertions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct HubMetricsSnapshot {
    pub(crate) submitted: u64,
    pub(crate) coalesced: u64,
    pub(crate) backpressured: u64,
    pub(crate) best_effort_dropped: u64,
    pub(crate) invalid_input: u64,
    pub(crate) port_closed_submits: u64,
    pub(crate) drained: u64,
    pub(crate) dropped_stale: u64,
    pub(crate) discarded_on_revoke: u64,
    pub(crate) source_limit_rejects: u64,
    pub(crate) wake_calls: u64,
    pub(crate) wake_failures: u64,
    pub(crate) high_water_records: u64,
    pub(crate) high_water_bytes: u64,
    pub(crate) drain_latency_max_ns: u64,
    pub(crate) direct_sources: u64,
    pub(crate) legacy_sources: u64,
    pub(crate) global_records: u64,
    pub(crate) global_bytes: u64,
}

/// Shared test-support wake adapters for crate-internal tests.
#[cfg(test)]
pub(crate) mod event_hub_test_support {
    use super::RuntimeWake;

    /// A wake adapter that always succeeds without scheduling anything:
    /// tests drive drains explicitly, deterministically.
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
    use opentray_spec::ExtEventRouteV1;
    use std::ffi::c_char;

    struct CountingWake {
        calls: std::sync::Arc<AtomicU64>,
        fail: bool,
    }

    impl RuntimeWake for CountingWake {
        fn wake(&self) -> bool {
            self.calls.fetch_add(1, Relaxed);
            !self.fail
        }
    }

    fn hub(fail_wake: bool) -> (EventHub, std::sync::Arc<AtomicU64>) {
        let calls = std::sync::Arc::new(AtomicU64::new(0));
        let wake = CountingWake {
            calls: calls.clone(),
            fail: fail_wake,
        };
        (EventHub::new(Box::new(wake)), calls)
    }

    fn open_source(hub: &EventHub, app: &str, instance: &str, session: &str) -> SourceHandle {
        let handle = hub
            .reserve_source(app.to_string(), instance.to_string())
            .expect("source slot");
        assert!(hub.note_loaded_and_open(app, instance, session));
        handle
    }

    fn submit(
        port: &ExtEventPortV1,
        tray: &str,
        data: &str,
        class: ExtEventClassV1,
        key: Option<&[u8]>,
    ) -> ExtResultCode {
        let tray = std::ffi::CString::new(tray).unwrap();
        let data = std::ffi::CString::new(data).unwrap();
        let key_storage;
        let coalesce_key = match key {
            Some(key) => {
                key_storage = key.to_vec();
                ExtBytes {
                    ptr: key_storage.as_ptr() as *const c_char,
                    len: key_storage.len(),
                }
            }
            None => ExtBytes {
                ptr: std::ptr::null(),
                len: 0,
            },
        };
        let input = ExtEventInputV1 {
            route: ExtEventRouteV1 {
                tray_id: ExtBytes {
                    ptr: tray.as_ptr(),
                    len: tray.as_bytes().len(),
                },
            },
            data_json: ExtBytes {
                ptr: data.as_ptr(),
                len: data.as_bytes().len(),
            },
            class: class.as_u32(),
            coalesce_key,
        };
        (port.try_submit)(port.port_data, input)
    }

    fn drain_all(hub: &EventHub) -> Vec<DrainedRecord> {
        let mut all = Vec::new();
        loop {
            let batch = hub.drain_round_robin(EVENT_DRAIN_MAX_RECORDS, EVENT_DRAIN_MAX_BYTES);
            let count = batch.len();
            all.extend(batch);
            if count == 0 {
                return all;
            }
        }
    }

    fn payload(tag: &str) -> String {
        serde_json::json!({ "tag": tag }).to_string()
    }

    fn bulk_payload(padding: usize) -> String {
        serde_json::json!({ "tag": "bulk", "pad": "x".repeat(padding) }).to_string()
    }

    // -- source binding ---------------------------------------------------

    #[test]
    fn source_identity_is_host_bound_not_payload_claimed() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();

        // The payload forges app/ext/session fields; ingress accepts only a
        // tray route and data, and the drained key keeps host facts.
        let forged = serde_json::json!({
            "appId": "forged-app",
            "ext": "forged-ext",
            "sessionId": "forged-session"
        })
        .to_string();
        assert_eq!(
            submit(&port, "tray-a", &forged, ExtEventClassV1::Edge, None),
            EXT_OK
        );

        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].tray_id, "tray-a");
        assert_eq!(drained[0].key.app_id, "app-a");
        assert_eq!(drained[0].key.instance_name, "webview");
        assert_eq!(drained[0].key.owner_session_id, "session-1");
        assert!(drained[0].key.generation >= 1);
    }

    // -- lifecycle: PENDING / failed load / revocation ---------------------

    #[test]
    fn pending_records_never_escape_and_failed_load_discards() {
        let (hub, _) = hub(false);
        let handle = hub
            .reserve_source("app-a".to_string(), "webview".to_string())
            .expect("source slot");
        let port = handle.port();

        // Raced submit while PENDING: accepted, but private.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("pre"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert!(drain_all(&hub).is_empty(), "PENDING records stay private");

        // Failed load: revoke discards the record without delivery.
        assert!(handle.revoke());
        let metrics = hub.metrics();
        assert_eq!(metrics.discarded_on_revoke, 1);
        assert!(drain_all(&hub).is_empty());

        // Post-revoke submit: closed, no queue mutation, payload unread.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("late"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_PORT_CLOSED
        );
        assert_eq!(hub.metrics().port_closed_submits, 1);
    }

    #[test]
    fn submit_while_pending_then_open_delivers() {
        let (hub, _) = hub(false);
        let handle = hub
            .reserve_source("app-a".to_string(), "webview".to_string())
            .expect("source slot");
        let port = handle.port();
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("raced"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );

        // Worst ordering: a drain runs while PENDING (nothing escapes, and
        // rewake_if_ready refuses to wake PENDING-only work) before the ACK
        // opens the source. The open transition must arm a fresh wake so the
        // queued record cannot strand.
        assert!(drain_all(&hub).is_empty());
        let wakes_before = hub.metrics().wake_calls;
        assert!(hub.note_loaded_and_open("app-a", "webview", "session-1"));
        assert!(
            hub.metrics().wake_calls > wakes_before,
            "open requests a drain for records that queued while PENDING"
        );

        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].key.owner_session_id, "session-1");
    }

    #[test]
    fn session_close_race_outcomes_never_cross_the_close() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();

        // Outcome 1: accepted and delivered before close.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("before"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(drain_all(&hub).len(), 1);

        // Outcome 2: accepted, then discarded by the close (revoke runs
        // before core session cleanup).
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("discarded"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(hub.revoke_session("session-1"), 1);
        assert!(drain_all(&hub).is_empty(), "no delivery after close");
        assert_eq!(hub.metrics().discarded_on_revoke, 1);

        // Outcome 3: closed outright.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("closed"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_PORT_CLOSED
        );
        // Another session's records are untouched by this session's revoke.
        let other = open_source(&hub, "app-b", "webview", "session-2");
        assert_eq!(
            submit(
                &other.port(),
                "tray-b",
                &payload("other"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(drain_all(&hub).len(), 1);
    }

    #[test]
    fn reload_generation_isolates_the_old_port() {
        let (hub, _) = hub(false);
        let old = hub
            .reserve_source("app-a".to_string(), "mount".to_string())
            .expect("old source");
        assert!(hub.note_loaded_and_open("app-a", "mount", "session-1"));
        let old_port = old.port();
        let old_generation = old.key().generation;

        // A delayed record from the replaced mount generation.
        assert_eq!(
            submit(
                &old_port,
                "tray-a",
                &payload("old"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );

        // Reload: fresh generation takes over the (app, instance) mapping;
        // the old instance's Drop revokes the old generation.
        let new = hub
            .reserve_source("app-a".to_string(), "mount".to_string())
            .expect("new source");
        assert!(hub.note_loaded_and_open("app-a", "mount", "session-1"));
        assert!(old.revoke());

        // The stale producer reaches immortal state and gets PORT_CLOSED.
        assert_eq!(
            submit(
                &old_port,
                "tray-a",
                &payload("stale"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_PORT_CLOSED
        );
        assert_eq!(
            submit(
                &new.port(),
                "tray-a",
                &payload("new"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );

        let drained = drain_all(&hub);
        assert_eq!(
            drained.len(),
            1,
            "old-generation record discarded: {drained:?}"
        );
        assert_eq!(drained[0].key.generation, new.key().generation);
        assert_ne!(old_generation, drained[0].key.generation);
    }

    #[test]
    fn closed_fast_path_never_dereferences_payload_memory() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        assert!(handle.revoke());
        let port = handle.port();

        // Deliberately invalid borrowed bytes: the revoked fast path must
        // return PORT_CLOSED without reading them.
        let input = ExtEventInputV1 {
            route: ExtEventRouteV1 {
                tray_id: ExtBytes {
                    ptr: 0xdead as *const c_char,
                    len: usize::MAX,
                },
            },
            data_json: ExtBytes {
                ptr: 0xbeef as *const c_char,
                len: usize::MAX,
            },
            class: ExtEventClassV1::Edge.as_u32(),
            coalesce_key: ExtBytes {
                ptr: 0xcafe as *const c_char,
                len: usize::MAX,
            },
        };
        assert_eq!(
            (port.try_submit)(port.port_data, input),
            EXT_ERR_PORT_CLOSED
        );
        assert_eq!(
            (port.try_submit)(std::ptr::null_mut(), input),
            EXT_ERR_PORT_CLOSED
        );
    }

    /// The closed fast path above is not the only untrusted-input surface:
    /// a NON-revoked (open) source must also reject oversized lengths and
    /// null pointers with claimed lengths BEFORE any raw slice is formed,
    /// and Edge/BestEffort must not read the coalesce key at all — not even
    /// its length.
    #[test]
    fn open_path_rejects_unborrowable_input_without_forming_slices() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();

        let tray = std::ffi::CString::new("tray-a").unwrap();
        let data = std::ffi::CString::new(payload("x")).unwrap();
        let bytes =
            |ptr: *const c_char, len: usize| ExtBytes { ptr, len };
        let input = |tray_id: ExtBytes, data_json: ExtBytes, class: u32, coalesce_key: ExtBytes| {
            ExtEventInputV1 {
                route: ExtEventRouteV1 { tray_id },
                data_json,
                class,
                coalesce_key,
            }
        };
        let null_key = ExtBytes {
            ptr: std::ptr::null(),
            len: 0,
        };

        // Oversized lengths with VALID pointers: rejected before the slice
        // is constructed (the old code wrapped the length first — UB).
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(tray.as_ptr(), usize::MAX),
                    bytes(data.as_ptr(), data.as_bytes().len()),
                    ExtEventClassV1::Edge.as_u32(),
                    null_key,
                ),
            ),
            EXT_ERR_REJECTED
        );
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(tray.as_ptr(), tray.as_bytes().len()),
                    bytes(data.as_ptr(), usize::MAX),
                    ExtEventClassV1::Edge.as_u32(),
                    null_key,
                ),
            ),
            EXT_ERR_REJECTED
        );
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(tray.as_ptr(), tray.as_bytes().len()),
                    bytes(data.as_ptr(), data.as_bytes().len()),
                    ExtEventClassV1::Latest.as_u32(),
                    bytes(tray.as_ptr(), usize::MAX),
                ),
            ),
            EXT_ERR_REJECTED,
            "Latest with an oversized coalesce key is rejected unread"
        );

        // Null pointers with a claimed positive length can never be borrowed.
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(std::ptr::null(), 8),
                    bytes(data.as_ptr(), data.as_bytes().len()),
                    ExtEventClassV1::Edge.as_u32(),
                    null_key,
                ),
            ),
            EXT_ERR_REJECTED
        );
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(tray.as_ptr(), tray.as_bytes().len()),
                    bytes(std::ptr::null(), 8),
                    ExtEventClassV1::Edge.as_u32(),
                    null_key,
                ),
            ),
            EXT_ERR_REJECTED
        );

        // Null with length zero is an empty borrow; the empty payload is a
        // semantic rejection (no parseable JSON), not a pointer read.
        assert_eq!(
            (port.try_submit)(
                port.port_data,
                input(
                    bytes(tray.as_ptr(), tray.as_bytes().len()),
                    bytes(std::ptr::null(), 0),
                    ExtEventClassV1::Edge.as_u32(),
                    null_key,
                ),
            ),
            EXT_ERR_REJECTED
        );

        assert_eq!(hub.metrics().invalid_input, 6);
        assert_eq!(hub.metrics().global_records, 0, "nothing was enqueued");

        // Edge and BestEffort ignore the coalesce key entirely: a garbage
        // pointer with a pathological length is accepted unread — the field
        // is not even length-checked for those classes.
        for class in [ExtEventClassV1::Edge, ExtEventClassV1::BestEffort] {
            assert_eq!(
                (port.try_submit)(
                    port.port_data,
                    input(
                        bytes(tray.as_ptr(), tray.as_bytes().len()),
                        bytes(data.as_ptr(), data.as_bytes().len()),
                        class.as_u32(),
                        bytes(0xdead as *const c_char, usize::MAX),
                    ),
                ),
                EXT_OK,
                "{class:?} must not read the coalesce key"
            );
        }
        assert_eq!(drain_all(&hub).len(), 2, "ignored-key records deliver");
    }

    // -- ordering and fairness ---------------------------------------------

    #[test]
    fn per_source_fifo_is_preserved_across_producer_threads() {
        let (hub, _) = hub(false);
        open_source(&hub, "app-a", "webview", "session-1");
        let shared = std::sync::Arc::new(
            hub.current_source("app-a", "webview")
                .expect("current source"),
        );
        // Two concurrent producers stay inside the per-source record budget.
        let per_thread = 50;
        let threads = 2;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(threads));
        let mut joins = Vec::new();
        for thread in 0..threads {
            let shared = shared.clone();
            let barrier = barrier.clone();
            joins.push(std::thread::spawn(move || {
                barrier.wait();
                let port = shared.port();
                for step in 0..per_thread {
                    let tag = format!("t{thread}-s{step}");
                    assert_eq!(
                        submit(&port, "tray-a", &payload(&tag), ExtEventClassV1::Edge, None),
                        EXT_OK
                    );
                }
            }));
        }
        for join in joins {
            join.join().expect("producer thread");
        }

        let drained = drain_all(&hub);
        assert_eq!(drained.len(), threads * per_thread);
        // Lock-acquisition order is the contract: each producer's own
        // subsequence stays in order (no temporal cross-thread promise).
        for thread in 0..threads {
            let mut seen = Vec::new();
            for record in &drained {
                let text = std::str::from_utf8(&record.data_json).expect("utf-8 payload");
                let value: serde_json::Value = serde_json::from_str(text).expect("parsed payload");
                if value["tag"].as_str().is_some_and(|tag| {
                    tag.strip_prefix('t')
                        .and_then(|rest| rest.split_once("-s"))
                        .is_some_and(|(t, _)| t.parse::<usize>() == Ok(thread))
                }) {
                    let step = value["tag"]
                        .as_str()
                        .unwrap()
                        .split_once("-s")
                        .unwrap()
                        .1
                        .parse::<usize>()
                        .unwrap();
                    seen.push(step);
                }
            }
            assert_eq!(seen.len(), per_thread, "thread {thread} records");
            let mut sorted = seen.clone();
            sorted.sort_unstable();
            assert_eq!(seen, sorted, "thread {thread} order preserved");
        }
    }

    #[test]
    fn round_robin_drain_keeps_a_noisy_source_from_starving_others() {
        let (hub, _) = hub(false);
        let quiet = open_source(&hub, "app-a", "badge", "session-1");
        let noisy = open_source(&hub, "app-a", "webview", "session-1");
        let noisy_total = EVENT_DRAIN_MAX_RECORDS + 37;
        for step in 0..noisy_total {
            assert_eq!(
                submit(
                    &noisy.port(),
                    "tray-a",
                    &payload(&format!("n{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }
        assert_eq!(
            submit(
                &quiet.port(),
                "tray-a",
                &payload("q0"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );

        let drained = hub.drain_round_robin(EVENT_DRAIN_MAX_RECORDS, EVENT_DRAIN_MAX_BYTES);
        assert_eq!(drained.len(), EVENT_DRAIN_MAX_RECORDS);
        // The quiet source's single record is served within the first
        // rotation, before the noisy source's remainder.
        let quiet_position = drained
            .iter()
            .position(|record| record.data_json == payload("q0").as_bytes())
            .expect("quiet record delivered");
        assert!(quiet_position <= 1, "quiet position {quiet_position}");
        // Budget-exhausted remainder re-wakes so draining continues to empty.
        let wakes_before = hub.metrics().wake_calls;
        hub.rewake_if_ready();
        assert!(hub.metrics().wake_calls > wakes_before);
        let rest = drain_all(&hub);
        assert_eq!(rest.len(), noisy_total + 1 - EVENT_DRAIN_MAX_RECORDS);
    }

    // -- classes, coalescing, caps ------------------------------------------

    #[test]
    fn latest_replaces_the_pending_position_and_reaccounts_bytes() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();
        let key = b"content/url";

        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("v1"),
                ExtEventClassV1::Latest,
                Some(key)
            ),
            EXT_OK
        );
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("v2"),
                ExtEventClassV1::Latest,
                Some(key)
            ),
            EXT_OK
        );
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1, "one pending position per key");
        assert_eq!(
            drained[0].data_json,
            payload("v2").as_bytes(),
            "converges to latest"
        );
        assert_eq!(hub.metrics().coalesced, 1);

        // A replacement that would exceed the per-source byte cap keeps the
        // old pending item and returns BACKPRESSURE: fill the source with
        // bulk Edge records first so the small pending Latest record plus a
        // bulk replacement must exceed the 256 KiB source budget.
        let bulk = bulk_payload(60_000);
        assert!(bulk.len() <= EVENT_DATA_MAX_BYTES);
        for _ in 0..4 {
            assert_eq!(
                submit(&port, "tray-a", &bulk, ExtEventClassV1::Edge, None),
                EXT_OK
            );
        }
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("small"),
                ExtEventClassV1::Latest,
                Some(key)
            ),
            EXT_OK
        );
        assert_eq!(
            submit(&port, "tray-a", &bulk, ExtEventClassV1::Latest, Some(key)),
            EXT_ERR_BACKPRESSURE,
            "replacement would exceed the per-source byte budget"
        );
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 5);
        assert_eq!(
            drained[4].data_json,
            payload("small").as_bytes(),
            "old pending item remains after the refused replacement"
        );
    }

    #[test]
    fn latest_without_key_is_rejected_and_new_keys_backpressure_when_full() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();

        // Latest without a bounded key is malformed input.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("nokey"),
                ExtEventClassV1::Latest,
                None
            ),
            EXT_ERR_REJECTED
        );

        for step in 0..EVENT_SOURCE_MAX_RECORDS {
            let key = format!("k{step}");
            assert_eq!(
                submit(
                    &port,
                    "tray-a",
                    &payload(&format!("v{step}")),
                    ExtEventClassV1::Latest,
                    Some(key.as_bytes())
                ),
                EXT_OK
            );
        }
        // Records cap reached: a NEW key backpressures...
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("new"),
                ExtEventClassV1::Latest,
                Some(b"k-new")
            ),
            EXT_ERR_BACKPRESSURE
        );
        // ...but an existing key still replaces its pending position.
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("v0-new"),
                ExtEventClassV1::Latest,
                Some(b"k0")
            ),
            EXT_OK
        );
        assert_eq!(hub.metrics().coalesced, 1);
    }

    #[test]
    fn edge_records_backpressure_without_queue_mutation() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();
        for step in 0..EVENT_SOURCE_MAX_RECORDS {
            assert_eq!(
                submit(
                    &port,
                    "tray-a",
                    &payload(&format!("e{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("overflow"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_BACKPRESSURE
        );
        let metrics = hub.metrics();
        assert_eq!(metrics.backpressured, 1);
        assert_eq!(metrics.global_records, EVENT_SOURCE_MAX_RECORDS as u64);
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), EVENT_SOURCE_MAX_RECORDS);
        assert!(drained
            .iter()
            .all(|record| record.data_json != payload("overflow").as_bytes()));
    }

    #[test]
    fn best_effort_drops_newest_with_metric_and_success() {
        let (hub, wake_calls) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();
        for step in 0..EVENT_SOURCE_MAX_RECORDS {
            assert_eq!(
                submit(
                    &port,
                    "tray-a",
                    &payload(&format!("e{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }
        let wakes_before = wake_calls.load(Relaxed);
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("hint"),
                ExtEventClassV1::BestEffort,
                None
            ),
            EXT_OK,
            "lossy class reports success so it cannot become a hot loop"
        );
        assert_eq!(hub.metrics().best_effort_dropped, 1);
        assert_eq!(
            wake_calls.load(Relaxed),
            wakes_before,
            "a dropped record does not wake"
        );
        assert_eq!(drain_all(&hub).len(), EVENT_SOURCE_MAX_RECORDS);
    }

    #[test]
    fn global_record_cap_bounds_the_whole_broker() {
        let (hub, _) = hub(false);
        let sources = EVENT_HUB_MAX_RECORDS / EVENT_SOURCE_MAX_RECORDS;
        for index in 0..sources {
            let handle = open_source(&hub, "app-a", &format!("ext{index}"), "session-1");
            for step in 0..EVENT_SOURCE_MAX_RECORDS {
                assert_eq!(
                    submit(
                        &handle.port(),
                        "tray-a",
                        &payload(&format!("s{index}-{step}")),
                        ExtEventClassV1::Edge,
                        None
                    ),
                    EXT_OK
                );
            }
        }
        assert_eq!(hub.metrics().global_records, EVENT_HUB_MAX_RECORDS as u64);
        let extra = open_source(&hub, "app-a", "ext-extra", "session-1");
        assert_eq!(
            submit(
                &extra.port(),
                "tray-a",
                &payload("over"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_BACKPRESSURE
        );
        assert_eq!(
            hub.metrics().high_water_records,
            EVENT_HUB_MAX_RECORDS as u64
        );
    }

    #[test]
    fn global_byte_cap_bounds_the_whole_broker() {
        let (hub, _) = hub(false);
        // Deterministic fixture derived from the frozen constants.
        let data = bulk_payload(60_000);
        let per_record = QueuedRecord::accounted_parts("tray-a", data.as_bytes(), None);
        let per_source_records = EVENT_SOURCE_MAX_BYTES / per_record;
        let sources = EVENT_HUB_MAX_BYTES / (per_source_records * per_record);

        for index in 0..sources {
            let handle = open_source(&hub, "app-a", &format!("ext{index}"), "session-1");
            for _ in 0..per_source_records {
                assert_eq!(
                    submit(&handle.port(), "tray-a", &data, ExtEventClassV1::Edge, None),
                    EXT_OK
                );
            }
        }
        let remaining = EVENT_HUB_MAX_BYTES - sources * per_source_records * per_record;
        let last = open_source(&hub, "app-a", "ext-last", "session-1");
        let fits = remaining / per_record;
        for _ in 0..fits {
            assert_eq!(
                submit(&last.port(), "tray-a", &data, ExtEventClassV1::Edge, None),
                EXT_OK
            );
        }
        assert_eq!(
            submit(&last.port(), "tray-a", &data, ExtEventClassV1::Edge, None),
            EXT_ERR_BACKPRESSURE,
            "aggregate byte budget exhausted"
        );
        assert_eq!(
            hub.metrics().high_water_bytes,
            (sources * per_source_records + fits) as u64 * per_record as u64
        );
    }

    // -- malformed input ----------------------------------------------------

    #[test]
    fn malformed_submissions_are_structurally_rejected() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();
        let mut invalid = 0;

        for class in [0u32, 4, 5, u32::MAX] {
            let tray = std::ffi::CString::new("tray-a").unwrap();
            let data = std::ffi::CString::new(payload("x")).unwrap();
            let input = ExtEventInputV1 {
                route: ExtEventRouteV1 {
                    tray_id: ExtBytes {
                        ptr: tray.as_ptr(),
                        len: tray.as_bytes().len(),
                    },
                },
                data_json: ExtBytes {
                    ptr: data.as_ptr(),
                    len: data.as_bytes().len(),
                },
                class,
                coalesce_key: ExtBytes {
                    ptr: std::ptr::null(),
                    len: 0,
                },
            };
            assert_eq!((port.try_submit)(port.port_data, input), EXT_ERR_REJECTED);
            invalid += 1;
        }

        // Empty tray id.
        assert_eq!(
            submit(&port, "", &payload("x"), ExtEventClassV1::Edge, None),
            EXT_ERR_REJECTED
        );
        invalid += 1;

        // Non-UTF-8 tray id.
        let bad_tray = vec![0xffu8, 0xfe];
        let data = std::ffi::CString::new(payload("x")).unwrap();
        let input = ExtEventInputV1 {
            route: ExtEventRouteV1 {
                tray_id: ExtBytes {
                    ptr: bad_tray.as_ptr() as *const c_char,
                    len: bad_tray.len(),
                },
            },
            data_json: ExtBytes {
                ptr: data.as_ptr(),
                len: data.as_bytes().len(),
            },
            class: ExtEventClassV1::Edge.as_u32(),
            coalesce_key: ExtBytes {
                ptr: std::ptr::null(),
                len: 0,
            },
        };
        assert_eq!((port.try_submit)(port.port_data, input), EXT_ERR_REJECTED);
        invalid += 1;

        // Invalid JSON payload.
        assert_eq!(
            submit(&port, "tray-a", "{not json", ExtEventClassV1::Edge, None),
            EXT_ERR_REJECTED
        );
        invalid += 1;

        // Oversized data JSON.
        let oversized = serde_json::json!({ "pad": "x".repeat(EVENT_DATA_MAX_BYTES) });
        let oversized = serde_json::to_string(&oversized).unwrap();
        assert!(oversized.len() > EVENT_DATA_MAX_BYTES);
        assert_eq!(
            submit(
                &port,
                "tray-a",
                oversized.as_str(),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_REJECTED
        );
        invalid += 1;

        // Oversized tray id and coalesce key (128-byte bound each).
        let long_tray = "t".repeat(EVENT_COALESCE_KEY_MAX_BYTES + 1);
        assert_eq!(
            submit(
                &port,
                &long_tray,
                &payload("x"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_REJECTED
        );
        invalid += 1;
        let long_key = vec![b'k'; EVENT_COALESCE_KEY_MAX_BYTES + 1];
        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("x"),
                ExtEventClassV1::Latest,
                Some(long_key.as_slice())
            ),
            EXT_ERR_REJECTED
        );
        invalid += 1;

        let metrics = hub.metrics();
        assert_eq!(metrics.invalid_input, invalid);
        assert_eq!(metrics.global_records, 0, "nothing was enqueued");
    }

    // -- source budget ------------------------------------------------------

    #[test]
    fn source_generation_cap_rejects_before_any_new_port() {
        let (hub, _) = hub(false);
        for index in 0..EVENT_HUB_MAX_SOURCES {
            hub.reserve_source("app-a".to_string(), format!("gen{index}"))
                .expect("source slot");
        }
        assert!(matches!(
            hub.reserve_source("app-a".to_string(), "one-too-many".to_string()),
            Err(SourceLimitReached)
        ));
        assert_eq!(hub.metrics().source_limit_rejects, 1);
        // Revoked states still count: phase 1 never reclaims generations.
        assert!(hub.revoke_all() >= 1);
        assert!(matches!(
            hub.reserve_source("app-a".to_string(), "still-full".to_string()),
            Err(SourceLimitReached)
        ));
    }

    // -- wake adapter -------------------------------------------------------

    #[test]
    fn wakes_coalesce_across_submits_and_rearm_after_drain() {
        let (hub, wake_calls) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();

        for step in 0..10 {
            assert_eq!(
                submit(
                    &port,
                    "tray-a",
                    &payload(&format!("w{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }
        assert_eq!(wake_calls.load(Relaxed), 1, "N submits yield one wake");

        let drained = hub.drain_round_robin(EVENT_DRAIN_MAX_RECORDS, EVENT_DRAIN_MAX_BYTES);
        assert_eq!(drained.len(), 10);
        hub.rewake_if_ready();
        assert_eq!(wake_calls.load(Relaxed), 1, "empty hub does not re-wake");

        assert_eq!(
            submit(
                &port,
                "tray-a",
                &payload("again"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(wake_calls.load(Relaxed), 2, "a new submit re-arms the wake");
    }

    #[test]
    fn budget_exhausted_drains_rewake_until_empty() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let port = handle.port();
        let total = EVENT_DRAIN_MAX_RECORDS + EVENT_DRAIN_MAX_RECORDS / 2;
        for step in 0..total {
            assert_eq!(
                submit(
                    &port,
                    "tray-a",
                    &payload(&format!("b{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }

        let first = hub.drain_round_robin(EVENT_DRAIN_MAX_RECORDS, EVENT_DRAIN_MAX_BYTES);
        assert_eq!(first.len(), EVENT_DRAIN_MAX_RECORDS);
        let wakes_before = hub.metrics().wake_calls;
        hub.rewake_if_ready();
        assert!(
            hub.metrics().wake_calls > wakes_before,
            "remaining records re-wake the loop"
        );

        let second = drain_all(&hub);
        assert_eq!(second.len(), total - EVENT_DRAIN_MAX_RECORDS);
    }

    #[test]
    fn failed_wake_rejects_new_submits_without_spinning_or_queueing() {
        let (hub, wake_calls) = hub(true);
        let handle = open_source(&hub, "app-a", "webview", "session-1");

        // The open transition's drain request already failed: the hub has no
        // active delivery path, so every submit is rejected as PORT_CLOSED
        // at admission instead of being accepted into a dead queue.
        assert_eq!(hub.metrics().wake_failures, 1);
        let calls_after_open = wake_calls.load(Relaxed);
        assert_eq!(
            submit(
                &handle.port(),
                "tray-a",
                &payload("undeliverable"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_PORT_CLOSED,
            "a submit is never accepted without an active delivery path"
        );
        assert_eq!(
            hub.current_source("app-a", "webview")
                .expect("current source")
                .submit_push("tray-a", &serde_json::json!({ "type": "push" })),
            SubmitOutcome::Closed,
            "the command-time ingress follows the same law"
        );
        assert_eq!(
            wake_calls.load(Relaxed),
            calls_after_open,
            "no wake spin while unavailable"
        );
        assert_eq!(hub.metrics().wake_failures, 1);
        assert_eq!(hub.metrics().global_records, 0, "no record was accepted");
        assert_eq!(hub.metrics().port_closed_submits, 1);
        assert!(drain_all(&hub).is_empty());
    }

    /// Records accepted before the failure observation never strand: the
    /// next drain through any path delivers them, and a recovered wake
    /// restores admission fully.
    #[test]
    fn accepted_records_never_strand_across_wake_failure_and_recovery() {
        struct SwitchableWake {
            calls: std::sync::Arc<AtomicU64>,
            ok: std::sync::Arc<AtomicBool>,
        }
        impl RuntimeWake for SwitchableWake {
            fn wake(&self) -> bool {
                self.calls.fetch_add(1, Relaxed);
                self.ok.load(Ordering::SeqCst)
            }
        }
        let calls = std::sync::Arc::new(AtomicU64::new(0));
        let ok = std::sync::Arc::new(AtomicBool::new(false));
        let hub = EventHub::new(Box::new(SwitchableWake {
            calls: calls.clone(),
            ok: ok.clone(),
        }));

        // A submit while PENDING is admitted (delivery is armed at open);
        // its own wake attempt fails, marking ingress unavailable.
        let handle = hub
            .reserve_source("app-a".to_string(), "webview".to_string())
            .expect("source slot");
        assert_eq!(
            submit(
                &handle.port(),
                "tray-a",
                &payload("accepted"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(hub.metrics().wake_failures, 1);
        assert_eq!(hub.metrics().global_records, 1);

        // The load itself is fine: the ACK opens the source, but its drain
        // request is suppressed and every further submit is undeliverable.
        assert!(hub.note_loaded_and_open("app-a", "webview", "session-1"));
        assert_eq!(
            submit(
                &handle.port(),
                "tray-a",
                &payload("rejected"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_ERR_PORT_CLOSED
        );
        assert_eq!(
            hub.metrics().global_records,
            1,
            "only the pre-failure record is retained"
        );

        // Recovery: the owner loop drains through another path (e.g. the
        // post-response barrier) and the wake adapter is healthy again. The
        // accepted record is delivered — no stranding.
        ok.store(true, Ordering::SeqCst);
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].data_json, payload("accepted").as_bytes());
        assert_eq!(drained[0].key.owner_session_id, "session-1");

        // Admission is fully restored and drains run empty.
        assert_eq!(
            submit(
                &handle.port(),
                "tray-a",
                &payload("recovered"),
                ExtEventClassV1::Edge,
                None
            ),
            EXT_OK
        );
        assert_eq!(calls.load(Relaxed), 2, "the recovered wake ran again");
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].data_json, payload("recovered").as_bytes());
        assert!(drain_all(&hub).is_empty(), "no stranded records remain");
    }

    // -- send_event ingress --------------------------------------------------

    #[test]
    fn command_push_uses_the_same_bounded_ingress() {
        let (hub, _) = hub(false);
        let handle = open_source(&hub, "app-a", "webview", "session-1");
        let current = hub
            .current_source("app-a", "webview")
            .expect("current source");

        assert_eq!(
            current.submit_push("tray-a", &serde_json::json!({ "type": "pushed" })),
            SubmitOutcome::Enqueued
        );
        let drained = drain_all(&hub);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].tray_id, "tray-a");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&drained[0].data_json).unwrap(),
            serde_json::json!({ "type": "pushed" })
        );

        // Backpressure is surfaced to the extension call instead of being
        // silently swallowed.
        for step in 0..EVENT_SOURCE_MAX_RECORDS {
            assert_eq!(
                submit(
                    &handle.port(),
                    "tray-a",
                    &payload(&format!("fill{step}")),
                    ExtEventClassV1::Edge,
                    None
                ),
                EXT_OK
            );
        }
        assert_eq!(
            current.submit_push("tray-a", &serde_json::json!({ "type": "overflow" })),
            SubmitOutcome::Backpressure
        );

        // A revoked source reports closure, not an error the caller must
        // translate: the closing session's own cleanup pushes drop.
        assert_eq!(hub.revoke_session("session-1"), 1);
        assert_eq!(
            current.submit_push("tray-a", &serde_json::json!({ "type": "cleanup" })),
            SubmitOutcome::Closed
        );
    }

    #[test]
    fn capability_diagnostics_count_direct_and_legacy_loads() {
        let (hub, _) = hub(false);
        hub.note_capability(true);
        hub.note_capability(false);
        let metrics = hub.metrics();
        assert_eq!(metrics.direct_sources, 1);
        assert_eq!(metrics.legacy_sources, 1);
    }
}
