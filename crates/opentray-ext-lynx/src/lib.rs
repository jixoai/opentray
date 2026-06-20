#[cfg(target_os = "macos")]
mod macos;
mod protocol;

use std::ffi::{c_char, c_void, CString};
use std::fmt;

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
    surface_id: String,
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

    fn lease_closed(&mut self, _lease_id: &str) {}
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
    if context.is_null() || out_instance.is_null() {
        return EXT_ERR_REJECTED;
    }

    let surface_id = match unsafe { read_ext_string((*context).surface_id) } {
        Some(value) => value,
        None => return EXT_ERR_REJECTED,
    };
    let instance = Box::new(LynxExtension {
        surface_id,
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
    if instance.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(bytes) = (unsafe { ext_bytes_as_slice(envelope_json) }) else {
        return EXT_ERR_REJECTED;
    };
    let Ok(envelope) = serde_json::from_slice::<ExtensionEnvelope>(bytes) else {
        return EXT_ERR_REJECTED;
    };

    let extension = unsafe { &mut *instance.cast::<LynxExtension>() };
    if envelope.scope.surface_id != extension.surface_id {
        return EXT_ERR_REJECTED;
    }
    let Some(tray_id) = envelope.scope.tray_id.as_deref() else {
        return EXT_ERR_REJECTED;
    };
    let Ok(command) = parse_lynx_command(&envelope.data) else {
        return EXT_ERR_REJECTED;
    };
    let event = match extension.runtime.handle(tray_id, command) {
        Ok(event) => event,
        Err(error) => {
            eprintln!("opentray-ext-lynx command failed: {error}");
            return error.code();
        }
    };

    let events = vec![ExtensionEnvelope {
        scope: envelope.scope,
        data: event,
    }];
    write_owned_events(out_events_json, &events)
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_lease_closed(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    lease_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    if instance.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(lease_id) = (unsafe { read_ext_string(lease_id) }) else {
        return EXT_ERR_REJECTED;
    };
    let extension = unsafe { &mut *instance.cast::<LynxExtension>() };
    extension.runtime.lease_closed(&lease_id);
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<LynxExtension>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(bytes: ExtOwnedBytes) {
    if !bytes.ptr.is_null() {
        drop(unsafe { CString::from_raw(bytes.ptr) });
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
        return EXT_ERR_REJECTED;
    }
    let Ok(value) = CString::new(json) else {
        return EXT_ERR_REJECTED;
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
    let Ok(json) = serde_json::to_string(events) else {
        return EXT_ERR_REJECTED;
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
    fn command_round_trip_uses_extension_owned_json() {
        let context = ExtContext {
            api_version: 1,
            surface_id: ExtBytes {
                ptr: c"space-1".as_ptr(),
                len: "space-1".len(),
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
                "spaceId": "space-1",
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
            r#"[{"scope":{"spaceId":"space-1","trayId":"tray-1","ext":"lynx"},"data":{"type":"hidden"}}]"#
        );
        unsafe { opentray_ext_free_string(out) };
        unsafe { opentray_ext_deinit(instance) };
    }
}
