//! Win32 ABI layer for the dialog extension's Windows projection.
//!
//! Two deliberate decisions keep this layer honest:
//!
//! 1. **TaskDialogIndirect is NEVER a static import.** The extension DLL
//!    must stay loadable in hosts without the comctl32 v6 activation
//!    context (for example the release-grade native inspector, or a
//!    manifest-less host). A static import of `TaskDialogIndirect` would
//!    fail process/dll load against comctl32 v5, which does not export it.
//!    The function pointer is therefore resolved at runtime through
//!    `GetProcAddress` after a `LoadLibraryW("comctl32.dll")` that runs
//!    under the process-default activation context; the manifest-declared
//!    side-by-side dependency (broker RT_MANIFEST, task 3.3b) is exactly
//!    what makes that load resolve v6.
//!
//! 2. **The TASKDIALOGCONFIG family is declared here, not pulled from
//!    windows-sys.** Only the types are needed (no linkage), and owning the
//!    `#[repr(C)]` declaration keeps the exact frozen layout visible in one
//!    place with layout assertions in tests, mirroring how the ABI fixture
//!    in `opentray-bin` freezes the extension C ABI.

use std::ffi::c_void;

use windows_sys::core::{PCWSTR, PWSTR};
use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};

pub(crate) type HRESULT = i32;
pub(crate) type BOOL = i32;

pub(crate) const S_OK: HRESULT = 0;
/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the IFileDialog dismissal code.
pub(crate) const HRESULT_ERROR_CANCELLED: HRESULT = 0x8007_04C7_u32 as i32;

// ---------------------------------------------------------------------------
// TaskDialog ABI (frozen Win32 layout; comctl32 v6)
// ---------------------------------------------------------------------------

/// `TASKDIALOG_BUTTON`. For command links the text may contain a `\n`
/// separating the bold heading from the note line.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct TaskDialogButton {
    pub(crate) n_button_id: i32,
    pub(crate) psz_button_text: PCWSTR,
}

/// The TaskDialog notification callback
/// (`PFTASKDIALOGCALLBACK`). Returns S_OK to continue.
pub(crate) type TaskDialogCallback = unsafe extern "system" fn(
    hwnd: HWND,
    notification: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    ref_data: isize,
) -> HRESULT;

/// `TASKDIALOGCONFIG` (frozen layout, exact `commctrl.h` field order:
/// cbSize, hwndParent, hInstance, dwFlags, pszWindowTitle, main-icon union,
/// pszMainInstruction, pszContent, buttons, radio buttons,
/// pszVerificationText, pszExpandedInformation, pszExpandedControlText,
/// pszCollapsedControlText, footer-icon union, pszFooter, pfCallback,
/// lpCallbackData, cxWidth). The two C unions are single `PCWSTR` slots
/// here: the icon forms are `MAKEINTRESOURCEW` sentinels, which is exactly
/// the pointer encoding the union's `pszMainIcon` arm uses; no HICON path
/// exists in this extension.
#[repr(C)]
pub(crate) struct TaskDialogConfig {
    pub(crate) cb_size: u32,
    pub(crate) hwnd_parent: HWND,
    pub(crate) h_instance: HINSTANCE,
    pub(crate) dw_flags: u32,
    pub(crate) psz_window_title: PCWSTR,
    /// Union slot: `MAKEINTRESOURCEW` icon sentinel or a null pointer.
    pub(crate) main_icon: PCWSTR,
    /// The big heading line; carries the dialog `message`.
    pub(crate) psz_main_instruction: PCWSTR,
    /// The body; carries the dialog `detail`.
    pub(crate) psz_content: PCWSTR,
    pub(crate) c_buttons: u32,
    pub(crate) p_buttons: *const TaskDialogButton,
    pub(crate) n_default_button: i32,
    pub(crate) c_radio_buttons: u32,
    pub(crate) p_radio_buttons: *const TaskDialogButton,
    pub(crate) n_default_radio_button: i32,
    pub(crate) psz_verification_text: PCWSTR,
    pub(crate) psz_expanded_information: PCWSTR,
    pub(crate) psz_expanded_control_text: PCWSTR,
    pub(crate) psz_collapsed_control_text: PCWSTR,
    /// Union slot (footer icon sentinel).
    pub(crate) footer_icon: PCWSTR,
    pub(crate) psz_footer: PCWSTR,
    pub(crate) pf_callback: Option<TaskDialogCallback>,
    pub(crate) lp_callback_data: isize,
    pub(crate) cx_width: u32,
}

/// `TaskDialogIndirect` as resolved through `GetProcAddress`.
pub(crate) type TaskDialogIndirectFn = unsafe extern "system" fn(
    ptaskconfig: *const TaskDialogConfig,
    pn_button: *mut i32,
    pnradiobutton: *mut i32,
    pfverificationflagchecked: *mut BOOL,
) -> HRESULT;

// TASKDIALOG_FLAGS (frozen Win32 values).
pub(crate) const TDF_ALLOW_CANCELLATION: u32 = 0x0000_0008;
pub(crate) const TDF_USE_COMMAND_LINKS: u32 = 0x0000_0010;
pub(crate) const TDF_USE_COMMAND_LINKS_NO_ICON: u32 = 0x0000_0020;
pub(crate) const TDF_EXPANDED_BY_DEFAULT: u32 = 0x0000_0080;
pub(crate) const TDF_SIZE_TO_CONTENT: u32 = 0x0100_0000;

// TaskDialog notifications (frozen).
pub(crate) const TDN_CREATED: u32 = 0;

// Standard TaskDialog icon sentinels (`MAKEINTRESOURCEW`).
pub(crate) const TD_WARNING_ICON: PCWSTR = (-1isize) as usize as PCWSTR;
pub(crate) const TD_ERROR_ICON: PCWSTR = (-2isize) as usize as PCWSTR;
pub(crate) const TD_INFORMATION_ICON: PCWSTR = (-3isize) as usize as PCWSTR;

// Common button return values (shared with MessageBox; frozen Win32).
pub(crate) const IDOK: i32 = 1;
pub(crate) const IDCANCEL: i32 = 2;
pub(crate) const IDYES: i32 = 6;
pub(crate) const IDNO: i32 = 7;

/// Custom dialog button ids: `100 + index`. The base stays clear of every
/// common-button return value so a dismissal (IDCANCEL) is never ambiguous
/// with a caller button.
pub(crate) const CUSTOM_BUTTON_ID_BASE: i32 = 100;

// ---------------------------------------------------------------------------
// Dispatcher window (close channel, design section 5.3: WM_APP + ordinal)
// ---------------------------------------------------------------------------

/// Close request posted to a worker's dispatcher window. `WM_APP` range
/// owner: the low word identifies the worker slot ordinal.
pub(crate) const WM_APP_DIALOG_CLOSE: u32 = 0x8000;

/// Window class name for the per-worker message-only dispatcher windows.
pub(crate) const DISPATCHER_CLASS_NAME: &str = "OpentrayExtDialogDispatch";

/// `HWND_MESSAGE`: parenting here creates a message-only window.
pub(crate) const HWND_MESSAGE: HWND = -3isize as usize as HWND;

/// GWLP_USERDATA slot type carrying the boxed worker context.
pub(crate) type DispatcherContext = *mut c_void;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/// Encodes one Rust string as a null-terminated UTF-16 buffer.
pub(crate) fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a shell-returned `PWSTR` (CoTaskMem-allocated) as an owned Rust
/// string and frees the allocation. Null maps to an empty string.
///
/// # Safety
///
/// `text` must be null or point to a CoTaskMem-allocated
/// null-terminated UTF-16 buffer that the caller owns exclusively.
pub(crate) unsafe fn take_wide_string(text: PWSTR) -> String {
    if text.is_null() {
        return String::new();
    }
    unsafe {
        let mut length = 0usize;
        while *text.add(length) != 0 {
            length += 1;
        }
        let slice = std::slice::from_raw_parts(text, length);
        let owned = String::from_utf16_lossy(slice);
        windows_sys::Win32::System::Com::CoTaskMemFree(text.cast::<c_void>());
        owned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    /// Freezes the TASKDIALOGCONFIG C layout: pointer-aligned u32/ptr
    /// interleaving exactly as the Win32 header declares. Any drift is an
    /// ABI break caught here instead of by stack corruption on a user
    /// machine.
    #[test]
    fn task_dialog_config_layout_is_frozen() {
        type P = usize; // pointer word
        assert_eq!(
            size_of::<TaskDialogConfig>(),
            4 + 4 /* cbSize + pad */
                + P // hwndParent
                + P // hInstance
                + 4 + 4 // dwFlags + pad
                + P // pszWindowTitle
                + P // main icon union slot
                + P // pszMainInstruction
                + P // pszContent
                + 4 // cButtons
                + 4 // padding to the buttons pointer
                + P // pButtons
                + 4 // nDefaultButton
                + 4 // cRadioButtons
                + 8 // padding to the radio pointer (re-aligns after two u32/i32)
                + P // pRadioButtons
                + 4 // nDefaultRadioButton
                + 4 // padding to the verification pointer
                + P // pszVerificationText
                + P // pszExpandedInformation
                + P // pszExpandedControlText
                + P // pszCollapsedControlText
                + P // footer icon union slot
                + P // pszFooter
                + P // pfCallback (Option<fn> keeps the pointer niche)
                + P // lpCallbackData
                + 4 // cxWidth
                + 4, // tail padding to pointer alignment
            "TASKDIALOGCONFIG must keep the frozen Win32 layout"
        );
        assert_eq!(offset_of!(TaskDialogConfig, cb_size), 0);
        assert_eq!(offset_of!(TaskDialogConfig, hwnd_parent), 8);
        assert_eq!(offset_of!(TaskDialogConfig, dw_flags), 24);
        assert_eq!(offset_of!(TaskDialogConfig, psz_window_title), 32);
        assert_eq!(offset_of!(TaskDialogConfig, psz_main_instruction), 48);
        assert_eq!(offset_of!(TaskDialogConfig, psz_content), 56);
        assert_eq!(offset_of!(TaskDialogConfig, c_buttons), 64);
        assert_eq!(offset_of!(TaskDialogConfig, p_buttons), 72);
        assert_eq!(offset_of!(TaskDialogConfig, psz_verification_text), 112);
        assert_eq!(offset_of!(TaskDialogConfig, psz_expanded_information), 120);
        assert_eq!(offset_of!(TaskDialogConfig, psz_collapsed_control_text), 136);
        assert_eq!(offset_of!(TaskDialogConfig, footer_icon), 144);
        assert_eq!(offset_of!(TaskDialogConfig, psz_footer), 152);
        assert_eq!(offset_of!(TaskDialogConfig, pf_callback), 160);
        assert_eq!(offset_of!(TaskDialogConfig, lp_callback_data), 168);
        assert_eq!(offset_of!(TaskDialogConfig, cx_width), 176);
        // TASKDIALOG_BUTTON: i32 + alignment padding + pointer.
        assert_eq!(size_of::<TaskDialogButton>(), 4 + 4 + 8);
    }

    #[test]
    fn frozen_win32_constants_match_the_platform_headers() {
        assert_eq!(TDF_ALLOW_CANCELLATION, 0x8);
        assert_eq!(TDF_USE_COMMAND_LINKS, 0x10);
        assert_eq!(TDF_EXPANDED_BY_DEFAULT, 0x80);
        assert_eq!(TDF_SIZE_TO_CONTENT, 0x0100_0000);
        assert_eq!(TDN_CREATED, 0);
        assert_eq!(IDOK, 1);
        assert_eq!(IDCANCEL, 2);
        assert_eq!(IDYES, 6);
        assert_eq!(IDNO, 7);
        assert_eq!(WM_APP_DIALOG_CLOSE, 0x8000);
        // The icon sentinels are the MAKEINTRESOURCEW(-1/-2/-3) encodings.
        assert_eq!(TD_WARNING_ICON as isize, -1);
        assert_eq!(TD_ERROR_ICON as isize, -2);
        assert_eq!(TD_INFORMATION_ICON as isize, -3);
        assert_eq!(HRESULT_ERROR_CANCELLED, 0x8007_04C7_u32 as i32);
    }

    #[test]
    fn wide_strings_are_null_terminated_utf16() {
        let buffer = wide("café");
        assert_eq!(buffer.last(), Some(&0));
        assert_eq!(&buffer[..4], &[0x63, 0x61, 0x66, 0xe9]);
    }
}
