use opentray_core::{AppBackend, AppProjection, BackendCapabilities, BackendError};
use opentray_spec::{AppId, Rect, TrayEvent, TrayId};

#[derive(Debug, Default)]
pub struct KsniBackend {
    _marker: std::marker::PhantomData<ksni::Category>,
}

impl KsniBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AppBackend for KsniBackend {
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            tray_bounds: false,
            show_menu: false,
        }
    }

    fn sync_app(&self, _projection: AppProjection) -> Result<(), BackendError> {
        Ok(())
    }

    fn tray_bounds(
        &self,
        _app_id: &AppId,
        _tray_id: &TrayId,
    ) -> Result<Option<Rect>, BackendError> {
        Ok(None)
    }

    fn show_menu(&self, _app_id: &AppId) -> Result<(), BackendError> {
        Err(BackendError::Unsupported("ksni_show_menu"))
    }

    fn emit_event(&self, _event: TrayEvent) -> Result<(), BackendError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_backend<T: AppBackend>() {}

    #[test]
    fn implements_app_backend_contract() {
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
