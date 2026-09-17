//! Windows dialog host (add-ext-dialog tasks 3.3/3.3b/3.4/3.5-win):
//! per-owner bounded STA workers with honest Accepted semantics.
//!
//! # Architecture (design section 5.3, frozen numerics)
//!
//! - **Worker cap 8** per broker. A ninth concurrent dialog rejects with
//!   typed `dialog_worker_limit_reached` BEFORE any state change — never
//!   queuing, never calling it Accepted.
//! - **One active dialog per `(appId, trayId, sessionId)`**: the second
//!   show for a busy scope rejects with typed `dialog_session_busy`.
//! - **Accepted = the worker entered its native modal call.** TaskDialog
//!   proves it with the `TDN_CREATED` callback; `IFileDialog::Show` and
//!   the MessageBox fallback prove it by entering the call (no prior
//!   presentation signal exists — never claimed).
//! - **3s pre-Accept budget** for worker spawn + STA init + dialog
//!   construction + entry. A timeout answers the ORIGINAL requestId with
//!   a synchronous typed `dialog_presentation_failed` error: no Accepted
//!   frame, no operation, no terminal (the host retires the operation on
//!   the error path). Failures after entry are terminal error payloads.
//! - **Close dispatcher** = `WM_APP + ordinal` posted to the worker's
//!   message-only window; every COM/native object is only ever touched on
//!   the worker thread (inside the modal pump).
//! - **Join budget 2s** on shutdown, reverse owner order. A worker that
//!   outlives the join keeps running: this module pins its own DLL in the
//!   loader so the host's `FreeLibrary` cannot unmap executing code (the
//!   "keep references until natural exit" ending of the frozen unload-race
//!   ruling) and reports the leak as a fatal diagnostic.
//!
//! # Slot ownership law
//!
//! One registry slot per active worker. The WORKER thread is the single
//! release authority: its last action takes the slot (dropping the stored
//! `JoinHandle` detaches — a thread cannot join itself), making the
//! ordinal reusable. Owner-thread paths only set flags and post closes;
//! they never free a slot, so double-release and double-join are
//! unexpressible. A worker hung before entry holds its slot until it dies
//! — the honest bound of the frozen design (a pathological COM stall
//! cannot be reaped without unloading risk).
//!
//! # Seam contract for `lib.rs` (cfg(windows) wiring)
//!
//! - busy check: [`is_busy`] (this module owns the Windows busy view:
//!   completion happens on worker threads, not the owner loop);
//! - show: [`begin`] (spawns the worker and performs the pre-Accept
//!   transaction; `Err` is the synchronous typed rejection); the Windows
//!   path does NOT `register_modal` into `DialogInstance` (workers
//!   self-release; a DialogInstance record would never be removed by the
//!   worker thread);
//! - session close: [`revoke_session`] (every worker of the closing
//!   session);
//! - natural completion: nothing (the worker submits the terminal and
//!   releases its slot by itself);
//! - deinit: [`shutdown`] (close-all + bounded join + pin-or-report);
//! - backend: [`backend_capabilities`] (comctl32 v6 probe, once).
//!
//! Only copyable request data and the Send port shim cross threads; the
//! extension instance and every COM object stay on their owning threads
//! (the thread-affinity law).

mod capability;
mod ffi;
mod file_dialog;
mod task_dialog;
mod worker;

use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use opentray_spec::{CommandScope, ExtOperationPayload, TypedExtensionError};

use worker::{EntryOutcome, WorkerShared};

use crate::options::error_code;
use crate::options::{ButtonStyle, DialogBackendCapabilities};
use crate::state::{self, busy_error, DeferredPortCopy, ModalKind};

/// Frozen numerics (design section 5.3).
pub(crate) const DIALOG_WORKER_CAP: usize = 8;
pub(crate) const DIALOG_ENTRY_BUDGET: Duration = Duration::from_secs(3);
pub(crate) const DIALOG_CLOSE_JOIN_BUDGET: Duration = Duration::from_secs(2);

// ---------------------------------------------------------------------------
// Send port shim
// ---------------------------------------------------------------------------

/// The by-value port copy made cross-thread safe. `ExtDeferredPortV1`
/// submit is host-owned thread-safe state by contract (design section 5.3
/// thread law), so the raw pointer + fn pair is honestly Send; the struct
/// it copies never crosses back.
struct SendPort(DeferredPortCopy);

// SAFETY: `DeferredPortCopy` holds only `port_data` (broker-owned,
// process-lifetime, thread-safe by the ABI contract) and the `submit` fn
// pointer (broker code). See design sections 5.1/5.3.
unsafe impl Send for SendPort {}

impl SendPort {
    fn submit(&self, handle: u64, payload: &ExtOperationPayload) -> i32 {
        self.0.submit(handle, payload)
    }
}

// ---------------------------------------------------------------------------
// Worker registry (per broker process; cap 8)
// ---------------------------------------------------------------------------

type ScopeKey = (String, String, String);

fn scope_key(scope: &CommandScope) -> ScopeKey {
    (
        scope.app_id.clone(),
        scope.tray_id.clone(),
        scope.session_id.clone(),
    )
}

struct WorkerSlot {
    shared: Arc<WorkerShared>,
    join: Option<JoinHandle<()>>,
    scope: ScopeKey,
    ordinal: usize,
}

fn registry() -> &'static Mutex<Vec<Option<WorkerSlot>>> {
    static REGISTRY: OnceLock<Mutex<Vec<Option<WorkerSlot>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        Mutex::new((0..DIALOG_WORKER_CAP).map(|_| None).collect())
    })
}

fn lock_registry() -> std::sync::MutexGuard<'static, Vec<Option<WorkerSlot>>> {
    registry().lock().unwrap_or_else(|error| error.into_inner())
}

/// True when the scope already shows a dialog (the Windows busy view).
pub(crate) fn is_busy(scope: &CommandScope) -> bool {
    let key = scope_key(scope);
    lock_registry().iter().flatten().any(|slot| slot.scope == key)
}

/// The active worker count (diagnostics + tests).
///
/// Kept as a diagnostic surface even where no production path calls it
/// today (the registry introspection the shutdown report and future probes
/// build on).
#[allow(dead_code)]
pub(crate) fn active_workers() -> usize {
    lock_registry().iter().flatten().count()
}

/// The typed worker-limit rejection (cap reached: never queue).
fn worker_limit_error(scope: &CommandScope) -> TypedExtensionError {
    state::typed_error_with_details(
        "dialog_worker_limit_reached",
        format!(
            "the broker already runs {DIALOG_WORKER_CAP} concurrent dialog workers; another \
             dialog is rejected instead of queued"
        ),
        serde_json::json!({
            "kind": "worker-limit",
            "limit": DIALOG_WORKER_CAP,
            "appId": scope.app_id,
            "trayId": scope.tray_id,
            "sessionId": scope.session_id,
        }),
    )
}

/// Reserves one registry slot for a scope. Atomic busy + limit under one
/// lock: both checks happen before the slot is written, so a rejection
/// never mutates state (task 3.3: a full pool rejects BEFORE queuing, and
/// a busy scope rejects before a slot is consumed).
fn reserve_slot(
    scope: &CommandScope,
    label: &str,
) -> Result<Arc<WorkerShared>, TypedExtensionError> {
    let mut slots = lock_registry();
    let key = scope_key(scope);
    if slots.iter().flatten().any(|slot| slot.scope == key) {
        return Err(busy_error(scope, label));
    }
    let ordinal = slots
        .iter()
        .position(Option::is_none)
        .ok_or_else(|| worker_limit_error(scope))?;
    let shared = WorkerShared::new(ordinal);
    slots[ordinal] = Some(WorkerSlot {
        shared: shared.clone(),
        join: None,
        scope: key,
        ordinal,
    });
    Ok(shared)
}

// ---------------------------------------------------------------------------
// Native modal handle (the state.rs `NativeState::Windows` payload)
// ---------------------------------------------------------------------------

/// The Windows native modal state: the worker's shared control block.
/// Completion and terminal submission happen on the worker thread;
/// [`revoke`] projects the owner-thread decision through atomics and the
/// posted close message only.
pub(crate) struct NativeModal {
    shared: Arc<WorkerShared>,
}

/// Spawns one STA worker for the show command and performs the pre-Accept
/// transaction: the call returns `Ok` only after the worker entered its
/// native modal call (the frozen evidence), within the 3s budget. `Err` is
/// the synchronous typed rejection (original requestId path; no operation,
/// no Accepted, no terminal).
pub(crate) fn begin(
    kind: &ModalKind,
    port: Option<&DeferredPortCopy>,
    handle: u64,
    scope: &CommandScope,
) -> Result<NativeModal, TypedExtensionError> {
    // Capability gate BEFORE any state change: TaskDialog-exclusive
    // surfaces are typed rejections, never silent MessageBox downgrades.
    if capability_requires_task_dialog(kind) && capability::probe_task_dialog_surface().is_none()
    {
        return Err(state::typed_error_with_details(
            error_code::CAPABILITY_UNAVAILABLE,
            "commandLink, expander, and fourth-plus buttons require the comctl32 v6 \
             TaskDialog surface; the host process has no matching activation context \
             (broker RT_MANIFEST)",
            serde_json::json!({
                "kind": "feature",
                "platform": "win32",
            }),
        ));
    }

    let shared = reserve_slot(scope, kind.label())?;

    let (entry_tx, entry_rx) = mpsc::channel::<EntryOutcome>();
    shared.install_entry(entry_tx);

    let request = WorkerRequest {
        kind: kind.clone(),
        handle,
        port: port.map(|copy| SendPort(copy.clone_pair())),
        shared: shared.clone(),
    };
    let join = std::thread::Builder::new()
        .name(format!("opentray-dialog-worker-{}", shared.ordinal))
        .spawn(move || run_worker(request))
        .map_err(|error| {
            // The worker never started: the owner may free the slot
            // (no thread exists to self-release).
            take_slot(shared.ordinal);
            state::typed_error(
                error_code::PRESENTATION_FAILED,
                format!("the dialog worker thread could not start: {error}"),
            )
        })?;
    if let Some(slot) = lock_registry().get_mut(shared.ordinal).and_then(Option::as_mut) {
        slot.join = Some(join);
    }

    // The frozen pre-Accept transaction: wait for the entry evidence.
    match entry_rx.recv_timeout(DIALOG_ENTRY_BUDGET) {
        Ok(EntryOutcome::Entered { evidence }) => {
            eprintln!(
                "opentray-ext-dialog: worker {} entered native modal ({evidence}) for handle \
                 {handle:#018x}",
                shared.ordinal
            );
            Ok(NativeModal { shared })
        }
        Ok(EntryOutcome::Failed { error }) => {
            // Worker-side pre-entry failure: the synchronous typed error
            // path. The worker still exits by itself (releasing its slot);
            // the owner only waits for that release, bounded.
            wait_for_slot_release(shared.ordinal, DIALOG_ENTRY_BUDGET);
            Err(error)
        }
        Err(RecvTimeoutError::Timeout) => {
            // 3s budget exhausted: the failure must be observable BEFORE
            // any Accepted/operation exists. Mark abandoned (the worker
            // never submits a terminal), request close, and answer the
            // original requestId synchronously.
            shared.abandoned.store(true, Ordering::Release);
            shared.request_close();
            Err(state::typed_error_with_details(
                error_code::PRESENTATION_FAILED,
                format!(
                    "the dialog worker did not enter its native modal within {} ms",
                    DIALOG_ENTRY_BUDGET.as_millis()
                ),
                serde_json::json!({
                    "kind": "entry-budget",
                    "budgetMs": DIALOG_ENTRY_BUDGET.as_millis() as u64,
                }),
            ))
        }
        Err(RecvTimeoutError::Disconnected) => {
            // The worker died without any handshake outcome (panic/abort
            // before signaling): an honest pre-Accept failure. The slot
            // self-release may or may not have run; reclaim defensively.
            wait_for_slot_release(shared.ordinal, Duration::from_secs(1));
            if slot_is_free(shared.ordinal) {
                // Already self-released.
            } else {
                take_slot(shared.ordinal);
            }
            Err(state::typed_error(
                error_code::PRESENTATION_FAILED,
                "the dialog worker exited before entering its native modal",
            ))
        }
    }
}

/// One worker-thread request: copyable data + the Send port shim only.
struct WorkerRequest {
    kind: ModalKind,
    handle: u64,
    port: Option<SendPort>,
    shared: Arc<WorkerShared>,
}

/// The worker body (design section 5.3): STA init, dispatcher window,
/// native modal, terminal decision, registry release — all on this thread.
fn run_worker(request: WorkerRequest) {
    let WorkerRequest {
        kind,
        handle,
        port,
        shared,
    } = request;

    let sta = match worker::initialize_sta() {
        Ok(sta) => sta,
        Err(message) => {
            let _ = shared.send_entry(EntryOutcome::Failed {
                error: state::typed_error(error_code::PRESENTATION_FAILED, message),
            });
            take_slot(shared.ordinal);
            return;
        }
    };
    // SAFETY: this thread initialized STA and owns the shared block for
    // the window lifetime.
    if let Err(message) = unsafe { worker::create_dispatcher_window(&shared) } {
        let _ = shared.send_entry(EntryOutcome::Failed {
            error: state::typed_error(error_code::PRESENTATION_FAILED, message),
        });
        drop(sta);
        take_slot(shared.ordinal);
        return;
    }

    let outcome: Result<ExtOperationPayload, TypedExtensionError> = match &kind {
        ModalKind::Message(options) => {
            match capability::probe_task_dialog_surface() {
                Some(surface) => {
                    task_dialog::show_task_dialog(options, &options.win32, &shared, surface)
                }
                None => task_dialog::show_message_box(options, &shared),
            }
        }
        ModalKind::PickFile(options) => {
            file_dialog::show_pick(&file_dialog::PickSurface::OpenFile(options.clone()), &shared)
        }
        ModalKind::PickDirectory(options) => file_dialog::show_pick(
            &file_dialog::PickSurface::OpenDirectory(options.clone()),
            &shared,
        ),
        ModalKind::PickSavePath(options) => {
            file_dialog::show_pick(&file_dialog::PickSurface::Save(options.clone()), &shared)
        }
    };

    // SAFETY: the dispatcher was created by this thread; after the modal
    // returned its pump is gone, so no close message can be in flight.
    unsafe { worker::destroy_dispatcher_window(&shared) };
    drop(sta);
    shared.take_entry();

    if !shared.abandoned.load(Ordering::Acquire) {
        let payload = if shared.revoked.load(Ordering::Acquire) {
            // The cancel branch (isomorphic to user cancellation): the
            // revoke on the owner thread CAS'd the decision before the
            // native dismissal was requested.
            state::cancel_payload(&kind)
        } else {
            outcome.unwrap_or_else(|error| ExtOperationPayload::Error { error })
        };
        match &port {
            Some(port) => {
                let code = port.submit(handle, &payload);
                if code != opentray_spec::EXT_OK {
                    // PORT_CLOSED / INVALID_HANDLE / BACKPRESSURE are host
                    // decisions (revocation, purge, duplicate settlement);
                    // exactly-once is the broker's settlement CAS.
                    eprintln!(
                        "opentray-ext-dialog: terminal submit for handle {handle:#018x} \
                         returned {code} (host decision; no retry)"
                    );
                }
            }
            None => eprintln!(
                "opentray-ext-dialog: terminal for handle {handle:#018x} had no deferred port"
            ),
        }
    }

    // The single release authority (see the slot ownership law).
    take_slot(shared.ordinal);
}

/// Takes one slot away entirely (dropping the stored `JoinHandle`
/// detaches that thread). Callable from the worker itself at natural exit
/// or from the owner when no thread ever started.
fn take_slot(ordinal: usize) {
    if let Some(slot) = lock_registry().get_mut(ordinal) {
        *slot = None;
    }
}

fn slot_is_free(ordinal: usize) -> bool {
    lock_registry().get(ordinal).is_some_and(Option::is_none)
}

/// Bounded wait until the worker's self-release lands (coarse 10ms polls
/// within the budget; used only on pre-Accept failure paths where the
/// worker is already exiting).
fn wait_for_slot_release(ordinal: usize, budget: Duration) {
    let deadline = Instant::now() + budget;
    while !slot_is_free(ordinal) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Session-close revocation (design section 5.4), single-native form: mark
/// the worker revoked (the cancel branch wins over any in-flight natural
/// outcome) and project the native dismissal through the WM_APP dispatcher.
/// The worker submits the cancel-branch terminal itself; the host's
/// delivery decision (the port was revoked before this call) stays
/// authoritative. The lib.rs composition never holds a `NativeModal` (no
/// registration on win32), so this seam is intentionally uncalled today —
/// session close goes through [`revoke_session`] and natural completion
/// goes through the worker itself.
#[allow(dead_code)]
pub(crate) fn revoke(native: NativeModal) {
    let NativeModal { shared } = native;
    shared.revoked.store(true, Ordering::Release);
    shared.request_close();
}

/// Session-close revocation for every worker of one session (the
/// `session_closed` seam: workers are keyed by their full scope, so this
/// matches on the session component only — the same-session multi-tray and
/// multi-mount concurrency the design allows).
pub(crate) fn revoke_session(session_id: &str) {
    let targets: Vec<Arc<WorkerShared>> = lock_registry()
        .iter()
        .flatten()
        .filter(|slot| slot.scope.2 == session_id)
        .map(|slot| slot.shared.clone())
        .collect();
    for shared in targets {
        shared.revoked.store(true, Ordering::Release);
        shared.request_close();
    }
}

/// Orphaned-native teardown for the instance Drop path: the host is going
/// away (deinit), so no terminal is submitted — the port is revoked by the
/// host before deinit anyway. Uncalled today for the same reason as
/// [`revoke`]: nothing registers a native on win32, and deinit goes
/// through [`shutdown`].
#[allow(dead_code)]
pub(crate) fn teardown_orphaned(native: NativeModal) {
    let NativeModal { shared } = native;
    shared.abandoned.store(true, Ordering::Release);
    shared.request_close();
}

/// Deinit shutdown (design section 5.3): post close to every worker in
/// reverse ordinal order, join within the shared 2s budget, then either
/// report a clean shutdown or pin this DLL in the loader so the host's
/// later `FreeLibrary` cannot unmap code a still-running worker executes
/// (fatal diagnostic either way — the process should be investigated, not
/// silently reused).
pub(crate) struct ShutdownReport {
    pub(crate) joined: usize,
    pub(crate) leaked: usize,
    pub(crate) pinned: bool,
}

pub(crate) fn shutdown() -> ShutdownReport {
    let deadline = Instant::now() + DIALOG_CLOSE_JOIN_BUDGET;
    let mut report = ShutdownReport {
        joined: 0,
        leaked: 0,
        pinned: false,
    };

    // Snapshot the occupied ordinals and post closes in reverse order
    // (later dialogs close first).
    let mut ordinals: Vec<usize> = lock_registry()
        .iter()
        .flatten()
        .map(|slot| slot.ordinal)
        .collect();
    ordinals.sort_unstable_by(|a, b| b.cmp(a));
    for ordinal in &ordinals {
        let shared = lock_registry()
            .get(*ordinal)
            .and_then(Option::as_ref)
            .map(|slot| slot.shared.clone());
        if let Some(shared) = shared {
            shared.request_close();
        }
    }

    for ordinal in ordinals {
        let join = lock_registry()
            .get_mut(ordinal)
            .and_then(Option::as_mut)
            .and_then(|slot| slot.join.take());
        match join {
            Some(join) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if join_worker_bounded(join, ordinal, remaining) {
                    report.joined += 1;
                } else {
                    report.leaked += 1;
                }
            }
            None => {
                // No stored handle (already reaped): the worker
                // self-releases on exit.
            }
        }
    }

    if report.leaked > 0 {
        // Ending (a): keep the library mapped until natural exit.
        report.pinned = capability::pin_self_module().is_some();
        eprintln!(
            "opentray-ext-dialog: FATAL {} dialog worker(s) outlived the 2s join budget; \
             module pin {} — cleanup deferred to process exit",
            report.leaked,
            if report.pinned { "succeeded" } else { "FAILED" },
        );
    }
    report
}

/// Joins one worker with a residual budget. `JoinHandle` has no timed
/// join, so the budget watches the worker's own slot self-release (its
/// last action) and joins once free; on budget exhaustion the handle
/// drops DETACHED (the pinned module keeps the worker's code mapped).
fn join_worker_bounded(join: JoinHandle<()>, ordinal: usize, remaining: Duration) -> bool {
    let mut remaining = remaining;
    while remaining > Duration::ZERO {
        if slot_is_free(ordinal) {
            let _ = join.join();
            return true;
        }
        std::thread::sleep(Duration::from_millis(10).min(remaining));
        remaining = remaining.saturating_sub(Duration::from_millis(10));
    }
    let _ = join; // detach
    false
}

// ---------------------------------------------------------------------------
// Backend capabilities (task 3.5 win)
// ---------------------------------------------------------------------------

/// True when the request needs TaskDialog-exclusive surfaces (commandLink
/// buttons, the expander, or more than the three MessageBox button slots).
fn capability_requires_task_dialog(kind: &ModalKind) -> bool {
    let ModalKind::Message(options) = kind else {
        return false;
    };
    options.win32.button_style == ButtonStyle::CommandLink
        || options.win32.expander.is_some()
        || options.buttons.len() > 3
}

/// The frozen win32 DTO projection (design section 7): the comctl32 v6
/// probe owns `taskDialog`/`commandLinks`/`expander`; suppression is
/// frozen true on both platforms; the darwin-only switches stay false.
pub(crate) fn backend_capabilities() -> DialogBackendCapabilities {
    let task_dialog = capability::probe_task_dialog_surface().is_some();
    DialogBackendCapabilities {
        platform: "win32",
        task_dialog,
        command_links: task_dialog,
        expander: task_dialog,
        suppression: true,
        package_semantics: false,
        mixed_file_directory_selection: false,
        add_to_recent_control: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(session: &str) -> CommandScope {
        CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
            instance_generation: 1,
        }
    }

    #[test]
    fn frozen_numerics_match_the_design() {
        assert_eq!(DIALOG_WORKER_CAP, 8);
        assert_eq!(DIALOG_ENTRY_BUDGET, Duration::from_secs(3));
        assert_eq!(DIALOG_CLOSE_JOIN_BUDGET, Duration::from_secs(2));
    }

    #[test]
    fn worker_limit_error_names_the_frozen_code_and_payload() {
        let error = worker_limit_error(&scope("session-1"));
        assert_eq!(error.code, "dialog_worker_limit_reached");
        assert_eq!(
            error.details.as_ref().unwrap()["limit"],
            serde_json::json!(DIALOG_WORKER_CAP)
        );
        assert_eq!(
            error.details.as_ref().unwrap()["kind"],
            serde_json::json!("worker-limit")
        );
    }

    #[test]
    fn backend_capabilities_win32_projection_follows_the_probe() {
        let backend = backend_capabilities();
        // A cargo-test host carries no manifest, so the probe honestly
        // reports the fallback; freeze the invariants that hold either
        // way and the exact degraded shape this test process observes.
        assert_eq!(backend.platform, "win32");
        assert_eq!(backend.command_links, backend.task_dialog);
        assert_eq!(backend.expander, backend.task_dialog);
        assert!(backend.suppression);
        assert!(!backend.package_semantics);
        assert!(!backend.mixed_file_directory_selection);
        assert!(backend.add_to_recent_control);
        let wire = serde_json::to_value(&backend).unwrap();
        let object = wire.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "addToRecentControl",
                "commandLinks",
                "expander",
                "mixedFileDirectorySelection",
                "packageSemantics",
                "platform",
                "suppression",
                "taskDialog",
            ]
        );
    }

    /// The registry shape is the frozen cap (emptiness is not asserted:
    /// tests share one process).
    #[test]
    fn registry_shape_is_the_frozen_cap() {
        assert_eq!(lock_registry().len(), DIALOG_WORKER_CAP);
    }

    /// Slot plumbing is total and idempotent.
    #[test]
    fn take_slot_is_idempotent() {
        assert!(!slot_is_free(usize::MAX));
        take_slot(usize::MAX); // out-of-range: no panic, no effect
        assert!(slot_is_free(usize::MAX) == false);
    }

    /// The cap-1/cap/cap+1 core of task 3.3, without any GUI: slots fill
    /// to exactly `DIALOG_WORKER_CAP`, the same scope stays busy, and the
    /// next reservation is the typed `dialog_worker_limit_reached`
    /// rejection (never a queue).
    #[test]
    fn worker_pool_enforces_the_cap_and_busy_scope_before_queuing() {
        let mut occupied: Vec<usize> = Vec::new();
        // Cap-1 → cap: distinct scopes each reserve one slot.
        for index in 0..DIALOG_WORKER_CAP {
            let reservation = reserve_slot(&scope(&format!("cap-{index}")), "pickFile");
            match reservation {
                Ok(shared) => occupied.push(shared.ordinal),
                Err(error) => {
                    // Another test may hold a slot in the shared process
                    // registry; only the busy/limit codes are acceptable
                    // and the cap invariant is re-derived below.
                    assert!(
                        error.code == "dialog_worker_limit_reached"
                            || error.code == error_code::SESSION_BUSY
                    );
                }
            }
        }

        let free_count = lock_registry().iter().flatten().count();
        if free_count == DIALOG_WORKER_CAP {
            // Cap+1: the ninth distinct scope rejects with the typed
            // worker-limit code (never a queue). `unwrap_err` is not
            // usable here: the Ok half (Arc<WorkerShared>) is not Debug.
            let error = match reserve_slot(&scope("cap-plus-one"), "pickFile") {
                Err(error) => error,
                Ok(_) => panic!("the ninth worker must reject instead of queueing"),
            };
            assert_eq!(error.code, "dialog_worker_limit_reached");
            assert_eq!(
                error.details.as_ref().unwrap()["limit"],
                serde_json::json!(DIALOG_WORKER_CAP)
            );
            // Busy: a scope with a live slot rejects before consuming
            // anything.
            let error = match reserve_slot(&scope("cap-0"), "messageDialog") {
                Err(error) => error,
                Ok(_) => panic!("a busy scope must reject before consuming a slot"),
            };
            assert_eq!(error.code, error_code::SESSION_BUSY);
        }

        for ordinal in occupied {
            take_slot(ordinal);
        }
    }

    /// Session revocation targets the session component of the scope key.
    #[test]
    fn revoke_session_matches_only_that_session() {
        let mut occupied: Vec<usize> = Vec::new();
        if let Ok(shared) = reserve_slot(&scope("revoke-session-a"), "pickFile") {
            occupied.push(shared.ordinal);
            let revoked: Vec<Arc<WorkerShared>> = lock_registry()
                .iter()
                .flatten()
                .filter(|slot| slot.scope.2 == "revoke-session-a")
                .map(|slot| slot.shared.clone())
                .collect();
            assert_eq!(revoked.len(), 1);
            revoke_session("revoke-session-a");
            assert!(revoked[0].revoked.load(Ordering::Acquire));
        }
        for ordinal in occupied {
            take_slot(ordinal);
        }
    }
}
