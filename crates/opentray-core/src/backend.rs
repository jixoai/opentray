use std::sync::{Arc, Mutex};

use opentray_spec::{Menu, Rect, SurfaceId, SurfaceRef, Tooltip, TrayEvent, TrayId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendCapabilities {
    pub rect: bool,
    pub show_menu: bool,
}

impl BackendCapabilities {
    pub const fn full() -> Self {
        Self {
            rect: true,
            show_menu: true,
        }
    }

    pub const fn no_rect() -> Self {
        Self {
            rect: false,
            show_menu: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayProjection {
    pub tray_id: TrayId,
    pub title: String,
    pub menu: Option<Menu>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceProjection {
    pub surface: SurfaceRef,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub trays: Vec<TrayProjection>,
}

pub trait SurfaceBackend: Send + Sync {
    fn capabilities(&self) -> BackendCapabilities;
    fn sync_surface(&self, projection: SurfaceProjection) -> Result<(), BackendError>;
    fn rect(&self, surface_id: &SurfaceId) -> Result<Option<Rect>, BackendError>;
    fn show_menu(&self, surface_id: &SurfaceId) -> Result<(), BackendError>;
    fn emit_event(&self, event: TrayEvent) -> Result<(), BackendError>;
}

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("backend capability unavailable: {0}")]
    Unsupported(&'static str),
    #[error("backend failure: {0}")]
    Failure(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendOperation {
    SyncSurface(SurfaceProjection),
    Rect(SurfaceId),
    ShowMenu(SurfaceId),
    EmitEvent(TrayEvent),
}

#[derive(Debug, Clone)]
pub struct FakeBackend {
    capabilities: BackendCapabilities,
    operations: Arc<Mutex<Vec<BackendOperation>>>,
}

impl FakeBackend {
    pub fn new(capabilities: BackendCapabilities) -> Self {
        Self {
            capabilities,
            operations: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn operations(&self) -> Vec<BackendOperation> {
        self.operations.lock().expect("fake backend lock").clone()
    }

    fn push(&self, operation: BackendOperation) {
        self.operations
            .lock()
            .expect("fake backend lock")
            .push(operation);
    }
}

impl SurfaceBackend for FakeBackend {
    fn capabilities(&self) -> BackendCapabilities {
        self.capabilities.clone()
    }

    fn sync_surface(&self, projection: SurfaceProjection) -> Result<(), BackendError> {
        self.push(BackendOperation::SyncSurface(projection));
        Ok(())
    }

    fn rect(&self, surface_id: &SurfaceId) -> Result<Option<Rect>, BackendError> {
        self.push(BackendOperation::Rect(surface_id.clone()));
        if !self.capabilities.rect {
            return Ok(None);
        }
        Ok(Some(Rect {
            x: 0,
            y: 0,
            width: 24,
            height: 24,
        }))
    }

    fn show_menu(&self, surface_id: &SurfaceId) -> Result<(), BackendError> {
        self.push(BackendOperation::ShowMenu(surface_id.clone()));
        if !self.capabilities.show_menu {
            return Err(BackendError::Unsupported("show_menu"));
        }
        Ok(())
    }

    fn emit_event(&self, event: TrayEvent) -> Result<(), BackendError> {
        self.push(BackendOperation::EmitEvent(event));
        Ok(())
    }
}
