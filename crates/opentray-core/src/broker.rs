use opentray_spec::{
    is_supported_protocol_version, ClientFrame, ExtensionEnvelope, LeaseId, Rect, RequestId,
    ServerFrame, SpaceOptions, SpaceRef, TrayBoundsKind, TrayBoundsResult, TrayEvent,
    PROTOCOL_VERSION,
};

use crate::{
    ExtensionHostContext, ExtensionLoadRequest, ExtensionLoader, Kernel, KernelError, RoutedEvent,
    SurfaceBackend, UnsupportedExtensionHostContext, UnsupportedExtensionLoader,
};

#[derive(Debug, Clone, Default)]
pub struct BrokerSession {
    lease_id: Option<LeaseId>,
}

impl BrokerSession {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn lease_id(&self) -> Option<&str> {
        self.lease_id.as_deref()
    }

    fn accept(&mut self, lease_id: LeaseId) {
        self.lease_id = Some(lease_id);
    }
}

/// Request/session dispatch law between local transports and the kernel.
pub struct BrokerKernel<B: SurfaceBackend, L: ExtensionLoader = UnsupportedExtensionLoader> {
    kernel: Kernel<B>,
    extension_loader: L,
    next_lease: u64,
    default_space: Option<SpaceRef>,
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

impl<B: SurfaceBackend> BrokerKernel<B, UnsupportedExtensionLoader> {
    pub fn new(backend: B) -> Self {
        Self::with_extension_loader(backend, UnsupportedExtensionLoader)
    }
}

impl<B: SurfaceBackend, L: ExtensionLoader> BrokerKernel<B, L> {
    pub fn with_extension_loader(backend: B, extension_loader: L) -> Self {
        Self {
            kernel: Kernel::new(backend),
            extension_loader,
            next_lease: 1,
            default_space: None,
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

                let lease_id = session
                    .lease_id
                    .clone()
                    .unwrap_or_else(|| self.allocate_lease(session));
                vec![ServerFrame::Ready {
                    protocol_version: PROTOCOL_VERSION,
                    broker_version: broker_version.to_string(),
                    session_id: lease_id,
                }]
            }
            ClientFrame::Exit => self.close_session_with_extension_host(session, host),
            frame => {
                let request_id = request_id(&frame);
                // Public API calls this a session; internal lease ids remain the kernel authority token.
                let Some(lease_id) = session.lease_id().map(ToOwned::to_owned) else {
                    return vec![protocol_error(
                        request_id,
                        "not-initialized",
                        "init must be accepted before broker commands",
                    )];
                };
                self.handle_initialized_frame(&lease_id, frame, host)
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
        let Some(lease_id) = session.lease_id.take() else {
            return Vec::new();
        };

        // Disconnect cleanup must flow through the kernel so only lease-owned state is removed.
        match self.kernel.close_lease_with_host(&lease_id, host) {
            Ok(events) => extension_events(events),
            Err(error) => vec![kernel_error(None, error)],
        }
    }

    pub fn route_backend_event(&self, event: TrayEvent) -> Option<RoutedEvent> {
        self.kernel.route_event(event)
    }

    fn handle_initialized_frame(
        &mut self,
        lease_id: &str,
        frame: ClientFrame,
        host: &mut dyn ExtensionHostContext,
    ) -> Vec<ServerFrame> {
        match frame {
            ClientFrame::CreateSpace {
                request_id,
                options,
            } => match self.kernel.create_space(options.clone()) {
                Ok(space) => {
                    if options.default || self.default_space.is_none() {
                        self.default_space = Some(space.clone());
                    }
                    vec![ServerFrame::SpaceCreated { request_id, space }]
                }
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::ResolveDefaultSpace { request_id } => {
                let space = match self.default_space.clone() {
                    Some(space) => Ok(space),
                    None => self.kernel.create_space(SpaceOptions {
                        id: Some("opentray.default".to_string()),
                        title: Some("OpenTray".to_string()),
                        icon: None,
                        default: true,
                    }),
                };

                match space {
                    Ok(space) => {
                        self.default_space = Some(space.clone());
                        vec![ServerFrame::DefaultSpace { request_id, space }]
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::CreateTray {
                request_id,
                space,
                tray,
            } => match self.kernel.create_tray(lease_id.to_string(), &space, tray) {
                Ok(tray_id) => vec![ServerFrame::TrayCreated {
                    request_id,
                    space_id: space.space_id,
                    tray_id,
                }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::DestroyTray {
                request_id,
                space_id,
                tray_id,
            } => match self.kernel.destroy_tray(lease_id, &space_id, &tray_id) {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::GetTrayBounds {
                request_id,
                space_id,
                tray_id,
            } => match self.kernel.tray_bounds(lease_id, &space_id, &tray_id) {
                Ok(bounds) => vec![ServerFrame::TrayBounds {
                    request_id,
                    space_id,
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
                space_id,
                tray_id,
                menu,
            } => match self
                .kernel
                .set_tray_menu(lease_id, &space_id, &tray_id, menu)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::SetTrayIcon {
                request_id,
                space_id,
                tray_id,
                icon,
            } => match self
                .kernel
                .set_tray_icon(lease_id, &space_id, &tray_id, icon)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::SetTrayTooltip {
                request_id,
                space_id,
                tray_id,
                tooltip,
            } => match self
                .kernel
                .set_tray_tooltip(lease_id, &space_id, &tray_id, tooltip)
            {
                Ok(()) => vec![ServerFrame::Ack { request_id }],
                Err(error) => vec![kernel_error(Some(request_id), error)],
            },
            ClientFrame::ExtCommand {
                request_id,
                space_id,
                tray_id,
                ext,
                data,
            } => {
                let tray_bounds = self
                    .kernel
                    .tray_bounds(lease_id, &space_id, &tray_id)
                    .ok()
                    .flatten();
                let mut scoped_host = ScopedExtensionHost {
                    outer: host,
                    tray_bounds,
                };
                match self.kernel.ext_command_with_host(
                    space_id,
                    tray_id,
                    ext,
                    data,
                    &mut scoped_host,
                ) {
                    Ok(events) => {
                        let mut frames = vec![ServerFrame::Ack { request_id }];
                        frames.extend(extension_events(events));
                        frames
                    }
                    Err(error) => vec![kernel_error(Some(request_id), error)],
                }
            }
            ClientFrame::LoadExt {
                request_id,
                space_id,
                name,
                path,
            } => {
                let request = ExtensionLoadRequest {
                    surface_id: space_id.clone(),
                    name,
                    path,
                };
                match self
                    .extension_loader
                    .load(&request)
                    .map_err(KernelError::from)
                    .and_then(|instance| self.kernel.register_extension(space_id, instance))
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

    fn allocate_lease(&mut self, session: &mut BrokerSession) -> LeaseId {
        let lease_id = format!("lease-{}", self.next_lease);
        self.next_lease += 1;
        session.accept(lease_id.clone());
        lease_id
    }
}

fn request_id(frame: &ClientFrame) -> Option<RequestId> {
    match frame {
        ClientFrame::CreateSpace { request_id, .. }
        | ClientFrame::ResolveDefaultSpace { request_id }
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

fn extension_events(events: Vec<ExtensionEnvelope>) -> Vec<ServerFrame> {
    events
        .into_iter()
        .filter_map(|event| {
            event.scope.tray_id.map(|tray_id| ServerFrame::ExtEvent {
                space_id: event.scope.surface_id,
                tray_id,
                ext: event.scope.ext,
                data: event.data,
            })
        })
        .collect()
}

fn kernel_error(request_id: Option<RequestId>, error: KernelError) -> ServerFrame {
    protocol_error(request_id, "kernel-error", error.to_string())
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
