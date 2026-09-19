//! The darwin osascript dialog bridge (presentation fallback, 2026-09-19).
//!
//! macOS 26 gates interactive dialog presentation by the running
//! process's code-signature class (empirical isolation matrix
//! 2026-09-19, issue #10 round 2): an ad-hoc/linker-signed carrier's
//! in-process `NSAlert`/`NSOpenPanel` renders in a degenerate form
//! (untitled stacked button slots, stray help button, `<`-prefixed
//! suppression placeholder) and never receives any click — not routed
//! synthetic clicks, not human clicks; `frontmost` never flips under any
//! activation strategy (`activateIgnoringOtherApps`, Regular-policy
//! bump, `makeKeyAndOrderFront` + `orderFrontRegardless`). The same
//! matrix shows `/usr/bin/osascript` (Apple-signed host) presenting the
//! standard alert form and resolving real clicks immediately.
//!
//! This is the same law family as the UN notification refusal
//! (ext-notification bridge, Owner ruling 2026-09-19): a Developer-ID
//! signed carrier keeps the full in-process experience; unsigned/ad-hoc
//! carriers present through the Apple-signed osascript host.
//!
//! Every caller-controlled string (message text, button titles, prompts,
//! default paths, filter extensions) crosses as osascript `run`
//! ARGUMENTS — never interpolated into AppleScript string literals —
//! so no payload can escape the quoting context. The bridge child lives
//! inside the same DeferredOperation transaction: spawn is the Accepted
//! frame, each `poll_owner` quantum `try_wait`s the child, child exit is
//! the modal-terminal event, and the terminal parses the child's
//! stdout. Session cleanup kills the child. Bridge dialogs attribute to
//! the osascript host icon (documented degradation, same as notification
//! banners).
//!
//! Bridge degradations (documented, never silent semantic changes):
//! `detail` folds into the message text; `suppressionLabel` is not
//! expressible (`suppressed` resolves `false`); more than three buttons
//! and mixed file+directory selection reject typed before any spawn.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

use opentray_spec::TypedExtensionError;

use crate::options::{
    DialogSeverity, MessageDialogOptions, PickDirectoryOptions, PickFileOptions, SavePickOptions,
};

// ---------------------------------------------------------------------------
// Channel triage: the running process's code-signature class
// ---------------------------------------------------------------------------

/// `kSecCodeSignatureAdhoc` (SecCode.h `SecCodeSignatureFlags`).
const SEC_CODE_SIGNATURE_ADHOC: i32 = 0x0000_0002;
/// `kCFNumberSINT32Type`.
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
    fn CFDictionaryGetValue(dict: *const CfOpaque, key: *const CfOpaque) -> *const std::ffi::c_void;
    fn CFNumberGetValue(
        number: *const CfOpaque,
        the_type: isize,
        value_ptr: *mut std::ffi::c_void,
    ) -> u8;
    fn CFRelease(cf: *const CfOpaque);
}

/// True when the in-process AppKit dialog path can present for this
/// process: a real (non-ad-hoc) code signature. Unsigned and ad-hoc
/// signatures return false — the bridge owns presentation. Any
/// unexpected FFI failure returns true (conservative: the ordinary
/// in-process path, whose typed surfaces are the honest contract).
pub(crate) fn alert_presentation_available() -> bool {
    std::panic::catch_unwind(signature_state).unwrap_or(true)
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
            && CFNumberGetValue(
                flags_number,
                CF_NUMBER_SINT32_TYPE,
                &mut flags as *mut i32 as *mut std::ffi::c_void,
            ) != 0;
        CFRelease(info);
        if !readable {
            return true;
        }
        flags & SEC_CODE_SIGNATURE_ADHOC == 0
    }
}

// ---------------------------------------------------------------------------
// Statement composition (argv references only — never payload literals)
// ---------------------------------------------------------------------------

/// `display dialog` supports at most three buttons; more is a typed
/// rejection, never a silent clamp.
pub(crate) const BRIDGE_MAX_BUTTONS: usize = 3;

fn icon_word(severity: DialogSeverity) -> &'static str {
    match severity {
        DialogSeverity::Info => "note",
        DialogSeverity::Warning => "caution",
        DialogSeverity::Error => "stop",
    }
}

/// The bridge dialog title: the carrier bundle's display name — the same
/// string an in-process NSAlert shows by default (`CFBundleDisplayName`,
/// falling back to `CFBundleName`, then the process name). Restores title
/// parity with the native alert; the title bar is never left empty.
fn app_display_name() -> String {
    use objc2_foundation::{NSBundle, NSProcessInfo};
    let bundle = NSBundle::mainBundle();
    {
        for key in ["CFBundleDisplayName", "CFBundleName"] {
            if let Some(value) = bundle.objectForInfoDictionaryKey(&objc2_foundation::NSString::from_str(key)) {
                if let Some(text) = value.downcast_ref::<objc2_foundation::NSString>() {
                    let name = text.to_string();
                    if !name.is_empty() {
                        return name;
                    }
                }
            }
        }
    }
    NSProcessInfo::processInfo().processName().to_string()
}

/// Composes the `display dialog` statement and its argv vector for one
/// message dialog. Argv layout (1-based AppleScript `item` positions):
/// 1 = display text, 2..=1+N = button titles, then default index (1-based
/// AppleScript button index as text), then cancel index (1-based). The
/// returned statement references those positions only.
pub(crate) fn compose_display_dialog(
    options: &MessageDialogOptions,
) -> Result<(String, Vec<String>), TypedExtensionError> {
    let mut buttons: Vec<String> = options.buttons.clone();
    if buttons.is_empty() {
        buttons.push("OK".to_string());
    }
    if buttons.len() > BRIDGE_MAX_BUTTONS {
        return Err(bridge_rejection(
            "bridge-buttons-limit",
            format!(
                "the osascript dialog bridge presents at most {} buttons; sign the carrier with a Developer ID identity to unlock the full in-process dialog (got {} buttons)",
                BRIDGE_MAX_BUTTONS,
                buttons.len()
            ),
        ));
    }
    let display_text = match &options.detail {
        Some(detail) => format!("{}\n\n{}", options.message, detail),
        None => options.message.clone(),
    };
    let mut argv_push_later: Option<String> = None;
    let default_index = options.default_id.unwrap_or(0).min(buttons.len() - 1);
    let cancel_index = options
        .cancel_id
        .unwrap_or(buttons.len() - 1)
        .min(buttons.len() - 1);
    let default_pos = 2 + buttons.len();
    let cancel_pos = default_pos + 1;
    let title_pos = cancel_pos + 1;
    // `display dialog`'s single `with icon` parameter is either the severity
    // constant or a file (`POSIX file`); a custom icon therefore replaces
    // the severity badge (documented). The path is pre-validated so a bad
    // path rejects typed before any dialog is shown.
    let icon_clause = if let Some(path) = options
        .darwin
        .icon
        .as_ref()
        .filter(|path| !path.is_empty())
    {
        if std::fs::metadata(path).is_err() {
            return Err(bridge_rejection(
                "icon-unreadable",
                format!("darwin.icon file is not readable: {path}"),
            ));
        }
        argv_push_later = Some(path.clone());
        format!("with icon (POSIX file (item {} of argv))", title_pos + 1)
    } else {
        format!("with icon {}", icon_word(options.severity))
    };
    let button_refs: Vec<String> = (0..buttons.len()).map(|i| format!("item {} of argv", 2 + i)).collect();
    let statement = format!(
        "on run argv\n\
         try\n\
         display dialog (item 1 of argv) buttons {{{list}}} default button (item {default_pos} of argv as integer) cancel button (item {cancel_pos} of argv as integer) {icon_clause} with title (item {title_pos} of argv)\n\
         return \"button:\" & (button returned of result)\n\
         on error number -128\n\
         return \"cancel\"\n\
         end try\n\
         end run",
        list = button_refs.join(", "),
    );
    let mut argv = vec![display_text];
    argv.extend(buttons);
    argv.push((default_index + 1).to_string());
    argv.push((cancel_index + 1).to_string());
    argv.push(app_display_name());
    if let Some(path) = argv_push_later {
        argv.push(path);
    }
    Ok((statement, argv))
}

/// Composes the `choose file` statement. Argv: 1 = prompt, 2 = default
/// location (POSIX path), 3.. = filter extensions (bare, no dot; the
/// union of every filter's extensions — filter names are presentation
/// only and drop in the bridge).
pub(crate) fn compose_choose_file(
    options: &PickFileOptions,
) -> Result<(String, Vec<String>), TypedExtensionError> {
    if options.darwin.include_directories {
        return Err(bridge_rejection(
            "bridge-mixed-selection-unsupported",
            "the osascript dialog bridge cannot mix file and directory selection; sign the carrier with a Developer ID identity to unlock the full in-process panel".to_string(),
        ));
    }
    let mut extensions: Vec<String> = Vec::new();
    if let Some(filters) = &options.common.filters {
        for filter in filters {
            for extension in &filter.extensions {
                if !extension.is_empty() && !extensions.iter().any(|seen| seen == extension) {
                    extensions.push(extension.clone());
                }
            }
        }
    }
    let prompt = pick_prompt(&options.common.title, &options.darwin.panel_message);
    let mut statement = String::from("on run argv\ntry\nset picked to choose file with prompt (item 1 of argv)");
    if options.common.default_path.is_some() {
        statement.push_str(" default location (POSIX file (item 2 of argv))");
    }
    if !extensions.is_empty() {
        let refs: Vec<String> = (0..extensions.len())
            .map(|i| {
                let pos = if options.common.default_path.is_some() {
                    3 + i
                } else {
                    2 + i
                };
                format!("item {pos} of argv")
            })
            .collect();
        statement.push_str(&format!(" of type {{{}}}", refs.join(", ")));
    }
    if options.common.shows_hidden {
        statement.push_str(" invisibles");
    }
    if options.multiple {
        statement.push_str(" multiple selections allowed");
    }
    statement.push_str(
        "\nset out to \"\"\nrepeat with f in picked\nset out to out & \"path:\" & (POSIX path of f) & linefeed\nend repeat\nreturn out\n\
         on error number -128\nreturn \"cancel\"\nend try\nend run",
    );
    let mut argv = vec![prompt];
    if let Some(path) = &options.common.default_path {
        argv.push(path.clone());
    }
    argv.extend(extensions);
    Ok((statement, argv))
}

/// Composes the `choose folder` statement. Argv: 1 = prompt,
/// 2 = default location.
pub(crate) fn compose_choose_folder(options: &PickDirectoryOptions) -> (String, Vec<String>) {
    let prompt = options.common.title.clone().unwrap_or_default();
    let mut statement = String::from("on run argv\ntry\nset picked to choose folder with prompt (item 1 of argv)");
    if options.common.default_path.is_some() {
        statement.push_str(" default location (POSIX file (item 2 of argv))");
    }
    if options.common.shows_hidden {
        statement.push_str(" invisibles");
    }
    statement.push_str(
        "\nreturn \"path:\" & (POSIX path of picked)\n\
         on error number -128\nreturn \"cancel\"\nend try\nend run",
    );
    let mut argv = vec![prompt];
    if let Some(path) = &options.common.default_path {
        argv.push(path.clone());
    }
    (statement, argv)
}

/// Composes the `choose file name` (save) statement. Argv: 1 = prompt,
/// 2 = default name, 3 = default location. `filters`,
/// `defaultFilterIndex`, and `createDirectories` have no bridge knob
/// (documented degradations).
pub(crate) fn compose_choose_file_name(options: &SavePickOptions) -> (String, Vec<String>) {
    let prompt = pick_prompt(&options.common.title, &options.darwin.panel_message);
    let (default_name, default_location) = match &options.common.default_path {
        Some(path) => {
            let leaf = path.rsplit('/').next().unwrap_or("").to_string();
            let parent = match path.rfind('/') {
                Some(0) => "/".to_string(),
                Some(index) => path[..index].to_string(),
                None => String::new(),
            };
            (leaf, parent)
        }
        None => (String::new(), String::new()),
    };
    let has_name = !default_name.is_empty();
    let has_location = !default_location.is_empty();
    let mut statement =
        String::from("on run argv\ntry\nset picked to choose file name with prompt (item 1 of argv)");
    if has_name {
        statement.push_str(" default name (item 2 of argv)");
    }
    if has_location {
        let pos = if has_name { 3 } else { 2 };
        statement.push_str(&format!(" default location (POSIX file (item {pos} of argv))"));
    }
    statement.push_str(
        "\nreturn \"path:\" & (POSIX path of picked)\n\
         on error number -128\nreturn \"cancel\"\nend try\nend run",
    );
    let mut argv = vec![prompt];
    if has_name {
        argv.push(default_name);
    }
    if has_location {
        argv.push(default_location);
    }
    (statement, argv)
}

fn pick_prompt(title: &Option<String>, panel_message: &Option<String>) -> String {
    panel_message
        .clone()
        .or_else(|| title.clone())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Child spawn + stepping + stdout parsing
// ---------------------------------------------------------------------------

/// The bridge half of one `NativeModal`: the osascript child plus the
/// caller's button titles (title-to-index mapping), its drained stdout,
/// and the parsed outcome (filled by `step` when the child exits; read
/// by `extract_terminal`).
pub(crate) struct BridgeDialog {
    pub(crate) child: Child,
    pub(crate) buttons: Vec<String>,
    pub(crate) output: String,
    pub(crate) parsed: Option<Result<BridgeOutcome, TypedExtensionError>>,
}

/// The parsed bridge terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BridgeOutcome {
    /// The activated button index (0-based, into the caller's array).
    Button(usize),
    /// One POSIX path (pickDirectory / pickSavePath).
    SinglePath(String),
    /// POSIX paths (pickFile; multiple selection carries every entry).
    MultiplePaths(Vec<String>),
    /// The user canceled (`error number -128`).
    Canceled,
}

pub(crate) fn spawn_bridge(
    statement: &str,
    argv: &[String],
) -> Result<Child, TypedExtensionError> {
    let mut command = Command::new("/usr/bin/osascript");
    command
        .arg("-e")
        .arg(statement)
        .arg("--")
        .args(argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    match command.spawn() {
        Ok(child) => Ok(child),
        Err(error) => Err(bridge_rejection(
            "bridge-spawn-failed",
            format!("/usr/bin/osascript spawn failed: {error}"),
        )),
    }
}

/// Note: osascript receives the statement through `-e` directly — the
/// `on run argv` / `end run` wrapper is part of the statement text (one
/// `-e` block); argv rides the `--` separator.

/// Kills and reaps a bridge child (session cleanup / revoke teardown).
pub(crate) fn dispose_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Parses the bridge child's stdout into the terminal outcome.
pub(crate) fn parse_bridge_output(
    output: &str,
    buttons: &[String],
) -> Result<BridgeOutcome, TypedExtensionError> {
    let mut paths: Vec<String> = Vec::new();
    for line in output.lines() {
        if line == "cancel" {
            return Ok(BridgeOutcome::Canceled);
        }
        if let Some(title) = line.strip_prefix("button:") {
            let index = buttons
                .iter()
                .position(|button| button == title)
                .ok_or_else(|| {
                    bridge_rejection(
                        "bridge-button-unmapped",
                        format!(
                            "the bridge returned a button title outside the caller's array: {title:?}"
                        ),
                    )
                })?;
            return Ok(BridgeOutcome::Button(index));
        }
        if let Some(path) = line.strip_prefix("path:") {
            if !path.is_empty() {
                paths.push(path.to_string());
            }
        }
    }
    if paths.is_empty() {
        return Err(bridge_rejection(
            "bridge-output-unrecognized",
            format!("the bridge child produced no recognized outcome line: {output:?}"),
        ));
    }
    if paths.len() == 1 {
        Ok(BridgeOutcome::SinglePath(paths.remove(0)))
    } else {
        Ok(BridgeOutcome::MultiplePaths(paths))
    }
}

/// Drains the exited child's stdout into a String (bounded by the pipe
/// closing at child exit).
pub(crate) fn drain_child_stdout(child: &mut Child) -> String {
    let mut output = String::new();
    if let Some(stdout) = child.stdout.as_mut() {
        let _ = stdout.read_to_string(&mut output);
    }
    output
}

fn bridge_rejection(reason: &str, message: String) -> TypedExtensionError {
    // Reuses the typed dialog presentation-failure code so facade
    // handling stays one family; the structured reason distinguishes
    // bridge degradations.
    crate::state::typed_error_with_details(
        crate::options::error_code::PRESENTATION_FAILED,
        message,
        serde_json::json!({ "reason": reason }),
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::options::{
        CommonPickOptions, DarwinPickFileNamespace, DarwinSaveNamespace, DialogFileFilter,
    };

    fn message_options(buttons: &[&str]) -> MessageDialogOptions {
        MessageDialogOptions {
            message: "m".to_string(),
            detail: None,
            buttons: buttons.iter().map(|s| s.to_string()).collect(),
            default_id: None,
            cancel_id: None,
            severity: DialogSeverity::Info,
            suppression_label: None,
            darwin: Default::default(),
            win32: Default::default(),
        }
    }

    #[test]
    fn display_dialog_statement_references_argv_only() {
        let (statement, argv) = compose_display_dialog(&message_options(&["OK"])).unwrap();
        assert!(statement.contains("buttons {item 2 of argv} default button (item 3 of argv as integer) cancel button (item 4 of argv as integer) with icon note with title (item 5 of argv)"));
        // No caller payload ever appears inside the statement.
        assert!(!statement.contains("\"m\""));
        // The title argv slot is the carrier display name (non-empty on
        // any real host; the exact value is host-dependent).
        assert_eq!(argv.len(), 5);
        assert!(!argv[4].is_empty());
    }

    #[test]
    fn display_dialog_three_buttons_indices_and_detail_fold() {
        let options = MessageDialogOptions {
            detail: Some("d".into()),
            default_id: Some(1),
            cancel_id: Some(2),
            severity: DialogSeverity::Error,
            ..message_options(&["Abort", "Retry", "Ignore"])
        };
        let (statement, argv) = compose_display_dialog(&options).unwrap();
        assert!(statement.contains("buttons {item 2 of argv, item 3 of argv, item 4 of argv}"));
        assert!(statement.contains("with icon stop"));
        assert_eq!(argv[..4], vec!["m\n\nd", "Abort", "Retry", "Ignore"]);
        assert_eq!(argv[4], "2");
        assert_eq!(argv[5], "3");
    }

    #[test]
    fn display_dialog_rejects_more_than_three_buttons() {
        let error = compose_display_dialog(&message_options(&["a", "b", "c", "d"]))
            .unwrap_err();
        assert_eq!(error.code, "dialog_presentation_failed");
        assert_eq!(
            error.details.as_ref().and_then(|d| d.get("reason")),
            Some(&serde_json::json!("bridge-buttons-limit"))
        );
    }

    #[test]
    fn choose_file_statement_composes_flags_from_options() {
        let options = PickFileOptions {
            common: CommonPickOptions {
                filters: Some(vec![
                    DialogFileFilter {
                        name: "Images".into(),
                        extensions: vec!["png".into(), "jpg".into()],
                    },
                    DialogFileFilter {
                        name: "Extra".into(),
                        extensions: vec!["png".into(), "gif".into()],
                    },
                ]),
                default_path: Some("/tmp".into()),
                title: Some("pick one".into()),
                file_name_label: None,
                shows_hidden: true,
            },
            multiple: true,
            darwin: DarwinPickFileNamespace::default(),
            win32: Default::default(),
        };
        let (statement, argv) = compose_choose_file(&options).unwrap();
        assert!(statement.contains("choose file with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)) of type {item 3 of argv, item 4 of argv, item 5 of argv} invisibles multiple selections allowed"));
        // Union dedupes: png once, then jpg, then gif.
        assert_eq!(argv, vec!["pick one", "/tmp", "png", "jpg", "gif"]);
    }

    #[test]
    fn choose_file_rejects_mixed_selection() {
        let options = PickFileOptions {
            darwin: DarwinPickFileNamespace {
                include_directories: true,
                ..Default::default()
            },
            ..PickFileOptions {
                common: CommonPickOptions::default(),
                multiple: false,
                darwin: DarwinPickFileNamespace::default(),
                win32: Default::default(),
            }
        };
        let error = compose_choose_file(&options).unwrap_err();
        assert_eq!(
            error.details.as_ref().and_then(|d| d.get("reason")),
            Some(&serde_json::json!("bridge-mixed-selection-unsupported"))
        );
    }

    #[test]
    fn choose_save_splits_default_path_into_name_and_location() {
        let options = SavePickOptions {
            common: CommonPickOptions {
                default_path: Some("/tmp/Reports/report.txt".into()),
                ..Default::default()
            },
            default_filter_index: None,
            create_directories: true,
            darwin: DarwinSaveNamespace::default(),
            win32: Default::default(),
        };
        let (statement, argv) = compose_choose_file_name(&options);
        assert!(statement.contains("default name (item 2 of argv) default location (POSIX file (item 3 of argv))"));
        assert_eq!(argv, vec!["", "report.txt", "/tmp/Reports"]);
    }

    #[test]
    fn parse_output_covers_every_protocol_line() {
        let buttons = vec!["Retry".to_string(), "Abort".to_string()];
        assert_eq!(
            parse_bridge_output("button:Retry\n", &buttons).unwrap(),
            BridgeOutcome::Button(0)
        );
        assert_eq!(
            parse_bridge_output("cancel\n", &buttons).unwrap(),
            BridgeOutcome::Canceled
        );
        assert_eq!(
            parse_bridge_output("path:/tmp/a.txt\n", &[]).unwrap(),
            BridgeOutcome::SinglePath("/tmp/a.txt".into())
        );
        assert_eq!(
            parse_bridge_output("path:/tmp/a.txt\npath:/tmp/b.txt\n", &[]).unwrap(),
            BridgeOutcome::MultiplePaths(vec!["/tmp/a.txt".into(), "/tmp/b.txt".into()])
        );
        assert!(parse_bridge_output("button:Nope\n", &buttons).is_err());
        assert!(parse_bridge_output("garbage\n", &[]).is_err());
    }

    #[test]
    fn display_dialog_custom_icon_swaps_the_icon_clause() {
        // A system-shipped icns verified present on macOS 26 (CoreTypes
        // itself ships no bare .icns on this install).
        const SYSTEM_ICNS: &str = "/System/Library/Image Capture/Support/Icons/module.icns";
        let mut options = message_options(&["OK"]);
        options.darwin.icon = Some(SYSTEM_ICNS.to_string());
        let (statement, argv) = compose_display_dialog(&options).unwrap();
        assert!(statement.contains("with icon (POSIX file (item 6 of argv)) with title (item 5 of argv)"));
        assert_eq!(argv.len(), 6);
        assert_eq!(argv[5], SYSTEM_ICNS);
        // Unreadable path rejects typed before any spawn.
        options.darwin.icon = Some("/nonexistent/icon.png".into());
        let error = compose_display_dialog(&options).unwrap_err();
        assert_eq!(
            error.details.as_ref().and_then(|d| d.get("reason")),
            Some(&serde_json::json!("icon-unreadable"))
        );
    }

    #[test]
    fn triage_completes_on_this_host() {
        // Either verdict is host-dependent (this crate builds ad-hoc in
        // dev); the probe must merely complete without panicking.
        let _ = alert_presentation_available();
    }
}
