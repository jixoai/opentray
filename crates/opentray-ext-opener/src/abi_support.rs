//! Opener artifact identity and structured ABI error transport.
//!
//! Mirrors the dialog/sound crate support surface (add-ext-dialog /
//! add-ext-sound batch B) with the opener identity: extensionName
//! `opener`, contract fingerprint `opentray-ext-opener-contract-1`. The
//! facade identity files are staged by `build.rs` (real
//! `packages/ext-opener` bytes when the concurrent facade batch has
//! landed, the byte-equivalent design-frozen fallback otherwise).

use opentray_spec::{
    build_embedded_extension_manifest, write_owned_json, ExtOwnedBytes, ExtResultCode,
    ExtensionErrorSlot, EXT_ERR_INTERNAL, EXT_OK,
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

pub(crate) fn record_typed_error(
    result: ExtResultCode,
    error: &opentray_spec::TypedExtensionError,
) -> ExtResultCode {
    LAST_ERROR.fail_with_details(result, &error.code, &error.message, error.details.clone())
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_manifest(out: *mut ExtOwnedBytes) -> ExtResultCode {
    clear_error();
    let manifest = match build_embedded_extension_manifest(
        "opener",
        include_str!(concat!(env!("OUT_DIR"), "/ext_opener_facade_package.json")),
        include_str!(concat!(env!("OUT_DIR"), "/ext_opener_contract.json")),
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
