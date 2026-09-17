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
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
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
    /// Read on the macOS paths (terminal extraction / cancel payload);
    /// win32 never registers a record.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
    ///
    /// macOS-only in production (the win32 busy view lives in the worker
    /// registry — see `windows::is_busy`); the platform-neutral busy law
    /// stays exercised cross-platform through the test surface, hence the
    /// conditional allowance for non-macOS lib builds.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn is_busy(&self, scope: &CommandScope) -> bool {
        self.modals
            .values()
            .any(|modal| scope_key(&modal.scope) == scope_key(scope))
    }

    /// Reserves the scope and registers the active modal (single-threaded
    /// CAS: the caller checked `is_busy` immediately before, and both run
    /// on the owner thread with no interleaving).
    ///
    /// macOS-only in production: the win32 show path never registers
    /// (workers self-release their slots; a DialogInstance record would
    /// never be removed by the worker thread).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

    /// macOS-only caller surface today (the session-close cancel-branch
    /// lookup); win32 workers submit their own cancel terminals.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn find_modal(&self, handle: u64) -> Option<&ActiveModal> {
        self.modals.get(&handle)
    }

    /// macOS-only in production: the win32 path never registers a modal,
    /// so nothing on that platform steps (win32 polls honestly report
    /// no-deadline instead).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
/// macOS-only caller surface today (the NSAlert mapping); kept beside its
/// frozen mapping test, which runs on every platform.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

// ---------------------------------------------------------------------------
// win32 worker transactions (design section 5.3): the platform-neutral
// cores behind the windows module's seams. Like the ext-sound
// PlaybackArbiter, the law lives host-compiled so its invariants run as
// tests on any host; `windows/` wires the real Win32 halves (the STA
// worker body, the deferred port shim).
// ---------------------------------------------------------------------------

/// What one finished dialog worker may deliver (the pre-Accept law's
/// outcome half). The `entered` state — never the modal outcome's Ok/Err —
/// picks the arm:
///
/// - [`WorkerCompletion::PreEntry`] — the worker never entered its native
///   modal: no operation exists, no Accepted frame was sent, and NO
///   terminal may ever be submitted. A failure delivers its typed error
///   through the entry handshake instead (the synchronous rejection on the
///   original requestId); a close-race exit carries no error (the
///   handshake disconnect answers the command).
/// - [`WorkerCompletion::Submit`] — the worker entered: exactly one
///   terminal payload (the revoked cancel branch wins over the natural
///   outcome).
/// - [`WorkerCompletion::Suppressed`] — the worker entered but the host
///   already retired the operation through the pre-Accept timeout: silence
///   is exactly-once.
#[derive(Debug)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) enum WorkerCompletion {
    PreEntry {
        error: Option<TypedExtensionError>,
    },
    Submit(ExtOperationPayload),
    Suppressed,
}

/// Decides one worker's completion transaction from its tracked state.
/// `entered` comes from the worker's `entered` flag (set exactly when the
/// `Entered` handshake fired); `abandoned`/`revoked` from the owner-side
/// flags.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn worker_completion_transaction(
    entered: bool,
    abandoned: bool,
    revoked: bool,
    outcome: Result<ExtOperationPayload, TypedExtensionError>,
    kind: &ModalKind,
) -> WorkerCompletion {
    if !entered {
        // Pre-entry failure transaction (design section 5.3): the typed
        // error answers the ORIGINAL requestId synchronously through the
        // entry handshake — no operation, no terminal, ever.
        return WorkerCompletion::PreEntry {
            error: outcome.err(),
        };
    }
    if abandoned {
        return WorkerCompletion::Suppressed;
    }
    let payload = if revoked {
        cancel_payload(kind)
    } else {
        outcome.unwrap_or_else(|error| ExtOperationPayload::Error { error })
    };
    WorkerCompletion::Submit(payload)
}

// ---------------------------------------------------------------------------
// win32 picker dismissal core (batch E P0, 2026-09-18): posted WM_CLOSE,
// never the reentrant IFileDialog::Close. Host-compiled law behind a
// post-only seam; `windows/worker.rs` wires the real EnumThreadWindows +
// PostMessageW halves (the same PlaybackArbiter-style seam split as
// ext-sound).
// ---------------------------------------------------------------------------

/// The native post-only sink of one picker dismissal (the seam):
/// production posts `WM_CLOSE` through the worker thread's window
/// enumeration on Windows; tests inject recording spies.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) trait PickerCloseSink {
    /// Posts `WM_CLOSE` to one top-level window owned by the picker's
    /// worker thread.
    fn post_close(&mut self, window: usize);
}

/// One picker dismissal settlement: the windows that received `WM_CLOSE`,
/// in enumeration order — always exactly the non-dispatcher windows.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PickerDismissalReport {
    pub(crate) posted_close: Vec<usize>,
}

/// The picker dismissal law (batch E P0): a live `IFileDialog` is
/// dismissed ONLY by posting `WM_CLOSE` to every non-dispatcher top-level
/// window of the worker thread; the dialog's own pump then ends `Show`
/// with `ERROR_CANCELLED`, which the existing cancel branch settles
/// through the exactly-once terminal transaction. The reentrant
/// `IFileDialog::Close` from the dispatcher WndProc — a call outside the
/// documented "from a callback method or function while the dialog is
/// open" contract that fault-killed the broker with 0xC0000005 — is
/// deleted from the product surface: this transaction is the entire
/// dismissal and its only native action is
/// [`PickerCloseSink::post_close`], so a COM close is not even
/// expressible on the path.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn picker_dismissal_transaction<S: PickerCloseSink>(
    thread_windows: &[usize],
    dispatcher: usize,
    sink: &mut S,
) -> PickerDismissalReport {
    let mut posted_close = Vec::new();
    for &window in thread_windows {
        if window == dispatcher {
            // The hidden dispatcher window is ours but not the dialog: it
            // must survive so the close channel stays deliverable.
            continue;
        }
        sink.post_close(window);
        posted_close.push(window);
    }
    PickerDismissalReport { posted_close }
}

// ---------------------------------------------------------------------------
// win32 unload-race settlement (design section 5.3, R4 P0-3): a worker
// that has not exited must never have its library deinit'd or dlclose'd.
// Host-compiled core with an injectable pin seam; windows/ wires the real
// GetModuleHandleExW pin.
// ---------------------------------------------------------------------------

/// The frozen fatal diagnostic of the blocked unload path (asserted by the
/// failure-injection regression test).
pub(crate) const UNLOAD_BLOCKED_FATAL: &str = "dialog worker(s) outlived the join budget and the \
     module self-pin failed; deinit blocks this thread forever and the library stays mapped \
     (leak-by-design)";

/// The two frozen endings plus the clean case:
///
/// - [`UnloadDecision::Clean`] — every worker joined inside the budget:
///   the host may free the instance and unload the library.
/// - [`UnloadDecision::Pinned`] — ending (a): workers outlived the join,
///   but the module self-pin succeeded. The loader's reference count keeps
///   executing code mapped, so the broker continues its exit flow and the
///   cleanup lands at process exit.
/// - [`UnloadDecision::BlockUnload`] — the pin FAILED with live workers:
///   ending (a) is unavailable. `opentray_ext_deinit` must never return
///   into the host's `FreeLibrary`/dlclose while a worker may still be
///   executing this module's code — it blocks forever instead
///   (leak-by-design: the library stays loaded, the workers finish
///   naturally, process exit reclaims everything).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnloadDecision {
    Clean,
    Pinned,
    BlockUnload { fatal: &'static str },
}

/// One shutdown settlement (the win32 deinit seam's report).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) struct ShutdownSettlement {
    pub(crate) joined: usize,
    pub(crate) leaked: usize,
    pub(crate) pinned: bool,
    pub(crate) unload: UnloadDecision,
}

/// Settles the close-all + bounded-join phase of deinit. `pin` is the
/// native self-pin seam (production: `GetModuleHandleExW` pin of this
/// module; tests inject failures); it is consulted ONLY when a worker
/// outlived the join budget.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn settle_shutdown<F>(joined: usize, leaked: usize, pin: F) -> ShutdownSettlement
where
    F: FnOnce() -> bool,
{
    let pinned = leaked > 0 && pin();
    let unload = if leaked == 0 {
        UnloadDecision::Clean
    } else if pinned {
        UnloadDecision::Pinned
    } else {
        UnloadDecision::BlockUnload {
            fatal: UNLOAD_BLOCKED_FATAL,
        }
    };
    ShutdownSettlement {
        joined,
        leaked,
        pinned,
        unload,
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

    // -------------------------------------------------------------------------
    // win32 worker completion transaction (design section 5.3 pre-Accept
    // law). The darwin host cannot run the STA worker body, so these drive
    // the platform-neutral core the windows module wires (the same
    // PlaybackArbiter-style seam split as ext-sound).
    // -------------------------------------------------------------------------

    /// P1 regression: a PRE-entry failure (dialog construction, COM init,
    /// dispatcher window, pre-TDN_CREATED modal failure) must answer the
    /// command with the synchronous typed error through the entry
    /// handshake and produce ZERO terminal frames and ZERO deferred-port
    /// submissions — `Submit` and `Suppressed` are both wrong here because
    /// only `Submit` ever reaches the port, and a pre-entry worker never
    /// may.
    #[test]
    fn pre_entry_failure_carries_the_sync_typed_error_and_never_submits() {
        let completion = worker_completion_transaction(
            /* entered */ false,
            /* abandoned */ false,
            /* revoked */ false,
            Err(typed_error(
                error_code::PRESENTATION_FAILED,
                "the native file dialog could not be constructed",
            )),
            &ModalKind::Message(message_options(&["OK"], None)),
        );
        match completion {
            WorkerCompletion::PreEntry { error } => {
                let error = error.expect("the typed error rides the entry handshake");
                assert_eq!(error.code, error_code::PRESENTATION_FAILED);
                assert!(!error.message.is_empty());
            }
            other => panic!(
                "a pre-entry failure must never produce a terminal: {other:?}"
            ),
        }
    }

    /// A pre-entry close-race exit (close requested before the modal) is
    /// silent: no typed error, no terminal — the handshake disconnect
    /// answers the command with the synchronous presentation failure.
    #[test]
    fn pre_entry_close_race_exit_is_silent() {
        let completion = worker_completion_transaction(
            false,
            false,
            true, // revoked raced in before entry: still no terminal
            Ok(ExtOperationPayload::Result {
                value: serde_json::json!(null),
            }),
            &ModalKind::Message(message_options(&["OK"], Some(0))),
        );
        assert!(
            matches!(completion, WorkerCompletion::PreEntry { error: None }),
            "a pre-entry exit never reaches the port, even revoked"
        );
    }

    /// Only post-entry failures become terminal error payloads (Accepted
    /// was honestly sent first).
    #[test]
    fn post_entry_failure_submits_the_terminal_error() {
        let completion = worker_completion_transaction(
            true,
            false,
            false,
            Err(typed_error(
                error_code::PRESENTATION_FAILED,
                "the native file dialog failed after presentation",
            )),
            &ModalKind::Message(message_options(&["OK"], None)),
        );
        match completion {
            WorkerCompletion::Submit(ExtOperationPayload::Error { error }) => {
                assert_eq!(error.code, error_code::PRESENTATION_FAILED);
            }
            other => panic!("a post-entry failure is a terminal error: {other:?}"),
        }
    }

    /// The pre-Accept timeout retired the operation on the owner side: the
    /// late-entering worker stays silent (exactly-once — no second answer,
    /// no port submission).
    #[test]
    fn abandoned_worker_never_submits_after_the_timeout_answer() {
        let completion = worker_completion_transaction(
            true,
            true,
            false,
            Ok(ExtOperationPayload::Result {
                value: serde_json::json!(null),
            }),
            &ModalKind::Message(message_options(&["OK"], None)),
        );
        assert!(matches!(completion, WorkerCompletion::Suppressed));
    }

    /// A revoked post-entry worker submits the cancel branch (the owner
    /// CAS beats the natural outcome).
    #[test]
    fn revoked_post_entry_worker_submits_the_cancel_branch() {
        let completion = worker_completion_transaction(
            true,
            false,
            true,
            Ok(ExtOperationPayload::Result {
                value: serde_json::json!({ "response": 0, "suppressed": false }),
            }),
            &ModalKind::Message(message_options(&["OK", "Cancel"], Some(1))),
        );
        match completion {
            WorkerCompletion::Submit(ExtOperationPayload::Result { value }) => {
                assert_eq!(value, serde_json::json!({ "response": 1, "suppressed": false }));
            }
            other => panic!("revocation settles through the cancel branch: {other:?}"),
        }
    }

    // -------------------------------------------------------------------------
    // win32 picker dismissal transaction (batch E P0): the darwin host
    // cannot run the STA worker body, so these drive the platform-neutral
    // core the windows module wires (the PlaybackArbiter-style seam).
    // -------------------------------------------------------------------------

    /// The recording spy for the post-only seam. It deliberately models
    /// ONLY `post_close`: the reentrant IFileDialog COM close was deleted
    /// from the product surface, so any reintroduction must grow a new
    /// seam action — and this suite asserts it stays unexpressible.
    struct SpyCloseSink {
        posts: Vec<usize>,
    }

    impl PickerCloseSink for SpyCloseSink {
        fn post_close(&mut self, window: usize) {
            self.posts.push(window);
        }
    }

    /// The P0 law: the picker close path posts WM_CLOSE to every
    /// non-dispatcher window of the worker thread (in enumeration order)
    /// and NEVER to the dispatcher; the sink observes nothing else because
    /// no other action exists on the dismissal path.
    #[test]
    fn picker_dismissal_posts_wm_close_to_every_non_dispatcher_window() {
        let dispatcher = 0x00DE_0001;
        let mut spy = SpyCloseSink { posts: Vec::new() };
        let report = picker_dismissal_transaction(
            &[
                dispatcher,
                0x00AA_0001,
                0x00AA_0002,
                dispatcher + 1,
                0x00AA_0003,
            ],
            dispatcher,
            &mut spy,
        );
        assert_eq!(
            report.posted_close,
            vec![0x00AA_0001, 0x00AA_0002, dispatcher + 1, 0x00AA_0003]
        );
        assert_eq!(spy.posts, report.posted_close, "the spy saw the posts");
        assert!(
            !spy.posts.contains(&dispatcher),
            "the dispatcher window never receives WM_CLOSE (the close channel \
             must stay deliverable)"
        );
    }

    /// Edge: the enumeration saw only the dispatcher (a close racing the
    /// picker's window creation) — zero posts, no panic; the early-close
    /// flag already covers that race.
    #[test]
    fn picker_dismissal_with_only_the_dispatcher_posts_nothing() {
        let dispatcher = 0x00DE_0002;
        let mut spy = SpyCloseSink { posts: Vec::new() };
        let report = picker_dismissal_transaction(&[dispatcher], dispatcher, &mut spy);
        assert!(report.posted_close.is_empty());
        assert!(spy.posts.is_empty());
    }

    /// Edge: an empty enumeration (no windows at all) stays total — the
    /// worker's settle path still owns the cancel branch through the
    /// entry/close flags.
    #[test]
    fn picker_dismissal_with_no_windows_is_total() {
        let mut spy = SpyCloseSink { posts: Vec::new() };
        let report = picker_dismissal_transaction(&[], 0x00DE_0003, &mut spy);
        assert!(report.posted_close.is_empty());
        assert!(spy.posts.is_empty());
    }

    // -------------------------------------------------------------------------
    // win32 unload-race settlement (design section 5.3, R4 P0-3): a worker
    // that has not exited must never have its library deinit'd/dlclosed.
    // The pin is the injected seam — production wires the
    // GetModuleHandleExW self-pin; these tests inject its failure.
    // -------------------------------------------------------------------------

    /// P1 regression (failure injection: the pin seam returns failure):
    /// workers outlived the join budget AND the module self-pin failed —
    /// the settlement must BLOCK the unload path (deinit never returns
    /// into the host's FreeLibrary/dlclose) and record the fatal
    /// diagnostic.
    #[test]
    fn failed_pin_with_leaked_workers_blocks_the_unload_path() {
        let settlement = settle_shutdown(0, 2, || false);
        assert_eq!(settlement.joined, 0);
        assert_eq!(settlement.leaked, 2);
        assert!(!settlement.pinned);
        match settlement.unload {
            UnloadDecision::BlockUnload { fatal } => {
                assert_eq!(fatal, UNLOAD_BLOCKED_FATAL);
                assert!(
                    fatal.contains("pin failed") && fatal.contains("blocks"),
                    "the abandoned unload path is recorded: {fatal}"
                );
            }
            other => panic!("a failed pin must block the unload: {other:?}"),
        }
    }

    /// Ending (a) with a successful pin: cleanup continues deferred to
    /// process exit (the loader's pin keeps executing code mapped).
    #[test]
    fn successful_pin_defers_cleanup_to_process_exit() {
        let settlement = settle_shutdown(1, 1, || true);
        assert_eq!(settlement.joined, 1);
        assert_eq!(settlement.leaked, 1);
        assert!(settlement.pinned);
        assert!(matches!(settlement.unload, UnloadDecision::Pinned));
    }

    /// Nothing leaked: the pin seam is never even consulted, and the host
    /// may free and unload normally.
    #[test]
    fn clean_shutdown_never_consults_the_pin_seam() {
        let settlement = settle_shutdown(3, 0, || {
            panic!("the self-pin must not run when no worker leaked")
        });
        assert_eq!(settlement.joined, 3);
        assert_eq!(settlement.leaked, 0);
        assert!(!settlement.pinned);
        assert!(matches!(settlement.unload, UnloadDecision::Clean));
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
