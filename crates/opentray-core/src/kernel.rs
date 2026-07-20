use std::collections::HashMap;

use opentray_spec::{
    AppIcon, AppId, AppIdentity, AppOptions, AppRef, ExtensionEnvelope, Icon, Menu, Rect,
    SessionId, Tooltip, TrayEvent, TrayId, TrayOptions, DEFAULT_APP_ICON_VARIANT,
};
use serde_json::Value;

use crate::{
    AppBackend, AppProjection, ExtensionError, ExtensionHostContext, ExtensionInstance,
    ExtensionRegistry, TrayProjection, UnsupportedExtensionHostContext,
};

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("app not found: {0}")]
    AppNotFound(AppId),
    #[error("tray not found: {app_id}/{tray_id}")]
    TrayNotFound { app_id: AppId, tray_id: TrayId },
    #[error("session does not own tray: {session_id} {app_id}/{tray_id}")]
    SessionMismatch {
        session_id: SessionId,
        app_id: AppId,
        tray_id: TrayId,
    },
    #[error("app icon variant not found for {app_id}: {variant}")]
    AppIconVariantNotFound { app_id: AppId, variant: String },
    #[error(transparent)]
    Extension(#[from] ExtensionError),
    #[error("backend error: {0}")]
    Backend(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutedEvent {
    pub session_id: SessionId,
    pub event: TrayEvent,
}

#[derive(Debug, Clone)]
struct AppState {
    app: AppRef,
    options: AppOptions,
    app_icon_variant: Option<String>,
}

#[derive(Debug, Clone)]
struct TrayState {
    session_id: SessionId,
    app_id: AppId,
    tray_id: TrayId,
    options: TrayOptions,
}

/// Kernel owns identity, session, projection, and dispatch laws for a broker
/// pinned to exactly one caller session. The broker transport enforces that
/// only one caller connects, so the kernel's projection is an honest
/// pass-through of that single session's trays — there is no cross-session
/// aggregation step. Backends and extensions stay atoms.
pub struct Kernel<B: AppBackend> {
    backend: B,
    extensions: ExtensionRegistry,
    apps: HashMap<AppId, AppState>,
    trays: HashMap<(AppId, TrayId), TrayState>,
    next_app: u64,
}

impl<B: AppBackend> Kernel<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            extensions: ExtensionRegistry::default(),
            apps: HashMap::new(),
            trays: HashMap::new(),
            next_app: 1,
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
        app_id: AppId,
        instance: Box<dyn ExtensionInstance>,
    ) -> Result<(), KernelError> {
        self.require_app(&app_id)?;
        self.extensions.register(app_id, instance);
        Ok(())
    }

    pub fn create_app(&mut self, options: AppOptions) -> Result<AppRef, KernelError> {
        let app = AppRef {
            app_id: options.id.clone().unwrap_or_else(|| self.allocate_app_id()),
        };
        if let Some(existing) = self.apps.get(&app.app_id) {
            return Ok(existing.app.clone());
        }
        self.apps.insert(
            app.app_id.clone(),
            AppState {
                app: app.clone(),
                app_icon_variant: options
                    .app_icon
                    .as_ref()
                    .map(|_| DEFAULT_APP_ICON_VARIANT.to_string()),
                options,
            },
        );
        self.sync_app(&app.app_id)?;
        Ok(app)
    }

    pub fn create_tray(
        &mut self,
        session_id: SessionId,
        app: &AppRef,
        options: TrayOptions,
    ) -> Result<TrayId, KernelError> {
        self.require_app(&app.app_id)?;
        let tray_id = options.id.clone();
        self.trays.insert(
            (app.app_id.clone(), tray_id.clone()),
            TrayState {
                session_id,
                app_id: app.app_id.clone(),
                tray_id: tray_id.clone(),
                options,
            },
        );
        self.sync_app(&app.app_id)?;
        Ok(tray_id)
    }

    pub fn set_tray_menu(
        &mut self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
        menu: Menu,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(session_id, app_id, tray_id)?;
        tray.options.menu = Some(menu);
        self.sync_app(app_id)?;
        Ok(())
    }

    pub fn set_tray_icon(
        &mut self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
        icon: Icon,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(session_id, app_id, tray_id)?;
        tray.options.icon = Some(icon);
        self.sync_app(app_id)?;
        Ok(())
    }

    pub fn set_tray_tooltip(
        &mut self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
        tooltip: Tooltip,
    ) -> Result<(), KernelError> {
        let tray = self.require_owned_tray_mut(session_id, app_id, tray_id)?;
        tray.options.tooltip = Some(tooltip);
        self.sync_app(app_id)?;
        Ok(())
    }

    pub fn set_app_name(&mut self, app_id: &str, name: String) -> Result<(), KernelError> {
        let app = self
            .apps
            .get_mut(app_id)
            .ok_or_else(|| KernelError::AppNotFound(app_id.to_string()))?;
        app.options.name = Some(name);
        self.sync_app(app_id)
    }

    pub fn set_app_icon(
        &mut self,
        app_id: &str,
        app_icon: Option<AppIcon>,
    ) -> Result<(), KernelError> {
        let app = self
            .apps
            .get_mut(app_id)
            .ok_or_else(|| KernelError::AppNotFound(app_id.to_string()))?;
        app.app_icon_variant = app_icon
            .as_ref()
            .map(|_| DEFAULT_APP_ICON_VARIANT.to_string());
        app.options.app_icon = app_icon;
        self.sync_app(app_id)
    }

    /// Selects one declared App icon variant without replacing the retained catalog.
    pub fn set_app_icon_variant(
        &mut self,
        app_id: &str,
        variant: String,
    ) -> Result<(), KernelError> {
        let app = self
            .apps
            .get_mut(app_id)
            .ok_or_else(|| KernelError::AppNotFound(app_id.to_string()))?;
        let available = app
            .options
            .app_icon
            .as_ref()
            .is_some_and(|catalog| catalog.has_variant(&variant));
        if !available {
            return Err(KernelError::AppIconVariantNotFound {
                app_id: app_id.to_string(),
                variant,
            });
        }
        if app.app_icon_variant.as_deref() == Some(variant.as_str()) {
            return Ok(());
        }
        app.app_icon_variant = Some(variant);
        self.sync_app(app_id)
    }

    pub fn destroy_tray(
        &mut self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
    ) -> Result<(), KernelError> {
        self.require_owned_tray_mut(session_id, app_id, tray_id)?;
        self.trays
            .remove(&(app_id.to_string(), tray_id.to_string()));
        self.sync_app(app_id)?;
        Ok(())
    }

    /// Tray bounds are routed by tray identity instead of by one ambiguous space-wide rect.
    pub fn tray_bounds(
        &self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
    ) -> Result<Option<Rect>, KernelError> {
        self.require_owned_tray(session_id, app_id, tray_id)?;
        self.backend
            .tray_bounds(&app_id.to_string(), &tray_id.to_string())
            .map_err(|error| KernelError::Backend(error.to_string()))
    }

    pub fn close_session(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let mut host = UnsupportedExtensionHostContext;
        self.close_session_with_host(session_id, &mut host)
    }

    pub fn close_session_with_host(
        &mut self,
        session_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let affected: Vec<_> = self
            .trays
            .values()
            .filter(|tray| tray.session_id == session_id)
            .map(|tray| tray.app_id.clone())
            .collect();
        self.trays.retain(|_, tray| tray.session_id != session_id);
        for app_id in affected {
            self.sync_app(&app_id)?;
        }
        Ok(self.extensions.session_closed(session_id, host)?)
    }

    pub fn route_event(&self, event: TrayEvent) -> Option<RoutedEvent> {
        match &event {
            TrayEvent::MenuClick {
                app_id,
                tray_id,
                item_id: _,
            }
            | TrayEvent::TrayClick {
                app_id, tray_id, ..
            }
            | TrayEvent::TrayDoubleClick {
                app_id, tray_id, ..
            } => self
                .trays
                .get(&(app_id.clone(), tray_id.clone()))
                .map(|tray| RoutedEvent {
                    session_id: tray.session_id.clone(),
                    event,
                }),
            TrayEvent::Ready { .. } => None,
        }
    }

    pub fn ext_command(
        &mut self,
        app_id: AppId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        let mut host = UnsupportedExtensionHostContext;
        self.ext_command_with_host(app_id, tray_id, ext, data, &mut host)
    }

    pub fn ext_command_with_host(
        &mut self,
        app_id: AppId,
        tray_id: TrayId,
        ext: String,
        data: Value,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, KernelError> {
        self.require_tray(&app_id, &tray_id)?;
        Ok(self.extensions.command(app_id, tray_id, ext, data, host)?)
    }

    pub fn projection(&self, app_id: &str) -> Result<AppProjection, KernelError> {
        let app = self.require_app(app_id)?;
        let app_icon = match (&app.options.app_icon, &app.app_icon_variant) {
            (Some(catalog), Some(variant)) => {
                Some(catalog.for_variant(variant).ok_or_else(|| {
                    KernelError::AppIconVariantNotFound {
                        app_id: app_id.to_string(),
                        variant: variant.clone(),
                    }
                })?)
            }
            _ => None,
        };
        let mut trays: Vec<_> = self
            .trays
            .values()
            .filter(|tray| tray.app_id == app_id)
            .map(|tray| TrayProjection {
                tray_id: tray.tray_id.clone(),
                title: tray.options.id.clone(),
                tooltip: tray.options.tooltip.clone(),
                icon: tray.options.icon.clone(),
                menu: tray.options.menu.clone(),
            })
            .collect();
        trays.sort_by(|left, right| left.tray_id.cmp(&right.tray_id));
        Ok(AppProjection {
            app: app.app.clone(),
            title: app.options.name.clone(),
            tooltip: None,
            app_icon,
            trays,
        })
    }

    pub fn app_identity(&self, app_id: &str) -> Result<AppIdentity, KernelError> {
        let app = self.require_app(app_id)?;
        Ok(AppIdentity {
            app_id: app.app.app_id.clone(),
            app_name: app
                .options
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(&app.app.app_id)
                .to_string(),
            app_icon: app.options.app_icon.clone(),
            app_icon_variant: app.app_icon_variant.clone(),
        })
    }

    fn sync_app(&self, app_id: &str) -> Result<(), KernelError> {
        let projection = self.projection(app_id)?;
        self.backend
            .sync_app(projection)
            .map_err(|error| KernelError::Backend(error.to_string()))
    }

    fn require_app(&self, app_id: &str) -> Result<&AppState, KernelError> {
        self.apps
            .get(app_id)
            .ok_or_else(|| KernelError::AppNotFound(app_id.to_string()))
    }

    fn require_tray(&self, app_id: &str, tray_id: &str) -> Result<&TrayState, KernelError> {
        self.trays
            .get(&(app_id.to_string(), tray_id.to_string()))
            .ok_or_else(|| KernelError::TrayNotFound {
                app_id: app_id.to_string(),
                tray_id: tray_id.to_string(),
            })
    }

    fn require_owned_tray(
        &self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
    ) -> Result<&TrayState, KernelError> {
        let tray = self.require_tray(app_id, tray_id)?;
        if tray.session_id != session_id {
            return Err(KernelError::SessionMismatch {
                session_id: session_id.to_string(),
                app_id: app_id.to_string(),
                tray_id: tray_id.to_string(),
            });
        }
        Ok(tray)
    }

    fn require_owned_tray_mut(
        &mut self,
        session_id: &str,
        app_id: &str,
        tray_id: &str,
    ) -> Result<&mut TrayState, KernelError> {
        let tray = self
            .trays
            .get_mut(&(app_id.to_string(), tray_id.to_string()))
            .ok_or_else(|| KernelError::TrayNotFound {
                app_id: app_id.to_string(),
                tray_id: tray_id.to_string(),
            })?;
        if tray.session_id != session_id {
            return Err(KernelError::SessionMismatch {
                session_id: session_id.to_string(),
                app_id: app_id.to_string(),
                tray_id: tray_id.to_string(),
            });
        }
        Ok(tray)
    }

    fn allocate_app_id(&mut self) -> AppId {
        let id = format!("app-{}", self.next_app);
        self.next_app += 1;
        id
    }
}

#[cfg(test)]
mod tests {
    use opentray_spec::{AppIcon, Icon, Menu, MenuItem, MouseButton};

    use super::*;
    use crate::{BackendCapabilities, BackendOperation, FakeBackend, RecordingExtension};

    fn icon() -> Option<Icon> {
        Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1))
    }

    fn app_icon() -> AppIcon {
        serde_json::from_value(serde_json::json!([{
            "platform": "darwin",
            "format": "icns",
            "source": { "type": "encoded", "data": [105, 99, 110, 115] }
        }]))
        .expect("app icon")
    }

    fn app_icon_catalog() -> AppIcon {
        serde_json::from_value(serde_json::json!([
            {
                "platform": "darwin",
                "format": "icns",
                "variant": ["default", "empty"],
                "source": { "type": "file", "path": "empty.icns" }
            },
            {
                "platform": "darwin",
                "format": "icns",
                "variant": "files",
                "source": { "type": "file", "path": "files.icns" }
            }
        ]))
        .expect("app icon catalog")
    }

    fn tray_options(tray_id: &str, _title: &str) -> TrayOptions {
        TrayOptions {
            id: tray_id.to_string(),
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
    fn session_close_removes_only_owned_trays() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: Some("Host".to_string()),
                app_icon: None,
                default: true,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("tray-a", "A"),
            )
            .expect("tray a");
        kernel
            .create_tray(
                "session-b".to_string(),
                &surface,
                tray_options("tray-b", "B"),
            )
            .expect("tray b");

        kernel.close_session("session-a").expect("close session");

        let projection = kernel.projection(&surface.app_id).expect("projection");
        assert_eq!(projection.trays.len(), 1);
        assert_eq!(projection.trays[0].tray_id, "tray-b");
    }

    #[test]
    fn repeated_explicit_app_creation_preserves_existing_identity_and_trays() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let app_icon = app_icon();
        let app = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: Some("Original".to_string()),
                app_icon: Some(app_icon.clone()),
                default: true,
            })
            .expect("first app");
        kernel
            .create_tray("session-a".to_string(), &app, tray_options("tray-a", "A"))
            .expect("tray");

        let repeated = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("repeated app");

        assert_eq!(repeated, app);
        assert_eq!(
            kernel.app_identity("host").expect("identity").app_icon,
            Some(app_icon)
        );
        assert_eq!(
            kernel.projection("host").expect("projection").trays.len(),
            1
        );
    }

    #[test]
    fn app_icon_variant_selection_is_atomic_and_projects_only_selected_assets() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let catalog = app_icon_catalog();
        kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: Some("Host".to_string()),
                app_icon: Some(catalog.clone()),
                default: true,
            })
            .expect("app");

        let identity = kernel.app_identity("host").expect("identity");
        assert_eq!(identity.app_icon, Some(catalog.clone()));
        assert_eq!(identity.app_icon_variant.as_deref(), Some("default"));
        let default_projection = kernel.projection("host").expect("default projection");
        let default_icon = default_projection.app_icon.expect("default icon");
        assert_eq!(default_icon.assets().len(), 1);
        assert!(default_icon.has_variant("default"));

        kernel
            .set_app_icon_variant("host", "files".to_string())
            .expect("select files");
        let files_identity = kernel.app_identity("host").expect("files identity");
        assert_eq!(files_identity.app_icon, Some(catalog));
        assert_eq!(files_identity.app_icon_variant.as_deref(), Some("files"));
        let files_projection = kernel.projection("host").expect("files projection");
        let files_icon = files_projection.app_icon.expect("files icon");
        assert_eq!(files_icon.assets().len(), 1);
        assert!(files_icon.has_variant("files"));

        let operations_after_files = backend.operations().len();
        kernel
            .set_app_icon_variant("host", "files".to_string())
            .expect("idempotent selection");
        assert_eq!(backend.operations().len(), operations_after_files);

        let prior_projection = kernel.projection("host").expect("prior projection");
        let error = kernel
            .set_app_icon_variant("host", "missing".to_string())
            .expect_err("missing variant");
        assert!(matches!(
            error,
            KernelError::AppIconVariantNotFound { ref variant, .. } if variant == "missing"
        ));
        assert_eq!(
            kernel
                .app_identity("host")
                .expect("unchanged identity")
                .app_icon_variant
                .as_deref(),
            Some("files")
        );
        assert_eq!(
            kernel.projection("host").expect("rollback"),
            prior_projection
        );
        assert_eq!(backend.operations().len(), operations_after_files);

        kernel
            .set_app_icon("host", Some(app_icon()))
            .expect("replace catalog");
        assert_eq!(
            kernel
                .app_identity("host")
                .expect("replacement identity")
                .app_icon_variant
                .as_deref(),
            Some("default")
        );
        kernel.set_app_icon("host", None).expect("clear icon");
        let cleared = kernel.app_identity("host").expect("cleared identity");
        assert_eq!(cleared.app_icon, None);
        assert_eq!(cleared.app_icon_variant, None);
        assert_eq!(kernel.projection("host").expect("cleared").app_icon, None);
    }

    #[test]
    fn menu_event_routes_to_owning_session() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("same-item", "A"),
            )
            .expect("tray");

        let routed = kernel
            .route_event(TrayEvent::MenuClick {
                app_id: surface.app_id,
                tray_id: "same-item".to_string(),
                item_id: 1,
            })
            .expect("routed");

        assert_eq!(routed.session_id, "session-a");
    }

    #[test]
    fn projection_preserves_primary_event_as_menu_data() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
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
            .create_tray("session-a".to_string(), &surface, options)
            .expect("tray");

        let projection = kernel.projection(&surface.app_id).expect("projection");
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
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: Some("Host".to_string()),
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "plugin-session".to_string(),
                &surface,
                tray_options("plugin", "Plugin"),
            )
            .expect("plugin tray");

        let projection = kernel.projection(&surface.app_id).expect("projection");
        assert_eq!(projection.trays.len(), 1);
        assert_eq!(projection.trays[0].title, "plugin");
    }

    #[test]
    fn fake_backend_observes_projection_without_gui() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: Some("Host".to_string()),
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        assert!(backend
            .operations()
            .iter()
            .any(|operation| matches!(operation, BackendOperation::SyncApp(projection) if projection.trays.len() == 1)));
    }

    #[test]
    fn extension_dispatch_uses_registry() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");
        kernel.extensions_mut().register(
            surface.app_id.clone(),
            Box::new(RecordingExtension::new("webview")),
        );

        let events = kernel
            .ext_command(
                surface.app_id,
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
        let app_id = "app".to_string();
        let tray_id = "tray".to_string();
        assert_eq!(
            backend
                .tray_bounds(&app_id, &tray_id)
                .expect("tray bounds query"),
            None
        );
        assert_eq!(backend.capabilities().tray_bounds, false);
    }

    #[test]
    fn non_menu_events_are_not_routed_to_arbitrary_sessions() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let kernel = Kernel::new(backend);
        let routed = kernel.route_event(TrayEvent::TrayClick {
            app_id: "unknown".to_string(),
            tray_id: "unknown".to_string(),
            button: MouseButton::Left,
            x: 0,
            y: 0,
        });
        assert!(routed.is_none());
    }

    #[test]
    fn tray_click_event_routes_to_owning_session() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("status", "Status"),
            )
            .expect("tray");

        let routed = kernel
            .route_event(TrayEvent::TrayClick {
                app_id: surface.app_id,
                tray_id: "status".to_string(),
                button: MouseButton::Left,
                x: 4,
                y: 8,
            })
            .expect("routed");

        assert_eq!(routed.session_id, "session-a");
    }

    #[test]
    fn destroy_tray_requires_owning_session() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let error = kernel
            .destroy_tray("session-b", &surface.app_id, "tray")
            .expect_err("wrong session rejected");

        assert!(matches!(error, KernelError::SessionMismatch { .. }));
        assert_eq!(
            kernel
                .projection(&surface.app_id)
                .expect("projection")
                .trays
                .len(),
            1
        );
    }

    #[test]
    fn tray_bounds_require_owning_session() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend);
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let error = kernel
            .tray_bounds("session-b", &surface.app_id, "tray")
            .expect_err("wrong session rejected");

        assert!(matches!(error, KernelError::SessionMismatch { .. }));
    }

    #[test]
    fn tray_bounds_route_by_space_and_tray_identity() {
        let backend = FakeBackend::new(BackendCapabilities::full());
        let mut kernel = Kernel::new(backend.clone());
        let surface = kernel
            .create_app(AppOptions {
                id: Some("host".to_string()),
                name: None,
                app_icon: None,
                default: false,
            })
            .expect("surface");
        kernel
            .create_tray(
                "session-a".to_string(),
                &surface,
                tray_options("tray", "Tray"),
            )
            .expect("tray");

        let bounds = kernel
            .tray_bounds("session-a", &surface.app_id, "tray")
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
                BackendOperation::TrayBounds(app_id, tray_id)
                    if app_id == "host" && tray_id == "tray"
            )
        }));
    }
}
