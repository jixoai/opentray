//! Resolves the facade identity files for the embedded extension manifest.
//!
//! The manifest needs `packages/ext-clipboard/package.json` (artifact-set
//! version) and `packages/ext-clipboard/contract.json` (extension name +
//! contract fingerprint). Mirroring the ext-sound build step: prefer the
//! real files when they exist and otherwise stage the design-frozen
//! fallback values (design section 3: workspace version `0.0.0`,
//! extensionName `clipboard`, fingerprint
//! `opentray-ext-clipboard-contract-1`). `rerun-if-changed` upgrades the
//! instant the real files change, and
//! `build_embedded_extension_manifest` still validates whatever bytes are
//! staged — a mismatched contract name is a loud manifest failure, never a
//! silent identity drift.

use std::env;
use std::fs;
use std::path::PathBuf;

const FALLBACK_PACKAGE_JSON: &str =
    "{ \"name\": \"@opentray/ext-clipboard\", \"version\": \"0.0.0\" }\n";
const FALLBACK_CONTRACT_JSON: &str =
    "{ \"extensionName\": \"clipboard\", \"contractFingerprint\": \"opentray-ext-clipboard-contract-1\" }\n";

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|parent| parent.parent())
        .expect("crates/opentray-ext-clipboard sits two levels under the workspace root")
        .to_path_buf();

    let package_path = workspace_root.join("packages/ext-clipboard/package.json");
    let contract_path = workspace_root.join("packages/ext-clipboard/contract.json");
    // Watching a not-yet-existing path is fine: creating it triggers the
    // rerun and the real bytes take over.
    println!("cargo:rerun-if-changed={}", package_path.display());
    println!("cargo:rerun-if-changed={}", contract_path.display());

    let package = fs::read_to_string(&package_path).unwrap_or_else(|error| {
        eprintln!(
            "opentray-ext-clipboard: facade package manifest not staged yet ({error}); \
             using the design-frozen fallback identity"
        );
        FALLBACK_PACKAGE_JSON.to_string()
    });
    let contract = fs::read_to_string(&contract_path).unwrap_or_else(|error| {
        eprintln!(
            "opentray-ext-clipboard: facade contract manifest not staged yet ({error}); \
             using the design-frozen fallback identity"
        );
        FALLBACK_CONTRACT_JSON.to_string()
    });

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("out dir"));
    fs::write(out_dir.join("ext_clipboard_facade_package.json"), package)
        .expect("stage facade package manifest bytes");
    fs::write(out_dir.join("ext_clipboard_contract.json"), contract)
        .expect("stage contract manifest bytes");
}
