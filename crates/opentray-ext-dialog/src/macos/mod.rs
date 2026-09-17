//! macOS dialog surface (add-ext-dialog tasks 3.1/3.2/3.4).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: the
//! broker event loop must never block inside a native modal call, and
//! scheduling authority must stay broker-owned):
//! 1. A show command only constructs the AppKit panel and calls
//!    `beginModalSessionForWindow` — never `runModal` (a blocking call on
//!    the owner loop is the law violation this design exists to prevent).
//! 2. `step` advances one `runModalSession` quantum; every AppKit object
//!    lives on the main thread only.
//! 3. ESC/title-bar close/system dismissal collapse into the modal return
//!    code; the shared mapping in `state.rs` resolves every code to a
//!    caller index or the picker cancel branch.
//! 4. Teardown order: CAS the record out, then stop/end the modal session,
//!    then submit the terminal through the deferred port (design section
//!    5.4).
//!
//! Compromise: `canSelectPackages` has NO selector on the modern macOS
//! runtime (probe evidence 2026-09-17: `respondsToSelector:` returns false
//! for both `setCanSelectPackages:` and `canSelectPackages`; Apple removed
//! the soft-deprecated property in favor of `allowedContentTypes`). The
//! design-section-2.1 capability is projected the Apple-documented way
//! instead: `canSelectPackages: true` appends `UTTypePackage` to
//! `allowedContentTypes` when a filter list is in effect; with "all files"
//! (no filters) the flag has no modern equivalent and stays a documented
//! no-op degradation. Every AppKit call in this module is a typed
//! objc2-app-kit binding (no raw `msg_send!`).

use objc2::rc::Retained;
use objc2::{ClassType, MainThreadMarker};
use objc2_app_kit::NSModalSession;
use objc2_app_kit::{
    NSAlert, NSAlertStyle, NSApplication, NSModalResponseContinue, NSModalResponseOK,
    NSOpenPanel, NSSavePanel, NSWindow,
};
use objc2_foundation::{NSArray, NSString, NSURL};
use objc2_uniform_type_identifiers::{UTType, UTTypePackage};
use opentray_spec::ExtOperationPayload;

use crate::options::error_code;
use crate::options::{
    terminal, CommonPickOptions, DarwinPickFileNamespace, DialogFileFilter,
    DialogSeverity, MessageDialogOptions, MessageDialogResult, SavePickOptions,
};
use crate::state::{
    alert_response_from_modal_code, canonicalize_existing, canonicalize_save_leaf,
    split_default_path, typed_error, ModalKind,
};

/// One native modal session. Constructed on the main thread by [`begin`];
/// consumed by [`finish`] (natural completion) or [`revoke`] (session
/// close/deinit). Never crosses threads.
pub(crate) struct NativeModal {
    panel: NativePanel,
    session: Option<NSModalSession>,
}

enum NativePanel {
    Alert {
        alert: Retained<NSAlert>,
        button_count: usize,
        suppression: bool,
    },
    Open {
        panel: Retained<NSOpenPanel>,
        multiple: bool,
    },
    Save {
        panel: Retained<NSSavePanel>,
    },
}

/// One `poll_owner` step outcome: the session keeps running, or it ended
/// with the modal return code (button activation, picker OK/cancel, or a
/// forced `stopModalWithCode` dismissal).
pub(crate) enum ModalStep {
    Continue,
    Ended(isize),
}

fn require_main_thread() -> Result<MainThreadMarker, opentray_spec::TypedExtensionError> {
    MainThreadMarker::new().ok_or_else(|| {
        typed_error(
            error_code::PRESENTATION_FAILED,
            "dialog dispatch requires the broker main (owner-loop) thread",
        )
    })
}

/// Constructs the AppKit surface for one show command and begins the modal
/// session. Returns `Err` for typed pre-Accept failures (no Accepted
/// frame, no operation, no terminal).
pub(crate) fn begin(kind: &ModalKind) -> Result<NativeModal, opentray_spec::TypedExtensionError> {
    let mtm = require_main_thread()?;
    let app = NSApplication::sharedApplication(mtm);
    let (panel, session) = match kind {
        ModalKind::Message(options) => {
            let alert = build_alert(options, mtm);
            let session = app.beginModalSessionForWindow(&alert.window());
            (
                NativePanel::Alert {
                    alert,
                    button_count: options.buttons.len(),
                    suppression: options.suppression_label.is_some(),
                },
                session,
            )
        }
        ModalKind::PickFile(options) => {
            let panel = build_open_panel(
                &options.common,
                mtm,
                // pickFile: files always choosable; includeDirectories adds
                // directories (design section 2.1 mixed selection).
                true,
                options.darwin.include_directories,
                options.multiple,
                Some(&options.darwin),
            );
            let session = app.beginModalSessionForWindow(open_panel_window(&panel));
            (
                NativePanel::Open {
                    panel,
                    multiple: options.multiple,
                },
                session,
            )
        }
        ModalKind::PickDirectory(options) => {
            let panel = build_open_panel(
                &options.common,
                mtm,
                // pickDirectory: directories only, single selection.
                false,
                true,
                false,
                None,
            );
            let session = app.beginModalSessionForWindow(open_panel_window(&panel));
            (
                NativePanel::Open {
                    panel,
                    multiple: false,
                },
                session,
            )
        }
        ModalKind::PickSavePath(options) => {
            let panel = build_save_panel(options, mtm);
            let session = app.beginModalSessionForWindow(save_panel_window(&panel));
            (NativePanel::Save { panel }, session)
        }
    };
    if session.is_null() {
        return Err(typed_error(
            error_code::PRESENTATION_FAILED,
            "beginModalSessionForWindow returned no session",
        ));
    }
    Ok(NativeModal {
        panel,
        session: Some(session),
    })
}

/// Advances the modal session by one `runModalSession` quantum. This is
/// the only step entry the broker's `poll_owner` calls; each quantum
/// returns so menu/transport frames keep flowing between steps.
pub(crate) fn step(
    native: &mut NativeModal,
) -> Result<ModalStep, opentray_spec::TypedExtensionError> {
    let mtm = require_main_thread()?;
    let Some(session) = native.session else {
        // Already torn down: nothing to step, nothing ended here.
        return Ok(ModalStep::Continue);
    };
    let app = NSApplication::sharedApplication(mtm);
    // SAFETY: the session came from `beginModalSessionForWindow` on this
    // same (main) thread and has not been ended (taken above).
    let code = unsafe { app.runModalSession(session) };
    if code == NSModalResponseContinue {
        Ok(ModalStep::Continue)
    } else {
        Ok(ModalStep::Ended(code))
    }
}

/// Extracts the terminal payload from an ENDED session. Must run before
/// [`finish`]: the alert suppression state and the panel URLs are read
/// from the still-alive panel.
pub(crate) fn extract_terminal(
    native: &NativeModal,
    kind: &ModalKind,
    code: isize,
) -> ExtOperationPayload {
    let confirmed = code == NSModalResponseOK;
    match (&native.panel, kind) {
        (
            NativePanel::Alert {
                alert,
                button_count,
                suppression,
            },
            ModalKind::Message(options),
        ) => {
            let response =
                alert_response_from_modal_code(code, *button_count, options.cancel_id);
            let suppressed = *suppression
                && alert
                    .suppressionButton()
                    .is_some_and(|button| button.state() == objc2_app_kit::NSControlStateValueOn);
            ExtOperationPayload::Result {
                value: terminal::message_result(MessageDialogResult {
                    response,
                    suppressed,
                }),
            }
        }
        (NativePanel::Open { panel, multiple }, _) => {
            if !confirmed {
                return ExtOperationPayload::Result {
                    value: terminal::picker_canceled(),
                };
            }
            let paths: Vec<String> = panel
                .URLs()
                .iter()
                .filter_map(|url| url.path().map(|path| path.to_string()))
                .map(|path| canonicalize_existing(&path))
                .collect();
            let value = if paths.is_empty() {
                // Defensive: an empty OK confirmation maps to the cancel
                // branch (a multiple confirmation carries at least one
                // entry by contract).
                terminal::picker_canceled()
            } else if *multiple {
                terminal::pick_file_paths(paths)
            } else {
                terminal::pick_file_paths(vec![paths[0].clone()])
            };
            ExtOperationPayload::Result { value }
        }
        (NativePanel::Save { panel }, _) => {
            if !confirmed {
                return ExtOperationPayload::Result {
                    value: terminal::picker_canceled(),
                };
            }
            let value = panel
                .URL()
                .and_then(|url| url.path().map(|path| path.to_string()))
                .map(|path| terminal::pick_single_path(canonicalize_save_leaf(&path)))
                .unwrap_or_else(terminal::picker_canceled);
            ExtOperationPayload::Result { value }
        }
        // Panel kinds and modal kinds are constructed in lockstep by
        // `begin`; the cross combinations are unconstructible.
        _ => ExtOperationPayload::Result {
            value: terminal::picker_canceled(),
        },
    }
}

/// Natural-completion teardown: the session already returned a terminal
/// code; release it and drop the panel.
pub(crate) fn finish(native: NativeModal) {
    let mut native = native;
    if let (Some(mtm), Some(session)) = (MainThreadMarker::new(), native.session.take()) {
        let app = NSApplication::sharedApplication(mtm);
        // SAFETY: the session ended with a terminal response; ending it
        // releases the modal bookkeeping.
        unsafe { app.endModalSession(session) };
    }
    drop(native.panel);
}

/// Revoke teardown (session close / deinit): the session may still be
/// stepping, so request a stop first (`stopModalWithCode` — the internal
/// mechanism ESC/title-bar close route through), then end the session.
pub(crate) fn revoke(native: NativeModal) {
    let mut native = native;
    if let (Some(mtm), Some(session)) = (MainThreadMarker::new(), native.session.take()) {
        let app = NSApplication::sharedApplication(mtm);
        app.stopModalWithCode(-1001); // NSModalResponseAbort
        // SAFETY: stop was requested; the session teardown is complete.
        unsafe { app.endModalSession(session) };
    }
    drop(native.panel);
}

/// NSOpenPanel -> NSSavePanel -> NSPanel -> NSWindow superclass chain.
fn open_panel_window(panel: &NSOpenPanel) -> &NSWindow {
    panel.as_super().as_super().as_super()
}

/// NSSavePanel -> NSPanel -> NSWindow superclass chain.
fn save_panel_window(panel: &NSSavePanel) -> &NSWindow {
    panel.as_super().as_super()
}

fn build_alert(options: &MessageDialogOptions, mtm: MainThreadMarker) -> Retained<NSAlert> {
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(&options.message));
    if let Some(detail) = &options.detail {
        alert.setInformativeText(&NSString::from_str(detail));
    }
    alert.setAlertStyle(match options.severity {
        DialogSeverity::Info => NSAlertStyle::Informational,
        DialogSeverity::Warning => NSAlertStyle::Warning,
        DialogSeverity::Error => NSAlertStyle::Critical,
    });
    for button in &options.buttons {
        alert.addButtonWithTitle(&NSString::from_str(button));
    }
    // defaultId owns the Return-key activation (design section 1.1).
    // NSAlert gives Return to the first button by default; reassign it to
    // the caller's defaultId through the documented key-equivalent API so
    // the visible order and the response indexes stay caller-owned.
    let default_index = options.default_id.unwrap_or(0);
    for (index, button) in alert.buttons().iter().enumerate() {
        let equivalent = if index == default_index { "\r" } else { "" };
        button.setKeyEquivalent(&NSString::from_str(equivalent));
    }
    if let Some(label) = &options.suppression_label {
        alert.setShowsSuppressionButton(true);
        if let Some(button) = alert.suppressionButton() {
            button.setTitle(&NSString::from_str(label));
        }
    }
    alert
}

fn build_open_panel(
    common: &CommonPickOptions,
    mtm: MainThreadMarker,
    can_choose_files: bool,
    can_choose_directories: bool,
    multiple: bool,
    darwin: Option<&DarwinPickFileNamespace>,
) -> Retained<NSOpenPanel> {
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(can_choose_files);
    panel.setCanChooseDirectories(can_choose_directories);
    panel.setAllowsMultipleSelection(multiple);
    panel.setShowsHiddenFiles(common.shows_hidden);
    match darwin {
        Some(darwin) => {
            panel.setResolvesAliases(darwin.resolves_aliases);
            panel.setTreatsFilePackagesAsDirectories(darwin.treats_file_packages_as_directories);
            if let Some(message) = &darwin.panel_message {
                let text = NSString::from_str(message);
                panel.setMessage(Some(&text));
            }
        }
        None => panel.setResolvesAliases(true),
    }
    apply_common_panel_options(common, &panel);
    // canSelectPackages projection (see module law): the selector is gone
    // from the modern runtime, so the Apple-documented replacement appends
    // UTTypePackage to the effective type list — only expressible when a
    // filter list is in effect ("all files" + packages has no modern
    // equivalent; documented no-op degradation).
    let wants_packages = darwin.is_some_and(|darwin| darwin.can_select_packages);
    if let Some((types, _)) = resolved_type_plan(common_filters(common), resolve_uttype) {
        let mut entries: Vec<&UTType> = types.iter().map(|typed| &**typed).collect();
        if wants_packages {
            // SAFETY: UTTypePackage is an Apple-declared extern static
            // (com.apple.package); reading it once on the main thread here
            // matches every generated-framework use.
            entries.push(unsafe { UTTypePackage });
        }
        let array = NSArray::from_slice(&entries);
        panel.setAllowedContentTypes(&array);
    }
    panel
}

fn build_save_panel(options: &SavePickOptions, mtm: MainThreadMarker) -> Retained<NSSavePanel> {
    let panel = NSSavePanel::savePanel(mtm);
    panel.setShowsHiddenFiles(options.common.shows_hidden);
    // createDirectories defaults to true (design section 1.1): macOS
    // projects the common switch through canCreateDirectories.
    panel.setCanCreateDirectories(options.create_directories);
    panel.setAllowsOtherFileTypes(options.darwin.allows_other_file_types);
    if let Some(message) = &options.darwin.panel_message {
        let text = NSString::from_str(message);
        panel.setMessage(Some(&text));
    }
    apply_common_panel_options(&options.common, &panel);
    if let Some((types, group_first)) =
        resolved_type_plan(common_filters(&options.common), resolve_uttype)
    {
        let array = NSArray::from_retained_slice(&types);
        panel.setAllowedContentTypes(&array);
        // defaultFilterIndex selects the first UTType of that filter group
        // (AppKit shows a flat type list; groups are the caller's
        // organization). An out-of-range index is a facade-validation
        // leak and is ignored, never fatal.
        if let Some(index) = options.default_filter_index {
            if let Some(&first) = group_first.get(index) {
                panel.setCurrentContentType(Some(&types[first]));
            }
        }
    }
    panel
}

fn common_filters(common: &CommonPickOptions) -> Option<&Vec<DialogFileFilter>> {
    common.filters.as_ref().filter(|list| !list.is_empty())
}

fn apply_common_panel_options(common: &CommonPickOptions, panel: &NSSavePanel) {
    if let Some(title) = &common.title {
        let text = NSString::from_str(title);
        panel.setTitle(Some(&text));
    }
    if let Some(label) = &common.file_name_label {
        let text = NSString::from_str(label);
        panel.setNameFieldLabel(Some(&text));
    }
    let (directory, file_name) = split_default_path(common.default_path.as_deref().unwrap_or(""));
    if let Some(directory) = directory {
        let text = NSString::from_str(&directory);
        panel.setDirectoryURL(Some(&NSURL::fileURLWithPath(&text)));
    }
    if let Some(file_name) = file_name {
        // Only the save panel pre-fills the file name; for open panels the
        // leaf is meaningless and NSOpenPanel ignores it safely (the
        // shared option set keeps one defaultPath field).
        let text = NSString::from_str(&file_name);
        panel.setNameFieldStringValue(&text);
    }
}

/// The per-extension UTType resolver. Unknown extensions resolve to a
/// dynamic UTType inside `UTTypeCreateFromExtension`; a `None` (not
/// expected) skips the extension.
fn resolve_uttype(bare: &str) -> Option<Retained<UTType>> {
    UTType::typeWithFilenameExtension(&NSString::from_str(bare))
}

/// Flattens filter groups through `resolve`, tracking each group's first
/// resolved entry. Empty extensions and unresolved entries are skipped; a
/// filter list that resolves to nothing yields `None` (= "all files",
/// never an inverted empty restriction).
fn resolved_type_plan<T>(
    filters: Option<&Vec<DialogFileFilter>>,
    resolve: impl Fn(&str) -> Option<T>,
) -> Option<(Vec<T>, Vec<usize>)> {
    let filters = filters?;
    let mut types = Vec::new();
    let mut group_first = Vec::new();
    for group in filters {
        // A group whose extensions all fail to resolve anchors the next
        // group's first entry; selecting it as the default filter is then
        // a harmless no-op.
        group_first.push(types.len());
        for extension in &group.extensions {
            let bare = extension.trim_start_matches('.');
            if bare.is_empty() {
                continue;
            }
            if let Some(typed) = resolve(bare) {
                types.push(typed);
            }
        }
    }
    if types.is_empty() {
        None
    } else {
        Some((types, group_first))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The flatten plan is pure: resolver-independent group anchoring and
    /// skip semantics are testable off the main thread.
    #[test]
    fn filter_flatten_plan_anchors_each_groups_first_resolved_type() {
        let groups = vec![
            DialogFileFilter {
                name: "Images".to_string(),
                extensions: vec!["png".to_string(), ".jpg".to_string(), "" .to_string()],
            },
            DialogFileFilter {
                name: "Broken".to_string(),
                extensions: vec!["zzz".to_string()],
            },
            DialogFileFilter {
                name: "Text".to_string(),
                extensions: vec!["txt".to_string()],
            },
        ];

        // Resolver that only knows png/jpg/txt.
        let resolve = |ext: &str| -> Option<&'static str> {
            match ext {
                "png" | "jpg" | "txt" => Some("type"),
                _ => None,
            }
        };
        let (types, group_first) =
            resolved_type_plan(Some(&groups), resolve).expect("some types resolve");
        assert_eq!(types.len(), 3, "leading dots and empties are skipped");
        assert_eq!(
            group_first,
            vec![0, 2, 2],
            "a fully-unresolved group anchors the next group's first entry"
        );

        // Nothing resolves: no restriction (all files).
        let none = |_ext: &str| -> Option<&'static str> { None };
        assert!(resolved_type_plan(Some(&groups), none).is_none());
        // Absent filters: no restriction.
        assert!(resolved_type_plan(None, resolve).is_none());
        // Empty extension list: no restriction, never an empty array.
        let empty = vec![DialogFileFilter {
            name: "Empty".to_string(),
            extensions: vec![],
        }];
        assert!(resolved_type_plan(Some(&empty), resolve).is_none());
    }
}
