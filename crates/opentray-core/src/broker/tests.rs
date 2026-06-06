use opentray_spec::{
    ClientFrame, Icon, Menu, MenuItem, ServerFrame, SpaceOptions, TrayEvent, TrayOptions,
    PROTOCOL_VERSION,
};

use super::*;
use crate::{
    BackendCapabilities, BackendOperation, ExtensionError, ExtensionHostContext, ExtensionInstance,
    ExtensionLoadRequest, ExtensionLoader, FakeBackend, RecordingExtensionLoader,
    RECORDING_EXTENSION_PATH,
};

fn icon() -> Icon {
    Icon::Rgba {
        data: vec![0, 0, 0, 0],
        width: 1,
        height: 1,
    }
}

fn tray_options(tray_id: &str) -> TrayOptions {
    TrayOptions {
        tray_id: Some(tray_id.to_string()),
        app_id: Some("app.tray".to_string()),
        title: Some("Tray".to_string()),
        tooltip: None,
        icon: icon(),
        menu: Some(Menu {
            items: vec![MenuItem::Item {
                id: 7,
                title: "Open".to_string(),
                primary_event: false,
                enabled: true,
                shortcut: None,
            }],
        }),
    }
}

fn init() -> ClientFrame {
    ClientFrame::Init {
        protocol_version: PROTOCOL_VERSION,
        client_version: "0.1.0".to_string(),
    }
}

#[test]
fn compatible_init_accepts_session_lease() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(&mut session, init(), "0.1.0");

    assert_eq!(session.lease_id(), Some("lease-1"));
    assert!(matches!(
        &frames[0],
        ServerFrame::Ready {
            session_id,
            protocol_version: PROTOCOL_VERSION,
            ..
        } if session_id == "lease-1"
    ));
}

#[test]
fn incompatible_init_does_not_create_lease() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::Init {
            protocol_version: PROTOCOL_VERSION + 1,
            client_version: "0.1.0".to_string(),
        },
        "0.1.0",
    );

    assert_eq!(session.lease_id(), None);
    assert!(matches!(
        &frames[0],
        ServerFrame::Error { code, .. } if code == "incompatible-protocol"
    ));
}

#[test]
fn command_before_init_is_rejected_without_backend_mutation() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateSpace {
            request_id: "req-1".to_string(),
            options: SpaceOptions {
                id: Some("app".to_string()),
                title: None,
                icon: None,
                default: true,
            },
        },
        "0.1.0",
    );

    assert!(backend.operations().is_empty());
    assert!(matches!(
        &frames[0],
        ServerFrame::Error {
            request_id: Some(request_id),
            code,
            ..
        } if request_id == "req-1" && code == "not-initialized"
    ));
}

#[test]
fn create_space_returns_correlated_broker_identity() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateSpace {
            request_id: "req-1".to_string(),
            options: SpaceOptions {
                id: Some("app".to_string()),
                title: Some("App".to_string()),
                icon: None,
                default: true,
            },
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::SpaceCreated {
            request_id,
            space,
        } if request_id == "req-1" && space.space_id == "app"
    ));
}

#[test]
fn create_tray_syncs_backend_projection() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            space: surface,
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::TrayCreated {
            request_id,
            tray_id,
            ..
        } if request_id == "req-tray" && tray_id == "status"
    ));
    assert!(backend.operations().iter().any(|operation| {
        matches!(
            operation,
            BackendOperation::SyncSurface(projection)
                if projection.trays.iter().any(|tray| tray.tray_id == "status")
        )
    }));
}

#[test]
fn get_tray_bounds_returns_correlated_bounds_for_owner() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            space: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            space_id: surface.space_id.clone(),
            tray_id: "status".to_string(),
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::TrayBounds {
            request_id,
            space_id,
            tray_id,
            bounds,
        } if request_id == "req-bounds" && space_id == "app" && tray_id == "status"
            && matches!(bounds.kind, opentray_spec::TrayBoundsKind::Native)
            && bounds.rect.is_some()
    ));
    assert!(backend.operations().iter().any(|operation| {
        matches!(
            operation,
            BackendOperation::TrayBounds(space_id, tray_id)
                if space_id == "app" && tray_id == "status"
        )
    }));
}

#[test]
fn get_tray_bounds_rejects_non_owner_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut owner = BrokerSession::new();
    let mut other = BrokerSession::new();
    broker.handle_frame(&mut owner, init(), "0.1.0");
    broker.handle_frame(&mut other, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut owner);
    broker.handle_frame(
        &mut owner,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            space: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut other,
        ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            space_id: surface.space_id,
            tray_id: "status".to_string(),
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::Error {
            request_id: Some(request_id),
            code,
            ..
        } if request_id == "req-bounds" && code == "kernel-error"
    ));
}

#[test]
fn disconnect_cleans_only_session_lease() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut first = BrokerSession::new();
    let mut second = BrokerSession::new();
    broker.handle_frame(&mut first, init(), "0.1.0");
    broker.handle_frame(&mut second, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut first);
    broker.handle_frame(
        &mut first,
        ClientFrame::CreateTray {
            request_id: "req-a".to_string(),
            space: surface.clone(),
            tray: tray_options("a"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut second,
        ClientFrame::CreateTray {
            request_id: "req-b".to_string(),
            space: surface,
            tray: tray_options("b"),
        },
        "0.1.0",
    );

    broker.close_session(&mut first);

    let last_projection = backend
        .operations()
        .into_iter()
        .filter_map(|operation| match operation {
            BackendOperation::SyncSurface(projection) => Some(projection),
            _ => None,
        })
        .last()
        .expect("projection");
    assert_eq!(last_projection.trays.len(), 1);
    assert_eq!(last_projection.trays[0].tray_id, "b");
}

#[test]
fn backend_event_routes_to_owning_lease() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            space: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let routed = broker
        .route_backend_event(TrayEvent::MenuClick {
            space_id: surface.space_id,
            tray_id: "status".to_string(),
            item_id: 7,
        })
        .expect("routed");

    assert_eq!(routed.lease_id, "lease-1");
}

#[test]
fn load_ext_rejects_dynamic_paths_without_a_loader() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            space_id: surface.space_id,
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::Error {
            request_id: Some(request_id),
            code,
            ..
        } if request_id == "req-load" && code == "kernel-error"
    ));
}

#[test]
fn explicit_recording_loader_registers_preview_extension_for_command_path() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(backend, RecordingExtensionLoader);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            space: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let load_frames = broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            space_id: surface.space_id.clone(),
            name: "webview".to_string(),
            path: RECORDING_EXTENSION_PATH.to_string(),
            mount_id: None,
        },
        "0.1.0",
    );
    let command_frames = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-ext".to_string(),
            space_id: surface.space_id,
            tray_id: "status".to_string(),
            ext: "webview".to_string(),
            data: serde_json::json!({ "type": "show" }),
        },
        "0.1.0",
    );

    assert!(matches!(
        &load_frames[0],
        ServerFrame::Ack { request_id } if request_id == "req-load"
    ));
    assert!(matches!(
        &command_frames[0],
        ServerFrame::Ack { request_id } if request_id == "req-ext"
    ));
    assert!(matches!(
        &command_frames[1],
        ServerFrame::ExtEvent {
            ext,
            data,
            ..
        } if ext == "webview" && data["type"] == "recorded" && data["command"]["type"] == "show"
    ));
}

#[test]
fn load_ext_mount_id_isolates_instances_with_the_same_extension_name() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(backend, RecordingExtensionLoader);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);
    for tray_id in ["tray-a", "tray-b"] {
        broker.handle_frame(
            &mut session,
            ClientFrame::CreateTray {
                request_id: format!("req-{tray_id}"),
                space: surface.clone(),
                tray: tray_options(tray_id),
            },
            "0.1.0",
        );
    }

    for mount_id in ["webview.tray-a", "webview.tray-b"] {
        let frames = broker.handle_frame(
            &mut session,
            ClientFrame::LoadExt {
                request_id: format!("req-load-{mount_id}"),
                space_id: surface.space_id.clone(),
                name: "webview".to_string(),
                path: RECORDING_EXTENSION_PATH.to_string(),
                mount_id: Some(mount_id.to_string()),
            },
            "0.1.0",
        );
        assert!(matches!(&frames[0], ServerFrame::Ack { .. }));
    }

    let command_a = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-command-a".to_string(),
            space_id: surface.space_id.clone(),
            tray_id: "tray-a".to_string(),
            ext: "webview.tray-a".to_string(),
            data: serde_json::json!({ "type": "show", "slot": "a" }),
        },
        "0.1.0",
    );
    let command_b = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-command-b".to_string(),
            space_id: surface.space_id,
            tray_id: "tray-b".to_string(),
            ext: "webview.tray-b".to_string(),
            data: serde_json::json!({ "type": "show", "slot": "b" }),
        },
        "0.1.0",
    );

    assert!(matches!(
        &command_a[1],
        ServerFrame::ExtEvent {
            tray_id,
            ext,
            data,
            ..
        } if tray_id == "tray-a" && ext == "webview.tray-a" && data["command"]["slot"] == "a"
    ));
    assert!(matches!(
        &command_b[1],
        ServerFrame::ExtEvent {
            tray_id,
            ext,
            data,
            ..
        } if tray_id == "tray-b" && ext == "webview.tray-b" && data["command"]["slot"] == "b"
    ));
}

#[test]
fn explicit_exit_uses_extension_host_for_lease_cleanup() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(backend, HostProbeLoader);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_space(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            space_id: surface.space_id,
            name: "webview".to_string(),
            path: "opentray://host-probe".to_string(),
            mount_id: None,
        },
        "0.1.0",
    );
    let mut host = CountingHost::default();

    let _ = broker.handle_frame_with_extension_host(
        &mut session,
        ClientFrame::Exit,
        "0.1.0",
        &mut host,
    );

    assert_eq!(host.calls, 1);
}

fn create_space<L: ExtensionLoader>(
    broker: &mut BrokerKernel<FakeBackend, L>,
    session: &mut BrokerSession,
) -> opentray_spec::SpaceRef {
    match broker.handle_frame(
        session,
        ClientFrame::CreateSpace {
            request_id: "req-surface".to_string(),
            options: SpaceOptions {
                id: Some("app".to_string()),
                title: None,
                icon: None,
                default: true,
            },
        },
        "0.1.0",
    )[0]
    .clone()
    {
        ServerFrame::SpaceCreated { space, .. } => space,
        other => panic!("unexpected frame: {other:?}"),
    }
}

#[derive(Default)]
struct CountingHost {
    calls: usize,
}

impl ExtensionHostContext for CountingHost {
    fn invoke_host(
        &mut self,
        _capability: &str,
        _request_json: &[u8],
    ) -> Result<Vec<u8>, ExtensionError> {
        self.calls += 1;
        Ok(Vec::new())
    }
}

#[derive(Clone)]
struct HostProbeLoader;

impl ExtensionLoader for HostProbeLoader {
    fn load(
        &self,
        _request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        Ok(Box::new(HostProbeExtension))
    }
}

struct HostProbeExtension;

impl ExtensionInstance for HostProbeExtension {
    fn name(&self) -> &str {
        "webview"
    }

    fn command(
        &mut self,
        envelope: opentray_spec::ExtensionEnvelope,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<opentray_spec::ExtensionEnvelope>, ExtensionError> {
        Ok(vec![envelope])
    }

    fn lease_closed(
        &mut self,
        lease_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<opentray_spec::ExtensionEnvelope>, ExtensionError> {
        host.invoke_host("probe", lease_id.as_bytes())?;
        Ok(Vec::new())
    }
}
