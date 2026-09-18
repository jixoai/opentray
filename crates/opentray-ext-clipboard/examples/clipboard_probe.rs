//! Real-machine clipboard probe (add-ext-clipboard task 6.1 helper).
//!
//! Drives the real extension ABI end-to-end from the MAIN thread (the
//! example binary's main thread satisfies the darwin owner-thread
//! contract): one write with a surrogate pair (emoji), one read-back
//! asserting the UTF-16 round trip, the empty-string write (≠ clear)
//! read-back, and — with the `clear` argument — one clear whose
//! read-back is the first-class `null` empty state. The default run
//! leaves the probe text ON the system board so a CROSS-PROCESS reader
//! (`pbpaste` on darwin, `Get-Clipboard` on win32) can observe it after
//! the process exits; the `clear` run empties the board again.
//!
//! Run:
//!   cargo run -p opentray-ext-clipboard --example clipboard_probe
//!   cargo run -p opentray-ext-clipboard --example clipboard_probe read
//!   cargo run -p opentray-ext-clipboard --example clipboard_probe clear

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() {
    use opentray_ext_clipboard::{
        opentray_ext_command_v2, opentray_ext_deinit, opentray_ext_free_string,
        opentray_ext_init, opentray_ext_session_closed, opentray_ext_take_error,
    };
    use opentray_spec::{ExtBytes, ExtCommandDispositionV1, ExtContext, ExtOwnedBytes, EXT_OK};

    let mode = std::env::args().nth(1).unwrap_or_default();

    let context = ExtContext {
        api_version: 1,
        app_id: ExtBytes {
            ptr: c"probe-app".as_ptr(),
            len: "probe-app".len(),
        },
    };
    let mut instance = std::ptr::null_mut();
    assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);

    let dispatch = |label: &str, data: serde_json::Value| -> Option<serde_json::Value> {
        let envelope = serde_json::json!({
            "scope": { "appId": "probe-app", "trayId": "probe-tray", "ext": "clipboard" },
            "commandScope": {
                "appId": "probe-app",
                "trayId": "probe-tray",
                "sessionId": "probe-session",
                "instanceGeneration": 1
            },
            "data": data
        });
        let raw = std::ffi::CString::new(envelope.to_string()).unwrap();
        let mut events = ExtOwnedBytes {
            ptr: std::ptr::null_mut(),
            len: 0,
        };
        let mut disposition = ExtCommandDispositionV1::deferred(1);
        let code = unsafe {
            opentray_ext_command_v2(
                instance,
                std::ptr::null(),
                ExtBytes {
                    ptr: raw.as_ptr(),
                    len: raw.as_bytes().len(),
                },
                &mut events,
                &mut disposition,
            )
        };
        let outcome = if code == EXT_OK {
            let bytes =
                unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
            let text = String::from_utf8_lossy(bytes).into_owned();
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
            println!("[ok]   {label}: immediate, events={text}");
            serde_json::from_str::<serde_json::Value>(&text).ok()
        } else {
            // Take the structured typed error through the ABI.
            let mut error = ExtOwnedBytes {
                ptr: std::ptr::null_mut(),
                len: 0,
            };
            let taken = unsafe { opentray_ext_take_error(&mut error) };
            let detail = if taken == EXT_OK {
                let bytes =
                    unsafe { std::slice::from_raw_parts(error.ptr.cast::<u8>(), error.len) };
                let text = String::from_utf8_lossy(bytes).into_owned();
                unsafe { opentray_ext_free_string(error.ptr, error.len) };
                text
            } else {
                "<no structured error>".to_string()
            };
            println!("[err]  {label}: code={code}, disposition_tag={}, error={detail}", disposition.tag);
            None
        };
        outcome
    };

    // Read answers carry `{data: {type:"text", text: <string|null>}}` in the
    // first event envelope.
    let read_text_field = |events: &Option<serde_json::Value>| -> serde_json::Value {
        events.as_ref().unwrap()[0]["data"]["text"].clone()
    };

    if mode == "clear" {
        dispatch("clear", serde_json::json!({ "type": "clear" }));
        let after = dispatch("read after clear", serde_json::json!({ "type": "readText" }));
        assert_eq!(
            read_text_field(&after),
            serde_json::Value::Null,
            "cleared board reads as the first-class null state"
        );
    } else if mode == "read" {
        // Cross-process read: reports whatever a PREVIOUS process left on
        // the board (no writes in this run).
        dispatch("cross-process readText", serde_json::json!({ "type": "readText" }));
    } else {
        // Surrogate pair in the payload: the real UTF-16 board round trip.
        dispatch(
            "write emoji text",
            serde_json::json!({ "type": "writeText", "text": "OpenTray clipboard probe 🎉" }),
        );
        let read = dispatch("read back", serde_json::json!({ "type": "readText" }));
        assert_eq!(
            read_text_field(&read),
            serde_json::json!("OpenTray clipboard probe 🎉"),
            "board round trip preserves the surrogate pair"
        );
        // Empty-string write is a write, not a clear: read back "" not null.
        dispatch("write empty string", serde_json::json!({ "type": "writeText", "text": "" }));
        let empty = dispatch("read empty write", serde_json::json!({ "type": "readText" }));
        assert_eq!(
            read_text_field(&empty),
            serde_json::json!(""),
            "empty write reads as empty string, distinct from clear's null"
        );
        // Restore the observable marker for the cross-process reader, then
        // leave it on the board (the orchestrator runs pbpaste/Get-Clipboard
        // next, then re-runs this probe with `clear`).
        dispatch(
            "write observable marker",
            serde_json::json!({ "type": "writeText", "text": "opentray-clipboard-probe-observable" }),
        );
    }

    // Session close on the probe session, then deinit.
    let session = c"probe-session";
    let mut events = ExtOwnedBytes {
        ptr: std::ptr::null_mut(),
        len: 0,
    };
    let code = unsafe {
        opentray_ext_session_closed(
            instance,
            std::ptr::null(),
            ExtBytes {
                ptr: session.as_ptr(),
                len: session.to_bytes().len(),
            },
            &mut events,
        )
    };
    println!("session_closed code={code}");
    unsafe { opentray_ext_free_string(events.ptr, events.len) };
    unsafe { opentray_ext_deinit(instance) };
    println!("clipboard_probe complete");
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {
    eprintln!(
        "clipboard_probe: the probe drives the darwin and win32 boards; \
         this platform is typed-unsupported by design"
    );
}
