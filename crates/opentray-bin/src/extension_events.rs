// Session-routed extension event delivery for the production brokers.
//
// Law: `ExtensionHostContext::send_event` is the generic extension ABI push
// channel. Events pushed by an extension instance belong to the client session
// that created that instance (the `LoadExt` sender), not to whichever session
// happens to dispatch a command. When the owning session is gone, pushed
// events are dropped with a broker-log diagnostic instead of leaking into
// another session or stalling the extension call.
//
// D19: pushes from loader-created instances submit source-bound records into
// the same bounded EventHub ingress as native `try_submit` producers, and are
// delivered after the current dispatch's response frames (post-response
// barrier). Drain-side routing validates the tray route against the source's
// host-bound session/app before any `ext-event` frame is constructed.

use std::collections::HashMap;

use opentray_core::{
    AppBackend, BrokerKernel, ExtensionError, ExtensionHostContext, ExtensionLoader,
};
use opentray_spec::{
    AppId, ClientFrame, ExtensionEnvelope, ExtensionScope, ServerFrame, SessionId, TrayId,
};

use crate::event_hub::{
    EventHub, SourceKey, SubmitOutcome, EVENT_DRAIN_MAX_BYTES, EVENT_DRAIN_MAX_RECORDS,
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
                app_id,
                tray_id,
                ext,
                ..
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
                instance: mount_id.clone().unwrap_or_else(|| name.clone()),
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
    /// instance (`ExtCommand`). `hub` is the broker EventHub: when the
    /// dispatched instance has a loader-reserved source, `send_event` submits
    /// a source-bound record to the same bounded ingress as native producers
    /// instead of buffering a private queue. Kernel-initiated calls such as
    /// session cleanup receive a scope-free host; their claimed instance
    /// selects the source, and drain-side tray validation still refuses
    /// foreign or dead routes.
    pub(crate) fn host<'hub>(
        &self,
        dispatch: Option<ExtensionDispatch>,
        hub: Option<&'hub EventHub>,
    ) -> RoutingExtensionHost<'hub> {
        RoutingExtensionHost {
            dispatch,
            hub,
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

    /// Delivers one drained, source-bound record to its owning session. The
    /// source key is host truth: `ext` and `app` come from the loader's
    /// SourceKey, never from event JSON.
    pub(crate) fn deliver_bound(
        &self,
        key: &SourceKey,
        tray_id: &str,
        data: serde_json::Value,
        write: &mut dyn FnMut(&str, ServerFrame) -> bool,
    ) {
        let frame = ServerFrame::ExtEvent {
            app_id: key.app_id.clone(),
            tray_id: tray_id.to_string(),
            ext: key.instance_name.clone(),
            data,
        };
        if !write(&key.owner_session_id, frame) {
            eprintln!(
                "opentray extension event dropped: owning client session {} is closed (source {}/{} generation {})",
                key.owner_session_id, key.app_id, key.instance_name, key.generation
            );
        }
    }
}

/// Owner-loop drain: takes one bounded round-robin quantum from the hub,
/// validates each record's tray route against the source's host-bound
/// session/app, and writes `ext-event` frames to the owning session's
/// ordered channel. Stale, foreign, or revoked routes drop with a
/// source-tagged diagnostic. Re-wakes when drainable work remains.
pub(crate) fn drain_extension_events<B: AppBackend, L: ExtensionLoader>(
    hub: &EventHub,
    router: &ExtensionEventRouter,
    broker: &BrokerKernel<B, L>,
    write: &mut dyn FnMut(&str, ServerFrame) -> bool,
) {
    for record in hub.drain_round_robin(EVENT_DRAIN_MAX_RECORDS, EVENT_DRAIN_MAX_BYTES) {
        let key = &record.key;
        match broker.tray_owner(&key.app_id, &record.tray_id) {
            Some(owner) if owner == key.owner_session_id => {
                match serde_json::from_slice::<serde_json::Value>(&record.data_json) {
                    Ok(data) => router.deliver_bound(key, &record.tray_id, data, write),
                    Err(error) => {
                        // Ingress validated this payload; a parse failure
                        // here is a hub invariant breach. Drop with a
                        // source-tagged diagnostic rather than panicking the
                        // broker loop.
                        hub.note_stale_drop();
                        eprintln!(
                            "opentray extension event dropped: undecodable payload for source {}/{} generation {}: {error}",
                            key.app_id, key.instance_name, key.generation
                        );
                    }
                }
            }
            _ => {
                hub.note_stale_drop();
                eprintln!(
                    "opentray extension event dropped: stale route tray={} not live for source {}/{} generation {} owner {}",
                    record.tray_id,
                    key.app_id,
                    key.instance_name,
                    key.generation,
                    key.owner_session_id
                );
            }
        }
    }
    hub.rewake_if_ready();
}

/// Production `ExtensionHostContext` handed to extension instances: it binds
/// `send_event` pushes to the source-owned EventHub ingress so delivery
/// happens after the current kernel dispatch returns and its response frames
/// are written, keeping kernel reentrancy out of the extension ABI.
pub(crate) struct RoutingExtensionHost<'a> {
    dispatch: Option<ExtensionDispatch>,
    hub: Option<&'a EventHub>,
    events: Vec<ExtensionEnvelope>,
}

impl RoutingExtensionHost<'_> {
    pub(crate) fn take_events(&mut self) -> Vec<ExtensionEnvelope> {
        std::mem::take(&mut self.events)
    }
}

impl ExtensionHostContext for RoutingExtensionHost<'_> {
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
    /// Source binding: the (app, instance) is a host fact — the dispatch
    /// scope during `ExtCommand`, otherwise the claimed instance (contained
    /// by single-session admission while the kernel's cleanup broadcast is
    /// instance-blind). The record carries only the tray route and data;
    /// drain re-validates the route against the source's owner session.
    fn send_event(&mut self, event_json: &[u8]) -> Result<(), ExtensionError> {
        let envelope =
            serde_json::from_slice::<ExtensionEnvelope>(event_json).map_err(|error| {
                ExtensionError::Rejected(format!(
                    "extension event must be one ExtensionEnvelope JSON object: {error}"
                ))
            })?;
        let (app_id, instance, tray_route) = match &self.dispatch {
            Some(dispatch) => (
                dispatch.app_id.clone(),
                dispatch.ext.clone(),
                Some(dispatch.tray_id.clone()),
            ),
            None => (
                envelope.scope.app_id.clone(),
                envelope.scope.ext.clone(),
                envelope.scope.tray_id.clone(),
            ),
        };

        if let Some(hub) = self.hub {
            if let Some(source) = hub.current_source(&app_id, &instance) {
                return submit_source_bound_push(&source, tray_route, envelope.data);
            }
        }

        // Fallback for instances without a loader-reserved source (test and
        // non-dynamic instances): the legacy buffered path with dispatch
        // scope authority.
        let scope = match (&self.dispatch, tray_route) {
            (Some(dispatch), _) => ExtensionScope {
                app_id: dispatch.app_id.clone(),
                tray_id: Some(dispatch.tray_id.clone()),
                ext: dispatch.ext.clone(),
            },
            (None, tray_id) => ExtensionScope {
                app_id: app_id,
                tray_id,
                ext: instance,
            },
        };
        self.events.push(ExtensionEnvelope {
            scope,
            command_scope: None,
            data: envelope.data,
        });
        Ok(())
    }
}

/// Maps one command-time push onto the bounded hub ingress. Backpressure is
/// surfaced to the extension call; a closed source (its own session is
/// closing) drops silently with a diagnostic so cleanup broadcasts cannot
/// abort other instances' session_closed handling.
fn submit_source_bound_push(
    source: &crate::event_hub::SourceHandle,
    tray_route: Option<TrayId>,
    data: serde_json::Value,
) -> Result<(), ExtensionError> {
    let Some(tray_id) = tray_route else {
        // Mirror parity: tray-less envelopes are not `ext-event` frames.
        eprintln!(
            "opentray extension event dropped: source {}/{} pushed an event without a tray route",
            source.key().app_id,
            source.key().instance_name
        );
        return Ok(());
    };
    match source.submit_push(&tray_id, &data) {
        SubmitOutcome::Enqueued | SubmitOutcome::Coalesced | SubmitOutcome::DroppedBestEffort => {
            Ok(())
        }
        SubmitOutcome::Backpressure => Err(ExtensionError::Rejected(format!(
            "event port backpressure: the bounded hub queue for source {}/{} is full; the \
             extension owns bounded retry",
            source.key().app_id,
            source.key().instance_name
        ))),
        SubmitOutcome::Invalid => Err(ExtensionError::Rejected(format!(
            "event port rejected the push payload for source {}/{} (oversized data)",
            source.key().app_id,
            source.key().instance_name
        ))),
        SubmitOutcome::Closed => {
            eprintln!(
                "opentray extension event dropped: source {}/{} is closed (owner session closed, \
                 reload, or hub delivery unavailable)",
                source.key().app_id,
                source.key().instance_name
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use opentray_core::{
        BackendCapabilities, BrokerKernel, BrokerSession, ExtensionHostContext, ExtensionInstance,
        ExtensionLoader, FakeBackend,
    };
    use opentray_spec::{
        AppOptions, BrokerArtifactIdentity, BrokerArtifactTarget, ClientFrame,
        ExpectedExtensionIdentity, ExtensionArtifactTarget, Icon, Menu, MenuItem, ServerFrame,
        TrayOptions, PROTOCOL_VERSION,
    };

    use super::*;
    use crate::event_hub::event_hub_test_support::NoopWake;

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
                command_scope: None,
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
                command_scope: None,
            }
        }

        fn owned_envelope_to(&self, r#type: &str, tray_id: &str) -> ExtensionEnvelope {
            ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: self.app_id.clone(),
                    tray_id: Some(tray_id.to_string()),
                    ext: self.instance.clone(),
                },
                data: serde_json::json!({ "type": r#type }),
                command_scope: None,
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
            _issued: opentray_core::IssuedOperation,
            host: &mut dyn ExtensionHostContext,
        ) -> Result<opentray_core::ExtensionCommandDisposition, ExtensionError> {
            let pushed = self.claimed_envelope("pushed");
            host.send_event(serde_json::to_vec(&pushed).unwrap().as_slice())?;
            Ok(opentray_core::ExtensionCommandDisposition::Immediate(
                vec![ExtensionEnvelope {
                    scope: envelope.scope,
                    command_scope: None,
                    data: serde_json::json!({ "type": "mirrored" }),
                }],
            ))
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

    /// Mirrors the production broker loops: per-frame routing host with the
    /// EventHub, LoadExt ownership recording plus source opening on Ack,
    /// revoke-before-cleanup on close, fallback delivery, and the bounded
    /// hub drain to the owning session's frame channel.
    struct Harness {
        broker: BrokerKernel<FakeBackend, PushLoader>,
        router: ExtensionEventRouter,
        hub: EventHub,
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
                hub: EventHub::new(Box::new(NoopWake)),
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
            let kernel_session_id = self.sessions[index].0.session_id().map(ToOwned::to_owned);
            let loaded = LoadedExtension::from_frame(&frame);
            let mut host = self
                .router
                .host(ExtensionDispatch::from_frame(&frame), Some(&self.hub));
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
                    self.router.note_loaded(loaded.clone(), owner.to_string());
                    // Mirror the loader: every acknowledged dynamic load has
                    // a reserved PENDING source that the ACK opens.
                    let _ = self
                        .hub
                        .reserve_source(loaded.app_id.clone(), loaded.instance.clone());
                    self.hub
                        .note_loaded_and_open(&loaded.app_id, &loaded.instance, owner);
                }
            }
            self.deliver(host.take_events());
            self.drain();
            frames
        }

        fn close(&mut self, index: usize) {
            let closing_session_id = self.sessions[index].0.session_id().map(ToOwned::to_owned);
            // Lifecycle law: revoke the closing session's sources BEFORE core
            // session_closed so its own cleanup pushes observe PORT_CLOSED.
            if let Some(session_id) = closing_session_id.as_deref() {
                self.hub.revoke_session(session_id);
            }
            let mut host = self.router.host(None, Some(&self.hub));
            let _ = self
                .broker
                .close_session_with_extension_host(&mut self.sessions[index].0, &mut host);
            if let Some(session_id) = closing_session_id.as_deref() {
                self.router.forget_session(session_id);
            }
            self.deliver(host.take_events());
            self.drain();
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

        fn drain(&mut self) {
            let mut sessions = std::mem::take(&mut self.sessions);
            drain_extension_events(
                &self.hub,
                &self.router,
                &self.broker,
                &mut |owner, frame| {
                    let mut delivered = false;
                    for (broker_session, received) in sessions.iter_mut() {
                        if broker_session.session_id() == Some(owner) {
                            received.push(frame.clone());
                            delivered = true;
                        }
                    }
                    delivered
                },
            );
            self.sessions = sessions;
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
    fn command_from_a_non_owning_session_is_rejected_before_dispatch() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");
        let session_b = harness.open_session();
        harness.create_app_and_tray(session_b, "app-b");
        harness.load_push(session_b, "app-b");

        // harden-lifecycle-ownership D2: extension commands are scoped to the
        // tray-owning session. A foreign session cannot dispatch — and so can
        // never reach a legacy destroy — through another session's tray. The
        // rejection carries the stable `session-mismatch` code with request
        // correlation, so consumers never parse the human message.
        let frames = harness.ext_command(session_b, "app-a", "tray-a");
        assert!(
            frames.iter().any(|frame| matches!(
                frame,
                ServerFrame::Error {
                    request_id: Some(request_id),
                    code,
                    message,
                    ..
                } if request_id == "req-ext-app-a-tray-a"
                    && code == "session-mismatch"
                    && message.contains("does not own tray")
            )),
            "the non-owning dispatch is rejected with the stable code and request correlation: {frames:?}"
        );
        assert!(
            ext_event_frames(harness.received(session_b)).is_empty(),
            "the rejected dispatcher receives no events"
        );
        assert!(
            ext_event_frames(harness.received(session_a)).is_empty(),
            "the owning session observes nothing from the rejected dispatch"
        );

        // Owner state is unchanged by the rejected dispatch: the owning
        // session still commands its own tray and observes its routing.
        let owner_frames = harness.ext_command(session_a, "app-a", "tray-a");
        assert!(
            matches!(owner_frames.first(), Some(ServerFrame::ExtCommandResult { .. })),
            "the owner still dispatches after the rejection: {owner_frames:?}"
        );
        assert!(
            ext_event_frames(harness.received(session_a))
                .iter()
                .any(|frame| matches!(&frame, ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed")),
            "the owner still receives its pushed events"
        );
    }

    #[test]
    fn owner_command_routes_pushed_events_to_the_owner_and_mirrors_to_the_dispatcher() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");

        // d19 routing law, exercised through the owning dispatcher: pushed
        // events route by ownership; mirrored returned events flow back to
        // the dispatcher in the command response.
        let frames = harness.ext_command(session_a, "app-a", "tray-a");
        assert!(matches!(
            frames.first(),
            Some(ServerFrame::ExtCommandResult { .. })
        ));

        let dispatcher_events = ext_event_frames(harness.received(session_a));
        assert_eq!(
            dispatcher_events.len(),
            2,
            "the owner-dispatcher receives the mirrored and pushed events: {dispatcher_events:?}"
        );
        assert!(
            dispatcher_events
                .iter()
                .any(|frame| matches!(&frame, ServerFrame::ExtEvent { data, .. } if data["type"] == "mirrored"))
                && dispatcher_events
                    .iter()
                    .any(|frame| matches!(&frame, ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed")),
            "both the mirrored (dispatcher copy) and pushed (owner copy) events arrive: {dispatcher_events:?}"
        );
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
        assert_eq!(
            events.len(),
            1,
            "only session A's instance event: {events:?}"
        );
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
            command_scope: None,
        });
        assert_eq!(tray_less, 0, "tray-less envelopes are not events");

        let unknown_instance = count_delivered(ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: "app-a".to_string(),
                tray_id: Some("tray-a".to_string()),
                ext: "push".to_string(),
            },
            data: serde_json::json!({ "type": "pushed" }),
            command_scope: None,
        });
        assert_eq!(
            unknown_instance, 0,
            "events from instances with no recorded owner are dropped"
        );
    }

    #[test]
    fn send_event_rejects_payloads_that_are_not_one_envelope() {
        let mut host = ExtensionEventRouter::new().host(None, None);
        assert!(host.send_event(b"not json").is_err());
        assert!(host.send_event(b"[]").is_err());
        assert!(
            host.send_event(b"{}").is_err(),
            "a scope and data are required"
        );
        // A tray-less envelope is accepted here; delivery drops it, mirroring
        // the returned-events filter.
        assert!(host
            .send_event(br#"{"scope":{"appId":"app-a","ext":"push"},"data":{}}"#)
            .is_ok());
        let events = host.take_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].scope.tray_id, None);
    }

    /// Command pushes are bound to host facts: the delivered frame carries
    /// the dispatch (app, tray) and the source's instance name, never the
    /// envelope's forged scope fields.
    #[test]
    fn source_bound_push_routes_by_host_facts_not_claimed_scope() {
        let mut harness = Harness::new();
        let session = harness.open_session();
        harness.create_app_and_tray(session, "app-a");
        harness.load_push(session, "app-a");

        let frames = harness.ext_command(session, "app-a", "tray-a");
        assert!(matches!(
            frames.first(),
            Some(ServerFrame::ExtCommandResult { .. })
        ));

        let received = harness.received(session);
        let pushed = received
            .iter()
            .find_map(|frame| match frame {
                ServerFrame::ExtEvent {
                    app_id,
                    tray_id,
                    ext,
                    data,
                } if data["type"] == "pushed" => Some((app_id, tray_id, ext)),
                _ => None,
            })
            .expect("pushed event frame");
        // claimed-app/claimed-tray/claimed-ext were all forged; host facts won.
        assert_eq!(
            serde_json::to_value(pushed).unwrap(),
            serde_json::json!(["app-a", "tray-a", "push"])
        );
    }

    /// A scope-free push claiming a foreign session's tray is dropped at
    /// drain with a source-tagged diagnostic; it never crosses sessions.
    #[test]
    fn foreign_tray_routes_drop_at_drain_with_source_tagged_diagnostics() {
        let mut harness = Harness::new();
        let session_a = harness.open_session();
        harness.create_app_and_tray(session_a, "app-a");
        harness.load_push(session_a, "app-a");
        let session_b = harness.open_session();
        harness.create_app_and_tray(session_b, "app-b");
        harness.load_push(session_b, "app-b");
        let baseline_a = harness.received(session_a).len();
        let baseline_b = harness.received(session_b).len();

        // Session A's instance pushes asynchronously, but claims session B's
        // tray (and a nonexistent one) as the route.
        let source = harness
            .hub
            .current_source("app-a", "push")
            .expect("A's source");
        assert_eq!(
            source.submit_push(
                "tray-b",
                &serde_json::json!({ "type": "claimed-foreign-tray" })
            ),
            crate::event_hub::SubmitOutcome::Enqueued
        );
        assert_eq!(
            source.submit_push(
                "tray-missing",
                &serde_json::json!({ "type": "claimed-missing-tray" })
            ),
            crate::event_hub::SubmitOutcome::Enqueued
        );
        harness.drain();

        assert_eq!(
            harness.received(session_a).len(),
            baseline_a,
            "no foreign-routed frame reaches session A"
        );
        assert_eq!(
            harness.received(session_b).len(),
            baseline_b,
            "no foreign-routed frame reaches session B"
        );
        assert_eq!(harness.hub.metrics().dropped_stale, 2);
    }

    /// The response barrier survives unification: command-submitted pushes
    /// drain only after the command's response frames are written, and a
    /// wake-driven drain between commands delivers records in order.
    #[test]
    fn pushed_events_follow_response_frames_and_survive_interleaving() {
        let mut harness = Harness::new();
        let session = harness.open_session();
        harness.create_app_and_tray(session, "app-a");
        harness.load_push(session, "app-a");

        let _ = harness.ext_command(session, "app-a", "tray-a");
        let received = harness.received(session).to_vec();
        let command_index = received
            .iter()
            .position(|frame| matches!(frame, ServerFrame::ExtCommandResult { .. }))
            .expect("command result");
        let pushed_index = received
            .iter()
            .position(|frame| {
                matches!(frame, ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed")
            })
            .expect("pushed event");
        assert!(
            pushed_index > command_index,
            "hub unification keeps the response barrier: {received:?}"
        );

        // An asynchronous (port-like) submission between commands is
        // delivered by the next drain without any command in flight.
        let source = harness.hub.current_source("app-a", "push").expect("source");
        assert_eq!(
            source.submit_push("tray-a", &serde_json::json!({ "type": "idle" })),
            crate::event_hub::SubmitOutcome::Enqueued
        );
        harness.drain();
        let received = harness.received(session);
        assert!(
            received
                .iter()
                .any(|frame| matches!(frame, ServerFrame::ExtEvent { data, .. } if data["type"] == "idle")),
            "idle push delivered without any command: {received:?}"
        );
    }

    /// B4 law (D19 final review): a failed reload must leave the previous
    /// generation current. The loader reserves a fresh generation (PENDING)
    /// and revokes it when the load fails before its ACK; the still-alive
    /// old instance's command-time `send_event` keeps delivering instead of
    /// resolving to the dead new source.
    #[test]
    fn failed_reload_keeps_delivering_the_old_generation_send_event() {
        let mut harness = Harness::new();
        let session = harness.open_session();
        harness.create_app_and_tray(session, "app-a");
        harness.load_push(session, "app-a");
        let old_generation = harness
            .hub
            .current_source("app-a", "push")
            .expect("open source")
            .key()
            .generation;

        // Loader-side failed reload: a fresh generation is reserved and then
        // revoked before its LoadExt ACK could open it.
        let failed = harness
            .hub
            .reserve_source("app-a".to_string(), "push".to_string())
            .expect("reserve");
        assert!(failed.revoke());
        drop(failed);

        // The current mapping still routes to the old OPEN generation.
        let current = harness
            .hub
            .current_source("app-a", "push")
            .expect("old generation stays current");
        assert_eq!(current.key().generation, old_generation);
        drop(current);

        // The old instance's command-time push still delivers end to end.
        let frames = harness.ext_command(session, "app-a", "tray-a");
        assert!(matches!(
            frames.first(),
            Some(ServerFrame::ExtCommandResult { .. })
        ));
        let received = harness.received(session);
        assert!(
            received.iter().any(|frame| matches!(
                frame,
                ServerFrame::ExtEvent { data, .. } if data["type"] == "pushed"
            )),
            "old instance push still delivers after a failed reload: {received:?}"
        );
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
                    command_scope: None,
                },
                ExtensionEnvelope {
                    scope: ExtensionScope {
                        app_id: "app-b".to_string(),
                        tray_id: Some("tray-b".to_string()),
                        ext: "push".to_string(),
                    },
                    data: serde_json::json!({ "from": "b" }),
                    command_scope: None,
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
        assert!(matches!(frames.first(), Some(ServerFrame::Error { .. })));

        let mut written = Vec::new();
        harness.router.deliver(
            vec![ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: "app-a".to_string(),
                    tray_id: Some("tray-a".to_string()),
                    ext: "push".to_string(),
                },
                data: serde_json::json!({ "type": "pushed" }),
                command_scope: None,
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
