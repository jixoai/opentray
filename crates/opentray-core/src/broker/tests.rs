use opentray_spec::{
    AppIcon, AppOptions, BrokerArtifactIdentity, BrokerArtifactTarget, ClientFrame,
    ExpectedExtensionIdentity, ExtensionArtifactTarget, Icon, Menu, MenuItem, ServerFrame,
    TrayEvent, TrayOptions, PROTOCOL_VERSION,
};

use super::*;
use crate::{
    BackendCapabilities, BackendOperation, ExtensionError, ExtensionHostContext, ExtensionInstance,
    ExtensionLoadRequest, ExtensionLoader, FakeBackend, RecordingExtensionLoader,
    RECORDING_EXTENSION_PATH,
};

fn icon() -> Option<Icon> {
    Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1))
}

fn app_icon() -> Option<AppIcon> {
    Some(
        serde_json::from_value(serde_json::json!([{
            "platform": "darwin",
            "format": "icns",
            "source": { "type": "encoded", "data": [105, 99, 110, 115] }
        }]))
        .expect("app icon"),
    )
}

fn app_icon_catalog() -> Option<AppIcon> {
    Some(
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
        .expect("app icon catalog"),
    )
}

fn expected_extension_identity(extension_name: &str) -> ExpectedExtensionIdentity {
    ExpectedExtensionIdentity {
        extension_name: extension_name.to_string(),
        artifact_set_version: "test".to_string(),
        contract_fingerprint: "test-contract".to_string(),
        target: ExtensionArtifactTarget {
            os: "test".to_string(),
            arch: "test".to_string(),
        },
        sha256: None,
        build_identity: None,
    }
}

fn test_broker_artifact_identity() -> BrokerArtifactIdentity {
    BrokerArtifactIdentity {
        package_version: "0.1.0".to_string(),
        target: BrokerArtifactTarget {
            os: "darwin".to_string(),
            arch: "arm64".to_string(),
        },
        executable_hash: "0".repeat(64),
        build_identity: "test-broker".to_string(),
    }
}

fn tray_options(tray_id: &str) -> TrayOptions {
    TrayOptions {
        id: tray_id.to_string(),
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
fn compatible_init_accepts_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(&mut session, init(), "0.1.0");

    assert_eq!(session.session_id(), Some("session-1"));
    assert!(matches!(
        &frames[0],
        ServerFrame::Ready {
            session_id,
            protocol_version: PROTOCOL_VERSION,
            broker_artifact_identity,
            ..
        } if session_id == "session-1"
            && matches!(broker_artifact_identity.target.os.as_str(), "darwin" | "linux" | "win32")
            && matches!(broker_artifact_identity.target.arch.as_str(), "arm64" | "x64")
    ));
}

#[test]
fn incompatible_init_does_not_create_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::Init {
            protocol_version: PROTOCOL_VERSION + 1,
            client_version: "0.1.0".to_string(),
        },
        "0.1.0",
    );

    assert_eq!(session.session_id(), None);
    assert!(matches!(
        &frames[0],
        ServerFrame::Error { code, .. } if code == "incompatible-protocol"
    ));
}

#[test]
fn command_before_init_is_rejected_without_backend_mutation() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone(), test_broker_artifact_identity());
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateApp {
            request_id: "req-1".to_string(),
            options: AppOptions {
                id: Some("app".to_string()),
                name: None,
                app_icon: None,
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
fn create_app_returns_correlated_broker_identity() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateApp {
            request_id: "req-1".to_string(),
            options: AppOptions {
                id: Some("app".to_string()),
                name: Some("App".to_string()),
                app_icon: None,
                default: true,
            },
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::AppCreated {
            request_id,
            app,
        } if request_id == "req-1" && app.app_id == "app"
    ));
}

#[test]
fn repeated_app_id_pins_the_existing_kernel_identity() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut first = BrokerSession::new();
    let mut repeated = BrokerSession::new();
    broker.handle_frame(&mut first, init(), "0.1.0");
    broker.handle_frame(&mut repeated, init(), "0.1.0");
    let app_icon = app_icon();

    broker.handle_frame(
        &mut first,
        ClientFrame::CreateApp {
            request_id: "req-first".to_string(),
            options: AppOptions {
                id: Some("shared-app".to_string()),
                name: Some("Original".to_string()),
                app_icon: app_icon.clone(),
                default: true,
            },
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut repeated,
        ClientFrame::CreateApp {
            request_id: "req-repeated".to_string(),
            options: AppOptions {
                id: Some("shared-app".to_string()),
                name: Some("Replacement".to_string()),
                app_icon: None,
                default: false,
            },
        },
        "0.1.0",
    );

    assert!(matches!(
        repeated.app_identity(),
        Some(identity)
            if identity.app_name == "Original" && identity.app_icon == app_icon.as_ref().cloned()
    ));
}

#[test]
fn app_identity_mutations_are_session_owned_and_projected() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone(), test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    let app_icon = app_icon();

    let set_name = broker.handle_frame(
        &mut session,
        ClientFrame::SetAppName {
            request_id: "req-name".to_string(),
            app_id: surface.app_id.clone(),
            name: "Renamed".to_string(),
        },
        "0.1.0",
    );
    let set_icon = broker.handle_frame(
        &mut session,
        ClientFrame::SetAppIcon {
            request_id: "req-icon".to_string(),
            app_id: surface.app_id.clone(),
            app_icon: app_icon.clone(),
        },
        "0.1.0",
    );
    assert!(matches!(set_name[0], ServerFrame::Ack { ref request_id } if request_id == "req-name"));
    assert!(matches!(set_icon[0], ServerFrame::Ack { ref request_id } if request_id == "req-icon"));

    let identity = broker.handle_frame(
        &mut session,
        ClientFrame::GetAppIdentity {
            request_id: "req-identity".to_string(),
            app_id: surface.app_id.clone(),
        },
        "0.1.0",
    );
    assert!(matches!(
        &identity[0],
        ServerFrame::AppIdentity { identity, .. }
            if identity.app_name == "Renamed" && identity.app_icon == app_icon
    ));
    assert!(backend.operations().iter().any(|operation| {
        matches!(operation, BackendOperation::SyncApp(projection)
            if projection.title.as_deref() == Some("Renamed") && projection.app_icon == app_icon)
    }));
}

#[test]
fn app_icon_variant_frame_updates_identity_and_returns_typed_rejection() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let app = create_app(&mut broker, &mut session);
    let catalog = app_icon_catalog();

    let set_catalog = broker.handle_frame(
        &mut session,
        ClientFrame::SetAppIcon {
            request_id: "req-catalog".to_string(),
            app_id: app.app_id.clone(),
            app_icon: catalog.clone(),
        },
        "0.1.0",
    );
    assert!(
        matches!(set_catalog[0], ServerFrame::Ack { ref request_id } if request_id == "req-catalog")
    );

    let select_files = broker.handle_frame(
        &mut session,
        ClientFrame::SetAppIconVariant {
            request_id: "req-files".to_string(),
            app_id: app.app_id.clone(),
            variant: "files".to_string(),
        },
        "0.1.0",
    );
    assert!(
        matches!(select_files[0], ServerFrame::Ack { ref request_id } if request_id == "req-files")
    );
    assert!(matches!(
        session.app_identity(),
        Some(identity)
            if identity.app_icon == catalog && identity.app_icon_variant.as_deref() == Some("files")
    ));

    let missing = broker.handle_frame(
        &mut session,
        ClientFrame::SetAppIconVariant {
            request_id: "req-missing".to_string(),
            app_id: app.app_id,
            variant: "missing".to_string(),
        },
        "0.1.0",
    );
    assert!(matches!(
        &missing[0],
        ServerFrame::Error { request_id: Some(request_id), code, .. }
            if request_id == "req-missing" && code == "app-icon-variant-not-found"
    ));
    assert!(matches!(
        session.app_identity(),
        Some(identity) if identity.app_icon_variant.as_deref() == Some("files")
    ));
}

#[test]
fn app_identity_reads_reject_non_owner_sessions() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut owner = BrokerSession::new();
    let mut other = BrokerSession::new();
    broker.handle_frame(&mut owner, init(), "0.1.0");
    broker.handle_frame(&mut other, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut owner);

    let frames = broker.handle_frame(
        &mut other,
        ClientFrame::GetAppIdentity {
            request_id: "req-identity".to_string(),
            app_id: surface.app_id,
        },
        "0.1.0",
    );
    assert!(matches!(
        &frames[0],
        ServerFrame::Error { request_id: Some(request_id), code, .. }
            if request_id == "req-identity" && code == "session-mismatch"
    ));
}

#[test]
fn create_tray_syncs_backend_projection() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone(), test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface,
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
            BackendOperation::SyncApp(projection)
                if projection.trays.iter().any(|tray| tray.tray_id == "status")
        )
    }));
}

#[test]
fn get_tray_bounds_returns_correlated_bounds_for_owner() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone(), test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            app_id: surface.app_id.clone(),
            tray_id: "status".to_string(),
        },
        "0.1.0",
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::TrayBounds {
            request_id,
            app_id,
            tray_id,
            bounds,
        } if request_id == "req-bounds" && app_id == "app" && tray_id == "status"
            && matches!(bounds.kind, opentray_spec::TrayBoundsKind::Native)
            && bounds.rect.is_some()
    ));
    assert!(backend.operations().iter().any(|operation| {
        matches!(
            operation,
            BackendOperation::TrayBounds(app_id, tray_id)
                if app_id == "app" && tray_id == "status"
        )
    }));
}

#[test]
fn get_tray_bounds_rejects_non_owner_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut owner = BrokerSession::new();
    let mut other = BrokerSession::new();
    broker.handle_frame(&mut owner, init(), "0.1.0");
    broker.handle_frame(&mut other, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut owner);
    broker.handle_frame(
        &mut owner,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut other,
        ClientFrame::GetTrayBounds {
            request_id: "req-bounds".to_string(),
            app_id: surface.app_id,
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
        } if request_id == "req-bounds" && code == "session-mismatch"
    ));
}

#[test]
fn disconnect_cleans_only_current_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend.clone(), test_broker_artifact_identity());
    let mut first = BrokerSession::new();
    let mut second = BrokerSession::new();
    broker.handle_frame(&mut first, init(), "0.1.0");
    broker.handle_frame(&mut second, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut first);
    broker.handle_frame(
        &mut first,
        ClientFrame::CreateTray {
            request_id: "req-a".to_string(),
            app: surface.clone(),
            tray: tray_options("a"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut second,
        ClientFrame::CreateTray {
            request_id: "req-b".to_string(),
            app: surface,
            tray: tray_options("b"),
        },
        "0.1.0",
    );

    broker.close_session(&mut first);

    let last_projection = backend
        .operations()
        .into_iter()
        .filter_map(|operation| match operation {
            BackendOperation::SyncApp(projection) => Some(projection),
            _ => None,
        })
        .last()
        .expect("projection");
    assert_eq!(last_projection.trays.len(), 1);
    assert_eq!(last_projection.trays[0].tray_id, "b");
}

#[test]
fn backend_event_routes_to_owning_session() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let routed = broker
        .route_backend_event(TrayEvent::MenuClick {
            app_id: surface.app_id,
            tray_id: "status".to_string(),
            item_id: 7,
        })
        .expect("routed");

    assert_eq!(routed.session_id, "session-1");
}

#[test]
fn load_ext_rejects_dynamic_paths_without_a_loader() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id,
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            expected_identity: expected_extension_identity("webview"),
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
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        RecordingExtensionLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );

    let load_frames = broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id.clone(),
            name: "webview".to_string(),
            path: RECORDING_EXTENSION_PATH.to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        },
        "0.1.0",
    );
    let command_frames = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-ext".to_string(),
            app_id: surface.app_id,
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
        ServerFrame::ExtCommandResult { request_id, events }
            if request_id == "req-ext"
                && events.len() == 1
                && events[0].scope.ext == "webview"
                && events[0].data["type"] == "recorded"
                && events[0].data["command"]["type"] == "show"
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
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        RecordingExtensionLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    for tray_id in ["tray-a", "tray-b"] {
        broker.handle_frame(
            &mut session,
            ClientFrame::CreateTray {
                request_id: format!("req-{tray_id}"),
                app: surface.clone(),
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
                app_id: surface.app_id.clone(),
                name: "webview".to_string(),
                path: RECORDING_EXTENSION_PATH.to_string(),
                expected_identity: expected_extension_identity("webview"),
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
            app_id: surface.app_id.clone(),
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
            app_id: surface.app_id,
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
fn explicit_exit_uses_extension_host_for_session_cleanup() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        HostProbeLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id,
            name: "webview".to_string(),
            path: "opentray://host-probe".to_string(),
            expected_identity: expected_extension_identity("webview"),
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

#[test]
fn ext_command_dispatch_forwards_send_event_to_the_caller_host() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        SendEventLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id.clone(),
            name: "webview".to_string(),
            path: "opentray://send-event".to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        },
        "0.1.0",
    );
    let mut host = SendEventRecorder::default();

    let frames = broker.handle_frame_with_extension_host(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-ext".to_string(),
            app_id: surface.app_id,
            tray_id: "status".to_string(),
            ext: "webview".to_string(),
            data: serde_json::json!({ "type": "show" }),
        },
        "0.1.0",
        &mut host,
    );

    assert!(matches!(
        &frames[0],
        ServerFrame::ExtCommandResult { request_id, .. } if request_id == "req-ext"
    ));
    assert_eq!(
        host.events,
        vec![PUSHED_EVENT.as_bytes().to_vec()],
        "the scoped host must forward extension pushes byte-exact to the caller host"
    );
}

#[test]
fn session_cleanup_forwards_send_event_to_the_caller_host() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        SendEventLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id,
            name: "webview".to_string(),
            path: "opentray://send-event".to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        },
        "0.1.0",
    );
    let mut host = SendEventRecorder::default();

    let _ = broker.handle_frame_with_extension_host(
        &mut session,
        ClientFrame::Exit,
        "0.1.0",
        &mut host,
    );

    assert_eq!(
        host.events,
        vec![PUSHED_EVENT.as_bytes().to_vec()],
        "session cleanup must forward extension pushes to the caller host"
    );
}

fn create_app<L: ExtensionLoader>(
    broker: &mut BrokerKernel<FakeBackend, L>,
    session: &mut BrokerSession,
) -> opentray_spec::AppRef {
    match broker.handle_frame(
        session,
        ClientFrame::CreateApp {
            request_id: "req-surface".to_string(),
            options: AppOptions {
                id: Some("app".to_string()),
                name: None,
                app_icon: None,
                default: true,
            },
        },
        "0.1.0",
    )[0]
    .clone()
    {
        ServerFrame::AppCreated { app, .. } => app,
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

const PUSHED_EVENT: &str =
    r#"{"scope":{"appId":"app","trayId":"status","ext":"webview"},"data":{"type":"pushed"}}"#;

#[derive(Default)]
struct SendEventRecorder {
    events: Vec<Vec<u8>>,
}

impl ExtensionHostContext for SendEventRecorder {
    fn invoke_host(
        &mut self,
        _capability: &str,
        _request_json: &[u8],
    ) -> Result<Vec<u8>, ExtensionError> {
        Ok(Vec::new())
    }

    fn send_event(&mut self, event_json: &[u8]) -> Result<(), ExtensionError> {
        self.events.push(event_json.to_vec());
        Ok(())
    }
}

#[derive(Clone)]
struct SendEventLoader;

impl ExtensionLoader for SendEventLoader {
    fn load(
        &self,
        _request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        Ok(Box::new(SendEventExtension))
    }
}

struct SendEventExtension;

impl ExtensionInstance for SendEventExtension {
    fn name(&self) -> &str {
        "webview"
    }

    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        _issued: crate::IssuedOperation,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<crate::ExtensionCommandDisposition, ExtensionError> {
        host.send_event(PUSHED_EVENT.as_bytes())?;
        Ok(crate::ExtensionCommandDisposition::Immediate(vec![
            ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                data: envelope.data,
            },
        ]))
    }

    fn session_closed(
        &mut self,
        _session_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        host.send_event(PUSHED_EVENT.as_bytes())?;
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
        _issued: crate::IssuedOperation,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<crate::ExtensionCommandDisposition, ExtensionError> {
        Ok(crate::ExtensionCommandDisposition::Immediate(vec![
            opentray_spec::ExtensionEnvelope {
                scope: envelope.scope,
                command_scope: None,
                data: envelope.data,
            },
        ]))
    }

    fn session_closed(
        &mut self,
        session_id: &str,
        host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<opentray_spec::ExtensionEnvelope>, ExtensionError> {
        host.invoke_host("probe", session_id.as_bytes())?;
        Ok(Vec::new())
    }
}

// -- DeferredOperation dispatch (add-ext-dialog 2.1/2.3) --------------------

#[derive(Clone)]
struct DeferringLoader;

impl ExtensionLoader for DeferringLoader {
    fn load(
        &self,
        _request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        Ok(Box::new(DeferringExtension))
    }
}

/// The simplest lawful deferring instance: every command answers Deferred
/// and the operation stays pending until a terminal settles it.
struct DeferringExtension;

impl ExtensionInstance for DeferringExtension {
    fn name(&self) -> &str {
        "dialog"
    }

    fn command(
        &mut self,
        _envelope: ExtensionEnvelope,
        _issued: crate::IssuedOperation,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<crate::ExtensionCommandDisposition, ExtensionError> {
        Ok(crate::ExtensionCommandDisposition::Deferred)
    }

    fn session_closed(
        &mut self,
        _session_id: &str,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        Ok(Vec::new())
    }
}

/// A deferred dispatch answers `ext-command-accepted` (never a result), the
/// operation stays registered for the session, and the owner loop's
/// settlement CAS resolves it to exactly one terminal.
#[test]
fn deferred_command_answers_accepted_and_settles_exactly_once() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        DeferringLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id.clone(),
            name: "dialog".to_string(),
            path: "opentray://deferring".to_string(),
            expected_identity: expected_extension_identity("dialog"),
            mount_id: None,
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-ext".to_string(),
            app_id: surface.app_id,
            tray_id: "status".to_string(),
            ext: "dialog".to_string(),
            data: serde_json::json!({ "type": "messageDialog" }),
        },
        "0.1.0",
    );

    let [ServerFrame::ExtCommandAccepted {
        request_id,
        operation_id,
    }] = frames.as_slice()
    else {
        panic!("a deferred command answers exactly one accepted frame: {frames:?}");
    };
    assert_eq!(request_id, "req-ext");
    assert_eq!(operation_id.len(), 16, "hex wire form of the handle");

    // The operation stays pending for the owning session.
    let operations = broker.operations().clone();
    let session_id = session.session_id().unwrap().to_string();
    assert_eq!(operations.session_operation_count(&session_id), 1);

    // Simulate the composition's owner-loop settlement with the port owner
    // bound to this session (generation 0: no deferred port attached).
    let owner = crate::operations::DeferredPortOwner {
        app_id: "app".to_string(),
        instance: "dialog".to_string(),
        generation: 0,
        session_id: Some(session_id.clone()),
    };
    let issued = crate::operations::IssuedOperation {
        operation_id: operation_id.clone(),
        handle: u64::from_str_radix(operation_id, 16).unwrap(),
    };
    assert_eq!(
        operations.settle(issued.handle, &owner),
        crate::operations::OperationSettlement::Settled {
            operation_id: operation_id.clone(),
            scope: opentray_spec::CommandScope {
                app_id: "app".to_string(),
                tray_id: "status".to_string(),
                session_id: session_id.clone(),
                instance_generation: 0,
            },
        }
    );
    // The duplicate terminal is a stateless drop — no second frame.
    assert_eq!(
        operations.settle(issued.handle, &owner),
        crate::operations::OperationSettlement::Duplicate {
            operation_id: operation_id.clone(),
        }
    );
    // Session close purges the (settled) operation state.
    assert_eq!(operations.purge_session(&session_id), 1);
}

/// The version-2 bump retires version 1 exhaustively: an old client's Init
/// is refused before any session exists.
#[test]
fn version_one_init_is_rejected_as_incompatible() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::new(backend, test_broker_artifact_identity());
    let mut session = BrokerSession::new();

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::Init {
            protocol_version: 1,
            client_version: "0.24.0".to_string(),
        },
        "0.1.0",
    );

    assert_eq!(session.session_id(), None);
    assert!(matches!(
        &frames[0],
        ServerFrame::Error { code, message, .. }
            if code == "incompatible-protocol" && message.contains("protocolVersion 1")
    ));
}

// -- Synchronous typed-error details (add-ext-dialog 7.5) -------------------

#[derive(Clone)]
struct TypedErrorLoader;

impl ExtensionLoader for TypedErrorLoader {
    fn load(
        &self,
        _request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        Ok(Box::new(TypedErrorExtension))
    }
}

/// Rejects every command with a structured category plus a discriminated
/// `details` payload, exactly as a native extension would through
/// `opentray_ext_take_error`.
struct TypedErrorExtension;

impl ExtensionInstance for TypedErrorExtension {
    fn name(&self) -> &str {
        "dialog"
    }

    fn command(
        &mut self,
        _envelope: ExtensionEnvelope,
        _issued: crate::IssuedOperation,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<crate::ExtensionCommandDisposition, ExtensionError> {
        Err(ExtensionError::Detailed {
            category: "dialog_invalid_options".to_string(),
            message: "buttons must not be empty".to_string(),
            details: Some(serde_json::json!({ "kind": "options", "field": "buttons" })),
        })
    }

    fn session_closed(
        &mut self,
        _session_id: &str,
        _host: &mut dyn ExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        Ok(Vec::new())
    }
}

/// The synchronous error path is isomorphic with deferred terminal errors:
/// a `Detailed` rejection with `details` surfaces as a correlated
/// `ServerFrame::Error` whose wire form carries the same `details` JSON
/// (add-ext-dialog design section 7.5). The rejected operation also retires,
/// so no deferred promise stays pending behind a synchronous error.
#[test]
fn synchronous_typed_error_carries_details_onto_the_error_frame() {
    let backend = FakeBackend::new(BackendCapabilities::full());
    let mut broker = BrokerKernel::with_extension_loader(
        backend,
        TypedErrorLoader,
        test_broker_artifact_identity(),
    );
    let mut session = BrokerSession::new();
    broker.handle_frame(&mut session, init(), "0.1.0");
    let surface = create_app(&mut broker, &mut session);
    broker.handle_frame(
        &mut session,
        ClientFrame::CreateTray {
            request_id: "req-tray".to_string(),
            app: surface.clone(),
            tray: tray_options("status"),
        },
        "0.1.0",
    );
    broker.handle_frame(
        &mut session,
        ClientFrame::LoadExt {
            request_id: "req-load".to_string(),
            app_id: surface.app_id.clone(),
            name: "dialog".to_string(),
            path: "opentray://typed-error".to_string(),
            expected_identity: expected_extension_identity("dialog"),
            mount_id: None,
        },
        "0.1.0",
    );

    let frames = broker.handle_frame(
        &mut session,
        ClientFrame::ExtCommand {
            request_id: "req-ext".to_string(),
            app_id: surface.app_id,
            tray_id: "status".to_string(),
            ext: "dialog".to_string(),
            data: serde_json::json!({ "type": "messageDialog" }),
        },
        "0.1.0",
    );

    let details = serde_json::json!({ "kind": "options", "field": "buttons" });
    let [ServerFrame::Error {
        request_id,
        code,
        message,
        details: frame_details,
    }] = frames.as_slice()
    else {
        panic!("a typed rejection answers exactly one correlated error: {frames:?}");
    };
    assert_eq!(request_id, &Some("req-ext".to_string()));
    assert_eq!(code, "dialog_invalid_options");
    assert_eq!(message, "buttons must not be empty");
    assert_eq!(frame_details.as_ref(), Some(&details));

    // Wire truth: the serialized frame carries the details JSON.
    let wire = serde_json::to_value(&frames[0]).expect("serialize error frame");
    assert_eq!(wire["details"], details);
    assert_eq!(wire["code"], "dialog_invalid_options");

    // The failed dispatch retires its pre-registered operation: no pending
    // promise survives a synchronous typed error.
    let operations = broker.operations().clone();
    assert_eq!(
        operations.session_operation_count(session.session_id().unwrap()),
        0
    );
}
