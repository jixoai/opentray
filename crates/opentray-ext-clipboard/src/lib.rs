//! OpenTray native clipboard extension (add-ext-clipboard batch B, tasks
//! 3.1/3.2/3.3).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: OS
//! clipboard text atoms — read, write, clear — as host-side atoms with no
//! page bridge):
//! 1. Every command is IMMEDIATE (design reference shares the
//!    add-ext-dialog/add-ext-sound Immediate family law): results travel
//!    in out_events and the disposition is rewritten to the all-zero
//!    Immediate form — no DeferredOperation, no completion port, no poll
//!    owner; `opentray_ext_command_v2` only (the loader's four-cell matrix
//!    gives V2-only libraries full capability).
//! 2. readText resolves `null` for an empty/textless board — the empty
//!    state is a first-class value, never an error and never an empty
//!    string (design section 1).
//! 3. The platform seams own the frozen laws: darwin NSPasteboard on the
//!    owner thread; win32 bounded-open retry discipline + HGLOBAL
//!    ownership through the seam-tested flows (`windows`, `macos`).
//! 4. `getBackend` answers the frozen `ClipboardBackendCapabilities` DTO
//!    snapshot (task 3.3) through the shared `{type:"backend"}` ABI shape
//!    law; both platform constructors stay compiled so the exhaustive
//!    fixture compares them on every target.
//!
//! Compromise: clipboard owns NO session-scoped state — the instance is a
//! plain marker; session close is idempotent and event-free. Commands do
//! not consume session ownership, so (mirroring getBackend in the sound
//! family) no clipboard command requires the host-injected commandScope.

mod abi_support;
mod options;

#[cfg(target_os = "macos")]
mod macos;

// The win32 discipline core (flows + retry + seams) compiles under test on
// every host so the spy suite runs wherever `cargo test` does; the real
// user32/kernel32 surface compiles only on Windows targets.
#[cfg(any(target_os = "windows", test))]
mod windows;

use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    ExtBytes, ExtCommandDispositionV1, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode,
    ExtensionEnvelope, TypedExtensionError, EXT_ABI_VERSION, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED,
    EXT_OK,
};

use options::{transport_code, ClipboardBackendCapabilities, ClipboardCommand};

// The manifest/take-error symbols live beside their support state in
// `abi_support`; the re-export keeps the rlib surface flat for probes.
pub use abi_support::{opentray_ext_manifest, opentray_ext_take_error};

/// Per-mount instance created by `opentray_ext_init`. Clipboard owns no
/// session state; the marker keeps the ABI instance contract honest.
struct ClipboardInstance;

// ---------------------------------------------------------------------------
// Required ABI-3 symbols
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn opentray_ext_abi_version() -> u32 {
    EXT_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_init(
    context: *const ExtContext,
    out_instance: *mut *mut c_void,
) -> ExtResultCode {
    abi_support::clear_error();
    if context.is_null() || out_instance.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_init_context",
            "init requires context and output instance pointers",
        );
    }
    let instance = Box::new(ClipboardInstance);
    unsafe {
        *out_instance = Box::into_raw(instance).cast::<c_void>();
    }
    EXT_OK
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_session_closed(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    session_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    abi_support::clear_error();
    if instance.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "clipboard session cleanup requires an initialized instance",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(session_id) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "clipboard session cleanup requires session id bytes",
        );
    };
    if std::str::from_utf8(bytes).is_err() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "clipboard session id is not UTF-8",
        );
    }

    // Clipboard holds no session-owned state (no retained handles, no
    // observers): close is a no-op that stays idempotent.
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<ClipboardInstance>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

// ---------------------------------------------------------------------------
// V2 command entry — every clipboard command is Immediate (design section
// 1): results travel in out_events and the disposition is rewritten to the
// all-zero Immediate form.
// ---------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_command_v2(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    abi_support::clear_error();
    if instance.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "clipboard command requires an initialized instance",
        );
    }
    if out_disposition.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_disposition_buffer",
            "clipboard command requires the host-seeded disposition buffer",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                "clipboard command envelope bytes are missing",
            ),
        );
    };
    let envelope = match serde_json::from_slice::<ExtensionEnvelope>(bytes) {
        Ok(envelope) => envelope,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    "invalid_command_envelope",
                    format!("clipboard command envelope is invalid: {error}"),
                ),
            )
        }
    };
    let command = match serde_json::from_value::<ClipboardCommand>(envelope.data.clone()) {
        Ok(command) => command,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    transport_code::INVALID_CLIPBOARD_COMMAND,
                    format!("clipboard command is invalid: {error}"),
                ),
            )
        }
    };

    match command {
        ClipboardCommand::GetBackend => {
            let backend = match backend_capabilities() {
                Ok(backend) => backend,
                Err(error) => {
                    return zero_disposition_then_typed(
                        out_disposition,
                        EXT_ERR_UNSUPPORTED,
                        &error,
                    )
                }
            };
            // The shared `{type:"backend"}` ABI shape law (dialog/sound
            // review chain): the facade consumes exactly this event shape.
            let event = ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                data: options::backend_result_event(&backend),
            };
            let outcome = write_owned_events(out_events_json, &[event]);
            if outcome == EXT_OK {
                // Immediate: rewrite the seeded disposition to the
                // all-zero Immediate form (results live in out_events).
                unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
            }
            outcome
        }
        ClipboardCommand::ReadText => {
            // null is the first-class empty board state (design section 1):
            // the value travels in the frozen `{type:"text"}` event.
            let answer =
                platform_read_text().map(|value| options::text_result_event(value.as_deref()));
            answer_immediately(out_events_json, out_disposition, &envelope, answer)
        }
        ClipboardCommand::WriteText { text } => {
            let answer = platform_write_text(&text).map(|()| options::op_result_event("writeText"));
            answer_immediately(out_events_json, out_disposition, &envelope, answer)
        }
        ClipboardCommand::Clear => {
            let answer = platform_clear().map(|()| options::op_result_event("clear"));
            answer_immediately(out_events_json, out_disposition, &envelope, answer)
        }
    }
}

/// Shared Immediate answer: `Ok(data)` emits the result event and rewrites
/// the disposition; `Err` records the typed error with a zeroed
/// disposition.
unsafe fn answer_immediately(
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
    envelope: &ExtensionEnvelope,
    answer: Result<serde_json::Value, TypedExtensionError>,
) -> ExtResultCode {
    match answer {
        Ok(data) => {
            let event = ExtensionEnvelope {
                scope: envelope.scope.clone(),
                command_scope: None,
                data,
            };
            let outcome = write_owned_events(out_events_json, &[event]);
            if outcome == EXT_OK {
                unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
            }
            outcome
        }
        Err(error) => zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error),
    }
}

// ---------------------------------------------------------------------------
// Platform seams (mainstream targets own their projection; other targets
// answer the typed platform rejection)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn platform_read_text() -> Result<Option<String>, TypedExtensionError> {
    macos::read_text()
}

#[cfg(target_os = "windows")]
fn platform_read_text() -> Result<Option<String>, TypedExtensionError> {
    windows::native::read_text()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_read_text() -> Result<Option<String>, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn platform_write_text(text: &str) -> Result<(), TypedExtensionError> {
    macos::write_text(text)
}

#[cfg(target_os = "windows")]
fn platform_write_text(text: &str) -> Result<(), TypedExtensionError> {
    windows::native::write_text(text)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_write_text(_text: &str) -> Result<(), TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn platform_clear() -> Result<(), TypedExtensionError> {
    macos::clear()
}

#[cfg(target_os = "windows")]
fn platform_clear() -> Result<(), TypedExtensionError> {
    windows::native::clear()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_clear() -> Result<(), TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn backend_capabilities() -> Result<ClipboardBackendCapabilities, TypedExtensionError> {
    Ok(ClipboardBackendCapabilities::darwin())
}

#[cfg(target_os = "windows")]
fn backend_capabilities() -> Result<ClipboardBackendCapabilities, TypedExtensionError> {
    Ok(ClipboardBackendCapabilities::win32())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn backend_capabilities() -> Result<ClipboardBackendCapabilities, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

// ---------------------------------------------------------------------------
// Shared helpers (dialog/sound family shapes)
// ---------------------------------------------------------------------------

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

/// Records a typed error and zeroes the disposition (defensive: the host
/// skips disposition classification on error paths, but the struct must
/// never leak a stale Deferred seed — every clipboard command is Immediate).
unsafe fn zero_disposition_then_typed(
    out_disposition: *mut ExtCommandDispositionV1,
    code: ExtResultCode,
    error: &TypedExtensionError,
) -> ExtResultCode {
    unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
    abi_support::record_typed_error(code, error)
}

unsafe fn zero_disposition_then(
    out_disposition: *mut ExtCommandDispositionV1,
    code: ExtResultCode,
) -> ExtResultCode {
    unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
    code
}

fn write_owned_json(out: *mut ExtOwnedBytes, json: &str) -> ExtResultCode {
    if out.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_output_buffer",
            "clipboard output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "serialization_failed",
            "clipboard output JSON contains a nul byte",
        );
    };
    let len = value.as_bytes().len();
    unsafe {
        *out = ExtOwnedBytes {
            ptr: value.into_raw().cast::<c_char>(),
            len,
        };
    }
    EXT_OK
}

fn write_owned_events(out: *mut ExtOwnedBytes, events: &[ExtensionEnvelope]) -> ExtResultCode {
    let json = match serde_json::to_string(events) {
        Ok(json) => json,
        Err(error) => {
            return abi_support::record_error(
                EXT_ERR_REJECTED,
                "serialization_failed",
                format!("clipboard events could not be serialized: {error}"),
            )
        }
    };
    write_owned_json(out, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentray_spec::EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE;
    use std::ptr;

    fn init_instance() -> *mut c_void {
        let context = ExtContext {
            api_version: 1,
            app_id: ExtBytes {
                ptr: c"app-1".as_ptr(),
                len: "app-1".len(),
            },
        };
        let mut instance = ptr::null_mut();
        assert_eq!(
            unsafe { opentray_ext_init(&context, &mut instance) },
            EXT_OK
        );
        instance
    }

    fn command_envelope(data: serde_json::Value) -> CString {
        let envelope = serde_json::json!({
            "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "clipboard" },
            "commandScope": {
                "appId": "app-1",
                "trayId": "tray-1",
                "sessionId": "session-1",
                "instanceGeneration": 1
            },
            "data": data
        });
        CString::new(envelope.to_string()).unwrap()
    }

    fn dispatch(
        instance: *mut c_void,
        envelope: &CString,
    ) -> (ExtResultCode, ExtOwnedBytes, ExtCommandDispositionV1) {
        let mut events = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        // The host seeds a Deferred disposition; a well-formed Immediate
        // answer must rewrite it to the all-zero Immediate form.
        let mut disposition = ExtCommandDispositionV1::deferred(0x1234_5678);
        let code = unsafe {
            opentray_ext_command_v2(
                instance,
                ptr::null(),
                ExtBytes {
                    ptr: envelope.as_ptr(),
                    len: envelope.as_bytes().len(),
                },
                &mut events,
                &mut disposition,
            )
        };
        (code, events, disposition)
    }

    /// The ABI error-detail slot is process-global; tests that dispatch a
    /// rejection and then assert `take_error_detail` must serialize their
    /// whole body, or a parallel harness thread's rejection can overwrite
    /// (or consume) the detail between this test's dispatch and its take.
    static ERROR_SLOT_TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock_error_slot_tests() -> std::sync::MutexGuard<'static, ()> {
        ERROR_SLOT_TESTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn take_error_detail() -> opentray_spec::ExtensionErrorDetail {
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        assert_eq!(
            unsafe { abi_support::opentray_ext_take_error(&mut output) },
            EXT_OK
        );
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let detail: opentray_spec::ExtensionErrorDetail =
            serde_json::from_slice(bytes).expect("error JSON");
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
        detail
    }

    #[test]
    fn exports_embedded_artifact_identity() {
        let _slot = lock_error_slot_tests();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        assert_eq!(
            unsafe { abi_support::opentray_ext_manifest(&mut output) },
            EXT_OK
        );
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest: opentray_spec::EmbeddedExtensionManifest =
            serde_json::from_slice(bytes).expect("manifest JSON");
        assert_eq!(manifest.extension_name, "clipboard");
        // The embedded manifest's artifactSetVersion mirrors the npm facade
        // package.json (the release identity), which the versioned release
        // source bumps independently of the cargo workspace version —
        // compare against the same include_str! source instead of a
        // hard-coded literal (ext-sound release-run P1 precedent).
        let facade_version: String = serde_json::from_str::<serde_json::Value>(include_str!(
            "../../../packages/ext-clipboard/package.json"
        ))
        .expect("facade package.json")["version"]
            .as_str()
            .expect("version string")
            .to_string();
        assert_eq!(manifest.artifact_set_version, facade_version);
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-clipboard-contract-1"
        );
        assert_eq!(manifest.abi_version, EXT_ABI_VERSION);
        assert!(!manifest.build_identity.is_empty());
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn get_backend_answers_immediate_with_the_frozen_darwin_dto() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let envelope = command_envelope(serde_json::json!({ "type": "getBackend" }));
        let (code, events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_OK);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert!(disposition.value_is_zero());

        let bytes = unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
        let parsed: Vec<ExtensionEnvelope> = serde_json::from_slice(bytes).expect("events");
        unsafe { opentray_ext_free_string(events.ptr, events.len) };
        assert_eq!(parsed.len(), 1);
        // The shared ABI shape law: {type:"backend", backend:{...}}.
        assert_eq!(parsed[0].data["type"], "backend");
        let backend = &parsed[0].data["backend"];
        assert_eq!(backend["platform"], "darwin");
        assert_eq!(backend["textOnly"], true);
        assert_eq!(backend["maxWriteUtf16"], 1_048_576u64);
        assert_eq!(backend["boundedOpenRetry"], false);
        // Response envelopes never carry the command scope.
        assert_eq!(parsed[0].command_scope, None);
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn invalid_commands_reject_with_a_zeroed_disposition() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        // Unknown command type.
        let envelope = command_envelope(serde_json::json!({ "type": "nonsense" }));
        let (code, events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert!(events.ptr.is_null(), "no events on a rejected command");
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert!(disposition.value_is_zero());
        let detail = take_error_detail();
        assert_eq!(detail.category, transport_code::INVALID_CLIPBOARD_COMMAND);
        assert!(!detail.message.is_empty());

        // Unknown field: rejected, never ignored.
        let envelope = command_envelope(serde_json::json!({
            "type": "writeText", "text": "hi", "flush": true
        }));
        let (code, _events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert_eq!(
            take_error_detail().category,
            transport_code::INVALID_CLIPBOARD_COMMAND
        );

        // Missing required field.
        let envelope = command_envelope(serde_json::json!({ "type": "writeText" }));
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(
            take_error_detail().category,
            transport_code::INVALID_CLIPBOARD_COMMAND
        );

        // Malformed envelope bytes.
        let raw = CString::new("{ not json").unwrap();
        let (code, _events, _disposition) = dispatch(instance, &raw);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(take_error_detail().category, "invalid_command_envelope");
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The darwin clipboard surfaces are owner-thread-bound (the
    /// MainThreadOnly delegate family discipline, design section 4): a
    /// harness-thread dispatch is the honest typed host-contract rejection,
    /// before any board state change. This is the off-main branch evidence;
    /// the real owner-thread path is exercised on a real machine (batch E).
    #[cfg(target_os = "macos")]
    #[test]
    fn darwin_board_commands_off_the_owner_thread_reject_with_the_thread_category() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        for data in [
            serde_json::json!({ "type": "readText" }),
            serde_json::json!({ "type": "writeText", "text": "hi" }),
            serde_json::json!({ "type": "clear" }),
        ] {
            let envelope = command_envelope(data);
            let (code, events, disposition) = dispatch(instance, &envelope);
            assert_eq!(code, EXT_ERR_REJECTED);
            assert!(events.ptr.is_null());
            assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
            let detail = take_error_detail();
            assert_eq!(detail.category, transport_code::INVALID_DISPATCH_THREAD);
        }
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn session_closed_reports_empty_events_for_an_idle_session() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let session_id = c"session-1";
        let mut events = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let result = unsafe {
            opentray_ext_session_closed(
                instance,
                ptr::null(),
                ExtBytes {
                    ptr: session_id.as_ptr(),
                    len: session_id.to_bytes().len(),
                },
                &mut events,
            )
        };
        assert_eq!(result, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
        assert_eq!(bytes, b"[]");
        unsafe { opentray_ext_free_string(events.ptr, events.len) };
        // A repeated close stays idempotent (no session state exists).
        let mut events = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let result = unsafe {
            opentray_ext_session_closed(
                instance,
                ptr::null(),
                ExtBytes {
                    ptr: session_id.as_ptr(),
                    len: session_id.to_bytes().len(),
                },
                &mut events,
            )
        };
        assert_eq!(result, EXT_OK);
        unsafe { opentray_ext_free_string(events.ptr, events.len) };
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn null_instance_commands_reject_without_touching_state() {
        let _slot = lock_error_slot_tests();
        let mut events = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let mut disposition = ExtCommandDispositionV1::immediate();
        let envelope = CString::new("{}").unwrap();
        let code = unsafe {
            opentray_ext_command_v2(
                ptr::null_mut(),
                ptr::null(),
                ExtBytes {
                    ptr: envelope.as_ptr(),
                    len: envelope.as_bytes().len(),
                },
                &mut events,
                &mut disposition,
            )
        };
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(take_error_detail().category, "invalid_instance");
    }
}
