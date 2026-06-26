use std::sync::Mutex;

use napi::{Error, Status};
use napi_derive::napi;
use opentray_core::{BackendCapabilities, BrokerKernel, BrokerSession, FakeBackend};
use opentray_spec::{ClientFrame, PROTOCOL_VERSION};

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
        let mut broker = self
            .broker
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime broker lock poisoned"))?;
        let mut session = self
            .session
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "runtime session lock poisoned"))?;
        let frames = broker.handle_frame(&mut session, frame, &self.package_version);
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
}

#[napi]
pub fn create_headless_runtime(package_version: Option<String>) -> HeadlessRuntime {
    HeadlessRuntime {
        broker: Mutex::new(BrokerKernel::new(FakeBackend::new(
            BackendCapabilities::full(),
        ))),
        session: Mutex::new(BrokerSession::new()),
        package_version: package_version.unwrap_or_else(|| "0.0.0".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::create_headless_runtime;

    #[test]
    fn headless_runtime_owns_protocol_session_operations() {
        let runtime = create_headless_runtime(Some("0.9.0".to_string()));

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
    }

    fn request_one(runtime: &super::HeadlessRuntime, frame: Value) -> Value {
        let frames = runtime
            .request(frame.to_string())
            .expect("runtime request should succeed");
        assert_eq!(frames.len(), 1);
        serde_json::from_str(&frames[0]).expect("server frame json")
    }
}
