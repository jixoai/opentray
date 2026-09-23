//! comctl32 v6 capability probe (add-ext-dialog design sections 5.3 and 7,
//! task 3.3b).
//!
//! The probe is activation-context-real and window-free: `LoadLibraryW`
//! under the process-default activation context resolves the
//! `Microsoft.Windows.Common-Controls` side-by-side dependency declared by
//! the broker EXE's RT_MANIFEST (task 3.3b), and comctl32 **v5 does not
//! export `TaskDialogIndirect`** — the export's presence after that load is
//! the honest discriminator between a v6 and a v5 resolution. No dialog is
//! ever shown by the probe, and no fallback activation context is created:
//! the capability is bound to the host process's manifest by design.
//!
//! The result feeds the `DialogBackendCapabilities` DTO (`taskDialog`,
//! `commandLinks`, `expander`) and gates the MessageBox fallback: with the
//! TaskDialog surface unavailable, `commandLink`/`expander` requests reject
//! as typed `dialog_capability_unavailable` instead of silently
//! downgrading.
//!
//! Probe runs exactly once per process (`OnceLock`); the loaded module is
//! intentionally never freed so a racing show path always reaches live
//! code.

use std::ffi::c_void;
use std::sync::OnceLock;

use windows_sys::Win32::Foundation::HMODULE;
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows_sys::Win32::UI::Controls::{
    ICC_STANDARD_CLASSES, ICC_WIN95_CLASSES, INITCOMMONCONTROLSEX, InitCommonControlsEx,
};

use super::ffi::TaskDialogIndirectFn;

/// `GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS` without
/// `UNCHANGED_REFCOUNT`: resolves the module owning an address AND
/// increments its reference count.
const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: u32 = 0x0000_0004;

/// One comctl32 v6 resolution: the loaded module and the
/// `TaskDialogIndirect` entry point.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TaskDialogSurface {
    entry: TaskDialogIndirectFn,
}

impl TaskDialogSurface {
    /// Calls `TaskDialogIndirect`.
    ///
    /// # Safety
    ///
    /// `config` must stay valid (all pointed-to strings and button arrays
    /// alive) for the duration of the call, exactly like the raw Win32 API.
    pub(crate) unsafe fn indirect(
        &self,
        config: *const super::ffi::TaskDialogConfig,
        pn_button: *mut i32,
        pn_radio_button: *mut i32,
        pf_verification_flag_checked: *mut i32,
    ) -> i32 {
        unsafe { (self.entry)(config, pn_button, pn_radio_button, pf_verification_flag_checked) }
    }
}

/// Probes the comctl32 v6 surface once per process.
pub(crate) fn probe_task_dialog_surface() -> Option<TaskDialogSurface> {
    static SURFACE: OnceLock<Option<TaskDialogSurface>> = OnceLock::new();
    *SURFACE.get_or_init(probe_once)
}

fn probe_once() -> Option<TaskDialogSurface> {
    // Null-terminated UTF-16 "comctl32.dll".
    let module_name: Vec<u16> = "comctl32.dll"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: LoadLibraryW with a valid null-terminated UTF-16 name. The
    // process-default activation context (broker RT_MANIFEST) governs the
    // side-by-side resolution. The handle is intentionally leaked: the
    // capability is process-lifetime and a racing show path must never
    // observe a freed comctl32.
    let module: HMODULE = unsafe { LoadLibraryW(module_name.as_ptr()) };
    if module.is_null() {
        return None;
    }
    // SAFETY: the module handle comes from a successful LoadLibraryW and
    // the symbol name is a static null-terminated C string.
    let raw = unsafe { GetProcAddress(module, c"TaskDialogIndirect".as_ptr().cast()) };
    // windows-sys types FARPROC as Option<unsafe extern "system" fn() -> isize>.
    let untyped = match raw {
        Some(untyped) => untyped,
        None => return None,
    };
    // SAFETY: TaskDialogIndirect has exactly this frozen Win32 signature;
    // the transmute only reinterprets the untyped fn pointer.
    let entry: TaskDialogIndirectFn = unsafe { std::mem::transmute::<
        unsafe extern "system" fn() -> isize,
        TaskDialogIndirectFn,
    >(untyped) };
    // A v6 resolution still cannot present anything until the common
    // controls are initialized once for the process: without an
    // InitCommonControlsEx call the v6 TaskDialogIndirect fails with
    // E_INVALIDARG before creating anything (real-machine Windows
    // evidence 2026-09-22: every broker message dialog failed with
    // 0x80070057 even with a valid manifest and a valid config). The init
    // shares the probe's once-per-process, never-undone semantics.
    let icc = INITCOMMONCONTROLSEX {
        dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
        dwICC: ICC_STANDARD_CLASSES | ICC_WIN95_CLASSES,
    };
    // SAFETY: the struct is a stack value matching the frozen Win32 type.
    if unsafe { InitCommonControlsEx(&icc) } == 0 {
        return None;
    }
    Some(TaskDialogSurface { entry })
}

/// Pins this extension DLL in the loader (increments its reference count)
/// so a later `FreeLibrary` from the host cannot unmap code that a worker
/// thread may still be executing — the "keep references until natural
/// exit" ending of the frozen unload-race ruling (design section 5.3,
/// R4 P0-3). The pin is intentionally never undone: a deinit that reached
/// this path already leaked its workers by decision, and the process exit
/// is the natural cleanup.
///
/// Returns the owning module handle for diagnostics, or `None` when the
/// resolver failed (in which case the caller escalates to the abort-the-
/// cleanup ending).
pub(crate) fn pin_self_module() -> Option<*mut c_void> {
    let mut module: HMODULE = std::ptr::null_mut();
    // Any function address owned by this DLL identifies the module.
    let address = (probe_task_dialog_surface as *const ()).cast::<u16>();
    // SAFETY: GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS interprets the name
    // parameter as an address inside the module to resolve; the out
    // pointer is a valid HMODULE slot.
    let succeeded =
        unsafe { pin_self_module_impl(address, &mut module) };
    if succeeded != 0 && !module.is_null() {
        Some(module)
    } else {
        None
    }
}

// Isolated for a testable seam: the raw GetModuleHandleExW call.
unsafe fn pin_self_module_impl(address: *const u16, module: &mut HMODULE) -> i32 {
    unsafe {
        windows_sys::Win32::System::LibraryLoader::GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
            address,
            module as *mut HMODULE,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_pin_flag_combination_increments_the_reference_count() {
        // FROM_ADDRESS without UNCHANGED_REFCOUNT (0x2) is the
        // reference-incrementing resolution.
        assert_eq!(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, 0x4);
        assert_eq!(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS & 0x2, 0);
    }

    #[test]
    fn probe_is_cached_and_reports_the_honest_surface() {
        // On a Windows test host the process may or may not carry the
        // comctl6 manifest (cargo test binaries do not), so the only
        // universal assertion is: the probe is stable across calls and
        // never panics.
        let first = probe_task_dialog_surface().is_some();
        let second = probe_task_dialog_surface().is_some();
        assert_eq!(first, second, "OnceLock caches the single probe");
    }
}
