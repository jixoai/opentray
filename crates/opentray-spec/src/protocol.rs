use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    Icon, Menu, SurfaceId, SurfaceOptions, SurfaceRef, Tooltip, TrayEvent, TrayId, TrayOptions,
};

pub const PROTOCOL_VERSION: u32 = 1;

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
    CreateSurface {
        #[serde(flatten)]
        options: SurfaceOptions,
    },
    ResolveDefaultSurface,
    CreateTray {
        surface: SurfaceRef,
        tray: TrayOptions,
    },
    DestroyTray {
        surface_id: SurfaceId,
        tray_id: TrayId,
    },
    SetTrayMenu {
        surface_id: SurfaceId,
        tray_id: TrayId,
        menu: Menu,
    },
    SetTrayIcon {
        surface_id: SurfaceId,
        tray_id: TrayId,
        icon: Icon,
    },
    SetTrayTooltip {
        surface_id: SurfaceId,
        tray_id: TrayId,
        tooltip: Tooltip,
    },
    LoadExt {
        surface_id: SurfaceId,
        name: String,
        path: String,
    },
    ExtCommand {
        surface_id: SurfaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    UnloadExt {
        surface_id: SurfaceId,
        name: String,
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
    },
    SurfaceCreated {
        surface: SurfaceRef,
    },
    DefaultSurface {
        surface: SurfaceRef,
    },
    TrayCreated {
        surface_id: SurfaceId,
        tray_id: TrayId,
    },
    Event {
        event: TrayEvent,
    },
    ExtEvent {
        surface_id: SurfaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    Error {
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
                "brokerVersion": "0.1.0"
            })
        );
    }

    #[test]
    fn protocol_version_check_rejects_mismatch() {
        assert!(is_supported_protocol_version(PROTOCOL_VERSION));
        assert!(!is_supported_protocol_version(PROTOCOL_VERSION + 1));
    }
}
