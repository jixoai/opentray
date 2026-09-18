//! OpenTray native notification extension (add-ext-notification batch B,
//! the crate slice).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: an
//! OS standard notification atom — title/body/subtitle, silent flag —
//! delivered host-side through the OS notification surface, with darwin
//! authorization as the first non-modal DeferredOperation use):
//! 1. `notify` is resolve-on-acceptance (the sound family's law): the
//!    command resolves once the native delivery request is accepted;
//!    whether/when the user sees it is system policy. On darwin the
//!    acceptance decision linearizes denial in ONE owner-loop frame
//!    against the cached last authorization snapshot (design section 4):
//!    denied → typed `notification_denied` with ZERO native posts; a
//!    first snapshot-less notify defers through the SAME authorization
//!    transaction machinery (preflight inside the 10 s budget) and posts
//!    on grant.
//! 2. `getAuthorizationStatus`/`requestAuthorization` answer the seeded
//!    disposition with Deferred (kept exactly as seeded) on darwin and
//!    settle through ONE terminal on the deferred completion port — no
//!    new ABI symbols, no synchronous owner-loop wait (O2 ruling). The
//!    10 s timeout and the session-close cancel branch race the outcome
//!    for a one-shot CAS; exactly one terminal per accepted operation.
//! 3. win32 `notify` is owned by the broker-internal tray-notification
//!    bridge (design section 2, Codex R1 option B): this crate's win32
//!    surface carries identity/manifest/DTO obligations and the
//!    documented always-granted Immediate authorization degradation —
//!    zero deferred frames, structurally (the win32 answer type has no
//!    deferred arm).
//! 4. The payload bounds (title ≤64 / body ≤256 / subtitle ≤64 UTF-16,
//!    plus the win32 combined subtitle-join limit) are enforced natively
//!    as defense in depth behind the facade preflight — typed
//!    rejections, never truncation.
//!
//! Compromise: the crate exports `opentray_ext_command_v2` only (the
//! loader's four-cell matrix gives V2-only libraries full capability and
//! V1 cannot express deferral) plus the optional deferred completion port
//! attach symbol. There is no poll-owner symbol: authorization
//! transactions are callback-driven (hop → CAS → terminal), so the
//! broker never needs to step this extension.

mod abi_support;
// The authorization transaction engine is wired by the darwin dispatch
// arms and driven cross-platform by the test suite; win32/other
// production builds never enter it (their answers are Immediate), so the
// whole tree carries the family's cross-platform allowance there.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
mod auth;
mod options;
mod state;

#[cfg(target_os = "macos")]
mod macos;

/// The win32 projection is pure JSON (no Win32 API surface — delivery
/// belongs to the broker tray bridge), so it compiles under `test` on
/// every host and its zero-deferred/degradation contracts are testable
/// anywhere (the ext-sound PlaybackArbiter seam split).
#[cfg(any(target_os = "windows", test))]
mod windows;

use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    CommandScope, ExtBytes, ExtCommandDispositionV1, ExtContext, ExtHostContext, ExtOwnedBytes,
    ExtResultCode, ExtensionEnvelope, TypedExtensionError, EXT_ABI_VERSION, EXT_ERR_REJECTED,
    EXT_ERR_UNSUPPORTED, EXT_OK,
};

use options::NotificationCommand;
use state::NotificationInstance;

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
    let instance = Box::new(NotificationInstance::new());
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
            "notification session cleanup requires an initialized instance",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(session_id) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "notification session cleanup requires session id bytes",
        );
    };
    let Ok(session_id) = std::str::from_utf8(bytes) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "notification session id is not UTF-8",
        );
    };

    // Session close (design section 4): every in-flight authorization
    // transaction of the session settles through the cancel branch
    // exactly once (the one-shot CAS inside revoke_session), and the
    // session's snapshot cache is dropped — never trusted across
    // sessions. Re-register defensively so a close racing the first
    // owner-thread command still finds the instance for late hops.
    let extension = unsafe { &mut *instance.cast::<NotificationInstance>() };
    extension.ensure_owner_registered();
    let mut core = extension.core.borrow_mut();
    if !core.closed {
        match core.port.clone() {
            Some(port) => {
                let mut sink = auth::PortSink(&port);
                core.engine.revoke_session(session_id, &mut sink);
            }
            None => {
                let mut sink = auth::NullSink;
                core.engine.revoke_session(session_id, &mut sink);
            }
        }
    }

    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        // Drop runs the ownership teardown: mark the core closed, clear
        // the engine WITHOUT terminals (the host revokes the deferred
        // port before deinit — the dialog family's law), and release this
        // thread's registry alias.
        drop(unsafe { Box::from_raw(instance.cast::<NotificationInstance>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

// ---------------------------------------------------------------------------
// Deferred completion port attach (by value, dialog family law): copy the
// struct, keep only `port_data` + `submit`. One port per instance/mount.
// ---------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_attach_deferred_completion_port_v1(
    instance: *mut c_void,
    port: opentray_spec::ExtDeferredPortV1,
) -> ExtResultCode {
    abi_support::clear_error();
    if instance.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "deferred port attach requires an initialized instance",
        );
    }
    let extension = unsafe { &mut *instance.cast::<NotificationInstance>() };
    match state::DeferredPortCopy::from_port(&port) {
        Ok(copy) => {
            extension.core.borrow_mut().port = Some(copy);
            EXT_OK
        }
        Err(error) => abi_support::record_typed_error(EXT_ERR_REJECTED, &error),
    }
}

// ---------------------------------------------------------------------------
// V2 command entry
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
            "notification command requires an initialized instance",
        );
    }
    if out_disposition.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_disposition_buffer",
            "notification command requires the host-seeded disposition buffer",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                "notification command envelope bytes are missing",
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
                    format!("notification command envelope is invalid: {error}"),
                ),
            )
        }
    };
    let command = match serde_json::from_value::<NotificationCommand>(envelope.data.clone()) {
        Ok(command) => command,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    options::transport_code::INVALID_NOTIFICATION_COMMAND,
                    format!("notification command is invalid: {error}"),
                ),
            )
        }
    };
    let extension = unsafe { &mut *instance.cast::<NotificationInstance>() };

    match command {
        NotificationCommand::GetBackend => {
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
            let event = ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                // The facade contract consumes `type: "backend"` (the
                // dialog/sound family's frozen ABI shape law).
                data: serde_json::json!({
                    "type": "backend",
                    "backend": backend,
                }),
            };
            write_immediate(out_events_json, out_disposition, &[event])
        }
        NotificationCommand::Notify(content) => {
            // Commands that consume session ownership require the
            // host-injected commandScope before any state change.
            let Some(scope) = envelope.command_scope.clone() else {
                return zero_disposition_then(
                    out_disposition,
                    abi_support::record_error(
                        EXT_ERR_REJECTED,
                        options::transport_code::INVALID_NOTIFICATION_COMMAND,
                        "notify command requires the host-injected commandScope",
                    ),
                );
            };
            platform_notify(
                extension,
                &scope,
                content,
                envelope.scope,
                out_events_json,
                out_disposition,
            )
        }
        command @ (NotificationCommand::GetAuthorizationStatus
        | NotificationCommand::RequestAuthorization) => {
            let Some(scope) = envelope.command_scope.clone() else {
                return zero_disposition_then(
                    out_disposition,
                    abi_support::record_error(
                        EXT_ERR_REJECTED,
                        options::transport_code::INVALID_NOTIFICATION_COMMAND,
                        "authorization command requires the host-injected commandScope",
                    ),
                );
            };
            platform_authorization(
                extension,
                &scope,
                command,
                envelope.scope,
                out_events_json,
                out_disposition,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Platform dispatch seams
// ---------------------------------------------------------------------------

/// macOS notify path (design sections 2/4): payload bounds first (typed,
/// before any state change or native dispatch — pure, so testable off
/// the owner thread), then the owner-thread gate, then the one-frame
/// acceptance linearization against the cached snapshot. A snapshot-less
/// first notify keeps the host-seeded Deferred disposition and rides the
/// authorization preflight transaction (10 s budget; post on grant;
/// typed denial with zero posts).
#[cfg(target_os = "macos")]
fn platform_notify(
    extension: &mut NotificationInstance,
    scope: &CommandScope,
    content: options::NotifyContent,
    response_scope: opentray_spec::ExtensionScope,
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    if let Err(error) =
        options::validate_notify_payload(&content, options::PayloadProjection::Darwin)
    {
        return zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error);
    }
    if let Err(error) = macos::require_main_thread() {
        return zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error);
    }
    extension.ensure_owner_registered();

    let mut core = extension.core.borrow_mut();
    let snapshot = core.engine.snapshot(scope).copied();
    let mut post = macos::OwnerPost;
    match auth::immediate_notify_transaction(snapshot.as_ref(), &content, &mut post) {
        auth::NotifyImmediate::Denied(error) => {
            zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
        }
        auth::NotifyImmediate::Posted(result) => match result {
            Ok(value) => {
                let event = ExtensionEnvelope {
                    scope: response_scope,
                    command_scope: None,
                    data: value,
                };
                write_immediate(out_events_json, out_disposition, &[event])
            }
            Err(error) => zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error),
        },
        auth::NotifyImmediate::DeferPreflight => {
            // First snapshot-less notify: the deferred authorization
            // preflight owns the acceptance (design section 4).
            let handle = unsafe { (*out_disposition).operation_handle() };
            begin_deferred(
                &mut core,
                extension.instance_key,
                handle,
                scope,
                auth::AuthKind::NotifyPreflight { content },
                out_disposition,
            )
        }
    }
}

/// win32 notify path: the broker-internal tray bridge owns delivery; the
/// crate's answer is payload defense in depth plus the honest typed
/// bridge rejection — always Immediate, zero deferred frames.
#[cfg(target_os = "windows")]
fn platform_notify(
    _extension: &mut NotificationInstance,
    _scope: &CommandScope,
    content: options::NotifyContent,
    _response_scope: opentray_spec::ExtensionScope,
    _out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    let error = windows::notify_rejection(&content);
    zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
}

/// Other platforms: no native notification surface yet.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_notify(
    _extension: &mut NotificationInstance,
    _scope: &CommandScope,
    _content: options::NotifyContent,
    _response_scope: opentray_spec::ExtensionScope,
    _out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    zero_disposition_then_typed(
        out_disposition,
        EXT_ERR_REJECTED,
        &options::platform_unsupported_error(),
    )
}

/// macOS authorization commands (design section 4): deferred
/// transactions — keep the seeded disposition exactly, register, issue
/// the native query, arm the 10 s timeout. No poll owner: the
/// transaction is callback-driven.
#[cfg(target_os = "macos")]
fn platform_authorization(
    extension: &mut NotificationInstance,
    scope: &CommandScope,
    command: NotificationCommand,
    _response_scope: opentray_spec::ExtensionScope,
    _out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    if let Err(error) = macos::require_main_thread() {
        return zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error);
    }
    extension.ensure_owner_registered();
    let handle = unsafe { (*out_disposition).operation_handle() };
    let kind = match command {
        NotificationCommand::GetAuthorizationStatus => auth::AuthKind::Status,
        NotificationCommand::RequestAuthorization => auth::AuthKind::Request,
        _ => unreachable!("the caller matched the authorization arms"),
    };
    let mut core = extension.core.borrow_mut();
    begin_deferred(
        &mut core,
        extension.instance_key,
        handle,
        scope,
        kind,
        out_disposition,
    )
}

/// win32 authorization commands (design section 4): the documented
/// always-granted Immediate degradation — zero deferred frames,
/// structurally (the win32 answer type has no deferred arm; the engine
/// and port are never touched on this path).
#[cfg(target_os = "windows")]
fn platform_authorization(
    _extension: &mut NotificationInstance,
    _scope: &CommandScope,
    command: NotificationCommand,
    response_scope: opentray_spec::ExtensionScope,
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    match windows::dispatch(&command) {
        windows::Win32Answer::Immediate(values) => {
            let events: Vec<ExtensionEnvelope> = values
                .into_iter()
                .map(|data| ExtensionEnvelope {
                    scope: response_scope.clone(),
                    command_scope: None,
                    data,
                })
                .collect();
            write_immediate(out_events_json, out_disposition, &events)
        }
        windows::Win32Answer::Error(error) => {
            zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
        }
    }
}

/// Other platforms: typed unsupported.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_authorization(
    _extension: &mut NotificationInstance,
    _scope: &CommandScope,
    _command: NotificationCommand,
    _response_scope: opentray_spec::ExtensionScope,
    _out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    zero_disposition_then_typed(
        out_disposition,
        EXT_ERR_REJECTED,
        &options::platform_unsupported_error(),
    )
}

/// The shared deferred-begin transaction (owner thread, darwin today):
/// validate the seeded handle (never-issued 0 is a host-contract
/// violation), require the attached port, then register + start the
/// query + arm the timeout. On success the disposition stays EXACTLY as
/// the host seeded it (Deferred + handle) — the pre-Accept failure
/// window is closed by zeroing on every error path; no terminal exists
/// there.
#[cfg(target_os = "macos")]
fn begin_deferred(
    core: &mut std::cell::RefMut<'_, auth::NotificationCore>,
    instance_key: u64,
    handle: u64,
    scope: &CommandScope,
    kind: auth::AuthKind,
    out_disposition: *mut ExtCommandDispositionV1,
) -> ExtResultCode {
    if handle == 0 {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_operation_handle",
                "host-seeded disposition carried the never-issued handle 0",
            ),
        );
    }
    if core.port.is_none() {
        return zero_disposition_then_typed(
            out_disposition,
            EXT_ERR_REJECTED,
            &options::typed_error(
                options::transport_code::DEFERRED_PORT_REQUIRED,
                "the deferred authorization answer requires the attached completion port",
            ),
        );
    }
    let query = match &kind {
        auth::AuthKind::Status | auth::AuthKind::NotifyPreflight { .. } => auth::AuthQuery::Status,
        auth::AuthKind::Request => auth::AuthQuery::Request,
    };
    let token = auth::ReplyToken {
        instance_key,
        handle,
    };
    match core.engine.begin(
        handle,
        scope.clone(),
        kind,
        query,
        token,
        &macos::UNQueryChannel,
        &macos::MainQueueExecutor,
    ) {
        Ok(()) => EXT_OK,
        Err(error) => zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error),
    }
}

#[cfg(target_os = "macos")]
fn backend_capabilities() -> Result<options::NotificationBackendCapabilities, TypedExtensionError> {
    Ok(options::NotificationBackendCapabilities::darwin())
}

#[cfg(target_os = "windows")]
fn backend_capabilities() -> Result<options::NotificationBackendCapabilities, TypedExtensionError> {
    Ok(windows::backend_capabilities())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn backend_capabilities() -> Result<options::NotificationBackendCapabilities, TypedExtensionError> {
    Err(options::platform_unsupported_error())
}

/// The platform owner-thread post surface for hop delivery (darwin:
/// UNUserNotificationCenter on main; other platforms never have
/// transactions to settle — the honest guard).
#[cfg(target_os = "macos")]
pub(crate) fn platform_owner_post() -> Box<dyn auth::PostSink> {
    Box::new(macos::OwnerPost)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn platform_owner_post() -> Box<dyn auth::PostSink> {
    Box::new(auth::UnavailablePost)
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
/// never leak a stale Deferred seed).
///
/// # Safety contract (enforced at the command entry)
///
/// `out_disposition` is the validated non-null host-seeded buffer the
/// `opentray_ext_command_v2` entry checked before dispatching; the write
/// is the single mutation this helper performs.
fn zero_disposition_then_typed(
    out_disposition: *mut ExtCommandDispositionV1,
    code: ExtResultCode,
    error: &TypedExtensionError,
) -> ExtResultCode {
    unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
    abi_support::record_typed_error(code, error)
}

fn zero_disposition_then(
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
            "notification output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "serialization_failed",
            "notification output JSON contains a nul byte",
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

fn write_immediate(
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
    events: &[ExtensionEnvelope],
) -> ExtResultCode {
    let json = match serde_json::to_string(events) {
        Ok(json) => json,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    "serialization_failed",
                    format!("notification events could not be serialized: {error}"),
                ),
            )
        }
    };
    let outcome = write_owned_json(out_events_json, &json);
    if outcome == EXT_OK {
        // Immediate: rewrite the seeded disposition to the all-zero
        // Immediate form (results live in out_events).
        unsafe { *out_disposition = ExtCommandDispositionV1::immediate() };
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentray_spec::ExtOperationPayload;
    use opentray_spec::EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE;
    use std::ptr;
    use std::sync::Mutex;

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
            "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "notification" },
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
        // The host seeds a Deferred disposition; Immediate answers must
        // rewrite it to the all-zero Immediate form, deferred answers
        // keep it exactly.
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

    fn parse_events(events: &ExtOwnedBytes) -> Vec<ExtensionEnvelope> {
        assert!(!events.ptr.is_null(), "immediate answers carry events");
        let bytes = unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
        let parsed: Vec<ExtensionEnvelope> = serde_json::from_slice(bytes).expect("events");
        unsafe { opentray_ext_free_string(events.ptr, events.len) };
        parsed
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
        assert_eq!(manifest.extension_name, "notification");
        // The embedded manifest's artifactSetVersion mirrors the npm
        // facade package.json (the release identity). The facade package
        // is staged by the concurrent batch, so this compares against the
        // same build-staged source build.rs reads (real facade bytes when
        // they exist, the byte-equivalent design-frozen fallback before)
        // — never a hard-coded version literal (the dialog/sound
        // release-run lesson).
        let facade_version: String = serde_json::from_str::<serde_json::Value>(include_str!(
            concat!(env!("OUT_DIR"), "/ext_notification_facade_package.json")
        ))
        .expect("facade package.json")["version"]
            .as_str()
            .expect("version string")
            .to_string();
        assert_eq!(manifest.artifact_set_version, facade_version);
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-notification-contract-1"
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

        let parsed = parse_events(&events);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].data["type"], "backend");
        let backend = &parsed[0].data["backend"];
        assert_eq!(backend["platform"], "darwin");
        assert_eq!(backend["authorizationModel"], "user");
        assert_eq!(backend["channel"], "user-notification-center");
        assert_eq!(backend["titleLimitUtf16"], 64);
        assert_eq!(backend["bodyLimitUtf16"], 256);
        assert_eq!(backend["subtitleLimitUtf16"], 64);
        assert_eq!(backend["supportsSubtitle"], true);
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
        assert_eq!(
            detail.category,
            options::transport_code::INVALID_NOTIFICATION_COMMAND
        );
        assert!(!detail.message.is_empty());

        // Unknown field (v1 has no platform namespace): rejected.
        let envelope = command_envelope(serde_json::json!({
            "type": "notify", "title": "t", "urgency": "high"
        }));
        let (code, _events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert_eq!(
            take_error_detail().category,
            options::transport_code::INVALID_NOTIFICATION_COMMAND
        );

        // Malformed envelope bytes.
        let raw = CString::new("{ not json").unwrap();
        let (code, _events, _disposition) = dispatch(instance, &raw);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(take_error_detail().category, "invalid_command_envelope");
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The payload matrix through the real dispatch surface (darwin):
    /// every violation rejects typed with the frozen details triple
    /// BEFORE the owner-thread gate — validation is pure and precedes any
    /// state change or native dispatch (the zero-dispatch law).
    #[cfg(target_os = "macos")]
    #[test]
    fn notify_payload_violations_reject_typed_before_any_state_change() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let cases: Vec<(serde_json::Value, &str, u32, u32)> = vec![
            (
                serde_json::json!({ "type": "notify", "title": "" }),
                "title",
                0,
                64,
            ),
            (
                serde_json::json!({ "type": "notify", "title": "t".repeat(65) }),
                "title",
                65,
                64,
            ),
            (
                serde_json::json!({ "type": "notify", "title": "t", "body": "b".repeat(257) }),
                "body",
                257,
                256,
            ),
            (
                serde_json::json!({ "type": "notify", "title": "t", "subtitle": "s".repeat(65) }),
                "subtitle",
                65,
                64,
            ),
        ];
        for (data, field, length, limit) in cases {
            let envelope = command_envelope(data);
            let (code, events, disposition) = dispatch(instance, &envelope);
            assert_eq!(code, EXT_ERR_REJECTED, "{field}");
            assert!(events.ptr.is_null(), "no events on a rejected payload");
            assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
            assert!(disposition.value_is_zero());
            let detail = take_error_detail();
            assert_eq!(detail.category, options::error_code::PAYLOAD_INVALID);
            let details = detail.details.expect("payload details");
            assert_eq!(details["field"], field);
            assert_eq!(details["lengthUtf16"], length);
            assert_eq!(details["limit"], limit);
        }
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn notify_without_command_scope_rejects_before_any_state_change() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "notification" },
                "data": { "type": "notify", "title": "t" }
            })
            .to_string(),
        )
        .unwrap();
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        let detail = take_error_detail();
        assert_eq!(
            detail.category,
            options::transport_code::INVALID_NOTIFICATION_COMMAND
        );

        // Authorization commands share the scope law.
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "notification" },
                "data": { "type": "getAuthorizationStatus" }
            })
            .to_string(),
        )
        .unwrap();
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(
            take_error_detail().category,
            options::transport_code::INVALID_NOTIFICATION_COMMAND
        );
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The darwin native surfaces are owner-thread-bound: a VALID notify
    /// payload (or an auth command) on a harness thread is the honest
    /// typed host-contract rejection (after validation, before any state
    /// change). The off-main branch evidence; the real owner-thread path
    /// is exercised by the engine suite and the real-machine acceptance
    /// probe.
    #[cfg(target_os = "macos")]
    #[test]
    fn darwin_commands_off_the_owner_thread_reject_with_the_thread_category() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        for data in [
            serde_json::json!({ "type": "notify", "title": "valid" }),
            serde_json::json!({ "type": "getAuthorizationStatus" }),
            serde_json::json!({ "type": "requestAuthorization" }),
        ] {
            let envelope = command_envelope(data);
            let (code, events, disposition) = dispatch(instance, &envelope);
            assert_eq!(code, EXT_ERR_REJECTED);
            assert!(events.ptr.is_null());
            assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
            assert!(disposition.value_is_zero());
            let detail = take_error_detail();
            assert_eq!(
                detail.category,
                options::transport_code::INVALID_DISPATCH_THREAD
            );
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
        // A repeated close stays idempotent (exactly-once cleanup).
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

    #[test]
    fn deferred_port_attach_rejects_mismatched_port_identity() {
        let _slot = lock_error_slot_tests();
        unsafe extern "C" fn ok_submit(
            _a: *mut c_void,
            _b: u64,
            _c: *const u8,
            _d: usize,
        ) -> ExtResultCode {
            EXT_OK
        }
        let instance = init_instance();
        let mut port = opentray_spec::ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1 + 1,
            struct_size: std::mem::size_of::<opentray_spec::ExtDeferredPortV1>() as u32,
            port_data: ptr::null_mut(),
            submit: ok_submit,
        };
        let result = unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) };
        assert_eq!(result, EXT_ERR_REJECTED);
        let detail = take_error_detail();
        assert_eq!(detail.category, "deferred_port_abi_incompatible");

        port.abi_version = opentray_spec::EXT_DEFERRED_PORT_ABI_V1;
        port.struct_size = 0;
        let result = unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) };
        assert_eq!(result, EXT_ERR_REJECTED);
        unsafe { opentray_ext_deinit(instance) };
    }

    /// A well-formed port copy is accepted once (one mount one port; the
    /// host attaches exactly once per load).
    #[test]
    fn deferred_port_attach_accepts_the_validated_copy() {
        let _slot = lock_error_slot_tests();
        unsafe extern "C" fn submit_ok(
            _port_data: *mut c_void,
            _handle: u64,
            _payload_ptr: *const u8,
            _payload_len: usize,
        ) -> ExtResultCode {
            EXT_OK
        }
        let instance = init_instance();
        let port = opentray_spec::ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<opentray_spec::ExtDeferredPortV1>() as u32,
            port_data: 0x1 as *mut c_void,
            submit: submit_ok,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );
        unsafe { opentray_ext_deinit(instance) };
    }

    // -------------------------------------------------------------------------
    // The full-stack deferred authorization hop: FFI port attach +
    // owner-registry + hop + one-shot CAS + typed terminal, all on the
    // harness thread playing owner (the same code path the GCD main-queue
    // hop drives in production).
    // -------------------------------------------------------------------------

    /// Recording port submit (host-side spy).
    struct RecordingPort {
        calls: Mutex<Vec<(u64, ExtOperationPayload)>>,
    }

    unsafe extern "C" fn recording_submit(
        port_data: *mut c_void,
        handle: u64,
        payload_ptr: *const u8,
        payload_len: usize,
    ) -> ExtResultCode {
        let recorder = unsafe { &*(port_data as *const RecordingPort) };
        let bytes = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len) };
        let payload: ExtOperationPayload = serde_json::from_slice(bytes).expect("terminal JSON");
        recorder.calls.lock().unwrap().push((handle, payload));
        EXT_OK
    }

    /// Synchronous owner executor: hops run inline on the calling
    /// (owner-playing) thread; timeouts never fire (the never-callback
    /// timeout is covered by the engine suite's manual executor).
    struct SyncExecutor;

    impl auth::OwnerExecutor for SyncExecutor {
        fn hop(&self, job: auth::OwnerJob) {
            job();
        }
        fn arm_timeout(&self, _job: auth::OwnerJob) {}
    }

    /// Queuing owner executor: hops stay queued until the owner loop
    /// drains them (the delayed-callback family member).
    struct QueuedExecutor {
        hops: Mutex<Vec<auth::OwnerJob>>,
    }

    impl auth::OwnerExecutor for QueuedExecutor {
        fn hop(&self, job: auth::OwnerJob) {
            self.hops.lock().unwrap().push(job);
        }
        fn arm_timeout(&self, _job: auth::OwnerJob) {}
    }

    /// Fake query channel: records issued queries; replies are fired by
    /// the test through hop_outcome with the same executor.
    struct FakeChannel {
        issued: Mutex<Vec<auth::AuthQuery>>,
    }

    impl auth::AuthQueryChannel for FakeChannel {
        fn start(
            &self,
            query: auth::AuthQuery,
            _token: auth::ReplyToken,
            _executor: &dyn auth::OwnerExecutor,
        ) -> Result<(), TypedExtensionError> {
            self.issued.lock().unwrap().push(query);
            Ok(())
        }
    }

    fn attach_recording_port(instance: *mut c_void) -> *mut RecordingPort {
        let recorder: Box<RecordingPort> = Box::new(RecordingPort {
            calls: Mutex::new(Vec::new()),
        });
        let recorder_ptr = Box::into_raw(recorder);
        let port = opentray_spec::ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<opentray_spec::ExtDeferredPortV1>() as u32,
            port_data: recorder_ptr as *mut c_void,
            submit: recording_submit,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );
        recorder_ptr
    }

    fn test_scope(session: &str) -> CommandScope {
        CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
            instance_generation: 1,
        }
    }

    #[test]
    fn full_stack_hop_settles_the_deferred_authorization_exactly_once() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let recorder_ptr = attach_recording_port(instance);

        let extension = unsafe { &mut *instance.cast::<NotificationInstance>() };
        extension.ensure_owner_registered();
        let scope = test_scope("session-1");
        let handle = 0xABCD_1234u64;
        let token = auth::ReplyToken {
            instance_key: extension.instance_key,
            handle,
        };
        {
            let mut core = extension.core.borrow_mut();
            core.engine
                .begin(
                    handle,
                    scope.clone(),
                    auth::AuthKind::Status,
                    auth::AuthQuery::Status,
                    token,
                    &FakeChannel {
                        issued: Mutex::new(Vec::new()),
                    },
                    &SyncExecutor,
                )
                .expect("begin registers and arms");
        }

        // The system callback fires on another thread; the hop lands on
        // the owner thread (here: this harness thread's registry view).
        auth::hop_outcome(
            token,
            auth::AuthOutcome::Status(options::AuthorizationStatus::Granted),
            &SyncExecutor,
        );

        let recorder = unsafe { &*recorder_ptr };
        let calls = recorder.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 1, "exactly one terminal");
        assert_eq!(calls[0].0, handle);
        match &calls[0].1 {
            ExtOperationPayload::Result { value } => {
                assert_eq!(
                    value,
                    &serde_json::json!({ "type": "authorization", "status": "granted" })
                )
            }
            other => panic!("granted status is a result terminal: {other:?}"),
        }

        // Double-fire attempt (the CAS law): a stale timeout for the same
        // handle must never produce a second terminal.
        auth::deliver_auth_event(token.instance_key, handle, auth::AuthEvent::Timeout);
        assert_eq!(
            recorder.calls.lock().unwrap().len(),
            1,
            "one-shot CAS: no second terminal"
        );
        // ... and the snapshot from the real outcome survived it.
        {
            let core = extension.core.borrow();
            let snapshot = core.engine.snapshot(&scope).expect("snapshot recorded");
            assert_eq!(snapshot.status, options::AuthorizationStatus::Granted);
            assert_eq!(snapshot.provenance, "getAuthorizationStatus");
        }

        // The DELAYED family member through the real queued-hop route: a
        // second transaction whose callback hop sits queued until the
        // owner loop drains — nothing settles while queued, exactly one
        // terminal after the drain.
        let queued = QueuedExecutor {
            hops: Mutex::new(Vec::new()),
        };
        let handle_two = 0xABCD_5678u64;
        let token_two = auth::ReplyToken {
            instance_key: extension.instance_key,
            handle: handle_two,
        };
        {
            let mut core = extension.core.borrow_mut();
            core.engine
                .begin(
                    handle_two,
                    scope.clone(),
                    auth::AuthKind::Status,
                    auth::AuthQuery::Status,
                    token_two,
                    &FakeChannel {
                        issued: Mutex::new(Vec::new()),
                    },
                    &queued,
                )
                .expect("begin two");
        }
        auth::hop_outcome(
            token_two,
            auth::AuthOutcome::Status(options::AuthorizationStatus::NotDetermined),
            &queued,
        );
        let recorder = unsafe { &*recorder_ptr };
        assert_eq!(
            recorder.calls.lock().unwrap().len(),
            1,
            "the queued hop settled nothing yet"
        );
        let jobs: Vec<auth::OwnerJob> = queued.hops.lock().unwrap().drain(..).collect();
        assert_eq!(jobs.len(), 1, "one callback hop was queued");
        for job in jobs {
            job();
        }
        let calls = recorder.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 2, "the drained hop settled exactly one more");
        assert_eq!(calls[1].0, handle_two);
        match &calls[1].1 {
            ExtOperationPayload::Result { value } => assert_eq!(
                value,
                &serde_json::json!({ "type": "authorization", "status": "notDetermined" })
            ),
            other => panic!("the drained outcome is a result terminal: {other:?}"),
        }

        unsafe { opentray_ext_deinit(instance) };
        drop(unsafe { Box::from_raw(recorder_ptr) });
    }

    /// Session close revokes an in-flight transaction through the FFI
    /// surface: exactly one cancel-branch terminal, delivered through the
    /// port, and the late outcome is a stateless no-op.
    #[test]
    fn session_close_revokes_in_flight_through_the_port_exactly_once() {
        let _slot = lock_error_slot_tests();
        let instance = init_instance();
        let recorder_ptr = attach_recording_port(instance);

        let extension = unsafe { &mut *instance.cast::<NotificationInstance>() };
        extension.ensure_owner_registered();
        let scope = test_scope("session-9");
        let handle = 0x5555_0001u64;
        let token = auth::ReplyToken {
            instance_key: extension.instance_key,
            handle,
        };
        {
            let mut core = extension.core.borrow_mut();
            core.engine
                .begin(
                    handle,
                    scope.clone(),
                    auth::AuthKind::Request,
                    auth::AuthQuery::Request,
                    token,
                    &FakeChannel {
                        issued: Mutex::new(Vec::new()),
                    },
                    &SyncExecutor,
                )
                .expect("begin");
        }

        let session_id = c"session-9";
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

        let recorder = unsafe { &*recorder_ptr };
        let calls = recorder.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 1, "the cancel branch settled exactly once");
        match &calls[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::FAILED);
                assert_eq!(
                    error.details.as_ref().unwrap()["reason"],
                    options::REASON_AUTHORIZATION_SESSION_CLOSED
                );
            }
            other => panic!("session close is the cancel-branch error terminal: {other:?}"),
        }

        // The late outcome for the revoked transaction is a stateless
        // no-op: no second terminal and no snapshot.
        auth::deliver_auth_event(
            token.instance_key,
            handle,
            auth::AuthEvent::Outcome(auth::AuthOutcome::Decision(true)),
        );
        assert_eq!(recorder.calls.lock().unwrap().len(), 1);
        {
            let core = extension.core.borrow();
            assert!(core.engine.snapshot(&scope).is_none());
            assert_eq!(core.engine.active_count(), 0);
        }

        unsafe { opentray_ext_deinit(instance) };
        drop(unsafe { Box::from_raw(recorder_ptr) });
    }

    // -------------------------------------------------------------------------
    // win32 projection contracts (pure core, testable on any host — the
    // production dispatch arm delegates to the same dispatch()).
    // -------------------------------------------------------------------------

    mod win32_projection {
        use super::super::options;
        use super::super::windows;

        #[test]
        fn authorization_commands_are_immediate_always_granted_with_zero_deferred_frames() {
            // The structural zero-deferred law: the win32 answer type HAS
            // no deferred arm, and both commands project to the
            // documented degradation.
            let answer = windows::dispatch(&options::NotificationCommand::GetAuthorizationStatus);
            match answer {
                windows::Win32Answer::Immediate(values) => assert_eq!(
                    values,
                    vec![serde_json::json!({
                        "type": "authorization", "status": "granted"
                    })]
                ),
                other => panic!("win32 auth is never deferred: {other:?}"),
            }
            let answer = windows::dispatch(&options::NotificationCommand::RequestAuthorization);
            match answer {
                windows::Win32Answer::Immediate(values) => assert_eq!(
                    values,
                    vec![serde_json::json!({
                        "type": "authorizationDecision", "granted": true
                    })]
                ),
                other => panic!("win32 auth is never deferred: {other:?}"),
            }
        }

        #[test]
        fn backend_reports_the_frozen_win32_projection() {
            let answer = windows::dispatch(&options::NotificationCommand::GetBackend);
            match answer {
                windows::Win32Answer::Immediate(values) => {
                    assert_eq!(values.len(), 1);
                    assert_eq!(values[0]["type"], "backend");
                    assert_eq!(values[0]["backend"]["platform"], "win32");
                    assert_eq!(values[0]["backend"]["authorizationModel"], "always-granted");
                    assert_eq!(values[0]["backend"]["channel"], "tray-icon-info");
                    assert_eq!(values[0]["backend"]["supportsSubtitle"], false);
                }
                other => panic!("getBackend is immediate: {other:?}"),
            }
        }

        /// win32 notify reaching THIS crate is payload-validated defense
        /// in depth (the joined-subtitle combined limit included), then
        /// the honest typed broker-bridge rejection — never a silent
        /// no-op, never deferred.
        #[test]
        fn notify_is_payload_validated_then_the_typed_bridge_rejection() {
            // Payload-invalid (joined body 257): the payload error wins.
            let content = options::NotifyContent {
                title: "t".to_string(),
                body: Some("b".repeat(192)),
                subtitle: Some("s".repeat(64)),
                silent: None,
            };
            match windows::dispatch(&options::NotificationCommand::Notify(content)) {
                windows::Win32Answer::Error(error) => {
                    assert_eq!(error.code, options::error_code::PAYLOAD_INVALID);
                    assert_eq!(error.details.as_ref().unwrap()["lengthUtf16"], 257);
                }
                other => panic!("payload-invalid notify is the typed error: {other:?}"),
            }

            // Payload-valid: the broker-bridge routing rejection.
            let content = options::NotifyContent {
                title: "t".to_string(),
                body: Some("b".repeat(190)),
                subtitle: Some("s".repeat(64)),
                silent: Some(true),
            };
            match windows::dispatch(&options::NotificationCommand::Notify(content)) {
                windows::Win32Answer::Error(error) => {
                    assert_eq!(error.code, options::error_code::FAILED);
                    assert_eq!(
                        error.details.as_ref().unwrap()["reason"],
                        options::REASON_WIN32_NOTIFY_BROKER_BRIDGED
                    );
                }
                other => panic!("win32 notify never delivers in-crate: {other:?}"),
            }
        }
    }
}
