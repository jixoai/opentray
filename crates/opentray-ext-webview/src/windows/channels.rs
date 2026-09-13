//! Message-channel transport for the Windows WebView2 runtime
//! (add-webview-orchestration D9-D11, D20, task 4.2).
//!
//! The platform-neutral registry/lifecycle core lives in
//! [`crate::channels`]; this module is its WebView2 wiring, mirroring the
//! macOS bridge transport:
//!
//! - page-originated commands arrive through the per-webview ipc handler
//!   (`WebMessageReceived` under wry), whose transport supplies the source
//!   webview id — the page cannot spoof it;
//! - broker-to-page pushes (`channelCreated` / `channelMessage` /
//!   `channelClosed` bridge scripts) are dispatched per target view through
//!   `ExecuteScript`, held back until the target's document finished
//!   loading;
//! - host-bound observations never arrive here — the pure registry routes
//!   them to the host outbox, flushed with the command response
//!   (`HandledCommand::channel_events`).

use std::cell::RefCell;
use std::rc::Rc;

use serde_json::{json, Value};

use opentray_spec::channel::{ChannelCloseReason, ChannelEndpointSide, ChannelFrame, ChannelPeer};
use opentray_spec::webview::{OrchestrationErrorCode, WebviewOwnerTuple};

use crate::channels::{ChannelPush, ChannelRequest, ChannelSender};
use crate::orchestration::OrchestrationError;
use crate::WebviewRuntimeError;

use super::{evaluate_bridge_script, NavigatorWindowBridge, WINDOW_INTERNALS_GLOBAL};

/// Host-facade channel command dispatch (D9-D20, frozen `channel.*` wire
/// tags). The runtime resolves the addressed session's bridge
/// (`session_for_owner`) and delegates here. The response data is the
/// frozen result frame; typed rejections return the `channel.error`
/// envelope as Ok-data, mirroring the orchestration convention (the
/// extension ABI's error channel cannot carry the typed registry). Push
/// effects are delivered inline: page-bound through the bridge script
/// (`ExecuteScript`), host-bound through the response flush
/// (`SessionChannels::drain_host_events` via
/// `HandledCommand::channel_events`).
pub(super) fn dispatch_host_channel_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    request: ChannelRequest,
) -> Result<Value, WebviewRuntimeError> {
    use crate::channels::ChannelRequest as Request;
    use opentray_spec::channel::ChannelFrame;

    let owner = request.owner().clone();
    let registry = bridge.borrow().channels.clone();
    let sender = ChannelSender::Host;

    let result = match request {
        Request::Create { ref target, .. } => {
            // Authority (D10/D20): the target must be a live webview of
            // this session whose bridge policy enables message channels;
            // validation precedes any channel state.
            if let Some(error) = channel_target_error(bridge, target) {
                return Ok(channel_error_frame(
                    &owner,
                    error.code(),
                    error.envelope.error.message,
                ));
            }
            let created = registry.borrow_mut().create(
                &owner,
                ChannelPeer::host(),
                target.clone(),
            );
            match created {
                Ok((channel_id, push)) => {
                    deliver_channel_pushes(bridge, std::slice::from_ref(&push), None);
                    ChannelFrame::CreateResult { owner, channel_id }
                }
                Err(error) => {
                    return Ok(channel_error_frame(
                        &owner,
                        error.code(),
                        error.envelope.error.message,
                    ))
                }
            }
        }
        Request::Post {
            ref channel_id,
            ref payload,
            ..
        } => {
            let outcome = registry.borrow_mut().post(&owner, sender, channel_id, payload.clone());
            match outcome {
                Ok(receipt) => {
                    drain_channel_port_for(
                        bridge,
                        channel_id,
                        &receipt.recipient,
                        receipt.endpoint,
                    );
                    ChannelFrame::PostResult { owner }
                }
                Err(failure) => {
                    deliver_channel_pushes(bridge, &failure.pushes, None);
                    return Ok(channel_error_frame(
                        &owner,
                        failure.error.code(),
                        failure.error.envelope.error.message,
                    ));
                }
            }
        }
        Request::Close { ref channel_id, .. } => {
            let outcome = registry.borrow_mut().close(&owner, sender, channel_id);
            match outcome {
                Ok(pushes) => {
                    deliver_channel_pushes(bridge, &pushes, None);
                    ChannelFrame::CloseResult { owner }
                }
                Err(error) => {
                    return Ok(channel_error_frame(
                        &owner,
                        error.code(),
                        error.envelope.error.message,
                    ))
                }
            }
        }
        Request::Destroy { ref channel_id, .. } => {
            let outcome = registry.borrow_mut().destroy(&owner, sender, channel_id);
            match outcome {
                Ok(pushes) => {
                    deliver_channel_pushes(bridge, &pushes, None);
                    ChannelFrame::DestroyResult { owner }
                }
                Err(error) => {
                    return Ok(channel_error_frame(
                        &owner,
                        error.code(),
                        error.envelope.error.message,
                    ))
                }
            }
        }
        Request::List { .. } => match registry.borrow().list_for_host(&owner) {
            Ok(channels) => ChannelFrame::ListResult { owner, channels },
            Err(error) => {
                return Ok(channel_error_frame(
                    &owner,
                    error.code(),
                    error.envelope.error.message,
                ))
            }
        },
    };
    serde_json::to_value(result)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

/// Page-originated message-channel commands (D9/D11/D20). The transport
/// supplies the source webview id — the page cannot spoof it — and every
/// command requires the source view's frozen bridge policy to enable
/// message channels, so a raw `window.ipc.postMessage` from a bridgeless
/// page (which never received the surface) rejects as `bridge_required`.
/// Typed rejections carry the frozen `{ error: { code, message } }`
/// envelope body to the page promise.
pub(super) fn dispatch_webview_channel_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    source_webview: &str,
    cmd: &str,
    payload: Value,
) -> Result<Value, OrchestrationError> {
    let (registry, owner) = {
        let state = bridge.borrow();
        let source_policy = state
            .views
            .iter()
            .find(|view| view.id == source_webview)
            .map(|view| view.policy.message_channels)
            .unwrap_or(false);
        if !source_policy {
            return Err(OrchestrationError::new(
                OrchestrationErrorCode::BridgeRequired,
                format!("webview {source_webview} has no message-channel page bridge"),
            ));
        }
        let registry = Rc::clone(&state.channels);
        let owner = state.channels.borrow().owner_tuple();
        (registry, owner)
    };
    let Some(owner) = owner else {
        return Err(OrchestrationError::new(
            OrchestrationErrorCode::SessionScope,
            "message channels require an attributed window session",
        ));
    };
    let sender = ChannelSender::Page(source_webview);

    match cmd {
        "createMessageChannel" => {
            let target = payload
                .get("target")
                .and_then(Value::as_str)
                .filter(|target| !target.is_empty())
                .ok_or_else(|| {
                    OrchestrationError::new(
                        OrchestrationErrorCode::UnknownView,
                        "createMessageChannel requires a target webview id",
                    )
                })?
                .to_string();
            // Same creation authority as the host path: the target must be
            // a live webview with the channel bridge.
            if let Some(error) = channel_target_error(bridge, &target) {
                return Err(error);
            }
            let created = registry
                .borrow_mut()
                .create(&owner, ChannelPeer::webview(source_webview), target);
            match created {
                Ok((channel_id, push)) => {
                    deliver_channel_pushes(bridge, std::slice::from_ref(&push), None);
                    Ok(json!({ "channelId": channel_id }))
                }
                Err(error) => Err(error),
            }
        }
        "postMessage" => {
            let channel_id = required_channel_id(&payload)?;
            let message = payload.get("payload").cloned().unwrap_or(Value::Null);
            let outcome = registry.borrow_mut().post(&owner, sender, &channel_id, message);
            match outcome {
                Ok(receipt) => {
                    drain_channel_port_for(
                        bridge,
                        &channel_id,
                        &receipt.recipient,
                        receipt.endpoint,
                    );
                    Ok(Value::Null)
                }
                Err(failure) => {
                    deliver_channel_pushes(bridge, &failure.pushes, None);
                    Err(failure.error)
                }
            }
        }
        "closeMessageChannel" => {
            let channel_id = required_channel_id(&payload)?;
            match registry.borrow_mut().close(&owner, sender, &channel_id) {
                Ok(pushes) => {
                    deliver_channel_pushes(bridge, &pushes, None);
                    Ok(Value::Null)
                }
                Err(error) => Err(error),
            }
        }
        "destroyMessageChannel" => {
            let channel_id = required_channel_id(&payload)?;
            match registry.borrow_mut().destroy(&owner, sender, &channel_id) {
                Ok(pushes) => {
                    deliver_channel_pushes(bridge, &pushes, None);
                    Ok(Value::Null)
                }
                Err(error) => Err(error),
            }
        }
        "listMessageChannels" => {
            let listed = registry.borrow().list_for_page(&owner, source_webview)?;
            Ok(json!({ "channels": listed }))
        }
        other => Err(OrchestrationError::new(
            OrchestrationErrorCode::UnknownView,
            format!("unsupported channel command: {other}"),
        )),
    }
}

fn required_channel_id(payload: &Value) -> Result<String, OrchestrationError> {
    payload
        .get("channelId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            OrchestrationError::new(
                OrchestrationErrorCode::UnknownView,
                "the channel command requires a channelId",
            )
        })
}

/// Frozen `channel.error` frame as the command response data (typed
/// channel rejections are Ok-data, like orchestration rejections).
pub(super) fn channel_error_frame(
    owner: &WebviewOwnerTuple,
    code: OrchestrationErrorCode,
    message: impl Into<String>,
) -> Value {
    serde_json::to_value(ChannelFrame::Error {
        owner: owner.clone(),
        error: opentray_spec::webview::WebviewErrorBody {
            code,
            message: message.into(),
        },
    })
    .unwrap_or(Value::Null)
}

/// Creation authority (D10/D20) resolved against the live bridge views:
/// the target must exist (`unknown_view`) and carry the frozen
/// message-channel bridge policy (`bridge_required`). Returns before any
/// channel state exists.
pub(super) fn channel_target_error(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    target: &str,
) -> Option<OrchestrationError> {
    let state = bridge.borrow();
    let view = state.views.iter().find(|view| view.id == target);
    let Some(view) = view else {
        return Some(OrchestrationError::new(
            OrchestrationErrorCode::UnknownView,
            format!("webview id {target} is not registered in this window session"),
        ));
    };
    if !view.policy.message_channels {
        return Some(OrchestrationError::new(
            OrchestrationErrorCode::BridgeRequired,
            format!("webview {target} has no message-channel page bridge"),
        ));
    }
    None
}

/// Bridge scripts for the page-side channel surface entry points. The
/// arguments are JSON-encoded so arbitrary payloads ride safely.
fn channel_created_script(channel_id: &str) -> String {
    format!(
        "{WINDOW_INTERNALS_GLOBAL}.channelCreated({});",
        serde_json::to_string(channel_id).unwrap_or_else(|_| "\"\"".to_string())
    )
}

fn channel_message_script(channel_id: &str, payload: &Value) -> String {
    let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
    format!(
        "{WINDOW_INTERNALS_GLOBAL}.channelMessage({}, {payload_json});",
        serde_json::to_string(channel_id).unwrap_or_else(|_| "\"\"".to_string())
    )
}

fn channel_closed_script(channel_id: &str, reason: ChannelCloseReason) -> String {
    format!(
        "{WINDOW_INTERNALS_GLOBAL}.channelClosed({}, {});",
        serde_json::to_string(channel_id).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(reason.as_str()).unwrap_or_else(|_| "\"explicit\"".to_string())
    )
}

/// Delivers channel pushes to pages: `Created`/`Closed` become bridge
/// scripts targeted at the endpoint's view — immediately when the view's
/// document is live, held back until its page finishes loading otherwise.
/// Host observations never arrive here (the pure registry routes them to
/// the host outbox). Pushes for views that no longer exist are dropped:
/// their channels closed with them.
pub(super) fn deliver_channel_pushes(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    pushes: &[ChannelPush],
    skip_view: Option<&str>,
) {
    for push in pushes {
        let (view, script) = match push {
            ChannelPush::Created {
                target_view,
                channel_id,
            } => (target_view.clone(), channel_created_script(channel_id)),
            ChannelPush::Closed {
                view,
                channel_id,
                reason,
            } => {
                if Some(view.as_str()) == skip_view {
                    continue;
                }
                (view.clone(), channel_closed_script(channel_id, *reason))
            }
        };
        evaluate_channel_script_for_view(bridge, &view, script);
    }
}

/// Evaluates one bridge script in a view when its page is live; queues it
/// for the page-load flush otherwise. A view that is gone drops the
/// script silently (its document cannot receive anything).
fn evaluate_channel_script_for_view(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    view_id: &str,
    script: String,
) {
    let live = {
        let state = bridge.borrow();
        if !state.views.iter().any(|view| view.id == view_id) {
            return;
        }
        state.channel_live_views.contains(view_id)
    };
    if live {
        if let Err(error) = evaluate_bridge_script(bridge, Some(view_id), script) {
            eprintln!("opentray-ext-webview channel push failed: {error}");
        }
    } else {
        bridge
            .borrow_mut()
            .pending_channel_pushes
            .entry(view_id.to_string())
            .or_default()
            .push(script);
    }
}

/// Drains the receiving port of a just-delivered message straight into the
/// recipient page (FIFO push; the queue bounds still applied at enqueue).
/// Host-recipient queues are left for the response flush.
pub(super) fn drain_channel_port_for(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    channel_id: &str,
    recipient: &ChannelPeer,
    endpoint: ChannelEndpointSide,
) {
    let ChannelPeer::Webview(view) = recipient else {
        return;
    };
    if !bridge.borrow().channel_live_views.contains(view.as_str()) {
        return;
    }
    let owner = bridge.borrow().channels.borrow().owner_tuple();
    let Some(owner) = owner else {
        return;
    };
    let messages = bridge
        .borrow_mut()
        .channels
        .borrow_mut()
        .drain_port(&owner, channel_id, endpoint)
        .ok()
        .flatten()
        .unwrap_or_default();
    for payload in messages {
        let script = channel_message_script(channel_id, &payload);
        if let Err(error) = evaluate_bridge_script(bridge, Some(view), script) {
            eprintln!("opentray-ext-webview channel delivery failed: {error}");
        }
    }
}

/// Page-load Started hook (D11): after the view's first load, every
/// navigation closes its page-side endpoints with `document_navigated`
/// and drops pushes held for the outgoing document (messages are never
/// replayed into the new document).
pub(super) fn handle_view_channel_navigation_started(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    view_id: &str,
) {
    let is_navigation = {
        let mut state = bridge.borrow_mut();
        state.channel_live_views.remove(view_id);
        let first_load = !state.channel_loaded_views.contains(view_id);
        if first_load {
            // Still the initial load of a freshly created view.
            return;
        }
        state.pending_channel_pushes.remove(view_id);
        true
    };
    if is_navigation {
        let pushes = bridge
            .borrow_mut()
            .channels
            .borrow_mut()
            .close_channels_of_webview(view_id, ChannelCloseReason::DocumentNavigated);
        deliver_channel_pushes(bridge, &pushes, Some(view_id));
    }
}

/// Page-load Finished hook: the document can now consume pushes — flush
/// everything held back for it, then drain its ports in FIFO order.
pub(super) fn handle_view_channel_page_finished(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    view_id: &str,
) {
    let pending: Vec<String> = {
        let mut state = bridge.borrow_mut();
        state.channel_loaded_views.insert(view_id.to_string());
        state.channel_live_views.insert(view_id.to_string());
        state.pending_channel_pushes.remove(view_id).unwrap_or_default()
    };
    for script in pending {
        if let Err(error) = evaluate_bridge_script(bridge, Some(view_id), script) {
            eprintln!("opentray-ext-webview channel flush failed: {error}");
        }
    }
    let messages = bridge
        .borrow_mut()
        .channels
        .borrow_mut()
        .drain_view_ports(view_id);
    for (channel_id, payload) in messages {
        let script = channel_message_script(&channel_id, &payload);
        if let Err(error) = evaluate_bridge_script(bridge, Some(view_id), script) {
            eprintln!("opentray-ext-webview channel delivery failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestration::ViewEvents;
    use opentray_spec::webview::WebviewBridgePolicy;
    use serde_json::json;
    use std::collections::{HashMap, HashSet, VecDeque};
    use std::ptr::NonNull;

    use super::super::{
        PageCapabilityAccess, PageSourceState, WebViewBridgeView, WebviewContentDescriptor,
        WindowMetadataState, WindowSizeConstraints, WindowStyleState,
    };
    use crate::layout::WindowLayoutState;
    use crate::orchestration::WindowOwner;
    use crate::{
        MetadataSyncSettings, NavigatorScreenSettings, NavigatorTraySettings,
        NavigatorWindowSettings, WebviewBrowserPermissionPolicy, WebviewDownloadSettings,
        WebviewNativeApiPolicy, WebviewPermissionManagerPolicy, WebviewWindowBackground,
        WebviewWindowControlsOverlaySettings,
    };

    fn channel_window_owner() -> WindowOwner {
        WindowOwner {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: Some("session-1".to_string()),
            window_id: "win-1".to_string(),
        }
    }

    fn channel_owner_tuple() -> WebviewOwnerTuple {
        WebviewOwnerTuple {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
        }
    }

    /// Minimal bridge fixture for the pure channel surfaces: no native
    /// window (hwnd 0), views carry dangling wry pointers that are never
    /// evaluated (no view is page-live in these tests — pushes queue in
    /// `pending_channel_pushes` instead).
    fn channel_test_bridge() -> Rc<RefCell<NavigatorWindowBridge>> {
        let mut bridge = NavigatorWindowBridge {
            hwnd: std::ptr::null_mut(),
            window: None,
            views: Vec::new(),
            layout: WindowLayoutState::default(),
            boxes: HashMap::new(),
            event_core: std::rc::Weak::new(),
            focus_tracker: std::rc::Weak::new(),
            content_descriptor: WebviewContentDescriptor::DefaultHtml,
            ipc_messages: VecDeque::new(),
            permission_messages: VecDeque::new(),
            tray_id: "tray-1".to_string(),
            port_state: std::sync::Arc::new(crate::event_port::InstancePortState::new()),
            window_event_subscriptions: HashSet::new(),
            next_ipc_message_id: 1,
            next_permission_message_id: 1,
            style: WindowStyleState {
                app_mode: false,
                frameless: false,
                resizable: true,
                resizable_override: None,
                keep_on_top: false,
                auto_hide: true,
                opacity: 1.0,
                background: WebviewWindowBackground::Opaque,
                platform: super::super::WindowPlatformStyleState {
                    windows: super::super::WindowsWindowStyleState {
                        corner_preference: None,
                    },
                },
            },
            window_controls_overlay: WebviewWindowControlsOverlaySettings::default(),
            navigator_window: NavigatorWindowSettings::default(),
            navigator_screen: NavigatorScreenSettings::default(),
            navigator_tray: NavigatorTraySettings::default(),
            metadata: WindowMetadataState {
                title: "OpenTray".to_string(),
                icon: None,
                native_icon: None,
                sync_title: MetadataSyncSettings::default(),
                sync_icon: MetadataSyncSettings::default(),
            },
            devtools_enabled: false,
            download: WebviewDownloadSettings::default(),
            native_api_policy: WebviewNativeApiPolicy::default(),
            browser_permission_policy: WebviewBrowserPermissionPolicy::default(),
            permission_manager_policy: WebviewPermissionManagerPolicy::default(),
            page_source: PageSourceState::default(),
            page_access: PageCapabilityAccess::default(),
            tray_bounds: None,
            size_constraints: WindowSizeConstraints::default(),
            channels: Rc::new(RefCell::new(crate::channels::SessionChannels::new(
                channel_window_owner(),
            ))),
            channel_loaded_views: HashSet::new(),
            channel_live_views: HashSet::new(),
            pending_channel_pushes: HashMap::new(),
        };
        for (id, policy) in [
            (
                "toolbar",
                WebviewBridgePolicy {
                    webview_id: true,
                    message_channels: true,
                    ..WebviewBridgePolicy::default()
                },
            ),
            (
                "sidebar",
                WebviewBridgePolicy {
                    message_channels: true,
                    ..WebviewBridgePolicy::default()
                },
            ),
            ("content", WebviewBridgePolicy::default()),
        ] {
            bridge.views.push(WebViewBridgeView::new(
                id,
                policy,
                NonNull::dangling(),
                Rc::new(RefCell::new(ViewEvents::new(id, WebviewBridgePolicy::default()))),
            ));
        }
        Rc::new(RefCell::new(bridge))
    }

    fn dispatch_channel(
        bridge: &Rc<RefCell<NavigatorWindowBridge>>,
        source: &str,
        cmd: &str,
        payload: Value,
    ) -> Result<Value, OrchestrationError> {
        dispatch_webview_channel_command(bridge, source, cmd, payload)
    }

    /// Bridge policy and target authority (mirrors the macOS page-surface
    /// test): bridgeless source/target and unknown targets reject typed
    /// with zero partial channel state.
    #[test]
    fn page_channel_commands_enforce_bridge_policy_and_target_authority() {
        let bridge = channel_test_bridge();

        // A bridgeless page (raw ipc without the surface) rejects with the
        // typed bridge_required code.
        let error = dispatch_channel(
            &bridge,
            "content",
            "createMessageChannel",
            json!({ "target": "toolbar" }),
        )
        .expect_err("bridgeless source");
        assert_eq!(error.code(), OrchestrationErrorCode::BridgeRequired);

        // Unknown target rejects unknown_view with zero channel state.
        let error = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "missing" }),
        )
        .expect_err("unknown target");
        assert_eq!(error.code(), OrchestrationErrorCode::UnknownView);

        // The host cannot be targeted: "host" is not a webview id.
        let error = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "host" }),
        )
        .expect_err("host is not targetable");
        assert_eq!(error.code(), OrchestrationErrorCode::UnknownView);

        // A bridgeless target rejects bridge_required.
        let error = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "content" }),
        )
        .expect_err("bridgeless target");
        assert_eq!(error.code(), OrchestrationErrorCode::BridgeRequired);

        // The registry stayed empty through every rejection.
        assert!(
            bridge
                .borrow()
                .channels
                .borrow()
                .list_for_host(&channel_owner_tuple())
                .unwrap()
                .is_empty(),
            "rejections leave zero partial state"
        );
    }

    /// A page-created channel posts page-to-page; the created push queues
    /// for the not-yet-live target and messages stay on the target port
    /// until its page consumes them. The page list never leaks peer ids.
    #[test]
    fn page_created_channel_posts_page_to_page_with_pending_delivery() {
        use opentray_spec::channel::ChannelEndpointSide;

        let bridge = channel_test_bridge();

        // Page a creates a channel to sibling page b (D10: in-session
        // creation is legal for bridged pages).
        let created = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "sidebar" }),
        )
        .expect("page-created channel");
        let channel_id = created["channelId"].as_str().unwrap().to_string();

        // The created push for the target page is held back until the
        // target finished its first page load (never in this fixture).
        let pending = bridge.borrow();
        assert_eq!(
            pending.pending_channel_pushes.get("sidebar").map(Vec::len),
            Some(1),
            "the created push queues for the not-yet-live page"
        );
        assert!(pending
            .pending_channel_pushes
            .get("sidebar")
            .is_some_and(|scripts| scripts[0].contains("channelCreated")));
        drop(pending);

        // The creator posts; the message lands on the target port and stays
        // queued while the target page is not consuming.
        dispatch_channel(
            &bridge,
            "toolbar",
            "postMessage",
            json!({ "channelId": channel_id, "payload": "first" }),
        )
        .expect("page post");
        dispatch_channel(
            &bridge,
            "toolbar",
            "postMessage",
            json!({ "channelId": channel_id, "payload": { "type": "navigate" } }),
        )
        .expect("json post");
        assert_eq!(
            bridge
                .borrow()
                .channels
                .borrow()
                .port_len(&channel_id, ChannelEndpointSide::Target),
            Some(2)
        );

        // Page-visible list: the creator sees exactly its participating
        // channel with side labels only.
        let listed = dispatch_channel(&bridge, "toolbar", "listMessageChannels", json!({}))
            .expect("page list");
        let listed = listed["channels"].as_array().unwrap().clone();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["channelId"], json!(channel_id));
        assert_eq!(listed[0]["state"], json!("open"));
        assert_eq!(
            listed[0]["endpoints"],
            json!([{ "side": "creator" }, { "side": "target" }]),
            "peer webview ids never leak to pages"
        );
    }

    /// The target endpoint posts back (page-to-page direction), a
    /// non-participant rejects, graceful close retains the tombstone with
    /// its reason, and destroy reaps it silently.
    #[test]
    fn page_target_endpoint_posts_back_and_closes() {
        use opentray_spec::channel::ChannelEndpointSide;

        let bridge = channel_test_bridge();
        let owner = channel_owner_tuple();
        let created = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "sidebar" }),
        )
        .expect("channel");
        let channel_id = created["channelId"].as_str().unwrap().to_string();

        // The target endpoint posts back: the message lands on the creator
        // port (page-to-page direction).
        dispatch_channel(
            &bridge,
            "sidebar",
            "postMessage",
            json!({ "channelId": channel_id, "payload": "back" }),
        )
        .expect("target posts back");
        assert_eq!(
            bridge
                .borrow()
                .channels
                .borrow()
                .port_len(&channel_id, ChannelEndpointSide::Creator),
            Some(1)
        );

        // The bridgeless page holds no endpoints: bridge_required at the
        // policy gate (its surface was never injected).
        let error = dispatch_channel(
            &bridge,
            "content",
            "postMessage",
            json!({ "channelId": channel_id, "payload": "x" }),
        )
        .expect_err("non-participant");
        assert_eq!(error.code(), OrchestrationErrorCode::BridgeRequired);

        // Graceful close from a participant; the tombstone keeps its reason
        // in the page list until destroy reaps it.
        dispatch_channel(
            &bridge,
            "sidebar",
            "closeMessageChannel",
            json!({ "channelId": channel_id }),
        )
        .expect("close");
        let listed = dispatch_channel(&bridge, "toolbar", "listMessageChannels", json!({}))
            .expect("list");
        assert_eq!(listed["channels"][0]["state"], json!("closed"));
        assert_eq!(listed["channels"][0]["reason"], json!("explicit"));

        // Posting on the closed channel is the typed not_open rejection.
        let error = dispatch_channel(
            &bridge,
            "toolbar",
            "postMessage",
            json!({ "channelId": channel_id, "payload": "x" }),
        )
        .expect_err("closed channel");
        assert_eq!(error.code(), OrchestrationErrorCode::NotOpen);

        // Destroy reaps the tombstone silently.
        dispatch_channel(
            &bridge,
            "toolbar",
            "destroyMessageChannel",
            json!({ "channelId": channel_id }),
        )
        .expect("destroy");
        let listed = dispatch_channel(&bridge, "toolbar", "listMessageChannels", json!({}))
            .expect("list");
        assert_eq!(listed["channels"].as_array().map(Vec::len), Some(0));
        assert_eq!(
            bridge
                .borrow()
                .channels
                .borrow()
                .list_for_host(&owner)
                .unwrap()
                .len(),
            0
        );
    }

    /// The page-load state machine discriminates the initial load from a
    /// document navigation: only the latter closes channels
    /// (`document_navigated`), and held pushes for the replaced document
    /// are dropped.
    #[test]
    fn channel_page_load_state_discriminates_document_navigation() {
        let bridge = channel_test_bridge();
        let owner = channel_owner_tuple();
        let created = dispatch_channel(
            &bridge,
            "toolbar",
            "createMessageChannel",
            json!({ "target": "sidebar" }),
        )
        .expect("channel");
        let channel_id = created["channelId"].as_str().unwrap().to_string();

        // The target's very first Started is the initial load, not a
        // navigation: the channel survives.
        handle_view_channel_navigation_started(&bridge, "sidebar");
        assert!(
            bridge
                .borrow()
                .channels
                .borrow()
                .list_for_host(&owner)
                .unwrap()
                .iter()
                .all(|entry| entry.state == opentray_spec::channel::ChannelState::Open)
        );

        // Drop the held created push before Finished: this fixture's view
        // pointer is dangling, and a live flush would evaluate the script
        // through it synchronously (the macOS mirror survives this via
        // run-loop semantics; EvaluateScript dereferences immediately).
        // The flush/liveness state machine itself stays under assertion.
        bridge.borrow_mut().pending_channel_pushes.remove("sidebar");
        // Finished makes the page live (held pushes would flush here).
        handle_view_channel_page_finished(&bridge, "sidebar");
        assert!(bridge.borrow().channel_live_views.contains("sidebar"));

        // A later Started is a document navigation: the channel closes with
        // document_navigated and the creator page observes once.
        handle_view_channel_navigation_started(&bridge, "sidebar");
        let listed = bridge
            .borrow()
            .channels
            .borrow()
            .list_for_host(&owner)
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].state, opentray_spec::channel::ChannelState::Closed);
        assert_eq!(
            listed[0].reason,
            Some(opentray_spec::channel::ChannelCloseReason::DocumentNavigated)
        );
        // Pending pushes for the navigating document are dropped with it.
        assert!(
            bridge
                .borrow()
                .pending_channel_pushes
                .get("sidebar")
                .is_none()
                || bridge
                    .borrow()
                    .pending_channel_pushes
                    .get("sidebar")
                    .is_some_and(|scripts| scripts.is_empty())
        );
        // The creator page's close observation queued for its own delivery.
        let toolbar_pending = bridge
            .borrow()
            .pending_channel_pushes
            .get("toolbar")
            .cloned()
            .unwrap_or_default();
        assert!(
            toolbar_pending
                .iter()
                .any(|script| script.contains("channelClosed")
                    && script.contains("document_navigated")),
            "the surviving endpoint observes the navigation closure: {toolbar_pending:?}"
        );
        // Messages are never replayed into the new document.
        let error = dispatch_channel(
            &bridge,
            "toolbar",
            "postMessage",
            json!({ "channelId": channel_id, "payload": "x" }),
        )
        .expect_err("closed by navigation");
        assert_eq!(error.code(), OrchestrationErrorCode::NotOpen);
    }

    /// Host command-surface smoke (mirrors the macOS runtime smoke; the
    /// Win32 window session itself cannot be created inside the
    /// cargo-test harness — access violation — so the runtime's
    /// `handle_channel` delegates here after resolving the session
    /// bridge). Every frozen frame round-trips, authority rejections
    /// return typed envelopes as Ok-data, host observations ride the
    /// response flush (`drain_host_events`), and the peer-teardown /
    /// session-close destroy entrances sweep with their reasons.
    #[test]
    fn host_channel_commands_round_trip_all_frames() {
        use crate::channels::ChannelRequest;

        let bridge = channel_test_bridge();
        let owner = channel_owner_tuple();

        fn host_command(
            bridge: &Rc<RefCell<NavigatorWindowBridge>>,
            request: ChannelRequest,
        ) -> Value {
            dispatch_host_channel_command(bridge, request).expect("host channel command")
        }

        // Host creates a channel to the bridged toolbar.
        let created = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "toolbar".to_string(),
            },
        );
        assert_eq!(created["type"], "channel.create-result");
        let channel_id = created["channelId"].as_str().unwrap().to_string();
        assert!(!channel_id.is_empty());
        // The created push queues for the not-yet-live target page.
        assert!(
            bridge
                .borrow()
                .pending_channel_pushes
                .get("toolbar")
                .is_some_and(|scripts| scripts.len() == 1
                    && scripts[0].contains("channelCreated")),
            "the created push is held back for the target's first page load"
        );

        // Authority rejections are typed envelopes as Ok-data with zero state.
        let rejected = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "content".to_string(),
            },
        );
        assert_eq!(rejected["type"], "channel.error");
        assert_eq!(rejected["error"]["code"], "bridge_required");
        let rejected = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "missing".to_string(),
            },
        );
        assert_eq!(rejected["error"]["code"], "unknown_view");
        // The host cannot be targeted: "host" is not a webview id.
        let rejected = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "host".to_string(),
            },
        );
        assert_eq!(rejected["error"]["code"], "unknown_view");
        // Cross-session owner tuples reject session_scope.
        let rejected = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: WebviewOwnerTuple {
                    app_id: "app-1".to_string(),
                    tray_id: "tray-1".to_string(),
                    session_id: "session-2".to_string(),
                },
                target: "toolbar".to_string(),
            },
        );
        assert_eq!(rejected["error"]["code"], "session_scope");

        // JSON payloads post without string coercion; posting on an unknown
        // channel is the typed unknown-channel rejection (unknown_view).
        let posted = host_command(
            &bridge,
            ChannelRequest::Post {
                owner: owner.clone(),
                channel_id: channel_id.clone(),
                payload: json!({ "type": "navigate", "url": "https://example.com" }),
            },
        );
        assert_eq!(posted["type"], "channel.post-result");
        let rejected = host_command(
            &bridge,
            ChannelRequest::Post {
                owner: owner.clone(),
                channel_id: "ch-nonexistent".to_string(),
                payload: json!("x"),
            },
        );
        assert_eq!(rejected["error"]["code"], "unknown_view");

        // The host list shows the live channel with full endpoint descriptors.
        let listed = host_command(&bridge, ChannelRequest::List { owner: owner.clone() });
        assert_eq!(listed["type"], "channel.list-result");
        let channels = listed["channels"].as_array().unwrap().clone();
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0]["channelId"], json!(channel_id));
        assert_eq!(channels[0]["state"], "open");
        assert_eq!(
            channels[0]["endpoints"],
            json!([{ "side": "creator", "peer": "host" }, { "side": "target", "peer": "toolbar" }])
        );

        // Graceful close: both endpoints observe exactly once — the host
        // observation rides the response flush (drain_host_events is the
        // exact function the runtime's flush calls).
        let closed = host_command(
            &bridge,
            ChannelRequest::Close {
                owner: owner.clone(),
                channel_id: channel_id.clone(),
            },
        );
        assert_eq!(closed["type"], "channel.close-result");
        let host_events = bridge.borrow_mut().channels.borrow_mut().drain_host_events();
        assert!(
            host_events.iter().any(|(_, value)| {
                value["type"] == "channel.closed"
                    && value["channelId"] == json!(channel_id)
                    && value["reason"] == "explicit"
            }),
            "the host closure observation rides the response flush"
        );
        // The tombstone stays listed with its reason.
        let listed = host_command(&bridge, ChannelRequest::List { owner: owner.clone() });
        assert_eq!(listed["channels"][0]["state"], "closed");
        assert_eq!(listed["channels"][0]["reason"], "explicit");

        // Destroy reaps the tombstone; repeat destroys are no-op successes.
        let destroyed = host_command(
            &bridge,
            ChannelRequest::Destroy {
                owner: owner.clone(),
                channel_id: channel_id.clone(),
            },
        );
        assert_eq!(destroyed["type"], "channel.destroy-result");
        let host_events = bridge.borrow_mut().channels.borrow_mut().drain_host_events();
        assert!(host_events.is_empty(), "no second observation");
        let destroyed_again = host_command(
            &bridge,
            ChannelRequest::Destroy {
                owner: owner.clone(),
                channel_id: channel_id.clone(),
            },
        );
        assert_eq!(destroyed_again["type"], "channel.destroy-result");

        // Peer teardown (the channel block `destroy_child_webview` runs):
        // a fresh channel closes with peer_webview_destroyed and the host
        // observation rides the same flush.
        let created = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "toolbar".to_string(),
            },
        );
        let live_id = created["channelId"].as_str().unwrap().to_string();
        let pushes = {
            let mut state = bridge.borrow_mut();
            state.channel_loaded_views.remove("toolbar");
            state.channel_live_views.remove("toolbar");
            state.pending_channel_pushes.remove("toolbar");
            let pushes = state
                .channels
                .borrow_mut()
                .close_channels_of_webview("toolbar", ChannelCloseReason::PeerWebviewDestroyed);
            pushes
        };
        deliver_channel_pushes(&bridge, &pushes, None);
        let host_events = bridge.borrow_mut().channels.borrow_mut().drain_host_events();
        assert!(
            host_events.iter().any(|(_, value)| value["type"] == "channel.closed"
                && value["channelId"] == json!(live_id)
                && value["reason"] == "peer_webview_destroyed"),
            "peer teardown closes channels with reason"
        );
        let rejected = host_command(
            &bridge,
            ChannelRequest::Post {
                owner: owner.clone(),
                channel_id: live_id.clone(),
                payload: json!("x"),
            },
        );
        assert_eq!(
            rejected["error"]["code"], "not_open",
            "a later send fails typed instead of dropping silently"
        );

        // Session close (the channel block `session_closed` runs): every
        // open channel closes with session_closed and no tombstone
        // survives.
        let created = host_command(
            &bridge,
            ChannelRequest::Create {
                owner: owner.clone(),
                target: "sidebar".to_string(),
            },
        );
        let fresh_id = created["channelId"].as_str().unwrap().to_string();
        let pushes = bridge
            .borrow_mut()
            .channels
            .borrow_mut()
            .close_all(ChannelCloseReason::SessionClosed);
        deliver_channel_pushes(&bridge, &pushes, None);
        let host_events = bridge.borrow_mut().channels.borrow_mut().drain_host_events();
        assert!(
            host_events.iter().any(|(_, value)| value["type"] == "channel.closed"
                && value["channelId"] == json!(fresh_id)
                && value["reason"] == "session_closed"),
            "session close closes channels with reason"
        );
        let listed = host_command(&bridge, ChannelRequest::List { owner: owner.clone() });
        assert_eq!(
            listed["channels"].as_array().map(Vec::len),
            Some(0),
            "no channel state survives the session"
        );
    }
}
