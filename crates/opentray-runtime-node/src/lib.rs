use napi_derive::napi;
use opentray_spec::PROTOCOL_VERSION;

#[napi(object)]
pub struct RuntimeBindingInfo {
    pub kind: String,
    pub protocol_version: u32,
}

#[napi]
pub fn runtime_binding_info() -> RuntimeBindingInfo {
    RuntimeBindingInfo {
        kind: "opentray-node-runtime".to_string(),
        protocol_version: PROTOCOL_VERSION,
    }
}
