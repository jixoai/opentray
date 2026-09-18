//! Notification command/option/result DTOs (add-ext-notification design
//! sections 1-3).
//!
//! Shared, platform-neutral wire shapes. The facade
//! (`@opentray/ext-notification`) owns preflight validation; the native
//! side re-validates with the same frozen rules (defense in depth) so a
//! malformed frame can never reach a native notification surface. All
//! command structs use `deny_unknown_fields`: an unknown field is a typed
//! rejection, never a silent ignore.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use opentray_spec::TypedExtensionError;

/// Typed error codes of the notification contract (design section 3,
/// frozen catalog of five). The full catalog lives here even when one
/// platform never emits some codes (the win32 bridge owns
/// `notification_tray_absent`/`notification_failed` for delivery; this
/// crate owns the authorization-timeout `notification_failed` reason).
#[allow(dead_code)]
pub(crate) mod error_code {
    pub const PLATFORM_UNSUPPORTED: &str = "notification_platform_unsupported";
    pub const DENIED: &str = "notification_denied";
    pub const PAYLOAD_INVALID: &str = "notification_payload_invalid";
    pub const TRAY_ABSENT: &str = "notification_tray_absent";
    pub const FAILED: &str = "notification_failed";
}

/// Transport categories that are NOT part of the typed five-code catalog:
/// they name host-contract violations and malformed frames, which the
/// facade never matches as notification failure families. (The
/// dispatch-thread category is emitted by the darwin owner-thread gate
/// only; the win32 surface is pure JSON and has no thread gate.)
#[allow(dead_code)]
pub(crate) mod transport_code {
    /// A dispatch arrived off the broker's GUI owner (main) thread.
    pub const INVALID_DISPATCH_THREAD: &str = "invalid_dispatch_thread";
    /// A command frame is structurally invalid (unknown type/field,
    /// missing field, or a missing host-injected commandScope).
    pub const INVALID_NOTIFICATION_COMMAND: &str = "invalid_notification_command";
    /// A deferred answer was attempted without the attached completion
    /// port (the loader attaches it right after init; its absence is a
    /// host-contract violation, not a product failure).
    pub const DEFERRED_PORT_REQUIRED: &str = "notification_deferred_port_required";
}

/// The frozen `notification_failed` reason of the 10 s authorization
/// timeout (design section 4).
pub(crate) const REASON_AUTHORIZATION_TIMEOUT: &str = "authorization-timeout";
/// The cancel-branch reason of a session close that revoked an in-flight
/// authorization transaction (design section 4: the registry session-key
/// cleanup law; the cancel terminal is delivered exactly once).
pub(crate) const REASON_AUTHORIZATION_SESSION_CLOSED: &str = "authorization-session-closed";
/// The defense-in-depth reason when a notify command reaches THIS crate's
/// win32 surface instead of the broker-internal tray bridge (design
/// section 2 win32 ruling: routing is the composition layer's generic
/// capability table, never an extension-name special case).
#[cfg_attr(all(not(target_os = "windows"), not(test)), allow(dead_code))]
pub(crate) const REASON_WIN32_NOTIFY_BROKER_BRIDGED: &str =
    "win32-notify-routed-to-broker-tray-bridge";

/// Frozen payload bounds in UTF-16 code units (design section 1, the
/// platform-independent common contract taken from the win32
/// `szInfoTitle`/`szInfo` physical capacity). The same constants are the
/// `NotificationBackendCapabilities` limit fields — one source.
pub(crate) const TITLE_LIMIT_UTF16: u32 = 64;
pub(crate) const BODY_LIMIT_UTF16: u32 = 256;
pub(crate) const SUBTITLE_LIMIT_UTF16: u32 = 64;

/// The win32 subtitle-degradation join separator (design section 1: the
/// subtitle is joined into the body PREFIX). Frozen crate-side so the
/// facade's projection and the native defense-in-depth check count the
/// same joined string; the combined-join limit is 256 UTF-16 units.
// Frozen to the facade's win32 subtitle join form (add-ext-notification
// facade shared.ts: `${subtitle}—${body}`) — the crate's join is the
// defense-in-depth projection and MUST be byte-identical to the facade's
// so the combined-<=256 law validates the same string both layers build.
pub(crate) const WIN32_SUBTITLE_JOIN_SEPARATOR: &str = "\u{2014}";

/// `NotificationAuthorizationStatus` (design section 1):
/// `'granted' | 'denied' | 'notDetermined'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AuthorizationStatus {
    Granted,
    Denied,
    NotDetermined,
}

impl AuthorizationStatus {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::NotDetermined => "notDetermined",
        }
    }
}

/// The payload projection a validation run targets: darwin validates the
/// per-field bounds only; win32 additionally validates the joined
/// subtitle-prefixed body against the combined 256 limit (design section
/// 1, both platform rules live here so tests run on any host).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PayloadProjection {
    // Darwin's validator arm is wired by the darwin dispatch + tests.
    #[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
    Darwin,
    Win32,
}

/// `NotifyOptions` (design section 1): title required non-empty, optional
/// body/subtitle/silent. `silent` defaults to false (platform default
/// alert sound); true means no sound flag.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NotifyContent {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub silent: Option<bool>,
}

impl NotifyContent {
    pub(crate) fn body_text(&self) -> &str {
        self.body.as_deref().unwrap_or("")
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn subtitle_text(&self) -> Option<&str> {
        self.subtitle.as_deref()
    }

    #[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
    pub(crate) fn is_silent(&self) -> bool {
        self.silent.unwrap_or(false)
    }
}

/// The full native command surface (design sections 1-2). `notify` is
/// Immediate on darwin when an authorization snapshot exists and Deferred
/// for the first snapshot-less preflight; `getAuthorizationStatus` and
/// `requestAuthorization` are the first non-modal DeferredOperation use
/// on darwin and Immediate on win32; `getBackend` is always Immediate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum NotificationCommand {
    Notify(NotifyContent),
    GetAuthorizationStatus,
    RequestAuthorization,
    GetBackend,
}

/// Backend capability snapshot (design section 3, frozen schema). One DTO
/// shared by both platforms; the exhaustive fixture freezes every field
/// per platform so adding a field without updating both projections is
/// red. Both constructors compile on every target for that comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationBackendCapabilities {
    pub platform: &'static str,
    pub authorization_model: &'static str,
    pub channel: &'static str,
    pub title_limit_utf16: u32,
    pub body_limit_utf16: u32,
    pub subtitle_limit_utf16: u32,
    pub supports_subtitle: bool,
}

impl NotificationBackendCapabilities {
    /// The frozen darwin projection (design sections 2-3):
    /// UNUserNotificationCenter with real user authorization.
    #[allow(dead_code)]
    pub(crate) fn darwin() -> Self {
        Self {
            platform: "darwin",
            authorization_model: "user",
            channel: "user-notification-center",
            title_limit_utf16: TITLE_LIMIT_UTF16,
            body_limit_utf16: BODY_LIMIT_UTF16,
            subtitle_limit_utf16: SUBTITLE_LIMIT_UTF16,
            supports_subtitle: true,
        }
    }

    /// The frozen win32 projection (design sections 2-3): no authorization
    /// concept (always granted), the broker tray-icon bridge channel, and
    /// the documented subtitle-join degradation.
    #[allow(dead_code)]
    pub(crate) fn win32() -> Self {
        Self {
            platform: "win32",
            authorization_model: "always-granted",
            channel: "tray-icon-info",
            title_limit_utf16: TITLE_LIMIT_UTF16,
            body_limit_utf16: BODY_LIMIT_UTF16,
            subtitle_limit_utf16: SUBTITLE_LIMIT_UTF16,
            supports_subtitle: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Terminal / result payload builders (design sections 1 and 4)
// ---------------------------------------------------------------------------

/// `notify` acceptance event/terminal value: resolve-on-acceptance — the
/// native delivery request was accepted (the sound family's
/// `{type:"result",op}` shape).
pub(crate) fn notify_accepted_result() -> Value {
    serde_json::json!({ "type": "result", "op": "notify" })
}

/// `getAuthorizationStatus` event/terminal value (design section 4).
pub(crate) fn authorization_status_result(status: AuthorizationStatus) -> Value {
    serde_json::json!({ "type": "authorization", "status": status.wire() })
}

/// `requestAuthorization` event/terminal value (design section 4).
pub(crate) fn authorization_decision_result(granted: bool) -> Value {
    serde_json::json!({ "type": "authorizationDecision", "granted": granted })
}

/// The typed `notification_denied` rejection (design section 1): carries
/// the status and — per the denied-linearization law (design section 4) —
/// the snapshot provenance, so the rejection and backend log always name
/// where the authorization fact came from. Never silently dropped.
pub(crate) fn denied_error(status: AuthorizationStatus, provenance: &str) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::DENIED.to_string(),
        message: format!(
            "notification authorization is {}; the acceptance decision came from the \
             cached last authorization snapshot ({}); no native delivery was made",
            status.wire(),
            provenance
        ),
        details: Some(serde_json::json!({
            "status": status.wire(),
            "snapshotSource": provenance,
        })),
    }
}

/// The typed `notification_failed` carrying a frozen `reason` string (the
/// authorization timeout, the session-close cancel branch, and the win32
/// bridge-routing defense share the shape; design sections 2-4).
pub(crate) fn failed_reason_error(reason: &str, message: impl Into<String>) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::FAILED.to_string(),
        message: message.into(),
        details: Some(serde_json::json!({ "reason": reason })),
    }
}

/// The win32 documented always-granted degradation projections (design
/// section 2): `getAuthorizationStatus` resolves `granted` and
/// `requestAuthorization` resolves `true`, both as Immediate commands with
/// zero deferred frames. Pure functions so the degradation contract is
/// testable on any host.
#[cfg_attr(all(not(target_os = "windows"), not(test)), allow(dead_code))]
pub(crate) fn win32_authorization_status_result() -> Value {
    authorization_status_result(AuthorizationStatus::Granted)
}

#[cfg_attr(all(not(target_os = "windows"), not(test)), allow(dead_code))]
pub(crate) fn win32_authorization_decision_result() -> Value {
    authorization_decision_result(true)
}

pub(crate) fn typed_error(code: &str, message: impl Into<String>) -> TypedExtensionError {
    TypedExtensionError {
        code: code.to_string(),
        message: message.into(),
        details: None,
    }
}

#[cfg_attr(all(target_os = "macos", not(test)), allow(dead_code))]
pub(crate) fn platform_unsupported_error() -> TypedExtensionError {
    typed_error(
        error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native notification surface yet",
    )
}

// ---------------------------------------------------------------------------
// Payload law (design section 1, frozen; facade preflight first, native
// defense-in-depth second — identical rules)
// ---------------------------------------------------------------------------

fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

fn payload_invalid(
    field: &str,
    length_utf16: u32,
    limit: u32,
    message: String,
) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::PAYLOAD_INVALID.to_string(),
        message,
        details: Some(serde_json::json!({
            "field": field,
            "lengthUtf16": length_utf16,
            "limit": limit,
        })),
    }
}

/// Validates one notify payload against the frozen UTF-16 bounds
/// (design section 1). Title is required and non-empty; every bound is
/// counted in UTF-16 code units; nothing is ever silently truncated. The
/// win32 projection additionally enforces the combined joined-body limit
/// of 256 (subtitle joined into the body prefix).
pub(crate) fn validate_notify_payload(
    content: &NotifyContent,
    projection: PayloadProjection,
) -> Result<(), TypedExtensionError> {
    let title_len = utf16_len(&content.title);
    if content.title.is_empty() || title_len > TITLE_LIMIT_UTF16 {
        return Err(payload_invalid(
            "title",
            title_len,
            TITLE_LIMIT_UTF16,
            if content.title.is_empty() {
                "notify title is required and must be non-empty".to_string()
            } else {
                format!(
                    "notify title is {title_len} UTF-16 code units; the platform-independent \
                     common limit is {TITLE_LIMIT_UTF16}"
                )
            },
        ));
    }
    if let Some(body) = content.body.as_deref() {
        let body_len = utf16_len(body);
        if body_len > BODY_LIMIT_UTF16 {
            return Err(payload_invalid(
                "body",
                body_len,
                BODY_LIMIT_UTF16,
                format!(
                    "notify body is {body_len} UTF-16 code units; the platform-independent \
                     common limit is {BODY_LIMIT_UTF16}"
                ),
            ));
        }
    }
    if let Some(subtitle) = content.subtitle.as_deref() {
        let subtitle_len = utf16_len(subtitle);
        if subtitle_len > SUBTITLE_LIMIT_UTF16 {
            return Err(payload_invalid(
                "subtitle",
                subtitle_len,
                SUBTITLE_LIMIT_UTF16,
                format!(
                    "notify subtitle is {subtitle_len} UTF-16 code units; the \
                     platform-independent common limit is {SUBTITLE_LIMIT_UTF16}"
                ),
            ));
        }
    }
    if projection == PayloadProjection::Win32 {
        if let Some(subtitle) = content.subtitle.as_deref() {
            let joined_len =
                utf16_len(subtitle) + utf16_len(content.body_text()) + separator_len() as u32;
            if joined_len > BODY_LIMIT_UTF16 {
                return Err(payload_invalid(
                    "body",
                    joined_len,
                    BODY_LIMIT_UTF16,
                    format!(
                        "the win32 subtitle degradation joins the subtitle into the body prefix \
                         and the joined body is {joined_len} UTF-16 code units; the combined \
                         limit is {BODY_LIMIT_UTF16} — rejected, never truncated"
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// The joined win32 body (subtitle prefix + separator + body) — the
/// frozen projection the facade and the native defense-in-depth check
/// must agree on.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn win32_joined_body(content: &NotifyContent) -> String {
    match content.subtitle_text() {
        Some(subtitle) => {
            let mut joined = String::with_capacity(subtitle.len() + content.body_text().len() + 2);
            joined.push_str(subtitle);
            joined.push_str(WIN32_SUBTITLE_JOIN_SEPARATOR);
            joined.push_str(content.body_text());
            joined
        }
        None => content.body_text().to_string(),
    }
}

fn separator_len() -> usize {
    WIN32_SUBTITLE_JOIN_SEPARATOR.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(title: &str, body: Option<&str>, subtitle: Option<&str>) -> NotifyContent {
        NotifyContent {
            title: title.to_string(),
            body: body.map(str::to_string),
            subtitle: subtitle.map(str::to_string),
            silent: None,
        }
    }

    /// Repeated U+1D54F (MATHEMATICAL DOUBLE-STRUCK X): one char, TWO
    /// UTF-16 code units each — proves the bound counts UTF-16 units, not
    /// chars or bytes.
    fn astral(times: usize) -> String {
        "\u{1D54F}".repeat(times)
    }

    #[test]
    fn command_tags_parse_in_camel_case() {
        let parsed: NotificationCommand = serde_json::from_value(serde_json::json!({
            "type": "notify", "title": "Build finished"
        }))
        .unwrap();
        assert!(matches!(parsed, NotificationCommand::Notify(_)));

        let parsed: NotificationCommand =
            serde_json::from_value(serde_json::json!({ "type": "getAuthorizationStatus" }))
                .unwrap();
        assert!(matches!(
            parsed,
            NotificationCommand::GetAuthorizationStatus
        ));

        let parsed: NotificationCommand =
            serde_json::from_value(serde_json::json!({ "type": "requestAuthorization" })).unwrap();
        assert!(matches!(parsed, NotificationCommand::RequestAuthorization));

        let parsed: NotificationCommand =
            serde_json::from_value(serde_json::json!({ "type": "getBackend" })).unwrap();
        assert!(matches!(parsed, NotificationCommand::GetBackend));

        assert!(serde_json::from_value::<NotificationCommand>(
            serde_json::json!({ "type": "get_authorization_status" })
        )
        .is_err());
        assert!(serde_json::from_value::<NotificationCommand>(
            serde_json::json!({ "type": "noSuchCommand" })
        )
        .is_err());
    }

    #[test]
    fn unknown_fields_reject_instead_of_silently_ignoring() {
        let raw = serde_json::json!({
            "type": "notify", "title": "t", "mystery": true
        });
        let error = serde_json::from_value::<NotificationCommand>(raw).unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        // v1 has no platform-specific option namespace (design section 1).
        let raw = serde_json::json!({
            "type": "notify", "title": "t", "darwin": { "soundName": "x" }
        });
        assert!(serde_json::from_value::<NotificationCommand>(raw).is_err());
    }

    /// The payload matrix (design section 1 / spec scenario): empty title,
    /// each bound exceeded by exactly one unit, UTF-16 (not char/byte)
    /// counting, and boundary-exact acceptance on BOTH projections.
    #[test]
    fn payload_matrix_enforces_the_frozen_utf16_bounds() {
        for projection in [PayloadProjection::Darwin, PayloadProjection::Win32] {
            // Boundary-exact acceptance. darwin: 64 / 256 / 64 (subtitle
            // stays a distinct field). win32: the same title/subtitle
            // bounds with the joined body exactly 256 (subtitle 64 +
            // separator 2 + body 190).
            let exact = match projection {
                PayloadProjection::Darwin => content(
                    &"t".repeat(64),
                    Some(&"b".repeat(256)),
                    Some(&"s".repeat(64)),
                ),
                PayloadProjection::Win32 => content(
                    &"t".repeat(64),
                    Some(&"b".repeat(190)),
                    Some(&"s".repeat(64)),
                ),
            };
            assert!(
                validate_notify_payload(&exact, projection).is_ok(),
                "boundary-exact payload accepted ({projection:?})"
            );

            // Empty title.
            let error = validate_notify_payload(&content("", None, None), projection).unwrap_err();
            assert_eq!(error.code, error_code::PAYLOAD_INVALID);
            let details = error.details.unwrap();
            assert_eq!(details["field"], "title");
            assert_eq!(details["lengthUtf16"], 0);
            assert_eq!(details["limit"], 64);

            // One-unit overruns name the offending field/length/limit.
            let cases = [
                ("title", &"t".repeat(65), 65u32, 64u32),
                ("body", &"b".repeat(257), 257, 256),
                ("subtitle", &"s".repeat(65), 65, 64),
            ];
            for (field, text, length, limit) in cases {
                let payload = match field {
                    "title" => content(text, None, None),
                    "body" => content("t", Some(text), None),
                    _ => content("t", None, Some(text)),
                };
                let error = validate_notify_payload(&payload, projection).unwrap_err();
                assert_eq!(error.code, error_code::PAYLOAD_INVALID, "{field}");
                let details = error.details.unwrap();
                assert_eq!(details["field"], field);
                assert_eq!(details["lengthUtf16"], length);
                assert_eq!(details["limit"], limit);
            }
        }

        // UTF-16 unit counting: 33 astral chars are 66 UTF-16 units —
        // over the 64-unit title limit while being only 33 chars.
        let astral_title = content(&astral(33), None, None);
        let error = validate_notify_payload(&astral_title, PayloadProjection::Darwin).unwrap_err();
        assert_eq!(error.details.unwrap()["lengthUtf16"], 66);
        // 32 astral chars are exactly 64 units: accepted.
        assert!(validate_notify_payload(
            &content(&astral(32), None, None),
            PayloadProjection::Darwin
        )
        .is_ok());
    }

    /// The win32 combined-join rule (design section 1 / spec scenario): a
    /// subtitle + body whose JOINED form exceeds 256 rejects typed on the
    /// win32 projection only — the darwin projection accepts the same
    /// per-field-valid payload because subtitle stays a distinct native
    /// field there.
    #[test]
    fn win32_join_is_jointly_validated_never_truncated() {
        // subtitle 64 + separator 1 (em-dash) + body 192 = 257 joined: over.
        // Per-field: subtitle 64 (ok), body 192 (ok).
        let joined_over = content("t", Some(&"b".repeat(192)), Some(&"s".repeat(64)));
        let error = validate_notify_payload(&joined_over, PayloadProjection::Win32).unwrap_err();
        assert_eq!(error.code, error_code::PAYLOAD_INVALID);
        let details = error.details.unwrap();
        assert_eq!(details["field"], "body");
        assert_eq!(details["lengthUtf16"], 257);
        assert_eq!(details["limit"], 256);
        assert!(
            validate_notify_payload(&joined_over, PayloadProjection::Darwin).is_ok(),
            "darwin keeps subtitle a distinct field; no joined bound exists there"
        );

        // subtitle 64 + separator 2 + body 190 = 256 joined: exact fit.
        let joined_exact = content("t", Some(&"b".repeat(190)), Some(&"s".repeat(64)));
        assert!(validate_notify_payload(&joined_exact, PayloadProjection::Win32).is_ok());

        // The joined projection itself is the frozen prefix form.
        assert_eq!(
            win32_joined_body(&content("t", Some("body"), Some("sub"))),
            "sub\u{2014}body"
        );
        assert_eq!(win32_joined_body(&content("t", Some("body"), None)), "body");
    }

    /// Both platform DTO constructors serialize the complete frozen
    /// schema (design section 3): exhaustive key fixtures so a new field
    /// without both projections is red, and the cross-platform
    /// constructor comparison the CI gate asserts.
    #[test]
    fn backend_capabilities_fixtures_are_frozen() {
        let darwin = NotificationBackendCapabilities::darwin();
        assert_eq!(
            serde_json::to_value(&darwin).unwrap(),
            serde_json::json!({
                "platform": "darwin",
                "authorizationModel": "user",
                "channel": "user-notification-center",
                "titleLimitUtf16": 64,
                "bodyLimitUtf16": 256,
                "subtitleLimitUtf16": 64,
                "supportsSubtitle": true,
            })
        );
        let win32 = NotificationBackendCapabilities::win32();
        assert_eq!(
            serde_json::to_value(&win32).unwrap(),
            serde_json::json!({
                "platform": "win32",
                "authorizationModel": "always-granted",
                "channel": "tray-icon-info",
                "titleLimitUtf16": 64,
                "bodyLimitUtf16": 256,
                "subtitleLimitUtf16": 64,
                "supportsSubtitle": false,
            })
        );

        let wire = serde_json::to_value(&darwin).unwrap();
        let object = wire.as_object().expect("backend DTO object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "authorizationModel",
                "bodyLimitUtf16",
                "channel",
                "platform",
                "subtitleLimitUtf16",
                "supportsSubtitle",
                "titleLimitUtf16",
            ]
        );
        // The limit fields share one source with the payload bounds.
        assert_eq!(darwin.title_limit_utf16, TITLE_LIMIT_UTF16);
        assert_eq!(win32.body_limit_utf16, BODY_LIMIT_UTF16);
        assert_eq!(win32.subtitle_limit_utf16, SUBTITLE_LIMIT_UTF16);
        // The two projections differ exactly on the platform facts.
        assert_ne!(darwin, win32);
    }

    #[test]
    fn terminal_builders_match_the_frozen_wire_semantics() {
        assert_eq!(
            notify_accepted_result(),
            serde_json::json!({ "type": "result", "op": "notify" })
        );
        assert_eq!(
            authorization_status_result(AuthorizationStatus::NotDetermined),
            serde_json::json!({ "type": "authorization", "status": "notDetermined" })
        );
        assert_eq!(
            authorization_decision_result(false),
            serde_json::json!({ "type": "authorizationDecision", "granted": false })
        );
        // win32 documented degradations (design section 2).
        assert_eq!(
            win32_authorization_status_result(),
            serde_json::json!({ "type": "authorization", "status": "granted" })
        );
        assert_eq!(
            win32_authorization_decision_result(),
            serde_json::json!({ "type": "authorizationDecision", "granted": true })
        );
    }

    /// The denied rejection names the snapshot provenance (design section
    /// 4: "在 typed 错误与后端日志中注明快照来源——绝不静默丢弃") and the
    /// failed-reason shape carries the frozen `reason` detail key.
    #[test]
    fn typed_error_details_payloads_match_the_frozen_shape() {
        let error = denied_error(AuthorizationStatus::Denied, "requestAuthorization");
        assert_eq!(error.code, error_code::DENIED);
        let details = error.details.unwrap();
        assert_eq!(details["status"], "denied");
        assert_eq!(details["snapshotSource"], "requestAuthorization");
        assert!(error.message.contains("snapshot"));

        let error = failed_reason_error(
            REASON_AUTHORIZATION_TIMEOUT,
            "the authorization callback never arrived within the 10s budget",
        );
        assert_eq!(error.code, error_code::FAILED);
        assert_eq!(error.details.unwrap()["reason"], "authorization-timeout");
    }
}
