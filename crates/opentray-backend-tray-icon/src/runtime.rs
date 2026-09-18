use opentray_core::BackendError;
use opentray_spec::{AppId, MouseButton, Rect, TrayEvent};

use crate::TrayIconProjection;

pub trait TrayIconRuntime {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError>;

    fn menu_event(&self, _menu_id: &str) -> Option<TrayEvent> {
        None
    }

    fn primary_event(&self, _tray_icon_id: &str) -> Option<TrayEvent> {
        None
    }

    fn tray_click_event(
        &self,
        _tray_icon_id: &str,
        _button: MouseButton,
        _x: i32,
        _y: i32,
    ) -> Option<TrayEvent> {
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

/// Shared-handle delegation: broker composition may register one typed
/// `Arc<R>` runtime handle with a composition-layer service while the kernel's
/// `TrayIconBackend` keeps applying projections through the same runtime
/// object. This is ownership plumbing only — every method forwards verbatim,
/// so an `Arc`-wrapped runtime is behaviorally the wrapped runtime.
impl<R: TrayIconRuntime> TrayIconRuntime for std::sync::Arc<R> {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError> {
        (**self).apply_projection(projection)
    }

    fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        (**self).menu_event(menu_id)
    }

    fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
        (**self).primary_event(tray_icon_id)
    }

    fn tray_click_event(
        &self,
        tray_icon_id: &str,
        button: MouseButton,
        x: i32,
        y: i32,
    ) -> Option<TrayEvent> {
        (**self).tray_click_event(tray_icon_id, button, x, y)
    }

    fn tray_bounds(&self, tray_icon_id: &str) -> Result<Option<Rect>, BackendError> {
        (**self).tray_bounds(tray_icon_id)
    }

    fn record_tray_interaction(&self, tray_icon_id: &str) {
        (**self).record_tray_interaction(tray_icon_id)
    }

    fn show_menu(&self, app_id: &AppId) -> Result<(), BackendError> {
        (**self).show_menu(app_id)
    }

    fn emit_event(&self, event: TrayEvent) -> Result<(), BackendError> {
        (**self).emit_event(event)
    }
}
