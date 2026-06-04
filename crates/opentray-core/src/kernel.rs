use std::collections::HashMap;

use opentray_spec::{
    ExtensionEnvelope, Icon, LeaseId, Menu, Rect, SpaceId, SpaceOptions, SpaceRef, Tooltip,
    TrayEvent, TrayId, TrayOptions,
};
use serde_json::Value;

use crate::{
    ExtensionError, ExtensionHostContext, ExtensionInstance, ExtensionRegistry, SurfaceBackend,
    SurfaceProjection, TrayProjection, UnsupportedExtensionHostContext,
};

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("surface not found: {0}")]
    SurfaceNotFound(SpaceId),
    #[error("tray not found: {space_id}/{tray_id}")]
    TrayNotFound { space_id: SpaceId, tray_id: TrayId },
    #[error("lease does not own tray: {lease_id} {space_id}/{tray_id}")]
    LeaseMismatch {
        lease_id: LeaseId,
        space_id: SpaceId,
        tray_id: TrayId,
    },
    #[error(transparent)]
    Extension(#[from] ExtensionError),
    #[error("backend error: {0}")]
    Backend(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutedEvent {
    pub lease_id: LeaseId,
    pub event: TrayEvent,
}

#[derive(Debug, Clone)]
struct SurfaceState {
    space: SpaceRef,
    options: SpaceOptions,
}

#[derive(Debug, Clone)]
struct TrayState {
    lease_id: LeaseId,
    space_id: SpaceId,
    tray_id: TrayId,
    options: TrayOptions,
}

/// Kernel owns identity, lease, projection, and dispatch laws. Backends and extensions stay atoms.
pub struct Kernel<B: SurfaceBackend> {
    backend: B,
    extensions: ExtensionRegistry,
    surfaces: HashMap<SpaceId, SurfaceState>,
    trays: HashMap<(SpaceId, TrayId), TrayState>,
    next_surface: u64,
    next_tray: u64,
}

impl<B: SurfaceBackend> Kernel<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            extensions: ExtensionRegistry::default(),
            surfaces: HashMap::new(),
            trays: HashMap::new(),
            next_surface: 1,
            next_tray: 1,
        }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub fn extensions_mut(&mut self) -> &mut ExtensionRegistry {
        &mut self.extensions
    }

    pub fn register_extension(
        &mut self,
        space_id: SpaceId,
        instance: Box<dyn ExtensionInstance>,
    ) -> Result<(), KernelError> {
        self.require_surface(&space_id)?;
        self.extensions.register(space_id, instance);
        Ok(())
    }

    pub fn create_space(&mut self, options: SpaceOptions) -> Result<SpaceRef, KernelError> {
        let space = SpaceRef {
            space_id: options
                .id
                .clone()
                .unwrap_or_else(|| self.allocate_surface_id()),
        };
        self.surfaces.insert(
            space.space_id.clone(),
            SurfaceState {
                space: space.clone(),
                options,
            },
        );
        self.sync_surface(&space.space_id)?;
        Ok(space)
    }

    pub fn create_tray(
        &mut self,
        lease_id: LeaseId,
        space: &SpaceRef,
        mut options: TrayOptions,
    ) -> Result<TrayId, KernelError> {
        self.require_surface(&space.space_id)?;
        let tray_id = options
            .tray_id
            .clone()
            .unwrap_or_else(|| self.allocate_tray_id());
        options.tray_id = Some(tray_id.clone());
        self.trays.insert(
            (space.space_id.clone(), tray_id.clone()),
            TrayState {
                lease_id,
                space_id: space.space_id.clone(),
                tray_id: tray_id.clone(),
                options,
            },
        );
        self.sync_surface(&space.space_id)?;
        Ok(tray_id)
    }

    pub fn set_tray_menu(
        &mut self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
        menu: Menu,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(lease_id, space_id, tray_id)?;
        tray.options.menu = Some(menu);
        self.sync_surface(space_id)?;
        Ok(())
    }

    pub fn set_tray_icon(
        &mut self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
        icon: Icon,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(lease_id, space_id, tray_id)?;
        tray.options.icon = icon;
        self.sync_surface(space_id)?;
        Ok(())
    }

    pub fn set_tray_tooltip(
        &mut self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
        tooltip: Tooltip,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(lease_id, space_id, tray_id)?;
        tray.options.tooltip = Some(tooltip);
        self.sync_surface(space_id)?;
        Ok(())
    }

    pub fn destroy_tray(
        &mut self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
    ) -> Result<(), KernelError> {
        self.require_owned_tray_mut(lease_id, space_id, tray_id)?;
        self.trays
            .remove(&(space_id.to_string(), tray_id.to_string()));
        self.sync_surface(space_id)?;
        Ok(())
    }

    /// Tray bounds are routed by tray identity instead of by one ambiguous space-wide rect.
    pub fn tray_bounds(
        &self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
    ) -> Result<Option<Rect>, KernelError> {
        self.require_owned_tray(lease_id, space_id, tray_id)?;
        self.backend
            .tray_bounds(&space_id.to_string(), &tray_id.to_string())
            .map_err(|error| KernelError::Backend(error.to_string()))
    }

    pub fn close_lease(&mut self, lease_id: &str) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let mut host = UnsupportedExtensionHostContext;
        self.close_lease_with_host(lease_id, &mut host)
    }

    pub fn close_lease_with_host(
        &mut self,
        lease_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let affected: Vec<_> = self
            .trays
            .values()
            .filter(|tray| tray.lease_id == lease_id)
            .map(|tray| tray.space_id.clone())
            .collect();
        self.trays.retain(|_, tray| tray.lease_id != lease_id);
        for space_id in affected {
            self.sync_surface(&space_id)?;
        }
        Ok(self.extensions.lease_closed(lease_id, host)?)
    }

    pub fn route_event(&self, event: TrayEvent) -> Option<RoutedEvent> {
        match &event {
            TrayEvent::MenuClick {
                space_id,
                tray_id,
                item_id: _,
            } => self
                .trays
                .get(&(space_id.clone(), tray_id.clone()))
                .map(|tray| RoutedEvent {
                    lease_id: tray.lease_id.clone(),
                    event,
                }),
            _ => None,
        }
    }

    pub fn ext_command(
        &mut self,
        space_id: SpaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let mut host = UnsupportedExtensionHostContext;
        self.ext_command_with_host(space_id, tray_id, ext, data, &mut host)
    }

    pub fn ext_command_with_host(
        &mut self,
        space_id: SpaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        self.require_tray(&space_id, &tray_id)?;
        Ok(self
            .extensions
            .command(space_id, tray_id, ext, data, host)?)
    }

    pub fn projection(&self, space_id: &str) -> Result<SurfaceProjection, KernelError> {
        let surface = self.require_surface(space_id)?;
        let mut trays: Vec<_> = self
            .trays
            .values()
            .filter(|tray| tray.space_id == space_id)
            .map(|tray| TrayProjection {
                tray_id: tray.tray_id.clone(),
                title: tray
                    .options
                    .title
                    .clone()
                    .or_else(|| tray.options.app_id.clone())
                    .unwrap_or_else(|| tray.tray_id.clone()),
                tooltip: tray.options.tooltip.clone(),
                icon: tray.options.icon.clone(),
                menu: tray.options.menu.clone(),
            })
            .collect();
        trays.sort_by(|left, right| left.tray_id.cmp(&right.tray_id));
        Ok(SurfaceProjection {
            surface: surface.space.clone(),
            title: surface.options.title.clone(),
            tooltip: None,
            icon: surface.options.icon.clone(),
            trays,
        })
    }

    fn sync_surface(&self, space_id: &str) -> Result<(), KernelError> {
        let projection = self.projection(space_id)?;
        self.backend
            .sync_surface(projection)
            .map_err(|error| KernelError::Backend(error.to_string()))
    }

    fn require_surface(&self, space_id: &str) -> Result<&SurfaceState, KernelError> {
        self.surfaces
            .get(space_id)
            .ok_or_else(|| KernelError::SurfaceNotFound(space_id.to_string()))
    }

    fn require_tray(&self, space_id: &str, tray_id: &str) -> Result<&TrayState, KernelError> {
        self.trays
            .get(&(space_id.to_string(), tray_id.to_string()))
            .ok_or_else(|| KernelError::TrayNotFound {
                space_id: space_id.to_string(),
                tray_id: tray_id.to_string(),
            })
    }

    fn require_owned_tray(
        &self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
    ) -> Result<&TrayState, KernelError> {
        let tray = self.require_tray(space_id, tray_id)?;
        if tray.lease_id != lease_id {
            return Err(KernelError::LeaseMismatch {
                lease_id: lease_id.to_string(),
                space_id: space_id.to_string(),
                tray_id: tray_id.to_string(),
            });
        }
        Ok(tray)
    }

    fn require_owned_tray_mut(
        &mut self,
        lease_id: &str,
        space_id: &str,
        tray_id: &str,
    ) -> Result<&mut TrayState, KernelError> {
        let tray = self
            .trays
            .get_mut(&(space_id.to_string(), tray_id.to_string()))
            .ok_or_else(|| KernelError::TrayNotFound {
                space_id: space_id.to_string(),
                tray_id: tray_id.to_string(),
            })?;
        if tray.lease_id != lease_id {
            return Err(KernelError::LeaseMismatch {
                lease_id: lease_id.to_string(),
                space_id: space_id.to_string(),
                tray_id: tray_id.to_string(),
            });
        }
        Ok(tray)
    }

    fn allocate_surface_id(&mut self) -> SpaceId {
        let id = format!("space-{}", self.next_surface);
        self.next_surface += 1;
        id
    }

    fn allocate_tray_id(&mut self) -> TrayId {
        let id = format!("tray-{}", self.next_tray);
        self.next_tray += 1;
        id
    }
}

#[cfg(test)]
mod tests {
    use opentray_spec::{Icon, Menu, MenuItem, MouseButton};

    use super::*;
    use crate::{BackendCapabilities, BackendOperation, FakeBackend, RecordingExtension};

    fn icon() -> Icon {
        Icon::Rgba {
            data: vec![0, 0, 0, 0],
            width: 1,
            height: 1,
        }
    }

    fn tray_options(tray_id: &str, title: &str) -> TrayOptions {
        TrayOptions {
            tray_id: Some(tray_id.to_string()),
            app_id: Some(format!("app.{tray_id}")),
            title: Some(title.to_string()),
            tooltip: None,
            icon: icon(),
            menu: Some(Menu {
                items: vec![MenuItem::Item {
                    id: 1,
                    title: "Open".to_string(),
                    primary_event: false,
                    enabled: true,
                    shortcut: None,
                }],
            }),
        }
    }

    #[test]
    fn lease_close_removes_only_owned_trays() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: Some("Host".to_string()),
                icon: None,
                default: true,
            })
            .expect("surface");
        kernel
            .create_tray("lease-a".to_string(), &surface, tray_options("tray-a", "A"))
            .expect("tray a");
        kernel
            .create_tray("lease-b".to_string(), &surface, tray_options("tray-b", "B"))
            .expect("tray b");

        kernel.close_lease("lease-a").expect("close lease");

        let projection = kernel.projection(&surface.space_id).expect("projection");
        assert_eq!(projection.trays.len(), 1);
        assert_eq!(projection.trays[0].tray_id, "tray-b");
    }

    #[test]
    fn menu_event_routes_to_owning_lease() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "lease-a".to_string(),
                &surface,
                tray_options("same-item", "A"),
            )
            .expect("tray");

        let routed = kernel
            .route_event(TrayEvent::MenuClick {
                space_id: surface.space_id,
                tray_id: "same-item".to_string(),
                item_id: 1,
            })
            .expect("routed");

        assert_eq!(routed.lease_id, "lease-a");
    }

    #[test]
    fn projection_preserves_primary_event_as_menu_data() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        let mut options = tray_options("status", "Status");
        options.menu = Some(Menu {
            items: vec![MenuItem::Item {
                id: 8,
                title: "Show Window".to_string(),
                primary_event: true,
                enabled: true,
                shortcut: None,
            }],
        });
        kernel
            .create_tray("lease-a".to_string(), &surface, options)
            .expect("tray");

        let projection = kernel.projection(&surface.space_id).expect("projection");
        let Some(menu) = projection.trays[0].menu.as_ref() else {
            panic!("expected projected menu");
        };
        let [MenuItem::Item { primary_event, .. }] = menu.items.as_slice() else {
            panic!("expected projected primary menu item");
        };

        assert!(*primary_event);
    }

    #[test]
    fn projection_isolates_non_owner_trays_by_default() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: Some("Host".to_string()),
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "plugin-lease".to_string(),
                &surface,
                tray_options("plugin", "Plugin"),
            )
            .expect("plugin tray");

        let projection = kernel.projection(&surface.space_id).expect("projection");
        assert_eq!(projection.trays.len(), 1);
        assert_eq!(projection.trays[0].title, "Plugin");
    }

    #[test]
    fn fake_backend_observes_projection_without_gui() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: Some("Host".to_string()),
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray("lease".to_string(), &surface, tray_options("tray", "Tray"))
            .expect("tray");

        assert!(backend
            .operations()
            .iter()
            .any(|operation| matches!(operation, BackendOperation::SyncSurface(projection) if projection.trays.len() == 1)));
    }

    #[test]
    fn extension_dispatch_uses_registry() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray("lease".to_string(), &surface, tray_options("tray", "Tray"))
            .expect("tray");
        kernel.extensions_mut().register(
            surface.space_id.clone(),
            Box::new(RecordingExtension::new("webview")),
        );

        let events = kernel
            .ext_command(
                surface.space_id,
                "tray".to_string(),
                "webview".to_string(),
                serde_json::json!({ "type": "show" }),
            )
            .expect("ext command");

        assert_eq!(events[0].scope.ext, "webview");
        assert_eq!(events[0].data["type"], "recorded");
    }

    #[test]
    fn missing_tray_bounds_capability_is_explicit() {
        let backend = FakeBackend::new(BackendCapabilities::no_tray_bounds());
        let surface_id = "surface".to_string();
        let tray_id = "tray".to_string();
        assert_eq!(
            backend
                .tray_bounds(&surface_id, &tray_id)
                .expect("tray bounds query"),
            None
        );
        assert_eq!(backend.capabilities().tray_bounds, false);
    }

    #[test]
    fn non_menu_events_are_not_routed_to_arbitrary_leases() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let kernel = Kernel::new(backend);
        let routed = kernel.route_event(TrayEvent::TrayClick {
            space_id: "unknown".to_string(),
            button: MouseButton::Left,
            x: 0,
            y: 0,
        });
        assert!(routed.is_none());
    }

    #[test]
    fn destroy_tray_requires_owning_lease() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "lease-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let error = kernel
            .destroy_tray("lease-b", &surface.space_id, "tray")
            .expect_err("wrong lease rejected");

        assert!(matches!(error, KernelError::LeaseMismatch { .. }));
        assert_eq!(
            kernel
                .projection(&surface.space_id)
                .expect("projection")
                .trays
                .len(),
            1
        );
    }

    #[test]
    fn tray_bounds_require_owning_lease() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "lease-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let error = kernel
            .tray_bounds("lease-b", &surface.space_id, "tray")
            .expect_err("wrong lease rejected");

        assert!(matches!(error, KernelError::LeaseMismatch { .. }));
    }

    #[test]
    fn tray_bounds_route_by_space_and_tray_identity() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_space(SpaceOptions {
                id: Some("host".to_string()),
                title: None,
                icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "lease-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let bounds = kernel
            .tray_bounds("lease-a", &surface.space_id, "tray")
            .expect("tray bounds");

        assert_eq!(
            bounds,
            Some(Rect {
                x: 0,
                y: 0,
                width: 24,
                height: 24,
            })
        );
        assert!(backend.operations().iter().any(|operation| {
            matches!(
                operation,
                BackendOperation::TrayBounds(space_id, tray_id)
                    if space_id == "host" && tray_id == "tray"
            )
        }));
    }
}
