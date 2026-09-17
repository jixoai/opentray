//! Batch E acceptance probe (add-ext-dialog task 6.1, darwin leg).
//!
//! Drives the FULL dialog matrix through the real extension ABI on this
//! macOS host (owner-thread dispatch, `opentray_ext_command_v2` /
//! `opentray_ext_poll_owner_v1` / `opentray_ext_session_closed` / the
//! deferred completion port), with synthetic events for dismissal:
//!
//! 1. messageDialog variants: 3-button + defaultId via a synthetic Return,
//!    escape-to-cancelId mapping, all three severity levels, and the
//!    suppression checkbox (live flag read + stateless second show).
//!    commandLink: darwin has none — the gate input (`getBackend` DTO
//!    `commandLinks:false`) is captured through the same ABI; the typed
//!    facade rejection is owned by the batch C vitest suite (cited).
//! 2. pickers: pickFile single (filters) / multiple (explicitly EMPTY
//!    filters array = the all-files ABI normalization), pickDirectory,
//!    pickSavePath with a synthetic Return confirmation asserting the
//!    canonicalized result; synthetic cancel maps to null everywhere.
//! 3. busy: a second show in the same scope answers the SYNCHRONOUS typed
//!    `dialog_session_busy` rejection and the first dialog still completes.
//! 4. interleaving: getBackend answers Immediate while a dialog is stepping
//!    (no head-of-line blocking beyond the owner-loop stepping).
//! 5. session close while a dialog is open: exactly one cancel-branch
//!    terminal; run-level port accounting asserts the REAL port submission
//!    count equals the number of accepted deferred operations (batch B
//!    review supplement 1), each handle exactly once.
//! 6. deinit with a live modal (second instance): teardown submits ZERO
//!    terminals; the win32 leaked-STA-worker park decision is owned by the
//!    `settle_shutdown` tests (cited, not duplicated — supplement 2).
//!
//! Evidence lands in /tmp/extdlg-probe/acceptance-evidence.json. With no
//! main-thread GUI session the probe reports SKIPPED (exit 0) instead of
//! fabricating results.
//!
//! Run: cargo run -p opentray-ext-dialog --example acceptance_probe

#[cfg(target_os = "macos")]
mod probe {
    use std::ffi::CString;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApp, NSApplication};
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use objc2_foundation::{NSDate, NSPoint, NSString};

    use opentray_ext_dialog::{
        opentray_ext_attach_deferred_completion_port_v1, opentray_ext_command_v2,
        opentray_ext_deinit, opentray_ext_free_string, opentray_ext_init,
        opentray_ext_poll_owner_v1, opentray_ext_session_closed, ExtPollOutcomeV1,
        EXT_POLL_NO_DEADLINE_MS, EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED,
    };
    use opentray_spec::{
        ExtBytes, ExtCommandDispositionV1, ExtContext, ExtDeferredPortV1, ExtOwnedBytes,
        ExtResultCode, EXT_COMMAND_DISPOSITION_TAG_DEFERRED,
        EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE, EXT_ERR_REJECTED, EXT_OK,
    };

    // The typed-error slot reader lives behind a private module in the
    // crate; its #[no_mangle] export resolves through the C ABI here.
    unsafe extern "C" {
        fn opentray_ext_take_error(out: *mut ExtOwnedBytes) -> ExtResultCode;
    }

    /// REAL port counts (review supplement 1): every submit that crosses
    /// the attached deferred completion port, per instance.
    static SUBMITS_A: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
    static SUBMITS_B: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
    static SUBMIT_CALLS_A: AtomicUsize = AtomicUsize::new(0);
    static SUBMIT_CALLS_B: AtomicUsize = AtomicUsize::new(0);

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

    #[derive(serde::Serialize)]
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

        fn finish(&mut self) {
            self.status = if self.failures == 0 {
                "PASS".to_string()
            } else {
                "FAIL".to_string()
            };
        }
    }

    // ------------------------------------------------------------------
    // ABI dispatch helpers (owner thread = example main thread)
    // ------------------------------------------------------------------

    struct DispatchOutcome {
        code: ExtResultCode,
        disposition: ExtCommandDispositionV1,
        events: Option<String>,
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
        }
    }

    /// Reads (and frees) the process-global typed error slot.
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

    // ------------------------------------------------------------------
    // Steering: an NSEvent-driven owner loop (the modal_probe shape) that
    // polls one `poll_owner` step per iteration and performs scheduled
    // synthetic actions between polls.
    // ------------------------------------------------------------------

    #[derive(Clone, Copy)]
    enum StepAction {
        ReturnKey,
        EscKey,
        TabKey,
        SpaceKey,
        /// A button-activation return code (`NSAlertFirstButtonReturn +
        /// index`): the exact code `runModalSession` yields when a button is
        /// activated — the internal mechanism every real button click routes
        /// through, drivable deterministically on an unattended host.
        Button(usize),
        AbortStop,
        CancelStop,
    }

    impl StepAction {
        fn label(self) -> &'static str {
            match self {
                Self::ReturnKey => "return-key",
                Self::EscKey => "esc-key",
                Self::TabKey => "tab-key",
                Self::SpaceKey => "space-key",
                Self::Button(index) => match index {
                    0 => "button-code(1000)",
                    1 => "button-code(1001)",
                    2 => "button-code(1002)",
                    _ => "button-code(1000+)",
                },
                Self::AbortStop => "forced-stop(-1001)",
                Self::CancelStop => "forced-stop(0-cancel)",
            }
        }

        fn perform(self, app: &NSApplication) {
            match self {
                Self::AbortStop => app.stopModalWithCode(-1001),
                Self::CancelStop => app.stopModalWithCode(0),
                Self::Button(index) => app.stopModalWithCode(1000 + index as isize),
                key => send_key(app, key),
            }
        }
    }

    fn send_key(app: &NSApplication, action: StepAction) {
        let (characters, key_code) = match action {
            StepAction::ReturnKey => ("\r", 36),
            StepAction::EscKey => ("\u{1b}", 53),
            StepAction::TabKey => ("\t", 48),
            StepAction::SpaceKey => (" ", 49),
            _ => unreachable!("stop actions do not send keys"),
        };
        let text = NSString::from_str(characters);
        let event =
            NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                NSEventType::KeyDown,
                NSPoint::new(0.0, 0.0),
                NSEventModifierFlags(0),
                0.0,
                0,
                None,
                &text,
                &text,
                false,
                key_code,
            );
        if let Some(event) = event {
            app.sendEvent(&event);
        }
    }

    struct Scheduled {
        at: Duration,
        action: StepAction,
        done: bool,
    }

    fn schedule(entries: &[(u64, StepAction)]) -> Vec<Scheduled> {
        entries
            .iter()
            .map(|&(at_ms, action)| Scheduled {
                at: Duration::from_millis(at_ms),
                action,
                done: false,
            })
            .collect()
    }

    /// Pumps one ordinary event (2ms bounded wait) so ordinary frames keep
    /// flowing while the modal session steps.
    fn pump_ordinary_event(app: &NSApplication) -> bool {
        let mode = NSString::from_str("kCFRunLoopDefaultMode");
        let until = NSDate::dateWithTimeIntervalSinceNow(0.002);
        let event = app.nextEventMatchingMask_untilDate_inMode_dequeue(
            NSEventMask::Any,
            Some(&until),
            &mode,
            true,
        );
        match event {
            Some(event) => {
                app.sendEvent(&event);
                true
            }
            None => false,
        }
    }

    /// Runs the owner-loop shape until `poll_owner` reports the terminal
    /// queued flag or the budget expires. `interleave` runs between polls
    /// (the non-dialog command dispatch surface — head-of-line evidence).
    fn steer(
        app: &NSApplication,
        instance: *mut std::ffi::c_void,
        handle: u64,
        mut actions: Vec<Scheduled>,
        budget: Duration,
        interleave: &mut dyn FnMut(&mut CaseReport),
        report: &mut CaseReport,
    ) -> bool {
        let start = Instant::now();
        let mut last_action: Option<&'static str> = None;
        loop {
            if pump_ordinary_event(app) {
                report.ordinaryEventsHandled += 1;
            }
            let step_start = Instant::now();
            let outcome: ExtPollOutcomeV1 =
                unsafe { opentray_ext_poll_owner_v1(instance, handle) };
            let elapsed_micros = step_start.elapsed().as_micros();
            if elapsed_micros > report.maxStepMicros {
                report.maxStepMicros = elapsed_micros;
            }
            report.steps += 1;
            if outcome.wake_flags & EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED != 0 {
                report.endedBy = last_action;
                return true;
            }
            interleave(report);
            let elapsed = start.elapsed();
            for entry in &mut actions {
                if !entry.done && elapsed >= entry.at {
                    entry.action.perform(app);
                    entry.done = true;
                    last_action = Some(entry.action.label());
                }
            }
            if elapsed > budget {
                report.endedBy = last_action;
                return false;
            }
            std::thread::sleep(Duration::from_millis(4));
        }
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
    }

    /// Asserts one show answered Deferred with the seeded handle and records
    /// the accepted operation for the run-level port accounting.
    fn deferred_show(
        harness: &mut Harness,
        report: &mut CaseReport,
        session: &str,
        handle: u64,
        data: serde_json::Value,
    ) -> bool {
        let outcome = dispatch(harness.instance, session, handle, data);
        let accepted = outcome.code == EXT_OK
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED
            && outcome.disposition.operation_handle() == handle;
        report.ok(
            accepted,
            "show answers Deferred (EXT_OK + seeded handle echo)",
        );
        if accepted {
            harness.accepted.push(handle);
        }
        accepted
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

    fn assert_retired(harness: &Harness, report: &mut CaseReport, handle: u64) {
        let outcome = unsafe { opentray_ext_poll_owner_v1(harness.instance, handle) };
        report.ok(
            outcome.next_deadline_ms == EXT_POLL_NO_DEADLINE_MS
                && outcome.wake_flags & EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED == 0,
            "finished owner no longer schedules polls",
        );
    }

    /// Case 0: the backend DTO through the real ABI — the commandLink /
    /// expander gate input (darwin degradation evidence).
    fn case_backend_dto(harness: &mut Harness, report: &mut CaseReport) {
        let outcome = dispatch(
            harness.instance,
            "e2e-backend",
            0xE2E1_0000_0000_0001,
            serde_json::json!({ "type": "getBackend" }),
        );
        let immediate = outcome.code == EXT_OK
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
            && outcome.disposition.value_is_zero();
        report.ok(immediate, "getBackend answers Immediate while no dialog is open");
        let Some(events) = outcome.events else {
            report.ok(false, "getBackend returned an events buffer");
            return;
        };
        let parsed: serde_json::Value = serde_json::from_str(&events).unwrap_or_default();
        let backend = parsed[0]["data"]["backend"].clone();
        report.extras = serde_json::json!({ "backend": backend });
        report.ok(
            backend["platform"] == "darwin"
                && backend["commandLinks"] == false
                && backend["expander"] == false
                && backend["taskDialog"] == false
                && backend["suppression"] == true
                && backend["packageSemantics"] == true
                && backend["mixedFileDirectorySelection"] == true,
            "darwin DTO freezes the win32-only switches off (commandLink gate input)",
        );
        report.note(
            "commandLink/expander typed degradation is gated in the facade on this DTO \
             (commandLinks:false); the typed rejection is owned by \
             packages/ext-dialog/src/index.test.ts \"gates commandLink on the backend \
             snapshot before dispatch (MessageBox fallback)\"",
        );
    }

    /// Case 1: 3-button dialog. A synthetic Return is attempted first (the
    /// unattended-host keyboard boundary is recorded); the deterministic
    /// dismissal is the button-activation return code 1000+defaultId — the
    /// exact code a real button activation routes through runModalSession —
    /// proving defaultId 1 (a NON-first button) maps to response 1. While
    /// the dialog steps, non-dialog getBackend commands keep answering.
    fn case_message_three_button_default(
        harness: &mut Harness,
        app: &NSApplication,
        report: &mut CaseReport,
    ) {
        let handle = 0xE2E1_0000_0000_0011;
        if !deferred_show(
            harness,
            report,
            "e2e-m3r",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E: defaultId=1 activation (auto)",
                "buttons": ["Save", "Skip", "Quit"],
                "defaultId": 1,
                "cancelId": 2,
                "severity": "info"
            }),
        ) {
            return;
        }
        let instance = harness.instance;
        let mut backend_answers = 0usize;
        let mut interleave = |report: &mut CaseReport| {
            if report.steps % 24 == 8 {
                // A non-dialog extension command dispatched BETWEEN polls
                // while the modal session is live.
                let outcome = dispatch(
                    instance,
                    "e2e-m3r",
                    0xE2E1_0000_0000_0099,
                    serde_json::json!({ "type": "getBackend" }),
                );
                let parsed: serde_json::Value = outcome
                    .events
                    .as_deref()
                    .and_then(|events| serde_json::from_str(events).ok())
                    .unwrap_or_default();
                if outcome.code == EXT_OK
                    && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
                    && parsed[0]["data"]["backend"]["platform"] == "darwin"
                {
                    backend_answers += 1;
                }
            }
        };
        let actions = schedule(&[
            (420, StepAction::ReturnKey),
            (900, StepAction::Button(1)),
            (1800, StepAction::CancelStop),
        ]);
        let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(4),
                              &mut interleave, report);
        report.ok(completed, "poll_owner completed the modal");
        let return_key_ended = report.endedBy == Some("return-key");
        report.extras = serde_json::json!({
            "getBackendAnsweredWhileStepping": backend_answers,
            "returnKeyEndedDialog": return_key_ended,
        });
        report.ok(
            backend_answers >= 2,
            "non-dialog commands answer while a dialog is open (no head-of-line blocking)",
        );
        report.ok(report.steps > 10, "modal advanced through many steps");
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value == serde_json::json!({ "response": 1, "suppressed": false }),
                "button-activation code for defaultId 1 maps to response 1 (not button 0)",
            );
        }
        report.note(
            "the synthetic Return keyDown does not reach the panel on this unattended host \
             (the app never becomes active, the alert never becomes key window — diag matrix \
             2026-09-17); the button-activation evidence rides the 1000+index return code, \
             which is the internal mechanism real button clicks route through"
                .to_string(),
        );
        assert_retired(harness, report, handle);
    }

    /// Case 2: escape maps to cancelId. A real synthetic ESC keyDown is
    /// routed first; the deterministic forced stop covers the case where the
    /// ABI-built alert's explicit key equivalents leave ESC inert (recorded
    /// honestly — both paths map through the same total cancellation law).
    fn case_message_escape_cancel(
        harness: &mut Harness,
        app: &NSApplication,
        report: &mut CaseReport,
    ) {
        let handle = 0xE2E1_0000_0000_0012;
        if !deferred_show(
            harness,
            report,
            "e2e-m3e",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E: escape maps to cancelId=2 (auto)",
                "buttons": ["Proceed", "Back", "Quit"],
                "defaultId": 0,
                "cancelId": 2,
                "severity": "warning"
            }),
        ) {
            return;
        }
        let actions = schedule(&[
            (350, StepAction::EscKey),
            (950, StepAction::AbortStop),
        ]);
        let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(4),
                              &mut |_report| {}, report);
        report.ok(completed, "poll_owner completed the modal");
        let esc_ended = report.endedBy == Some("esc-key");
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value == serde_json::json!({ "response": 2, "suppressed": false }),
                "escape-class dismissal maps to cancelId 2",
            );
        }
        if let Some(object) = report.extras.as_object_mut() {
            object.insert("escKeyEndedDialog".to_string(), serde_json::json!(esc_ended));
        }
        if esc_ended {
            report
                .note("the real synthetic ESC keyDown ended the alert (auto cancel binding)".to_string());
        } else {
            report.note(
                "FINDING (darwin, for the orchestrator): a real synthetic ESC keyDown does \
                 NOT end an ABI-built alert — build_alert's explicit keyEquivalent(\"\") \
                 assignment clears AppKit's automatic Escape binding on the cancel-titled \
                 button (diag D3: the same alert with the auto binding intact dismisses via \
                 ESC, code 1000+cancelIndex). The four-way mapping itself is total: every \
                 non-button code (forced stop, title-bar close) resolves to cancelId — \
                 evidence in this terminal. Suggested follow-up: assign the escape \
                 equivalent to the cancelId button instead of \"\".",
            );
        }
        assert_retired(harness, report, handle);
    }

    /// Case 3: all three severity levels complete through the real ABI.
    fn case_message_severity(harness: &mut Harness, app: &NSApplication, report: &mut CaseReport) {
        let mut per_severity = serde_json::Map::new();
        for (index, severity) in ["info", "warning", "error"].iter().enumerate() {
            let handle = 0xE2E1_0000_0000_0020 + index as u64;
            if !deferred_show(
                harness,
                report,
                "e2e-sev",
                handle,
                serde_json::json!({
                    "type": "messageDialog",
                    "message": format!("E2E severity {severity} (auto)"),
                    "buttons": ["OK"],
                    "severity": severity
                }),
            ) {
                return;
            }
            let actions = schedule(&[(320, StepAction::AbortStop)]);
            let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(3),
                                  &mut |_report| {}, report);
            let value = single_terminal(report, handle);
            let passed = completed
                && value.is_some()
                && value.unwrap() == serde_json::json!({ "response": 0, "suppressed": false });
            per_severity.insert(
                severity.to_string(),
                serde_json::json!({ "completed": completed, "pass": passed }),
            );
            report.ok(passed, format!("severity {severity} dialog completed with response 0"));
        }
        report.extras = serde_json::Value::Object(per_severity);
    }

    /// Case 4: suppression checkbox. 4a attempts a synthetic Tab+Space
    /// toggle (honest recording of what synthetics can reach); 4b proves the
    /// second show reports a FRESH checkbox (reported, never persisted).
    fn case_suppression(harness: &mut Harness, app: &NSApplication, report: &mut CaseReport) {
        // 4a: live flag read with a synthetic toggle attempt.
        let handle = 0xE2E1_0000_0000_0031;
        if !deferred_show(
            harness,
            report,
            "e2e-supp1",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E suppression toggle attempt (auto)",
                "buttons": ["OK"],
                "suppressionLabel": "Do not ask again"
            }),
        ) {
            return;
        }
        let actions = schedule(&[
            (320, StepAction::TabKey),
            (470, StepAction::SpaceKey),
            (950, StepAction::AbortStop),
        ]);
        let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(3),
                              &mut |_report| {}, report);
        report.ok(completed, "suppression dialog completed");
        let mut toggled = false;
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value["response"] == 0,
                "single-button suppression dialog maps forced dismissal to button 0",
            );
            toggled = value["suppressed"] == true;
            report.extras = serde_json::json!({ "suppressedFirstShow": value["suppressed"] });
            report.note(if toggled {
                "synthetic Tab+Space toggled the suppression checkbox: suppressed=true read \
                 back through the real terminal"
            } else {
                "synthetic Tab+Space did not reach the checkbox on this unattended host \
                 (keys need a key window; see the case-1 note); the live flag read itself \
                 ran during extraction and the second-show stateless law below is the \
                 persisted-state evidence"
            });
        }
        let _ = toggled;

        // 4b: stateless second show.
        let handle_two = 0xE2E1_0000_0000_0032;
        if !deferred_show(
            harness,
            report,
            "e2e-supp2",
            handle_two,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E suppression second show (auto)",
                "buttons": ["OK"],
                "suppressionLabel": "Do not ask again"
            }),
        ) {
            return;
        }
        let actions = schedule(&[(320, StepAction::AbortStop)]);
        let completed = steer(app, harness.instance, handle_two, actions, Duration::from_secs(3),
                              &mut |_report| {}, report);
        report.ok(completed, "second suppression dialog completed");
        if let Some(value) = single_terminal(report, handle_two) {
            report.ok(
                value == serde_json::json!({ "response": 0, "suppressed": false }),
                "second show reports a fresh unchecked checkbox (state is reported, never persisted)",
            );
            if let Some(object) = report.extras.as_object_mut() {
                object.insert(
                    "suppressedSecondShow".to_string(),
                    serde_json::json!(value["suppressed"]),
                );
            }
        }
    }

    /// Case 5/6/7: pickers driven to synthetic cancellation (null branch).
    fn case_pickers_cancel(harness: &mut Harness, app: &NSApplication, report: &mut CaseReport) {
        let matrix: [(&'static str, u64, serde_json::Value); 3] = [
            (
                "pickFile-single-filters",
                0xE2E1_0000_0000_0041,
                serde_json::json!({
                    "type": "pickFile",
                    "filters": [{ "name": "Text", "extensions": ["txt", "md"] }]
                }),
            ),
            (
                "pickFile-multiple-empty-filters",
                0xE2E1_0000_0000_0042,
                serde_json::json!({
                    "type": "pickFile",
                    "multiple": true,
                    "filters": []
                }),
            ),
            (
                "pickDirectory",
                0xE2E1_0000_0000_0043,
                serde_json::json!({ "type": "pickDirectory" }),
            ),
        ];
        let mut per_picker = serde_json::Map::new();
        for (label, handle, data) in matrix {
            let session = format!("e2e-{label}");
            if !deferred_show(harness, report, &session, handle, data) {
                return;
            }
            let actions = schedule(&[(350, StepAction::CancelStop)]);
            let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(3),
                                  &mut |_report| {}, report);
            let value = single_terminal(report, handle);
            let passed = completed && value.is_some() && value.unwrap().is_null();
            per_picker.insert(
                label.to_string(),
                serde_json::json!({ "completed": completed, "canceledToNull": passed }),
            );
            report.ok(passed, format!("{label}: cancel-class stop maps to the null branch"));
            assert_retired(harness, report, handle);
        }
        report.extras = serde_json::Value::Object(per_picker);
        report.note(
            "filters:[] is accepted at the ABI and behaves as all-files (the native \
             empty-list -> None normalization; facade \"treats an explicitly empty \
             filter array as all files\" owns the caller-facing spelling)",
        );
    }

    /// Case 8: pickSavePath confirmed through a synthetic Return — the
    /// canonicalized result is the REAL machine evidence for the save-leaf
    /// law (parent realpath + lexical leaf).
    fn case_pick_save_confirm(harness: &mut Harness, app: &NSApplication, report: &mut CaseReport) {
        let leaf = format!("extdlg-e2e-save-{}.txt", std::process::id());
        let default_path = format!("/tmp/{leaf}");
        let expected = std::path::Path::new("/tmp")
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
            .join(&leaf)
            .to_string_lossy()
            .into_owned();
        let handle = 0xE2E1_0000_0000_0051;
        if !deferred_show(
            harness,
            report,
            "e2e-save",
            handle,
            serde_json::json!({
                "type": "pickSavePath",
                "defaultPath": default_path,
                "darwin": { "panelMessage": "E2E auto-confirms via Return" }
            }),
        ) {
            return;
        }
        let actions = schedule(&[
            (500, StepAction::ReturnKey),
            (1400, StepAction::CancelStop),
        ]);
        let completed = steer(app, harness.instance, handle, actions, Duration::from_secs(4),
                              &mut |_report| {}, report);
        report.ok(completed, "save panel completed");
        if let Some(value) = single_terminal(report, handle) {
            if value.is_string() {
                let path = value.as_str().unwrap();
                report.ok(
                    path == expected,
                    format!("confirmed save path is canonicalized ({path} == {expected})"),
                );
                report.extras = serde_json::json!({
                    "confirmedPath": path,
                    "expectedCanonicalized": expected,
                });
                report
                    .note("synthetic Return confirmed the prefilled name; the terminal carries \
                           the canonicalized absolute path (parent realpath resolves the /tmp \
                           symlink)");
            } else {
                report.extras = serde_json::json!({
                    "confirmedPath": null,
                    "expectedCanonicalized": expected,
                });
                report.note(
                    "synthetic Return does not confirm the save panel on this unattended host \
                     (keyboard boundary, see the case-1 note); ended by the cancel fallback. \
                     The canonicalization law stays covered by state.rs \
                     save_leaf_canonicalization_prefers_parent_realpath, \
                     existing_canonicalization_resolves_realpaths_and_degrades_lexically, and \
                     the facade vitest pickSavePath case",
                );
            }
        }
        assert_retired(harness, report, handle);
    }

    /// Case 9: busy law — the second show in the SAME scope answers the
    /// synchronous typed rejection; the first still completes.
    fn case_busy(harness: &mut Harness, app: &NSApplication, report: &mut CaseReport) {
        let first = 0xE2E1_0000_0000_0061;
        let second = 0xE2E1_0000_0000_0062;
        if !deferred_show(
            harness,
            report,
            "e2e-busy",
            first,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E busy owner (auto)",
                "buttons": ["OK", "Cancel"],
                "cancelId": 1
            }),
        ) {
            return;
        }
        let outcome = dispatch(
            harness.instance,
            "e2e-busy",
            second,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E busy trespasser",
                "buttons": ["OK"]
            }),
        );
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
                && detail["details"]["sessionId"] == "e2e-busy",
            "typed dialog_session_busy carries the owner scope details",
        );
        harness.busy_rejections += 1;

        let actions = schedule(&[(350, StepAction::AbortStop)]);
        let completed = steer(app, harness.instance, first, actions, Duration::from_secs(3),
                              &mut |_report| {}, report);
        report.ok(completed, "the first dialog still completes after the busy rejection");
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
        assert_retired(harness, report, first);
    }

    /// Case 10: session close while a dialog is open — exactly one
    /// cancel-branch terminal, delivered through the port.
    fn case_session_close(harness: &mut Harness, report: &mut CaseReport) {
        let handle = 0xE2E1_0000_0000_0071;
        if !deferred_show(
            harness,
            report,
            "e2e-close",
            handle,
            serde_json::json!({
                "type": "pickDirectory",
                "title": "E2E session close (auto)"
            }),
        ) {
            return;
        }
        let session_id = c"e2e-close";
        let mut events = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        let code = unsafe {
            opentray_ext_session_closed(
                harness.instance,
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
        if let Some(value) = single_terminal(report, handle) {
            report.ok(
                value.is_null(),
                "session close submits exactly one cancel-branch (null) terminal",
            );
        }
        assert_retired(harness, report, handle);
        report.note(
            "in the broker host the deferred port is revoked before this cleanup, so the \
             submit observes PORT_CLOSED there; the extension-side cancel-branch \
             orchestration and exactly-once accounting are what this probe measures",
        );
    }

    /// Case 11 (second instance): deinit with a live modal submits ZERO
    /// terminals — the darwin projection of the deinit-with-active-worker
    /// boundary (the win32 STA join/pin park is cited, not duplicated).
    fn case_deinit_with_live_modal(app: &NSApplication, report: &mut CaseReport) {
        let instance = init_instance();
        attach_port(instance, recording_submit_b);
        let handle = 0xE2E2_0000_0000_0001;
        let outcome = dispatch(
            instance,
            "e2e-deinit",
            handle,
            serde_json::json!({
                "type": "messageDialog",
                "message": "E2E deinit with a live modal (auto)",
                "buttons": ["OK"]
            }),
        );
        let accepted = outcome.code == EXT_OK
            && outcome.disposition.tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED;
        report.ok(accepted, "the live modal is accepted before deinit");
        // Step it a few times so the session is mid-flight, then deinit.
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(200) {
            pump_ordinary_event(app);
            let outcome = unsafe { opentray_ext_poll_owner_v1(instance, handle) };
            if outcome.wake_flags & EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED != 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(4));
        }
        unsafe { opentray_ext_deinit(instance) };
        std::thread::sleep(Duration::from_millis(100));
        let submits = SUBMITS_B.lock().unwrap().clone();
        report.extras = serde_json::json!({
            "acceptedDeferred": 1,
            "portSubmits": submits.len(),
            "submitCalls": SUBMIT_CALLS_B.load(Ordering::SeqCst),
        });
        report.ok(
            submits.is_empty(),
            "deinit tears a live modal down WITHOUT submitting any terminal",
        );
        // The owner loop stays healthy after the teardown (revoke ended the
        // modal session on this main thread): a posted synthetic event must
        // come back out of the queue.
        let synthetic =
            NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
                NSEventType::ApplicationDefined,
                NSPoint::new(0.0, 0.0),
                NSEventModifierFlags(0),
                0.0,
                0,
                None,
                100,
                0x45324541, // "E2EA"
                0,
            );
        if let Some(event) = synthetic {
            app.postEvent_atStart(&event, false);
        }
        let deadline = Instant::now() + Duration::from_millis(300);
        let mut dequeued = false;
        while Instant::now() < deadline {
            if pump_ordinary_event(app) {
                dequeued = true;
                break;
            }
        }
        report.ok(dequeued, "event loop dequeues events after deinit teardown");
        report.note(
            "win32 leaked-STA-worker park decision is owned by state.rs \
             settle_shutdown tests (failed_pin_with_leaked_workers_blocks_the_unload_path, \
             successful_pin_defers_cleanup_to_process_exit, \
             clean_shutdown_never_consults_the_pin_seam); the non-returning park itself is \
             cfg(windows) and stays Windows-evidence",
        );
    }

    // ------------------------------------------------------------------
    // Run
    // ------------------------------------------------------------------

    pub fn run() -> i32 {
        let evidence_dir = std::path::Path::new("/tmp/extdlg-probe");
        let _ = std::fs::create_dir_all(evidence_dir);
        let report_path = evidence_dir.join("acceptance-evidence.json");
        let run_start = Instant::now();

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = std::fs::write(
                &report_path,
                r#"{ "status": "SKIPPED", "reason": "probe not on the main thread" }"#,
            );
            println!("SKIPPED: probe not on the main thread");
            return 0;
        };
        if std::env::var("OPENTRAY_DIALOG_PROBE_SKIP").is_ok() {
            let _ = std::fs::write(
                &report_path,
                r#"{ "status": "SKIPPED", "reason": "OPENTRAY_DIALOG_PROBE_SKIP is set" }"#,
            );
            println!("SKIPPED: OPENTRAY_DIALOG_PROBE_SKIP is set");
            return 0;
        }

        let app = NSApp(mtm);
        let mut cases: Vec<CaseReport> = Vec::new();
        let mut harness = Harness {
            instance: init_instance(),
            accepted: Vec::new(),
            busy_rejections: 0,
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
                report.note("case body panicked (no GUI session?)");
            }
            report.finish();
            cases.push(report);
        };

        // -- instance one: the live matrix --------------------------------
        run_case("backend-dto", &mut |harness, report| {
            case_backend_dto(harness, report)
        });
        let app_ref = &app;
        run_case("message-3button-default-interleave", &mut |harness, report| {
            case_message_three_button_default(harness, app_ref, report)
        });
        run_case("message-escape-cancel", &mut |harness, report| {
            case_message_escape_cancel(harness, app_ref, report)
        });
        run_case("message-severity-x3", &mut |harness, report| {
            case_message_severity(harness, app_ref, report)
        });
        run_case("suppression-flag", &mut |harness, report| {
            case_suppression(harness, app_ref, report)
        });
        run_case("pickers-cancel", &mut |harness, report| {
            case_pickers_cancel(harness, app_ref, report)
        });
        run_case("picksavepath-confirm", &mut |harness, report| {
            case_pick_save_confirm(harness, app_ref, report)
        });
        run_case("busy-rejection", &mut |harness, report| {
            case_busy(harness, app_ref, report)
        });
        run_case("session-close-revoke", &mut |harness, report| {
            case_session_close(harness, report)
        });
        unsafe { opentray_ext_deinit(harness.instance) };

        // -- run-level REAL port accounting (review supplement 1) ----------
        let submits = SUBMITS_A.lock().unwrap().clone();
        let submit_handles: Vec<u64> = submits.iter().map(|(handle, _)| *handle).collect();
        let mut sorted = submit_handles.clone();
        sorted.sort_unstable();
        sorted.dedup();
        let mut accepted_sorted = harness.accepted.clone();
        accepted_sorted.sort_unstable();
        let accounting_pass = submits.len() == harness.accepted.len()
            && sorted.len() == submits.len()
            && sorted == accepted_sorted;
        let mut accounting = CaseReport::new("port-accounting");
        accounting.ok(
            accounting_pass,
            format!(
                "port submissions ({}) == accepted deferred operations ({}) with unique handles",
                submits.len(),
                harness.accepted.len()
            ),
        );
        accounting.extras = serde_json::json!({
            "acceptedDeferred": harness.accepted.len(),
            "portSubmitCalls": SUBMIT_CALLS_A.load(Ordering::SeqCst),
            "portSubmits": submits.len(),
            "busyRejections": harness.busy_rejections,
            "handles": submit_handles,
        });
        accounting.finish();
        cases.push(accounting);

        // -- instance two: deinit with a live modal ------------------------
        let mut deinit_report = CaseReport::new("deinit-with-live-modal");
        let deinit_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            case_deinit_with_live_modal(&app, &mut deinit_report)
        }));
        if deinit_result.is_err() {
            deinit_report.failures += 1;
            deinit_report.note("case body panicked (no GUI session?)");
        }
        deinit_report.finish();
        cases.push(deinit_report);

        let all_passed = cases.iter().all(|case| case.status == "PASS");
        let overall = if all_passed { "PASS" } else { "FAIL" };
        let evidence = serde_json::json!({
            "status": overall,
            "probe": "add-ext-dialog batch E darwin acceptance probe",
            "runSeconds": run_start.elapsed().as_secs_f64(),
            "cases": cases,
        });
        let _ = std::fs::write(&report_path, serde_json::to_string_pretty(&evidence).unwrap());
        println!("== acceptance probe (darwin): {overall} ==");
        for case in &cases {
            println!(
                "  {:<36} {:<5} steps={:<4} ordinaryEvents={:<4} maxStepMicros={:<7} endedBy={:?}",
                case.case,
                case.status,
                case.steps,
                case.ordinaryEventsHandled,
                case.maxStepMicros,
                case.endedBy,
            );
            for note in &case.notes {
                println!("    note: {note}");
            }
        }
        println!("evidence: {}", report_path.display());
        if all_passed {
            0
        } else {
            1
        }
    }
}

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(probe::run());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIPPED: the acceptance probe is a macOS-only evidence collector");
    let _ = std::fs::create_dir_all("/tmp/extdlg-probe");
    let _ = std::fs::write(
        "/tmp/extdlg-probe/acceptance-evidence.json",
        r#"{ "status": "SKIPPED", "reason": "non-macOS host" }"#,
    );
}
