//! OpenTray native dialog extension (add-ext-dialog batch B).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: OS
//! modal dialogs — message boxes and file pickers — as a dynamic extension
//! that never blocks the broker's event loop):
//! 1. Every show command is a DeferredOperation: the dispatch constructs
//!    the native panel and begins a modal session, then answers the seeded
//!    `ExtCommandDispositionV1` with Deferred. The single terminal later
//!    travels through the deferred completion port; poll never produces
//!    one.
//! 2. `opentray_ext_poll_owner_v1` steps the modal session one
//!    `runModalSession` quantum per poll and reports the next deadline in
//!    relative milliseconds; scheduling authority stays broker-owned
//!    (design section 5.2).
//! 3. One active dialog per `(appId, trayId, sessionId)`: the second show
//!    is a typed `dialog_session_busy` rejection before any state change.
//! 4. Session close revokes first (CAS), then ends the modal session, then
//!    submits the cancel-branch payload, then cleans up (design section
//!    5.4).
//!
//! Compromise: the crate exports `opentray_ext_command_v2` only (the
//! loader's four-cell matrix gives V2-only libraries full capability and
//! the legacy V1 signature cannot express deferral); the win32 surface
//! (task 3.3) registers its own module behind the same seams.

mod abi_support;
mod options;
mod state;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    CommandScope, ExtBytes, ExtCommandDispositionV1, ExtContext, ExtDeferredPortV1,
    ExtHostContext, ExtOperationPayload, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope,
    TypedExtensionError, EXT_ABI_VERSION, EXT_ERR_REJECTED,
    EXT_ERR_UNSUPPORTED, EXT_OK,
};

#[cfg(target_os = "macos")]
use state::NativeState;
use state::{DialogInstance, ModalKind};

// ---------------------------------------------------------------------------
// Frozen poll ABI (design section 5.7 ruling 3): opentray-spec owns the
// frozen symbol name, outcome struct, and status/deadline constants (the
// broker consumer resolves the same types without depending on this
// crate); this crate re-exports them so its public surface stays unchanged.
// The producer-side step cadence stays here (extension policy, not ABI).
// ---------------------------------------------------------------------------

pub use opentray_spec::{
    ExtPollOutcomeV1, EXT_POLL_NO_DEADLINE_MS, EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED,
    EXT_POLL_STATUS_PENDING, EXT_SYMBOL_POLL_OWNER_V1,
};

/// Modal stepping cadence while a session is active: one step per owner
/// loop iteration at UI-frame granularity (the frozen quota bounds the
/// per-iteration work).
pub const EXT_POLL_STEP_INTERVAL_MS: u64 = 16;

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
    let instance = Box::new(DialogInstance::new());
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
            "dialog session cleanup requires an initialized instance",
        );
    }
    let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
    let Some(bytes) = ext_bytes_as_slice(session_id) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "dialog session cleanup requires session id bytes",
        );
    };
    let Ok(session_id) = std::str::from_utf8(bytes) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "dialog session id is not UTF-8",
        );
    };

    // Revoke order (design section 5.4): CAS the modal out of the active
    // set, tear down the native session, submit the cancel-branch payload,
    // then remove the record. A record whose native half is already gone
    // has settled its terminal (or never began) and is removed without a
    // second submission — exactly-once. On the host's close path the
    // deferred port was already revoked and the operations purged (batch A
    // ruling 7), so the submit observes PORT_CLOSED / INVALID_HANDLE; the
    // attempt is still made because the extension owns the cancel-branch
    // orchestration, the host owns the delivery decision.
    for handle in extension.handles_for_session(session_id) {
        let Some(native) = extension.take_native(handle) else {
            extension.remove_modal(handle);
            continue;
        };
        // The registered-native teardown is macOS-only today: win32 never
        // registers (workers self-release), so this arm is unreachable
        // there and the uninhabited NativeState proves it.
        #[cfg(target_os = "macos")]
        {
            let cancel_payload = extension
                .find_modal(handle)
                .map(|modal| state::cancel_payload(&modal.kind));
            match native {
                NativeState::Macos(inner) => macos::revoke(inner),
            }
            if let Some(payload) = cancel_payload {
                submit_terminal_ignoring_host_decision(extension, handle, &payload);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            // Nothing to revoke through the table on this platform; the
            // win32 revoke path is windows::revoke_session below.
            let _ = native;
        }
        extension.remove_modal(handle);
    }

    #[cfg(target_os = "windows")]
    {
        // win32 (design section 5.4): the modal table holds no records on
        // this platform (workers self-release their slots), so revocation
        // projects through the worker registry instead — every worker keyed
        // to the closing session is revoked and submits its own
        // cancel-branch terminal from its own thread.
        windows::revoke_session(session_id);
    }

    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    #[cfg(target_os = "windows")]
    {
        // win32 unload-race ruling (design section 5.3): close-all + the
        // bounded 2s join happen BEFORE the instance Drop below can reach
        // FreeLibrary. A worker that outlives the join keeps running with
        // this module pinned; shutdown() reports the fatal diagnostic.
        let report = windows::shutdown();
        if report.joined + report.leaked > 0 {
            eprintln!(
                "opentray-ext-dialog: deinit joined {} dialog worker(s), leaked {}",
                report.joined, report.leaked
            );
        }
    }
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<DialogInstance>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

// ---------------------------------------------------------------------------
// DeferredOperation command entry (design section 5.1 frozen signature)
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
            "dialog command requires an initialized instance",
        );
    }
    if out_disposition.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_disposition_buffer",
            "dialog command requires the host-seeded disposition buffer",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return zero_disposition_then(
            out_disposition,
            abi_support::record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                "dialog command envelope bytes are missing",
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
                    format!("dialog command envelope is invalid: {error}"),
                ),
            )
        }
    };
    let command = match serde_json::from_value::<options::DialogCommand>(envelope.data.clone()) {
        Ok(command) => command,
        Err(error) => {
            return zero_disposition_then(
                out_disposition,
                abi_support::record_error(
                    EXT_ERR_REJECTED,
                    options::error_code::INVALID_OPTIONS,
                    format!("dialog command is invalid: {error}"),
                ),
            )
        }
    };
    let extension = unsafe { &mut *instance.cast::<DialogInstance>() };

    match command {
        options::DialogCommand::GetBackend => {
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
                data: serde_json::json!({
                    "type": "result",
                    "op": "getBackend",
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
        show => {
            // Show commands: validation and busy happen before any state
            // change (design sections 1.2/5.4), then the seeded Deferred
            // disposition is kept as the Accepted answer.
            let Some(scope) = envelope.command_scope.clone() else {
                return zero_disposition_then(
                    out_disposition,
                    abi_support::record_error(
                        EXT_ERR_REJECTED,
                        options::error_code::INVALID_OPTIONS,
                        "show command requires the host-injected commandScope",
                    ),
                );
            };
            if let Err(error) = state::validate_show_command(&show) {
                return zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error);
            }
            let Some(kind) = ModalKind::from_command(&show) else {
                return zero_disposition_then(
                    out_disposition,
                    abi_support::record_error(
                        EXT_ERR_REJECTED,
                        options::error_code::INVALID_OPTIONS,
                        "command is not a dialog show request",
                    ),
                );
            };
            // The host pre-fills {tag: Deferred, reserved: 0, value: handle}
            // before the call; handle 0 is never issued by the registry.
            let handle = unsafe { (*out_disposition).operation_handle() };
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
            match platform_show(extension, kind, &scope, handle) {
                // Disposition stays exactly as the host seeded it
                // (Deferred + the issued handle): the pre-Accept failure
                // window is closed.
                Ok(()) => EXT_OK,
                // Pre-Accept failure transaction: no Accepted frame,
                // no terminal; the host retires the operation on this
                // error path.
                Err(error) => {
                    zero_disposition_then_typed(out_disposition, EXT_ERR_REJECTED, &error)
                }
            }
        }
    }
}

/// Deferred completion port attach (by value, design section 5.1): copy the
/// struct, keep only `port_data` + `submit`. One port per instance/mount.
#[no_mangle]
pub unsafe extern "C" fn opentray_ext_attach_deferred_completion_port_v1(
    instance: *mut c_void,
    port: ExtDeferredPortV1,
) -> ExtResultCode {
    abi_support::clear_error();
    if instance.is_null() {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "deferred port attach requires an initialized instance",
        );
    }
    let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
    match state::DeferredPortCopy::from_port(&port) {
        Ok(copy) => {
            extension.port = Some(copy);
            EXT_OK
        }
        Err(error) => abi_support::record_typed_error(EXT_ERR_REJECTED, &error),
    }
}

// ---------------------------------------------------------------------------
// poll_owner (design sections 5.2/5.7): step the modal, never carry a
// terminal.
// ---------------------------------------------------------------------------

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_poll_owner_v1(
    instance: *mut c_void,
    operation_handle: u64,
) -> ExtPollOutcomeV1 {
    if instance.is_null() {
        return ExtPollOutcomeV1::pending(EXT_POLL_NO_DEADLINE_MS, 0);
    }
    #[cfg(target_os = "macos")]
    {
        let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
        step_registered_modal(extension, operation_handle)
    }
    #[cfg(not(target_os = "macos"))]
    {
        // win32 (design section 5.3): dialog completion lives on bounded
        // STA worker threads and the modal registry never holds a record on
        // this platform, so every poll honestly reports "nothing
        // scheduled" — the broker retires the entry after one step.
        let _ = operation_handle;
        ExtPollOutcomeV1::pending(EXT_POLL_NO_DEADLINE_MS, 0)
    }
}

// ---------------------------------------------------------------------------
// Platform seams (the windows half of each seam is documented at the top of
// `src/windows/mod.rs`)
// ---------------------------------------------------------------------------

/// macOS show path: the instance busy table is the busy authority and the
/// native modal registers into `DialogInstance` (the owner loop steps it
/// through `poll_owner`).
#[cfg(target_os = "macos")]
fn platform_show(
    extension: &mut DialogInstance,
    kind: ModalKind,
    scope: &CommandScope,
    handle: u64,
) -> Result<(), TypedExtensionError> {
    if extension.is_busy(scope) {
        return Err(state::busy_error(scope, kind.label()));
    }
    let native = macos::begin(&kind)?;
    extension.register_modal(handle, scope.clone(), kind, NativeState::Macos(native));
    Ok(())
}

/// win32 show path (design section 5.3): the bounded STA worker registry
/// owns the busy view, `begin` performs the pre-Accept transaction (spawn +
/// entry evidence within the frozen 3s budget), and NOTHING registers into
/// `DialogInstance` — workers self-release their slots and submit their own
/// terminals from their own threads.
#[cfg(target_os = "windows")]
fn platform_show(
    extension: &mut DialogInstance,
    kind: ModalKind,
    scope: &CommandScope,
    handle: u64,
) -> Result<(), TypedExtensionError> {
    if windows::is_busy(scope) {
        return Err(state::busy_error(scope, kind.label()));
    }
    let _native = windows::begin(&kind, extension.port.as_ref(), handle, scope)?;
    // The Ok native control block is intentionally dropped: its Arc lives
    // in the worker registry and the worker is the single release
    // authority (the slot ownership law).
    Ok(())
}

/// Other platforms: no native dialog surface yet.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_show(
    _extension: &mut DialogInstance,
    kind: ModalKind,
    _scope: &CommandScope,
    _handle: u64,
) -> Result<(), TypedExtensionError> {
    let _ = kind;
    Err(state::typed_error(
        options::error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native dialog surface yet",
    ))
}

/// One `poll_owner` step of a registered modal (macOS only — the registry
/// holds records exclusively on this platform). Continue keeps the frozen
/// UI-frame cadence; Ended extracts the terminal while the panel is alive,
/// tears the session down, then submits the one terminal through the port
/// (the only terminal channel).
#[cfg(target_os = "macos")]
fn step_registered_modal(
    extension: &mut DialogInstance,
    operation_handle: u64,
) -> ExtPollOutcomeV1 {
    let Some(modal) = extension.find_modal_mut(operation_handle) else {
        // Unknown/finished handle: nothing scheduled for this owner.
        return ExtPollOutcomeV1::pending(EXT_POLL_NO_DEADLINE_MS, 0);
    };
    let Some(native) = modal.native.as_mut() else {
        return ExtPollOutcomeV1::pending(EXT_POLL_NO_DEADLINE_MS, 0);
    };
    let NativeState::Macos(ref mut inner) = *native;
    match macos::step(inner) {
        Ok(macos::ModalStep::Continue) => {
            ExtPollOutcomeV1::pending(EXT_POLL_STEP_INTERVAL_MS, 0)
        }
        Ok(macos::ModalStep::Ended(code)) => {
            // Natural completion: extract while the panel is alive, tear
            // the session down, then submit the one terminal through the
            // port (the only terminal channel).
            let payload = {
                let NativeState::Macos(ref inner) = *native;
                macos::extract_terminal(inner, &modal.kind, code)
            };
            let native = extension
                .take_native(operation_handle)
                .expect("native was present for the stepping modal");
            match native {
                NativeState::Macos(inner) => macos::finish(inner),
            }
            extension.remove_modal(operation_handle);
            submit_terminal_ignoring_host_decision(extension, operation_handle, &payload);
            ExtPollOutcomeV1::pending(
                EXT_POLL_NO_DEADLINE_MS,
                EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED,
            )
        }
        Err(error) => {
            // A step can only fail off the main thread (a host contract
            // violation): diagnose and stop polling this owner rather than
            // spinning.
            eprintln!(
                "opentray-ext-dialog poll step failed for handle {operation_handle:#018x}: {}",
                error.message
            );
            ExtPollOutcomeV1::pending(EXT_POLL_NO_DEADLINE_MS, 0)
        }
    }
}

#[cfg(target_os = "macos")]
fn backend_capabilities() -> Result<options::DialogBackendCapabilities, TypedExtensionError> {
    Ok(options::DialogBackendCapabilities::darwin())
}

/// win32 DTO projection (design section 7): the comctl32 v6 probe owns
/// `taskDialog`/`commandLinks`/`expander` (the broker RT_MANIFEST supplies
/// the activation context).
#[cfg(target_os = "windows")]
fn backend_capabilities() -> Result<options::DialogBackendCapabilities, TypedExtensionError> {
    Ok(windows::backend_capabilities())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn backend_capabilities() -> Result<options::DialogBackendCapabilities, TypedExtensionError> {
    Err(state::typed_error(
        options::error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native dialog surface yet",
    ))
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Submits one terminal, logging (never panicking on) the host decision.
/// macOS-only caller surface today (the win32 worker submits its own
/// terminals from its own thread).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn submit_terminal_ignoring_host_decision(
    extension: &DialogInstance,
    handle: u64,
    payload: &ExtOperationPayload,
) {
    let Some(port) = &extension.port else {
        eprintln!(
            "opentray-ext-dialog terminal for handle {handle:#018x} had no attached deferred port"
        );
        return;
    };
    let code = port.submit(handle, payload);
    if code != EXT_OK {
        // PORT_CLOSED / INVALID_HANDLE / BACKPRESSURE are host decisions
        // (revocation, purge, duplicate settlement); exactly-once is the
        // broker's settlement CAS, not ours.
        eprintln!(
            "opentray-ext-dialog terminal submit for handle {handle:#018x} returned {code} \
             (host decision; no retry)"
        );
    }
}

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

/// Records a typed error and zeroes the disposition (defensive: the host
/// skips disposition classification on error paths, but the struct must
/// never leak a stale Deferred seed).
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
            "dialog output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return abi_support::record_error(
            EXT_ERR_REJECTED,
            "serialization_failed",
            "dialog output JSON contains a nul byte",
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
                format!("dialog events could not be serialized: {error}"),
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
        assert_eq!(unsafe { opentray_ext_init(&context, &mut instance) }, EXT_OK);
        instance
    }

    fn command_envelope(data: serde_json::Value) -> CString {
        let envelope = serde_json::json!({
            "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "dialog" },
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
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        assert_eq!(unsafe { abi_support::opentray_ext_manifest(&mut output) }, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest: opentray_spec::EmbeddedExtensionManifest =
            serde_json::from_slice(bytes).expect("manifest JSON");
        assert_eq!(manifest.extension_name, "dialog");
        assert_eq!(manifest.artifact_set_version, "0.0.0");
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-dialog-contract-1"
        );
        assert_eq!(manifest.abi_version, EXT_ABI_VERSION);
        assert!(!manifest.build_identity.is_empty());
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
    }

    #[test]
    fn poll_outcome_layout_is_frozen() {
        use std::mem::{offset_of, size_of};
        assert_eq!(EXT_SYMBOL_POLL_OWNER_V1, "opentray_ext_poll_owner_v1");
        assert_eq!(EXT_POLL_STATUS_PENDING, 0);
        assert_eq!(EXT_POLL_NO_DEADLINE_MS, u64::MAX);
        assert_eq!(EXT_POLL_STEP_INTERVAL_MS, 16);
        assert_eq!(EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED, 1);

        assert_eq!(
            size_of::<ExtPollOutcomeV1>(),
            3 * size_of::<u64>(),
            "status + reserved + deadline word + wake_flags, padded to the u64 alignment"
        );
        assert_eq!(offset_of!(ExtPollOutcomeV1, status), 0);
        assert_eq!(offset_of!(ExtPollOutcomeV1, reserved), size_of::<u32>());
        assert_eq!(
            offset_of!(ExtPollOutcomeV1, next_deadline_ms),
            size_of::<u64>()
        );
        assert_eq!(
            offset_of!(ExtPollOutcomeV1, wake_flags),
            2 * size_of::<u64>()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn get_backend_answers_immediate_with_the_frozen_darwin_dto() {
        let instance = init_instance();
        let envelope = command_envelope(serde_json::json!({ "type": "getBackend" }));
        let (code, events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_OK);
        // Immediate: the seeded Deferred disposition was rewritten to the
        // all-zero Immediate form and the events buffer carries the DTO.
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert!(disposition.value_is_zero());

        let bytes = unsafe { std::slice::from_raw_parts(events.ptr.cast::<u8>(), events.len) };
        let parsed: Vec<ExtensionEnvelope> = serde_json::from_slice(bytes).expect("events");
        unsafe { opentray_ext_free_string(events.ptr, events.len) };
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].data["op"], "getBackend");
        let backend = &parsed[0].data["backend"];
        assert_eq!(backend["platform"], "darwin");
        assert_eq!(backend["suppression"], true);
        assert_eq!(backend["packageSemantics"], true);
        assert_eq!(backend["mixedFileDirectorySelection"], true);
        assert_eq!(backend["taskDialog"], false);
        assert_eq!(backend["commandLinks"], false);
        assert_eq!(backend["expander"], false);
        assert_eq!(backend["addToRecentControl"], false);
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn invalid_commands_reject_with_the_typed_code_and_zeroed_disposition() {
        let instance = init_instance();
        // Unknown command type.
        let envelope = command_envelope(serde_json::json!({ "type": "nonsense" }));
        let (code, events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert!(events.ptr.is_null(), "no events on a rejected command");
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert!(disposition.value_is_zero());
        let detail = take_error_detail();
        assert_eq!(detail.category, options::error_code::INVALID_OPTIONS);
        assert!(!detail.message.is_empty());

        // Malformed messageDialog options (empty buttons).
        let envelope = command_envelope(serde_json::json!({
            "type": "messageDialog",
            "message": "m",
            "buttons": []
        }));
        let (code, _events, disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        assert_eq!(disposition.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        let detail = take_error_detail();
        assert_eq!(detail.category, options::error_code::INVALID_OPTIONS);
        assert_eq!(detail.details.as_ref().unwrap()["field"], "buttons");
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn show_without_command_scope_rejects_before_any_state_change() {
        let instance = init_instance();
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "dialog" },
                "data": { "type": "pickFile" }
            })
            .to_string(),
        )
        .unwrap();
        let (code, _events, _disposition) = dispatch(instance, &envelope);
        assert_eq!(code, EXT_ERR_REJECTED);
        let detail = take_error_detail();
        assert_eq!(detail.category, options::error_code::INVALID_OPTIONS);
        unsafe { opentray_ext_deinit(instance) };
    }

    /// The busy law through the real instance state: the busy table is
    /// platform-neutral, so the reservation and the typed rejection are
    /// observable on any harness thread.
    #[test]
    fn busy_registry_scopes_the_second_show_to_a_typed_rejection() {
        use opentray_spec::CommandScope;

        let instance = init_instance();
        let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
        let scope = CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
            instance_generation: 1,
        };
        assert!(!extension.is_busy(&scope));
        state::tests::register_bare(extension, 21, scope.clone());
        assert!(extension.is_busy(&scope));
        let error = state::busy_error(&scope, "pickFile");
        assert_eq!(error.code, options::error_code::SESSION_BUSY);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({
                "kind": "owner",
                "appId": "app-1",
                "trayId": "tray-1",
                "sessionId": "session-1",
            })
        );
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn poll_owner_for_unknown_handles_reports_no_deadline() {
        let instance = init_instance();
        let outcome = unsafe { opentray_ext_poll_owner_v1(instance, 0xdead_beef) };
        assert_eq!(outcome.status, EXT_POLL_STATUS_PENDING);
        assert_eq!(outcome.reserved, 0);
        assert_eq!(outcome.next_deadline_ms, EXT_POLL_NO_DEADLINE_MS);
        assert_eq!(outcome.wake_flags, 0);
        // A null instance is never UB: no deadline, no flags.
        let outcome = unsafe { opentray_ext_poll_owner_v1(ptr::null_mut(), 1) };
        assert_eq!(outcome.next_deadline_ms, EXT_POLL_NO_DEADLINE_MS);
        unsafe { opentray_ext_deinit(instance) };
    }

    /// Session cleanup removes the session's modals. A native-less record
    /// (already settled) is removed WITHOUT a second terminal submission —
    /// exactly-once — while the cancel-branch submission itself is driven
    /// end-to-end on the main thread by the modal probe (task 3.1).
    #[test]
    fn session_cleanup_removes_modals_and_never_double_submits() {
        use opentray_spec::CommandScope;

        static SUBMIT_CALLS: Mutex<Vec<u64>> = Mutex::new(Vec::new());
        unsafe extern "C" fn recording_submit(
            _port_data: *mut c_void,
            handle: u64,
            _payload_ptr: *const u8,
            _payload_len: usize,
        ) -> ExtResultCode {
            SUBMIT_CALLS.lock().unwrap().push(handle);
            EXT_OK
        }
        let instance = init_instance();
        let port = ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
            // Non-null host state pointer (the copy validation rejects
            // null); the recording submit ignores it.
            port_data: usize::MAX as *mut c_void,
            submit: recording_submit,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );

        let scope = CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
            instance_generation: 1,
        };
        let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
        state::tests::register_bare(extension, 31, scope);
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

        let extension = unsafe { &mut *instance.cast::<DialogInstance>() };
        assert_eq!(extension.active_count(), 0);
        assert!(
            SUBMIT_CALLS.lock().unwrap().is_empty(),
            "a native-less record has already settled its terminal"
        );
        unsafe { opentray_ext_deinit(instance) };
    }

    #[test]
    fn deferred_port_attach_rejects_mismatched_port_identity() {
        unsafe extern "C" fn ok_submit(
            _a: *mut c_void,
            _b: u64,
            _c: *const u8,
            _d: usize,
        ) -> ExtResultCode {
            EXT_OK
        }
        let instance = init_instance();
        let mut port = ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1 + 1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
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

    /// A well-formed port copy is accepted once and later replaces are
    /// last-write-wins per instance (one mount one port; the host attaches
    /// exactly once per load).
    #[test]
    fn deferred_port_attach_accepts_the_validated_copy() {
        unsafe extern "C" fn submit_ok(
            _port_data: *mut c_void,
            _handle: u64,
            _payload_ptr: *const u8,
            _payload_len: usize,
        ) -> ExtResultCode {
            EXT_OK
        }
        let instance = init_instance();
        let port = ExtDeferredPortV1 {
            abi_version: opentray_spec::EXT_DEFERRED_PORT_ABI_V1,
            struct_size: std::mem::size_of::<ExtDeferredPortV1>() as u32,
            port_data: 0x1 as *mut c_void,
            submit: submit_ok,
        };
        assert_eq!(
            unsafe { opentray_ext_attach_deferred_completion_port_v1(instance, port) },
            EXT_OK
        );
        unsafe { opentray_ext_deinit(instance) };
    }
}
