use std::ffi::{c_char, c_void, CString};

use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope,
    EXT_ABI_VERSION, EXT_ERR_REJECTED, EXT_HOST_CAPABILITY_WEBVIEW, EXT_OK,
};
use serde_json::{json, Value};

struct WebviewExtension {
    surface_id: String,
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
    let instance = Box::new(WebviewExtension { surface_id });
    unsafe {
        *out_instance = Box::into_raw(instance).cast::<c_void>();
    }
    EXT_OK
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_command(
    instance: *mut c_void,
    context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    if instance.is_null() || context.is_null() {
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

    let Ok(request_json) = serde_json::to_vec(&json!({
        "scope": envelope.scope,
        "command": envelope.data,
    })) else {
        return EXT_ERR_REJECTED;
    };

    let mut response = ExtOwnedBytes {
        ptr: std::ptr::null_mut(),
        len: 0,
    };
    let result = invoke_host(
        context,
        EXT_HOST_CAPABILITY_WEBVIEW,
        &request_json,
        &mut response,
    );
    if result != EXT_OK {
        return result;
    }

    let Some(data) = (unsafe { read_host_response(context, response) }) else {
        return EXT_ERR_REJECTED;
    };
    let events = vec![ExtensionEnvelope {
        scope: envelope.scope,
        data,
    }];
    write_owned_events(out_events_json, &events)
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_lease_closed(
    instance: *mut c_void,
    context: *const ExtHostContext,
    lease_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    if instance.is_null() || context.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(lease_id) = (unsafe { read_ext_string(lease_id) }) else {
        return EXT_ERR_REJECTED;
    };
    let Ok(request_json) = serde_json::to_vec(&json!({
        "command": {
            "type": "leaseClosed",
            "leaseId": lease_id,
        },
    })) else {
        return EXT_ERR_REJECTED;
    };
    let mut response = ExtOwnedBytes {
        ptr: std::ptr::null_mut(),
        len: 0,
    };
    let result = invoke_host(
        context,
        EXT_HOST_CAPABILITY_WEBVIEW,
        &request_json,
        &mut response,
    );
    if result != EXT_OK {
        return result;
    }
    unsafe {
        ((*context).free_host_string)((*context).host_data, response);
    }
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

fn invoke_host(
    context: *const ExtHostContext,
    capability: &str,
    request_json: &[u8],
    out_response_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    let Ok(capability) = CString::new(capability) else {
        return EXT_ERR_REJECTED;
    };
    let Ok(request_json) = CString::new(request_json) else {
        return EXT_ERR_REJECTED;
    };
    unsafe {
        ((*context).invoke_host)(
            (*context).host_data,
            borrowed_bytes(&capability),
            borrowed_bytes(&request_json),
            out_response_json,
        )
    }
}

unsafe fn read_host_response(
    context: *const ExtHostContext,
    response: ExtOwnedBytes,
) -> Option<Value> {
    if response.ptr.is_null() || response.len == 0 {
        return Some(Value::Null);
    }
    let bytes = unsafe { std::slice::from_raw_parts(response.ptr.cast::<u8>(), response.len) };
    let value = serde_json::from_slice(bytes).ok()?;
    unsafe {
        ((*context).free_host_string)((*context).host_data, response);
    }
    Some(value)
}

fn borrowed_bytes(value: &CString) -> ExtBytes {
    ExtBytes {
        ptr: value.as_ptr(),
        len: value.as_bytes().len(),
    }
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
    fn lease_closed_returns_empty_event_array() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
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
    fn command_invokes_host_webview_capability_and_returns_event() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
        }))
        .cast::<c_void>();
        let envelope = serde_json::to_string(&ExtensionEnvelope {
            scope: opentray_spec::ExtensionScope {
                surface_id: "surface-1".to_string(),
                tray_id: Some("tray-1".to_string()),
                ext: "webview".to_string(),
            },
            data: json!({ "type": "show" }),
        })
        .unwrap();
        let envelope = CString::new(envelope).unwrap();
        let mut state = HostState::default();
        let host = host_context(&mut state);
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_command(instance, &host, borrowed_bytes(&envelope), &mut output)
        };

        assert_eq!(result, EXT_OK);
        assert_eq!(
            state.capability,
            Some(EXT_HOST_CAPABILITY_WEBVIEW.to_string())
        );
        assert_eq!(state.command_type, Some("show".to_string()));
        let json = unsafe { CStr::from_ptr(output.ptr) }.to_str().unwrap();
        assert!(json.contains("\"type\":\"shown\""));
        unsafe {
            opentray_ext_free_string(output);
            opentray_ext_deinit(instance);
        }
    }

    extern "C" fn unsupported_send_event(
        _host_data: *mut c_void,
        _event_json: ExtBytes,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_get_rect(
        _host_data: *mut c_void,
        _out: *mut opentray_spec::Rect,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_invoke_host(
        _host_data: *mut c_void,
        _capability: ExtBytes,
        _request_json: ExtBytes,
        _out_response_json: *mut ExtOwnedBytes,
    ) -> ExtResultCode {
        EXT_OK
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

    #[derive(Default)]
    struct HostState {
        capability: Option<String>,
        command_type: Option<String>,
    }

    extern "C" fn host_invoke(
        host_data: *mut c_void,
        capability: ExtBytes,
        request_json: ExtBytes,
        out_response_json: *mut ExtOwnedBytes,
    ) -> ExtResultCode {
        let state = unsafe { &mut *host_data.cast::<HostState>() };
        state.capability = unsafe { read_ext_string(capability) };
        let request = unsafe { ext_bytes_as_slice(request_json) }
            .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
            .unwrap();
        state.command_type = request
            .get("command")
            .and_then(|command| command.get("type"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        write_owned_json(out_response_json, r#"{"type":"shown"}"#)
    }

    extern "C" fn host_free_string(_host_data: *mut c_void, bytes: ExtOwnedBytes) {
        unsafe {
            opentray_ext_free_string(bytes);
        }
    }

    fn host_context(state: &mut HostState) -> ExtHostContext {
        ExtHostContext {
            host_data: (state as *mut HostState).cast::<c_void>(),
            send_event: unsupported_send_event,
            get_rect: unsupported_get_rect,
            invoke_host: host_invoke,
            free_host_string: host_free_string,
        }
    }
}
