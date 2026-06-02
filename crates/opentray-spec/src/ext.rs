use std::ffi::{c_char, c_void};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Rect, SurfaceId, TrayId};

pub const EXT_API_VERSION: u32 = 1;
pub const EXT_ABI_VERSION: u32 = 2;

pub type ExtResultCode = i32;
pub const EXT_OK: ExtResultCode = 0;
pub const EXT_ERR_REJECTED: ExtResultCode = 1;
pub const EXT_ERR_UNSUPPORTED: ExtResultCode = 2;
pub const EXT_ERR_INTERNAL: ExtResultCode = 3;

pub const EXT_SYMBOL_ABI_VERSION: &str = "opentray_ext_abi_version";
pub const EXT_SYMBOL_INIT: &str = "opentray_ext_init";
pub const EXT_SYMBOL_COMMAND: &str = "opentray_ext_command";
pub const EXT_SYMBOL_LEASE_CLOSED: &str = "opentray_ext_lease_closed";
pub const EXT_SYMBOL_DEINIT: &str = "opentray_ext_deinit";
pub const EXT_SYMBOL_FREE_STRING: &str = "opentray_ext_free_string";

pub const REQUIRED_EXTENSION_SYMBOLS: &[&str] = &[
    EXT_SYMBOL_ABI_VERSION,
    EXT_SYMBOL_INIT,
    EXT_SYMBOL_COMMAND,
    EXT_SYMBOL_LEASE_CLOSED,
    EXT_SYMBOL_DEINIT,
    EXT_SYMBOL_FREE_STRING,
];

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtBytes {
    pub ptr: *const c_char,
    pub len: usize,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtOwnedBytes {
    pub ptr: *mut c_char,
    pub len: usize,
}

#[repr(C)]
pub struct ExtContext {
    pub api_version: u32,
    pub surface_id: ExtBytes,
}

pub type ExtSendEventFn =
    extern "C" fn(host_data: *mut c_void, event_json: ExtBytes) -> ExtResultCode;
pub type ExtGetRectFn = extern "C" fn(host_data: *mut c_void, out: *mut Rect) -> ExtResultCode;
/// Generic host-owned capability call for dynamic extensions.
///
/// Extensions own their command protocol. This hook is reserved for future
/// privileged host facilities that must not cross the ABI as concrete types.
pub type ExtInvokeHostFn = extern "C" fn(
    host_data: *mut c_void,
    capability: ExtBytes,
    request_json: ExtBytes,
    out_response_json: *mut ExtOwnedBytes,
) -> ExtResultCode;
pub type ExtFreeHostStringFn = extern "C" fn(host_data: *mut c_void, bytes: ExtOwnedBytes);

#[repr(C)]
pub struct ExtHostContext {
    pub host_data: *mut c_void,
    pub send_event: ExtSendEventFn,
    pub get_rect: ExtGetRectFn,
    pub invoke_host: ExtInvokeHostFn,
    pub free_host_string: ExtFreeHostStringFn,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScope {
    pub surface_id: SurfaceId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_id: Option<TrayId>,
    pub ext: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEnvelope {
    pub scope: ExtensionScope,
    pub data: Value,
}
