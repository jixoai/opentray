//! win32 notification surface (add-ext-notification design section 2,
//! Codex R1 option B frozen).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: the
//! win32 notify channel rides the caller's registered tray icon through
//! the broker-internal bridge, while the extension crate keeps identical
//! identity/manifest/DTO obligations on the generic FFI path):
//! 1. `notify` is NOT handled in this crate on win32: the composition
//!    layer's generic tray-notification capability routes the command
//!    envelope to the registered tray icon (`NIM_MODIFY` + `NIF_INFO`
//!    against the existing `(HWND, uID)` law). If a notify frame ever
//!    reaches this surface anyway, it is the honest typed
//!    defense-in-depth rejection — never a silent no-op.
//! 2. Authorization has no win32 concept: `getAuthorizationStatus` and
//!    `requestAuthorization` are the documented always-granted Immediate
//!    degradations — `granted` / `true`, zero deferred frames, zero port
//!    submits (design section 4). The zero-deferred law is STRUCTURAL:
//!    [`Win32Answer`] has no deferred arm, so the win32 dispatch path
//!    cannot express one.
//! 3. The payload law's win32 leg (subtitle joined into the body prefix,
//!    combined 256 limit) is enforced here too as defense in depth
//!    alongside the facade preflight.
//!
//! Compromise: the whole surface is pure JSON projection — no Win32 API
//! is imported — because the tray channel belongs to the broker bridge
//! and the auth degradation is a constant. The module compiles under
//! `test` on every host (the ext-sound PlaybackArbiter seam split) so
//! its contracts are testable anywhere; the platform dispatch arms in
//! `lib.rs` delegate to [`dispatch`].

use opentray_spec::TypedExtensionError;

use crate::options::{
    failed_reason_error, validate_notify_payload, win32_authorization_decision_result,
    win32_authorization_status_result, NotificationBackendCapabilities, NotificationCommand,
    NotifyContent, PayloadProjection, REASON_WIN32_NOTIFY_BROKER_BRIDGED,
};

/// The complete answer of the win32 command projection. There is NO
/// deferred arm: every win32 answer is Immediate events or a typed
/// error, so zero deferred frames is a type-level property, not a
/// behavioral promise.
#[derive(Debug)]
pub(crate) enum Win32Answer {
    /// Immediate result event data values (each becomes one
    /// `ExtensionEnvelope`'s `data`).
    Immediate(Vec<serde_json::Value>),
    Error(TypedExtensionError),
}

/// The win32 command projection (pure): backend DTO, the always-granted
/// auth degradation, and the payload-validated broker-bridge rejection
/// for notify.
pub(crate) fn dispatch(command: &NotificationCommand) -> Win32Answer {
    match command {
        NotificationCommand::GetBackend => Win32Answer::Immediate(vec![serde_json::json!({
            "type": "backend",
            "backend": backend_capabilities(),
        })]),
        NotificationCommand::GetAuthorizationStatus => {
            Win32Answer::Immediate(vec![win32_authorization_status_result()])
        }
        NotificationCommand::RequestAuthorization => {
            Win32Answer::Immediate(vec![win32_authorization_decision_result()])
        }
        NotificationCommand::Notify(content) => Win32Answer::Error(notify_rejection(content)),
    }
}

/// The frozen win32 backend DTO projection (design sections 2-3).
pub(crate) fn backend_capabilities() -> NotificationBackendCapabilities {
    NotificationBackendCapabilities::win32()
}

/// `notify` (win32): payload-validated defense in depth, then the honest
/// typed rejection — the broker-internal tray bridge owns delivery
/// (design section 2); this crate never posts, never defers, and never
/// touches the port.
pub(crate) fn notify_rejection(content: &NotifyContent) -> TypedExtensionError {
    if let Err(payload_error) = validate_notify_payload(content, PayloadProjection::Win32) {
        return payload_error;
    }
    failed_reason_error(
        REASON_WIN32_NOTIFY_BROKER_BRIDGED,
        "win32 notify is routed to the broker-internal tray-notification bridge against the \
         session's registered tray icon; the extension crate never delivers it directly",
    )
}
