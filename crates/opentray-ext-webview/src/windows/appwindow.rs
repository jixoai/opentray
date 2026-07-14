// Orthogonal intents (2026-07-14; original user request: restore Windows overlay controls):
// 1. Discover a usable Windows App Runtime bootstrapper, including CBS installs.
// 2. Keep runtime implementation DLLs on the package graph selected by the bootstrapper.
// 3. Apply AppWindow titlebar overlay colors and read safe-area insets synchronously on the HWND-owning STA.

use std::ffi::{CStr, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use windows_core::PCWSTR;
use windows_sys::Win32::Foundation::{HMODULE, HWND};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

use super::appwindow_abi::{WindowsAppWindow, WindowsWindowId};
use crate::{WebviewRuntimeError, WebviewWindowControlsOverlaySettings};

static WINDOWS_APP_RUNTIME_BOOTSTRAPPED: AtomicBool = AtomicBool::new(false);

struct WinrtApartmentGuard;

impl Drop for WinrtApartmentGuard {
    fn drop(&mut self) {
        unsafe { windows::Win32::System::WinRT::RoUninitialize() };
    }
}

pub(super) fn apply_windows_titlebar_overlay(
    hwnd: HWND,
    overlay: WebviewWindowControlsOverlaySettings,
) -> Result<(), WebviewRuntimeError> {
    if !overlay.enabled {
        return Ok(());
    }
    let _apartment = enter_current_thread_sta()?;
    let app_window = app_window_for_hwnd(hwnd)?;
    let titlebar = app_window.titlebar()?;
    titlebar.set_extends_content_into_titlebar(true)?;
    if let Some(color) = overlay.button_background_color {
        titlebar.set_button_background_color(color)?;
    }
    if let Some(color) = overlay.button_symbol_color {
        titlebar.set_button_foreground_color(color)?;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct WindowsTitlebarMetrics {
    pub left_inset: f64,
    pub right_inset: f64,
    pub height: f64,
}

pub(super) fn titlebar_metrics(hwnd: HWND) -> Result<WindowsTitlebarMetrics, WebviewRuntimeError> {
    let _apartment = enter_current_thread_sta()?;
    let app_window = app_window_for_hwnd(hwnd)?;
    let titlebar = app_window.titlebar()?;
    Ok(WindowsTitlebarMetrics {
        left_inset: titlebar.left_inset()?.max(0) as f64,
        right_inset: titlebar.right_inset()?.max(0) as f64,
        height: titlebar.height()?.max(1) as f64,
    })
}

fn enter_current_thread_sta() -> Result<WinrtApartmentGuard, WebviewRuntimeError> {
    unsafe {
        windows::Win32::System::WinRT::RoInitialize(
            windows::Win32::System::WinRT::RO_INIT_SINGLETHREADED,
        )
    }
    .map(|()| WinrtApartmentGuard)
    .map_err(|error| {
        WebviewRuntimeError::Internal(format!("WinRT STA initialization failed: {error}"))
    })
}

fn app_window_for_hwnd(hwnd: HWND) -> Result<WindowsAppWindow, WebviewRuntimeError> {
    ensure_windows_app_runtime_available()?;
    let mut window_id = WindowsWindowId::default();
    type GetWindowIdFromWindow =
        unsafe extern "system" fn(*mut core::ffi::c_void, *mut WindowsWindowId) -> i32;
    let get_window_id: GetWindowIdFromWindow = unsafe {
        std::mem::transmute(load_windows_app_runtime_symbol(
            "Microsoft.Internal.FrameworkUdk.dll",
            c"Windowing_GetWindowIdFromWindow",
        )?)
    };
    let result = unsafe { get_window_id(hwnd.cast(), &mut window_id) };
    if hresult_failed(result) {
        return Err(WebviewRuntimeError::Unsupported(format!(
            "Windows AppWindow id could not be resolved: {}",
            format_hresult(result)
        )));
    }
    WindowsAppWindow::get_from_window_id(window_id)
}

fn ensure_windows_app_runtime_available() -> Result<(), WebviewRuntimeError> {
    // Windows WebView2 is a child HWND/DComp surface. Raw non-client area extension can put
    // web content into the titlebar rectangle, but cannot reliably keep native caption controls
    // above that child surface. AppWindow owns that compositor relationship on Windows App SDK.
    //
    // Keep the substrate dynamically loaded: a static FrameworkUdk import makes the extension DLL
    // fail to load before it can return a typed unsupported error.
    if WINDOWS_APP_RUNTIME_BOOTSTRAPPED.load(Ordering::Acquire) {
        return Ok(());
    }
    let mut last_failure = None;
    for candidate in bootstrap_candidates() {
        let module = load_library(&candidate.path);
        if module.is_null() {
            if candidate.explicit {
                return Err(WebviewRuntimeError::Unsupported(format!(
                    "Windows App Runtime bootstrapper could not be loaded from {}: {}",
                    candidate.path.display(),
                    std::io::Error::last_os_error()
                )));
            }
            last_failure = Some(format!(
                "{} could not be loaded: {}",
                candidate.path.display(),
                std::io::Error::last_os_error()
            ));
            continue;
        }
        let proc = unsafe { GetProcAddress(module, c"MddBootstrapInitialize".as_ptr().cast()) };
        let Some(proc) = proc else {
            let failure = format!(
                "Windows App Runtime bootstrapper at {} does not export MddBootstrapInitialize",
                candidate.path.display()
            );
            if candidate.explicit {
                return Err(WebviewRuntimeError::Unsupported(failure));
            }
            last_failure = Some(failure);
            continue;
        };
        type BootstrapInitialize = unsafe extern "system" fn(u32, PCWSTR, u64) -> i32;
        let bootstrap: BootstrapInitialize = unsafe { std::mem::transmute(proc) };
        let result = unsafe { bootstrap(0x0001_0008, PCWSTR::null(), 0) };
        if hresult_failed(result) {
            let failure = format!(
                "Windows App Runtime bootstrapper at {} failed initialization: {}",
                candidate.path.display(),
                format_hresult(result)
            );
            if candidate.explicit {
                return Err(WebviewRuntimeError::Unsupported(failure));
            }
            last_failure = Some(failure);
            continue;
        }
        WINDOWS_APP_RUNTIME_BOOTSTRAPPED.store(true, Ordering::Release);
        return Ok(());
    }
    Err(WebviewRuntimeError::Unsupported(
        last_failure.unwrap_or_else(|| "Windows App Runtime bootstrapper was not found".into()),
    ))
}

#[derive(Debug)]
struct BootstrapCandidate {
    path: PathBuf,
    explicit: bool,
}

fn bootstrap_candidates() -> Vec<BootstrapCandidate> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OPENTRAY_WINDOWS_APP_RUNTIME_BOOTSTRAP_DLL") {
        push_bootstrap_candidate(&mut candidates, PathBuf::from(path), true);
    }
    if let Some(dir) = std::env::var_os("OPENTRAY_WINDOWS_APP_RUNTIME_DIR") {
        let mut path = PathBuf::from(dir);
        path.push("Microsoft.WindowsAppRuntime.Bootstrap.dll");
        push_bootstrap_candidate(&mut candidates, path, false);
    }
    // CBS-installed runtimes keep the bootstrapper under
    // `%SystemRoot%\SystemApps\Microsoft.WindowsAppRuntime.*CBS_*\`, which is not on the default
    // DLL search path. Probe those dirs before falling back to the bare filename.
    for dir in windows_app_runtime_cbs_dirs("Microsoft.WindowsAppRuntime.Bootstrap.dll") {
        let mut path = dir;
        path.push("Microsoft.WindowsAppRuntime.Bootstrap.dll");
        push_bootstrap_candidate(&mut candidates, path, false);
    }
    push_bootstrap_candidate(
        &mut candidates,
        PathBuf::from("Microsoft.WindowsAppRuntime.Bootstrap.dll"),
        false,
    );
    candidates
}

fn push_bootstrap_candidate(
    candidates: &mut Vec<BootstrapCandidate>,
    path: PathBuf,
    explicit: bool,
) {
    if candidates.iter().any(|candidate| candidate.path == path) {
        return;
    }
    candidates.push(BootstrapCandidate { path, explicit });
}

fn load_windows_app_runtime_symbol(
    library_name: &str,
    symbol_name: &'static CStr,
) -> Result<unsafe extern "system" fn() -> isize, WebviewRuntimeError> {
    let library = load_windows_app_runtime_library(library_name)?;
    let proc = unsafe { GetProcAddress(library, symbol_name.as_ptr().cast()) };
    proc.ok_or_else(|| {
        WebviewRuntimeError::Unsupported(format!(
            "{library_name} does not export {}",
            symbol_name.to_string_lossy()
        ))
    })
}

fn load_windows_app_runtime_library(library_name: &str) -> Result<HMODULE, WebviewRuntimeError> {
    let candidates = windows_app_runtime_library_candidates(library_name);
    for candidate in &candidates {
        let library = load_library(candidate);
        if !library.is_null() {
            return Ok(library);
        }
    }
    Err(WebviewRuntimeError::Unsupported(format!(
        "{library_name} could not be loaded: {}",
        std::io::Error::last_os_error()
    )))
}

fn windows_app_runtime_library_candidates(library_name: &str) -> Vec<PathBuf> {
    windows_app_runtime_library_candidates_with_dir(
        library_name,
        std::env::var_os("OPENTRAY_WINDOWS_APP_RUNTIME_DIR").map(PathBuf::from),
    )
}

fn windows_app_runtime_library_candidates_with_dir(
    library_name: &str,
    runtime_dir: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(mut path) = runtime_dir {
        path.push(library_name);
        push_path_candidate(&mut candidates, path);
    }
    // MddBootstrapInitialize adds the selected runtime package to the process package graph.
    // Resolve runtime DLLs through that graph so FrameworkUdk and Windowing.Core come from the
    // same package version. A bootstrapper's own directory is not a runtime identity: CBS may
    // ship a bootstrapper beside FrameworkUdk builds that differ from the selected Store package.
    push_path_candidate(&mut candidates, PathBuf::from(library_name));
    candidates
}

fn push_path_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

/// Load explicit bootstrapper paths and package-graph runtime names through the same Win32 API.
fn load_library(path: &Path) -> HMODULE {
    let wide = wide_null(path.as_os_str());
    unsafe { LoadLibraryW(wide.as_ptr()) }
}

/// Discover CBS-installed Windows App Runtime directories under
/// `%SystemRoot%\SystemApps\` that actually contain `dll_name`. This discovery is
/// only for the bootstrapper; runtime DLLs must resolve through the package graph
/// selected by `MddBootstrapInitialize`.
fn windows_app_runtime_cbs_dirs(dll_name: &str) -> Vec<PathBuf> {
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let system_apps = PathBuf::from(&system_root).join("SystemApps");
    let entries = match std::fs::read_dir(&system_apps) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut preferred = Vec::new();
    let mut rest = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if !is_windows_app_runtime_cbs_dir(name) {
            continue;
        }
        let dir = entry.path();
        if !dir.join(dll_name).exists() {
            continue;
        }
        // Prefer complete CBS entries when multiple bootstrapper locations exist.
        if dir
            .join("Microsoft.WindowsAppRuntime.Bootstrap.dll")
            .exists()
        {
            preferred.push(dir);
        } else {
            rest.push(dir);
        }
    }
    preferred.sort_by(|left, right| right.cmp(left));
    rest.sort_by(|left, right| right.cmp(left));
    preferred.extend(rest);
    preferred
}

/// Match the CBS package directory naming pattern. Accepts both
/// `Microsoft.WindowsAppRuntime.CBS_8wekyb3d8bbwe` and
/// `Microsoft.WindowsAppRuntime.vNext.CBS_8wekyb3d8bbwe`, while rejecting unrelated
/// `Microsoft.WindowsAppRuntime.*` entries and non-CBS dirs.
fn is_windows_app_runtime_cbs_dir(name: &str) -> bool {
    name.starts_with("Microsoft.WindowsAppRuntime")
        && name.contains("CBS_")
        && name.ends_with("_8wekyb3d8bbwe")
}

fn hresult_failed(result: i32) -> bool {
    result < 0
}

fn format_hresult(result: i32) -> String {
    format!("0x{:08X}", result as u32)
}

fn wide_null(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{is_windows_app_runtime_cbs_dir, windows_app_runtime_library_candidates_with_dir};

    #[test]
    fn cbs_dir_pattern_matches_stable_and_vnext() {
        assert!(is_windows_app_runtime_cbs_dir(
            "Microsoft.WindowsAppRuntime.CBS_8wekyb3d8bbwe"
        ));
        assert!(is_windows_app_runtime_cbs_dir(
            "Microsoft.WindowsAppRuntime.vNext.CBS_8wekyb3d8bbwe"
        ));
    }

    #[test]
    fn cbs_dir_pattern_rejects_unrelated_dirs() {
        assert!(!is_windows_app_runtime_cbs_dir(
            "Microsoft.WindowsAppRuntime.CBS_8wekyb3d8bbwe_something"
        ));
        assert!(!is_windows_app_runtime_cbs_dir(
            "Microsoft.WindowsAppRuntime.1.8_8wekyb3d8bbwe"
        ));
        assert!(!is_windows_app_runtime_cbs_dir(
            "Microsoft.Edge_8wekyb3d8bbwe"
        ));
        assert!(!is_windows_app_runtime_cbs_dir(
            "Microsoft.WindowsAppRuntime.CBS_otherpublisher"
        ));
        assert!(!is_windows_app_runtime_cbs_dir(""));
    }

    #[test]
    fn runtime_dlls_default_to_the_bootstrapped_package_graph() {
        assert_eq!(
            windows_app_runtime_library_candidates_with_dir(
                "Microsoft.Internal.FrameworkUdk.dll",
                None,
            ),
            vec![PathBuf::from("Microsoft.Internal.FrameworkUdk.dll")]
        );
    }

    #[test]
    fn explicit_runtime_dir_precedes_the_package_graph_fallback() {
        let runtime_dir = PathBuf::from(r"C:\runtime");
        assert_eq!(
            windows_app_runtime_library_candidates_with_dir(
                "Microsoft.Internal.FrameworkUdk.dll",
                Some(runtime_dir.clone()),
            ),
            vec![
                runtime_dir.join("Microsoft.Internal.FrameworkUdk.dll"),
                PathBuf::from("Microsoft.Internal.FrameworkUdk.dll"),
            ]
        );
    }
}
