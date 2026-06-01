use std::collections::HashMap;

use opentray_spec::{ExtensionEnvelope, ExtensionScope, SurfaceId, TrayId};
use serde_json::Value;

pub const RECORDING_EXTENSION_PATH: &str = "opentray://recording-extension";

/// Broker-runtime authority exposed to extensions without leaking backend or UI types.
pub trait ExtensionHostContext {
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

pub trait ExtensionInstance: Send {
    fn name(&self) -> &str;
    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError>;
    fn lease_closed(
        &mut self,
        lease_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ExtensionError {
    #[error("extension not found: {0}")]
    NotFound(String),
    #[error("extension rejected command: {0}")]
    Rejected(String),
    #[error("extension loading is unsupported: {0}")]
    Unsupported(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionLoadRequest {
    pub surface_id: SurfaceId,
    pub name: String,
    pub path: String,
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

        Ok(Box::new(RecordingExtension::new(request.name.clone())))
    }
}

#[derive(Default)]
pub struct ExtensionRegistry {
    instances: HashMap<(SurfaceId, String), Box<dyn ExtensionInstance>>,
}

impl ExtensionRegistry {
    pub fn register(&mut self, surface_id: SurfaceId, instance: Box<dyn ExtensionInstance>) {
        let name = instance.name().to_string();
        self.instances.insert((surface_id, name), instance);
    }

    pub fn command(
        &mut self,
        surface_id: SurfaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let instance = self
            .instances
            .get_mut(&(surface_id.clone(), ext.clone()))
            .ok_or_else(|| ExtensionError::NotFound(ext.clone()))?;
        instance.command(
            ExtensionEnvelope {
                scope: ExtensionScope {
                    surface_id,
                    tray_id: Some(tray_id),
                    ext,
                },
                data,
            },
            host,
        )
    }

    pub fn lease_closed(
        &mut self,
        lease_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let mut events = Vec::new();
        for instance in self.instances.values_mut() {
            events.extend(instance.lease_closed(lease_id, host)?);
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
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        self.commands.push(envelope.clone());
        Ok(vec![ExtensionEnvelope {
            scope: envelope.scope,
            data: serde_json::json!({ "type": "recorded", "command": envelope.data }),
        }])
    }

    fn lease_closed(
        &mut self,
        lease_id: &str,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        Ok(vec![ExtensionEnvelope {
            scope: ExtensionScope {
                surface_id: "lease-cleanup".to_string(),
                tray_id: None,
                ext: self.name.clone(),
            },
            data: serde_json::json!({ "type": "leaseClosed", "leaseId": lease_id }),
        }])
    }
}
