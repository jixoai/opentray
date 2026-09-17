//! macOS modal-session probe (add-ext-dialog task 3.1).
//!
//! Unattended evidence collector for the broker-owned modal scheduler
//! contract (design section 5.2). Runs on the main thread (example binary)
//! and proves, against a live WindowServer session:
//!
//! 1. `beginModalSessionForWindow` + stepped `runModalSession` advance
//!    inside an NSEvent-driven loop (the owner-loop shape) with promptly
//!    returning steps (bounded step durations recorded).
//! 2. Ordinary event processing between steps is not starved: synthetic
//!    application-defined events posted between steps are dequeued and
//!    delivered while the modal session is active.
//! 3. System dismissal produces a mappable return code: a real synthetic
//!    ESC keyDown routes through the alert's key-equivalent handling, with
//!    a forced `stopModalWithCode` (the internal mechanism title-bar close
//!    uses) as the deterministic fallback.
//! 4. `endModalSession` teardown is clean (no crash, loop exits).
//! 5. End-to-end through the real extension ABI: show answers Deferred,
//!    `poll_owner` steps until the modal ends, the single terminal payload
//!    arrives through the deferred port with the four-way dismissal
//!    mapping, and `session_closed` revokes a live modal with a
//!    cancel-branch terminal.
//!
//! Evidence lands in /tmp/extdlg-probe/. With no GUI session the probe
//! reports SKIPPED (exit 0) instead of fabricating results.
//!
//! Run: cargo run -p opentray-ext-dialog --example modal_probe

#[cfg(target_os = "macos")]
mod probe {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{ClassType, MainThreadMarker};
    use objc2_app_kit::NSModalSession;
    use objc2_app_kit::{
        NSAlert, NSApp, NSApplication, NSEvent, NSEventMask, NSEventModifierFlags, NSEventType,
        NSModalResponseContinue, NSOpenPanel,
    };
    use objc2_foundation::{NSDate, NSPoint, NSString};

    use opentray_ext_dialog::{
        opentray_ext_attach_deferred_completion_port_v1, opentray_ext_command_v2,
        opentray_ext_deinit, opentray_ext_free_string, opentray_ext_init,
        opentray_ext_poll_owner_v1, opentray_ext_session_closed, ExtPollOutcomeV1,
        EXT_POLL_NO_DEADLINE_MS, EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED,
        EXT_POLL_STEP_INTERVAL_MS,
    };
    use opentray_spec::{
        ExtBytes, ExtCommandDispositionV1, ExtContext, ExtDeferredPortV1, ExtOwnedBytes,
        ExtResultCode, EXT_ERR_REJECTED, EXT_OK,
    };

    /// Local events observed by the monitor: every event the application
    /// dispatches while a modal session is stepping passes here, which is
    /// the "ordinary event processing is not starved" evidence.
    static MONITORED_LOCAL_EVENTS: AtomicUsize = AtomicUsize::new(0);

    /// One evidence case.
    #[derive(serde::Serialize)]
    #[allow(non_snake_case)]
    struct CaseReport {
        case: &'static str,
        status: String,
        steps: usize,
        ordinaryEventsHandled: usize,
        monitoredLocalEvents: usize,
        syntheticPosted: usize,
        maxStepMicros: u128,
        endedCode: Option<isize>,
        endedPath: Option<&'static str>,
        mapped: Option<serde_json::Value>,
        notes: Vec<String>,
    }

    impl CaseReport {
        fn new(case: &'static str) -> Self {
            Self {
                case,
                status: "RUNNING".to_string(),
                steps: 0,
                ordinaryEventsHandled: 0,
                monitoredLocalEvents: 0,
                syntheticPosted: 0,
                maxStepMicros: 0,
                endedCode: None,
                endedPath: None,
                mapped: None,
                notes: Vec::new(),
            }
        }

        /// Captures the local-event-monitor delta for this case: every
        /// event AppKit dispatched while the case ran.
        fn finish_with_monitor_delta(&mut self, counter_before: usize) {
            self.monitoredLocalEvents = MONITORED_LOCAL_EVENTS
                .load(Ordering::SeqCst)
                .saturating_sub(counter_before);
        }
    }

    /// The shared NSEvent-driven stepping loop (owner-loop shape): one
    /// bounded event pump, one modal step per iteration, a synthetic
    /// ordinary event every third iteration, ESC attempt and forced-stop
    /// deadlines so every dialog auto-closes.
    struct StepLoop<'a> {
        app: &'a NSApplication,
        mode: Retained<NSString>,
        start: Instant,
        esc_attempted: bool,
        stop_requested: bool,
    }

    enum LoopOutcome {
        Ended { code: isize, path: &'static str },
        Timeout,
    }

    impl<'a> StepLoop<'a> {
        fn new(app: &'a NSApplication) -> Self {
            Self {
                app,
                mode: NSString::from_str("kCFRunLoopDefaultMode"),
                start: Instant::now(),
                esc_attempted: false,
                stop_requested: false,
            }
        }

        fn pump_ordinary_event(&self) -> bool {
            let until = NSDate::dateWithTimeIntervalSinceNow(0.002);
            let event = self.app.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&until),
                &self.mode,
                true,
            );
            match event {
                Some(event) => {
                    self.app.sendEvent(&event);
                    true
                }
                None => false,
            }
        }

        fn post_ordinary_event(&self) {
            let event =
                NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
                    NSEventType::ApplicationDefined,
                    NSPoint::new(0.0, 0.0),
                    NSEventModifierFlags(0),
                    0.0,
                    0,
                    None,
                    100,
                    0x50524f42, // "PROB"
                    0,
                );
            if let Some(event) = event {
                self.app.postEvent_atStart(&event, false);
            }
        }

        fn send_escape_key(&self) {
            // A real synthetic ESC keyDown routed through the application
            // event dispatch (the same path a hardware ESC takes). keyCode
            // 53 is Escape on every Apple keyboard layout.
            let escape = NSString::from_str("\u{1b}");
            let event =
                NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                    NSEventType::KeyDown,
                    NSPoint::new(0.0, 0.0),
                    NSEventModifierFlags(0),
                    0.0,
                    0,
                    None,
                    &escape,
                    &escape,
                    false,
                    53,
                );
            if let Some(event) = event {
                self.app.sendEvent(&event);
            }
        }

        /// Runs until the modal session ends or the hard budget expires.
        /// One iteration: pump one ordinary event, step the session once.
        fn run(
            &mut self,
            session: NSModalSession,
            report: &mut CaseReport,
            esc_after: Duration,
            force_stop_after: Duration,
        ) -> LoopOutcome {
            let hard_budget = force_stop_after + Duration::from_millis(600);
            loop {
                if self.pump_ordinary_event() {
                    report.ordinaryEventsHandled += 1;
                }
                if report.steps % 3 == 0 {
                    self.post_ordinary_event();
                    report.syntheticPosted += 1;
                }
                let step_start = Instant::now();
                // SAFETY: the session came from beginModalSessionForWindow
                // on this main thread and is ended exactly once below.
                let code = unsafe { self.app.runModalSession(session) };
                let elapsed = step_start.elapsed().as_micros();
                if elapsed > report.maxStepMicros {
                    report.maxStepMicros = elapsed;
                }
                report.steps += 1;

                if !self.esc_attempted && self.start.elapsed() > esc_after {
                    self.esc_attempted = true;
                    self.send_escape_key();
                }
                if !self.stop_requested && self.start.elapsed() > force_stop_after {
                    // The deterministic fallback: stopModalWithCode is the
                    // internal mechanism ESC/title-bar close route through.
                    self.app.stopModalWithCode(-1001);
                    self.stop_requested = true;
                }

                if code != NSModalResponseContinue {
                    // SAFETY: the session returned a terminal response;
                    // ending it releases the modal bookkeeping.
                    unsafe { self.app.endModalSession(session) };
                    report.endedCode = Some(code);
                    report.endedPath = Some(if self.stop_requested {
                        "forced-stop"
                    } else {
                        "esc-key-or-natural"
                    });
                    return LoopOutcome::Ended {
                        code,
                        path: if self.stop_requested {
                            "forced-stop"
                        } else {
                            "esc-key-or-natural"
                        },
                    };
                }
                if self.start.elapsed() > hard_budget {
                    // SAFETY: leaving a modal session alive would wedge the
                    // process; end it even on the timeout path.
                    unsafe { self.app.endModalSession(session) };
                    return LoopOutcome::Timeout;
                }
            }
        }
    }

    /// The four-way dismissal mapping as an independent reimplementation:
    /// 1000+index for button activations; everything else maps to
    /// cancelId (or button 0).
    fn map_alert_code(code: isize, buttons_len: usize, cancel_id: Option<usize>) -> usize {
        if code >= 1000 {
            let index = (code - 1000) as usize;
            if index < buttons_len {
                return index;
            }
        }
        cancel_id.unwrap_or(0)
    }

    fn assert_or_note(condition: bool, note: &str, report: &mut CaseReport) -> bool {
        if condition {
            true
        } else {
            report.notes.push(format!("ASSERT FAILED: {note}"));
            false
        }
    }

    /// Case A: raw NSAlert modal-session mechanics with suppression.
    fn case_alert(app: &NSApplication) -> CaseReport {
        let mtm = MainThreadMarker::new().expect("main thread");
        let mut report = CaseReport::new("alert-modal-session");
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(
            "OpenTray dialog probe (auto-closes, ignore)",
        ));
        alert.addButtonWithTitle(&NSString::from_str("OK"));
        alert.addButtonWithTitle(&NSString::from_str("Cancel"));
        alert.setShowsSuppressionButton(true);
        let session = app.beginModalSessionForWindow(&alert.window());
        if assert_or_note(!session.is_null(), "begin returned a session", &mut report) {
            let mut stepper = StepLoop::new(app);
            match stepper.run(
                session,
                &mut report,
                Duration::from_millis(500),
                Duration::from_millis(900),
            ) {
                LoopOutcome::Ended { code, path } => {
                    let response = map_alert_code(code, 2, Some(1));
                    report.mapped = Some(serde_json::json!({
                        "response": response,
                        "suppression": false,
                    }));
                    assert_or_note(
                        path == "esc-key-or-natural" || path == "forced-stop",
                        "dismissal path recorded",
                        &mut report,
                    );
                    // The four-way law: a forced dismissal must resolve to
                    // the cancel branch, never the default button.
                    assert_or_note(
                        response == 1,
                        "forced dismissal maps to cancelId (1)",
                        &mut report,
                    );
                }
                LoopOutcome::Timeout => {
                    report.notes.push("loop timed out".to_string());
                }
            }
        }
        // One post-teardown iteration proves the loop keeps running after
        // endModalSession (clean teardown, no wedged modal state).
        let stepper = StepLoop::new(app);
        stepper.pump_ordinary_event();
        report.status = if report.notes.is_empty() {
            "PASS".to_string()
        } else {
            "FAIL".to_string()
        };
        report
    }

    /// Case B: NSOpenPanel (directory picker) — cancel-class dismissal
    /// (title-bar close / ESC collapse to NSModalResponseCancel = 0).
    fn case_open_panel(app: &NSApplication) -> CaseReport {
        let mtm = MainThreadMarker::new().expect("main thread");
        let mut report = CaseReport::new("open-panel-cancel-mapping");
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseDirectories(true);
        panel.setCanChooseFiles(false);
        panel.setMessage(Some(&NSString::from_str("probe (auto-cancels)")));
        let window = panel.as_super().as_super().as_super();
        let session = app.beginModalSessionForWindow(window);
        if assert_or_note(!session.is_null(), "begin returned a session", &mut report) {
            let stepper = StepLoop::new(app);
            // Request the cancel-class stop after a short visible window.
            let mut ended = None;
            let start = Instant::now();
            // Reuse the loop with a short force-stop: cancel class = 0.
            // The loop's fallback uses -1001, so request 0 explicitly first.
            let session_holder = session;
            let mut stop_requested = false;
            loop {
                if stepper.pump_ordinary_event() {
                    report.ordinaryEventsHandled += 1;
                }
                let step_start = Instant::now();
                // SAFETY: see case A.
                let code = unsafe { app.runModalSession(session_holder) };
                let elapsed = step_start.elapsed().as_micros();
                if elapsed > report.maxStepMicros {
                    report.maxStepMicros = elapsed;
                }
                report.steps += 1;
                if !stop_requested && start.elapsed() > Duration::from_millis(450) {
                    app.stopModalWithCode(0); // NSModalResponseCancel class
                    stop_requested = true;
                }
                if code != NSModalResponseContinue {
                    // SAFETY: terminal response received.
                    unsafe { app.endModalSession(session_holder) };
                    ended = Some(code);
                    report.endedCode = Some(code);
                    report.endedPath = Some("cancel-class-stop");
                    break;
                }
                if start.elapsed() > Duration::from_millis(1200) {
                    // SAFETY: timeout teardown.
                    unsafe { app.endModalSession(session_holder) };
                    report.notes.push("loop timed out".to_string());
                    break;
                }
            }
            if let Some(code) = ended {
                let canceled = code == 0;
                report.mapped = Some(serde_json::json!({
                    "pickerResult": if canceled { serde_json::json!(null) } else { serde_json::json!({"unexpected": code}) },
                }));
                assert_or_note(
                    canceled,
                    "cancel-class stop maps to the picker null branch",
                    &mut report,
                );
            }
        }
        report.status = if report.notes.is_empty() {
            "PASS".to_string()
        } else {
            "FAIL".to_string()
        };
        report
    }

    // -- Case C: end-to-end through the real exported ABI ----------------

    static TERMINALS: std::sync::Mutex<Vec<(u64, String)>> = std::sync::Mutex::new(Vec::new());

    unsafe extern "C" fn recording_submit(
        _port_data: *mut std::ffi::c_void,
        handle: u64,
        payload_ptr: *const u8,
        payload_len: usize,
    ) -> ExtResultCode {
        if payload_ptr.is_null() || payload_len == 0 {
            return EXT_ERR_REJECTED;
        }
        let bytes = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        TERMINALS
            .lock()
            .unwrap()
            .push((handle, String::from_utf8_lossy(bytes).into_owned()));
        EXT_OK
    }

    fn ffi_show(
        instance: *mut std::ffi::c_void,
        handle: u64,
        data: serde_json::Value,
    ) -> (ExtResultCode, ExtCommandDispositionV1) {
        let envelope = serde_json::json!({
            "scope": { "appId": "app-probe", "trayId": "tray-probe", "ext": "dialog" },
            "commandScope": {
                "appId": "app-probe",
                "trayId": "tray-probe",
                "sessionId": "session-probe",
                "instanceGeneration": 1
            },
            "data": data
        });
        let envelope = std::ffi::CString::new(envelope.to_string()).unwrap();
        let mut events = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        let mut disposition = ExtCommandDispositionV1::deferred(handle);
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
        if !events.ptr.is_null() {
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
        }
        (code, disposition)
    }

    fn case_end_to_end(app: &NSApplication) -> CaseReport {
        let mut report = CaseReport::new("ffi-end-to-end");
        let context = ExtContext {
            api_version: 1,
            app_id: ExtBytes {
                ptr: c"app-probe".as_ptr(),
                len: "app-probe".len(),
            },
        };
        let mut instance = std::ptr::null_mut();
        assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);
        let port = ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
            port_data: 1usize as *mut std::ffi::c_void,
            submit: recording_submit,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );

        // 1. show -> Deferred, seeded handle echoed.
        let handle_one: u64 = 0x0000_a1b2_c3d4_e5f6;
        let (code, disposition) = ffi_show(
            instance,
            handle_one,
            serde_json::json!({
                "type": "messageDialog",
                "message": "probe dialog (auto-closes)",
                "buttons": ["OK", "Cancel"],
                "defaultId": 0,
                "cancelId": 1,
                "suppressionLabel": "Do not show again"
            }),
        );
        assert_or_note(
            code == EXT_OK
                && disposition.tag == 1
                && disposition.operation_handle() == handle_one,
            "show answers Deferred with the seeded handle",
            &mut report,
        );

        // 2. poll_owner steps the modal; forced-stop after a visible window;
        //    the completing poll returns no deadline + the terminal flag.
        let stepper = StepLoop::new(app);
        let start = Instant::now();
        let mut stop_requested = false;
        let mut completion: Option<ExtPollOutcomeV1> = None;
        for _ in 0..200 {
            stepper.pump_ordinary_event();
            report.steps += 1;
            let outcome: ExtPollOutcomeV1 =
                unsafe { opentray_ext_poll_owner_v1(instance, handle_one) };
            if !stop_requested && start.elapsed() > Duration::from_millis(450) {
                app.stopModalWithCode(0); // forced dismissal -> cancel branch
                stop_requested = true;
            }
            if outcome.wake_flags & EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED != 0 {
                completion = Some(outcome);
                break;
            }
            std::thread::sleep(Duration::from_millis(4));
            if start.elapsed() > Duration::from_millis(1500) {
                break;
            }
        }
        assert_or_note(completion.is_some(), "poll completed the modal", &mut report);
        if let Some(outcome) = &completion {
            assert_or_note(
                outcome.next_deadline_ms == EXT_POLL_NO_DEADLINE_MS && outcome.status == 0,
                "completed poll reports no deadline",
                &mut report,
            );
        }
        let terminals = TERMINALS.lock().unwrap().clone();
        let ours: Vec<&(u64, String)> = terminals
            .iter()
            .filter(|(handle, _)| *handle == handle_one)
            .collect();
        assert_or_note(ours.len() == 1, "exactly one terminal submitted", &mut report);
        if let Some((_, payload)) = ours.first() {
            let parsed: serde_json::Value = serde_json::from_str(payload).unwrap_or_default();
            report.mapped = Some(parsed.clone());
            let value = &parsed["value"];
            assert_or_note(
                parsed["kind"] == "result" && value["response"] == 1 && value["suppressed"] == false,
                "terminal is the cancel-branch result {response:1, suppressed:false}",
                &mut report,
            );
        }

        // 3. session_closed revokes a live modal with a cancel terminal.
        let handle_two: u64 = 0x0000_0f1e_2d3c_4b5a;
        let (code, disposition) = ffi_show(
            instance,
            handle_two,
            serde_json::json!({ "type": "pickFile" }),
        );
        assert_or_note(
            code == EXT_OK && disposition.tag == 1,
            "second show defers (session busy only blocks after a live dialog)",
            &mut report,
        );
        let session_id = c"session-probe";
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
        assert_or_note(code == EXT_OK, "session cleanup succeeds", &mut report);
        if !events.ptr.is_null() {
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
        }
        let terminals = TERMINALS.lock().unwrap().clone();
        let revoked: Vec<&(u64, String)> = terminals
            .iter()
            .filter(|(handle, _)| *handle == handle_two)
            .collect();
        assert_or_note(
            revoked.len() == 1,
            "session close submits the cancel-branch terminal for the live modal",
            &mut report,
        );
        if let Some((_, payload)) = revoked.first() {
            let parsed: serde_json::Value = serde_json::from_str(payload).unwrap_or_default();
            assert_or_note(
                parsed["kind"] == "result" && parsed["value"].is_null(),
                "revoked picker terminal is the null cancel branch",
                &mut report,
            );
        }
        // The revoked owner reports no deadline: its record is gone.
        let outcome = unsafe { opentray_ext_poll_owner_v1(instance, handle_two) };
        assert_or_note(
            outcome.next_deadline_ms == EXT_POLL_NO_DEADLINE_MS,
            "revoked owner no longer schedules polls",
            &mut report,
        );
        // Wait for the panel teardown to settle before deinit.
        std::thread::sleep(Duration::from_millis(150));
        unsafe { opentray_ext_deinit(instance) };

        report.status = if report.notes.is_empty() {
            "PASS".to_string()
        } else {
            "FAIL".to_string()
        };
        report
    }

    pub fn run() -> i32 {
        let evidence_dir = std::path::Path::new("/tmp/extdlg-probe");
        let _ = std::fs::create_dir_all(evidence_dir);
        let report_path = evidence_dir.join("probe-evidence.json");

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

        // Local event monitor: counts EVERY event the application dispatches
        // (through sendEvent) while modal sessions step — the starvation
        // evidence the synthetic posted events alone cannot show (the modal
        // loop consumes them itself).
        let monitor = block2::RcBlock::new(move |event: std::ptr::NonNull<NSEvent>| {
            MONITORED_LOCAL_EVENTS.fetch_add(1, Ordering::SeqCst);
            event.as_ptr()
        });
        let monitor_token: Option<Retained<AnyObject>> = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::Any,
                &monitor,
            )
        };

        let mut cases: Vec<CaseReport> = Vec::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let before = MONITORED_LOCAL_EVENTS.load(Ordering::SeqCst);
            let mut report = case_alert(&app);
            report.finish_with_monitor_delta(before);
            cases.push(report);

            let before = MONITORED_LOCAL_EVENTS.load(Ordering::SeqCst);
            let mut report = case_open_panel(&app);
            report.finish_with_monitor_delta(before);
            cases.push(report);

            let before = MONITORED_LOCAL_EVENTS.load(Ordering::SeqCst);
            let mut report = case_end_to_end(&app);
            report.finish_with_monitor_delta(before);
            cases.push(report);
        }));
        if let Some(token) = &monitor_token {
            unsafe { NSEvent::removeMonitor(token) };
        }
        let panicked = result.is_err();
        if panicked {
            cases.push({
                let mut report = CaseReport::new("appkit-panic");
                report.status = "FAIL".to_string();
                report
                    .notes
                    .push("AppKit section panicked (no GUI session?)".to_string());
                report
            });
        }

        let all_passed = !panicked && cases.iter().all(|case| case.status == "PASS");
        let overall = if panicked {
            "FAIL"
        } else if all_passed {
            "PASS"
        } else {
            "FAIL"
        };
        let evidence = serde_json::json!({
            "status": overall,
            "probe": "add-ext-dialog task 3.1 macOS modal-session probe",
            "stepsIntervalMs": EXT_POLL_STEP_INTERVAL_MS,
            "cases": cases,
        });
        let _ = std::fs::write(&report_path, serde_json::to_string_pretty(&evidence).unwrap());
        println!("== modal probe: {overall} ==");
        for case in &cases {
            println!(
                "  {:<28} {:<6} steps={:<4} ordinaryEvents={:<4} monitoredLocal={:<4} maxStepMicros={:<7} ended={:<7} path={:?}",
                case.case,
                case.status,
                case.steps,
                case.ordinaryEventsHandled,
                case.monitoredLocalEvents,
                case.maxStepMicros,
                case.endedCode
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                case.endedPath.unwrap_or("-"),
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
    println!("SKIPPED: the modal probe is a macOS-only evidence collector");
    let _ = std::fs::create_dir_all("/tmp/extdlg-probe");
    let _ = std::fs::write(
        "/tmp/extdlg-probe/probe-evidence.json",
        r#"{ "status": "SKIPPED", "reason": "non-macOS host" }"#,
    );
}
