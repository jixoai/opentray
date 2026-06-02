#[cfg(target_os = "macos")]
mod macos;

use std::ffi::{c_char, c_void, CString};
use std::fmt;

use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope, Rect,
    EXT_ABI_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED, EXT_OK,
};
use serde::Deserialize;
use serde_json::Value;

#[cfg(target_os = "macos")]
type WebviewRuntime = macos::MacosWebviewRuntime;

#[cfg(not(target_os = "macos"))]
type WebviewRuntime = UnsupportedWebviewRuntime;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NavigatorWindowSettings {
    pub enabled: bool,
    pub bind_window_globals: bool,
}

struct WebviewExtension {
    surface_id: String,
    runtime: WebviewRuntime,
}

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct UnsupportedWebviewRuntime;

#[cfg(not(target_os = "macos"))]
impl UnsupportedWebviewRuntime {
    fn handle(
        &mut self,
        _tray_id: &str,
        _command: WebviewCommand,
    ) -> Result<Value, WebviewRuntimeError> {
        Err(WebviewRuntimeError::Unsupported(
            "webview runtime is not implemented for this platform".into(),
        ))
    }

    fn lease_closed(&mut self, _lease_id: &str) {}
}

#[derive(Debug, Clone, PartialEq)]
enum WebviewCommand {
    Show {
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        fallback_rect: Option<Rect>,
        navigator_window: NavigatorWindowSettings,
    },
    Hide,
    Navigate {
        url: String,
    },
    Evaluate {
        js: String,
    },
    PostMessage {
        payload: Value,
    },
}

#[derive(Debug)]
enum WebviewRuntimeError {
    Rejected(String),
    Unsupported(String),
    Internal(String),
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowCommandData {
    html: Option<String>,
    url: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    #[serde(rename = "fallbackRect")]
    fallback_rect: Option<Rect>,
    native_window_api: Option<bool>,
    bind_window_globals: Option<bool>,
}

impl WebviewRuntimeError {
    fn code(&self) -> ExtResultCode {
        match self {
            Self::Rejected(_) => EXT_ERR_REJECTED,
            Self::Unsupported(_) => EXT_ERR_UNSUPPORTED,
            Self::Internal(_) => EXT_ERR_INTERNAL,
        }
    }
}

impl fmt::Display for WebviewRuntimeError {
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
    let instance = Box::new(WebviewExtension {
        surface_id,
        runtime: WebviewRuntime::default(),
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

    let extension = unsafe { &mut *instance.cast::<WebviewExtension>() };
    if envelope.scope.surface_id != extension.surface_id {
        return EXT_ERR_REJECTED;
    }
    let Some(tray_id) = envelope.scope.tray_id.as_deref() else {
        return EXT_ERR_REJECTED;
    };
    let Ok(command) = parse_webview_command(&envelope.data) else {
        return EXT_ERR_REJECTED;
    };
    let event = match extension.runtime.handle(tray_id, command) {
        Ok(event) => event,
        Err(error) => {
            eprintln!("opentray-ext-webview command failed: {error}");
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
    let extension = unsafe { &mut *instance.cast::<WebviewExtension>() };
    extension.runtime.lease_closed(&lease_id);
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<WebviewExtension>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(bytes: ExtOwnedBytes) {
    if !bytes.ptr.is_null() {
        drop(unsafe { CString::from_raw(bytes.ptr) });
    }
}

fn parse_webview_command(data: &Value) -> Result<WebviewCommand, WebviewRuntimeError> {
    let command_type = data
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| WebviewRuntimeError::Rejected("webview command requires type".into()))?;

    match command_type {
        "show" => {
            let parsed: ShowCommandData =
                serde_json::from_value(data.clone()).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!("invalid webview show command: {error}"))
                })?;
            let bind_window_globals = parsed.bind_window_globals.unwrap_or(false);
            Ok(WebviewCommand::Show {
                html: parsed.html,
                url: parsed.url,
                width: parsed.width.unwrap_or(420.0),
                height: parsed.height.unwrap_or(260.0),
                fallback_rect: parsed.fallback_rect,
                navigator_window: NavigatorWindowSettings {
                    enabled: parsed.native_window_api.unwrap_or(false) || bind_window_globals,
                    bind_window_globals,
                },
            })
        }
        "hide" => Ok(WebviewCommand::Hide),
        "navigate" => Ok(WebviewCommand::Navigate {
            url: required_string(data, "url")?,
        }),
        "evaluate" => Ok(WebviewCommand::Evaluate {
            js: required_string(data, "js")?,
        }),
        "postMessage" => Ok(WebviewCommand::PostMessage {
            payload: data.get("payload").cloned().unwrap_or(Value::Null),
        }),
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported webview command: {other}"
        ))),
    }
}

fn required_string(data: &Value, key: &str) -> Result<String, WebviewRuntimeError> {
    data.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| WebviewRuntimeError::Rejected(format!("webview command requires {key}")))
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
    fn parse_show_command_keeps_extension_owned_protocol() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "html": "<main />",
            "width": 360,
            "height": 220,
            "fallbackRect": { "x": 1, "y": 2, "width": 3, "height": 4 }
        }))
        .expect("show command");

        assert_eq!(
            command,
            WebviewCommand::Show {
                html: Some("<main />".to_string()),
                url: None,
                width: 360.0,
                height: 220.0,
                fallback_rect: Some(Rect {
                    x: 1,
                    y: 2,
                    width: 3,
                    height: 4,
                }),
                navigator_window: NavigatorWindowSettings::default(),
            }
        );
    }

    #[test]
    fn parse_show_command_reads_navigator_window_flags() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "width": 360,
            "height": 220,
            "nativeWindowApi": true,
            "bindWindowGlobals": true
        }))
        .expect("show command");

        assert_eq!(
            command,
            WebviewCommand::Show {
                html: None,
                url: None,
                width: 360.0,
                height: 220.0,
                fallback_rect: None,
                navigator_window: NavigatorWindowSettings {
                    enabled: true,
                    bind_window_globals: true,
                },
            }
        );
    }

    #[test]
    fn lease_closed_returns_empty_event_array() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
            runtime: WebviewRuntime::default(),
        }))
        .cast::<c_void>();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_lease_closed(
                instance,
                &unsupported_host_context(),
                ExtBytes {
                    ptr: c"lease-1".as_ptr(),
                    len: "lease-1".len(),
                },
                &mut output,
            )
        };

        assert_eq!(result, EXT_OK);
        let value = unsafe { CStr::from_ptr(output.ptr) };
        assert_eq!(value.to_str().unwrap(), "[]");
        unsafe {
            opentray_ext_free_string(output);
            opentray_ext_deinit(instance);
        }
    }

    #[test]
    fn hide_command_returns_platform_specific_result() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
            runtime: WebviewRuntime::default(),
        }))
        .cast::<c_void>();
        let envelope = CString::new(
            serde_json::to_string(&ExtensionEnvelope {
                scope: opentray_spec::ExtensionScope {
                    surface_id: "surface-1".to_string(),
                    tray_id: Some("tray-1".to_string()),
                    ext: "webview".to_string(),
                },
                data: serde_json::json!({ "type": "hide" }),
            })
            .unwrap(),
        )
        .unwrap();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_command(
                instance,
                &unsupported_host_context(),
                borrowed_bytes(&envelope),
                &mut output,
            )
        };

        #[cfg(target_os = "macos")]
        {
            assert_eq!(result, EXT_OK);
            let json = unsafe { CStr::from_ptr(output.ptr) }.to_str().unwrap();
            assert!(json.contains("\"type\":\"hidden\""));
            unsafe { opentray_ext_free_string(output) };
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(result, EXT_ERR_UNSUPPORTED);
        }

        unsafe { opentray_ext_deinit(instance) };
    }

    extern "C" fn unsupported_send_event(
        _host_data: *mut c_void,
        _event_json: ExtBytes,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_get_rect(_host_data: *mut c_void, _out: *mut Rect) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_invoke_host(
        _host_data: *mut c_void,
        _capability: ExtBytes,
        _request_json: ExtBytes,
        _out_response_json: *mut ExtOwnedBytes,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_free_host_string(_host_data: *mut c_void, _bytes: ExtOwnedBytes) {}

    fn unsupported_host_context() -> ExtHostContext {
        ExtHostContext {
            host_data: ptr::null_mut(),
            send_event: unsupported_send_event,
            get_rect: unsupported_get_rect,
            invoke_host: unsupported_invoke_host,
            free_host_string: unsupported_free_host_string,
        }
    }

    fn borrowed_bytes(value: &CString) -> ExtBytes {
        ExtBytes {
            ptr: value.as_ptr(),
            len: value.as_bytes().len(),
        }
    }
}
