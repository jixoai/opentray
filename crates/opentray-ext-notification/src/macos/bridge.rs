//! The darwin osascript bridge fallback (Owner ruling 2026-09-19).
//!
//! macOS 26 refuses `UNUserNotificationCenter` authorization for
//! ad-hoc/linker-signed host apps in every launch shape (empirical
//! isolation matrix, 2026-09-18): no prompt, no System Settings entry,
//! banners never present. A Developer-ID-signed carrier remains the full
//! experience and is left to developers who can sign; for coherent
//! unsigned installs this module is the documented fallback projection:
//! notification posts route through `/usr/bin/osascript`'s
//! `display notification`, whose host is Apple-signed and always allowed.
//!
//! Channel triage is a pure code-signature self-check on the running
//! process (`SecCodeCopySelf` + `SecCodeCopySigningInformation`): unsigned
//! or ad-hoc signatures mean the UN channel cannot present, so the bridge
//! owns delivery for that post. The authorization commands keep their
//! honest UN semantics either way, and a DENIED snapshot still rejects
//! typed with zero delivery (the bridge is unreachable on that path —
//! the acceptance law is unchanged).
//!
//! The bridge passes title/body/subtitle as osascript `run` ARGUMENTS —
//! never interpolated into AppleScript string literals — so no payload
//! can escape the quoting context. Acceptance is `spawn()` success
//! (resolve-on-acceptance: the sound law); the detached child presents
//! asynchronously.

use std::ffi::c_void;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};

use opentray_spec::TypedExtensionError;

use crate::options::{self, NotifyContent};

// ---------------------------------------------------------------------------
// Channel triage: the running process's code-signature class
// ---------------------------------------------------------------------------

/// `kSecCodeSignatureAdhoc` (SecCode.h `SecCodeSignatureFlags`).
const SEC_CODE_SIGNATURE_ADHOC: i32 = 0x0000_0002;
/// `kCFNumberSInt32Type`.
const CF_NUMBER_SINT32_TYPE: isize = 3;

#[repr(C)]
struct CfOpaque {
    _private: [u8; 0],
}

#[link(name = "Security", kind = "framework")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn SecCodeCopySelf(flags: u32, out: *mut *mut CfOpaque) -> i32;
    fn SecCodeCopySigningInformation(
        code: *mut CfOpaque,
        flags: u32,
        out: *mut *mut CfOpaque,
    ) -> i32;
    fn CFStringCreateWithCString(
        alloc: *mut CfOpaque,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> *mut CfOpaque;
    fn CFDictionaryGetValue(
        dict: *const CfOpaque,
        key: *const CfOpaque,
    ) -> *const c_void;
    fn CFNumberGetValue(
        number: *const CfOpaque,
        the_type: isize,
        value_ptr: *mut c_void,
    ) -> u8;
    fn CFRelease(cf: *const CfOpaque);
}

/// True when the UN center can present for this process: a real
/// (non-ad-hoc) code signature. Unsigned and ad-hoc signatures return
/// false — the bridge owns delivery. Any unexpected FFI failure returns
/// true (conservative: the ordinary UN path, whose typed surfaces are the
/// honest contract).
pub(crate) fn un_center_presentation_available() -> bool {
    let probe = std::panic::catch_unwind(signature_state).unwrap_or(true);
    probe
}

fn signature_state() -> bool {
    unsafe {
        let mut code: *mut CfOpaque = std::ptr::null_mut();
        if SecCodeCopySelf(0, &mut code) != 0 {
            return true;
        }
        let mut info: *mut CfOpaque = std::ptr::null_mut();
        let status = SecCodeCopySigningInformation(code, 0, &mut info);
        CFRelease(code);
        if status != 0 || info.is_null() {
            // errSecCSUnsigned and friends: no signature at all.
            return false;
        }
        let key = CFStringCreateWithCString(
            std::ptr::null_mut(),
            c"flags".as_ptr(),
            0x0800_0100, // kCFStringEncodingUTF8
        );
        if key.is_null() {
            CFRelease(info);
            return true;
        }
        let flags_number = CFDictionaryGetValue(info, key) as *const CfOpaque;
        CFRelease(key);
        let mut flags: i32 = 0;
        let readable = !flags_number.is_null()
            && CFNumberGetValue(flags_number, CF_NUMBER_SINT32_TYPE, &mut flags as *mut i32 as *mut c_void) != 0;
        CFRelease(info);
        if !readable {
            return true;
        }
        flags & SEC_CODE_SIGNATURE_ADHOC == 0
    }
}

// ---------------------------------------------------------------------------
// The bridge post
// ---------------------------------------------------------------------------

/// The production bridge: spawn `/usr/bin/osascript` with the payload as
/// `run` arguments (no AppleScript literal interpolation — quoting is
/// structurally closed). Acceptance = spawn success.
pub(crate) fn spawn_bridge_notification(content: &NotifyContent) -> Result<(), TypedExtensionError> {
    let display = compose_display_statement(content);
    let mut command = Command::new("/usr/bin/osascript");
    command
        .arg("-e")
        .arg("on run argv")
        .arg("-e")
        .arg(display)
        .arg("-e")
        .arg("end run")
        .arg("--")
        .arg(&content.title)
        .arg(content.body.as_deref().unwrap_or(""))
        .arg(content.subtitle.as_deref().unwrap_or(""))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    match command.spawn() {
        Ok(_child) => Ok(()),
        Err(error) => Err(options::failed_reason_error(
            "bridge-spawn-failed",
            format!("spawning the osascript notification bridge failed: {error}"),
        )),
    }
}

/// Composes the `display notification` statement with argument references
/// only. Subtitle joins when present; the default alert sound joins
/// unless `silent` (matching the UN projection's sound semantics).
pub(crate) fn compose_display_statement(content: &NotifyContent) -> String {
    let mut statement = String::from("display notification (item 2 of argv) with title (item 1 of argv)");
    if content.subtitle_text().is_some() {
        statement.push_str(" subtitle (item 3 of argv)");
    }
    if !content.is_silent() {
        statement.push_str(" sound name \"default\"");
    }
    statement
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(title: &str, body: Option<&str>, subtitle: Option<&str>, silent: Option<bool>) -> NotifyContent {
        NotifyContent {
            title: title.to_string(),
            body: body.map(str::to_string),
            subtitle: subtitle.map(str::to_string),
            silent,
        }
    }

    #[test]
    fn display_statement_combinations_are_argument_references_only() {
        assert_eq!(
            compose_display_statement(&content("t", Some("b"), None, None)),
            "display notification (item 2 of argv) with title (item 1 of argv) sound name \"default\"",
        );
        assert_eq!(
            compose_display_statement(&content("t", Some("b"), Some("s"), None)),
            "display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv) sound name \"default\"",
        );
        assert_eq!(
            compose_display_statement(&content("t", None, Some("s"), Some(true))),
            "display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv)",
        );
        // No payload byte ever appears inside the statement — only argv
        // references, so quoting cannot be escaped.
        for statement in [
            compose_display_statement(&content("\" injection '", Some("\\ try"), Some("${x}"), None)),
            compose_display_statement(&content("t", None, None, Some(true))),
        ] {
            assert!(!statement.contains("injection"));
            assert!(!statement.contains("try"));
        }
    }

    #[test]
    fn triage_reports_a_real_signature_class_on_this_host() {
        // A dev/test binary is ad-hoc linker-signed at minimum: the
        // triage must answer deterministically without panicking. We do
        // not assert WHICH way (CI runners vary); the assertion is that
        // the FFI probe itself completes.
        let _ = un_center_presentation_available();
    }
}
