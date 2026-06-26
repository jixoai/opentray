#[cfg(any(target_os = "macos", target_os = "windows"))]
mod native;
mod projection;
mod runtime;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use native::*;
pub use projection::*;
pub use runtime::*;

use opentray_core::{AppBackend, AppProjection, BackendCapabilities, BackendError};
use opentray_spec::{AppId, Rect, TrayEvent, TrayId};

#[derive(Debug, Default)]
pub struct TrayIconBackend<R = UnboundTrayIconRuntime> {
    runtime: R,
}

impl TrayIconBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl<R: TrayIconRuntime> TrayIconBackend<R> {
    pub fn with_runtime(runtime: R) -> Self {
        Self { runtime }
    }

    pub fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        self.runtime.menu_event(menu_id)
    }

    pub fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
        self.runtime.primary_event(tray_icon_id)
    }

    pub fn record_tray_interaction(&self, tray_icon_id: &str) {
        self.runtime.record_tray_interaction(tray_icon_id);
    }
}

impl<R: TrayIconRuntime> AppBackend for TrayIconBackend<R> {
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            tray_bounds: cfg!(not(target_os = "linux")),
            show_menu: true,
        }
    }

    fn sync_app(&self, projection: AppProjection) -> Result<(), BackendError> {
        self.runtime
            .apply_projection(TrayIconProjection::from_app_projection(&projection)?)
    }

    fn tray_bounds(&self, app_id: &AppId, tray_id: &TrayId) -> Result<Option<Rect>, BackendError> {
        if !self.capabilities().tray_bounds {
            return Ok(None);
        }
        self.runtime
            .tray_bounds(&stable_tray_icon_id(app_id, tray_id))
    }

    fn show_menu(&self, app_id: &AppId) -> Result<(), BackendError> {
        self.runtime.show_menu(app_id)
    }

    fn emit_event(&self, event: TrayEvent) -> Result<(), BackendError> {
        self.runtime.emit_event(event)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use opentray_core::TrayProjection;
    use opentray_spec::{AppRef, Icon, Menu, MenuItem, TrayEvent};

    use super::*;

    fn assert_backend<T: AppBackend>() {}

    #[test]
    fn implements_surface_backend_contract() {
        assert_backend::<TrayIconBackend>();
    }

    #[test]
    fn sync_applies_compiled_projection_through_runtime() {
        let runtime = RecordingRuntime::default();
        let calls = runtime.calls();
        let backend = TrayIconBackend::with_runtime(runtime);
        backend
            .sync_app(surface_projection())
            .expect("projection apply");

        let projection = calls.borrow().last().expect("projection").clone();
        assert_eq!(projection.app_id, "surface-1");
        assert_eq!(projection.trays[0].menu.entries.len(), 1);
        assert!(projection
            .routes
            .menu_event("opentray:surface-1:tray-1:7")
            .is_some());
    }

    #[test]
    fn default_runtime_is_explicitly_unbound() {
        let backend = TrayIconBackend::new();
        let error = backend
            .sync_app(surface_projection())
            .expect_err("default runtime is not native");

        assert!(matches!(
            error,
            BackendError::Unsupported("tray_icon_runtime_unbound")
        ));
    }

    #[test]
    fn menu_event_delegates_to_runtime_ingress() {
        let backend = TrayIconBackend::with_runtime(RoutingRuntime);

        assert_eq!(
            backend.menu_event("native-menu-id"),
            Some(TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 7,
            })
        );
        assert_eq!(backend.menu_event("missing"), None);
    }

    #[test]
    fn primary_event_delegates_to_runtime_ingress() {
        let backend = TrayIconBackend::with_runtime(RoutingRuntime);

        assert_eq!(
            backend.primary_event("native-tray-id"),
            Some(TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 7,
            })
        );
        assert_eq!(backend.primary_event("missing"), None);
    }

    #[test]
    fn tray_bounds_delegate_to_runtime_by_tray_identity() {
        let backend = TrayIconBackend::with_runtime(RoutingRuntime);

        let tray_bounds = backend
            .tray_bounds(&"surface-1".to_string(), &"tray-1".to_string())
            .expect("tray bounds");

        // Linux keeps tray bounds out of the generic tray-icon backend because
        // there is no stable cross-desktop anchor contract here yet.
        if backend.capabilities().tray_bounds {
            assert_eq!(
                tray_bounds,
                Some(Rect {
                    x: 10,
                    y: 20,
                    width: 24,
                    height: 24,
                })
            );
        } else {
            assert_eq!(tray_bounds, None);
        }
        assert_eq!(
            backend
                .tray_bounds(&"surface-1".to_string(), &"missing".to_string())
                .expect("tray bounds"),
            None
        );
    }

    #[derive(Clone, Default)]
    struct RecordingRuntime {
        calls: Rc<RefCell<Vec<TrayIconProjection>>>,
    }

    impl RecordingRuntime {
        fn calls(&self) -> Rc<RefCell<Vec<TrayIconProjection>>> {
            self.calls.clone()
        }
    }

    impl TrayIconRuntime for RecordingRuntime {
        fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError> {
            self.calls.borrow_mut().push(projection);
            Ok(())
        }
    }

    struct RoutingRuntime;

    impl TrayIconRuntime for RoutingRuntime {
        fn apply_projection(&self, _projection: TrayIconProjection) -> Result<(), BackendError> {
            Ok(())
        }

        fn tray_bounds(&self, tray_icon_id: &str) -> Result<Option<Rect>, BackendError> {
            Ok(
                (tray_icon_id == "opentray-tray:surface-1:tray-1").then_some(Rect {
                    x: 10,
                    y: 20,
                    width: 24,
                    height: 24,
                }),
            )
        }

        fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
            (menu_id == "native-menu-id").then(|| TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 7,
            })
        }

        fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
            (tray_icon_id == "native-tray-id").then(|| TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 7,
            })
        }
    }

    fn surface_projection() -> AppProjection {
        AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
            },
            title: Some("Host".to_string()),
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon: Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1)),
                menu: Some(Menu {
                    items: vec![MenuItem::Item {
                        id: 7,
                        title: "Open".to_string(),
                        primary_event: false,
                        enabled: true,
                        shortcut: None,
                    }],
                }),
            }],
        }
    }
}
