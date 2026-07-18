//! Generic producer-side support for the dynamic extension C ABI.
//!
//! Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
//! 1. Build embedded manifests from facade-owned package and contract files.
//! 2. Own structured last-error storage without extension-specific semantics.
//! 3. Serialize extension-owned JSON buffers with explicit ownership.

use std::ffi::CString;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::{
    EmbeddedExtensionManifest, ExtOwnedBytes, ExtResultCode, ExtensionArtifactTarget,
    ExtensionErrorDetail, EXT_ABI_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_OK,
};

/// Stores the most recent synchronous ABI failure for one extension library.
pub struct ExtensionErrorSlot {
    detail: Mutex<Option<ExtensionErrorDetail>>,
}

impl ExtensionErrorSlot {
    /// Creates an empty error slot suitable for static extension storage.
    pub const fn new() -> Self {
        Self {
            detail: Mutex::new(None),
        }
    }

    /// Clears stale error state before one exported ABI operation.
    pub fn clear(&self) {
        *self
            .detail
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }

    /// Records an actionable category/message and returns the supplied ABI result code.
    pub fn fail(
        &self,
        result: ExtResultCode,
        category: impl Into<String>,
        message: impl Into<String>,
    ) -> ExtResultCode {
        *self
            .detail
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(ExtensionErrorDetail {
            category: category.into(),
            message: message.into(),
        });
        result
    }

    /// Moves the current error into an extension-owned JSON buffer.
    pub fn take_json(&self, out: *mut ExtOwnedBytes) -> ExtResultCode {
        let detail = self
            .detail
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        match detail {
            Some(detail) => write_owned_json(out, &detail),
            None => EXT_ERR_REJECTED,
        }
    }
}

impl Default for ExtensionErrorSlot {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
struct FacadePackageManifest {
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractManifest {
    extension_name: String,
    contract_fingerprint: String,
}

/// Builds the generic embedded identity from facade-owned canonical files.
pub fn build_embedded_extension_manifest(
    expected_extension_name: &str,
    facade_package_json: &str,
    contract_manifest_json: &str,
    build_identity: &str,
) -> Result<EmbeddedExtensionManifest, String> {
    let facade = serde_json::from_str::<FacadePackageManifest>(facade_package_json)
        .map_err(|error| format!("invalid facade package manifest: {error}"))?;
    let contract = serde_json::from_str::<ContractManifest>(contract_manifest_json)
        .map_err(|error| format!("invalid extension contract manifest: {error}"))?;
    if contract.extension_name != expected_extension_name {
        return Err(format!(
            "contract extension {} does not match {expected_extension_name}",
            contract.extension_name
        ));
    }
    if build_identity.is_empty() {
        return Err("build identity must not be empty".to_string());
    }
    Ok(EmbeddedExtensionManifest {
        extension_name: contract.extension_name,
        abi_version: EXT_ABI_VERSION,
        artifact_set_version: facade.version,
        contract_fingerprint: contract.contract_fingerprint,
        target: current_extension_target(),
        build_identity: build_identity.to_string(),
    })
}

/// Serializes a value into an extension-owned C buffer.
pub fn write_owned_json<T: Serialize>(out: *mut ExtOwnedBytes, value: &T) -> ExtResultCode {
    if out.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Ok(json) = serde_json::to_vec(value) else {
        return EXT_ERR_INTERNAL;
    };
    let Ok(value) = CString::new(json) else {
        return EXT_ERR_INTERNAL;
    };
    let len = value.as_bytes().len();
    unsafe {
        *out = ExtOwnedBytes {
            ptr: value.into_raw(),
            len,
        };
    }
    EXT_OK
}

fn current_extension_target() -> ExtensionArtifactTarget {
    ExtensionArtifactTarget {
        os: if cfg!(target_os = "windows") {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        }
        .to_string(),
        arch: if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        }
        .to_string(),
    }
}
