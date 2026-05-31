use opentray_core::BackendError;
use opentray_spec::{Rect, SurfaceId, TrayEvent};

use crate::TrayIconProjection;

pub trait TrayIconRuntime {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError>;

    fn rect(&self, _surface_id: &SurfaceId) -> Result<Option<Rect>, BackendError> {
        Err(BackendError::Unsupported("tray_icon_rect_unbound"))
    }

    fn show_menu(&self, _surface_id: &SurfaceId) -> Result<(), BackendError> {
        Err(BackendError::Unsupported("tray_icon_show_menu_unbound"))
    }

    fn emit_event(&self, _event: TrayEvent) -> Result<(), BackendError> {
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct UnboundTrayIconRuntime;

impl TrayIconRuntime for UnboundTrayIconRuntime {
    fn apply_projection(&self, _projection: TrayIconProjection) -> Result<(), BackendError> {
        Err(BackendError::Unsupported("tray_icon_runtime_unbound"))
    }
}
