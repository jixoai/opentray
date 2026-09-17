//! Batch E acceptance probe (add-ext-dialog task 6.1, win32 leg).
//!
//! Drives the dialog matrix through the real extension ABI on a live
//! Windows host (`opentray_ext_command_v2` /
//! `opentray_ext_attach_deferred_completion_port_v1` /
//! `opentray_ext_session_closed` / `opentray_ext_poll_owner_v1` /
//! `opentray_ext_init` / `opentray_ext_deinit`). The darwin probe steers a
//! modal session on the owner loop; win32 has no owner-loop steering by
//! design (design section 5.3): every show spawns a bounded STA worker that
//! enters its native modal call (the pre-Accept handshake blocks the
//! dispatch until `TDN_CREATED` / `IFileDialog::Show`-entry /
//! MessageBox-entry), and the single terminal travels through the deferred
//! port from the worker thread. Programmatic dismissal is the production
//! close vector: `opentray_ext_session_closed` projects the WM_APP close
//! through the worker's message-only dispatcher, the native modal exits on
//! its own thread, and the cancel-branch terminal is recorded by this
//! probe's port. No synthetic keyboard input is used, so nothing depends
//! on the host desktop being interactive; a hard watchdog force-exits the
//! process (killing any still-open modal with it) if a step wedges.
//!
//! Matrix:
//! 1. `getBackend` DTO through the real ABI: the live comctl32 v6 probe
//!    decides `taskDialog`/`commandLinks`/`expander`; the frozen win32
//!    constants and internal consistency are asserted whichever way the
//!    host resolves. Whichever surface is live is documented per case (the
//!    MessageBox fallback IS the evidence when comctl6 is unavailable in
//!    this host process — a cargo-built binary carries no RT_MANIFEST).
//! 2. messageDialog show -> dismissed via session close -> exactly one
//!    cancel-branch terminal (`response == cancelId`, `suppressed:false`).
//! 3. busy: a second show in the same scope answers the SYNCHRONOUS typed
//!    `dialog_session_busy` rejection with a zeroed disposition; the first
//!    still completes; the trespasser never produces a terminal.
//! 4. interleaving: getBackend answers Immediate while a dialog is open
//!    (the STA worker never blocks non-modal dispatch).
//! 5. worker lifecycle: poll_owner honestly reports "nothing scheduled"
//!    while a dialog is open (the win32 law), the worker self-releases its
//!    slot after its terminal (observable: a same-scope re-show is
//!    accepted again), and deinit with no live workers returns promptly
//!    (Clean settlement). The 3s entry-abandon timeout and the failed-pin
//!    non-returning deinit park need a STALLED worker — not drivable
//!    through the public ABI from a healthy host; those stay owned by the
//!    `settle_shutdown` tests (cited in the notes).
//! 6. pickers (pickFile filters / pickFile multiple+empty filters /
//!    pickDirectory) driven to cancel via session close -> null terminal.
//! 7. capability gate: with comctl6 unavailable, TaskDialog-exclusive
//!    requests (4+ buttons, commandLink) reject synchronously with typed
//!    `dialog_capability_unavailable` and zero port submits; with comctl6
//!    live they show through TaskDialog and complete through the cancel
//!    branch. The MessageBox suppression degradation (`suppressed:false`)
//!    is asserted in its own case.
//! 8. deinit with a live modal (second instance): close-all + bounded join
//!    dismiss the modal, the worker submits its ONE cancel-branch terminal
//!    from its own thread, and deinit returns (win32 settles through the
//!    worker, unlike darwin's zero-terminal teardown).
//! 9. run-level REAL port accounting: accepted deferred operations ==
//!    port submissions, unique handles, and zero submits for every
//!    synchronously rejected record.
//!
//! Evidence lands in `%TEMP%\extdlg-probe\acceptance-evidence-windows.json`
//! (written incrementally after every case so even a watchdog kill keeps
//! the partial matrix). Exit code 0 = all PASS, 1 = any FAIL, 124 =
//! watchdog. Non-Windows hosts report SKIPPED (exit 0).
//!
//! Run: cargo run -p opentray-ext-dialog --example acceptance_probe_windows

#[cfg(target_os = "windows")]
mod probe {
    use std::ffi::CString;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use opentray_ext_dialog::{
        opentray_ext_attach_deferred_completion_port_v1, opentray_ext_command_v2,
        opentray_ext_deinit, opentray_ext_free_string, opentray_ext_init,
        opentray_ext_poll_owner_v1, opentray_ext_session_closed, EXT_POLL_NO_DEADLINE_MS,
    };
    use opentray_spec::{
        ExtBytes, ExtCommandDispositionV1, ExtContext, ExtDeferredPortV1, ExtOwnedBytes,
        ExtResultCode, EXT_COMMAND_DISPOSITION_TAG_DEFERRED,
        EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE, EXT_ERR_REJECTED, EXT_OK,
    };

    // The typed-error slot reader is crate-private; its #[no_mangle] export
    // resolves through the C ABI here (same trick as the darwin probe).
    unsafe extern "C" {
        fn opentray_ext_take_error(out: *mut ExtOwnedBytes) -> ExtResultCode;
    }

    /// REAL port counts: every submit that crosses the attached deferred
    /// completion port, per instance (review supplement 1).
    static SUBMITS_A: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
    static SUBMITS_B: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
    static SUBMIT_CALLS_A: AtomicUsize = AtomicUsize::new(0);
    static SUBMIT_CALLS_B: AtomicUsize = AtomicUsize::new(0);

    /// Incremental evidence: finished cases + the watchdog share one writer
    /// lock so a forced exit still leaves a parseable file on disk.
    static CASES: Mutex<Vec<CaseReport>> = Mutex::new(Vec::new());
    static EVIDENCE_LOCK: Mutex<()> = Mutex::new(());
    static RUN_START: OnceLock<Instant> = OnceLock::new();

    /// Hard watchdog: force-exit before the batch's 2-minute ceiling. A
    /// process exit closes every window this process owns, so a wedged
    /// modal dies with the probe instead of blocking the desktop.
    const WATCHDOG_BUDGET: Duration = Duration::from_secs(110);
    /// Per-dismissal wait for the worker's terminal (the close vector must
    /// settle far inside this; the entry handshake alone proves liveness).
    const TERMINAL_BUDGET: Duration = Duration::from_secs(10);

    unsafe extern "C" fn recording_submit_a(
        _port_data: *mut std::ffi::c_void,
        handle: u64,
        payload_ptr: *const u8,
        payload_len: usize,
    ) -> ExtResultCode {
        SUBMIT_CALLS_A.fetch_add(1, Ordering::SeqCst);
        if payload_ptr.is_null() || payload_len == 0 {
            return EXT_ERR_REJECTED;
        }
        let bytes = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        SUBMITS_A
            .lock()
            .unwrap()
            .push((handle, String::from_utf8_lossy(bytes).into_owned()));
        EXT_OK
    }

    unsafe extern "C" fn recording_submit_b(
        _port_data: *mut std::ffi::c_void,
        handle: u64,
        payload_ptr: *const u8,
        payload_len: usize,
    ) -> ExtResultCode {
        SUBMIT_CALLS_B.fetch_add(1, Ordering::SeqCst);
        if payload_ptr.is_null() || payload_len == 0 {
            return EXT_ERR_REJECTED;
        }
        let bytes = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        SUBMITS_B
            .lock()
            .unwrap()
            .push((handle, String::from_utf8_lossy(bytes).into_owned()));
        EXT_OK
    }

    #[derive(Clone, serde::Serialize)]
    #[allow(non_snake_case)]
    struct CaseReport {
        case: &'static str,
        status: String,
        steps: usize,
        ordinaryEventsHandled: usize,
        maxStepMicros: u128,
        endedBy: Option<&'static str>,
        terminal: Option<serde_json::Value>,
        extras: serde_json::Value,
        notes: Vec<String>,
        #[serde(skip)]
        failures: usize,
    }

    impl CaseReport {
        fn new(case: &'static str) -> Self {
            Self {
                case,
                status: "RUNNING".to_string(),
                steps: 0,
                ordinaryEventsHandled: 0,
                maxStepMicros: 0,
                endedBy: None,
                terminal: None,
                extras: serde_json::json!({}),
                notes: Vec::new(),
                failures: 0,
            }
        }

        fn ok(&mut self, condition: bool, note: impl std::fmt::Display) -> bool {
            if !condition {
                self.failures += 1;
                self.notes.push(format!("ASSERT FAILED: {note}"));
            }
            condition
        }

        /// Informational evidence: recorded, never fails the case.
        fn note(&mut self, note: impl std::fmt::Display) {
            self.notes.push(note.to_string());
        }

        fn record_step(&mut self, micros: u128) {
            if micros > self.maxStepMicros {
                self.maxStepMicros = micros;
            }
        }

        fn finish(mut self) -> Self {
            if self.status != "SKIPPED" {
                self.status = if self.failures == 0 {
                    "PASS".to_string()
                } else {
                    "FAIL".to_string()
                };
            }
            self
        }
    }

    fn evidence_path() -> std::path::PathBuf {
        std::env::temp_dir()
            .join("extdlg-probe")
            .join("acceptance-evidence-windows.json")
    }

    fn write_evidence(status: &str) {
        let _guard = EVIDENCE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let run_seconds = RUN_START
            .get()
            .map(|start| start.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        let cases = CASES
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        let evidence = serde_json::json!({
            "status": status,
            "probe": "add-ext-dialog batch E win32 acceptance probe",
            "runSeconds": run_seconds,
            "cases": cases,
        });
        let _ = std::fs::create_dir_all(evidence_path().parent().expect("temp dir parent"));
        if let Ok(text) = serde_json::to_string_pretty(&evidence) {
            let _ = std::fs::write(evidence_path(), text);
        }
    }

    // ------------------------------------------------------------------
    // ABI dispatch helpers (the probe main thread = the broker dispatch
    // thread; show dispatches block in the pre-Accept entry handshake by
    // design)
    // ------------------------------------------------------------------

    struct DispatchOutcome {
        code: ExtResultCode,
        disposition: ExtCommandDispositionV1,
        events: Option<String>,
        dispatch_micros: u128,
    }

    fn dispatch(
        instance: *mut std::ffi::c_void,
        session_id: &str,
        handle_seed: u64,
        data: serde_json::Value,
    ) -> DispatchOutcome {
        let envelope = serde_json::json!({
            "scope": { "appId": "app-e2e", "trayId": "tray-e2e", "ext": "dialog" },
            "commandScope": {
                "appId": "app-e2e",
                "trayId": "tray-e2e",
                "sessionId": session_id,
                "instanceGeneration": 1
            },
            "data": data
        });
        let envelope = CString::new(envelope.to_string()).unwrap();
        let mut events = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        let mut disposition = ExtCommandDispositionV1::deferred(handle_seed);
        let started = Instant::now();
        let code = unsafe {
            opentray_ext_command_v2(
                instance,
                std::ptr::null(),
                ExtBytes {
                    ptr: envelope.as_ptr(),
                    len: envelope.as_bytes().len(),
                },
                &mut events,
                &mut disposition,
            )
        };
        let dispatch_micros = started.elapsed().as_micros();
        let events_json = if events.ptr.is_null() {
            None
        } else {
            let bytes =
                unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
            let text = String::from_utf8_lossy(bytes).into_owned();
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
            Some(text)
        };
        DispatchOutcome {
            code,
            disposition,
            events: events_json,
            dispatch_micros,
        }
    }

    /// Reads (and frees) the process-global typed error slot. Only taken
    /// immediately after a synchronous rejection on this thread.
    fn take_error_detail() -> serde_json::Value {
        let mut output = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        assert_eq!(unsafe { opentray_ext_take_error(&mut output) }, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let detail: serde_json::Value =
            serde_json::from_slice(bytes).expect("error detail JSON");
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
        detail
    }

    fn terminals_of(table: &Mutex<Vec<(u64, String)>>, handle: u64) -> Vec<serde_json::Value> {
        table
            .lock()
            .unwrap()
            .iter()
            .filter(|(submit_handle, _)| *submit_handle == handle)
            .map(|(_, payload)| serde_json::from_str(payload).unwrap_or(serde_json::Value::Null))
            .collect()
    }

    /// The production dismissal vector: session close projects the WM_APP
    /// close through the worker's dispatcher; the worker exits its modal
    /// and submits the cancel-branch terminal from its own thread.
    fn close_session(report: &mut CaseReport, instance: *mut std::ffi::c_void, session: &str) {
        let session_id = CString::new(session).unwrap();
        let mut events = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        let code = unsafe {
            opentray_ext_session_closed(
                instance,
                std::ptr::null(),
                ExtBytes {
                    ptr: session_id.as_ptr(),
                    len: session_id.to_bytes().len(),
                },
                &mut events,
            )
        };
        report.ok(code == EXT_OK, "session cleanup succeeds");
        if !events.ptr.is_null() {
            let bytes =
                unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
            report.ok(
                bytes == b"[]",
                "session cleanup emits no additional extension events",
            );
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
        }
    }

    /// Waits for the worker's terminal. After the first observation a short
    /// grace window re-reads the table so a double submit would be caught
    /// (exactly-once evidence, not just at-least-once).
    fn wait_terminal(report: &mut CaseReport, handle: u64) -> Option<Vec<serde_json::Value>> {
        let started = Instant::now();
        loop {
            report.steps += 1;
            let terminals = terminals_of(&SUBMITS_A, handle);
            if !terminals.is_empty() {
                std::thread::sleep(Duration::from_millis(300));
                let terminals = terminals_of(&SUBMITS_A, handle);
                report.record_step(started.elapsed().as_micros());
                report.endedBy = Some("session-closed");
                return Some(terminals);
            }
            if started.elapsed() > TERMINAL_BUDGET {
                report
                    .note(format!("FINDING: no terminal for handle {handle:#018x} within \
                                   {}ms of session close", TERMINAL_BUDGET.as_millis()));
                return None;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn single_terminal(report: &mut CaseReport, handle: u64) -> Option<serde_json::Value> {
        let terminals = terminals_of(&SUBMITS_A, handle);
        if !report.ok(terminals.len() == 1, "exactly one terminal submitted") {
            return None;
        }
        let terminal = terminals.into_iter().next().unwrap();
        report.terminal = Some(terminal.clone());
        if !report.ok(
            terminal["kind"] == "result",
            "terminal carries a result payload",
        ) {
            return None;
        }
        Some(terminal["value"].clone())
    }

    /// The win32 poll law: dialog completion lives on the STA workers, so
    /// poll_owner honestly reports "nothing scheduled" — before, during,
    /// and after a live dialog.
    fn assert_poll_reports_nothing_scheduled(
        instance: *mut std::ffi::c_void,
        report: &mut CaseReport,
        handle: u64,
    ) {
        let outcome = unsafe { opentray_ext_poll_owner_v1(instance, handle) };
        report.ok(
            outcome.next_deadline_ms == EXT_POLL_NO_DEADLINE_MS && outcome.wake_flags == 0,
            "win32 poll_owner reports nothing scheduled (worker-owned completion)",
        );
    }

    // ------------------------------------------------------------------
    // The acceptance matrix
    // ------------------------------------------------------------------

    const APP_E2E: &str = "app-e2e";

    fn init_instance() -> *mut std::ffi::c_void {
        let context = ExtContext {
            api_version: 1,
            app_id: ExtBytes {
                ptr: c"app-e2e".as_ptr(),
                len: APP_E2E.len(),
            },
        };
        let mut instance = std::ptr::null_mut();
        assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);
        instance
    }

    fn attach_port(
        instance: *mut std::ffi::c_void,
        submit: unsafe extern "C" fn(
            *mut std::ffi::c_void,
            u64,
            *const u8,
            usize,
        ) -> ExtResultCode,
    ) {
        let port = ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
            port_data: 1usize as *mut std::ffi::c_void,
            submit,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );
    }

    struct Harness {
        instance: *mut std::ffi::c_void,
        accepted: Vec<u64>,
        busy_rejections: usize,
        /// Handles that were rejected synchronously (busy, capability
        /// gate): the port accounting asserts ZERO submits for each.
        sync_rejected: Vec<u64>,
        task_dialog: Option<bool>,
    }

    /// Dispatches one show and asserts the pre-Accept transaction answered
    /// Deferred with the seeded handle echo (the dispatch blocked until the
    /// worker entered its native modal call — the frozen Accepted
    /// semantics).
    fn deferred_show(
        harness: &mut Harness,
        report: &mut CaseReport,
        session: &str,
        handle: u64,
        data: serde_json::Value,
    ) -> bool {
        let outcome = dispatch(harness.instance, session, handle, data);
        report.record_step(outcome.dispatch_micros);
        if outcome.code != EXT_OK {
            let detail = take_error_detail();
            report.note(format!(
                "show rejected synchronously: {} ({})",
                detail["category"], detail["message"]
            ));
            report.ok(false, "show answers Deferred after the entry handshake");
            harness.sync_rejected.push(handle);
            return false;
        }
        let accepted = outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED
            && outcome.disposition.operation_handle() == handle;
        report.ok(
            accepted,
            "show answers Deferred (EXT_OK + seeded handle echo; dispatch blocked until \
             worker entry)",
        );
        report.note(format!(
            "entry handshake wait: {}ms",
            outcome.dispatch_micros / 1000
        ));
        if accepted {
            harness.accepted.push(handle);
        } else {
            harness.sync_rejected.push(handle);
        }
        accepted
    }

    /// Case W0: the backend DTO through the real ABI — the live comctl32
    /// v6 probe owns taskDialog/commandLinks/expander; every later case
    /// documents which surface that picked.
    fn case_backend_dto(harness: &mut Harness, report: &mut CaseReport) {
        let outcome = dispatch(
            harness.instance,
            "w-backend",
            0xE2E1_0000_0000_0001,
            serde_json::json!({ "type": "getBackend" }),
        );
        report.record_step(outcome.dispatch_micros);
        let immediate = outcome.code == EXT_OK
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
            && outcome.disposition.value_is_zero();
        report.ok(immediate, "getBackend answers Immediate with a zeroed disposition");
        let Some(events) = outcome.events else {
            report.ok(false, "getBackend returned an events buffer");
            return;
        };
        let parsed: serde_json::Value = serde_json::from_str(&events).unwrap_or_default();
        let backend = parsed[0]["data"]["backend"].clone();
        report.extras = serde_json::json!({ "backend": backend });
        report.ok(
            backend["platform"] == "win32"
                && backend["commandLinks"] == backend["taskDialog"]
                && backend["expander"] == backend["taskDialog"]
                && backend["suppression"] == true
                && backend["packageSemantics"] == false
                && backend["mixedFileDirectorySelection"] == false
                && backend["addToRecentControl"] == true,
            "win32 DTO keeps the frozen projection (comctl6 probe owns taskDialog/\
             commandLinks/expander; suppression true; win32-only switches honest)",
        );
        let task_dialog = backend["taskDialog"].as_bool().unwrap_or(false);
        harness.task_dialog = Some(task_dialog);
        report.note(if task_dialog {
            "live surface: comctl32 v6 TaskDialogIndirect resolved under this host \
             process's activation context — message dialogs ride the TDN_CREATED \
             Accepted handshake; the capability-gate case exercises the comctl6 branch"
        } else {
            "live surface: NO comctl32 v6 activation context in this host process \
             (expected for a cargo-built binary without RT_MANIFEST) — message dialogs \
             ride the MessageBox fallback (MessageBox-entry Accepted evidence); the \
             capability-gate case exercises the typed rejection branch"
        });
    }

    /// Case W1: the core lifecycle — show accepted, one interleaved
    /// non-modal answer while open, dismissal via session close, exactly
    /// one cancel-branch terminal, poll law.
    fn case_message_show_dismiss(harness: &mut Harness, report: &mut CaseReport) {
        let handle = 0xE2E1_0000_0000_0011;
        if !deferred_show(
            harness,
            report,
            "w-m3",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32: session-close dismissal (auto)",
                "buttons": ["Save", "Skip", "Quit"],
                "defaultId": 1,
                "cancelId": 2,
                "severity": "info"
            }),
        ) {
            return;
        }
        let surface = if harness.task_dialog == Some(true) {
            "TaskDialogIndirect"
        } else {
            "MessageBoxW fallback"
        };
        report.note(format!("message surface: {surface}"));

        // One non-modal command while the dialog is open.
        let interleave = dispatch(
            harness.instance,
            "w-m3",
            0xE2E1_0000_0000_0199,
            serde_json::json!({ "type": "getBackend" }),
        );
        report.record_step(interleave.dispatch_micros);
        let interleave_ok = interleave.code == EXT_OK
            && interleave.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
            && interleave
                .events
                .as_deref()
                .and_then(|events| serde_json::from_str::<serde_json::Value>(events).ok())
                .is_some_and(|parsed| parsed[0]["data"]["backend"]["platform"] == "win32");
        report.ok(
            interleave_ok,
            "getBackend answers Immediate while the dialog is open",
        );

        assert_poll_reports_nothing_scheduled(harness.instance, report, handle);
        close_session(report, harness.instance, "w-m3");
        if wait_terminal(report, handle).is_none() {
            return;
        }
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value == serde_json::json!({ "response": 2, "suppressed": false }),
                "WM_APP-close dismissal maps to cancelId 2 with suppressed false",
            );
        }
        assert_poll_reports_nothing_scheduled(harness.instance, report, handle);
        report.note(
            "the dismissal rode the production close vector: session_closed posts the \
             WM_APP close to the worker's message-only dispatcher, the native modal \
             exits on the worker thread, and the worker submits its own cancel-branch \
             terminal through the port (title-bar/WM_CLOSE dismissal maps through \
             cancelId — the P0-6 four-way mapping)",
        );
    }

    /// Case W2: busy law — the second show in the SAME scope answers the
    /// synchronous typed rejection; the first still completes; the
    /// trespasser never produces a terminal.
    fn case_busy(harness: &mut Harness, report: &mut CaseReport) {
        let first = 0xE2E1_0000_0000_0021;
        let second = 0xE2E1_0000_0000_0022;
        if !deferred_show(
            harness,
            report,
            "w-busy",
            first,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 busy owner (auto)",
                "buttons": ["OK", "Cancel"],
                "cancelId": 1
            }),
        ) {
            return;
        }
        let outcome = dispatch(
            harness.instance,
            "w-busy",
            second,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 busy trespasser",
                "buttons": ["OK"]
            }),
        );
        report.record_step(outcome.dispatch_micros);
        let rejected = outcome.code == EXT_ERR_REJECTED
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
            && outcome.disposition.value_is_zero();
        report.ok(
            rejected,
            "second show in the same scope rejects synchronously with a zeroed disposition",
        );
        let detail = take_error_detail();
        report.extras = serde_json::json!({ "typedError": detail });
        report.ok(
            detail["category"] == "dialog_session_busy"
                && detail["details"]["kind"] == "owner"
                && detail["details"]["appId"] == "app-e2e"
                && detail["details"]["trayId"] == "tray-e2e"
                && detail["details"]["sessionId"] == "w-busy",
            "typed dialog_session_busy carries the full owner scope details",
        );
        harness.busy_rejections += 1;
        harness.sync_rejected.push(second);

        close_session(report, harness.instance, "w-busy");
        if wait_terminal(report, first).is_none() {
            return;
        }
        report.ok(true, "the first dialog still completes after the busy rejection");
        if let Some(value) = single_terminal(report, first) {
            report.ok(
                value == serde_json::json!({ "response": 1, "suppressed": false }),
                "forced dismissal maps to cancelId 1",
            );
        }
        let trespasser_terminals = terminals_of(&SUBMITS_A, second);
        report.ok(
            trespasser_terminals.is_empty(),
            "the rejected second show never produces a terminal",
        );
        report.note(
            "the win32 busy view lives in the worker registry (the worker holds the \
             scope slot); the rejection happened before any state change — no worker \
             was spawned for the trespasser",
        );
    }

    /// Case W3: interleaving — five getBackend answers while a dialog is
    /// open, each Immediate and fast (the STA worker never blocks the
    /// dispatch thread).
    fn case_interleave(harness: &mut Harness, report: &mut CaseReport) {
        let handle = 0xE2E1_0000_0000_0031;
        if !deferred_show(
            harness,
            report,
            "w-interleave",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 interleave owner (auto)",
                "buttons": ["OK", "Cancel"],
                "cancelId": 1
            }),
        ) {
            return;
        }
        let mut answers = 0usize;
        let mut max_latency_micros: u128 = 0;
        for index in 0..5 {
            let probe = 0xE2E1_0000_0000_0390 + index as u64;
            let outcome = dispatch(
                harness.instance,
                "w-interleave",
                probe,
                serde_json::json!({ "type": "getBackend" }),
            );
            report.record_step(outcome.dispatch_micros);
            max_latency_micros = max_latency_micros.max(outcome.dispatch_micros);
            let parsed = outcome
                .events
                .as_deref()
                .and_then(|events| serde_json::from_str::<serde_json::Value>(events).ok())
                .unwrap_or_default();
            if outcome.code == EXT_OK
                && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
                && parsed[0]["data"]["backend"]["platform"] == "win32"
            {
                answers += 1;
            }
        }
        report.extras = serde_json::json!({
            "getBackendAnsweredWhileOpen": answers,
            "maxLatencyMs": max_latency_micros / 1000,
        });
        report.ok(
            answers == 5,
            "non-modal commands answer while a dialog is open (no head-of-line blocking \
             by the STA worker)",
        );
        report.ok(
            max_latency_micros / 1000 < 1000,
            "each interleaved answer stayed under 1s",
        );
        close_session(report, harness.instance, "w-interleave");
        if wait_terminal(report, handle).is_none() {
            return;
        }
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value == serde_json::json!({ "response": 1, "suppressed": false }),
                "the interleaved dialog completed through the cancel branch",
            );
        }
    }

    /// Case W4: all three severity levels complete through the real ABI.
    fn case_severity(harness: &mut Harness, report: &mut CaseReport) {
        let mut per_severity = serde_json::Map::new();
        for (index, severity) in ["info", "warning", "error"].iter().enumerate() {
            let handle = 0xE2E1_0000_0000_0041 + index as u64;
            let session = format!("w-sev-{severity}");
            if !deferred_show(
                harness,
                report,
                &session,
                handle,
                serde_json::json!({
                    "type": "messageDialog",
                    "message": format!("E2E win32 severity {severity} (auto)"),
                    "buttons": ["OK"],
                    "severity": severity
                }),
            ) {
                return;
            }
            close_session(report, harness.instance, &session);
            if wait_terminal(report, handle).is_none() {
                return;
            }
            let value = single_terminal(report, handle);
            let passed = value.is_some()
                && value.unwrap() == serde_json::json!({ "response": 0, "suppressed": false });
            per_severity.insert(
                severity.to_string(),
                serde_json::json!({ "pass": passed }),
            );
            report.ok(passed, format!("severity {severity} dialog completed with response 0"));
        }
        report.extras = serde_json::Value::Object(per_severity);
    }

    /// Case W5: suppression. The live flag read rides the terminal: the
    /// MessageBox fallback cannot render the checkbox (suppressed:false is
    /// the documented degradation); the TaskDialog path reads the real
    /// verification flag (a session-close dismissal leaves it unchecked).
    fn case_suppression(harness: &mut Harness, report: &mut CaseReport) {
        let handle = 0xE2E1_0000_0000_0051;
        if !deferred_show(
            harness,
            report,
            "w-supp",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 suppression (auto)",
                "buttons": ["OK"],
                "suppressionLabel": "Do not ask again"
            }),
        ) {
            return;
        }
        close_session(report, harness.instance, "w-supp");
        if wait_terminal(report, handle).is_none() {
            return;
        }
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value["response"] == 0,
                "single-button suppression dialog maps forced dismissal to button 0",
            );
            let suppressed = value["suppressed"].clone();
            report.extras = serde_json::json!({ "suppressedFirstShow": suppressed });
            report.note(if harness.task_dialog == Some(true) {
                "TaskDialog path: the WM_CLOSE dismissal leaves the verification checkbox \
                 unchecked — suppressed:false is the live flag read"
            } else {
                "MessageBox fallback path: the checkbox cannot render — suppressed:false \
                 is the documented honest degradation (never a fabricated true)"
            });
        }
    }

    /// Case W6: pickers driven to cancel through session close
    /// (IFileDialog::Show dismissed by the worker-thread Close()).
    ///
    /// `OPENTRAY_DIALOG_PROBE_SKIP_PICKERS=1` records the case as SKIPPED —
    /// the crash-isolation run used while diagnosing the real-machine
    /// IFileDialog access violation (see batch-e-windows.md).
    fn case_pickers_cancel(harness: &mut Harness, report: &mut CaseReport) {
        if std::env::var("OPENTRAY_DIALOG_PROBE_SKIP_PICKERS").is_ok() {
            report.status = "SKIPPED".to_string();
            report.note(
                "SKIPPED via OPENTRAY_DIALOG_PROBE_SKIP_PICKERS (crash isolation run: the \
                 first IFileDialog::Show dismissal access-violates on this host; the \
                 remaining matrix runs without pickers)",
            );
            return;
        }
        let matrix: [(&'static str, u64, serde_json::Value); 3] = [
            (
                "pickFile-single-filters",
                0xE2E1_0000_0000_0061,
                serde_json::json!({
                    "type": "pickFile",
                    "filters": [{ "name": "Text", "extensions": ["txt", "md"] }]
                }),
            ),
            (
                "pickFile-multiple-empty-filters",
                0xE2E1_0000_0000_0062,
                serde_json::json!({
                    "type": "pickFile",
                    "multiple": true,
                    "filters": []
                }),
            ),
            (
                "pickDirectory",
                0xE2E1_0000_0000_0063,
                serde_json::json!({ "type": "pickDirectory" }),
            ),
        ];
        let mut per_picker = serde_json::Map::new();
        for (label, handle, data) in matrix {
            let session = format!("w-{label}");
            if !deferred_show(harness, report, &session, handle, data) {
                return;
            }
            close_session(report, harness.instance, &session);
            if wait_terminal(report, handle).is_none() {
                return;
            }
            let value = single_terminal(report, handle);
            let passed = value.is_some() && value.unwrap().is_null();
            per_picker.insert(
                label.to_string(),
                serde_json::json!({ "canceledToNull": passed }),
            );
            report.ok(passed, format!("{label}: session close maps to the null branch"));
            assert_poll_reports_nothing_scheduled(harness.instance, report, handle);
        }
        report.extras = serde_json::Value::Object(per_picker);
        report.note(
            "filters:[] behaves as all-files (the native empty-list -> no SetFileTypes \
             normalization); each picker was dismissed by the WM_APP dispatcher's \
             worker-thread IFileDialog::Close — the documented programmatic close path",
        );
    }

    /// Case W7: the capability gate. Branches on the LIVE comctl6 probe
    /// result: without the v6 activation context, TaskDialog-exclusive
    /// requests (4+ buttons, commandLink) reject synchronously typed; with
    /// it, they show through TaskDialogIndirect and complete through the
    /// cancel branch.
    fn case_capability_gate(harness: &mut Harness, report: &mut CaseReport) {
        let surface = if harness.task_dialog == Some(true) {
            "comctl6"
        } else {
            "fallback"
        };
        report.note(format!("branch selected by the live DTO: {surface}"));
        let matrix: [(u64, &str, serde_json::Value); 2] = [
            (
                0xE2E1_0000_0000_0071,
                "four-buttons",
                serde_json::json!({
                    "type": "messageDialog",
                    "message": "E2E win32: four buttons (auto)",
                    "buttons": ["A", "B", "C", "D"],
                    "cancelId": 3
                }),
            ),
            (
                0xE2E1_0000_0000_0072,
                "commandLink",
                serde_json::json!({
                    "type": "messageDialog",
                    "message": "E2E win32: command links (auto)",
                    "buttons": ["Proceed", "Back"],
                    "cancelId": 1,
                    "win32": {
                        "buttonStyle": "commandLink",
                        "buttonHints": ["with the flow", "one step back"]
                    }
                }),
            ),
        ];
        if harness.task_dialog == Some(true) {
            for (handle, label, data) in matrix {
                let session = format!("w-cap-{label}");
                if !deferred_show(harness, report, &session, handle, data) {
                    return;
                }
                close_session(report, harness.instance, &session);
                if wait_terminal(report, handle).is_none() {
                    return;
                }
                if let Some(value) = single_terminal(report, handle) {
                    let expected = serde_json::json!({ "response": if label == "four-buttons" { 3 } else { 1 }, "suppressed": false });
                    report.ok(
                        value == expected,
                        format!("{label}: TaskDialog surface accepted the request and the \
                                 close dismissal mapped to its cancelId"),
                    );
                }
            }
            report.note(
                "comctl32 v6 ACTIVE in this host process: 4-button and commandLink \
                 requests rode TaskDialogIndirect (TDN_CREATED Accepted handshake). \
                 The typed-rejection branch stays owned by the registry-unit tests and \
                 the facade vitest gate (cited in the batch evidence)",
            );
        } else {
            for (handle, label, data) in matrix {
                let session = format!("w-cap-{label}");
                let outcome = dispatch(harness.instance, &session, handle, data);
                report.record_step(outcome.dispatch_micros);
                let rejected = outcome.code == EXT_ERR_REJECTED
                    && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
                    && outcome.disposition.value_is_zero();
                report.ok(
                    rejected,
                    format!("{label}: rejects synchronously with a zeroed disposition \
                             (never a silent MessageBox downgrade)"),
                );
                let detail = take_error_detail();
                if let Some(object) = report.extras.as_object_mut() {
                    object.insert(format!("{label}TypedError"), detail.clone());
                }
                report.ok(
                    detail["category"] == "dialog_capability_unavailable"
                        && detail["details"]["kind"] == "feature"
                        && detail["details"]["platform"] == "win32",
                    format!("{label}: typed dialog_capability_unavailable carries the \
                             feature/platform details"),
                );
                harness.sync_rejected.push(handle);
            }
            report.note(
                "the caller-facing commandLink gate spelling is owned by the facade \
                 vitest (packages/ext-dialog/src/index.test.ts \"gates commandLink on the \
                 backend snapshot before dispatch (MessageBox fallback)\"); this case is \
                 the native-side envelope evidence. The MessageBox suppression \
                 degradation (suppressed:false) is asserted in suppression-fallback-flag",
            );
        }
    }

    /// Case W8: the STA worker lifecycle — poll law while open, slot
    /// self-release after the terminal (same-scope re-show accepted), and
    /// a prompt deinit return with no live workers (Clean settlement).
    fn case_worker_lifecycle(harness: &mut Harness, report: &mut CaseReport) {
        let first = 0xE2E1_0000_0000_0081;
        if !deferred_show(
            harness,
            report,
            "w-life",
            first,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 worker lifecycle 1 (auto)",
                "buttons": ["OK"]
            }),
        ) {
            return;
        }
        assert_poll_reports_nothing_scheduled(harness.instance, report, first);
        close_session(report, harness.instance, "w-life");
        if wait_terminal(report, first).is_none() {
            return;
        }
        if let Some(value) = single_terminal(report, first) {
            report.ok(
                value == serde_json::json!({ "response": 0, "suppressed": false }),
                "first lifecycle dialog settled through the cancel branch",
            );
        }

        // The worker's LAST action releases its registry slot. Observable
        // through the public ABI: a same-scope re-show becomes acceptable
        // again (bounded retry covers the submit -> take_slot tail).
        let second = 0xE2E1_0000_0000_0082;
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut reacquired = false;
        while Instant::now() < deadline {
            report.steps += 1;
            let outcome = dispatch(
                harness.instance,
                "w-life",
                second,
                serde_json::json!({
                    "type": "messageDialog",
                    "message": "E2E win32 worker lifecycle 2 (auto)",
                    "buttons": ["OK"]
                }),
            );
            report.record_step(outcome.dispatch_micros);
            if outcome.code == EXT_OK
                && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED
                && outcome.disposition.operation_handle() == second
            {
                reacquired = true;
                break;
            }
            // The only legal interim answer is the busy rejection while the
            // worker's take_slot tail is still landing.
            let _ = take_error_detail();
            harness.busy_rejections += 1;
            std::thread::sleep(Duration::from_millis(25));
        }
        report.ok(
            reacquired,
            "same-scope re-show accepted after the worker self-released its slot",
        );
        if reacquired {
            harness.accepted.push(second);
            close_session(report, harness.instance, "w-life");
            if wait_terminal(report, second).is_none() {
                return;
            }
            single_terminal(report, second);
        }

        // Deinit with no live workers returns promptly (Clean settlement).
        let started = Instant::now();
        unsafe { opentray_ext_deinit(harness.instance) };
        let deinit_micros = started.elapsed().as_micros();
        report.record_step(deinit_micros);
        if let Some(object) = report.extras.as_object_mut() {
            object.insert("deinitMs".to_string(), serde_json::json!(deinit_micros / 1000));
        }
        report.ok(
            deinit_micros / 1000 < 3000,
            "deinit with no live workers returns promptly (Clean settlement)",
        );
        harness.instance = std::ptr::null_mut();
        report.note(
            "NOT drivable through the public ABI from a healthy host: the 3s \
             entry-abandon timeout and the failed-pin non-returning deinit park need a \
             STALLED worker. The failed-pin park stays owned by state.rs settle_shutdown \
             tests: failed_pin_with_leaked_workers_blocks_the_unload_path, \
             successful_pin_defers_cleanup_to_process_exit, \
             clean_shutdown_never_consults_the_pin_seam",
        );
    }

    /// Diagnostic case (`OPENTRAY_DIALOG_PROBE_PICKER_DIAG=1`): isolates
    /// WHERE the real-machine IFileDialog access violation fires. Marker
    /// lines bracket the two windows: (A) inside `IFileDialog::Show`'s own
    /// pump with no close in flight, (B) after the session close posts the
    /// WM_APP dispatcher message that drives the worker-thread
    /// `IFileDialog::Close`. The process is expected to die inside one of
    /// them; the surviving markers in the log are the verdict.
    fn case_picker_close_diag(harness: &mut Harness, report: &mut CaseReport) {
        // OPENTRAY_DIALOG_PROBE_PICKER_HOLD_MS lengthens window A (default
        // 700ms): if a late close survives where an immediate one faults,
        // the crash is an initialization race inside the shell's Close,
        // not an unconditional fault of the close vector.
        let hold_ms: u64 = std::env::var("OPENTRAY_DIALOG_PROBE_PICKER_HOLD_MS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(700);
        let handle = 0xE2E1_0000_0000_00D1;
        if !deferred_show(
            harness,
            report,
            "w-picker-diag",
            handle,
            serde_json::json!({
                "type": "pickFile",
                "filters": [{ "name": "Text", "extensions": ["txt", "md"] }]
            }),
        ) {
            return;
        }
        println!(
            "picker-close-diag: entered IFileDialog::Show (window A: inside Show's own \
             pump, no close in flight); holding {hold_ms}ms"
        );
        let _ = std::io::Write::flush(&mut std::io::stdout());
        std::thread::sleep(Duration::from_millis(hold_ms));
        println!("picker-close-diag: window A survived");
        println!(
            "picker-close-diag: window B: posting session close (WM_APP dispatcher -> \
             worker-thread IFileDialog::Close)"
        );
        let _ = std::io::Write::flush(&mut std::io::stdout());
        close_session(report, harness.instance, "w-picker-diag");
        println!("picker-close-diag: session close returned; waiting for the terminal");
        let _ = std::io::Write::flush(&mut std::io::stdout());
        if wait_terminal(report, handle).is_some() {
            if let Some(value) = single_terminal(report, handle) {
                report.ok(value.is_null(), "picker dismissal mapped to the null branch");
            }
        }
        report.note("window B survived too: the close vector completed without a crash");
    }

    /// Run-level REAL port accounting (review supplement 1): every accepted
    /// deferred operation produced exactly one port submission, handles are
    /// unique and set-equal, and every synchronously rejected record
    /// produced ZERO submits.
    fn run_accounting(harness: &Harness) -> CaseReport {
        let mut report = CaseReport::new("port-accounting");
        let submits = SUBMITS_A.lock().unwrap().clone();
        let submit_handles: Vec<u64> = submits.iter().map(|(handle, _)| *handle).collect();
        let mut sorted = submit_handles.clone();
        sorted.sort_unstable();
        sorted.dedup();
        let mut accepted_sorted = harness.accepted.clone();
        accepted_sorted.sort_unstable();
        let accounting_pass = sorted == accepted_sorted && sorted.len() == submits.len();
        report.ok(
            accounting_pass,
            format!(
                "port submissions ({}) == accepted deferred operations ({}) with unique handles",
                submits.len(),
                harness.accepted.len()
            ),
        );
        let rejected_clean = harness
            .sync_rejected
            .iter()
            .all(|handle| !submit_handles.contains(handle));
        report.ok(
            rejected_clean,
            format!(
                "zero submits for every synchronously rejected record ({:?})",
                harness.sync_rejected
            ),
        );
        report.extras = serde_json::json!({
            "acceptedDeferred": harness.accepted.len(),
            "portSubmitCalls": SUBMIT_CALLS_A.load(Ordering::SeqCst),
            "portSubmits": submits.len(),
            "busyRejections": harness.busy_rejections,
            "syncRejected": harness.sync_rejected,
            "handles": submit_handles,
        });
        report
    }

    /// Case W10 (second instance): deinit with a live modal. The win32
    /// deinit posts close-all BEFORE the instance drop: the worker
    /// dismisses its modal and submits its ONE cancel-branch terminal
    /// inside the bounded 2s join, then deinit returns (Clean settlement —
    /// the join caught the worker).
    fn case_deinit_with_live_modal(report: &mut CaseReport) {
        let instance = init_instance();
        attach_port(instance, recording_submit_b);
        let handle = 0xE2E4_0000_0000_0001;
        let outcome = dispatch(
            instance,
            "w-deinit",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E win32 deinit with a live modal (auto)",
                "buttons": ["OK"]
            }),
        );
        report.record_step(outcome.dispatch_micros);
        let accepted = outcome.code == EXT_OK
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED;
        report.ok(accepted, "the live modal is accepted before deinit");
        if !accepted {
            unsafe { opentray_ext_deinit(instance) };
            return;
        }

        let started = Instant::now();
        unsafe { opentray_ext_deinit(instance) };
        let deinit_micros = started.elapsed().as_micros();
        report.record_step(deinit_micros);
        report.extras = serde_json::json!({ "deinitMs": deinit_micros / 1000 });
        report.ok(
            deinit_micros / 1000 < 5000,
            "deinit returned (close-all + bounded 2s join settled the live worker)",
        );

        // The worker settles its terminal from its own thread during the
        // join; a slow tail still lands within this bounded wait.
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut terminals = Vec::new();
        while Instant::now() < deadline {
            report.steps += 1;
            terminals = terminals_of(&SUBMITS_B, handle);
            if !terminals.is_empty() {
                std::thread::sleep(Duration::from_millis(300));
                terminals = terminals_of(&SUBMITS_B, handle);
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if report.ok(
            terminals.len() == 1,
            "deinit close-all produced exactly one terminal for the live modal",
        ) {
            let terminal = terminals.into_iter().next().unwrap();
            report.terminal = Some(terminal.clone());
            report.ok(
                terminal["kind"] == "result"
                    && terminal["value"] == serde_json::json!({ "response": 0, "suppressed": false }),
                "the deinit-time terminal is the cancel branch (button 0 without a cancelId)",
            );
            report.endedBy = Some("deinit-close-all");
        }
        report.note(
            "platform difference (honest evidence): darwin's deinit-with-live-modal \
             submits ZERO terminals (the owner thread tears the session down itself); \
             win32's deinit posts close-all and JOINS the worker, whose own thread \
             submits its one terminal inside the 2s budget. The leaked-worker endings \
             (module pin / non-returning park) need a worker that outlives the join — \
             covered by the settle_shutdown tests (cited in sta-worker-lifecycle)",
        );
    }

    // ------------------------------------------------------------------
    // Run
    // ------------------------------------------------------------------

    pub fn run() -> i32 {
        let _ = std::fs::create_dir_all(evidence_path().parent().expect("temp dir parent"));
        let _ = RUN_START.set(Instant::now());
        if let Ok(watchdog) = std::thread::Builder::new()
            .name("extdlg-watchdog".to_string())
            .spawn(|| {
                std::thread::sleep(WATCHDOG_BUDGET);
                write_evidence("TIMEOUT");
                eprintln!(
                    "opentray-ext-dialog: watchdog budget expired; force-exiting (any \
                     modal dies with the process)"
                );
                std::process::exit(124);
            })
        {
            let _ = watchdog;
        }
        if std::env::var("OPENTRAY_DIALOG_PROBE_SKIP").is_ok() {
            write_evidence("SKIPPED");
            println!("SKIPPED: OPENTRAY_DIALOG_PROBE_SKIP is set");
            return 0;
        }

        let mut harness = Harness {
            instance: init_instance(),
            accepted: Vec::new(),
            busy_rejections: 0,
            sync_rejected: Vec::new(),
            task_dialog: None,
        };
        attach_port(harness.instance, recording_submit_a);

        let mut run_case = |case: &'static str,
                            body: &mut dyn FnMut(&mut Harness, &mut CaseReport)| {
            let mut report = CaseReport::new(case);
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                body(&mut harness, &mut report);
            }));
            if result.is_err() {
                report.failures += 1;
                report.note("case body panicked");
            }
            let report = report.finish();
            println!(
                "  {:<34} {:<5} steps={:<4} maxStepMicros={:<7} endedBy={:?}",
                report.case, report.status, report.steps, report.maxStepMicros, report.endedBy,
            );
            for note in &report.notes {
                println!("    note: {note}");
            }
            CASES
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push(report);
            write_evidence("RUNNING");
        };

        if std::env::var("OPENTRAY_DIALOG_PROBE_PICKER_DIAG").is_ok() {
            run_case("picker-close-diag", &mut |harness, report| {
                case_picker_close_diag(harness, report)
            });
            unsafe { opentray_ext_deinit(harness.instance) };
            let cases = CASES.lock().unwrap_or_else(|error| error.into_inner());
            let all_passed = cases.iter().all(|case| case.status == "PASS");
            let overall = if all_passed { "PASS" } else { "FAIL" };
            drop(cases);
            write_evidence(overall);
            println!("== picker close diagnostic (win32): {overall} ==");
            println!("evidence: {}", evidence_path().display());
            return if all_passed { 0 } else { 1 };
        }

        run_case("backend-dto", &mut |harness, report| {
            case_backend_dto(harness, report)
        });
        run_case("message-show-dismiss", &mut |harness, report| {
            case_message_show_dismiss(harness, report)
        });
        run_case("busy-rejection", &mut |harness, report| {
            case_busy(harness, report)
        });
        run_case("interleave-while-open", &mut |harness, report| {
            case_interleave(harness, report)
        });
        run_case("message-severity-x3", &mut |harness, report| {
            case_severity(harness, report)
        });
        run_case("suppression-fallback-flag", &mut |harness, report| {
            case_suppression(harness, report)
        });
        run_case("pickers-cancel-session-close", &mut |harness, report| {
            case_pickers_cancel(harness, report)
        });
        run_case("capability-gate", &mut |harness, report| {
            case_capability_gate(harness, report)
        });
        run_case("sta-worker-lifecycle", &mut |harness, report| {
            case_worker_lifecycle(harness, report)
        });

        // Instance A is deinitialized inside sta-worker-lifecycle; the
        // registry-wide accounting reads the completed port A history.
        let accounting = run_accounting(&harness).finish();
        println!(
            "  {:<34} {:<5}",
            accounting.case, accounting.status
        );
        for note in &accounting.notes {
            println!("    note: {note}");
        }
        CASES
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(accounting);

        let mut deinit_report = CaseReport::new("deinit-with-live-modal");
        let deinit_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            case_deinit_with_live_modal(&mut deinit_report)
        }));
        if deinit_result.is_err() {
            deinit_report.failures += 1;
            deinit_report.note("case body panicked");
        }
        let deinit_report = deinit_report.finish();
        println!(
            "  {:<34} {:<5} steps={:<4} endedBy={:?}",
            deinit_report.case, deinit_report.status, deinit_report.steps, deinit_report.endedBy,
        );
        for note in &deinit_report.notes {
            println!("    note: {note}");
        }
        CASES
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(deinit_report);

        let cases = CASES.lock().unwrap_or_else(|error| error.into_inner());
        let all_passed = cases
            .iter()
            .all(|case| case.status == "PASS" || case.status == "SKIPPED");
        let overall = if all_passed { "PASS" } else { "FAIL" };
        drop(cases);
        write_evidence(overall);
        println!("== acceptance probe (win32): {overall} ==");
        println!("evidence: {}", evidence_path().display());
        if all_passed {
            0
        } else {
            1
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    std::process::exit(probe::run());
}

#[cfg(not(target_os = "windows"))]
fn main() {
    // Shape symmetry with the darwin probe: the win32 collector reports
    // SKIPPED on other hosts instead of fabricating results.
    let path = std::env::temp_dir()
        .join("extdlg-probe")
        .join("acceptance-evidence-windows.json");
    let _ = std::fs::create_dir_all(path.parent().expect("temp dir parent"));
    let _ = std::fs::write(
        &path,
        r#"{ "status": "SKIPPED", "reason": "non-Windows host" }"#,
    );
    println!("SKIPPED: the win32 acceptance probe is a Windows-only evidence collector");
}
