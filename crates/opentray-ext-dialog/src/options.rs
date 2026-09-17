//! Dialog command/option/result DTOs (add-ext-dialog design sections 1, 2, 7).
//!
//! Shared, platform-neutral wire shapes. The facade (`@opentray/ext-dialog`)
//! owns preflight validation; the native side re-validates with the same
//! frozen rules (defense in depth) so a malformed frame can never reach a
//! native panel. All structs use `deny_unknown_fields`: an unknown field is
//! a typed `dialog_invalid_options` rejection, never a silent ignore.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Typed error codes of the dialog contract (design section 7.5). Facade
/// preflight owns the first block; broker/native rejections own the rest.
/// The full frozen catalog lives here even when one platform does not emit
/// every code (the win32 surface and the facade map consume the rest).
#[allow(dead_code)]
pub(crate) mod error_code {
    pub const PLATFORM_UNSUPPORTED: &str = "dialog_platform_unsupported";
    pub const PLATFORM_NAMESPACE_MISMATCH: &str = "dialog_platform_namespace_mismatch";
    pub const INVALID_OPTIONS: &str = "dialog_invalid_options";
    pub const SESSION_BUSY: &str = "dialog_session_busy";
    pub const CAPABILITY_UNAVAILABLE: &str = "dialog_capability_unavailable";
    pub const DISMISSAL_UNAVAILABLE: &str = "dialog_dismissal_unavailable";
    pub const PRESENTATION_FAILED: &str = "dialog_presentation_failed";
}

/// Message severity (design section 1.1): icon/sound grading shared by both
/// platforms. macOS maps to `NSAlertStyle`, win32 to the TaskDialog icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DialogSeverity {
    Info,
    Warning,
    Error,
}

impl Default for DialogSeverity {
    fn default() -> Self {
        Self::Info
    }
}

/// One file-type filter group. `extensions` holds bare extensions without a
/// leading dot (case-insensitive); an empty filter list means "all files".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DialogFileFilter {
    pub name: String,
    #[serde(default)]
    pub extensions: Vec<String>,
}

/// `options.darwin` for `messageDialog`: v1 keeps the namespace empty
/// (suppression is already a common capability); the object stays
/// expressible so later fields need no wire break.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DarwinMessageNamespace {
    // v1: intentionally empty (design section 2.1).
}

/// `options.darwin` for `pickFile` (design section 2.1 full table).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DarwinPickFileNamespace {
    #[serde(default)]
    pub can_select_packages: bool,
    #[serde(default)]
    pub treats_file_packages_as_directories: bool,
    #[serde(default = "default_true")]
    pub resolves_aliases: bool,
    #[serde(default)]
    pub include_directories: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_message: Option<String>,
}

/// `options.darwin` for `pickDirectory`: v1 empty.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DarwinPickDirectoryNamespace {
    // v1: intentionally empty.
}

/// `options.darwin` for `pickSavePath` (design section 2.1).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DarwinSaveNamespace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_message: Option<String>,
    #[serde(default)]
    pub allows_other_file_types: bool,
}

// ---------------------------------------------------------------------------
// `options.win32` (design section 2.2, full table). The TaskDialog-exclusive
// switches (`commandLink` buttons, the expander) are capability-gated at
// show time: when the comctl32 v6 surface is unavailable they reject as
// typed `dialog_capability_unavailable`, never silently downgrading to the
// MessageBox fallback.
// ---------------------------------------------------------------------------

/// Message-dialog button rendering (design section 2.2):
/// `commandLink` selects the TaskDialog command-link buttons.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ButtonStyle {
    #[default]
    Standard,
    CommandLink,
}

/// TaskDialog expander (design section 2.2): the collapsed-details control.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Win32ExpanderSpec {
    pub expanded_information: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub expanded_by_default: bool,
}

/// `options.win32` for `messageDialog` (design section 2.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Win32MessageNamespace {
    #[serde(default)]
    pub button_style: ButtonStyle,
    /// Index-aligned button notes; only valid under `commandLink`
    /// (validated by the native re-check with a typed
    /// `dialog_invalid_options` rejection).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub button_hints: Vec<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expander: Option<Win32ExpanderSpec>,
    /// P0-6 frozen default: every closable dialog maps its title-bar/ESC
    /// dismissal through cancellation, independent of `cancelId`.
    #[serde(default = "default_true")]
    pub allow_cancel_on_close: bool,
}

impl Default for Win32MessageNamespace {
    fn default() -> Self {
        Self {
            button_style: ButtonStyle::Standard,
            button_hints: Vec::new(),
            footer: None,
            expander: None,
            allow_cancel_on_close: true,
        }
    }
}

/// `options.win32` for `pickFile` (design section 2.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Win32PickFileNamespace {
    /// `false` adds `FOS_DONTADDTORECENT`.
    #[serde(default = "default_true")]
    pub add_to_recent: bool,
    /// `SetOkButtonLabel`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok_button_label: Option<String>,
}

impl Default for Win32PickFileNamespace {
    fn default() -> Self {
        Self {
            add_to_recent: true,
            ok_button_label: None,
        }
    }
}

/// `options.win32` for `pickDirectory` (design section 2.2): v1 carries
/// only the recent-docs switch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Win32PickDirectoryNamespace {
    #[serde(default = "default_true")]
    pub add_to_recent: bool,
}

impl Default for Win32PickDirectoryNamespace {
    fn default() -> Self {
        Self { add_to_recent: true }
    }
}

/// `options.win32` for `pickSavePath` (design section 2.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Win32SaveNamespace {
    #[serde(default = "default_true")]
    pub add_to_recent: bool,
    /// `FOS_STRICTFILETYPES`: block confirming a mismatched extension.
    #[serde(default)]
    pub strict_file_types: bool,
    /// `SetDefaultExtension`: extension auto-completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_extension: Option<String>,
    /// `SetOkButtonLabel`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok_button_label: Option<String>,
}

impl Default for Win32SaveNamespace {
    fn default() -> Self {
        Self {
            add_to_recent: true,
            strict_file_types: false,
            default_extension: None,
            ok_button_label: None,
        }
    }
}

fn default_true() -> bool {
    true
}

/// The full native command surface (design section 1). The `alert`/`confirm`
/// sugar resolves to `messageDialog` in the facade before dispatch; `getBackend`
/// is an Immediate command, every show command is Deferred.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum DialogCommand {
    MessageDialog(MessageDialogOptions),
    PickFile(PickFileOptions),
    PickDirectory(PickDirectoryOptions),
    PickSavePath(SavePickOptions),
    GetBackend,
}

/// Common pick options shared by every picker command.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommonPickOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<DialogFileFilter>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name_label: Option<String>,
    #[serde(default)]
    pub shows_hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MessageDialogOptions {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Defaults to `["OK"]` when absent (facade always sends an explicit
    /// array; the native default is defense in depth).
    #[serde(default = "default_ok_button")]
    pub buttons: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_id: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel_id: Option<usize>,
    #[serde(default)]
    pub severity: DialogSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suppression_label: Option<String>,
    #[serde(default)]
    pub darwin: DarwinMessageNamespace,
    #[serde(default)]
    pub win32: Win32MessageNamespace,
}

fn default_ok_button() -> Vec<String> {
    vec!["OK".to_string()]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PickFileOptions {
    #[serde(flatten)]
    pub common: CommonPickOptions,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub darwin: DarwinPickFileNamespace,
    #[serde(default)]
    pub win32: Win32PickFileNamespace,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PickDirectoryOptions {
    #[serde(flatten)]
    pub common: CommonPickOptions,
    #[serde(default)]
    pub darwin: DarwinPickDirectoryNamespace,
    #[serde(default)]
    pub win32: Win32PickDirectoryNamespace,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavePickOptions {
    #[serde(flatten)]
    pub common: CommonPickOptions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_filter_index: Option<usize>,
    /// Defaults to `true` (design section 1.1; macOS projects it through
    /// `NSSavePanel.canCreateDirectories`).
    #[serde(default = "default_true")]
    pub create_directories: bool,
    #[serde(default)]
    pub darwin: DarwinSaveNamespace,
    #[serde(default)]
    pub win32: Win32SaveNamespace,
}

/// `MessageDialogResult` (design section 1): the activated button index and
/// the suppression checkbox state. The checkbox is reported, never
/// persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessageDialogResult {
    pub response: usize,
    pub suppressed: bool,
}

/// Backend capability snapshot (design section 7). One frozen DTO schema
/// shared by both platforms; the exhaustive fixture freezes every field per
/// platform so adding a field without updating both projections is red.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DialogBackendCapabilities {
    pub platform: &'static str,
    pub task_dialog: bool,
    pub command_links: bool,
    pub expander: bool,
    pub suppression: bool,
    pub package_semantics: bool,
    pub mixed_file_directory_selection: bool,
    pub add_to_recent_control: bool,
}

impl DialogBackendCapabilities {
    /// The frozen macOS projection (design section 7): NSAlert supplies
    /// suppression; NSOpenPanel supplies package semantics and mixed
    /// file/directory selection. The win32 fields are honestly false on
    /// darwin.
    pub(crate) fn darwin() -> Self {
        Self {
            platform: "darwin",
            task_dialog: false,
            command_links: false,
            expander: false,
            suppression: true,
            package_semantics: true,
            mixed_file_directory_selection: true,
            add_to_recent_control: false,
        }
    }
}

/// Terminal payload value builders (design section 5.1: the one terminal
/// frame carries either a result or a typed error; the cancel path is a
/// result isomorphic to user cancellation).
pub(crate) mod terminal {
    use super::*;

    /// Confirmed `messageDialog` result.
    pub(crate) fn message_result(result: MessageDialogResult) -> Value {
        serde_json::to_value(result).expect("message dialog result is serializable")
    }

    /// Confirmed picker result: an array of absolute paths (`pickFile`).
    pub(crate) fn pick_file_paths(paths: Vec<String>) -> Value {
        Value::Array(paths.into_iter().map(Value::String).collect())
    }

    /// Confirmed single-path picker result (`pickDirectory`/`pickSavePath`).
    pub(crate) fn pick_single_path(path: String) -> Value {
        Value::String(path)
    }

    /// The user-canceled picker result: JSON `null`, not an empty array and
    /// not a rejection (design section 1.2).
    pub(crate) fn picker_canceled() -> Value {
        Value::Null
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_tags_parse_in_camel_case() {
        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "messageDialog",
            "message": "hello"
        }))
        .unwrap();
        assert!(matches!(parsed, DialogCommand::MessageDialog(_)));

        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "pickFile" })).unwrap();
        assert!(matches!(parsed, DialogCommand::PickFile(_)));

        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "pickDirectory" })).unwrap();
        assert!(matches!(parsed, DialogCommand::PickDirectory(_)));

        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "pickSavePath" })).unwrap();
        assert!(matches!(parsed, DialogCommand::PickSavePath(_)));

        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "getBackend" })).unwrap();
        assert!(matches!(parsed, DialogCommand::GetBackend));

        assert!(serde_json::from_value::<DialogCommand>(
            serde_json::json!({ "type": "message_dialog" })
        )
        .is_err());
        assert!(serde_json::from_value::<DialogCommand>(
            serde_json::json!({ "type": "alert" })
        )
        .is_err(), "facade sugar never reaches the native surface");
        assert!(serde_json::from_value::<DialogCommand>(
            serde_json::json!({ "type": "noSuchCommand" })
        )
        .is_err());
    }

    #[test]
    fn unknown_fields_reject_instead_of_silently_ignoring() {
        let raw = serde_json::json!({
            "type": "messageDialog",
            "message": "hello",
            "mystery": true
        });
        let error = serde_json::from_value::<DialogCommand>(raw).unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        let raw = serde_json::json!({
            "type": "messageDialog",
            "message": "hello",
            "win32": { "footer": "x", "notAField": 1 }
        });
        let error = serde_json::from_value::<DialogCommand>(raw).unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        let raw = serde_json::json!({
            "type": "pickFile",
            "multiple": true,
            "darwin": { "canSelectPackages": true, "notAField": 1 }
        });
        assert!(serde_json::from_value::<DialogCommand>(raw).is_err());
    }

    /// The win32 namespace table parses with the frozen defaults (design
    /// section 2.2): `allowCancelOnClose` defaults true (P0-6) and the
    /// TaskDialog-exclusive switches stay off.
    #[test]
    fn win32_namespaces_parse_with_frozen_defaults() {
        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "messageDialog", "message": "hello"
        }))
        .unwrap();
        let DialogCommand::MessageDialog(options) = parsed else {
            panic!("message variant");
        };
        assert_eq!(options.win32.button_style, ButtonStyle::Standard);
        assert!(options.win32.button_hints.is_empty());
        assert_eq!(options.win32.footer, None);
        assert_eq!(options.win32.expander, None);
        assert!(options.win32.allow_cancel_on_close);

        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "messageDialog",
            "message": "save?",
            "buttons": ["Save", "Skip", "Cancel"],
            "win32": {
                "buttonStyle": "commandLink",
                "buttonHints": ["write", null, "discard"],
                "footer": "opentray",
                "expander": {
                    "expandedInformation": "path details",
                    "label": "Details",
                    "expandedByDefault": true
                },
                "allowCancelOnClose": false
            }
        }))
        .unwrap();
        let DialogCommand::MessageDialog(options) = parsed else {
            panic!("message variant");
        };
        assert_eq!(options.win32.button_style, ButtonStyle::CommandLink);
        assert_eq!(options.win32.button_hints.len(), 3);
        assert_eq!(options.win32.button_hints[1], None);
        let expander = options.win32.expander.unwrap();
        assert_eq!(expander.expanded_information, "path details");
        assert_eq!(expander.label.as_deref(), Some("Details"));
        assert!(expander.expanded_by_default);
        assert!(!options.win32.allow_cancel_on_close);

        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "pickSavePath",
            "win32": { "addToRecent": false, "strictFileTypes": true,
                       "defaultExtension": "txt", "okButtonLabel": "Write" }
        }))
        .unwrap();
        let DialogCommand::PickSavePath(options) = parsed else {
            panic!("save variant");
        };
        assert!(!options.win32.add_to_recent);
        assert!(options.win32.strict_file_types);
        assert_eq!(options.win32.default_extension.as_deref(), Some("txt"));
        assert_eq!(options.win32.ok_button_label.as_deref(), Some("Write"));

        // The other pick namespaces default their rows.
        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "pickDirectory" })).unwrap();
        let DialogCommand::PickDirectory(options) = parsed else {
            panic!("directory variant");
        };
        assert!(options.win32.add_to_recent);
    }

    #[test]
    fn message_defaults_and_darwin_defaults_parse() {
        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "messageDialog",
            "message": "disk full"
        }))
        .unwrap();
        let DialogCommand::MessageDialog(options) = parsed else {
            panic!("message dialog variant");
        };
        assert_eq!(options.buttons, vec!["OK".to_string()]);
        assert_eq!(options.default_id, None);
        assert_eq!(options.cancel_id, None);
        assert_eq!(options.severity, DialogSeverity::Info);

        let parsed: DialogCommand = serde_json::from_value(serde_json::json!({
            "type": "pickFile",
            "darwin": {}
        }))
        .unwrap();
        let DialogCommand::PickFile(options) = parsed else {
            panic!("pick file variant");
        };
        // resolvesAliases defaults to true; the rest default false/absent.
        assert!(options.darwin.resolves_aliases);
        assert!(!options.darwin.can_select_packages);
        assert!(!options.darwin.treats_file_packages_as_directories);
        assert!(!options.darwin.include_directories);
        assert!(!options.common.shows_hidden);
        assert!(!options.multiple);
    }

    #[test]
    fn save_defaults_keep_create_directories_true() {
        let parsed: DialogCommand =
            serde_json::from_value(serde_json::json!({ "type": "pickSavePath" })).unwrap();
        let DialogCommand::PickSavePath(options) = parsed else {
            panic!("pick save variant");
        };
        assert!(options.create_directories);
        assert!(!options.darwin.allows_other_file_types);
    }

    #[test]
    fn darwin_backend_capabilities_fixture_is_frozen() {
        let backend = DialogBackendCapabilities::darwin();
        assert_eq!(
            serde_json::to_value(&backend).unwrap(),
            serde_json::json!({
                "platform": "darwin",
                "taskDialog": false,
                "commandLinks": false,
                "expander": false,
                "suppression": true,
                "packageSemantics": true,
                "mixedFileDirectorySelection": true,
                "addToRecentControl": false
            })
        );
        // Exhaustive field fixture: every DTO field appears exactly once in
        // the wire shape, so a new field without a fixture update is red.
        let wire = serde_json::to_value(&backend).unwrap();
        let object = wire.as_object().expect("backend DTO object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "addToRecentControl",
                "commandLinks",
                "expander",
                "mixedFileDirectorySelection",
                "packageSemantics",
                "platform",
                "suppression",
                "taskDialog",
            ]
        );
    }

    #[test]
    fn terminal_payload_builders_match_the_frozen_wire_semantics() {
        assert_eq!(
            terminal::message_result(MessageDialogResult {
                response: 1,
                suppressed: true
            }),
            serde_json::json!({ "response": 1, "suppressed": true })
        );
        assert_eq!(
            terminal::pick_file_paths(vec!["/a".to_string(), "/b".to_string()]),
            serde_json::json!(["/a", "/b"])
        );
        assert_eq!(
            terminal::pick_single_path("/a/b.txt".to_string()),
            serde_json::json!("/a/b.txt")
        );
        assert_eq!(terminal::picker_canceled(), serde_json::json!(null));
    }
}
