//! WebView artifact identity and structured ABI error transport.

use std::ffi::c_void;

use opentray_spec::{
    EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_OK, ExtEventPortV1, ExtOwnedBytes, ExtResultCode,
    ExtensionErrorSlot, build_embedded_extension_manifest, write_owned_json,
};

static LAST_ERROR: ExtensionErrorSlot = ExtensionErrorSlot::new();

pub(crate) fn clear_error() {
    LAST_ERROR.clear();
}

pub(crate) fn record_error(
    result: ExtResultCode,
    category: impl Into<String>,
    message: impl Into<String>,
) -> ExtResultCode {
    LAST_ERROR.fail(result, category, message)
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_manifest(out: *mut ExtOwnedBytes) -> ExtResultCode {
    clear_error();
    let manifest = match build_embedded_extension_manifest(
        "webview",
        include_str!("../../../packages/ext-webview/package.json"),
        include_str!("../../../packages/ext-webview/contract.json"),
        option_env!("OPENTRAY_BUILD_IDENTITY")
            .unwrap_or(concat!("source:", env!("CARGO_PKG_NAME"))),
    ) {
        Ok(manifest) => manifest,
        Err(message) => return record_error(EXT_ERR_INTERNAL, "manifest_invalid", message),
    };
    let result = write_owned_json(out, &manifest);
    if result == EXT_OK {
        result
    } else {
        record_error(
            result,
            "manifest_output_invalid",
            "manifest output buffer is invalid",
        )
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_take_error(out: *mut ExtOwnedBytes) -> ExtResultCode {
    LAST_ERROR.take_json(out)
}

/// D19 optional EventPort attach symbol (phase 1). Invoked exactly once after
/// `init` by an EventHub host with a PENDING, host-owned port. The extension
/// stores the immutable port value in the per-instance state owned by exactly
/// the `instance` the host addressed (B1: a second mount/reload attaches its
/// own instance state and never retargets another generation's producers;
/// producer handles read the state they captured at creation, never a
/// process-wide latest port) and returns EXT_OK. A legacy host never probes
/// this symbol and the extension keeps its declared legacy response-flush
/// fallback. A malformed port (or instance) is a structured rejection, never
/// a silent downgrade.
#[no_mangle]
pub unsafe extern "C" fn opentray_ext_attach_event_port_v1(
    instance: *mut c_void,
    port: ExtEventPortV1,
) -> ExtResultCode {
    clear_error();
    if instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "event port attach requires an initialized instance",
        );
    }
    match unsafe { crate::attach_event_port_to_instance(instance, port) } {
        Ok(()) => EXT_OK,
        Err(message) => record_error(EXT_ERR_REJECTED, "event_port_abi_incompatible", message),
    }
}
