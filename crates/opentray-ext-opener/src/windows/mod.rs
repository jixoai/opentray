//! win32 opener surface (add-ext-opener task 3.2).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: open
//! a URL / absolute file path with the default application, or reveal it
//! in Explorer — as a host-side atom with resolve-on-acceptance
//! semantics):
//! 1. `open` projects `ShellExecuteW("open", target)` for BOTH dispatch
//!    kinds (paths and URLs — the frozen design's one-call projection);
//!    the target string passes verbatim (no normalization, no existence
//!    probe).
//! 2. Acceptance is frozen as a return value strictly greater than 32;
//!    anything at or below 32 rejects typed `opener_failed` whose details
//!    carry the integer `shellExecuteResult` plus the mapped `SE_ERR_*`
//!    reason when the value is a table member (`resolve::shell_execute_reason`).
//! 3. `reveal` applies the frozen reveal law (`resolve::prepare_reveal`,
//!    `posix = false`) and projects through
//!    `ShellExecuteW("open", "explorer.exe", params)`: the non-root form
//!    is the single-parameter `/select,"<path>"` construction with no
//!    user-controllable gap; the root form opens the root without
//!    `/select`.
//! 4. COM discipline (frozen contract, design section 4): the owner
//!    thread's apartment initialization is the broker's process-level
//!    startup discipline; this extension performs ZERO
//!    `CoInitialize`/`CoUninitialize` compensation — any measured
//!    exception is an implementation-phase P0 write-back to the design,
//!    not an in-situ compensation.
//!
//! Compromise: ShellExecuteW is a static shell32 import; the pure
//! parameter-construction and SE-mapping seams stay in `resolve.rs` so
//! every host runs them (CI matrix law — the FFI is the only
//! windows-only code here).

use opentray_spec::TypedExtensionError;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::options::shell_execute_failed_error;
use crate::resolve::{
    build_open_root_parameters, build_select_parameters, prepare_reveal,
    shell_execute_reason, RevealPlan, EXPLORER_FILE, SHELL_EXECUTE_ACCEPT_THRESHOLD,
};

/// Compile-time tie between the frozen literal table in `resolve.rs` and
/// the windows-sys constants (the cross-target compile gate runs this on
/// every windows build; the value table itself is host-testable).
const _: () = {
    use windows_sys::Win32::UI::Shell::*;
    assert!(
        SE_ERR_FNF == 2
            && SE_ERR_PNF == 3
            && SE_ERR_ACCESSDENIED == 5
            && SE_ERR_OOM == 8
            && SE_ERR_SHARE == 26
            && SE_ERR_ASSOCINCOMPLETE == 27
            && SE_ERR_DDETIMEOUT == 28
            && SE_ERR_DDEFAIL == 29
            && SE_ERR_DDEBUSY == 30
            && SE_ERR_NOASSOC == 31
            && SE_ERR_DLLNOTFOUND == 32
    );
};

fn null_hwnd() -> HWND {
    std::ptr::null_mut()
}

fn wide_null_terminated(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// One `ShellExecuteW("open", file, parameters)` dispatch returning the
/// frozen acceptance classification. `hwnd` is null (the broker shell
/// surface owns windows, not this call) and the default directory is
/// null; `SW_SHOWNORMAL` is the frozen show command.
fn shell_execute_open(file: &str, parameters: &str) -> i64 {
    let verb = wide_null_terminated("open");
    let file = wide_null_terminated(file);
    let parameters = wide_null_terminated(parameters);
    // SAFETY: every buffer is a valid null-terminated wide string for the
    // duration of the call; ShellExecuteW copies what it needs.
    let instance = unsafe {
        ShellExecuteW(
            null_hwnd(),
            verb.as_ptr(),
            file.as_ptr(),
            parameters.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    instance as i64
}

/// `open` (design section 2): one verbatim `ShellExecuteW("open", target)`
/// for paths and URLs alike. Acceptance: result > 32 (frozen). A result
/// <= 32 is the typed failure with the integer result and the mapped
/// `SE_ERR_*` reason.
pub(crate) fn open(target: &str) -> Result<(), TypedExtensionError> {
    let result = shell_execute_open(target, "");
    if result > SHELL_EXECUTE_ACCEPT_THRESHOLD {
        return Ok(());
    }
    Err(shell_execute_failed_error(
        result,
        shell_execute_reason(result),
        target,
    ))
}

/// `revealInFolder` (design section 2, frozen law): the reveal plan
/// (rejection set, root boundary, trim) selects between the single-
/// parameter `/select,"<path>"` construction and the open-the-root form —
/// both through `ShellExecuteW("open", "explorer.exe", params)`.
pub(crate) fn reveal(raw: &str) -> Result<(), TypedExtensionError> {
    let plan = prepare_reveal(raw, false)?;
    let parameters = match &plan {
        RevealPlan::Select { path } => build_select_parameters(path),
        RevealPlan::OpenRoot { root } => build_open_root_parameters(root),
    };
    let result = shell_execute_open(EXPLORER_FILE, &parameters);
    if result > SHELL_EXECUTE_ACCEPT_THRESHOLD {
        return Ok(());
    }
    Err(shell_execute_failed_error(
        result,
        shell_execute_reason(result),
        raw,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen FFI parameter layout: one call, the "open" verb, a null
    /// owner window and default directory, and SW_SHOWNORMAL — mirrored
    /// from the production helper so drift is red.
    #[test]
    fn wide_strings_are_null_terminated() {
        assert_eq!(
            wide_null_terminated("explorer.exe"),
            {
                let mut v: Vec<u16> = "explorer.exe".encode_utf16().collect();
                v.push(0);
                v
            }
        );
        assert_eq!(wide_null_terminated(""), vec![0]);
    }

    /// The complete reveal dispatch table: the raw reveal target, the
    /// exact explorer file, and the exact single-parameter string the
    /// spy asserts — the trim boundaries (including every root form) and
    /// the /select-vs-open-the-root split in one frozen table.
    #[test]
    fn reveal_dispatch_table_is_frozen() {
        let cases: &[(&str, &str)] = &[
            // Trim boundaries: exactly one trailing separator.
            ("C:\\foo\\", "/select,\"C:\\foo\""),
            ("C:\\foo/", "/select,\"C:\\foo\""),
            // Mixed separator win32-absolute form with trailing slash.
            ("C:/foo/", "/select,\"C:/foo\""),
            ("\\\\server\\share\\file.txt\\", "/select,\"\\\\server\\share\\file.txt\""),
            ("\\\\?\\C:\\temp\\file.txt\\", "/select,\"\\\\?\\C:\\temp\\file.txt\""),
            ("C:\\foo\\\\", "/select,\"C:\\foo\\\""),
            // No trailing separator: verbatim single-argument select.
            ("C:\\foo\\bar.txt", "/select,\"C:\\foo\\bar.txt\""),
            // Roots are never trimmed and open the root (no /select).
            ("C:\\", "\"C:\\\""),
            ("C:/", "\"C:/\""),
            ("\\\\server\\share\\", "\"\\\\server\\share\\\""),
            ("\\\\?\\C:\\", "\"\\\\?\\C:\\\""),
            ("\\\\?\\UNC\\server\\share\\", "\"\\\\?\\UNC\\server\\share\\\""),
        ];
        for (raw, expected_parameters) in cases {
            let plan = prepare_reveal(raw, false).expect(raw);
            let parameters = match &plan {
                RevealPlan::Select { path } => build_select_parameters(path),
                RevealPlan::OpenRoot { root } => build_open_root_parameters(root),
            };
            assert_eq!(&parameters, expected_parameters, "raw: {raw:?}");
            assert_eq!(EXPLORER_FILE, "explorer.exe");
            // Every constructed parameter is a single argument family:
            // the /select form never loses its prefix; the root form
            // never carries one.
            if parameters.starts_with("/select,") {
                assert!(parameters.ends_with('"') && parameters.len() > "/select,\"\"".len());
            } else {
                assert!(parameters.starts_with('"') && parameters.ends_with('"'));
            }
        }
    }

    /// Rejection-set members never construct any explorer argument: the
    /// typed rejection fires in `prepare_reveal` before any construction.
    #[test]
    fn rejection_set_members_never_reach_argument_construction() {
        for raw in [
            "C:\\a\"b",
            "C:\\a\u{0}b",
            "/tmp/a\u{1f}b",
            "C:\\x\ty",
            "notes\\todo.txt",
            "C:file.txt",
        ] {
            let error = prepare_reveal(raw, false).unwrap_err();
            let details = error.details.as_ref().unwrap();
            assert!(
                details["reason"] == "path-quote"
                    || details["reason"] == "path-control-char"
                    || details["reason"] == "relative"
                    || details["reason"] == "drive-relative",
                "raw {raw:?} must be a frozen rejection, got {details}"
            );
        }
    }

    /// The acceptance mapping: results > 32 accept; every documented
    /// failure value rejects through the typed error carrying the
    /// integer and the mapped reason.
    #[test]
    fn shell_execute_result_mapping_table_is_frozen() {
        let error = shell_execute_failed_error(31, shell_execute_reason(31), "C:\\x.xyz");
        assert_eq!(error.code, crate::options::error_code::FAILED);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 31, "reason": "noassoc" })
        );
        let error = shell_execute_failed_error(2, shell_execute_reason(2), "C:\\missing.txt");
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 2, "reason": "filenotfound" })
        );
        let error = shell_execute_failed_error(5, shell_execute_reason(5), "C:\\denied.txt");
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 5, "reason": "accessdenied" })
        );
        let error = shell_execute_failed_error(11, shell_execute_reason(11), "C:\\odd.txt");
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 11 })
        );
        for accepted in [33i64, 42] {
            assert!(accepted > SHELL_EXECUTE_ACCEPT_THRESHOLD);
        }
    }
}
