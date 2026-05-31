use std::collections::HashMap;

use opentray_spec::{ExtensionEnvelope, ExtensionScope, SurfaceId, TrayId};
use serde_json::Value;

pub trait ExtensionInstance: Send {
    fn name(&self) -> &str;
    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError>;
    fn lease_closed(&mut self, lease_id: &str) -> Result<Vec<ExtensionEnvelope>, ExtensionError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ExtensionError {
    #[error("extension not found: {0}")]
    NotFound(String),
    #[error("extension rejected command: {0}")]
    Rejected(String),
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
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let instance = self
            .instances
            .get_mut(&(surface_id.clone(), ext.clone()))
            .ok_or_else(|| ExtensionError::NotFound(ext.clone()))?;
        instance.command(ExtensionEnvelope {
            scope: ExtensionScope {
                surface_id,
                tray_id: Some(tray_id),
                ext,
            },
            data,
        })
    }

    pub fn lease_closed(
        &mut self,
        lease_id: &str,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let mut events = Vec::new();
        for instance in self.instances.values_mut() {
            events.extend(instance.lease_closed(lease_id)?);
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
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        self.commands.push(envelope.clone());
        Ok(vec![ExtensionEnvelope {
            scope: envelope.scope,
            data: serde_json::json!({ "type": "recorded" }),
        }])
    }

    fn lease_closed(&mut self, lease_id: &str) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
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
