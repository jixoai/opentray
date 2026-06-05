use opentray_core::{BackendCapabilities, BackendError, SurfaceBackend, SurfaceProjection};
use opentray_spec::{Rect, SurfaceId, TrayEvent, TrayId};

#[derive(Debug, Default)]
pub struct KsniBackend {
    _marker: std::marker::PhantomData<ksni::Category>,
}

impl KsniBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SurfaceBackend for KsniBackend {
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            tray_bounds: false,
            show_menu: false,
        }
    }

    fn sync_surface(&self, _projection: SurfaceProjection) -> Result<(), BackendError> {
        Ok(())
    }

    fn tray_bounds(
        &self,
        _surface_id: &SurfaceId,
        _tray_id: &TrayId,
    ) -> Result<Option<Rect>, BackendError> {
        Ok(None)
    }

    fn show_menu(&self, _surface_id: &SurfaceId) -> Result<(), BackendError> {
        Err(BackendError::Unsupported("ksni_show_menu"))
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
        assert_backend::<KsniBackend>();
    }

    #[test]
    fn linux_tray_bounds_absence_is_explicit() {
        let backend = KsniBackend::new();

        assert_eq!(backend.capabilities().tray_bounds, false);
        assert_eq!(
            backend
                .tray_bounds(&"surface".to_string(), &"tray".to_string())
                .expect("tray bounds"),
            None
        );
    }
}
