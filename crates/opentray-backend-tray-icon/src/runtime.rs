use opentray_core::BackendError;
use opentray_spec::{AppId, Rect, TrayEvent};

use crate::TrayIconProjection;

pub trait TrayIconRuntime {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError>;

    fn menu_event(&self, _menu_id: &str) -> Option<TrayEvent> {
        None
    }

    fn primary_event(&self, _tray_icon_id: &str) -> Option<TrayEvent> {
        None
    }

    fn tray_bounds(&self, _tray_icon_id: &str) -> Result<Option<Rect>, BackendError> {
        Err(BackendError::Unsupported("tray_icon_tray_bounds_unbound"))
    }

    fn record_tray_interaction(&self, _tray_icon_id: &str) {}

    fn show_menu(&self, _app_id: &AppId) -> Result<(), BackendError> {
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
