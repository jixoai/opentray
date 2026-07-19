// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Load one same-target OpenTray extension artifact.
// 2. Read and release its embedded manifest through the stable C ABI.
// 3. Emit machine-readable JSON for release verification.

use std::env;
use std::ffi::c_char;
use std::path::Path;

use libloading::{Library, Symbol};
use opentray_spec::{
    EmbeddedExtensionManifest, ExtOwnedBytes, ExtResultCode, EXT_OK, EXT_SYMBOL_FREE_STRING,
    EXT_SYMBOL_MANIFEST,
};

type ExtManifestFn = unsafe extern "C" fn(*mut ExtOwnedBytes) -> ExtResultCode;
type ExtFreeStringFn = unsafe extern "C" fn(*mut c_char, usize);

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args_os();
    let executable = args
        .next()
        .and_then(|value| Path::new(&value).file_name().map(|name| name.to_owned()))
        .unwrap_or_else(|| "opentray-extension-inspector".into());
    let library_path = args.next().ok_or_else(|| {
        format!(
            "usage: {} <extension-library>",
            executable.to_string_lossy()
        )
    })?;
    if args.next().is_some() {
        return Err(format!(
            "usage: {} <extension-library>",
            executable.to_string_lossy()
        ));
    }

    let manifest = unsafe { inspect(Path::new(&library_path)) }?;
    println!(
        "{}",
        serde_json::to_string(&manifest)
            .map_err(|error| format!("failed to serialize extension manifest: {error}"))?
    );
    Ok(())
}

unsafe fn inspect(path: &Path) -> Result<EmbeddedExtensionManifest, String> {
    let library = unsafe { Library::new(path) }.map_err(|error| {
        format!(
            "failed to load extension library {}: {error}",
            path.display()
        )
    })?;
    let manifest = unsafe { load_symbol::<ExtManifestFn>(&library, EXT_SYMBOL_MANIFEST) }?;
    let free_string = unsafe { load_symbol::<ExtFreeStringFn>(&library, EXT_SYMBOL_FREE_STRING) }?;
    let mut output = ExtOwnedBytes {
        ptr: std::ptr::null_mut(),
        len: 0,
    };
    let result = unsafe { manifest(&mut output) };
    if result != EXT_OK {
        return Err(format!("extension manifest returned code {result}"));
    }
    if output.ptr.is_null() || output.len == 0 {
        return Err("extension manifest returned an empty buffer".to_string());
    }

    let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) }.to_vec();
    unsafe { free_string(output.ptr, output.len) };
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("extension returned an invalid embedded manifest: {error}"))
}

unsafe fn load_symbol<'library, T>(
    library: &'library Library,
    symbol: &str,
) -> Result<Symbol<'library, T>, String> {
    let symbol_name = format!("{symbol}\0");
    unsafe { library.get::<T>(symbol_name.as_bytes()) }
        .map_err(|error| format!("extension is missing required symbol {symbol}: {error}"))
}
