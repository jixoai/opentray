//! Real-machine sound probe (add-ext-sound task 6.1 helper).
//!
//! Drives the real extension ABI end-to-end from the MAIN thread (the
//! example binary's main thread is the owner-thread contract): every
//! common name, one platform-native name, one guaranteed miss (typed
//! `sound_not_found` details payload), one beep level, and — when a file
//! path argument is supplied — one file playback. Audibility is not a
//! gate (native acceptance and the typed error payloads are); short
//! pauses keep playback alive long enough for human confirmation.
//!
//! Run: cargo run -p opentray-ext-sound --example sound_probe [file.wav]

#[cfg(target_os = "macos")]
const PROBE_NATIVE_NAME: &str = "Basso";
#[cfg(target_os = "windows")]
const PROBE_NATIVE_NAME: &str = "SystemHand";

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() {
    use opentray_ext_sound::{
        opentray_ext_command_v2, opentray_ext_deinit, opentray_ext_free_string,
        opentray_ext_init, opentray_ext_session_closed, opentray_ext_take_error,
    };
    use opentray_spec::{
        ExtBytes, ExtCommandDispositionV1, ExtContext, ExtOwnedBytes, EXT_OK,
    };

    let file_argument = std::env::args().nth(1);

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
            "scope": { "appId": "probe-app", "trayId": "probe-tray", "ext": "sound" },
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
            let bytes = unsafe {
                std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len)
            };
            let text = String::from_utf8_lossy(bytes).into_owned();
            unsafe { opentray_ext_free_string(events.ptr, events.len) };
            println!("[ok]   {label}: immediate, events={text}");
        } else {
            // Take the structured typed error through the ABI.
            let mut error = ExtOwnedBytes {
                ptr: std::ptr::null_mut(),
                len: 0,
            };
            let taken = unsafe { opentray_ext_take_error(&mut error) };
            let detail = if taken == EXT_OK {
                let bytes = unsafe {
                    std::slice::from_raw_parts(error.ptr.cast::<u8>(), error.len)
                };
                let text = String::from_utf8_lossy(bytes).into_owned();
                unsafe { opentray_ext_free_string(error.ptr, error.len) };
                text
            } else {
                "<no structured error>".to_string()
            };
            println!("[err]  {label}: code={code}, disposition_tag={}, error={detail}", disposition.tag);
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    };

    // Every common name (design frozen table x3).
    dispatch("beep warning", serde_json::json!({ "type": "beep", "kind": "warning" }));
    dispatch("common notification", serde_json::json!({ "type": "playSystemSound", "name": "notification" }));
    dispatch("common warning", serde_json::json!({ "type": "playSystemSound", "name": "warning" }));
    dispatch("common error", serde_json::json!({ "type": "playSystemSound", "name": "error" }));
    // One platform-native name (darwin catalog / win32 registry scheme).
    dispatch(
        "native name",
        serde_json::json!({ "type": "playSystemSound", "name": PROBE_NATIVE_NAME }),
    );
    // One guaranteed miss: typed sound_not_found with the details payload.
    dispatch("guaranteed miss", serde_json::json!({ "type": "playSystemSound", "name": "DefinitelyNotASoundNameXYZ" }));
    // Optional file playback.
    if let Some(path) = file_argument {
        dispatch("playSound file", serde_json::json!({ "type": "playSound", "path": path }));
        std::thread::sleep(std::time::Duration::from_millis(1200));
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
    println!("sound_probe complete");
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {
    eprintln!(
        "sound_probe: the probe drives the darwin and win32 surfaces; \
         this platform is typed-unsupported by design"
    );
}
