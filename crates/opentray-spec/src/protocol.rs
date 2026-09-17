use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ext::{ExpectedExtensionIdentity, ExtensionEnvelope, TypedExtensionError};
use crate::model::{
    AppEvent, AppIcon, AppId, AppIdentity, AppOptions, AppRef, Icon, Menu, Rect, SessionId,
    Tooltip, TrayEvent, TrayId, TrayOptions,
};

/// Protocol 2 (add-ext-dialog design section 5.1) adds the DeferredOperation
/// transaction frames `ext-command-accepted` and `ext-operation-terminal`.
/// The bump is one matrix: Node client, broker, socket endpoint, and ready
/// metadata all carry 2, and a version-1 Init is rejected with
/// `incompatible-protocol`.
pub const PROTOCOL_VERSION: u32 = 2;
pub type RequestId = String;

/// Wire length of an `operationId`: one u64 handle in lowercase hex.
pub const OPERATION_ID_HEX_LENGTH: usize = 16;

/// Frozen `operationId` wire form (add-ext-dialog design section 5.7 ruling
/// 2): exactly 16 ASCII lowercase hex digits. Empty strings, uppercase
/// letters, non-hex characters, and other lengths are rejected by this
/// predicate and by frame deserialization; they are never normalized.
pub fn is_valid_operation_id(value: &str) -> bool {
    value.len() == OPERATION_ID_HEX_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Serde validation for the frozen `operationId` wire form: deserialization
/// fails on any string [`is_valid_operation_id`] rejects.
mod operation_id {
    use super::is_valid_operation_id;
    use serde::{Deserialize, Deserializer};

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<String, D::Error> {
        let value = String::deserialize(deserializer)?;
        if is_valid_operation_id(&value) {
            Ok(value)
        } else {
            Err(serde::de::Error::custom(format!(
                "operationId must be 16 lowercase hex digits, got {value:?}"
            )))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHostSessionHealth {
    pub session_id: u64,
    #[serde(
        rename = "internalSessionId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub internal_session_id: Option<SessionId>,
    pub initialized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHostHealth {
    pub pid: u32,
    pub package_version: String,
    pub protocol_version: u32,
    pub endpoint: String,
    #[serde(flatten)]
    pub app: AppIdentity,
    pub caller_label: String,
    pub session_count: usize,
    pub sessions: Vec<RuntimeHostSessionHealth>,
}

/// Neutral caller label used when no usable caller identity can be derived.
pub const DEFAULT_CALLER_LABEL: &str = "opentray";

/// Maximum length of a sanitized caller label.
pub const CALLER_LABEL_MAX_LENGTH: usize = 48;

/// Sanitizes a caller label into a filesystem- and process-safe component:
/// lowercase alphanumerics and hyphens only, length-capped, with the neutral
/// fallback when nothing usable remains. Two distinct unsafe inputs do not
/// collapse onto the same label unless they are genuinely equivalent.
pub fn sanitize_caller_label(value: &str) -> String {
    let lowered = value.to_ascii_lowercase();
    let joined = lowered
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let trimmed = joined.trim_matches('-');
    if trimmed.is_empty() {
        return DEFAULT_CALLER_LABEL.to_string();
    }
    trimmed.chars().take(CALLER_LABEL_MAX_LENGTH).collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerEndpointIdentity {
    package_version: String,
    protocol_version: u32,
    caller_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrokerEndpointIdentityError {
    EmptyPackageVersion,
    InvalidPackageVersion(String),
    InvalidProtocolVersion(u32),
}

impl std::fmt::Display for BrokerEndpointIdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyPackageVersion => f.write_str("package version must not be empty"),
            Self::InvalidPackageVersion(value) => {
                write!(
                    f,
                    "package version contains invalid endpoint characters: {value}"
                )
            }
            Self::InvalidProtocolVersion(value) => {
                write!(f, "protocol version must be greater than zero: {value}")
            }
        }
    }
}

impl std::error::Error for BrokerEndpointIdentityError {}

impl BrokerEndpointIdentity {
    pub fn new(
        package_version: impl Into<String>,
        protocol_version: u32,
        caller_label: impl Into<String>,
    ) -> Result<Self, BrokerEndpointIdentityError> {
        let package_version = package_version.into();
        if package_version.is_empty() {
            return Err(BrokerEndpointIdentityError::EmptyPackageVersion);
        }
        if !is_valid_endpoint_component(&package_version) {
            return Err(BrokerEndpointIdentityError::InvalidPackageVersion(
                package_version,
            ));
        }
        if protocol_version == 0 {
            return Err(BrokerEndpointIdentityError::InvalidProtocolVersion(
                protocol_version,
            ));
        }
        let caller_label_raw = caller_label.into();
        let caller_label = if caller_label_raw.is_empty() {
            DEFAULT_CALLER_LABEL.to_string()
        } else {
            sanitize_caller_label(&caller_label_raw)
        };

        Ok(Self {
            package_version,
            protocol_version,
            caller_label,
        })
    }

    pub fn package_version(&self) -> &str {
        &self.package_version
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version
    }

    pub fn caller_label(&self) -> &str {
        &self.caller_label
    }

    pub fn endpoint_name(&self) -> String {
        format!(
            "opentray-{}-p{}-{}",
            self.package_version, self.protocol_version, self.caller_label
        )
    }

    /// Relative state directory path under the OpenTray home: `<pkg>/<caller>`.
    pub fn state_dir_name(&self) -> String {
        format!("{}/{}", self.package_version, self.caller_label)
    }

    pub fn unix_socket_file_name(&self) -> String {
        format!("opentray-p{}.sock", self.protocol_version)
    }

    pub fn windows_pipe_name(&self) -> String {
        format!(r"\\.\pipe\{}", self.endpoint_name())
    }

    /// Human-readable process title so task managers show the owning application.
    pub fn process_title(&self) -> String {
        format!("opentray · {}", self.caller_label)
    }
}

pub fn is_supported_protocol_version(protocol_version: u32) -> bool {
    protocol_version == PROTOCOL_VERSION
}

fn is_valid_endpoint_component(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientFrame {
    Init {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "clientVersion")]
        client_version: String,
    },
    CreateApp {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(flatten)]
        options: AppOptions,
    },
    ResolveDefaultApp {
        #[serde(rename = "requestId")]
        request_id: RequestId,
    },
    GetAppIdentity {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
    },
    SetAppName {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        name: String,
    },
    SetAppIcon {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "appIcon")]
        app_icon: Option<AppIcon>,
    },
    SetAppIconVariant {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        variant: String,
    },
    CreateTray {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        app: AppRef,
        tray: TrayOptions,
    },
    DestroyTray {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    GetTrayBounds {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    SetTrayMenu {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        menu: Menu,
    },
    SetTrayIcon {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        icon: Icon,
    },
    SetTrayTooltip {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        tooltip: Tooltip,
    },
    LoadExt {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        name: String,
        path: String,
        #[serde(rename = "expectedIdentity")]
        expected_identity: ExpectedExtensionIdentity,
        #[serde(default, rename = "mountId", skip_serializing_if = "Option::is_none")]
        mount_id: Option<String>,
    },
    ExtCommand {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    UnloadExt {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        name: String,
    },
    Health {
        #[serde(rename = "requestId")]
        request_id: RequestId,
    },
    Exit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerFrame {
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "brokerVersion")]
        broker_version: String,
        #[serde(rename = "brokerArtifactIdentity")]
        broker_artifact_identity: crate::BrokerArtifactIdentity,
        #[serde(rename = "sessionId")]
        session_id: SessionId,
    },
    AppCreated {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        app: AppRef,
    },
    DefaultApp {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        app: AppRef,
    },
    AppIdentity {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        identity: AppIdentity,
    },
    TrayCreated {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    TrayBounds {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        bounds: TrayBoundsResult,
    },
    Ack {
        #[serde(rename = "requestId")]
        request_id: RequestId,
    },
    ExtCommandResult {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        events: Vec<ExtensionEnvelope>,
    },
    /// DeferredOperation acceptance (design section 5.3): the command did
    /// not complete inside the dispatch; the client keeps the request
    /// pending until the matching `ext-operation-terminal` (or a
    /// transport-close rejection).
    ExtCommandAccepted {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(
            rename = "operationId",
            deserialize_with = "operation_id::deserialize"
        )]
        operation_id: String,
    },
    /// The single terminal frame of a deferred operation. Exactly one is
    /// delivered per accepted operation; duplicates are dropped by the
    /// broker's owner loop before any frame is written.
    ExtOperationTerminal {
        #[serde(
            rename = "operationId",
            deserialize_with = "operation_id::deserialize"
        )]
        operation_id: String,
        payload: ExtOperationPayload,
    },
    RuntimeHostHealth {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        health: RuntimeHostHealth,
    },
    Event {
        event: TrayEvent,
    },
    AppEvent {
        event: AppEvent,
    },
    ExtEvent {
        #[serde(rename = "appId")]
        app_id: AppId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    Error {
        #[serde(rename = "requestId", default, skip_serializing_if = "Option::is_none")]
        request_id: Option<RequestId>,
        code: String,
        message: String,
        /// Optional typed-error details (add-ext-dialog design section 7.5):
        /// when the `code` is an extension error category, this carries the
        /// discriminated JSON payload so the synchronous error frame is
        /// isomorphic with deferred terminal errors. Absent for errors
        /// without structured detail; old peers that never send it
        /// deserialize unchanged. The shared validator keeps one acceptance
        /// language across sync frames, FFI details, and deferred terminals.
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::ext::deserialize_details_object"
        )]
        details: Option<Value>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayBoundsKind {
    Native,
    Inferred,
    Unavailable,
}

/// Terminal payload of a deferred operation (design section 5.1 frozen): the
/// `result` branch resolves the client promise with `value`; the `error`
/// branch rejects it with a typed extension error. The cancel path is a
/// `result` payload isomorphic to user cancellation -- there is no third
/// channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExtOperationPayload {
    Result { value: Value },
    Error { error: TypedExtensionError },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayBoundsResult {
    pub kind: TrayBoundsKind,
    pub source: String,
    pub rect: Option<Rect>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_identity_includes_package_protocol_and_caller_label() {
        let identity = BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "myapp").unwrap();

        assert_eq!(identity.caller_label(), "myapp");
        assert_eq!(identity.endpoint_name(), "opentray-0.1.0-p2-myapp");
        assert_eq!(identity.state_dir_name(), "0.1.0/myapp");
        assert_eq!(identity.unix_socket_file_name(), "opentray-p2.sock");
        assert_eq!(
            identity.windows_pipe_name(),
            r"\\.\pipe\opentray-0.1.0-p2-myapp"
        );
        assert_eq!(identity.process_title(), "opentray · myapp");
    }

    #[test]
    fn endpoint_identity_falls_back_to_neutral_caller_label() {
        let identity = BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "").unwrap();

        assert_eq!(identity.caller_label(), "opentray");
    }

    #[test]
    fn endpoint_identity_sanitizes_unsafe_caller_labels() {
        let identity = BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "My App!!!").unwrap();

        assert_eq!(identity.caller_label(), "my-app");
    }

    #[test]
    fn endpoint_identity_rejects_path_like_versions() {
        let error = BrokerEndpointIdentity::new("../0.1.0", PROTOCOL_VERSION, "myapp").unwrap_err();

        assert_eq!(
            error,
            BrokerEndpointIdentityError::InvalidPackageVersion("../0.1.0".to_string())
        );
    }

    #[test]
    fn handshake_frames_use_explicit_protocol_version_fields() {
        let init = ClientFrame::Init {
            protocol_version: PROTOCOL_VERSION,
            client_version: "0.1.0".to_string(),
        };
        let ready = ServerFrame::Ready {
            protocol_version: PROTOCOL_VERSION,
            broker_version: "0.1.0".to_string(),
            broker_artifact_identity: crate::BrokerArtifactIdentity {
                package_version: "0.1.0".to_string(),
                target: crate::BrokerArtifactTarget {
                    os: "darwin".to_string(),
                    arch: "arm64".to_string(),
                },
                executable_hash: "a".repeat(64),
                build_identity: "sha256:aaaaaaaaaaaaaaaa".to_string(),
            },
            session_id: "session-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(init).unwrap(),
            serde_json::json!({
                "type": "init",
                "protocolVersion": 2,
                "clientVersion": "0.1.0"
            })
        );
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            serde_json::json!({
                "type": "ready",
                "protocolVersion": 2,
                "brokerVersion": "0.1.0",
                "brokerArtifactIdentity": {
                    "packageVersion": "0.1.0",
                    "target": { "os": "darwin", "arch": "arm64" },
                    "executableHash": "a".repeat(64),
                    "buildIdentity": "sha256:aaaaaaaaaaaaaaaa"
                },
                "sessionId": "session-1"
            })
        );
    }

    #[test]
    fn primary_event_menu_item_serializes_as_camel_case_role() {
        let menu = Menu {
            items: vec![crate::model::MenuItem::Item {
                id: 8,
                title: "Show Window".to_string(),
                primary_event: true,
                enabled: true,
                shortcut: None,
            }],
        };

        assert_eq!(
            serde_json::to_value(menu).unwrap(),
            serde_json::json!({
                "items": [
                    {
                        "type": "item",
                        "id": 8,
                        "title": "Show Window",
                        "primaryEvent": true,
                        "enabled": true
                    }
                ]
            })
        );
    }

    #[test]
    fn primary_event_menu_item_defaults_to_false_when_absent() {
        let menu: Menu = serde_json::from_value(serde_json::json!({
            "items": [
                {
                    "type": "item",
                    "id": 8,
                    "title": "Show Window"
                }
            ]
        }))
        .unwrap();

        let [crate::model::MenuItem::Item { primary_event, .. }] = menu.items.as_slice() else {
            panic!("expected plain menu item");
        };
        assert!(!*primary_event);
    }

    #[test]
    fn protocol_version_check_rejects_mismatch() {
        assert!(is_supported_protocol_version(PROTOCOL_VERSION));
        assert!(!is_supported_protocol_version(PROTOCOL_VERSION + 1));
        // The version-2 bump retires version 1 exhaustively: an old client's
        // Init must be refused instead of half-parsed (design section 5.1
        // frozen matrix).
        assert!(!is_supported_protocol_version(1));
    }

    #[test]
    fn deferred_operation_frames_round_trip_both_payload_branches() {
        let accepted = ServerFrame::ExtCommandAccepted {
            request_id: "req-1".to_string(),
            operation_id: "000000000000000f".to_string(),
        };
        let terminal_result = ServerFrame::ExtOperationTerminal {
            operation_id: "000000000000000f".to_string(),
            payload: ExtOperationPayload::Result {
                value: serde_json::json!({ "response": 0, "suppressed": false }),
            },
        };
        let terminal_error = ServerFrame::ExtOperationTerminal {
            operation_id: "000000000000000f".to_string(),
            payload: ExtOperationPayload::Error {
                error: TypedExtensionError {
                    code: "dialog_dismissal_unavailable".to_string(),
                    message: "platform cannot observe the dismissal reason".to_string(),
                    details: Some(serde_json::json!({ "kind": "dismissal" })),
                },
            },
        };

        assert_eq!(
            serde_json::to_value(&accepted).unwrap(),
            serde_json::json!({
                "type": "ext-command-accepted",
                "requestId": "req-1",
                "operationId": "000000000000000f"
            })
        );
        assert_eq!(
            serde_json::to_value(&terminal_result).unwrap(),
            serde_json::json!({
                "type": "ext-operation-terminal",
                "operationId": "000000000000000f",
                "payload": {
                    "kind": "result",
                    "value": { "response": 0, "suppressed": false }
                }
            })
        );
        assert_eq!(
            serde_json::to_value(&terminal_error).unwrap(),
            serde_json::json!({
                "type": "ext-operation-terminal",
                "operationId": "000000000000000f",
                "payload": {
                    "kind": "error",
                    "error": {
                        "code": "dialog_dismissal_unavailable",
                        "message": "platform cannot observe the dismissal reason",
                        "details": { "kind": "dismissal" }
                    }
                }
            })
        );

        // Parser truth: both wire forms deserialize into the same frames.
        assert_eq!(
            serde_json::from_value::<ServerFrame>(serde_json::to_value(&accepted).unwrap())
                .unwrap(),
            accepted
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(serde_json::to_value(&terminal_result).unwrap())
                .unwrap(),
            terminal_result
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(serde_json::to_value(&terminal_error).unwrap())
                .unwrap(),
            terminal_error
        );
        // A terminal without a known discriminated branch is rejected, not
        // guessed.
        assert!(serde_json::from_value::<ServerFrame>(serde_json::json!({
            "type": "ext-operation-terminal",
            "operationId": "000000000000000f",
            "payload": { "kind": "cancel" }
        }))
        .is_err());
    }

    #[test]
    fn sync_error_details_share_the_single_object_language() {
        // The synchronous error frame uses the same validator as FFI details
        // and deferred terminals: absent or a JSON object, never null,
        // scalars, or arrays (impl review R3).
        let valid = serde_json::from_value::<ServerFrame>(serde_json::json!({
            "type": "error",
            "requestId": "req-1",
            "code": "dialog_session_busy",
            "message": "busy",
            "details": { "owner": "tray-1" }
        }))
        .expect("object details accepted");
        assert!(matches!(&valid, ServerFrame::Error { details: Some(v), .. } if v.is_object()));

        for details in [serde_json::json!(null), serde_json::json!(1), serde_json::json!("s"), serde_json::json!([])] {
            assert!(
                serde_json::from_value::<ServerFrame>(serde_json::json!({
                    "type": "error",
                    "requestId": "req-1",
                    "code": "dialog_session_busy",
                    "message": "busy",
                    "details": details
                }))
                .is_err(),
                "sync frame must reject non-object details: {details}"
            );
        }
    }

    #[test]
    fn command_responses_carry_request_ids() {
        let frame = ServerFrame::AppCreated {
            request_id: "req-1".to_string(),
            app: AppRef {
                app_id: "app-1".to_string(),
            },
        };
        let error = ServerFrame::Error {
            request_id: Some("req-2".to_string()),
            code: "not-initialized".to_string(),
            message: "init required".to_string(),
            details: None,
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "app-created",
                "requestId": "req-1",
                "app": {
                    "appId": "app-1"
                }
            })
        );
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "type": "error",
                "requestId": "req-2",
                "code": "not-initialized",
                "message": "init required"
            }),
            "a details-free error frame stays byte-identical on the wire"
        );
    }

    #[test]
    fn error_frames_carry_typed_details_and_stay_optionally_parseable() {
        // Synchronous typed errors ride the same `details` JSON as deferred
        // terminal errors (design section 7.5): the wire must carry it, and
        // old peers that omit it deserialize unchanged.
        let error = ServerFrame::Error {
            request_id: Some("req-9".to_string()),
            code: "dialog_invalid_options".to_string(),
            message: "buttons must not be empty".to_string(),
            details: Some(serde_json::json!({ "kind": "options", "field": "buttons" })),
        };
        let wire = serde_json::to_value(&error).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({
                "type": "error",
                "requestId": "req-9",
                "code": "dialog_invalid_options",
                "message": "buttons must not be empty",
                "details": { "kind": "options", "field": "buttons" }
            })
        );
        let round: ServerFrame = serde_json::from_value(wire).expect("details round-trip");
        assert_eq!(round, error);

        let legacy: ServerFrame = serde_json::from_value(serde_json::json!({
            "type": "error",
            "requestId": "req-10",
            "code": "not-initialized",
            "message": "init required"
        }))
        .expect("legacy error frame without details");
        let expected_legacy = ServerFrame::Error {
            request_id: Some("req-10".to_string()),
            code: "not-initialized".to_string(),
            message: "init required".to_string(),
            details: None,
        };
        assert_eq!(legacy, expected_legacy);
    }

    /// The frozen operationId wire form is enforced by the parser itself:
    /// empty, uppercase, non-hex, and wrong-length ids are rejected, never
    /// normalized (design section 5.7 ruling 2).
    #[test]
    fn operation_id_wire_form_is_enforced_by_the_parser() {
        assert!(is_valid_operation_id("000000000000000f"));
        assert!(is_valid_operation_id("ffffffffffffffff"));
        assert!(is_valid_operation_id("0123456789abcdef"));

        // Adversarial ids the predicate and parser must both reject.
        let adversarial = [
            "",
            "000000000000000F",
            "000000000000000g",
            "000000000000000z",
            "000000000000000",
            "000000000000000ff",
            "0x0000000000000f",
            "00000000-0000-000f",
            "ffffffffffffffff\n",
        ];
        for id in adversarial {
            assert!(!is_valid_operation_id(id), "predicate must reject {id:?}");
            for frame_type in ["ext-command-accepted", "ext-operation-terminal"] {
                let raw = serde_json::json!({
                    "type": frame_type,
                    "requestId": "req-1",
                    "operationId": id,
                    "payload": { "kind": "result", "value": null }
                });
                assert!(
                    serde_json::from_value::<ServerFrame>(raw).is_err(),
                    "parser must reject operationId {id:?} on {frame_type}"
                );
            }
        }
    }

    #[test]
    fn health_frames_use_request_ids_and_camel_case_metadata() {
        let request = ClientFrame::Health {
            request_id: "req-health".to_string(),
        };
        let response = ServerFrame::RuntimeHostHealth {
            request_id: "req-health".to_string(),
            health: RuntimeHostHealth {
                pid: 12345,
                package_version: "0.1.0".to_string(),
                protocol_version: PROTOCOL_VERSION,
                endpoint: "/tmp/opentray.sock".to_string(),
                app: AppIdentity {
                    app_id: "com.example.build".to_string(),
                    app_name: "Build".to_string(),
                    app_icon: None,
                    app_icon_variant: None,
                },
                caller_label: "myapp".to_string(),
                session_count: 2,
                sessions: vec![
                    RuntimeHostSessionHealth {
                        session_id: 1,
                        internal_session_id: Some("session-1".to_string()),
                        initialized: true,
                    },
                    RuntimeHostSessionHealth {
                        session_id: 2,
                        internal_session_id: None,
                        initialized: false,
                    },
                ],
            },
        };

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "type": "health",
                "requestId": "req-health"
            })
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "type": "runtime-host-health",
                "requestId": "req-health",
                "health": {
                    "pid": 12345,
                    "packageVersion": "0.1.0",
                    "protocolVersion": 2,
                    "endpoint": "/tmp/opentray.sock",
                    "appId": "com.example.build",
                    "appName": "Build",
                    "callerLabel": "myapp",
                    "sessionCount": 2,
                    "sessions": [
                        {
                            "sessionId": 1,
                            "internalSessionId": "session-1",
                            "initialized": true
                        },
                        {
                            "sessionId": 2,
                            "initialized": false
                        }
                    ]
                }
            })
        );
    }

    #[test]
    fn protocol_uses_camel_case_identity_fields() {
        let frame = ServerFrame::TrayCreated {
            request_id: "req-1".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
        };
        let command = ClientFrame::DestroyTray {
            request_id: "req-2".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "tray-created",
                "requestId": "req-1",
                "appId": "app-1",
                "trayId": "tray-1"
            })
        );
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            serde_json::json!({
                "type": "destroy-tray",
                "requestId": "req-2",
                "appId": "app-1",
                "trayId": "tray-1"
            })
        );
    }

    #[test]
    fn create_tray_frame_deserializes_without_icon() {
        // Regression for issue #3: a create-tray frame omitting the icon must
        // deserialize successfully (icon is optional), so the broker responds
        // instead of failing to parse and hanging the client.
        let raw = serde_json::json!({
            "type": "create-tray",
            "requestId": "req-3",
            "app": { "appId": "app-1" },
            "tray": {
                "id": "tray-1"
            }
        });

        let frame: ClientFrame =
            serde_json::from_value(raw).expect("create-tray parses without icon");
        match frame {
            ClientFrame::CreateTray { tray, .. } => {
                assert_eq!(tray.icon, None);
            }
            other => panic!("expected CreateTray, got {other:?}"),
        }
    }

    #[test]
    fn event_frames_use_camel_case_tray_event_fields() {
        let frame = ServerFrame::Event {
            event: TrayEvent::MenuClick {
                app_id: "app-1".to_string(),
                tray_id: "daemon-status".to_string(),
                item_id: 99,
            },
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "event",
                "event": {
                    "type": "menuClick",
                    "appId": "app-1",
                    "trayId": "daemon-status",
                    "itemId": 99
                }
            })
        );
    }

    #[test]
    fn app_event_frames_expose_generic_reopen_intent() {
        let frame = ServerFrame::AppEvent {
            event: AppEvent::ReopenRequested {
                app_id: "app-1".to_string(),
            },
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "app-event",
                "event": {
                    "type": "reopenRequested",
                    "appId": "app-1"
                }
            })
        );
    }

    #[test]
    fn tray_click_events_carry_tray_identity() {
        let frame = ServerFrame::Event {
            event: TrayEvent::TrayClick {
                app_id: "app-1".to_string(),
                tray_id: "daemon-status".to_string(),
                button: crate::model::MouseButton::Left,
                x: 10,
                y: 20,
            },
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "event",
                "event": {
                    "type": "trayClick",
                    "appId": "app-1",
                    "trayId": "daemon-status",
                    "button": "left",
                    "x": 10,
                    "y": 20
                }
            })
        );
    }

    #[test]
    fn tray_bounds_frames_serialize_as_additive_protocol_shapes() {
        let request = ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
        };
        let response = ServerFrame::TrayBounds {
            request_id: "req-bounds".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            bounds: TrayBoundsResult {
                kind: TrayBoundsKind::Native,
                source: "backend.nativeTrayBounds".to_string(),
                rect: Some(Rect {
                    x: 12,
                    y: 18,
                    width: 24,
                    height: 24,
                }),
            },
        };

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "type": "get-tray-bounds",
                "requestId": "req-bounds",
                "appId": "app-1",
                "trayId": "tray-1"
            })
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "type": "tray-bounds",
                "requestId": "req-bounds",
                "appId": "app-1",
                "trayId": "tray-1",
                "bounds": {
                    "kind": "native",
                    "source": "backend.nativeTrayBounds",
                    "rect": {
                        "x": 12,
                        "y": 18,
                        "width": 24,
                        "height": 24
                    }
                }
            })
        );
    }
}
