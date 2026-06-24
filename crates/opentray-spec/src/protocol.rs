use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ext::ExtensionEnvelope;
use crate::model::{
    Icon, Menu, Rect, SessionId, SpaceId, SpaceOptions, SpaceRef, Tooltip, TrayEvent, TrayId,
    TrayOptions,
};

pub const PROTOCOL_VERSION: u32 = 1;
pub type RequestId = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonSessionHealth {
    pub session_id: u64,
    #[serde(
        rename = "internalLeaseId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub internal_lease_id: Option<SessionId>,
    pub initialized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonHealth {
    pub pid: u32,
    pub package_version: String,
    pub protocol_version: u32,
    pub endpoint: String,
    pub caller_label: String,
    pub session_count: usize,
    pub sessions: Vec<DaemonSessionHealth>,
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
    #[serde(alias = "create-surface")]
    CreateSpace {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(flatten)]
        options: SpaceOptions,
    },
    #[serde(alias = "resolve-default-surface")]
    ResolveDefaultSpace {
        #[serde(rename = "requestId")]
        request_id: RequestId,
    },
    CreateTray {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        space: SpaceRef,
        tray: TrayOptions,
    },
    DestroyTray {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    GetTrayBounds {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    SetTrayMenu {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        menu: Menu,
    },
    SetTrayIcon {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        icon: Icon,
    },
    SetTrayTooltip {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        tooltip: Tooltip,
    },
    SetTrayTitle {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        title: String,
    },
    LoadExt {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        name: String,
        path: String,
        #[serde(default, rename = "mountId", skip_serializing_if = "Option::is_none")]
        mount_id: Option<String>,
    },
    ExtCommand {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    UnloadExt {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
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
        #[serde(rename = "sessionId")]
        session_id: SessionId,
    },
    #[serde(alias = "surface-created")]
    SpaceCreated {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        space: SpaceRef,
    },
    #[serde(alias = "default-surface")]
    DefaultSpace {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        space: SpaceRef,
    },
    TrayCreated {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        #[serde(rename = "trayId")]
        tray_id: TrayId,
    },
    TrayBounds {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
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
    DaemonHealth {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        health: DaemonHealth,
    },
    Event {
        event: TrayEvent,
    },
    ExtEvent {
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
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
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrayBoundsKind {
    Native,
    Inferred,
    Unavailable,
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
        let identity =
            BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "myapp").unwrap();

        assert_eq!(identity.caller_label(), "myapp");
        assert_eq!(identity.endpoint_name(), "opentray-0.1.0-p1-myapp");
        assert_eq!(identity.state_dir_name(), "0.1.0/myapp");
        assert_eq!(identity.unix_socket_file_name(), "opentray-p1.sock");
        assert_eq!(identity.windows_pipe_name(), r"\\.\pipe\opentray-0.1.0-p1-myapp");
        assert_eq!(identity.process_title(), "opentray · myapp");
    }

    #[test]
    fn endpoint_identity_falls_back_to_neutral_caller_label() {
        let identity = BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "").unwrap();

        assert_eq!(identity.caller_label(), "opentray");
    }

    #[test]
    fn endpoint_identity_sanitizes_unsafe_caller_labels() {
        let identity =
            BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION, "My App!!!").unwrap();

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
            session_id: "session-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(init).unwrap(),
            serde_json::json!({
                "type": "init",
                "protocolVersion": 1,
                "clientVersion": "0.1.0"
            })
        );
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            serde_json::json!({
                "type": "ready",
                "protocolVersion": 1,
                "brokerVersion": "0.1.0",
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
    }

    #[test]
    fn command_responses_carry_request_ids() {
        let frame = ServerFrame::SpaceCreated {
            request_id: "req-1".to_string(),
            space: SpaceRef {
                space_id: "space-1".to_string(),
            },
        };
        let error = ServerFrame::Error {
            request_id: Some("req-2".to_string()),
            code: "not-initialized".to_string(),
            message: "init required".to_string(),
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "space-created",
                "requestId": "req-1",
                "space": {
                    "spaceId": "space-1"
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
            })
        );
    }

    #[test]
    fn health_frames_use_request_ids_and_camel_case_metadata() {
        let request = ClientFrame::Health {
            request_id: "req-health".to_string(),
        };
        let response = ServerFrame::DaemonHealth {
            request_id: "req-health".to_string(),
            health: DaemonHealth {
                pid: 12345,
                package_version: "0.1.0".to_string(),
                protocol_version: PROTOCOL_VERSION,
                endpoint: "/tmp/opentray.sock".to_string(),
                caller_label: "myapp".to_string(),
                session_count: 2,
                sessions: vec![
                    DaemonSessionHealth {
                        session_id: 1,
                        internal_lease_id: Some("lease-1".to_string()),
                        initialized: true,
                    },
                    DaemonSessionHealth {
                        session_id: 2,
                        internal_lease_id: None,
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
                "type": "daemon-health",
                "requestId": "req-health",
                "health": {
                    "pid": 12345,
                    "packageVersion": "0.1.0",
                    "protocolVersion": 1,
                    "endpoint": "/tmp/opentray.sock",
                    "callerLabel": "myapp",
                    "sessionCount": 2,
                    "sessions": [
                        {
                            "sessionId": 1,
                            "internalLeaseId": "lease-1",
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
            space_id: "space-1".to_string(),
            tray_id: "tray-1".to_string(),
        };
        let command = ClientFrame::DestroyTray {
            request_id: "req-2".to_string(),
            space_id: "space-1".to_string(),
            tray_id: "tray-1".to_string(),
        };

        assert_eq!(
            serde_json::to_value(frame).unwrap(),
            serde_json::json!({
                "type": "tray-created",
                "requestId": "req-1",
                "spaceId": "space-1",
                "trayId": "tray-1"
            })
        );
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            serde_json::json!({
                "type": "destroy-tray",
                "requestId": "req-2",
                "spaceId": "space-1",
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
            "space": { "spaceId": "space-1" },
            "tray": {
                "trayId": "tray-1",
                "title": "repro"
            }
        });

        let frame: ClientFrame = serde_json::from_value(raw).expect("create-tray parses without icon");
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
                space_id: "space-1".to_string(),
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
                    "spaceId": "space-1",
                    "trayId": "daemon-status",
                    "itemId": 99
                }
            })
        );
    }

    #[test]
    fn tray_click_events_carry_tray_identity() {
        let frame = ServerFrame::Event {
            event: TrayEvent::TrayClick {
                space_id: "space-1".to_string(),
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
                    "spaceId": "space-1",
                    "trayId": "daemon-status",
                    "button": "left",
                    "x": 10,
                    "y": 20
                }
            })
        );
    }

    #[test]
    fn set_tray_title_serializes_as_tray_scoped_command() {
        let request = ClientFrame::SetTrayTitle {
            request_id: "req-title".to_string(),
            space_id: "space-1".to_string(),
            tray_id: "tray-1".to_string(),
            title: "Focus".to_string(),
        };

        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "type": "set-tray-title",
                "requestId": "req-title",
                "spaceId": "space-1",
                "trayId": "tray-1",
                "title": "Focus"
            })
        );
    }

    #[test]
    fn tray_bounds_frames_serialize_as_additive_protocol_shapes() {
        let request = ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            space_id: "space-1".to_string(),
            tray_id: "tray-1".to_string(),
        };
        let response = ServerFrame::TrayBounds {
            request_id: "req-bounds".to_string(),
            space_id: "space-1".to_string(),
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
                "spaceId": "space-1",
                "trayId": "tray-1"
            })
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "type": "tray-bounds",
                "requestId": "req-bounds",
                "spaceId": "space-1",
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
