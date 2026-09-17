//! Dialog instance state (add-ext-dialog design sections 5.2/5.4/5.5).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: one
//! modal dialog per owner scope, session-close revocation that settles
//! through the cancel branch, and terminals that only ever travel through
//! the deferred port):
//! 1. Busy law: at most one ACTIVE dialog per `(appId, trayId, sessionId)`;
//!    the second show rejects with typed `dialog_session_busy` before any
//!    state change.
//! 2. Terminal law: the deferred port is the one terminal channel; poll
//!    never produces one.
//! 3. Revoke order (design section 5.4): CAS the modal out of the active
//!    set first, then tear down the native session, then submit the
//!    cancel-branch payload, then drop bookkeeping.
//! 4. The port is stored BY VALUE (only `port_data` + `submit` are kept);
//!    the host does not guarantee the struct address outlives the attach
//!    call.
//!
//! Compromise: the busy/terminal bookkeeping and the native AppKit/Win32
//! modal live in the same per-instance struct because they share one owner
//! thread (the broker dispatches commands and polls on the same thread);
//! splitting them would require cross-thread sharing that the design
//! forbids.

use std::collections::HashMap;
use std::ffi::c_void;

use opentray_spec::{
    CommandScope, ExtDeferredPortSubmitV1, ExtDeferredPortV1, ExtOperationPayload,
    TypedExtensionError, EXT_DEFERRED_PORT_ABI_V1, EXTENSION_EVENT_RECORD_MAX_BYTES,
};
use serde_json::Value;

use crate::options::{error_code, DialogCommand, MessageDialogOptions, MessageDialogResult};

/// A by-value copy of the attached deferred port (design section 5.1):
/// only `port_data` and the `submit` entry point are retained; the host
/// guarantees the process-lifetime of `port_data`, never of the struct.
pub(crate) struct DeferredPortCopy {
    port_data: *mut c_void,
    submit: ExtDeferredPortSubmitV1,
}

impl DeferredPortCopy {
    /// Validates the host-provided port (nested ABI version + struct size)
    /// before copying it. A mismatch is a typed rejection, never a silent
    /// downgrade (EventPort-family law).
    pub(crate) fn from_port(port: &ExtDeferredPortV1) -> Result<Self, TypedExtensionError> {
        if port.abi_version != EXT_DEFERRED_PORT_ABI_V1 {
            return Err(typed_error(
                "deferred_port_abi_incompatible",
                format!(
                    "deferred port ABI version {} does not match {}",
                    port.abi_version, EXT_DEFERRED_PORT_ABI_V1
                ),
            ));
        }
        if port.struct_size as usize != std::mem::size_of::<ExtDeferredPortV1>() {
            return Err(typed_error(
                "deferred_port_abi_incompatible",
                format!(
                    "deferred port struct size {} does not match {}",
                    port.struct_size,
                    std::mem::size_of::<ExtDeferredPortV1>()
                ),
            ));
        }
        if port.port_data.is_null() {
            return Err(typed_error(
                "deferred_port_abi_incompatible",
                "deferred port carries a null port_data pointer",
            ));
        }
        Ok(Self {
            port_data: port.port_data,
            submit: port.submit,
        })
    }

    /// Submits the single terminal payload for one operation handle.
    /// Returns the raw FFI result code; every caller treats non-OK codes as
    /// an already-diagnosed host decision (the port was revoked or the
    /// operation ended with the transport) and never retries.
    pub(crate) fn submit(&self, handle: u64, payload: &ExtOperationPayload) -> i32 {
        let Ok(bytes) = serde_json::to_vec(payload) else {
            return opentray_spec::EXT_ERR_INTERNAL;
        };
        if bytes.len() > EXTENSION_EVENT_RECORD_MAX_BYTES {
            return opentray_spec::EXT_ERR_OVERSIZED;
        }
        unsafe { (self.submit)(self.port_data, handle, bytes.as_ptr(), bytes.len()) }
    }

    /// Clones the copy for a worker thread (win32 STA path): the by-value
    /// law keeps only `port_data` + `submit`, both broker-owned
    /// process-lifetime state, so the clone is the same honest pair. The
    /// sender wraps it in the windows module's Send shim.
    pub(crate) fn clone_pair(&self) -> DeferredPortCopy {
        DeferredPortCopy {
            port_data: self.port_data,
            submit: self.submit,
        }
    }
}

/// The parsed request of one active modal. Kept next to the native handle so
/// the response mapping (button indexes, suppression, picker shaping) always
/// uses the options the caller sent. `Clone` is the win32 worker channel:
/// the copyable request data that legitimately crosses threads (design
/// section 5.3's thread law).
#[derive(Clone)]
pub(crate) enum ModalKind {
    Message(MessageDialogOptions),
    PickFile(crate::options::PickFileOptions),
    PickDirectory(crate::options::PickDirectoryOptions),
    PickSavePath(crate::options::SavePickOptions),
}

impl ModalKind {
    /// The command label used in typed error details.
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Message(_) => "messageDialog",
            Self::PickFile(_) => "pickFile",
            Self::PickDirectory(_) => "pickDirectory",
            Self::PickSavePath(_) => "pickSavePath",
        }
    }

    /// Builds the modal kind from the parsed show command (the facade sugar
    /// never reaches this surface).
    pub(crate) fn from_command(command: &DialogCommand) -> Option<Self> {
        match command {
            DialogCommand::MessageDialog(options) => Some(Self::Message(options.clone())),
            DialogCommand::PickFile(options) => Some(Self::PickFile(options.clone())),
            DialogCommand::PickDirectory(options) => Some(Self::PickDirectory(options.clone())),
            DialogCommand::PickSavePath(options) => Some(Self::PickSavePath(options.clone())),
            DialogCommand::GetBackend => None,
        }
    }
}

/// The platform-owned native modal state. The macOS variant holds the
/// AppKit panel and its `NSModalSession`; the win32 variant (task 3.3)
/// registers here when that module lands.
pub(crate) enum NativeState {
    #[cfg(target_os = "macos")]
    Macos(crate::macos::NativeModal),
}

/// One active dialog: the broker-issued operation handle, the owning scope,
/// the parsed request, and the native modal (absent once the modal has been
/// CAS'd out through completion or revocation).
pub(crate) struct ActiveModal {
    pub(crate) handle: u64,
    pub(crate) scope: CommandScope,
    pub(crate) kind: ModalKind,
    pub(crate) native: Option<NativeState>,
}

/// The busy-registry key: design section 5.4's "at most one active dialog
/// per (appId, trayId, sessionId)".
fn scope_key(scope: &CommandScope) -> (String, String, String) {
    (
        scope.app_id.clone(),
        scope.tray_id.clone(),
        scope.session_id.clone(),
    )
}

/// Per-mount dialog instance created by `opentray_ext_init`. All methods run
/// on the broker's owner/dispatch thread; nothing crosses threads.
pub(crate) struct DialogInstance {
    pub(crate) port: Option<DeferredPortCopy>,
    /// Active modals indexed by operation handle.
    modals: HashMap<u64, ActiveModal>,
}

impl DialogInstance {
    pub(crate) fn new() -> Self {
        Self {
            port: None,
            modals: HashMap::new(),
        }
    }

    /// True when the scope already shows a dialog (typed busy law). Called
    /// BEFORE any state change so a rejection never mutates state.
    pub(crate) fn is_busy(&self, scope: &CommandScope) -> bool {
        self.modals
            .values()
            .any(|modal| scope_key(&modal.scope) == scope_key(scope))
    }

    /// Reserves the scope and registers the active modal (single-threaded
    /// CAS: the caller checked `is_busy` immediately before, and both run
    /// on the owner thread with no interleaving).
    pub(crate) fn register_modal(
        &mut self,
        handle: u64,
        scope: CommandScope,
        kind: ModalKind,
        native: NativeState,
    ) {
        self.modals.insert(
            handle,
            ActiveModal {
                handle,
                scope,
                kind,
                native: Some(native),
            },
        );
    }

    /// Active (registered) modal count — test/diagnostic accessor.
    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.modals.len()
    }

    pub(crate) fn find_modal(&self, handle: u64) -> Option<&ActiveModal> {
        self.modals.get(&handle)
    }

    pub(crate) fn find_modal_mut(&mut self, handle: u64) -> Option<&mut ActiveModal> {
        self.modals.get_mut(&handle)
    }

    /// Takes the native modal out of one record (the "CAS first" half of
    /// the revoke order): the record stays until the caller finishes the
    /// teardown+terminal sequence, but it can never step again.
    pub(crate) fn take_native(&mut self, handle: u64) -> Option<NativeState> {
        self.modals.get_mut(&handle)?.native.take()
    }

    /// Removes the finished record entirely.
    pub(crate) fn remove_modal(&mut self, handle: u64) -> Option<ActiveModal> {
        self.modals.remove(&handle)
    }

    /// All active operation handles owned by one session, ascending handle
    /// order for deterministic teardown.
    pub(crate) fn handles_for_session(&self, session_id: &str) -> Vec<u64> {
        let mut handles: Vec<u64> = self
            .modals
            .values()
            .filter(|modal| modal.scope.session_id == session_id)
            .map(|modal| modal.handle)
            .collect();
        handles.sort_unstable();
        handles
    }

    fn handles_for_all(&self) -> Vec<u64> {
        let mut handles: Vec<u64> = self.modals.keys().copied().collect();
        handles.sort_unstable();
        handles
    }
}

impl Default for DialogInstance {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for DialogInstance {
    fn drop(&mut self) {
        // Deinit law: tear down every still-active native modal without
        // submitting terminals. The host revokes the deferred port before
        // deinit (DynamicExtensionInstance::drop), so a submit here could
        // only observe PORT_CLOSED; skipping it keeps teardown side-effect
        // free.
        for handle in self.handles_for_all() {
            if let Some(native) = self.take_native(handle) {
                match native {
                    #[cfg(target_os = "macos")]
                    NativeState::Macos(inner) => crate::macos::revoke(inner),
                }
            }
        }
    }
}

pub(crate) fn typed_error(code: &str, message: impl Into<String>) -> TypedExtensionError {
    TypedExtensionError {
        code: code.to_string(),
        message: message.into(),
        details: None,
    }
}

pub(crate) fn typed_error_with_details(
    code: &str,
    message: impl Into<String>,
    details: Value,
) -> TypedExtensionError {
    TypedExtensionError {
        code: code.to_string(),
        message: message.into(),
        details: Some(details),
    }
}

pub(crate) fn busy_error(scope: &CommandScope, label: &str) -> TypedExtensionError {
    typed_error_with_details(
        error_code::SESSION_BUSY,
        format!(
            "owner already shows a dialog ({label}); at most one active dialog per \
             (appId, trayId, sessionId)"
        ),
        serde_json::json!({
            "kind": "owner",
            "appId": scope.app_id,
            "trayId": scope.tray_id,
            "sessionId": scope.session_id,
        }),
    )
}

/// Native-side option validation (design section 1.2, frozen P0-6): the
/// facade validates first; this is the defense-in-depth re-check so a
/// malformed frame can never construct a panel. Fails before any state
/// change.
pub(crate) fn validate_show_command(command: &DialogCommand) -> Result<(), TypedExtensionError> {
    let DialogCommand::MessageDialog(options) = command else {
        // Picker options carry no index invariants in v1.
        return Ok(());
    };
    if options.buttons.is_empty() {
        return Err(typed_error_with_details(
            error_code::INVALID_OPTIONS,
            "messageDialog requires a non-empty buttons array",
            serde_json::json!({ "field": "buttons", "reason": "empty" }),
        ));
    }
    let len = options.buttons.len();
    if let Some(default_id) = options.default_id {
        if default_id >= len {
            return Err(typed_error_with_details(
                error_code::INVALID_OPTIONS,
                format!("defaultId {default_id} is outside the buttons range 0..{len}"),
                serde_json::json!({ "field": "defaultId", "index": default_id, "buttons": len }),
            ));
        }
    }
    if let Some(cancel_id) = options.cancel_id {
        if cancel_id >= len {
            return Err(typed_error_with_details(
                error_code::INVALID_OPTIONS,
                format!("cancelId {cancel_id} is outside the buttons range 0..{len}"),
                serde_json::json!({ "field": "cancelId", "index": cancel_id, "buttons": len }),
            ));
        }
    }
    Ok(())
}

/// Dismissal mapping (design sections 1.2/5.4, four-way consistency):
/// NSAlert button activations arrive as `NSAlertFirstButtonReturn (1000) +
/// index`; any non-button terminal code (a forced `stopModalWithCode:` —
/// the mechanism ESC/title-bar close/system dismissal use internally) maps
/// to `cancelId`, or button 0 when the caller did not define one. The
/// mapping is total: every observable code resolves to a caller index.
pub(crate) fn alert_response_from_modal_code(
    code: isize,
    buttons_len: usize,
    cancel_id: Option<usize>,
) -> usize {
    const FIRST_BUTTON_RETURN: isize = 1000; // NSAlertFirstButtonReturn (frozen)
    if code >= FIRST_BUTTON_RETURN {
        let index = (code - FIRST_BUTTON_RETURN) as usize;
        if index < buttons_len {
            return index;
        }
    }
    cancel_id.unwrap_or(0)
}

/// The cancel-branch result of one modal kind: isomorphic to user
/// cancellation by design (never a rejection, never a success).
pub(crate) fn cancel_payload(kind: &ModalKind) -> ExtOperationPayload {
    match kind {
        ModalKind::Message(options) => {
            let response = options.cancel_id.unwrap_or(0);
            ExtOperationPayload::Result {
                value: crate::options::terminal::message_result(MessageDialogResult {
                    response,
                    suppressed: false,
                }),
            }
        }
        _ => ExtOperationPayload::Result {
            value: crate::options::terminal::picker_canceled(),
        },
    }
}

/// Canonicalizes a confirmed existing selection (file/directory pickers):
/// the absolute realpath when the path exists; the lexical absolute form
/// when the file vanished between confirmation and canonicalization.
pub(crate) fn canonicalize_existing(raw: &str) -> String {
    let path = std::path::Path::new(raw);
    if let Ok(canonical) = path.canonicalize() {
        return canonical.to_string_lossy().into_owned();
    }
    lexical_absolute(path)
}

/// Canonicalizes a `pickSavePath` result (the save leaf need not exist):
/// canonicalize the parent directory, then rejoin the leaf lexically
/// (design section 4.3 facade law, mirrored natively so the wire value is
/// already the final form).
pub(crate) fn canonicalize_save_leaf(raw: &str) -> String {
    let path = std::path::Path::new(raw);
    let Some(file_name) = path.file_name() else {
        return lexical_absolute(path);
    };
    let Some(parent) = path.parent() else {
        return lexical_absolute(path);
    };
    if let Ok(canonical_parent) = parent.canonicalize() {
        return canonical_parent
            .join(file_name)
            .to_string_lossy()
            .into_owned();
    }
    lexical_absolute(path)
}

fn lexical_absolute(path: &std::path::Path) -> String {
    if path.is_absolute() {
        path.to_string_lossy().into_owned()
    } else {
        let cwd = std::env::current_dir().unwrap_or_default();
        cwd.join(path).to_string_lossy().into_owned()
    }
}

/// Splits a `defaultPath` into the starting directory and (for save panels)
/// the pre-filled file name. A path ending in a separator, or an existing
/// directory, has no leaf.
pub(crate) fn split_default_path(raw: &str) -> (Option<String>, Option<String>) {
    if raw.is_empty() {
        return (None, None);
    }
    let path = std::path::Path::new(raw);
    if path.is_dir() || raw.ends_with('/') {
        return (Some(raw.to_string()), None);
    }
    match (path.parent(), path.file_name()) {
        (_, Some(file_name)) => {
            let directory = match path.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => {
                    parent.to_string_lossy().into_owned()
                }
                // Relative single-segment path: directory = cwd.
                _ => std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            };
            (Some(directory), Some(file_name.to_string_lossy().into_owned()))
        }
        _ => (Some(raw.to_string()), None),
    }
}

/// Test-support surface for the crate's own tests (lib.rs): the busy table
/// is platform-neutral, so harness threads drive it without AppKit.
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::options::DialogSeverity;
    use opentray_spec::CommandScope;

    fn scope(session: &str) -> CommandScope {
        CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
            instance_generation: 1,
        }
    }

    fn message_options(buttons: &[&str], cancel_id: Option<usize>) -> MessageDialogOptions {
        MessageDialogOptions {
            message: "m".to_string(),
            detail: None,
            buttons: buttons.iter().map(|s| s.to_string()).collect(),
            default_id: None,
            cancel_id,
            severity: DialogSeverity::Info,
            suppression_label: None,
            darwin: Default::default(),
            win32: Default::default(),
        }
    }

    /// Registration without a native panel: the busy table itself must be
    /// exercisable off the main thread. The real path goes through
    /// `register_modal`, which fills the native half on the owner thread.
    pub(crate) fn register_bare(instance: &mut DialogInstance, handle: u64, scope: CommandScope) {
        instance.modals.insert(
            handle,
            ActiveModal {
                handle,
                scope,
                kind: ModalKind::Message(message_options(&["OK"], None)),
                native: None,
            },
        );
    }

    #[test]
    fn busy_law_is_scoped_to_app_tray_session() {
        let mut instance = DialogInstance::new();
        let scope_one = scope("session-1");
        assert!(!instance.is_busy(&scope_one));

        register_bare(&mut instance, 7, scope_one.clone());
        assert!(instance.is_busy(&scope_one));

        // Same session, different tray: allowed (per-tray ownership).
        let mut other_tray = scope_one.clone();
        other_tray.tray_id = "tray-2".to_string();
        assert!(!instance.is_busy(&other_tray));

        // Different session, same tray: allowed (the single-session runtime
        // keys busy on the full scope, never on the tray alone).
        let mut other_session = scope_one.clone();
        other_session.session_id = "session-2".to_string();
        assert!(!instance.is_busy(&other_session));

        instance.remove_modal(7);
        assert!(!instance.is_busy(&scope_one));
    }

    #[test]
    fn take_native_is_a_one_shot_cas() {
        let mut instance = DialogInstance::new();
        register_bare(&mut instance, 9, scope("session-1"));
        // A bare record has no native half: taking yields None, and the
        // record survives for its kind/scope data until removal.
        assert!(instance.take_native(9).is_none());
        assert!(instance.find_modal(9).is_some());
        assert_eq!(instance.handles_for_session("session-1"), vec![9]);
        assert!(instance.remove_modal(9).is_some());
        assert!(instance.find_modal(9).is_none());
    }

    #[test]
    fn alert_response_mapping_is_total_and_honors_cancel_id() {
        // Button activation: 1000 + index.
        assert_eq!(alert_response_from_modal_code(1000, 3, Some(2)), 0);
        assert_eq!(alert_response_from_modal_code(1002, 3, Some(2)), 2);
        // Forced dismissal without a cancelId -> button 0 (P0-6 frozen).
        assert_eq!(alert_response_from_modal_code(-1001, 3, None), 0);
        assert_eq!(alert_response_from_modal_code(0, 3, None), 0);
        // Forced dismissal with a cancelId -> the cancel branch.
        assert_eq!(alert_response_from_modal_code(-1001, 3, Some(1)), 1);
        assert_eq!(alert_response_from_modal_code(0, 3, Some(1)), 1);
        // A code beyond the button count is a forced dismissal too.
        assert_eq!(alert_response_from_modal_code(1005, 3, Some(1)), 1);
    }

    #[test]
    fn cancel_payload_is_isomorphic_to_user_cancellation() {
        let with_cancel = ModalKind::Message(message_options(&["OK", "Cancel"], Some(1)));
        match cancel_payload(&with_cancel) {
            ExtOperationPayload::Result { value } => {
                assert_eq!(value, serde_json::json!({ "response": 1, "suppressed": false }))
            }
            other => panic!("cancel branch is a result payload: {other:?}"),
        }

        let without_cancel = ModalKind::Message(message_options(&["OK"], None));
        match cancel_payload(&without_cancel) {
            ExtOperationPayload::Result { value } => {
                assert_eq!(value, serde_json::json!({ "response": 0, "suppressed": false }))
            }
            other => panic!("cancel branch is a result payload: {other:?}"),
        }

        let picker = ModalKind::PickDirectory(crate::options::PickDirectoryOptions {
            common: Default::default(),
            darwin: Default::default(),
            win32: Default::default(),
        });
        match cancel_payload(&picker) {
            ExtOperationPayload::Result { value } => assert_eq!(value, serde_json::json!(null)),
            other => panic!("picker cancel is null: {other:?}"),
        }
    }

    #[test]
    fn validation_rejects_empty_buttons_and_out_of_range_indexes() {
        let empty = DialogCommand::MessageDialog(message_options(&[], None));
        let error = validate_show_command(&empty).unwrap_err();
        assert_eq!(error.code, error_code::INVALID_OPTIONS);

        let bad_default = DialogCommand::MessageDialog(MessageDialogOptions {
            default_id: Some(3),
            ..message_options(&["OK"], None)
        });
        let error = validate_show_command(&bad_default).unwrap_err();
        assert_eq!(error.code, error_code::INVALID_OPTIONS);
        assert_eq!(error.details.as_ref().unwrap()["field"], "defaultId");

        let bad_cancel = DialogCommand::MessageDialog(MessageDialogOptions {
            cancel_id: Some(9),
            ..message_options(&["OK", "Cancel"], None)
        });
        assert_eq!(
            validate_show_command(&bad_cancel).unwrap_err().code,
            error_code::INVALID_OPTIONS
        );

        let good = DialogCommand::MessageDialog(message_options(&["OK", "Cancel"], Some(1)));
        assert!(validate_show_command(&good).is_ok());
        // Picker commands carry no index invariants.
        assert!(validate_show_command(&DialogCommand::GetBackend).is_ok());
    }

    #[test]
    fn save_leaf_canonicalization_prefers_parent_realpath() {
        let existing_dir = std::env::temp_dir();
        let joined = existing_dir.join("brand-new-file.txt");
        let raw = joined.to_string_lossy().into_owned();
        let canonical = canonicalize_save_leaf(&raw);
        let expected = existing_dir
            .canonicalize()
            .unwrap_or_else(|_| existing_dir.clone())
            .join("brand-new-file.txt");
        assert_eq!(canonical, expected.to_string_lossy().into_owned());
    }

    #[test]
    fn existing_canonicalization_resolves_realpaths_and_degrades_lexically() {
        let dir = std::env::temp_dir()
            .canonicalize()
            .expect("temp dir canonicalizes");
        let raw = dir.to_string_lossy().into_owned();
        assert_eq!(canonicalize_existing(&raw), raw);
        // A vanished path degrades to the lexical absolute form, never a
        // rejection.
        let vanished = dir.join("definitely-not-here-51317");
        assert_eq!(
            canonicalize_existing(&vanished.to_string_lossy()),
            vanished.to_string_lossy().into_owned()
        );
    }

    #[test]
    fn default_path_split_rules() {
        assert_eq!(split_default_path(""), (None, None));
        // Trailing separator: directory only.
        assert_eq!(
            split_default_path("/tmp/"),
            (Some("/tmp/".to_string()), None)
        );
        // Existing directory: directory only.
        let temp = std::env::temp_dir().to_string_lossy().into_owned();
        let (dir, leaf) = split_default_path(&temp);
        assert!(dir.is_some());
        assert_eq!(leaf, None);
        // Directory + leaf.
        assert_eq!(
            split_default_path("/tmp/report.txt"),
            (Some("/tmp".to_string()), Some("report.txt".to_string()))
        );
        // Relative single segment: cwd + leaf.
        let (dir, leaf) = split_default_path("notes.txt");
        assert_eq!(leaf, Some("notes.txt".to_string()));
        assert!(dir.is_some());
    }
}
