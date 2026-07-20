use opentray_spec::{
    is_supported_protocol_version, AppIdentity, AppOptions, AppRef, BrokerArtifactIdentity,
    ClientFrame, ExtensionEnvelope, Rect, RequestId, ServerFrame, SessionId, TrayBoundsKind,
    TrayBoundsResult, TrayEvent, PROTOCOL_VERSION,
};

use crate::{
    AppBackend, ExtensionError, ExtensionHostContext, ExtensionLoadRequest, ExtensionLoader,
    Kernel, KernelError, RoutedEvent, UnsupportedExtensionHostContext, UnsupportedExtensionLoader,
};

#[derive(Debug, Clone, Default)]
pub struct BrokerSession {
    session_id: Option<SessionId>,
    app_identity: Option<AppIdentity>,
}

impl BrokerSession {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn app_identity(&self) -> Option<&AppIdentity> {
        self.app_identity.as_ref()
    }

    fn accept(&mut self, session_id: SessionId) {
        self.session_id = Some(session_id);
    }

    fn pin_app_identity(&mut self, identity: AppIdentity) {
        if self.app_identity.is_some() {
            return;
        }
        self.app_identity = Some(identity);
    }
}

/// Request/session dispatch law between local transports and the kernel.
pub struct BrokerKernel<B: AppBackend, L: ExtensionLoader = UnsupportedExtensionLoader> {
    kernel: Kernel<B>,
    extension_loader: L,
    next_session: u64,
    default_app: Option<AppRef>,
    default_app_options: AppOptions,
    broker_artifact_identity: BrokerArtifactIdentity,
}

struct ScopedExtensionHost<'a> {
    outer: &'a mut dyn ExtensionHostContext,
    tray_bounds: Option<Rect>,
}

impl ExtensionHostContext for ScopedExtensionHost<'_> {
    fn tray_bounds(&mut self) -> Result<Option<Rect>, crate::ExtensionError> {
        Ok(self.tray_bounds)
    }

    fn invoke_host(
        &mut self,
        capability: &str,
        request_json: &[u8],
    ) -> Result<Vec<u8>, crate::ExtensionError> {
        self.outer.invoke_host(capability, request_json)
    }

    fn send_event(&mut self, event_json: &[u8]) -> Result<(), crate::ExtensionError> {
        self.outer.send_event(event_json)
    }
}

impl<B: AppBackend> BrokerKernel<B, UnsupportedExtensionLoader> {
    /// Creates a broker kernel whose ready frames carry the composition-owned artifact identity.
    pub fn new(backend: B, broker_artifact_identity: BrokerArtifactIdentity) -> Self {
        Self::with_extension_loader(
            backend,
            UnsupportedExtensionLoader,
            broker_artifact_identity,
        )
    }
}

impl<B: AppBackend, L: ExtensionLoader> BrokerKernel<B, L> {
    /// Creates a broker kernel with an explicit extension loader and artifact identity.
    pub fn with_extension_loader(
        backend: B,
        extension_loader: L,
        broker_artifact_identity: BrokerArtifactIdentity,
    ) -> Self {
        Self::with_default_app_options(
            backend,
            extension_loader,
            default_app_options(),
            broker_artifact_identity,
        )
    }

    /// Creates a broker kernel with explicit default-app and broker artifact authority.
    pub fn with_default_app_options(
        backend: B,
        extension_loader: L,
        default_app_options: AppOptions,
        broker_artifact_identity: BrokerArtifactIdentity,
    ) -> Self {
        Self {
            kernel: Kernel::new(backend),
            extension_loader,
            next_session: 1,
            default_app: None,
            default_app_options,
            broker_artifact_identity,
        }
    }

    pub fn backend(&self) -> &B {
        self.kernel.backend()
    }

    pub fn handle_frame(
        &mut self,
        session: &mut BrokerSession,
        frame: ClientFrame,
        broker_version: &str,
    ) -> Vec<ServerFrame> {
        let mut host = UnsupportedExtensionHostContext;
        self.handle_frame_with_extension_host(session, frame, broker_version, &mut host)
    }

    pub fn handle_frame_with_extension_host(
        &mut self,
        session: &mut BrokerSession,
        frame: ClientFrame,
        broker_version: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Vec<ServerFrame> {
        match frame {
            ClientFrame::Init {
                protocol_version,
                client_version: _,
            } => {
                if !is_supported_protocol_version(protocol_version) {
                    return vec![protocol_error(
                        None,
                        "incompatible-protocol",
                        format!(
                            "unsupported protocolVersion {protocol_version}; expected {PROTOCOL_VERSION}"
                        ),
                    )];
                }

                let session_id = session
                    .session_id
                    .clone()
                    .unwrap_or_else(|| self.allocate_session(session));
                vec![ServerFrame::Ready {
                    protocol_version: PROTOCOL_VERSION,
                    broker_version: broker_version.to_string(),
                    broker_artifact_identity: self.broker_artifact_identity.clone(),
                    session_id: session_id,
                }]
            }
            ClientFrame::Exit => self.close_session_with_extension_host(session, host),
            frame => {
                let request_id = request_id(&frame);
                // Public API calls this a session; internal session ids remain the kernel authority token.
                let Some(session_id) = session.session_id().map(ToOwned::to_owned) else {
                    return vec![protocol_error(
                        request_id,
                        "not-initialized",
                        "init must be accepted before broker commands",
                    )];
                };
                self.handle_initialized_frame(session, &session_id, frame, host)
            }
        }
    }

    pub fn close_session(&mut self, session: &mut BrokerSession) -> Vec<ServerFrame> {
        let mut host = UnsupportedExtensionHostContext;
        self.close_session_with_extension_host(session, &mut host)
    }

    pub fn close_session_with_extension_host(
        &mut self,
        session: &mut BrokerSession,
        host: &mut dyn ExtensionHostContext,
    ) -> Vec<ServerFrame> {
        let Some(session_id) = session.session_id.take() else {
            return Vec::new();
        };

        // Disconnect cleanup must flow through the kernel so only session-owned state is removed.
        match self.kernel.close_session_with_host(&session_id, host) {
            Ok(events) => extension_events(events),
            Err(error) => vec![kernel_error(None, error)],
        }
    }

    pub fn route_backend_event(&self, event: TrayEvent) -> Option<RoutedEvent> {
        self.kernel.route_event(event)
    }

    fn handle_initialized_frame(
        &mut self,
        session: &mut BrokerSession,
        session_id: &str,
        frame: ClientFrame,
        host: &mut dyn ExtensionHostContext,
    ) -> Vec<ServerFrame> {
        match frame {
            ClientFrame::CreateApp {
                request_id,
                options,
            } => match self.kernel.create_app(options.clone()) {
                Ok(app) => {
                    if let Ok(identity) = self.kernel.app_identity(&app.app_id) {
                        session.pin_app_identity(identity);
                    }
                    if options.default || self.default_app.is_none() {
                        self.default_app = Some(app.clone());
                    }
                    vec![ServerFrame::AppCreated { request_id, app }]
                }
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::ResolveDefaultApp { request_id } => {
                let app = match self.default_app.clone() {
                    Some(app) => Ok(app),
                    None => self.kernel.create_app(self.default_app_options.clone()),
                };

                match app {
                    Ok(app) => {
                        if let Ok(identity) = self.kernel.app_identity(&app.app_id) {
                            session.app_identity = Some(identity);
                        }
                        self.default_app = Some(app.clone());
                        vec![ServerFrame::DefaultApp { request_id, app }]
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::GetAppIdentity { request_id, app_id } => {
                if !session_owns_app(session, &app_id) {
                    return vec![protocol_error(
                        Some(request_id),
                        "session-mismatch",
                        format!("session does not own app: {app_id}"),
                    )];
                }
                match self.kernel.app_identity(&app_id) {
                    Ok(identity) => vec![ServerFrame::AppIdentity {
                        request_id,
                        identity,
                    }],
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::SetAppName {
                request_id,
                app_id,
                name,
            } => {
                if !session_owns_app(session, &app_id) {
                    return vec![protocol_error(
                        Some(request_id),
                        "session-mismatch",
                        format!("session does not own app: {app_id}"),
                    )];
                }
                match self.kernel.set_app_name(&app_id, name) {
                    Ok(()) => {
                        if let Ok(identity) = self.kernel.app_identity(&app_id) {
                            session.app_identity = Some(identity);
                        }
                        vec![ServerFrame::Ack { request_id }]
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::SetAppIcon {
                request_id,
                app_id,
                app_icon,
            } => {
                if !session_owns_app(session, &app_id) {
                    return vec![protocol_error(
                        Some(request_id),
                        "session-mismatch",
                        format!("session does not own app: {app_id}"),
                    )];
                }
                match self.kernel.set_app_icon(&app_id, app_icon) {
                    Ok(()) => {
                        if let Ok(identity) = self.kernel.app_identity(&app_id) {
                            session.app_identity = Some(identity);
                        }
                        vec![ServerFrame::Ack { request_id }]
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::SetAppIconVariant {
                request_id,
                app_id,
                variant,
            } => {
                if !session_owns_app(session, &app_id) {
                    return vec![protocol_error(
                        Some(request_id),
                        "session-mismatch",
                        format!("session does not own app: {app_id}"),
                    )];
                }
                match self.kernel.set_app_icon_variant(&app_id, variant) {
                    Ok(()) => {
                        if let Ok(identity) = self.kernel.app_identity(&app_id) {
                            session.app_identity = Some(identity);
                        }
                        vec![ServerFrame::Ack { request_id }]
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::CreateTray {
                request_id,
                app,
                tray,
            } => match self.kernel.create_tray(session_id.to_string(), &app, tray) {
                Ok(tray_id) => vec![ServerFrame::TrayCreated {
                    request_id,
                    app_id: app.app_id,
                    tray_id,
                }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::DestroyTray {
                request_id,
                app_id,
                tray_id,
            } => match self.kernel.destroy_tray(session_id, &app_id, &tray_id) {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::GetTrayBounds {
                request_id,
                app_id,
                tray_id,
            } => match self.kernel.tray_bounds(session_id, &app_id, &tray_id) {
                Ok(bounds) => vec![ServerFrame::TrayBounds {
                    request_id,
                    app_id,
                    tray_id,
                    bounds: match bounds {
                        Some(rect) => TrayBoundsResult {
                            kind: TrayBoundsKind::Native,
                            source: "backend.nativeTrayBounds".to_string(),
                            rect: Some(rect),
                        },
                        None => TrayBoundsResult {
                            kind: TrayBoundsKind::Unavailable,
                            source: "backend.unavailable".to_string(),
                            rect: None,
                        },
                    },
                }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::SetTrayMenu {
                request_id,
                app_id,
                tray_id,
                menu,
            } => match self
                .kernel
                .set_tray_menu(session_id, &app_id, &tray_id, menu)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::SetTrayIcon {
                request_id,
                app_id,
                tray_id,
                icon,
            } => match self
                .kernel
                .set_tray_icon(session_id, &app_id, &tray_id, icon)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::SetTrayTooltip {
                request_id,
                app_id,
                tray_id,
                tooltip,
            } => match self
                .kernel
                .set_tray_tooltip(session_id, &app_id, &tray_id, tooltip)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::ExtCommand {
                request_id,
                app_id,
                tray_id,
                ext,
                data,
            } => {
                let tray_bounds = self
                    .kernel
                    .tray_bounds(session_id, &app_id, &tray_id)
                    .ok()
                    .flatten();
                let mut scoped_host = ScopedExtensionHost {
                    outer: host,
                    tray_bounds,
                };
                match self.kernel.ext_command_with_host(
                    app_id,
                    tray_id,
                    ext,
                    data,
                    &mut scoped_host,
                ) {
                    Ok(events) => {
                        let mut frames = vec![ServerFrame::ExtCommandResult {
                            request_id,
                            events: events.clone(),
                        }];
                        frames.extend(extension_events(events));
                        frames
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::LoadExt {
                request_id,
                app_id,
                name,
                path,
                expected_identity,
                mount_id,
            } => {
                let request = ExtensionLoadRequest {
                    app_id: app_id.clone(),
                    name,
                    path,
                    expected_identity,
                    mount_id,
                };
                match self
                    .extension_loader
                    .load(&request)
                    .map_err(KernelError::from)
                    .and_then(|instance| self.kernel.register_extension(app_id, instance))
                {
                    Ok(()) => vec![ServerFrame::Ack { request_id }],
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::UnloadExt { request_id, .. } => vec![protocol_error(
                Some(request_id),
                "unsupported",
                "dynamic extension unload is not implemented in this broker stage",
            )],
            ClientFrame::Health { request_id } => vec![protocol_error(
                Some(request_id),
                "unsupported",
                "daemon health is owned by the broker runtime composition layer",
            )],
            ClientFrame::Init { .. } | ClientFrame::Exit => Vec::new(),
        }
    }

    fn allocate_session(&mut self, session: &mut BrokerSession) -> SessionId {
        let session_id = format!("session-{}", self.next_session);
        self.next_session += 1;
        session.accept(session_id.clone());
        session_id
    }
}

fn default_app_options() -> AppOptions {
    AppOptions {
        id: Some("opentray.default".to_string()),
        name: Some("opentray".to_string()),
        app_icon: None,
        default: true,
    }
}

fn request_id(frame: &ClientFrame) -> Option<RequestId> {
    match frame {
        ClientFrame::CreateApp { request_id, .. }
        | ClientFrame::ResolveDefaultApp { request_id }
        | ClientFrame::GetAppIdentity { request_id, .. }
        | ClientFrame::SetAppName { request_id, .. }
        | ClientFrame::SetAppIcon { request_id, .. }
        | ClientFrame::SetAppIconVariant { request_id, .. }
        | ClientFrame::CreateTray { request_id, .. }
        | ClientFrame::DestroyTray { request_id, .. }
        | ClientFrame::GetTrayBounds { request_id, .. }
        | ClientFrame::SetTrayMenu { request_id, .. }
        | ClientFrame::SetTrayIcon { request_id, .. }
        | ClientFrame::SetTrayTooltip { request_id, .. }
        | ClientFrame::LoadExt { request_id, .. }
        | ClientFrame::ExtCommand { request_id, .. }
        | ClientFrame::UnloadExt { request_id, .. }
        | ClientFrame::Health { request_id } => Some(request_id.clone()),
        ClientFrame::Init { .. } | ClientFrame::Exit => None,
    }
}

fn session_owns_app(session: &BrokerSession, app_id: &str) -> bool {
    session
        .app_identity()
        .map(|identity| identity.app_id == app_id)
        .unwrap_or(false)
}

fn extension_events(events: Vec<ExtensionEnvelope>) -> Vec<ServerFrame> {
    events
        .into_iter()
        .filter_map(|event| {
            event.scope.tray_id.map(|tray_id| ServerFrame::ExtEvent {
                app_id: event.scope.app_id,
                tray_id,
                ext: event.scope.ext,
                data: event.data,
            })
        })
        .collect()
}

fn kernel_error(request_id: Option<RequestId>, error: KernelError) -> ServerFrame {
    match error {
        KernelError::AppIconVariantNotFound { app_id, variant } => protocol_error(
            request_id,
            "app-icon-variant-not-found",
            format!("app icon variant not found for {app_id}: {variant}"),
        ),
        KernelError::Extension(ExtensionError::Detailed { category, message }) => {
            protocol_error(request_id, category, message)
        }
        error => protocol_error(request_id, "kernel-error", error.to_string()),
    }
}

fn protocol_error(
    request_id: Option<RequestId>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> ServerFrame {
    ServerFrame::Error {
        request_id,
        code: code.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests;
