use opentray_spec::{
    ClientFrame, Icon, Menu, MenuItem, ServerFrame, SurfaceOptions, TrayEvent, TrayOptions,
    PROTOCOL_VERSION,
};

use super::*;
use crate::{BackendCapabilities, BackendOperation, FakeBackend};

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
            lease_id,
            protocol_version: PROTOCOL_VERSION,
            ..
        } if lease_id == "lease-1"
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
        ClientFrame::CreateSurface {
            request_id: "req-1".to_string(),
            options: SurfaceOptions {
                app_id: "app".to_string(),
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
fn create_surface_returns_correlated_broker_identity() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend);
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateSurface {
            request_id: "req-1".to_string(),
            options: SurfaceOptions {
                app_id: "app".to_string(),
                title: Some("App".to_string()),
                icon: None,
                default: true,
            },
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::SurfaceCreated {
            request_id,
            surface,
        } if request_id == "req-1" && surface.surface_id == "surface-1"
    ));
}

#[test]
fn create_tray_syncs_backend_projection() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_surface(&mut broker, &mut session);

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            surface,
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
fn disconnect_cleans_only_session_lease() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone());
    let mut first = BrokerSession::new();
    let mut second = BrokerSession::new();
    broker.handle_frame(&mut first, init(), "0.1.0");
    broker.handle_frame(&mut second, init(), "0.1.0");
    let surface = create_surface(&mut broker, &mut first);
    broker.handle_frame(
        &mut first,
        ClientFrame::CreateTray {
            request_id: "req-a".to_string(),
            surface: surface.clone(),
            tray: tray_options("a"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut second,
        ClientFrame::CreateTray {
            request_id: "req-b".to_string(),
            surface,
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
    let surface = create_surface(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            surface: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let routed = broker
        .route_backend_event(TrayEvent::MenuClick {
            surface_id: surface.surface_id,
            tray_id: "status".to_string(),
            item_id: 7,
        })
        .expect("routed");

    assert_eq!(routed.lease_id, "lease-1");
}

fn create_surface(
    broker: &mut BrokerKernel<FakeBackend>,
    session: &mut BrokerSession,
) -> opentray_spec::SurfaceRef {
    match broker.handle_frame(
        session,
        ClientFrame::CreateSurface {
            request_id: "req-surface".to_string(),
            options: SurfaceOptions {
                app_id: "app".to_string(),
                title: None,
                icon: None,
                default: true,
            },
        },
        "0.1.0",
    )[0]
    .clone()
    {
        ServerFrame::SurfaceCreated { surface, .. } => surface,
        other => panic!("unexpected frame: {other:?}"),
    }
}
