// Session-routed extension event delivery for the production brokers.
//
// Law: `ExtensionHostContext::send_event` is the generic extension ABI push
// channel. Events pushed by an extension instance belong to the client session
// that created that instance (the `LoadExt` sender), not to whichever session
// happens to dispatch a command. When the owning session is gone, pushed
// events are dropped with a broker-log diagnostic instead of leaking into
// another session or stalling the extension call.

use std::collections::HashMap;

use opentray_core::{ExtensionError, ExtensionHostContext};
use opentray_spec::{
    AppId, ClientFrame, ExtensionEnvelope, ExtensionScope, ServerFrame, SessionId, TrayId,
};

/// Scope authority for extension host calls triggered by one client frame.
///
/// `BrokerKernel` wraps the outer host in its `ScopedExtensionHost` during an
/// `ExtCommand` dispatch, so the frame's `(appId, trayId, ext)` identifies the
/// one extension instance being dispatched. Pushed events from that call must
/// carry that same scope — exactly like the events the extension returns from
/// the command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExtensionDispatch {
    pub(crate) app_id: AppId,
    pub(crate) tray_id: TrayId,
    pub(crate) ext: String,
}

impl ExtensionDispatch {
    /// Returns the dispatch scope when the frame reaches exactly one extension
    /// instance through the kernel's command path.
    pub(crate) fn from_frame(frame: &ClientFrame) -> Option<Self> {
        match frame {
            ClientFrame::ExtCommand {
                app_id, tray_id, ext, ..
            } => Some(Self {
                app_id: app_id.clone(),
                tray_id: tray_id.clone(),
                ext: ext.clone(),
            }),
            _ => None,
        }
    }
}

/// A `LoadExt` frame observed before kernel dispatch, identified by the same
/// instance name the kernel registry keys on (`mountId` or `name`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LoadedExtension {
    pub(crate) app_id: AppId,
    pub(crate) instance: String,
}

impl LoadedExtension {
    pub(crate) fn from_frame(frame: &ClientFrame) -> Option<Self> {
        match frame {
            ClientFrame::LoadExt {
                app_id,
                name,
                mount_id,
                ..
            } => Some(Self {
                app_id: app_id.clone(),
                instance: mount_id
                    .clone()
                    .unwrap_or_else(|| name.clone()),
            }),
            _ => None,
        }
    }
}

/// Records which client session created each extension instance and routes
/// extension-pushed events to that session as `ext-event` frames.
#[derive(Debug, Default)]
pub(crate) struct ExtensionEventRouter {
    owners: HashMap<(AppId, String), SessionId>,
}

impl ExtensionEventRouter {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Builds the production host context for one broker dispatch.
    ///
    /// `dispatch` is `Some` only for frames the kernel routes to one extension
    /// instance (`ExtCommand`); kernel-initiated calls such as session cleanup
    /// receive a scope-free host and trust the envelope's claimed scope, the
    /// same authority split the kernel applies to returned events.
    pub(crate) fn host(&self, dispatch: Option<ExtensionDispatch>) -> RoutingExtensionHost {
        RoutingExtensionHost {
            dispatch,
            events: Vec::new(),
        }
    }

    /// Records LoadExt ownership. Re-loading the same instance name replaces
    /// the previous owner, mirroring the kernel registry's replace semantics.
    pub(crate) fn note_loaded(&mut self, loaded: LoadedExtension, owner: SessionId) {
        self.owners.insert((loaded.app_id, loaded.instance), owner);
    }

    /// Drops ownership recorded for a closed client session so later pushes
    /// are dropped instead of surviving under a recycled session id.
    pub(crate) fn forget_session(&mut self, session_id: &str) {
        self.owners.retain(|_, owner| owner != session_id);
    }

    /// Routes buffered events to their owning sessions through `write`, which
    /// returns whether a live client session consumed the frame.
    ///
    /// Delivery is ordered per producing dispatch and writes through the
    /// session's existing frame channel; there is no polling or buffering
    /// beyond the current dispatch.
    pub(crate) fn deliver(
        &self,
        events: Vec<ExtensionEnvelope>,
        write: &mut dyn FnMut(&str, ServerFrame) -> bool,
    ) {
        for event in events {
            let ExtensionScope {
                app_id,
                tray_id,
                ext,
            } = event.scope;
            let data = event.data;
            let Some(tray_id) = tray_id else {
                // Mirror parity: tray-less envelopes are not `ext-event` frames.
                eprintln!(
                    "opentray extension event dropped: ext {ext} on app {app_id} pushed an event without a tray scope"
                );
                continue;
            };
            let Some(owner) = self.owners.get(&(app_id.clone(), ext.clone())) else {
                eprintln!(
                    "opentray extension event dropped: ext {ext} on app {app_id} has no owning client session"
                );
                continue;
            };
            let frame = ServerFrame::ExtEvent {
                app_id,
                tray_id,
                ext,
                data,
            };
            if !write(owner, frame) {
                eprintln!(
                    "opentray extension event dropped: owning client session {owner} is closed"
                );
            }
        }
    }
}

/// Production `ExtensionHostContext` handed to extension instances: it buffers
/// `send_event` pushes so delivery happens after the current kernel dispatch
/// returns, keeping kernel reentrancy out of the extension ABI.
pub(crate) struct RoutingExtensionHost {
    dispatch: Option<ExtensionDispatch>,
    events: Vec<ExtensionEnvelope>,
}

impl RoutingExtensionHost {
    pub(crate) fn take_events(&mut self) -> Vec<ExtensionEnvelope> {
        std::mem::take(&mut self.events)
    }
}

impl ExtensionHostContext for RoutingExtensionHost {
    fn invoke_host(
        &mut self,
        capability: &str,
        _request_json: &[u8],
    ) -> Result<Vec<u8>, ExtensionError> {
        // Parity with the unsupported host: the production broker exposes no
        // privileged host capabilities yet.
        Err(ExtensionError::Unsupported(format!(
            "host capability is unavailable: {capability}"
        )))
    }

    /// Accepts exactly one `ExtensionEnvelope` JSON object per call.
    ///
    /// Scope authority mirrors returned events: during an `ExtCommand`
    /// dispatch the frame's scope wins; during kernel-initiated calls the
    /// envelope's claimed scope is kept.
    fn send_event(&mut self, event_json: &[u8]) -> Result<(), ExtensionError> {
        let envelope = serde_json::from_slice::<ExtensionEnvelope>(event_json).map_err(|error| {
            ExtensionError::Rejected(format!(
                "extension event must be one ExtensionEnvelope JSON object: {error}"
            ))
        })?;
        let scope = match &self.dispatch {
            Some(dispatch) => ExtensionScope {
                app_id: dispatch.app_id.clone(),
                tray_id: Some(dispatch.tray_id.clone()),
                ext: dispatch.ext.clone(),
            },
            None => envelope.scope,
        };
        self.events.push(ExtensionEnvelope {
            scope,
            data: envelope.data,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use opentray_core::{
        BackendCapabilities, BrokerKernel, BrokerSession, ExtensionHostContext, ExtensionInstance,
        ExtensionLoader, FakeBackend,
    };
    use opentray_spec::{
        BrokerArtifactIdentity, BrokerArtifactTarget, AppOptions, ClientFrame, ExtensionArtifactTarget,
        ExpectedExtensionIdentity, Icon, Menu, MenuItem, ServerFrame, TrayOptions,
        PROTOCOL_VERSION,
    };

    use super::*;

    /// Extension that pushes one host event per call. Command pushes claim a
    /// deliberately wrong scope so tests can assert the dispatch authority;
    /// cleanup pushes carry the instance's real scope, as a production
    /// extension would.
    struct PushExtension {
        app_id: AppId,
        instance: String,
        tray_id: TrayId,
    }

    impl PushExtension {
        fn claimed_envelope(&self, r#type: &str) -> ExtensionEnvelope {
            ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: "claimed-app".to_string(),
                    tray_id: Some("claimed-tray".to_string()),
                    ext: "claimed-ext".to_string(),
                },
                data: serde_json::json!({ "type": r#type }),
            }
        }

        fn owned_envelope(&self, r#type: &str) -> ExtensionEnvelope {
            ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: self.app_id.clone(),
                    tray_id: Some(self.tray_id.clone()),
                    ext: self.instance.clone(),
                },
                data: serde_json::json!({ "type": r#type }),
            }
        }
    }

    impl ExtensionInstance for PushExtension {
        fn name(&self) -> &str {
            &self.instance
        }

        fn command(
            &mut self,
            envelope: ExtensionEnvelope,
            host: &mut dyn ExtensionHostContext,
        ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
            let pushed = self.claimed_envelope("pushed");
            host.send_event(serde_json::to_vec(&pushed).unwrap().as_slice())?;
            Ok(vec![ExtensionEnvelope {
                scope: envelope.scope,
                data: serde_json::json!({ "type": "mirrored" }),
            }])
        }

        fn session_closed(
            &mut self,
            _session_id: &str,
            host: &mut dyn ExtensionHostContext,
        ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
            let pushed = self.owned_envelope("cleanup");
            host.send_event(serde_json::to_vec(&pushed).unwrap().as_slice())?;
            Ok(Vec::new())
        }
    }

    struct PushLoader;

    impl ExtensionLoader for PushLoader {
        fn load(
            &self,
            request: &opentray_core::ExtensionLoadRequest,
        ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
            let tray_id = format!("tray-{}", request.app_id.trim_start_matches("app-"));
            Ok(Box::new(PushExtension {
                app_id: request.app_id.clone(),
                instance: request.instance_name().to_string(),
                tray_id,
            }))
        }
    }

    /// Mirrors the production broker loops: per-frame routing host, LoadExt
    /// ownership recording on Ack, ownership release on close, and buffered
    /// delivery to the owning session's frame channel.
    struct Harness {
        broker: BrokerKernel<FakeBackend, PushLoader>,
        router: ExtensionEventRouter,
        sessions: Vec<(BrokerSession, Vec<ServerFrame>)>,
    }

    impl Harness {
        fn new() -> Self {
            Self {
                broker: BrokerKernel::with_extension_loader(
                    FakeBackend::new(BackendCapabilities::full()),
                    PushLoader,
                    test_broker_artifact_identity(),
                ),
                router: ExtensionEventRouter::new(),
                sessions: Vec::new(),
            }
        }

        fn open_session(&mut self) -> usize {
            self.sessions.push((BrokerSession::new(), Vec::new()));
            let index = self.sessions.len() - 1;
            self.frame(index, init());
            index
        }

        fn create_app_and_tray(&mut self, index: usize, app_id: &str) {
            self.frame(
                index,
                ClientFrame::CreateApp {
                    request_id: format!("req-app-{app_id}"),
                    options: AppOptions {
                        id: Some(app_id.to_string()),
                        name: None,
                        app_icon: None,
                        default: true,
                    },
                },
            );
            let tray_id = format!("tray-{}", app_id.trim_start_matches("app-"));
            self.frame(
                index,
                ClientFrame::CreateTray {
                    request_id: format!("req-tray-{app_id}"),
                    app: opentray_spec::AppRef {
                        app_id: app_id.to_string(),
                    },
                    tray: tray_options(&tray_id),
                },
            );
        }

        fn load_push(&mut self, index: usize, app_id: &str) {
            self.frame(
                index,
                ClientFrame::LoadExt {
                    request_id: format!("req-load-{app_id}"),
                    app_id: app_id.to_string(),
                    name: "push".to_string(),
                    path: "test://push".to_string(),
                    expected_identity: expected_extension_identity(),
                    mount_id: None,
                },
            );
        }

        fn ext_command(&mut self, index: usize, app_id: &str, tray_id: &str) -> Vec<ServerFrame> {
            self.frame(
                index,
                ClientFrame::ExtCommand {
                    request_id: format!("req-ext-{app_id}-{tray_id}"),
                    app_id: app_id.to_string(),
                    tray_id: tray_id.to_string(),
                    ext: "push".to_string(),
                    data: serde_json::json!({ "type": "show" }),
                },
            )
        }

        fn frame(&mut self, index: usize, frame: ClientFrame) -> Vec<ServerFrame> {
            let kernel_session_id = self.sessions[index]
                .0
                .session_id()
                .map(ToOwned::to_owned);
            let loaded = LoadedExtension::from_frame(&frame);
            let mut host = self.router.host(ExtensionDispatch::from_frame(&frame));
            let frames = {
                let (broker_session, received) = &mut self.sessions[index];
                let frames = self.broker.handle_frame_with_extension_host(
                    broker_session,
                    frame,
                    "0.1.0",
                    &mut host,
                );
                received.extend(frames.iter().cloned());
                frames
            };
            if let (Some(loaded), Some(owner)) = (loaded, kernel_session_id.as_deref()) {
                if matches!(frames.first(), Some(ServerFrame::Ack { .. })) {
                    self.router.note_loaded(loaded, owner.to_string());
                }
            }
            self.deliver(host.take_events());
            frames
        }

        fn close(&mut self, index: usize) {
            let closing_session_id = self.sessions[index]
                .0
                .session_id()
                .map(ToOwned::to_owned);
            let mut host = self.router.host(None);
            let _ = self
                .broker
                .close_session_with_extension_host(&mut self.sessions[index].0, &mut host);
            if let Some(session_id) = closing_session_id.as_deref() {
                self.router.forget_session(session_id);
            }
            self.deliver(host.take_events());
        }

        fn deliver(&mut self, events: Vec<ExtensionEnvelope>) {
            self.router.deliver(events, &mut |owner, frame| {
                let mut delivered = false;
                for (broker_session, received) in self.sessions.iter_mut() {
                    if broker_session.session_id() == Some(owner) {
                        received.push(frame.clone());
                        delivered = true;
                    }
                }
                delivered
            });
        }

        fn received(&self, index: usize) -> &[ServerFrame] {
            &self.sessions[index].1
        }
    }

    fn init() -> ClientFrame {
        ClientFrame::Init {
            protocol_version: PROTOCOL_VERSION,
            client_version: "0.1.0".to_string(),
        }
    }

    fn tray_options(tray_id: &str) -> TrayOptions {
        TrayOptions {
            id: tray_id.to_string(),
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
        }
    }

    fn expected_extension_identity() -> ExpectedExtensionIdentity {
        ExpectedExtensionIdentity {
            extension_name: "push".to_string(),
            artifact_set_version: "test".to_string(),
            contract_fingerprint: "test-contract".to_string(),
            target: ExtensionArtifactTarget {
                os: "test".to_string(),
                arch: "test".to_string(),
            },
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

    fn ext_event_frames(frames: &[ServerFrame]) -> Vec<&ServerFrame> {
        frames
            .iter()
            .filter(|frame| matches!(frame, ServerFrame::ExtEvent { .. }))
            .collect()
    }

    #[test]
    fn send_event_routes_to_the_session_that_loaded_the_extension() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");
        let session_b = harness.open_session();
        harness.create_app_and_tray(session_b, "app-b");
        harness.load_push(session_b, "app-b");

        harness.ext_command(session_a, "app-a", "tray-a");

        let received = harness.received(session_a);
        let events = ext_event_frames(received);
        assert_eq!(events.len(), 2, "mirrored + pushed: {received:?}");
        assert!(matches!(
            &events[0],
            ServerFrame::ExtEvent { ext, data, .. } if ext == "push" && data["type"] == "mirrored"
        ));
        let pushed_index = received
            .iter()
            .position(|frame| {
                matches!(
                    frame,
                    ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed"
                )
            })
            .expect("pushed event frame");
        let command_index = received
            .iter()
            .position(|frame| matches!(frame, ServerFrame::ExtCommandResult { .. }))
            .expect("command result frame");
        assert!(
            pushed_index > command_index,
            "pushed events follow the command response: {received:?}"
        );
        assert_eq!(
            serde_json::to_value(&received[pushed_index]).unwrap(),
            serde_json::json!({
                "type": "ext-event",
                "appId": "app-a",
                "trayId": "tray-a",
                "ext": "push",
                "data": { "type": "pushed" },
            })
        );
        assert!(
            ext_event_frames(harness.received(session_b)).is_empty(),
            "session B must not receive session A's pushed events"
        );
    }

    #[test]
    fn command_from_another_session_still_routes_events_to_the_owner() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");
        let session_b = harness.open_session();
        harness.create_app_and_tray(session_b, "app-b");
        harness.load_push(session_b, "app-b");

        // Session B commands session A's extension instance on A's tray. The
        // kernel allows the dispatch; ownership — not the dispatching session
        // — decides where pushed events go. Mirrored returned events still
        // flow to the dispatcher in the command response.
        let frames = harness.ext_command(session_b, "app-a", "tray-a");
        assert!(matches!(
            frames.first(),
            Some(ServerFrame::ExtCommandResult { .. })
        ));

        let dispatcher_events = ext_event_frames(harness.received(session_b));
        assert_eq!(
            dispatcher_events.len(),
            1,
            "the dispatching session receives only the mirrored event: {dispatcher_events:?}"
        );
        assert!(matches!(
            &dispatcher_events[0],
            ServerFrame::ExtEvent { data, .. } if data["type"] == "mirrored"
        ));
        let owner_events = ext_event_frames(harness.received(session_a));
        assert_eq!(
            owner_events.len(),
            1,
            "the owning session receives the pushed event: {owner_events:?}"
        );
        assert!(matches!(
            &owner_events[0],
            ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed"
        ));
    }

    #[test]
    fn closing_a_session_drops_its_events_without_crossing_sessions() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");
        let session_b = harness.open_session();
        harness.create_app_and_tray(session_b, "app-b");
        harness.load_push(session_b, "app-b");
        let baseline_a = harness.received(session_a).len();

        harness.close(session_b);

        // The kernel's session-cleanup broadcast reaches both instances. B's
        // own cleanup push must be dropped (owner forgotten); A's instance
        // still routes to A under its claimed scope.
        let events = ext_event_frames(harness.received(session_a));
        assert_eq!(events.len(), 1, "only session A's instance event: {events:?}");
        assert!(matches!(
            &events[0],
            ServerFrame::ExtEvent { app_id, tray_id, ext, data }
                if app_id == "app-a" && tray_id == "tray-a" && ext == "push"
                    && data["type"] == "cleanup"
        ));
        assert_eq!(harness.received(session_a).len(), baseline_a + 1);
        assert!(
            ext_event_frames(harness.received(session_b)).is_empty(),
            "a closed session receives no pushed events"
        );
    }

    #[test]
    fn tray_less_and_unknown_instance_events_are_dropped() {
        let router = ExtensionEventRouter::new();
        let count_delivered = |envelope: ExtensionEnvelope| {
            let mut written = 0usize;
            router.deliver(vec![envelope], &mut |_: &str, _: ServerFrame| {
                written += 1;
                true
            });
            written
        };

        let tray_less = count_delivered(ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: "app-a".to_string(),
                tray_id: None,
                ext: "push".to_string(),
            },
            data: serde_json::json!({ "type": "pushed" }),
        });
        assert_eq!(tray_less, 0, "tray-less envelopes are not events");

        let unknown_instance = count_delivered(ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: "app-a".to_string(),
                tray_id: Some("tray-a".to_string()),
                ext: "push".to_string(),
            },
            data: serde_json::json!({ "type": "pushed" }),
        });
        assert_eq!(
            unknown_instance, 0,
            "events from instances with no recorded owner are dropped"
        );
    }

    #[test]
    fn send_event_rejects_payloads_that_are_not_one_envelope() {
        let mut host = ExtensionEventRouter::new().host(None);
        assert!(host.send_event(b"not json").is_err());
        assert!(host.send_event(b"[]").is_err());
        assert!(host.send_event(b"{}").is_err(), "a scope and data are required");
        // A tray-less envelope is accepted here; delivery drops it, mirroring
        // the returned-events filter.
        assert!(host
            .send_event(br#"{"scope":{"appId":"app-a","ext":"push"},"data":{}}"#)
            .is_ok());
        let events = host.take_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].scope.tray_id, None);
    }

    #[test]
    fn forget_session_releases_only_that_sessions_ownership() {
        let mut router = ExtensionEventRouter::new();
        router.note_loaded(
            LoadedExtension {
                app_id: "app-a".to_string(),
                instance: "push".to_string(),
            },
            "session-1".to_string(),
        );
        router.note_loaded(
            LoadedExtension {
                app_id: "app-b".to_string(),
                instance: "push".to_string(),
            },
            "session-2".to_string(),
        );

        router.forget_session("session-2");

        let mut routed = Vec::new();
        router.deliver(
            vec![
                ExtensionEnvelope {
                    scope: ExtensionScope {
                        app_id: "app-a".to_string(),
                        tray_id: Some("tray-a".to_string()),
                        ext: "push".to_string(),
                    },
                    data: serde_json::json!({ "from": "a" }),
                },
                ExtensionEnvelope {
                    scope: ExtensionScope {
                        app_id: "app-b".to_string(),
                        tray_id: Some("tray-b".to_string()),
                        ext: "push".to_string(),
                    },
                    data: serde_json::json!({ "from": "b" }),
                },
            ],
            &mut |owner, frame| {
                routed.push((owner.to_string(), frame));
                true
            },
        );
        assert_eq!(routed.len(), 1);
        assert_eq!(routed[0].0, "session-1");
    }

    #[test]
    fn failed_load_ext_records_no_ownership() {
        let mut harness = Harness::new();
        let session = harness.open_session();
        // LoadExt against an app the kernel has never created fails; the
        // production loops must not record ownership from an Error response.
        let frames = harness.frame(
            session,
            ClientFrame::LoadExt {
                request_id: "req-load-app-a".to_string(),
                app_id: "app-a".to_string(),
                name: "push".to_string(),
                path: "test://push".to_string(),
                expected_identity: expected_extension_identity(),
                mount_id: None,
            },
        );
        assert!(matches!(
            frames.first(),
            Some(ServerFrame::Error { .. })
        ));

        let mut written = Vec::new();
        harness.router.deliver(
            vec![ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: "app-a".to_string(),
                    tray_id: Some("tray-a".to_string()),
                    ext: "push".to_string(),
                },
                data: serde_json::json!({ "type": "pushed" }),
            }],
            &mut |owner, frame| {
                written.push((owner.to_string(), frame));
                true
            },
        );
        assert!(
            written.is_empty(),
            "a failed LoadExt must not create an owning session"
        );
    }
}
