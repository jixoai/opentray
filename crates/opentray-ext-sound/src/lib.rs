//! OpenTray native sound extension (add-ext-sound batch B, tasks
//! 3.1/3.2/3.3).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: OS
//! standard sound feedback atoms — beep, named system sounds, low-cost
//! file playback — as host-side atoms with no page bridge):
//! 1. Fire-and-forget: every command is IMMEDIATE and resolves when the
//!    native call accepts playback (design section 1.4). No completion
//!    event, no DeferredOperation, no poll owner — `opentray_ext_command_v2`
//!    only (the loader's four-cell matrix gives V2-only libraries full
//!    capability).
//! 2. The common system-sound name table is frozen (three names, per-
//!    platform projections, design section 1.2); a miss is the typed
//!    `sound_not_found` with the full resolution trace — never a silent
//!    fallback, never an error-free miss.
//! 3. win32 playback ownership is gated by the process-wide
//!    PlaybackArbiter (design section 1.4 law): one mutex critical
//!    section per native call; session close purges only on a full-token
//!    match. darwin keeps session-owned `NSSound` sets; close stops only
//!    its own set.
//! 4. `getBackend` answers the frozen `SoundBackendCapabilities` DTO
//!    snapshot (task 3.3); both platform constructors stay compiled so
//!    the exhaustive fixture compares them on every target.
//!
//! Compromise: beep on win32 maps the five frozen kinds onto
//! `MessageBeep` and never enters the arbiter (`MessageBeep` does not
//! touch the `PlaySound` single channel); darwin degrades every kind to
//! `NSBeep()` (documented degradation, design section 1.1).

mod abi_support;
mod options;
mod state;

/// The process-wide PlaybackArbiter core (win32 law; deterministic race
/// tests run on every host through the spy seam).
#[cfg(any(target_os = "windows", test))]
mod arbiter;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    CommandScope, ExtBytes, ExtCommandDispositionV1, ExtContext, ExtHostContext, ExtOwnedBytes,
    ExtResultCode, ExtensionEnvelope, TypedExtensionError, EXT_ABI_VERSION, EXT_ERR_REJECTED,
    EXT_ERR_UNSUPPORTED, EXT_OK,
};

use options::{transport_code, BeepKind, SoundBackendCapabilities, SoundCommand};
use state::SoundInstance;

// The manifest/take-error symbols live beside their support state in
// `abi_support`; the re-export keeps the rlib surface flat for probes.
pub use abi_support::{opentray_ext_manifest, opentray_ext_take_error};

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
    let instance = Box::new(SoundInstance::new());
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
            "sound session cleanup requires an initialized instance",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(session_id) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "sound session cleanup requires session id bytes",
        );
    };
    let Ok(session_id) = std::str::from_utf8(bytes) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "sound session id is not UTF-8",
        );
    };

    // Ownership gate (design section 1.4): win32 compares the full
    // PlaybackArbiter token under its lock and purges only on a match;
    // darwin stops and drops exactly this session's NSSound set.
    let extension = unsafe { &mut *instance.cast::<SoundInstance>() };
    #[cfg(target_os = "macos")]
    macos::close_session(&extension.darwin, session_id);
    #[cfg(target_os = "windows")]
    windows::close_session(extension.arbiter_key, session_id);

    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        // Drop runs the ownership teardown: the arbiter unregisters this
        // instance (purging only its own live playback); the darwin state
        // stops its own session sets.
        drop(unsafe { Box::from_raw(instance.cast::<SoundInstance>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

// ---------------------------------------------------------------------------
// V2 command entry — every sound command is Immediate (design section
// 1.4): results travel in out_events and the disposition is rewritten to
// the all-zero Immediate form.
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
            "sound command requires an initialized instance",
        );
    }
    if out_disposition.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_disposition_buffer",
            "sound command requires the host-seeded disposition buffer",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                "sound command envelope bytes are missing",
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
                    format!("sound command envelope is invalid: {error}"),
                ),
            )
        }
    };
    let command = match serde_json::from_value::<SoundCommand>(envelope.data.clone()) {
        Ok(command) => command,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    transport_code::INVALID_SOUND_COMMAND,
                    format!("sound command is invalid: {error}"),
                ),
            )
        }
    };
    let extension = unsafe { &mut *instance.cast::<SoundInstance>() };

    match command {
        SoundCommand::GetBackend => {
            let backend = match backend_capabilities() {
                Ok(backend) => backend,
                Err(error) => {
                    return zero_disposition_then_typed(out_disposition, EXT_ERR_UNSUPPORTED, &error)
                }
            };
            let event = ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                // The facade contract (SoundBackendEvent in
                // @opentray/ext-sound shared.ts) consumes `type: "backend"`.
                // The previous `type:"result", op:"getBackend"` form made
                // every real getBackend call fail the facade's contract
                // check (sound review R1 P1 — mocked transports masked it).
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
        play => {
            // Play commands consume session ownership: the host-injected
            // commandScope is required before any state change (the
            // broker derives it; extensions never self-report it).
            let Some(scope) = envelope.command_scope.clone() else {
                return zero_disposition_then(
                    out_disposition,
                    abi_support::record_error(
                        EXT_ERR_REJECTED,
                        transport_code::INVALID_SOUND_COMMAND,
                        "sound play command requires the host-injected commandScope",
                    ),
                );
            };
            match dispatch_play(extension, play, &scope) {
                Ok(op) => {
                    let event = ExtensionEnvelope {
                        scope: envelope.scope,
                        command_scope: None,
                        data: serde_json::json!({ "type": "result", "op": op }),
                    };
                    let outcome = write_owned_events(out_events_json, &[event]);
                    if outcome == EXT_OK {
                        unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
                    }
                    outcome
                }
                Err(error) => {
                    zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
                }
            }
        }
    }
}

/// Routes one play command to the platform surface; `Ok(op)` carries the
/// result-event op label. Failures are typed errors recorded by the
/// caller (resolve-on-acceptance law: a native non-acceptance never
/// resolves).
fn dispatch_play(
    extension: &mut SoundInstance,
    command: SoundCommand,
    scope: &CommandScope,
) -> Result<&'static str, TypedExtensionError> {
    match command {
        SoundCommand::Beep { kind } => platform_beep(extension, scope, kind),
        SoundCommand::PlaySystemSound { name } => {
            platform_play_system_sound(extension, scope, &name)
        }
        SoundCommand::PlaySound { path } => {
            // Native defense-in-depth resolution (facade preflight owns
            // the caller-cwd canonicalization and the win32 RIFF rules).
            let resolved = state::resolve_audio_path(&path);
            platform_play_sound(extension, scope, &resolved)
        }
        SoundCommand::GetBackend => unreachable!("getBackend handled by the caller"),
    }
}

#[cfg(target_os = "macos")]
fn platform_beep(
    _extension: &mut SoundInstance,
    _scope: &CommandScope,
    _kind: BeepKind,
) -> Result<&'static str, TypedExtensionError> {
    // darwin: every kind degrades to NSBeep() (design section 1.1) —
    // accepted by definition once the dispatch thread contract holds.
    macos::beep()?;
    Ok("beep")
}

#[cfg(target_os = "windows")]
fn platform_beep(
    _extension: &mut SoundInstance,
    _scope: &CommandScope,
    kind: BeepKind,
) -> Result<&'static str, TypedExtensionError> {
    // win32: MessageBeep never enters the arbiter. A native false (for
    // example no sound device) still rejects — the resolve-on-acceptance
    // law (design section 1.4) has no silent path, and the frozen
    // four-code catalog's `sound_not_found` is the closest honest code:
    // the requested alert sound was not produced.
    if windows::beep(kind) {
        return Ok("beep");
    }
    let attempted = windows::beep_trace(kind);
    eprintln!(
        "opentray-ext-sound beep native false: kind={} attempted={attempted:?}",
        kind.label()
    );
    Err(options::not_found_error(kind.label(), "win32", attempted))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_beep(
    _extension: &mut SoundInstance,
    _scope: &CommandScope,
    _kind: BeepKind,
) -> Result<&'static str, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn platform_play_system_sound(
    extension: &mut SoundInstance,
    scope: &CommandScope,
    name: &str,
) -> Result<&'static str, TypedExtensionError> {
    let resolution = options::resolve_system_sound(name, true);
    macos::play_system_sound(&extension.darwin, &scope.session_id, &resolution)?;
    Ok("playSystemSound")
}

#[cfg(target_os = "windows")]
fn platform_play_system_sound(
    extension: &mut SoundInstance,
    scope: &CommandScope,
    name: &str,
) -> Result<&'static str, TypedExtensionError> {
    let resolution = options::resolve_system_sound(name, false);
    windows::play_system_sound(
        extension.arbiter_key,
        &scope.session_id,
        scope.instance_generation,
        &resolution,
    )?;
    Ok("playSystemSound")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_play_system_sound(
    _extension: &mut SoundInstance,
    _scope: &CommandScope,
    _name: &str,
) -> Result<&'static str, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn platform_play_sound(
    extension: &mut SoundInstance,
    scope: &CommandScope,
    path: &std::path::Path,
) -> Result<&'static str, TypedExtensionError> {
    macos::play_file(&extension.darwin, &scope.session_id, path)?;
    Ok("playSound")
}

#[cfg(target_os = "windows")]
fn platform_play_sound(
    extension: &mut SoundInstance,
    scope: &CommandScope,
    path: &std::path::Path,
) -> Result<&'static str, TypedExtensionError> {
    windows::play_file(
        extension.arbiter_key,
        &scope.session_id,
        scope.instance_generation,
        path,
    )?;
    Ok("playSound")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_play_sound(
    _extension: &mut SoundInstance,
    _scope: &CommandScope,
    _path: &std::path::Path,
) -> Result<&'static str, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

#[cfg(target_os = "macos")]
fn backend_capabilities() -> Result<SoundBackendCapabilities, TypedExtensionError> {
    Ok(SoundBackendCapabilities::darwin())
}

#[cfg(target_os = "windows")]
fn backend_capabilities() -> Result<SoundBackendCapabilities, TypedExtensionError> {
    Ok(SoundBackendCapabilities::win32())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn backend_capabilities() -> Result<SoundBackendCapabilities, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

// ---------------------------------------------------------------------------
// Shared helpers (dialog-family shapes)
// ---------------------------------------------------------------------------

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

/// Records a typed error and zeroes the disposition (defensive: the host
/// skips disposition classification on error paths, but the struct must
/// never leak a stale Deferred seed — every sound command is Immediate).
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
            "sound output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "serialization_failed",
            "sound output JSON contains a nul byte",
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
                format!("sound events could not be serialized: {error}"),
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
            "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "sound" },
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
        assert_eq!(unsafe { abi_support::opentray_ext_manifest(&mut output) }, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest: opentray_spec::EmbeddedExtensionManifest =
            serde_json::from_slice(bytes).expect("manifest JSON");
        assert_eq!(manifest.extension_name, "sound");
        assert_eq!(manifest.artifact_set_version, "0.0.0");
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-sound-contract-1"
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
        assert_eq!(parsed[0].data["type"], "backend");
        let backend = &parsed[0].data["backend"];
        assert_eq!(backend["platform"], "darwin");
        assert_eq!(backend["systemSoundCatalog"], true);
        assert_eq!(backend["playFile"], true);
        assert_eq!(
            backend["fileFormats"],
            serde_json::json!(["wav", "aiff", "mp3", "m4a"])
        );
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
        assert_eq!(detail.category, transport_code::INVALID_SOUND_COMMAND);
        assert!(!detail.message.is_empty());

        // Unknown field (v1 has no options): rejected, never ignored.
        let envelope = command_envelope(serde_json::json!({
            "type": "playSound", "path": "/a.wav", "volume": 0.5
        }));
        let (code, _events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert_eq!(
            take_error_detail().category,
            transport_code::INVALID_SOUND_COMMAND
        );

        // Malformed envelope bytes.
        let raw = CString::new("{ not json").unwrap();
        let (code, _events, _disposition) = dispatch(instance, &raw);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(take_error_detail().category, "invalid_command_envelope");
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn play_without_command_scope_rejects_before_any_state_change() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "sound" },
                "data": { "type": "beep" }
            })
            .to_string(),
        )
        .unwrap();
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        let detail = take_error_detail();
        assert_eq!(detail.category, transport_code::INVALID_SOUND_COMMAND);
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The darwin play surfaces are owner-thread-bound (the MainThreadOnly
    /// delegate family): a harness-thread dispatch is the honest typed
    /// host-contract rejection, before any state change. This is the
    /// off-main branch evidence; the real owner-thread path is exercised
    /// by the sound_probe example on a real machine.
    #[cfg(target_os = "macos")]
    #[test]
    fn darwin_play_commands_off_the_owner_thread_reject_with_the_thread_category() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        for data in [
            serde_json::json!({ "type": "beep", "kind": "warning" }),
            serde_json::json!({ "type": "playSystemSound", "name": "Glass" }),
            serde_json::json!({ "type": "playSound", "path": "/tmp/any.wav" }),
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
        // A repeated close stays idempotent (ownership already released).
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
