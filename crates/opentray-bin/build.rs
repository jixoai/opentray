//! Windows resource wiring for the broker executable (add-ext-dialog task
//! 3.3b): embeds `resources/opentray.exe.manifest` as the EXE's RT_MANIFEST
//! so the process-default activation context resolves comctl32 v6 for
//! in-process TaskDialog use.
//!
//! Toolchain selection (no repository precedent existed for `.rc`
//! compilation): `winresource` is the actively maintained successor of the
//! unmaintained `winres` (same API family, 64-bit/ARM64-safe COFF writer)
//! and compiles resources with a pure-Rust object writer, so no external
//! resource compiler (`rc.exe` from the Windows SDK, or GNU `windres`) is
//! required on any build host — including cross builds and the LAN Windows
//! build machine. `embed-resource` would have required locating an external
//! `rc.exe`/`windres` on every Windows build host and turns a missing SDK
//! into a hard broker build failure; the pure-Rust writer keeps the
//! manifest a build-time constant instead.
//!
//! The manifest source of truth is the XML file under `resources/` (kept
//! diff-reviewable); this script only asks `winresource` to compile exactly
//! those bytes into RT_MANIFEST. Non-Windows targets build nothing so the
//! script stays a no-op on macOS/Linux development hosts.

fn main() {
    // Gate on the TARGET OS, not the host: cross builds and real-machine
    // Windows builds both take the resource path; local Mac/Linux cargo
    // invocations skip resource compilation entirely.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "windows" {
        return;
    }

    let manifest = std::path::Path::new("resources")
        .join("opentray.exe.manifest")
        .canonicalize()
        .expect("opentray-bin resources/opentray.exe.manifest must exist");

    let mut resource = winresource::WindowsResource::new();
    resource.set_manifest_file(manifest.to_str().expect("manifest path is UTF-8"));
    resource
        .compile()
        .expect("compile broker RT_MANIFEST resource");

    println!(
        "cargo:rerun-if-changed={}",
        manifest.display()
    );
}
