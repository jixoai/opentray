use std::ffi::{c_char, c_void};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Rect, SurfaceId, TrayId};

pub const EXT_API_VERSION: u32 = 1;

pub type ExtResultCode = i32;
pub const EXT_OK: ExtResultCode = 0;

#[repr(C)]
pub struct ExtContext {
    pub api_version: u32,
    pub surface_id: *const c_char,
    pub host_data: *mut c_void,
    pub send_event:
        extern "C" fn(host_data: *mut c_void, event_json: *const c_char, len: u32) -> ExtResultCode,
    pub get_rect: extern "C" fn(host_data: *mut c_void, out: *mut Rect) -> ExtResultCode,
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
