//! OpenTray native opener extension (add-ext-opener batch B, tasks
//! 3.1/3.2/3.3).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: open
//! a URL / absolute file path with the user's default application, or
//! reveal it in the file manager — as host-side atoms with no page
//! bridge):
//! 1. Resolve-on-acceptance (the family law): every command is IMMEDIATE
//!    and resolves when the native call accepts the open/reveal — when
//!    and whether the target application actually presents is not part of
//!    acceptance. No completion event, no DeferredOperation, no poll
//!    owner — `opentray_ext_command_v2` only (the loader's four-cell
//!    matrix gives V2-only libraries full capability).
//! 2. The frozen preflight matrix (design section 2) is facade-owned
//!    pre-transport; this crate re-validates with the same frozen rules
//!    (`resolve.rs`, defense in depth) so a malformed frame can never
//!    reach a native open call: absolute paths pass verbatim (win32
//!    `C:x` drive-relative rejects, UNC is valid, `\\?\` passes literally
//!    with no normalization), URL schemes must pass the frozen allowlist
//!    (http/https/file/mailto, case-insensitive), and revealInFolder
//!    enforces the frozen rejection set (quote / any C0 control — reject,
//!    never escape) plus the trailing-separator trim law with the root
//!    boundary.
//! 3. win32 acceptance is frozen as `ShellExecuteW` returning a value
//!    greater than 32; darwin acceptance is the `NSWorkspace.open`
//!    boolean (osError semantics). Both surface typed `opener_failed`.
//! 4. `getBackend` answers the frozen `OpenerBackendCapabilities` DTO
//!    snapshot (task 3.3) through the shared `{type:"backend"}` ABI
//!    shape; both platform constructors stay compiled so the exhaustive
//!    fixture compares them on every target.
//! 5. The extension is stateless: no retained windows, sounds, or files —
//!    session cleanup reports no events and deinit drops nothing beyond
//!    the instance marker.
//!
//! Compromise: the win32 COM premise is the frozen process-level
//! discipline (owner-thread apartment initialization at broker startup);
//! the command path performs ZERO CoInitialize/CoUninitialize
//! compensation — any measured exception is an implementation-phase P0
//! write-back to the design contract, not in-situ compensation.

mod abi_support;
mod options;
mod resolve;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    ExtBytes, ExtCommandDispositionV1, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode,
    ExtensionEnvelope, TypedExtensionError, EXT_ABI_VERSION, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED,
    EXT_OK,
};

use options::{transport_code, OpenerBackendCapabilities, OpenerCommand};

// The manifest/take-error symbols live beside their support state in
// `abi_support`; the re-export keeps the rlib surface flat for probes.
pub use abi_support::{opentray_ext_manifest, opentray_ext_take_error};

/// Stateless per-mount marker created by `opentray_ext_init`. Opener keeps
/// no retained resources: open/reveal are fire-and-forget native calls and
/// session cleanup owns nothing to stop or drop.
struct OpenerInstance;

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
    let instance = Box::new(OpenerInstance);
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
            "opener session cleanup requires an initialized instance",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(session_id) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "opener session cleanup requires session id bytes",
        );
    };
    if std::str::from_utf8(bytes).is_err() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "opener session id is not UTF-8",
        );
    }
    // Ownership: the opener extension retains nothing per session — close
    // owns exactly zero resources by construction (design section 1).
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<OpenerInstance>()) });
    }
}

#[no_mangle]
pub extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

// ---------------------------------------------------------------------------
// V2 command entry — every opener command is Immediate (design section 1):
// results travel in out_events and the disposition is rewritten to the
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
            "opener command requires an initialized instance",
        );
    }
    if out_disposition.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_disposition_buffer",
            "opener command requires the host-seeded disposition buffer",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                "opener command envelope bytes are missing",
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
                    format!("opener command envelope is invalid: {error}"),
                ),
            )
        }
    };
    let command = match serde_json::from_value::<OpenerCommand>(envelope.data.clone()) {
        Ok(command) => command,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    transport_code::INVALID_OPENER_COMMAND,
                    format!("opener command is invalid: {error}"),
                ),
            )
        }
    };

    match command {
        OpenerCommand::GetBackend => {
            let backend = match backend_capabilities() {
                Ok(backend) => backend,
                Err(error) => {
                    return zero_disposition_then_typed(out_disposition, EXT_ERR_UNSUPPORTED, &error)
                }
            };
            let event = ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                // The facade contract (OpenerBackendEvent in
                // @opentray/ext-opener shared.ts) consumes
                // `{type: "backend", backend}` — the family ABI shape law.
                data: serde_json::json!({
                    "type": "backend",
                    "backend": backend,
                }),
            };
            let outcome = write_owned_events(out_events_json, &[event]);
            if outcome == EXT_OK {
                // Immediate: rewrite the seeded disposition to the
                // all-zero Immediate form (results live in out_events).
                unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
            }
            outcome
        }
        OpenerCommand::Open { target } => {
            // Open commands consume session ownership context: the
            // host-injected commandScope is required before any dispatch
            // (the broker derives it; extensions never self-report it).
            if let Err(code) = require_command_scope(&envelope) {
                return zero_disposition_then(out_disposition, code);
            }
            // Defense-in-depth preflight (facade owns the same frozen
            // matrix pre-transport): the pure gate runs before any
            // platform thread gate, so typed rejections are
            // deterministic on every host.
            let validated = match resolve::validate_open_target(&target) {
                Ok(validated) => validated,
                Err(error) => {
                    return zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
                }
            };
            match platform_open(validated) {
                Ok(()) => immediate_result_event(
                    envelope.scope,
                    "open",
                    out_events_json,
                    out_disposition,
                ),
                Err(error) => {
                    zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
                }
            }
        }
        OpenerCommand::RevealInFolder { path } => {
            if let Err(code) = require_command_scope(&envelope) {
                return zero_disposition_then(out_disposition, code);
            }
            match platform_reveal(&path) {
                Ok(()) => immediate_result_event(
                    envelope.scope,
                    "revealInFolder",
                    out_events_json,
                    out_disposition,
                ),
                Err(error) => {
                    zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
                }
            }
        }
    }
}

/// The host-injected commandScope is required before any dispatch (family
/// law: extensions never self-report session identity).
fn require_command_scope(envelope: &ExtensionEnvelope) -> Result<(), ExtResultCode> {
    if envelope.command_scope.is_none() {
        return Err(abi_support::record_error(
            EXT_ERR_REJECTED,
            transport_code::INVALID_OPENER_COMMAND,
            "opener command requires the host-injected commandScope",
        ));
    }
    Ok(())
}

/// Writes the `{type:"result", op}` Immediate event and rewrites the
/// disposition to the all-zero Immediate form.
unsafe fn immediate_result_event(
    scope: opentray_spec::ExtensionScope,
    op: &str,
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    let event = ExtensionEnvelope {
        scope,
        command_scope: None,
        data: serde_json::json!({ "type": "result", "op": op }),
    };
    let outcome = write_owned_events(out_events_json, &[event]);
    if outcome == EXT_OK {
        unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
    }
    outcome
}

#[cfg(target_os = "macos")]
fn platform_open(target: &str) -> Result<(), TypedExtensionError> {
    // The frozen matrix routed URL targets to `NSWorkspace.open(url)` and
    // path targets to `NSWorkspace.open(URL(fileURLWithPath:))`; win32
    // path forms that can only arrive through a malformed frame still take
    // the path branch — the native oracle produces the typed failure.
    match resolve::classify_target(target) {
        resolve::TargetKind::Url { .. } => macos::open_url(target),
        _ => macos::open_path(target),
    }
}

#[cfg(target_os = "windows")]
fn platform_open(target: &str) -> Result<(), TypedExtensionError> {
    // One verbatim `ShellExecuteW("open", target)` serves paths and URLs
    // alike (the frozen design's win32 projection, design section 2).
    windows::open(target)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_open(_target: &str) -> Result<(), TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn platform_reveal(path: &str) -> Result<(), TypedExtensionError> {
    macos::reveal(path)
}

#[cfg(target_os = "windows")]
fn platform_reveal(path: &str) -> Result<(), TypedExtensionError> {
    windows::reveal(path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_reveal(_path: &str) -> Result<(), TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn backend_capabilities() -> Result<OpenerBackendCapabilities, TypedExtensionError> {
    Ok(OpenerBackendCapabilities::darwin())
}

#[cfg(target_os = "windows")]
fn backend_capabilities() -> Result<OpenerBackendCapabilities, TypedExtensionError> {
    Ok(OpenerBackendCapabilities::win32())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn backend_capabilities() -> Result<OpenerBackendCapabilities, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

// ---------------------------------------------------------------------------
// Shared helpers (dialog/sound-family shapes)
// ---------------------------------------------------------------------------

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

/// Records a typed error and zeroes the disposition (defensive: the host
/// skips disposition classification on error paths, but the struct must
/// never leak a stale Deferred seed — every opener command is Immediate).
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
            "opener output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "serialization_failed",
            "opener output JSON contains a nul byte",
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
                format!("opener events could not be serialized: {error}"),
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
        assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);
        instance
    }

    fn command_envelope(data: serde_json::Value) -> CString {
        let envelope = serde_json::json!({
            "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "opener" },
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

    fn lock_error_slot_tests()
    -> std::sync::MutexGuard<'static, ()> {
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
        opentray_ext_free_string(output.ptr, output.len);
        detail
    }

    #[test]
    fn exports_embedded_artifact_identity() {
        let _slot = lock_error_slot_tests();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        assert_eq!(unsafe { abi_support::opentray_ext_manifest(&mut output) }, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest: opentray_spec::EmbeddedExtensionManifest =
            serde_json::from_slice(bytes).expect("manifest JSON");
        assert_eq!(manifest.extension_name, "opener");
        // The embedded manifest's artifactSetVersion mirrors the npm facade
        // package.json (the release identity); compare against the same
        // include_str! source the build script stages (release-source
        // bumps move independently of the cargo workspace version).
        let facade_version: String = serde_json::from_str::<serde_json::Value>(
            include_str!("../../../packages/ext-opener/package.json"),
        )
        .expect("facade package.json")["version"]
            .as_str()
            .expect("version string")
            .to_string();
        assert_eq!(manifest.artifact_set_version, facade_version);
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-opener-contract-1"
        );
        assert_eq!(manifest.abi_version, EXT_ABI_VERSION);
        assert!(!manifest.build_identity.is_empty());
        opentray_ext_free_string(output.ptr, output.len);
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
        opentray_ext_free_string(events.ptr, events.len);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].data["type"], "backend");
        let backend = &parsed[0].data["backend"];
        assert_eq!(backend["platform"], "darwin");
        assert_eq!(
            backend["allowedSchemes"],
            serde_json::json!(["http", "https", "file", "mailto"])
        );
        assert_eq!(backend["supportsRevealInFolder"], true);
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
        assert_eq!(detail.category, transport_code::INVALID_OPENER_COMMAND);
        assert!(!detail.message.is_empty());

        // Unknown field (v1 has no options): rejected, never ignored.
        let envelope = command_envelope(serde_json::json!({
            "type": "open", "target": "/a.txt", "mystery": true
        }));
        let (code, _events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert_eq!(
            take_error_detail().category,
            transport_code::INVALID_OPENER_COMMAND
        );

        // Missing required field.
        let envelope = command_envelope(serde_json::json!({ "type": "open" }));
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(
            take_error_detail().category,
            transport_code::INVALID_OPENER_COMMAND
        );

        // Malformed envelope bytes.
        let raw = CString::new("{ not json").unwrap();
        let (code, _events, _disposition) = dispatch(instance, &raw);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(take_error_detail().category, "invalid_command_envelope");
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn open_without_command_scope_rejects_before_any_state_change() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "opener" },
                "data": { "type": "open", "target": "https://example.com" }
            })
            .to_string(),
        )
        .unwrap();
        let (code, events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert!(events.ptr.is_null());
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        let detail = take_error_detail();
        assert_eq!(detail.category, transport_code::INVALID_OPENER_COMMAND);
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The pure defense-in-depth preflight gate runs BEFORE any platform
    /// thread gate, so every typed matrix rejection surfaces
    /// deterministically through the ABI on any host (harness thread
    /// included).
    #[test]
    fn typed_preflight_rejections_surface_through_the_abi() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();

        let cases: &[(serde_json::Value, &str, serde_json::Value)] = &[
            // Blocked scheme: typed opener_scheme_blocked with the scheme.
            (
                serde_json::json!({ "type": "open", "target": "ssh://host.example" }),
                "opener_scheme_blocked",
                serde_json::json!({ "scheme": "ssh" }),
            ),
            (
                serde_json::json!({ "type": "open", "target": "chrome://settings" }),
                "opener_scheme_blocked",
                serde_json::json!({ "scheme": "chrome" }),
            ),
            // Drive-relative win32 form.
            (
                serde_json::json!({ "type": "open", "target": "C:file.txt" }),
                "opener_target_invalid",
                serde_json::json!({ "reason": "drive-relative" }),
            ),
            // Relative / protocol-less string.
            (
                serde_json::json!({ "type": "open", "target": "relative/file.txt" }),
                "opener_target_invalid",
                serde_json::json!({ "reason": "relative" }),
            ),
            // Reveal rejection set: quote and C0 control characters.
            (
                serde_json::json!({ "type": "revealInFolder", "path": "C:\\a\"b" }),
                "opener_target_invalid",
                serde_json::json!({ "reason": "path-quote" }),
            ),
            (
                serde_json::json!({ "type": "revealInFolder", "path": "/tmp/a\u{1}b" }),
                "opener_target_invalid",
                serde_json::json!({ "reason": "path-control-char" }),
            ),
            // Reveal relative target.
            (
                serde_json::json!({ "type": "revealInFolder", "path": "notes/todo.txt" }),
                "opener_target_invalid",
                serde_json::json!({ "reason": "relative" }),
            ),
        ];
        for (data, expected_code, expected_details) in cases {
            let envelope = command_envelope(data.clone());
            let (code, events, disposition) = dispatch(instance, &envelope);
            assert_eq!(code, EXT_ERR_REJECTED, "data: {data}");
            assert!(events.ptr.is_null(), "no events on a rejected command");
            assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
            assert!(disposition.value_is_zero());
            let detail = take_error_detail();
            assert_eq!(detail.category, *expected_code, "data: {data}");
            assert_eq!(detail.details.as_ref().unwrap(), expected_details);
        }
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The darwin open/reveal surfaces are owner-thread-bound; a
    /// harness-thread dispatch of a VALID target is the honest typed
    /// host-contract rejection, before any native call. This is the
    /// off-main branch evidence; the real owner-thread path is exercised
    /// on a real machine (task 6.1).
    #[cfg(target_os = "macos")]
    #[test]
    fn darwin_valid_targets_off_the_owner_thread_reject_with_the_thread_category() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        for data in [
            serde_json::json!({ "type": "open", "target": "/tmp/report.txt" }),
            serde_json::json!({ "type": "open", "target": "https://example.com" }),
            serde_json::json!({ "type": "revealInFolder", "path": "/tmp/report.txt" }),
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
        opentray_ext_free_string(events.ptr, events.len);
        // A repeated close stays idempotent (nothing was retained).
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
        opentray_ext_free_string(events.ptr, events.len);
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
