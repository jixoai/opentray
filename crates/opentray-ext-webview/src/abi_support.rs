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
/// copies the immutable port value into process-level storage any of its
/// producer threads can read (B'' transfer rule 1) and returns EXT_OK; a
/// legacy host never probes this symbol and the extension keeps its declared
/// legacy response-flush fallback. A malformed port is a structured
/// rejection, never a silent downgrade.
#[no_mangle]
pub unsafe extern "C" fn opentray_ext_attach_event_port_v1(
    _instance: *mut c_void,
    port: ExtEventPortV1,
) -> ExtResultCode {
    clear_error();
    match crate::event_port::attach_port(port) {
        Ok(()) => EXT_OK,
        Err(message) => record_error(EXT_ERR_REJECTED, "event_port_abi_incompatible", message),
    }
}
