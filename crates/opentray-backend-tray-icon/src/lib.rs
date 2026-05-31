use opentray_core::{BackendCapabilities, BackendError, SurfaceBackend, SurfaceProjection};
use opentray_spec::{Rect, SurfaceId, TrayEvent};

#[derive(Debug, Default)]
pub struct TrayIconBackend {
    _marker: std::marker::PhantomData<tray_icon::TrayIcon>,
}

impl TrayIconBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SurfaceBackend for TrayIconBackend {
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            rect: cfg!(not(target_os = "linux")),
            show_menu: true,
        }
    }

    fn sync_surface(&self, _projection: SurfaceProjection) -> Result<(), BackendError> {
        Ok(())
    }

    fn rect(&self, _surface_id: &SurfaceId) -> Result<Option<Rect>, BackendError> {
        if !self.capabilities().rect {
            return Ok(None);
        }
        Err(BackendError::Unsupported("tray_icon_rect_unbound"))
    }

    fn show_menu(&self, _surface_id: &SurfaceId) -> Result<(), BackendError> {
        Err(BackendError::Unsupported("tray_icon_show_menu_unbound"))
    }

    fn emit_event(&self, _event: TrayEvent) -> Result<(), BackendError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_backend<T: SurfaceBackend>() {}

    #[test]
    fn implements_surface_backend_contract() {
        assert_backend::<TrayIconBackend>();
    }
}
