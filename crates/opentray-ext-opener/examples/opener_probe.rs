//! Real-machine opener probe (add-ext-opener task 6.1 helper).
//!
//! Drives the real extension ABI from the MAIN thread: one https open
//! (default browser), one absolute-path open (default app), one Finder
//! reveal (activateFileViewerSelecting on a real temp file), and the
//! three typed rejections that must never reach a native call
//! (relative target, blocked scheme, path-quote reveal). Browser/Finder
//! visibility is human confirmation; the command surface and typed
//! payloads are the machine gate.
//!
//! Run: cargo run -p opentray-ext-opener --example opener_probe

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() {
    use opentray_ext_opener::{
        opentray_ext_command_v2, opentray_ext_deinit, opentray_ext_free_string,
        opentray_ext_init, opentray_ext_session_closed, opentray_ext_take_error,
    };
    use opentray_spec::{ExtBytes, ExtCommandDispositionV1, ExtContext, ExtOwnedBytes, EXT_OK};

    // A real file on the machine (created here, revealed in the file
    // manager, removed afterwards).
    let probe_file = std::env::temp_dir().join("opentray-opener-probe.txt");
    std::fs::write(&probe_file, "opentray opener probe\n").expect("write probe file");
    let file_target = probe_file.to_string_lossy().into_owned();

    let context = ExtContext {
        api_version: 1,
        app_id: ExtBytes {
            ptr: c"probe-app".as_ptr(),
            len: "probe-app".len(),
        },
    };
    let mut instance = std::ptr::null_mut();
    assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);

    let dispatch = |label: &str, data: serde_json::Value| {
        let envelope = serde_json::json!({
            "scope": { "appId": "probe-app", "trayId": "probe-tray", "ext": "opener" },
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
        if code == EXT_OK {
            let bytes =
                unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
            let text = String::from_utf8_lossy(bytes).into_owned();
            opentray_ext_free_string(events.ptr, events.len);
            println!("[ok]   {label}: immediate, events={text}");
        } else {
            let mut error = ExtOwnedBytes {
                ptr: std::ptr::null_mut(),
                len: 0,
            };
            let taken = unsafe { opentray_ext_take_error(&mut error) };
            let detail = if taken == EXT_OK {
                let bytes =
                    unsafe { std::slice::from_raw_parts(error.ptr.cast::<u8>(), error.len) };
                let text = String::from_utf8_lossy(bytes).into_owned();
                opentray_ext_free_string(error.ptr, error.len);
                text
            } else {
                "<no structured error>".to_string()
            };
            println!("[err]  {label}: code={code}, disposition_tag={}, error={detail}", disposition.tag);
        }
    };

    // Native-accepted surfaces (browser / default app / file manager
    // appear on the real desktop — human confirmation).
    dispatch("open https URL", serde_json::json!({ "type": "open", "target": "https://example.com/" }));
    dispatch("open absolute file", serde_json::json!({ "type": "open", "target": file_target }));
    dispatch(
        "reveal in folder",
        serde_json::json!({ "type": "revealInFolder", "path": file_target }),
    );
    // Typed rejections — no native call may occur.
    dispatch("relative target", serde_json::json!({ "type": "open", "target": "relative/thing.txt" }));
    dispatch("blocked scheme", serde_json::json!({ "type": "open", "target": "ftp://example.com/" }));
    dispatch(
        "path-quote reveal",
        serde_json::json!({ "type": "revealInFolder", "path": "/tmp/e\"vil.txt" }),
    );

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
    opentray_ext_free_string(events.ptr, events.len);
    unsafe { opentray_ext_deinit(instance) };
    std::fs::remove_file(&probe_file).ok();
    println!("opener_probe complete");
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {
    eprintln!(
        "opener_probe: the probe drives the darwin and win32 surfaces; \
         this platform is typed-unsupported by design"
    );
}
