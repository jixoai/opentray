use std::sync::{Arc, Mutex};

use opentray_spec::{Icon, Menu, Rect, SurfaceId, SurfaceRef, Tooltip, TrayEvent, TrayId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendCapabilities {
    pub tray_bounds: bool,
    pub show_menu: bool,
}

impl BackendCapabilities {
    pub const fn full() -> Self {
        Self {
            tray_bounds: true,
            show_menu: true,
        }
    }

    pub const fn no_tray_bounds() -> Self {
        Self {
            tray_bounds: false,
            show_menu: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayProjection {
    pub tray_id: TrayId,
    pub title: String,
    pub tooltip: Option<Tooltip>,
    pub icon: Icon,
    pub menu: Option<Menu>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceProjection {
    pub surface: SurfaceRef,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Option<Icon>,
    pub trays: Vec<TrayProjection>,
}

pub trait SurfaceBackend {
    fn capabilities(&self) -> BackendCapabilities;
    fn sync_surface(&self, projection: SurfaceProjection) -> Result<(), BackendError>;
    fn tray_bounds(&self, space_id: &SurfaceId, tray_id: &TrayId) -> Result<Option<Rect>, BackendError>;
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
    TrayBounds(SurfaceId, TrayId),
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

    fn tray_bounds(&self, space_id: &SurfaceId, tray_id: &TrayId) -> Result<Option<Rect>, BackendError> {
        self.push(BackendOperation::TrayBounds(
            space_id.clone(),
            tray_id.clone(),
        ));
        if !self.capabilities.tray_bounds {
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
