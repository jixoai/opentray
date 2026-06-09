use std::ffi::{CStr, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_core::PCWSTR;
use windows_sys::Win32::Foundation::{HMODULE, HWND};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

use super::appwindow_abi::{WindowsAppWindow, WindowsWindowId};
use crate::WebviewRuntimeError;

static WINDOWS_APP_RUNTIME_BOOTSTRAPPED: AtomicBool = AtomicBool::new(false);

pub(super) fn apply_windows_titlebar_overlay(
    hwnd: HWND,
    overlay_enabled: bool,
) -> Result<(), WebviewRuntimeError> {
    if !overlay_enabled {
        return Ok(());
    }
    let app_window = app_window_for_hwnd(hwnd)?;
    let titlebar = app_window.titlebar()?;
    titlebar.set_extends_content_into_titlebar(true)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct WindowsTitlebarMetrics {
    pub left_inset: f64,
    pub right_inset: f64,
    pub height: f64,
}

// AppWindow owns the compositor relationship for overlay controls. Its TitleBar insets are the
// official layout contract; use them before falling back to older Win32/DWM metrics.
pub(super) fn titlebar_metrics(hwnd: HWND) -> Result<WindowsTitlebarMetrics, WebviewRuntimeError> {
    let app_window = app_window_for_hwnd(hwnd)?;
    let titlebar = app_window.titlebar()?;
    Ok(WindowsTitlebarMetrics {
        left_inset: titlebar.left_inset()?.max(0) as f64,
        right_inset: titlebar.right_inset()?.max(0) as f64,
        height: titlebar.height()?.max(1) as f64,
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
    for candidate in bootstrap_candidates() {
        let module = unsafe { LoadLibraryW(wide_null(candidate.path.as_os_str()).as_ptr()) };
        if module.is_null() {
            if candidate.explicit {
                return Err(WebviewRuntimeError::Unsupported(format!(
                    "Windows App Runtime bootstrapper could not be loaded from {}: {}",
                    candidate.path.display(),
                    std::io::Error::last_os_error()
                )));
            }
            continue;
        }
        let proc = unsafe { GetProcAddress(module, c"MddBootstrapInitialize".as_ptr().cast()) };
        let Some(proc) = proc else {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "Windows App Runtime bootstrapper at {} does not export MddBootstrapInitialize",
                candidate.path.display()
            )));
        };
        type BootstrapInitialize = unsafe extern "system" fn(u32, PCWSTR, u64) -> i32;
        let bootstrap: BootstrapInitialize = unsafe { std::mem::transmute(proc) };
        let result = unsafe { bootstrap(0x0001_0008, PCWSTR::null(), 0) };
        if hresult_failed(result) {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "Windows App Runtime bootstrapper initialization failed: {}",
                format_hresult(result)
            )));
        }
        WINDOWS_APP_RUNTIME_BOOTSTRAPPED.store(true, Ordering::Release);
        return Ok(());
    }
    Ok(())
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
        let library = unsafe { LoadLibraryW(wide_null(candidate.as_os_str()).as_ptr()) };
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
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("OPENTRAY_WINDOWS_APP_RUNTIME_DIR") {
        let mut path = PathBuf::from(dir);
        path.push(library_name);
        push_path_candidate(&mut candidates, path);
    }
    if let Some(bootstrap_path) = std::env::var_os("OPENTRAY_WINDOWS_APP_RUNTIME_BOOTSTRAP_DLL") {
        if let Some(dir) = PathBuf::from(bootstrap_path).parent() {
            let mut path = dir.to_path_buf();
            path.push(library_name);
            push_path_candidate(&mut candidates, path);
        }
    }
    push_path_candidate(&mut candidates, PathBuf::from(library_name));
    candidates
}

fn push_path_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
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
