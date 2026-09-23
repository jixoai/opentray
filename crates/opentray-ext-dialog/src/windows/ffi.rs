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
use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, WPARAM};

pub(crate) type HRESULT = i32;
pub(crate) type BOOL = i32;

pub(crate) const S_OK: HRESULT = 0;
/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the IFileDialog dismissal code.
pub(crate) const HRESULT_ERROR_CANCELLED: HRESULT = 0x8007_04C7_u32 as i32;

// ---------------------------------------------------------------------------
// TaskDialog ABI (frozen Win32 layout; comctl32 v6)
// ---------------------------------------------------------------------------

/// `TASKDIALOG_BUTTON` — packed(1) with the TaskDialog family (`pshpack1.h`
/// in `commctrl.h`): 12 bytes on x64, the pointer at offset 4 is unaligned.
#[repr(C, packed(1))]
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
/// cbSize, hwndParent, hInstance, dwFlags, dwCommonButtons, pszWindowTitle,
/// main-icon union, pszMainInstruction, pszContent, buttons, radio buttons,
/// pszVerificationText, pszExpandedInformation, pszExpandedControlText,
/// pszCollapsedControlText, footer-icon union, pszFooter, pfCallback,
/// lpCallbackData, cxWidth). `commctrl.h` wraps the TaskDialog family in
/// `#include <pshpack1.h>`: the real ABI is **packed(1)** — pointer fields
/// sit at unaligned offsets and x64 `cbSize` is 88, not the naturally
/// aligned 96. `TaskDialogIndirect` validates `cbSize` against its own
/// layout and rejects a mismatched config with E_INVALIDARG before
/// creating anything (real-machine Windows evidence 2026-09-22: the
/// naturally aligned, `dwCommonButtons`-less form failed every broker
/// message dialog with 0x80070057; a manifest-less probe host had only
/// ever exercised the MessageBox fallback, which builds no config). The
/// two C unions are single `PCWSTR` slots here: the icon forms are
/// `MAKEINTRESOURCEW` sentinels, which is exactly the pointer encoding the
/// union's `pszMainIcon` arm uses; no HICON path exists in this extension.
#[repr(C, packed(1))]
pub(crate) struct TaskDialogConfig {
    pub(crate) cb_size: u32,
    pub(crate) hwnd_parent: HWND,
    pub(crate) h_instance: HINSTANCE,
    pub(crate) dw_flags: u32,
    /// `TASKDIALOG_COMMON_BUTTON_FLAGS`: always 0 — this extension uses
    /// custom buttons exclusively. The field exists in the real ABI and its
    /// omission shifted every later field and corrupted `cbSize`.
    pub(crate) dw_common_buttons: u32,
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

// TASKDIALOG_FLAGS (frozen Win32 values). The full frozen set is kept even
// where the current recipe uses a subset: completeness is the point of a
// frozen ABI table.
pub(crate) const TDF_ALLOW_CANCELLATION: u32 = 0x0000_0008;
pub(crate) const TDF_USE_COMMAND_LINKS: u32 = 0x0000_0010;
#[allow(dead_code)] // frozen-table completeness
pub(crate) const TDF_USE_COMMAND_LINKS_NO_ICON: u32 = 0x0000_0020;
pub(crate) const TDF_EXPANDED_BY_DEFAULT: u32 = 0x0000_0080;
pub(crate) const TDF_SIZE_TO_CONTENT: u32 = 0x0100_0000;

// TaskDialog notifications (frozen).
pub(crate) const TDN_CREATED: u32 = 0;

// Standard TaskDialog icon sentinels. Win32 defines these through
// `MAKEINTRESOURCEW`, whose cast truncates to a WORD before widening —
// `MAKEINTRESOURCEW(-3)` is the pointer `0xFFFD`, NOT the sign-extended
// `0xFFFFFFFFFFFFFFFD`. TaskDialogIndirect validates the icon against the
// int-resource range and rejects the sign-extended form with E_INVALIDARG
// before creating anything (real-machine Windows evidence 2026-09-22: every
// broker message dialog failed with 0x80070057 because a manifest-less
// probe had only ever exercised the MessageBox fallback, which takes no
// icon sentinels).
pub(crate) const TD_WARNING_ICON: PCWSTR = 0xFFFFusize as PCWSTR;
pub(crate) const TD_ERROR_ICON: PCWSTR = 0xFFFEusize as PCWSTR;
pub(crate) const TD_INFORMATION_ICON: PCWSTR = 0xFFFDusize as PCWSTR;

// Common button return values (shared with MessageBox; frozen Win32). The
// full set is the frozen mapping table; the current recipes read IDCANCEL
// and the custom ids.
#[allow(dead_code)]
pub(crate) const IDOK: i32 = 1;
pub(crate) const IDCANCEL: i32 = 2;
#[allow(dead_code)]
pub(crate) const IDYES: i32 = 6;
#[allow(dead_code)]
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

    /// Freezes the TASKDIALOGCONFIG C layout against windows-sys's own
    /// metadata-derived declaration: `commctrl.h` wraps the TaskDialog
    /// family in `pshpack1.h`, so the real ABI is packed(1) with the
    /// `dwCommonButtons` field present. Any drift is an ABI break caught
    /// here instead of as E_INVALIDARG on a user machine (the historical
    /// failure: a naturally aligned, `dwCommonButtons`-less form had both
    /// wrong offsets and a `cbSize` TaskDialogIndirect rejects).
    #[test]
    fn task_dialog_config_layout_is_frozen() {
        assert_eq!(
            size_of::<TaskDialogConfig>(),
            size_of::<::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG>(),
            "TASKDIALOGCONFIG must keep the frozen packed(1) Win32 layout"
        );
        assert_eq!(
            size_of::<TaskDialogButton>(),
            size_of::<::windows_sys::Win32::UI::Controls::TASKDIALOG_BUTTON>(),
            "TASKDIALOG_BUTTON must keep the frozen packed(1) Win32 layout"
        );
        // Packed(1) anchors: handles sit directly after cbSize with no pad,
        // and every later field matches the windows-sys offsets exactly.
        assert_eq!(offset_of!(TaskDialogConfig, cb_size), 0);
        assert_eq!(offset_of!(TaskDialogConfig, hwnd_parent), 4);
        assert_eq!(
            offset_of!(TaskDialogConfig, psz_window_title),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                pszWindowTitle
            )
        );
        assert_eq!(
            offset_of!(TaskDialogConfig, main_icon),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                Anonymous1
            )
        );
        assert_eq!(
            offset_of!(TaskDialogConfig, psz_main_instruction),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                pszMainInstruction
            )
        );
        assert_eq!(
            offset_of!(TaskDialogConfig, p_buttons),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                pButtons
            )
        );
        assert_eq!(
            offset_of!(TaskDialogConfig, pf_callback),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                pfCallback
            )
        );
        assert_eq!(
            offset_of!(TaskDialogConfig, cx_width),
            offset_of!(
                ::windows_sys::Win32::UI::Controls::TASKDIALOGCONFIG,
                cxWidth
            )
        );
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
        // The icon sentinels are the MAKEINTRESOURCEW(-1/-2/-3) encodings:
        // WORD-truncated (0xFFFF/0xFFFE/0xFFFD), never sign-extended —
        // TaskDialogIndirect rejects the sign-extended form (E_INVALIDARG).
        assert_eq!(TD_WARNING_ICON as usize, 0xFFFF);
        assert_eq!(TD_ERROR_ICON as usize, 0xFFFE);
        assert_eq!(TD_INFORMATION_ICON as usize, 0xFFFD);
        assert_eq!(HRESULT_ERROR_CANCELLED, 0x8007_04C7_u32 as i32);
    }

    #[test]
    fn wide_strings_are_null_terminated_utf16() {
        let buffer = wide("café");
        assert_eq!(buffer.last(), Some(&0));
        assert_eq!(&buffer[..4], &[0x63, 0x61, 0x66, 0xe9]);
    }
}
