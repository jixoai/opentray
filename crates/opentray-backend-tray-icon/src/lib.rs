mod projection;

pub use projection::*;

use std::cell::RefCell;

use opentray_core::{BackendCapabilities, BackendError, SurfaceBackend, SurfaceProjection};
use opentray_spec::{Rect, SurfaceId, TrayEvent};

#[derive(Debug, Default)]
pub struct TrayIconBackend {
    projections: RefCell<Vec<TrayIconProjection>>,
    _marker: std::marker::PhantomData<tray_icon::TrayIcon>,
}

impl TrayIconBackend {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn projections(&self) -> Vec<TrayIconProjection> {
        self.projections.borrow().clone()
    }
}

impl SurfaceBackend for TrayIconBackend {
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            rect: cfg!(not(target_os = "linux")),
            show_menu: true,
        }
    }

    fn sync_surface(&self, projection: SurfaceProjection) -> Result<(), BackendError> {
        self.projections
            .borrow_mut()
            .push(TrayIconProjection::from_surface_projection(&projection));
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
    use opentray_core::TrayProjection;
    use opentray_spec::{Icon, Menu, MenuItem, SurfaceRef};

    use super::*;

    fn assert_backend<T: SurfaceBackend>() {}

    #[test]
    fn implements_surface_backend_contract() {
        assert_backend::<TrayIconBackend>();
    }

    #[test]
    fn sync_compiles_surface_projection_without_gui_loop() {
        let backend = TrayIconBackend::new();
        backend
            .sync_surface(SurfaceProjection {
                surface: SurfaceRef {
                    surface_id: "surface-1".to_string(),
                    app_id: "host".to_string(),
                },
                title: Some("Host".to_string()),
                tooltip: None,
                icon: None,
                trays: vec![TrayProjection {
                    tray_id: "tray-1".to_string(),
                    title: "Tray".to_string(),
                    tooltip: None,
                    icon: Icon::Rgba {
                        data: vec![0, 0, 0, 0],
                        width: 1,
                        height: 1,
                    },
                    menu: Some(Menu {
                        items: vec![MenuItem::Item {
                            id: 7,
                            title: "Open".to_string(),
                            enabled: true,
                            shortcut: None,
                        }],
                    }),
                }],
            })
            .expect("projection compile");

        let projection = backend.projections().pop().expect("projection");
        assert_eq!(projection.surface_id, "surface-1");
        assert_eq!(projection.trays[0].menu.entries.len(), 1);
        assert!(projection
            .routes
            .menu_event("opentray:surface-1:tray-1:7")
            .is_some());
    }
}
