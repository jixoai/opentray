mod abi_support;
#[cfg(target_os = "macos")]
mod macos;
mod protocol;

use std::ffi::{c_char, c_void, CString};
use std::fmt;

use abi_support::{clear_error, record_error};
use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope,
    EXT_ABI_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED, EXT_OK,
};
use protocol::parse_lynx_command;
#[cfg(not(target_os = "macos"))]
use protocol::LynxCommand;
#[cfg(not(target_os = "macos"))]
use serde_json::Value;

#[cfg(target_os = "macos")]
type LynxRuntime = macos::MacosLynxRuntime;

#[cfg(not(target_os = "macos"))]
type LynxRuntime = UnsupportedLynxRuntime;

struct LynxExtension {
    app_id: String,
    runtime: LynxRuntime,
}

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct UnsupportedLynxRuntime;

#[cfg(not(target_os = "macos"))]
impl UnsupportedLynxRuntime {
    fn handle(&mut self, _tray_id: &str, command: LynxCommand) -> Result<Value, LynxRuntimeError> {
        match command {
            LynxCommand::Hide => Ok(serde_json::json!({ "type": "hidden" })),
            LynxCommand::Show { .. } => Err(LynxRuntimeError::Unsupported(
                "lynx runtime is only implemented for macOS".into(),
            )),
        }
    }

    fn session_closed(&mut self, _session_id: &str) {}
}

#[derive(Debug)]
enum LynxRuntimeError {
    Rejected(String),
    Unsupported(String),
    Internal(String),
}

impl LynxRuntimeError {
    fn code(&self) -> ExtResultCode {
        match self {
            Self::Rejected(_) => EXT_ERR_REJECTED,
            Self::Unsupported(_) => EXT_ERR_UNSUPPORTED,
            Self::Internal(_) => EXT_ERR_INTERNAL,
        }
    }

    fn category(&self) -> &'static str {
        match self {
            Self::Rejected(_) => "rejected",
            Self::Unsupported(_) => "unsupported",
            Self::Internal(_) => "internal",
        }
    }
}

impl fmt::Display for LynxRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(message) | Self::Unsupported(message) | Self::Internal(message) => {
                write!(f, "{message}")
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn opentray_ext_abi_version() -> u32 {
    EXT_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_init(
    context: *const ExtContext,
    out_instance: *mut *mut c_void,
) -> ExtResultCode {
    clear_error();
    if context.is_null() || out_instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_init_context",
            "init requires context and output instance pointers",
        );
    }

    let app_id = match unsafe { read_ext_string((*context).app_id) } {
        Some(value) => value,
        None => {
            return record_error(
                EXT_ERR_REJECTED,
                "invalid_app_id",
                "init app id is missing or invalid UTF-8",
            )
        }
    };
    let instance = Box::new(LynxExtension {
        app_id,
        runtime: LynxRuntime::default(),
    });
    unsafe {
        *out_instance = Box::into_raw(instance).cast::<c_void>();
    }
    EXT_OK
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_command(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    clear_error();
    if instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "Lynx command requires an initialized instance",
        );
    }
    let Some(bytes) = (unsafe { ext_bytes_as_slice(envelope_json) }) else {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_command_envelope",
            "Lynx command envelope bytes are missing",
        );
    };
    let envelope = match serde_json::from_slice::<ExtensionEnvelope>(bytes) {
        Ok(envelope) => envelope,
        Err(error) => {
            return record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                format!("Lynx command envelope is invalid: {error}"),
            )
        }
    };

    let extension = unsafe { &mut *instance.cast::<LynxExtension>() };
    if envelope.scope.app_id != extension.app_id {
        return record_error(
            EXT_ERR_REJECTED,
            "app_scope_mismatch",
            "Lynx command app id does not own this instance",
        );
    }
    let Some(tray_id) = envelope.scope.tray_id.as_deref() else {
        return record_error(
            EXT_ERR_REJECTED,
            "missing_tray_scope",
            "Lynx command requires a tray id",
        );
    };
    let command = match parse_lynx_command(&envelope.data) {
        Ok(command) => command,
        Err(error) => return record_error(error.code(), error.category(), error.to_string()),
    };
    let event = match extension.runtime.handle(tray_id, command) {
        Ok(event) => event,
        Err(error) => {
            eprintln!("opentray-ext-lynx command failed: {error}");
            return record_error(error.code(), error.category(), error.to_string());
        }
    };

    let events = vec![ExtensionEnvelope {
        scope: envelope.scope,
        data: event,
    }];
    write_owned_events(out_events_json, &events)
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_session_closed(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    session_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    clear_error();
    if instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "Lynx session cleanup requires an initialized instance",
        );
    }
    let Some(session_id) = (unsafe { read_ext_string(session_id) }) else {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_session_id",
            "Lynx session id is missing or invalid UTF-8",
        );
    };
    let extension = unsafe { &mut *instance.cast::<LynxExtension>() };
    extension.runtime.session_closed(&session_id);
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<LynxExtension>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

unsafe fn read_ext_string(bytes: ExtBytes) -> Option<String> {
    let slice = unsafe { ext_bytes_as_slice(bytes) }?;
    String::from_utf8(slice.to_vec()).ok()
}

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

fn write_owned_json(out: *mut ExtOwnedBytes, json: &str) -> ExtResultCode {
    if out.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_output_buffer",
            "Lynx output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return record_error(
            EXT_ERR_INTERNAL,
            "serialization_failed",
            "Lynx output JSON contains a nul byte",
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
            return record_error(
                EXT_ERR_INTERNAL,
                "serialization_failed",
                format!("Lynx events could not be serialized: {error}"),
            )
        }
    };
    write_owned_json(out, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::CStr, ptr};

    #[test]
    fn abi_version_matches_public_contract() {
        assert_eq!(opentray_ext_abi_version(), EXT_ABI_VERSION);
    }

    #[test]
    fn exports_embedded_artifact_identity() {
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe { abi_support::opentray_ext_manifest(&mut output) };

        assert_eq!(result, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest = serde_json::from_slice::<opentray_spec::EmbeddedExtensionManifest>(bytes)
            .expect("manifest JSON");
        assert_eq!(manifest.extension_name, "lynx");
        assert_eq!(manifest.artifact_set_version, "0.11.1");
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-lynx-contract-1"
        );
        assert!(!manifest.build_identity.is_empty());
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
    }

    #[test]
    fn command_round_trip_uses_extension_owned_json() {
        let context = ExtContext {
            api_version: 1,
            app_id: ExtBytes {
                ptr: c"app-1".as_ptr(),
                len: "app-1".len(),
            },
        };
        let mut instance = ptr::null_mut();
        let init = unsafe { opentray_ext_init(&context, &mut instance) };
        assert_eq!(init, EXT_OK);

        let mut out = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let envelope = serde_json::json!({
            "scope": {
                "appId": "app-1",
                "trayId": "tray-1",
                "ext": "lynx"
            },
            "data": {
                "type": "hide"
            }
        })
        .to_string();
        let result = unsafe {
            opentray_ext_command(
                instance,
                ptr::null(),
                ExtBytes {
                    ptr: envelope.as_ptr().cast::<c_char>(),
                    len: envelope.len(),
                },
                &mut out,
            )
        };
        assert_eq!(result, EXT_OK);
        let json = unsafe { CStr::from_ptr(out.ptr) }.to_str().expect("utf8");
        assert_eq!(
            json,
            r#"[{"scope":{"appId":"app-1","trayId":"tray-1","ext":"lynx"},"data":{"type":"hidden"}}]"#
        );
        unsafe { opentray_ext_free_string(out.ptr, out.len) };
        unsafe { opentray_ext_deinit(instance) };
    }
}
