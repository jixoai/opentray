use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    Icon, Menu, SessionId, SpaceId, SpaceOptions, SpaceRef, Tooltip, TrayEvent, TrayId, TrayOptions,
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
    pub session_count: usize,
    pub sessions: Vec<DaemonSessionHealth>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerEndpointIdentity {
    package_version: String,
    protocol_version: u32,
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

        Ok(Self {
            package_version,
            protocol_version,
        })
    }

    pub fn package_version(&self) -> &str {
        &self.package_version
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version
    }

    pub fn endpoint_name(&self) -> String {
        format!(
            "opentray-{}-p{}",
            self.package_version, self.protocol_version
        )
    }

    pub fn state_dir_name(&self) -> &str {
        &self.package_version
    }

    pub fn unix_socket_file_name(&self) -> String {
        format!("opentray-p{}.sock", self.protocol_version)
    }

    pub fn windows_pipe_name(&self) -> String {
        format!(r"\\.\pipe\{}", self.endpoint_name())
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
    LoadExt {
        #[serde(rename = "requestId")]
        request_id: RequestId,
        #[serde(rename = "spaceId")]
        space_id: SpaceId,
        name: String,
        path: String,
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
    Ack {
        #[serde(rename = "requestId")]
        request_id: RequestId,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_identity_includes_package_and_protocol_versions() {
        let identity = BrokerEndpointIdentity::new("0.1.0", PROTOCOL_VERSION).unwrap();

        assert_eq!(identity.endpoint_name(), "opentray-0.1.0-p1");
        assert_eq!(identity.state_dir_name(), "0.1.0");
        assert_eq!(identity.unix_socket_file_name(), "opentray-p1.sock");
        assert_eq!(identity.windows_pipe_name(), r"\\.\pipe\opentray-0.1.0-p1");
    }

    #[test]
    fn endpoint_identity_rejects_path_like_versions() {
        let error = BrokerEndpointIdentity::new("../0.1.0", PROTOCOL_VERSION).unwrap_err();

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
}
