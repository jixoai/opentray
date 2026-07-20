use std::sync::Mutex;

use napi::{Error, Status};
use napi_derive::napi;
use opentray_core::{
    BackendCapabilities, BrokerKernel, BrokerSession, FakeBackend, UnsupportedExtensionLoader,
};
use opentray_spec::{
    AppIdentity, AppOptions, BrokerArtifactIdentity, BrokerArtifactTarget, ClientFrame,
    RuntimeHostHealth, RuntimeHostSessionHealth, ServerFrame, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod visible;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod visible_unsupported;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use visible::*;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use visible_unsupported::*;

#[napi(object)]
pub struct RuntimeBindingInfo {
    pub kind: String,
    pub protocol_version: u32,
}

#[napi]
pub fn runtime_binding_info() -> RuntimeBindingInfo {
    RuntimeBindingInfo {
        kind: "opentray-node-runtime".to_string(),
        protocol_version: PROTOCOL_VERSION,
    }
}

#[napi]
pub struct HeadlessRuntime {
    broker: Mutex<BrokerKernel<FakeBackend>>,
    session: Mutex<BrokerSession>,
    package_version: String,
    app: AppIdentity,
}

#[napi]
impl HeadlessRuntime {
    #[napi]
    pub fn request(&self, frame_json: String) -> napi::Result<Vec<String>> {
        let frame = serde_json::from_str::<ClientFrame>(&frame_json).map_err(|error| {
            Error::new(
                Status::InvalidArg,
                format!("invalid OpenTray client frame JSON: {error}"),
            )
        })?;
        if let ClientFrame::Health { request_id } = frame {
            let session = self
                .session
                .lock()
                .map_err(|_| Error::new(Status::GenericFailure, "runtime session lock poisoned"))?;
            return serialize_frames(vec![ServerFrame::RuntimeHostHealth {
                request_id,
                health: self.health(&session),
            }]);
        }
        let mut broker = self
            .broker
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime broker lock poisoned"))?;
        let mut session = self
            .session
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime session lock poisoned"))?;
        let frames = broker.handle_frame(&mut session, frame, &self.package_version);
        serialize_frames(frames)
    }

    #[napi]
    pub fn close(&self) -> napi::Result<Vec<String>> {
        let mut broker = self
            .broker
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime broker lock poisoned"))?;
        let mut session = self
            .session
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime session lock poisoned"))?;
        let frames = broker.close_session(&mut session);
        serialize_frames(frames)
    }

    fn health(&self, session: &BrokerSession) -> RuntimeHostHealth {
        let session_health = session
            .session_id()
            .map(|session_id| RuntimeHostSessionHealth {
                session_id: 1,
                internal_session_id: Some(session_id.to_string()),
                initialized: true,
            });
        RuntimeHostHealth {
            pid: std::process::id(),
            package_version: self.package_version.clone(),
            protocol_version: PROTOCOL_VERSION,
            endpoint: "in-process://opentray-runtime-node/headless".to_string(),
            app: session
                .app_identity()
                .cloned()
                .unwrap_or_else(|| self.app.clone()),
            caller_label: opentray_spec::sanitize_caller_label(&self.app.app_name),
            session_count: usize::from(session_health.is_some()),
            sessions: session_health.into_iter().collect(),
        }
    }
}

#[napi]
pub fn create_headless_runtime(
    package_version: Option<String>,
    app_id: Option<String>,
    app_name: Option<String>,
) -> napi::Result<HeadlessRuntime> {
    let package_version = package_version.unwrap_or_else(|| "0.0.0".to_string());
    let broker_artifact_identity = runtime_broker_artifact_identity(&package_version)?;
    let app = runtime_app_identity(app_id, app_name);
    Ok(HeadlessRuntime {
        broker: Mutex::new(BrokerKernel::with_default_app_options(
            FakeBackend::new(BackendCapabilities::full()),
            UnsupportedExtensionLoader,
            AppOptions {
                id: Some(app.app_id.clone()),
                name: Some(app.app_name.clone()),
                app_icon: None,
                default: true,
            },
            broker_artifact_identity,
        )),
        session: Mutex::new(BrokerSession::new()),
        package_version,
        app,
    })
}

pub(crate) fn runtime_broker_artifact_identity(
    package_version: &str,
) -> napi::Result<BrokerArtifactIdentity> {
    let executable_path = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(runtime_identity_error)?;
    let executable_hash = format!(
        "{:x}",
        Sha256::digest(std::fs::read(&executable_path).map_err(runtime_identity_error)?)
    );
    Ok(BrokerArtifactIdentity {
        package_version: package_version.to_string(),
        target: BrokerArtifactTarget {
            os: if cfg!(target_os = "windows") {
                "win32"
            } else if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            }
            .to_string(),
            arch: if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            }
            .to_string(),
        },
        build_identity: format!("sha256:{}", &executable_hash[..16]),
        executable_hash,
    })
}

fn runtime_identity_error(error: std::io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("unable to identify the in-process runtime host: {error}"),
    )
}

fn runtime_app_identity(app_id: Option<String>, app_name: Option<String>) -> AppIdentity {
    let app_id = non_empty(app_id).unwrap_or_else(|| "opentray".to_string());
    let app_name = non_empty(app_name).unwrap_or_else(|| app_id.clone());
    AppIdentity {
        app_id,
        app_name,
        app_icon: None,
        app_icon_variant: None,
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn serialize_frames(frames: Vec<ServerFrame>) -> napi::Result<Vec<String>> {
    frames
        .into_iter()
        .map(|frame| {
            serde_json::to_string(&frame).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("failed to serialize OpenTray server frame: {error}"),
                )
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::create_headless_runtime;

    #[test]
    fn headless_runtime_owns_protocol_session_operations() {
        let runtime = create_headless_runtime(
            Some("0.9.0".to_string()),
            Some("com.example.build".to_string()),
            Some("Build".to_string()),
        )
        .expect("headless runtime");

        let ready = request_one(
            &runtime,
            json!({
                "type": "init",
                "protocolVersion": 1,
                "clientVersion": "0.9.0"
            }),
        );
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["brokerVersion"], "0.9.0");

        let default_app = request_one(
            &runtime,
            json!({
                "type": "resolve-default-app",
                "requestId": "req-1"
            }),
        );
        assert_eq!(default_app["type"], "default-app");

        let tray_created = request_one(
            &runtime,
            json!({
                "type": "create-tray",
                "requestId": "req-2",
                "app": default_app["app"],
                "tray": {
                    "id": "status"
                }
            }),
        );
        assert_eq!(tray_created["type"], "tray-created");
        assert_eq!(tray_created["trayId"], "status");

        let health = request_one(
            &runtime,
            json!({
                "type": "health",
                "requestId": "req-health"
            }),
        );
        assert_eq!(health["type"], "runtime-host-health");
        assert_eq!(health["health"]["appId"], "com.example.build");
        assert_eq!(health["health"]["appName"], "Build");
        assert_eq!(health["health"]["callerLabel"], "build");
        assert_eq!(health["health"]["sessionCount"], 1);
    }

    fn request_one(runtime: &super::HeadlessRuntime, frame: Value) -> Value {
        let frames = runtime
            .request(frame.to_string())
            .expect("runtime request should succeed");
        assert_eq!(frames.len(), 1);
        serde_json::from_str(&frames[0]).expect("server frame json")
    }
}
