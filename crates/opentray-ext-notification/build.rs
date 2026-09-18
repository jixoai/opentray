//! Resolves the facade identity files for the embedded extension manifest.
//!
//! The manifest needs `packages/ext-notification/package.json`
//! (artifact-set version) and `packages/ext-notification/contract.json`
//! (extension name + contract fingerprint). That facade package is staged
//! by the concurrent facade batch (add-ext-notification tasks 4.x), so
//! this build step prefers the real files when they exist and otherwise
//! stages the design-frozen fallback values (design section 3: workspace
//! version `0.0.0`, extensionName `notification`, fingerprint
//! `opentray-ext-notification-contract-1`). The fallback is
//! byte-equivalent to the workspace-staged values, `rerun-if-changed`
//! upgrades the instant the real files land, and
//! `build_embedded_extension_manifest` still validates whatever bytes are
//! staged — a mismatched contract name is a loud manifest failure, never a
//! silent identity drift.

use std::env;
use std::fs;
use std::path::PathBuf;

const FALLBACK_PACKAGE_JSON: &str =
    "{ \"name\": \"@opentray/ext-notification\", \"version\": \"0.0.0\" }\n";
const FALLBACK_CONTRACT_JSON: &str =
    "{ \"extensionName\": \"notification\", \"contractFingerprint\": \"opentray-ext-notification-contract-1\" }\n";

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|parent| parent.parent())
        .expect("crates/opentray-ext-notification sits two levels under the workspace root")
        .to_path_buf();

    let package_path = workspace_root.join("packages/ext-notification/package.json");
    let contract_path = workspace_root.join("packages/ext-notification/contract.json");
    // Watching a not-yet-existing path is fine: creating it triggers the
    // rerun and the real bytes take over.
    println!("cargo:rerun-if-changed={}", package_path.display());
    println!("cargo:rerun-if-changed={}", contract_path.display());

    let package = fs::read_to_string(&package_path).unwrap_or_else(|error| {
        eprintln!(
            "opentray-ext-notification: facade package manifest not staged yet ({error}); \
             using the design-frozen fallback identity"
        );
        FALLBACK_PACKAGE_JSON.to_string()
    });
    let contract = fs::read_to_string(&contract_path).unwrap_or_else(|error| {
        eprintln!(
            "opentray-ext-notification: facade contract manifest not staged yet ({error}); \
             using the design-frozen fallback identity"
        );
        FALLBACK_CONTRACT_JSON.to_string()
    });

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("out dir"));
    fs::write(
        out_dir.join("ext_notification_facade_package.json"),
        package,
    )
    .expect("stage facade package manifest bytes");
    fs::write(out_dir.join("ext_notification_contract.json"), contract)
        .expect("stage facade contract manifest bytes");
}
