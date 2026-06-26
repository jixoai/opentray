use std::sync::{Arc, Mutex};

use opentray_spec::{AppId, AppRef, Icon, Menu, Rect, Tooltip, TrayEvent, TrayId};

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
    pub icon: Option<Icon>,
    pub menu: Option<Menu>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppProjection {
    pub app: AppRef,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Option<Icon>,
    pub trays: Vec<TrayProjection>,
}

pub trait AppBackend {
    fn capabilities(&self) -> BackendCapabilities;
    fn sync_app(&self, projection: AppProjection) -> Result<(), BackendError>;
    fn tray_bounds(&self, app_id: &AppId, tray_id: &TrayId) -> Result<Option<Rect>, BackendError>;
    fn show_menu(&self, app_id: &AppId) -> Result<(), BackendError>;
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
    SyncApp(AppProjection),
    TrayBounds(AppId, TrayId),
    ShowMenu(AppId),
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

impl AppBackend for FakeBackend {
    fn capabilities(&self) -> BackendCapabilities {
        self.capabilities.clone()
    }

    fn sync_app(&self, projection: AppProjection) -> Result<(), BackendError> {
        self.push(BackendOperation::SyncApp(projection));
        Ok(())
    }

    fn tray_bounds(&self, app_id: &AppId, tray_id: &TrayId) -> Result<Option<Rect>, BackendError> {
        self.push(BackendOperation::TrayBounds(
            app_id.clone(),
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

    fn show_menu(&self, app_id: &AppId) -> Result<(), BackendError> {
        self.push(BackendOperation::ShowMenu(app_id.clone()));
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
