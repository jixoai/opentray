use std::collections::HashMap;

use opentray_spec::{
    AppId, CommandScope, ExpectedExtensionIdentity, ExtensionEnvelope, ExtensionScope, Rect,
};
use serde_json::Value;

use crate::operations::{DeferredOperationRegistry, IssuedOperation};

pub const RECORDING_EXTENSION_PATH: &str = "opentray://recording-extension";

/// Broker-runtime authority exposed to extensions without leaking backend or UI types.
pub trait ExtensionHostContext {
    fn tray_bounds(&mut self) -> Result<Option<Rect>, ExtensionError> {
        Err(ExtensionError::Unsupported(
            "host tray bounds are unavailable".to_string(),
        ))
    }

    fn invoke_host(
        &mut self,
        capability: &str,
        request_json: &[u8],
    ) -> Result<Vec<u8>, ExtensionError>;

    fn send_event(&mut self, _event_json: &[u8]) -> Result<(), ExtensionError> {
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct UnsupportedExtensionHostContext;

impl ExtensionHostContext for UnsupportedExtensionHostContext {
    fn invoke_host(
        &mut self,
        capability: &str,
        _request_json: &[u8],
    ) -> Result<Vec<u8>, ExtensionError> {
        Err(ExtensionError::Unsupported(format!(
            "host capability is unavailable: {capability}"
        )))
    }
}

/// Instance-level answer for one command dispatch (DeferredOperation design
/// section 5.1): the disposition the native V2 ABI reports through
/// `ExtCommandDispositionV1`, lifted to the trait boundary.
pub enum ExtensionCommandDisposition {
    /// The command completed inside the call; the envelopes are the result
    /// (V1 semantics unchanged).
    Immediate(Vec<ExtensionEnvelope>),
    /// The instance defers: it retained the seeded handle and will submit
    /// the single terminal through the deferred port.
    Deferred,
}

/// Registry/kernel-level dispatch result: a deferred answer carries the
/// broker-issued operation identity the caller needs for
/// `ext-command-accepted`.
pub enum ExtensionCommandOutcome {
    Immediate(Vec<ExtensionEnvelope>),
    Deferred(IssuedOperation),
}

pub trait ExtensionInstance: Send {
    fn name(&self) -> &str;
    /// `issued` carries the broker-issued operation identity for this call.
    /// Native V2 instances receive `issued.handle` through the seeded
    /// `ExtCommandDispositionV1`; V1-only and in-process instances ignore it
    /// and always complete immediately.
    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        issued: IssuedOperation,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<ExtensionCommandDisposition, ExtensionError>;
    fn session_closed(
        &mut self,
        session_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ExtensionError {
    #[error("extension not found: {0}")]
    NotFound(String),
    #[error("extension rejected command: {0}")]
    Rejected(String),
    /// Structured extension rejection. `category` is the typed error code,
    /// and `details` optionally carries the discriminated JSON payload of
    /// the typed error envelope (add-ext-dialog design section 7.5) so the
    /// synchronous error path is isomorphic with deferred terminal errors
    /// through Rust, the server frame, and the Node typed error factory.
    #[error("extension {category}: {message}")]
    Detailed {
        category: String,
        message: String,
        /// Discriminated JSON payload whose shape each error code freezes;
        /// absent for codes without structured detail.
        details: Option<Value>,
    },
    #[error("extension loading is unsupported: {0}")]
    Unsupported(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionLoadRequest {
    pub app_id: AppId,
    pub name: String,
    pub path: String,
    pub expected_identity: ExpectedExtensionIdentity,
    pub mount_id: Option<String>,
}

impl ExtensionLoadRequest {
    pub fn instance_name(&self) -> &str {
        self.mount_id.as_deref().unwrap_or(&self.name)
    }
}

pub trait ExtensionLoader: Send {
    fn load(
        &self,
        request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError>;
}

#[derive(Debug, Clone, Default)]
pub struct UnsupportedExtensionLoader;

impl ExtensionLoader for UnsupportedExtensionLoader {
    fn load(
        &self,
        request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        Err(ExtensionError::Unsupported(format!(
            "dynamic loading is not implemented for {} at {}",
            request.name, request.path
        )))
    }
}

#[derive(Debug, Clone, Default)]
pub struct RecordingExtensionLoader;

impl ExtensionLoader for RecordingExtensionLoader {
    fn load(
        &self,
        request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        if request.path != RECORDING_EXTENSION_PATH {
            return Err(ExtensionError::Unsupported(format!(
                "dynamic loading is not implemented for {} at {}",
                request.name, request.path
            )));
        }

        Ok(Box::new(RecordingExtension::new(request.instance_name())))
    }
}

#[derive(Default)]
pub struct ExtensionRegistry {
    instances: HashMap<(AppId, String), Box<dyn ExtensionInstance>>,
}

impl ExtensionRegistry {
    pub fn register(&mut self, app_id: AppId, instance: Box<dyn ExtensionInstance>) {
        let name = instance.name().to_string();
        self.instances.insert((app_id, name), instance);
    }

    pub fn command(
        &mut self,
        scope: CommandScope,
        ext: String,
        data: Value,
        operations: &DeferredOperationRegistry,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<ExtensionCommandOutcome, ExtensionError> {
        let instance = self
            .instances
            .get_mut(&(scope.app_id.clone(), ext.clone()))
            .ok_or_else(|| ExtensionError::NotFound(ext.clone()))?;
        // Pre-register the operation before the dispatch so a terminal
        // submitted during the command call already resolves (design
        // section 5.1 handle issuance law); Immediate outcomes and failures
        // retire it again.
        let issued = operations.register_pending(scope.clone(), ext.clone());
        let envelope = ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: scope.app_id.clone(),
                tray_id: Some(scope.tray_id.clone()),
                ext,
            },
            command_scope: Some(scope),
            data,
        };
        match instance.command(envelope, issued.clone(), host) {
            Ok(ExtensionCommandDisposition::Deferred) => {
                Ok(ExtensionCommandOutcome::Deferred(issued))
            }
            Ok(ExtensionCommandDisposition::Immediate(events)) => {
                operations.retire(&issued.operation_id);
                Ok(ExtensionCommandOutcome::Immediate(events))
            }
            Err(error) => {
                operations.retire(&issued.operation_id);
                Err(error)
            }
        }
    }

    pub fn session_closed(
        &mut self,
        session_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let mut events = Vec::new();
        for instance in self.instances.values_mut() {
            events.extend(instance.session_closed(session_id, host)?);
        }
        Ok(events)
    }
}

#[derive(Default)]
pub struct RecordingExtension {
    name: String,
    commands: Vec<ExtensionEnvelope>,
}

impl RecordingExtension {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            commands: Vec::new(),
        }
    }
}

impl ExtensionInstance for RecordingExtension {
    fn name(&self) -> &str {
        &self.name
    }

    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        _issued: IssuedOperation,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<ExtensionCommandDisposition, ExtensionError> {
        self.commands.push(envelope.clone());
        Ok(ExtensionCommandDisposition::Immediate(vec![
            ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                data: serde_json::json!({ "type": "recorded", "command": envelope.data }),
            },
        ]))
    }

    fn session_closed(
        &mut self,
        session_id: &str,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        Ok(vec![ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: "session-cleanup".to_string(),
                tray_id: None,
                ext: self.name.clone(),
            },
            command_scope: None,
            data: serde_json::json!({ "type": "sessionClosed", "sessionId": session_id }),
        }])
    }
}
