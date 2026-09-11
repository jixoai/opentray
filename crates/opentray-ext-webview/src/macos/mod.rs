// Orthogonal intents (2026-07-17; original user request: default retained tray-window auto-hide;
// extended 2026-09-11 by add-webview-orchestration: one window session hosting N sibling webviews):
// 1. Own the AppKit window/WebView lifecycle and extension bridge.
// 2. Project common style, operational visibility, and focus-loss auto-hide.
// 3. Preserve native metadata, permissions, downloads, screen, and tray capabilities.
// 4. Keep injected page APIs scoped by explicit capability policy.
// 5. Maintain retained-session show/hide semantics without rebuilding page state.
// 6. Scope every window/webview/cleanup decision by the D18 owner tuple
//    (appId, trayId, sessionId): one window session per tray, sibling
//    webviews inside it, and session-close cleanup that never crosses
//    session boundaries.
// Compromise: this established platform module exceeds the preferred file-size limit because the
// AppKit window, observer, and WebKit ownership graph remain one main-thread lifecycle boundary.

mod app_menu;
mod box_view;
mod bridge;
mod demo_html;
mod downloads;
mod drag;
mod layout;
mod metadata;
mod overlay;
mod policy;
mod screen;
mod style;
mod window_delegate;
mod window_state;

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet, VecDeque},
    ptr::NonNull,
    rc::{Rc, Weak},
};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, NSObjectProtocol, ProtocolObject},
    ClassType, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSResponder, NSScreen,
    NSView, NSWindow, NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::WKWebView;
use opentray_spec::webview::{
    WebviewBridgePolicy, WebviewEventFrame, WebviewListEntry, WebviewOrchestrationCommand,
    WebviewOrchestrationResult,
};
use raw_window_handle::{AppKitWindowHandle, HasWindowHandle, RawWindowHandle, WindowHandle};
use serde_json::{json, Value};
use wry::{
    dpi::{LogicalPosition, LogicalSize},
    PageLoadEvent, Rect as WryRect, WebView, WebViewBuilder, WebViewExtMacOS, RGBA,
};

use crate::bootstrap::{navigator_window_bootstrap_script, webview_bridge_bootstrap_script};
use crate::layout::{
    apply_sizing_patch, validated_solve, LogicalViewport, WindowLayoutState,
};
use crate::orchestration::{
    webview_creation_allowed, OpenOutcome, OrchestrationError, StyleFacts, ViewEvents,
    WindowOwner, WindowRegistry, DEFAULT_WEBVIEW_ID, DEFAULT_WINDOW_ID,
};

use self::layout::{install_layout_observers, LayoutTracker};
use crate::{
    should_auto_hide_on_blur, HandledCommand, NavigatorScreenSettings, NavigatorTraySettings,
    NavigatorWindowSettings, WebviewBrowserPermissionPolicy, WebviewCommand,
    WebviewDownloadSettings, WebviewNativeApiPolicy, WebviewPermissionManagerPolicy,
    WebviewRuntimeError, WebviewSessionBootstrapSettings, WebviewShowSettings,
};

use self::app_menu::ensure_standard_edit_menu;
use self::bridge::{
    apply_window_size_constraint_options, apply_window_style_patch, close_window,
    emit_visible_change_if_needed, emit_window_event, emit_window_state_change,
    handle_navigator_window_request, to_visible, window_bounds_json, SizeConstraintKind,
};
use self::demo_html::default_webview_html;
use self::downloads::{install_download_navigation_delegate, DownloadNavigationDelegate};
use self::drag::AppRegionDragState;
use self::metadata::{
    apply_window_icon_from_bridge, handle_document_title_changed, sync_native_metadata_to_page,
    update_window_icon, update_window_title, MetadataSource, WindowMetadataState,
    DEFAULT_WINDOW_TITLE,
};
use self::overlay::emit_overlay_geometry_change_if_enabled;
use self::policy::{resolve_page_access, update_page_access_for_url};
use self::screen::screen_details_json;
use self::style::{
    apply_window_style, framed_window_style_mask, supported_background_effects,
    validate_initial_style, WindowStyleState,
};
use self::window_delegate::RetainedWindowDelegate;
use self::window_state::{window_is_closed, window_is_visible};

const WINDOW_NAMESPACE: &str = "opentray.window";
const SCREEN_NAMESPACE: &str = "opentray.screen";
const TRAY_NAMESPACE: &str = "opentray.tray";
const PAGE_IPC_NAMESPACE: &str = "opentray.ipc";
const PERMISSIONS_NAMESPACE: &str = "opentray.permissions";
const COMMAND_NAMESPACE: &str = "opentray.command";
const PRIVATE_SYNC_NAMESPACE: &str = "opentray.window.sync";
/// Page bridge namespace of the per-webview surface (D9/D2): the source
/// webview id rides the ipc transport itself, so page-originated channel
/// commands are scoped to the view the page lives in.
pub(super) const WEBVIEW_CHANNEL_NAMESPACE: &str = "opentray.webview";
const WINDOW_INTERNALS_GLOBAL: &str = "window.__OPENTRAY_WINDOW_INTERNALS__";
const OPAQUE_BACKGROUND: RGBA = (255, 255, 255, 255);
const CLEAR_BACKGROUND: RGBA = (0, 0, 0, 0);

/// One native window session owned by one tray (D18). The registry keeps the
/// owner-tuple authority; this struct carries the AppKit/wry resources that
/// share its lifetime.
struct WindowSession {
    window: Retained<NSWindow>,
    bridge: Rc<RefCell<NavigatorWindowBridge>>,
    /// Native webviews by webview id. The first webview created by a legacy
    /// `show` is the primary (`default`); orchestration children join as
    /// siblings.
    webviews: HashMap<String, NativeWebview>,
    /// D19 push-event outbox. Native page/title/focus observers push frames
    /// here directly; every command response flushes them into extension
    /// envelopes. This queue is deliberately separate from the legacy
    /// `window_events` drain path.
    event_outbox: Rc<RefCell<VecDeque<WebviewEventFrame>>>,
    /// Shared with the key-notification observers so per-view focus edges
    /// are reconciled from native callbacks without polling.
    focus_tracker: Rc<RefCell<FocusTracker>>,
    /// Native layout engine (D3–D8/D23): solve, apply frames, refresh
    /// per-view overlay projections. Shared with the resize observers.
    layout_tracker: Rc<RefCell<LayoutTracker>>,
    _focus_observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    _layout_observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    _window_delegate: Retained<RetainedWindowDelegate>,
    content_descriptor: WebviewContentDescriptor,
    show_settings: WebviewShowSettings,
    /// Durable `windowOnly` fact of the session's creation. The show-reuse
    /// compatibility check must consult THIS, not the bridge view list:
    /// orchestration children join `bridge.views` in a windowOnly session,
    /// so "first registered view exists" stops meaning "a primary exists"
    /// the moment a child is created (add-webview-orchestration P2 walk
    /// evidence: re-show with windowOnly on a populated session was
    /// misrejected as a windowOnly change).
    window_only: bool,
}

struct NativeWebview {
    webview: Box<WebView>,
    _download_navigation_delegate: Option<Retained<DownloadNavigationDelegate>>,
    content_descriptor: WebviewContentDescriptor,
}

/// Native focus reconciliation for one window: which webview (if any) owns
/// the window's first responder. Observer callbacks reconcile on key-state
/// changes; explicit focus paths reconcile after making a view first
/// responder.
struct FocusTracker {
    owner: WindowOwner,
    outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    targets: Vec<FocusTarget>,
}

struct FocusTarget {
    webview_id: String,
    view_ptr: NonNull<NSView>,
    events: Rc<RefCell<ViewEvents>>,
}

impl FocusTracker {
    fn new(owner: WindowOwner, outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>) -> Self {
        Self {
            owner,
            outbox,
            targets: Vec::new(),
        }
    }

    fn add_target(&mut self, webview_id: &str, webview: &WebView, events: Rc<RefCell<ViewEvents>>) {
        let wry_view = webview.webview();
        let view_ptr = NonNull::from(unsafe { &*Retained::as_ptr(&wry_view).cast::<NSView>() });
        self.targets.push(FocusTarget {
            webview_id: webview_id.to_string(),
            view_ptr,
            events,
        });
    }

    fn remove_target(&mut self, webview_id: &str) {
        self.targets
            .retain(|target| target.webview_id != webview_id);
    }

    /// Reconciles per-view focus flags against the window's current first
    /// responder and pushes `focused` edge frames for subscribed views. A
    /// non-key window owns no focused view, so every previously focused view
    /// emits a losing edge.
    fn reconcile(&self, window: &NSWindow) {
        let focused_view = if window.isKeyWindow() {
            window.firstResponder().and_then(|responder| {
                self.owner_of_responder(Retained::as_ptr(&responder).cast::<AnyObject>())
            })
        } else {
            None
        };
        let owner = self.owner.clone();
        let window_id = owner.window_id.clone();
        for target in &self.targets {
            let focused = Some(target.webview_id.as_str()) == focused_view.as_deref();
            let frame = {
                let mut events = target.events.borrow_mut();
                events.focus_edge(&owner, &window_id, focused)
            };
            push_event_frame(&self.outbox, frame);
        }
    }

    /// Resolves the webview whose view hierarchy contains the responder.
    /// WKWebView hands first responder to inner text/editing views while the
    /// page holds keyboard focus, so the match walks the superview chain
    /// instead of comparing the responder pointer directly. Every Objective-C
    /// object inherits NSObject, so the isKindOfClass check goes through the
    /// NSObject cast.
    fn owner_of_responder(&self, responder: *const AnyObject) -> Option<String> {
        unsafe {
            let object: &objc2::runtime::NSObject = &*responder.cast();
            if !object.isKindOfClass(NSView::class()) {
                return None;
            }
            let mut current: *const NSView = responder.cast();
            for _ in 0..32 {
                for target in &self.targets {
                    if current == target.view_ptr.as_ptr() as *const NSView {
                        return Some(target.webview_id.clone());
                    }
                }
                let Some(superview) = (*current).superview() else {
                    return None;
                };
                current = Retained::as_ptr(&superview);
            }
        }
        None
    }
}

fn push_event_frame(
    outbox: &Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    frame: Option<WebviewEventFrame>,
) {
    let Some(frame) = frame else {
        return;
    };
    if let Some(outbox) = outbox.upgrade() {
        outbox.borrow_mut().push_back(frame);
    }
}

/// D19 per-view titleChange: pushes straight from the WKWebView
/// document-title observer into the window's event outbox. This path never
/// touches the legacy `window_events` drain queue — the 16 ms polling loop
/// is not an observation mechanism for the unified event family.
pub(super) fn handle_view_title_changed(
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    owner: &WindowOwner,
    title: &str,
) {
    if let Some(frame) = events
        .borrow_mut()
        .note_title_change(owner, &owner.window_id, title)
    {
        push_event_frame(outbox, Some(frame));
    }
}

/// D19 per-view urlChange on navigation start; same no-drain contract as
/// [`handle_view_title_changed`].
pub(super) fn handle_view_url_started(
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    owner: &WindowOwner,
    url: &str,
) {
    if let Some(frame) = events
        .borrow_mut()
        .note_url_change(owner, &owner.window_id, url)
    {
        push_event_frame(outbox, Some(frame));
    }
}

/// Per-webview bridge handle: the single-webview pointer of the previous
/// structure decomposed into one entry per webview. Holds the frozen
/// per-webview bridge policy, the native transport pointer, and the page
/// listeners registered from this webview.
pub(super) struct WebViewBridge {
    pub(super) id: String,
    pub(super) policy: WebviewBridgePolicy,
    pub(super) webview: NonNull<WebView>,
    pub(super) listeners: HashMap<String, Vec<NavigatorWindowListener>>,
    pub(super) next_event_id: u32,
}

#[derive(Default)]
pub(crate) struct MacosWebviewRuntime {
    /// Owner-tuple authority for every window session (D18): at most one
    /// window per tray, precise `session_closed` cleanup.
    registry: WindowRegistry,
    /// Native window sessions keyed by tray id.
    sessions: HashMap<String, WindowSession>,
    /// App identity of the owning extension instance, set at init.
    app_id: Option<String>,
    // AppKit activation policy is process-wide. Keep the live app-mode projections explicit so
    // hiding one retained window cannot demote a sibling application window.
    app_mode_windows: HashSet<String>,
    /// Host-bound channel events drained from sessions destroyed inside
    /// the current command (their window is gone before the flush runs).
    pending_channel_events:
        Vec<(opentray_spec::webview::WebviewOwnerTuple, Value)>,
}

/// The primary webview created by a legacy `show`, before it is registered
/// into the session/registry/focus tracker.
struct PrimaryWebview {
    webview_id: String,
    webview: Box<WebView>,
    download_delegate: Option<Retained<DownloadNavigationDelegate>>,
    events: Rc<RefCell<ViewEvents>>,
}

pub(super) struct NavigatorWindowBridge {
    /// Per-webview bridge state in creation order; index 0 is the primary
    /// webview for legacy single-webview surfaces. Window ownership (the D18
    /// owner tuple) lives in the runtime registry and focus tracker.
    pub(super) views: Vec<WebViewBridge>,
    content_view: Option<Retained<NSView>>,
    ipc_messages: VecDeque<Value>,
    permission_messages: VecDeque<Value>,
    window_events: VecDeque<Value>,
    next_ipc_message_id: u32,
    next_permission_message_id: u32,
    style: WindowStyleState,
    navigator_window: NavigatorWindowSettings,
    navigator_screen: NavigatorScreenSettings,
    navigator_tray: NavigatorTraySettings,
    metadata: WindowMetadataState,
    app_region_drag: AppRegionDragState,
    devtools_enabled: bool,
    download: WebviewDownloadSettings,
    native_api_policy: WebviewNativeApiPolicy,
    browser_permission_policy: WebviewBrowserPermissionPolicy,
    permission_manager_policy: WebviewPermissionManagerPolicy,
    page_source: PageSourceState,
    page_access: PageCapabilityAccess,
    tray_bounds: Option<opentray_spec::Rect>,
    size_constraints: WindowSizeConstraints,
    /// Applied declarative-layout state (D7/D23): active document, last
    /// applied per-view rects, last applied stacking order. The page-bridge
    /// projection query reads this; the layout tracker writes it.
    pub(super) layout: WindowLayoutState,
    /// Native layout engine handle for the query path; the strong owner is
    /// the window session's `layout_tracker`.
    pub(super) layout_tracker: Weak<RefCell<LayoutTracker>>,
    /// Session-scoped message-channel registry (D9-D20). Shared with the
    /// per-webview ipc handlers so page-originated channel commands run
    /// on the WebKit callback without reaching the runtime struct.
    pub(super) channels: Rc<RefCell<crate::channels::SessionChannels>>,
    /// Views that finished at least one page load (document navigation
    /// discrimination for `document_navigated` closures).
    pub(super) channel_loaded_views: HashSet<String>,
    /// Views whose page can currently consume channel pushes (a push
    /// before the first finished load cannot land in the document).
    pub(super) channel_live_views: HashSet<String>,
    /// Lifecycle push scripts held back for views that are not live yet;
    /// flushed when the page finishes loading.
    pub(super) pending_channel_pushes: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct NavigatorWindowListener {
    event_id: u32,
    handler_id: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct WindowSizeConstraints {
    min_width: Option<f64>,
    min_height: Option<f64>,
    max_width: Option<f64>,
    max_height: Option<f64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCapabilities {
    app_mode: bool,
    close: bool,
    focus: bool,
    r#move: bool,
    resize: bool,
    resizable: bool,
    maximize: bool,
    minimize: bool,
    restore: bool,
    window_state: bool,
    overlay: bool,
    app_region_drag: bool,
    frameless: bool,
    keep_on_top: bool,
    auto_hide: bool,
    opacity: bool,
    title: bool,
    icon: bool,
    devtools: bool,
    devtools_closable: bool,
    devtools_state_queryable: bool,
    screen: bool,
    tray: bool,
    global_bindings_enabled: bool,
    global_bindings_supported: bool,
    screen_bindings_enabled: bool,
    screen_bindings_supported: bool,
    platform: &'static str,
    background: bool,
    /// Multi-webview orchestration surface (add-webview-orchestration D2/D16).
    /// Both platforms' capability DTOs serialize these fields; Darwin
    /// release builds are the cross-platform compiler gate.
    multiwebview: bool,
    webview_navigation: bool,
    focus_webview: bool,
    webview_id: bool,
    webview_bridge_policy: bool,
    /// Message-channel surface (D9-D20): channel commands plus the
    /// `navigator.opentrayWebview` page bridge. Both platforms' DTOs
    /// serialize this field (D16 parity).
    message_channels: bool,
    webview_push_events: Vec<&'static str>,
    platform_capabilities: WindowPlatformCapabilities,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowPlatformCapabilities {
    macos: MacosWindowCapabilities,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MacosWindowCapabilities {
    background_materials: Vec<String>,
    semantic_backgrounds: Vec<String>,
    background_states: Vec<String>,
    corner_radius: bool,
}

#[derive(Debug, Clone, Default)]
struct PageSourceState {
    url: Option<String>,
    host_html: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct PageCapabilityAccess {
    window: bool,
    screen: bool,
    tray: bool,
    window_globals: bool,
    screen_globals: bool,
    title_sync: bool,
    icon_sync: bool,
    permission_manager: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum WebviewContentDescriptor {
    DefaultHtml,
    Html(String),
    Url(String),
}

impl MacosWebviewRuntime {
    pub(crate) fn handle(
        &mut self,
        tray_id: &str,
        command: WebviewCommand,
    ) -> Result<HandledCommand, WebviewRuntimeError> {
        let result = self.dispatch(tray_id, command)?;
        // Flush per-view push events after the command so synchronously
        // triggered native callbacks (focus edges, navigation starts) ride
        // this response. This is the only delivery path for orchestration
        // events; the 16 ms window-event drain never observes them.
        let events = self.flush_pending_events();
        // Host-bound channel events ride the same response (v1 flush
        // ruling, tasks 3.3b/3.5), including events drained from sessions
        // destroyed by this very command.
        let channel_events = self.flush_channel_events();
        Ok(HandledCommand {
            result,
            events,
            channel_events,
        })
    }

    fn dispatch(
        &mut self,
        tray_id: &str,
        command: WebviewCommand,
    ) -> Result<Value, WebviewRuntimeError> {
        match command {
            WebviewCommand::Show {
                html,
                url,
                width,
                height,
                tray_bounds,
                fallback_rect,
                show_settings,
                owner_session_id,
                window_id,
                window_only,
            } => {
                let was_visible = self
                    .session(tray_id)
                    .map(|session| window_is_visible(&session.window))
                    .unwrap_or(false);
                self.ensure_session(
                    tray_id,
                    html,
                    url,
                    width,
                    height,
                    tray_bounds.or(fallback_rect),
                    show_settings,
                    owner_session_id,
                    window_id,
                    window_only,
                )?;
                self.focus_window(tray_id)?;
                self.reconcile_app_mode_window(tray_id);
                self.sync_activation_policy()?;
                if let Some(session) = self.session(tray_id) {
                    emit_visible_change_if_needed(&session.bridge, &session.window, was_visible)?;
                }
                Ok(json!({ "type": "shown" }))
            }
            WebviewCommand::Orchestration(command) => self.handle_orchestration(*command),
            WebviewCommand::Channel(request) => self.handle_channel(*request),
            WebviewCommand::Hide => {
                if let Some(session) = self.session(tray_id) {
                    let was_visible = window_is_visible(&session.window);
                    session.window.orderOut(None);
                    emit_visible_change_if_needed(&session.bridge, &session.window, was_visible)?;
                }
                self.app_mode_windows.remove(tray_id);
                self.sync_activation_policy()?;
                Ok(json!({ "type": "hidden" }))
            }
            WebviewCommand::Close => {
                if let Some(session) = self.session(tray_id) {
                    close_window(&session.bridge, &session.window)?;
                }
                self.app_mode_windows.remove(tray_id);
                self.sync_activation_policy()?;
                Ok(json!({ "type": "closed" }))
            }
            WebviewCommand::Destroy => {
                self.destroy_window_session(tray_id);
                Ok(json!({ "type": "destroyed" }))
            }
            WebviewCommand::SetContent { html, url } => {
                self.set_content(tray_id, html, url)?;
                Ok(json!({ "type": "contentSet" }))
            }
            WebviewCommand::Navigate { url } => {
                self.set_content(tray_id, None, Some(url.clone()))?;
                self.focus_window(tray_id)?;
                Ok(json!({ "type": "navigated", "url": url }))
            }
            WebviewCommand::Evaluate { js } => {
                let show_settings = self.active_show_settings(tray_id);
                let session = self.ensure_script_session(tray_id, show_settings)?;
                let webview = primary_webview(&session.bridge)
                    .ok_or_else(|| WebviewRuntimeError::Rejected(
                        "evaluate requires an active webview in this window".into(),
                    ))?;
                unsafe { webview.as_ref() }
                    .evaluate_script(&js)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus_window(tray_id)?;
                Ok(json!({ "type": "evaluated" }))
            }
            WebviewCommand::PostMessage { payload } => {
                let show_settings = self.active_show_settings(tray_id);
                let session = self.ensure_script_session(tray_id, show_settings)?;
                let payload_json = serde_json::to_string(&payload)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                let webview = primary_webview(&session.bridge)
                    .ok_or_else(|| WebviewRuntimeError::Rejected(
                        "postMessage requires an active webview in this window".into(),
                    ))?;
                unsafe { webview.as_ref() }
                    .evaluate_script(&format!(
                        "window.dispatchEvent(new MessageEvent('message', {{ data: {payload_json} }}));"
                    ))
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus_window(tray_id)?;
                Ok(json!({ "type": "message", "payload": payload }))
            }
            WebviewCommand::MoveTo { x, y } => {
                let session = self.require_session(tray_id, "moveTo")?;
                session.window.setFrameOrigin(NSPoint::new(x, y));
                let response = json!({ "x": x, "y": y });
                emit_window_event(&session.bridge, "moved", response.clone())?;
                Ok(response)
            }
            WebviewCommand::ResizeTo { width, height } => {
                let session = self.require_session(tray_id, "resizeTo")?;
                session
                    .window
                    .setContentSize(NSSize::new(width, height));
                let response = json!({ "width": width, "height": height });
                emit_window_event(&session.bridge, "resized", response.clone())?;
                emit_overlay_geometry_change_if_enabled(&session.bridge, &session.window)?;
                Ok(response)
            }
            WebviewCommand::IsClosed => {
                let session = self.require_session(tray_id, "isClosed")?;
                Ok(Value::Bool(window_is_closed(&session.window)))
            }
            WebviewCommand::IsVisible => {
                let session = self.require_session(tray_id, "isVisible")?;
                Ok(Value::Bool(window_is_visible(&session.window)))
            }
            WebviewCommand::ToVisible => {
                {
                    let session = self.require_session(tray_id, "toVisible")?;
                    let was_visible = window_is_visible(&session.window);
                    to_visible(&session.window);
                    emit_window_state_change(&session.bridge, &session.window, was_visible)?;
                    session
                        .focus_tracker
                        .borrow()
                        .reconcile(&session.window);
                }
                self.reconcile_app_mode_window(tray_id);
                self.focus_window(tray_id)?;
                Ok(Value::Null)
            }
            WebviewCommand::Focus => {
                if self.session(tray_id).is_none() {
                    return Err(WebviewRuntimeError::Rejected(
                        "focus requires an active WebView window".into(),
                    ));
                }
                self.focus_window(tray_id)?;
                Ok(Value::Null)
            }
            WebviewCommand::GetBounds => {
                let session = self.require_session(tray_id, "getBounds")?;
                window_bounds_json(&session.window)
            }
            WebviewCommand::GetScreenDetails => {
                let session = self.require_session(tray_id, "getScreenDetails")?;
                screen_details_json(&session.window)
            }
            WebviewCommand::DrainIpcMessages => {
                let session = self.require_session(tray_id, "drainIpcMessages")?;
                let messages: Vec<Value> =
                    session.bridge.borrow_mut().ipc_messages.drain(..).collect();
                Ok(json!({ "type": "ipcMessages", "messages": messages }))
            }
            WebviewCommand::DrainPermissionMessages => {
                let session = self.require_session(tray_id, "drainPermissionMessages")?;
                let messages: Vec<Value> = session
                    .bridge
                    .borrow_mut()
                    .permission_messages
                    .drain(..)
                    .collect();
                Ok(json!({ "type": "permissionMessages", "messages": messages }))
            }
            WebviewCommand::ResolvePermissionMessage { id, result } => {
                let session = self.require_session(tray_id, "resolvePermissionMessage")?;
                self::bridge::resolve_callback(&session.bridge, None, id, result)?;
                Ok(json!({ "type": "permissionMessageResolved", "id": id }))
            }
            WebviewCommand::DrainWindowEvents => {
                self.reconcile_app_mode_window(tray_id);
                self.sync_activation_policy()?;
                let session = self.require_session(tray_id, "drainWindowEvents")?;
                let events: Vec<Value> =
                    session.bridge.borrow_mut().window_events.drain(..).collect();
                Ok(json!({ "type": "windowEvents", "events": events }))
            }
            WebviewCommand::OpenDevtools => {
                let session = self.require_session(tray_id, "openDevtools")?;
                open_devtools(&session.bridge)
            }
            WebviewCommand::CloseDevtools => {
                let session = self.require_session(tray_id, "closeDevtools")?;
                close_devtools(&session.bridge)
            }
            WebviewCommand::IsDevtoolsOpen => {
                let session = self.require_session(tray_id, "isDevtoolsOpen")?;
                devtools_open_state(&session.bridge)
            }
            WebviewCommand::SetStyle { style } => {
                let response = {
                    let session = self.require_session(tray_id, "setStyle")?;
                    let payload: self::style::SetStylePayload = serde_json::from_value(style)
                        .map_err(|error| {
                            WebviewRuntimeError::Rejected(format!(
                                "setStyle payload is invalid: {error}"
                            ))
                        })?;
                    apply_window_style_patch(&session.bridge, &session.window, payload)?
                };
                self.reconcile_app_mode_window(tray_id);
                self.sync_activation_policy()?;
                Ok(response)
            }
            WebviewCommand::SetMinimumSize { width, height } => {
                let session = self.require_session(tray_id, "setMinimumSize")?;
                apply_window_size_constraint_options(
                    &session.bridge,
                    &session.window,
                    SizeConstraintKind::Minimum,
                    width,
                    height,
                )
            }
            WebviewCommand::SetMaximumSize { width, height } => {
                let session = self.require_session(tray_id, "setMaximumSize")?;
                apply_window_size_constraint_options(
                    &session.bridge,
                    &session.window,
                    SizeConstraintKind::Maximum,
                    width,
                    height,
                )
            }
        }
    }

    /// Session cleanup keyed by the closing session id (D18): destroys
    /// exactly the windows whose owner tuple matches, and never touches
    /// another live session's windows. Unattributed legacy windows follow
    /// the transitional rule documented on
    /// [`crate::orchestration::WindowRegistry::session_closed`].
    pub(crate) fn session_closed(&mut self, session_id: &str) {
        let removed = self.registry.session_closed(session_id);
        for entry in removed {
            if let Some(owner) = entry.owner {
                // Channel law (D20): session close closes the session's
                // channels with `session_closed` (distinct from the
                // `window_destroyed` entrance) and stages the host
                // observations for the next response flush — the
                // session-close ABI call itself returns no events.
                if let Some(session) = self.sessions.get_mut(&owner.tray_id) {
                    let pushes = session
                        .bridge
                        .borrow()
                        .channels
                        .borrow_mut()
                        .close_all(opentray_spec::channel::ChannelCloseReason::SessionClosed);
                    self::bridge::deliver_channel_pushes(&session.bridge, &pushes, None);
                    let events = session
                        .bridge
                        .borrow()
                        .channels
                        .borrow_mut()
                        .drain_host_events();
                    self.pending_channel_events.extend(events);
                }
                self.destroy_window_session(&owner.tray_id);
            }
        }
        self.sync_activation_policy_if_available();
    }

    /// Multi-webview orchestration commands (frozen wire tags). Typed
    /// rejections return the frozen `{ error: { code, message } }` envelope
    /// as the command response data, before any state changes.
    fn handle_orchestration(
        &mut self,
        command: WebviewOrchestrationCommand,
    ) -> Result<Value, WebviewRuntimeError> {
        use opentray_spec::webview::WebviewOrchestrationCommand as Command;

        let result = match command {
            Command::CreateWebview {
                owner,
                window_id,
                webview_id,
                url,
                html,
                bridge,
            } => {
                let policy = bridge.unwrap_or_default();
                if self.resolve_window(&owner, &window_id).is_none() {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                }
                // Style-exclusivity checkpoint (1): fires before any child
                // state exists.
                let facts = self
                    .session(&owner.tray_id)
                    .map(|session| session.bridge.borrow().style_facts())
                    .unwrap_or_default();
                let existing = self
                    .registry
                    .window(&owner.tray_id)
                    .map(|entry| entry.views.len())
                    .unwrap_or(0);
                if let Err(error) = webview_creation_allowed(facts, existing) {
                    return Ok(typed_rejection(error));
                }
                if url.is_none() == html.is_none() {
                    return Err(WebviewRuntimeError::Rejected(
                        "create-webview accepts exactly one of url or html".into(),
                    ));
                }
                match self.create_child_webview(&owner, &window_id, &webview_id, url, html, policy)
                {
                    Ok(()) => WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "create-webview".to_string(),
                    },
                    Err(ChildCreateError::Typed(error)) => return Ok(typed_rejection(error)),
                    Err(ChildCreateError::Runtime(error)) => return Err(error),
                }
            }
            Command::DestroyWebview {
                owner,
                window_id,
                webview_id,
            } => {
                if self.resolve_window(&owner, &window_id).is_none() {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                }
                let known = self
                    .registry
                    .window(&owner.tray_id)
                    .map(|entry| {
                        entry
                            .views
                            .iter()
                            .any(|view| view.borrow().webview_id == webview_id)
                    })
                    .unwrap_or(false);
                if !known {
                    return Ok(unknown_view_envelope(&owner, &webview_id));
                }
                self.destroy_child_webview(&owner, &webview_id);
                WebviewOrchestrationResult::WebviewAck {
                    owner,
                    command: "destroy-webview".to_string(),
                }
            }
            Command::ListWebviews { owner, window_id } => {
                let Some(session) = self.resolve_window(&owner, &window_id) else {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                };
                let webviews: Vec<WebviewListEntry> = session
                    .bridge
                    .borrow()
                    .views
                    .iter()
                    .map(|view| WebviewListEntry {
                        webview_id: view.id.clone(),
                        bridge: view.policy,
                    })
                    .collect();
                WebviewOrchestrationResult::ListWebviewsResult {
                    owner,
                    window_id,
                    webviews,
                }
            }
            Command::NavigateWebview {
                owner,
                window_id,
                webview_id,
                url,
            } => match self.native_webview_for(&owner, &window_id, &webview_id) {
                Ok(native) => {
                    native
                        .webview
                        .load_url(&url)
                        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "navigate-webview".to_string(),
                    }
                }
                Err(envelope) => return Ok(envelope),
            },
            Command::BackWebview {
                owner,
                window_id,
                webview_id,
            } => match self.native_webview_for(&owner, &window_id, &webview_id) {
                Ok(native) => {
                    wkwebview_go_back(native.webview.as_ref())?;
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "back-webview".to_string(),
                    }
                }
                Err(envelope) => return Ok(envelope),
            },
            Command::ForwardWebview {
                owner,
                window_id,
                webview_id,
            } => match self.native_webview_for(&owner, &window_id, &webview_id) {
                Ok(native) => {
                    wkwebview_go_forward(native.webview.as_ref())?;
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "forward-webview".to_string(),
                    }
                }
                Err(envelope) => return Ok(envelope),
            },
            Command::FocusWebview {
                owner,
                window_id,
                webview_id,
            } => {
                let Some(session) = self.resolve_window(&owner, &window_id) else {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                };
                let Some(native) = session.webviews.get(&webview_id) else {
                    return Ok(unknown_view_envelope(&owner, &webview_id));
                };
                let webview = native.webview.as_ref();
                let window = session.window.clone();
                let tracker = Rc::clone(&session.focus_tracker);
                // Raise the window, then make this webview the first
                // responder; the tracker reconciles both focus edges.
                let mtm = MainThreadMarker::new().ok_or_else(|| {
                    WebviewRuntimeError::Unsupported(
                        "webview runtime requires the main thread".into(),
                    )
                })?;
                let app = NSApplication::sharedApplication(mtm);
                #[allow(deprecated)]
                app.activateIgnoringOtherApps(true);
                window.makeKeyAndOrderFront(None);
                focus_webview_responder(&window, webview);
                tracker.borrow().reconcile(&window);
                WebviewOrchestrationResult::WebviewAck {
                    owner,
                    command: "focus-webview".to_string(),
                }
            }
            Command::GetWebviewUrl {
                owner,
                window_id,
                webview_id,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    let events = events.borrow();
                    WebviewOrchestrationResult::GetWebviewUrlResult {
                        owner,
                        window_id,
                        webview_id,
                        url: events.url.clone(),
                        seq: events.url_seq,
                    }
                }
                None => return Ok(unknown_view_envelope(&owner, &webview_id)),
            },
            Command::GetWebviewTitle {
                owner,
                window_id,
                webview_id,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    let events = events.borrow();
                    WebviewOrchestrationResult::GetWebviewTitleResult {
                        owner,
                        window_id,
                        webview_id,
                        title: events.title.clone(),
                        seq: events.title_seq,
                    }
                }
                None => return Ok(unknown_view_envelope(&owner, &webview_id)),
            },
            Command::SubscribeWebviewEvents {
                owner,
                window_id,
                webview_id,
                kinds,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    events.borrow_mut().subscribe(&kinds);
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "subscribe-webview-events".to_string(),
                    }
                }
                None => return Ok(unknown_view_envelope(&owner, &webview_id)),
            },
            Command::UnsubscribeWebviewEvents {
                owner,
                window_id,
                webview_id,
                kinds,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    events.borrow_mut().unsubscribe(&kinds);
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "unsubscribe-webview-events".to_string(),
                    }
                }
                None => return Ok(unknown_view_envelope(&owner, &webview_id)),
            },
            Command::SetWebviewLayout {
                owner,
                window_id,
                layout,
            } => {
                let Some(session) = self.resolve_window(&owner, &window_id) else {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                };
                // Validation runs before solving and before any state or
                // native geometry changes: a rejected tree leaves the
                // previously applied layout fully in effect.
                let (view_ids, viewport) = session_layout_inputs(session);
                match validated_solve(&layout, &|id| view_ids.contains(id), viewport) {
                    Err(error) => return Ok(typed_rejection(error)),
                    Ok(solution) => {
                        // One native transaction (D7/D23): store the document
                        // (authority for resize re-solves), then apply solved
                        // frames, boxes, stacking, and refresh projections.
                        session.bridge.borrow_mut().layout.document = Some(layout);
                        session
                            .layout_tracker
                            .borrow_mut()
                            .apply_solution(&solution);
                    }
                }
                WebviewOrchestrationResult::WebviewAck {
                    owner,
                    command: "set-webview-layout".to_string(),
                }
            }
            Command::UpdateWebviewLayout {
                owner,
                window_id,
                view_id,
                patch,
            } => {
                let Some(session) = self.resolve_window(&owner, &window_id) else {
                    return Ok(unknown_window_envelope(&owner, &window_id));
                };
                let first_view = session.bridge.borrow().views.first().map(|view| view.id.clone());
                // Materialize the effective document (the default layout
                // becomes explicit on first update), merge the patch, then
                // re-validate — an inverted patch rejects before any state
                // changes, leaving the applied layout untouched.
                let mut document = {
                    let state = session.bridge.borrow();
                    state.layout.effective_document(first_view.as_deref())
                };
                if !apply_sizing_patch(&mut document, &view_id, &patch) {
                    return Ok(unknown_view_envelope(&owner, &view_id));
                }
                let (view_ids, viewport) = session_layout_inputs(session);
                match validated_solve(&document, &|id| view_ids.contains(id), viewport) {
                    Err(error) => return Ok(typed_rejection(error)),
                    Ok(solution) => {
                        session.bridge.borrow_mut().layout.document = Some(document);
                        session
                            .layout_tracker
                            .borrow_mut()
                            .apply_solution(&solution);
                    }
                }
                WebviewOrchestrationResult::WebviewAck {
                    owner,
                    command: "update-webview-layout".to_string(),
                }
            }
        };
        serde_json::to_value(result)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }

    /// Message-channel commands (D9-D20, frozen `channel.*` wire tags).
    /// The response data is the frozen result frame; typed rejections
    /// return the `channel.error` envelope as Ok-data, mirroring the
    /// orchestration convention (the extension ABI's error channel cannot
    /// carry the typed registry). Push effects are delivered inline:
    /// page-bound through the bridge script, host-bound through the
    /// response flush.
    fn handle_channel(
        &mut self,
        request: crate::channels::ChannelRequest,
    ) -> Result<Value, WebviewRuntimeError> {
        use crate::channels::ChannelRequest as Request;
        use opentray_spec::channel::ChannelFrame;

        let owner = request.owner().clone();
        let Some(bridge) = self
            .session_for_owner(&owner)
            .map(|session| Rc::clone(&session.bridge))
        else {
            // A tray whose live window belongs to another session is the
            // typed cross-session rejection; a tray with no window session
            // at all has nothing addressable (unknown_view).
            let session_live = self.registry.window(&owner.tray_id).is_some();
            let code = if session_live {
                opentray_spec::webview::OrchestrationErrorCode::SessionScope
            } else {
                opentray_spec::webview::OrchestrationErrorCode::UnknownView
            };
            let message = if session_live {
                format!(
                    "channel owner (app {}, tray {}, session {}) does not address the live \
                     window session of tray {}",
                    owner.app_id, owner.tray_id, owner.session_id, owner.tray_id
                )
            } else {
                format!("tray {} has no webview window session to address", owner.tray_id)
            };
            return Ok(channel_error_frame(&owner, code, message));
        };
        let registry = bridge.borrow().channels.clone();
        let sender = crate::channels::ChannelSender::Host;

        let result = match request {
            Request::Create { ref target, .. } => {
                // Authority (D10/D20): the target must be a live webview of
                // this session whose bridge policy enables message
                // channels; validation precedes any channel state.
                if let Some(error) = channel_target_error(&bridge, target) {
                    return Ok(channel_error_frame(
                        &owner,
                        error.code(),
                        error.envelope.error.message,
                    ));
                }
                let created = registry.borrow_mut().create(
                    &owner,
                    opentray_spec::channel::ChannelPeer::host(),
                    target.clone(),
                );
                match created {
                    Ok((channel_id, push)) => {
                        self::bridge::deliver_channel_pushes(
                            &bridge,
                            std::slice::from_ref(&push),
                            None,
                        );
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
                        self::bridge::drain_channel_port_for(
                            &bridge,
                            channel_id,
                            &receipt.recipient,
                            receipt.endpoint,
                        );
                        ChannelFrame::PostResult { owner }
                    }
                    Err(failure) => {
                        self::bridge::deliver_channel_pushes(&bridge, &failure.pushes, None);
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
                        self::bridge::deliver_channel_pushes(&bridge, &pushes, None);
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
                        self::bridge::deliver_channel_pushes(&bridge, &pushes, None);
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

    /// Resolves the window session whose owner tuple matches the frame's
    /// `(appId, trayId, sessionId)` — channel commands carry no window id,
    /// the session identity is the addressing scope.
    fn session_for_owner(
        &self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
    ) -> Option<&WindowSession> {
        let entry = self.registry.window(&owner.tray_id)?;
        let recorded = entry.owner.as_ref()?;
        if recorded.app_id != owner.app_id
            || recorded.session_id.as_deref() != Some(owner.session_id.as_str())
        {
            return None;
        }
        self.sessions.get(&owner.tray_id)
    }

    /// Drains every live session's host-bound channel events plus events
    /// staged by sessions destroyed inside the current command.
    fn flush_channel_events(
        &mut self,
    ) -> Vec<(opentray_spec::webview::WebviewOwnerTuple, Value)> {
        let mut events = std::mem::take(&mut self.pending_channel_events);
        for session in self.sessions.values() {
            let channels = session.bridge.borrow().channels.clone();
            events.extend(channels.borrow_mut().drain_host_events());
        }
        events
    }

    /// Resolves the window session addressed by an orchestration command.
    /// Returns `None` for unknown tray/window bindings. Orchestration
    /// commands always carry an attributed owner tuple, so unattributed
    /// legacy windows are not addressable through this surface.
    fn resolve_window(
        &self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
    ) -> Option<&WindowSession> {
        let entry = self.registry.window(&owner.tray_id)?;
        let recorded = entry.owner.as_ref()?;
        if recorded.app_id != owner.app_id
            || recorded.tray_id != owner.tray_id
            || recorded.session_id.as_deref() != Some(owner.session_id.as_str())
            || recorded.window_id != window_id
        {
            return None;
        }
        self.sessions.get(&owner.tray_id)
    }

    fn view_events(
        &self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
        webview_id: &str,
    ) -> Option<Rc<RefCell<ViewEvents>>> {
        self.resolve_window(owner, window_id)?;
        self.registry
            .window(&owner.tray_id)?
            .views
            .iter()
            .find(|view| view.borrow().webview_id == webview_id)
            .cloned()
    }
    /// Resolves a native webview for mutation; the `Err` value is the typed
    /// rejection envelope to return as the command response.
    fn native_webview_for(
        &mut self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
        webview_id: &str,
    ) -> Result<&mut NativeWebview, Value> {
        if self.resolve_window(owner, window_id).is_none() {
            return Err(unknown_window_envelope(owner, window_id));
        }
        self.sessions
            .get_mut(&owner.tray_id)
            .and_then(|session| session.webviews.get_mut(webview_id))
            .ok_or_else(|| unknown_view_envelope(owner, webview_id))
    }

    #[allow(clippy::too_many_arguments)]
    fn create_child_webview(
        &mut self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
        webview_id: &str,
        url: Option<String>,
        html: Option<String>,
        policy: WebviewBridgePolicy,
    ) -> Result<(), ChildCreateError> {
        MainThreadMarker::new().ok_or_else(|| {
            ChildCreateError::Runtime(WebviewRuntimeError::Unsupported(
                "webview runtime requires the main thread".into(),
            ))
        })?;
        let window_owner = WindowOwner {
            app_id: owner.app_id.clone(),
            tray_id: owner.tray_id.clone(),
            session_id: Some(owner.session_id.clone()),
            window_id: window_id.to_string(),
        };
        // Register the view handle before the native build so a duplicate id
        // rejects with zero native state; a build failure rolls it back.
        let events = Rc::new(RefCell::new(ViewEvents::new(webview_id, policy)));
        events
            .borrow_mut()
            .note_url_change(&window_owner, window_id, url.clone().unwrap_or_default());
        if let Err(error) = self.registry.add_view(&owner.tray_id, Rc::clone(&events)) {
            return Err(ChildCreateError::Typed(error));
        }

        let build = self.build_child_webview(
            &window_owner,
            webview_id,
            url,
            html,
            policy,
            Rc::clone(&events),
        );
        match build {
            Ok(native) => {
                let session = self
                    .sessions
                    .get_mut(&owner.tray_id)
                    .ok_or_else(|| ChildCreateError::Typed(orphan_window_error(owner)))?;
                session
                    .focus_tracker
                    .borrow_mut()
                    .add_target(webview_id, native.webview.as_ref(), Rc::clone(&events));
                let mut tracker = session.layout_tracker.borrow_mut();
                tracker.add_webview(webview_id, native.webview.as_ref(), Rc::clone(&events));
                session.webviews.insert(webview_id.to_string(), native);
                // The effective layout decides the child's place immediately:
                // referenced views move, unreferenced views stay hidden until
                // a layout claims them (default layout = first webview only).
                tracker.relayout();
                Ok(())
            }
            Err(error) => {
                self.registry.remove_view(&owner.tray_id, webview_id);
                Err(ChildCreateError::Runtime(error))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn build_child_webview(
        &self,
        window_owner: &WindowOwner,
        webview_id: &str,
        url: Option<String>,
        html: Option<String>,
        policy: WebviewBridgePolicy,
        events: Rc<RefCell<ViewEvents>>,
    ) -> Result<NativeWebview, WebviewRuntimeError> {
        let session = self
            .sessions
            .get(&window_owner.tray_id)
            .ok_or_else(|| WebviewRuntimeError::Internal("window session missing".into()))?;
        let host_view = AppKitViewHandle::new(
            session
                .bridge
                .borrow()
                .content_view
                .clone()
                .ok_or_else(|| {
                    WebviewRuntimeError::Internal("webview window has no content view".into())
                })?,
        );
        let content_frame = host_view.ns_view.frame();
        let bridge = Rc::clone(&session.bridge);
        let window = session.window.clone();
        let outbox_for_title = Rc::downgrade(&session.event_outbox);
        let outbox_for_page_load = Rc::downgrade(&session.event_outbox);
        let events_for_title = Rc::clone(&events);
        let events_for_page_load = Rc::clone(&events);
        let owner_for_title = window_owner.clone();
        let owner_for_page_load = window_owner.clone();
        let webview_id_for_ipc = webview_id.to_string();
        let bridge_for_channel_loads = Rc::downgrade(&bridge);
        let webview_id_for_channel_loads = webview_id.to_string();
        let descriptor = match (&url, &html) {
            (Some(url), None) => WebviewContentDescriptor::Url(url.clone()),
            (None, Some(html)) => WebviewContentDescriptor::Html(html.clone()),
            _ => unreachable!("create-webview content pair validated before build"),
        };

        let mut builder = WebViewBuilder::new()
            .with_document_title_changed_handler(move |title| {
                // D19: per-view titleChange pushes straight from the native
                // observer into the outbox; window title metadata stays the
                // primary webview's surface.
                handle_view_title_changed(&events_for_title, &outbox_for_title, &owner_for_title, &title);
            })
            .with_on_page_load_handler(move |event, url| {
                if matches!(event, PageLoadEvent::Started) {
                    handle_view_url_started(&events_for_page_load, &outbox_for_page_load, &owner_for_page_load, &url);
                    // Channel law (D11): a document navigation closes the
                    // page-side endpoints. The helper discriminates the
                    // view's very first load (recorded in the bridge
                    // state) from later navigations, and drops pushes
                    // held back for a document that is being replaced.
                    if let Some(bridge) = bridge_for_channel_loads.upgrade() {
                        self::bridge::handle_view_channel_navigation_started(
                            &bridge,
                            &webview_id_for_channel_loads,
                        );
                    }
                }
                if matches!(event, PageLoadEvent::Finished) {
                    // The document can now consume channel pushes; flush
                    // everything held back for it.
                    if let Some(bridge) = bridge_for_channel_loads.upgrade() {
                        self::bridge::handle_view_channel_page_finished(
                            &bridge,
                            &webview_id_for_channel_loads,
                        );
                    }
                }
            })
            .with_download_started_handler(|_, _| true)
            .with_download_completed_handler(|_, _, _| {})
            .with_devtools(session.show_settings.window.devtools)
            .with_transparent(true);

        // Per-webview bridge policy (D2): a policy-less child gets no
        // bootstrap script and no ipc surface — the arbitrary-content webview
        // is bridgeless by default.
        if let Some(script) = webview_bridge_bootstrap_script(policy, webview_id) {
            let bridge_for_ipc = Rc::clone(&bridge);
            let window_for_ipc = window.clone();
            builder = builder
                .with_initialization_script(script)
                .with_ipc_handler(move |request| {
                    handle_navigator_window_request(
                        request.body(),
                        &bridge_for_ipc,
                        &window_for_ipc,
                        &webview_id_for_ipc,
                    );
                });
        }

        builder = builder.with_bounds(WryRect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(content_frame.size.width, content_frame.size.height).into(),
        });
        let builder = match (url, html) {
            (Some(url), None) => builder.with_url(url),
            (None, Some(html)) => builder.with_html(html),
            _ => unreachable!("create-webview content pair validated before build"),
        };
        let mut webview = Box::new(
            builder
                // D1: sibling native view inside the same NSWindow. The
                // child fills the content rect until the declarative layout
                // engine batch assigns its real bounds.
                .build_as_child(&host_view)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?,
        );
        let download_delegate = if session.show_settings.download.enabled {
            Some(install_download_navigation_delegate(webview.as_ref(), &bridge)?)
        } else {
            None
        };
        register_bridge_view(&bridge, webview_id, policy, webview.as_mut());
        Ok(NativeWebview {
            webview,
            _download_navigation_delegate: download_delegate,
            content_descriptor: descriptor,
        })
    }

    fn destroy_child_webview(
        &mut self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        webview_id: &str,
    ) {
        if let Some(session) = self.sessions.get_mut(&owner.tray_id) {
            // Channel law (D11/D20): peer teardown closes the destroyed
            // view's channels first, while the surviving endpoints' pages
            // are still live to observe through. The pure registry skips
            // pushes addressed to the dying view itself.
            let pushes = session
                .bridge
                .borrow()
                .channels
                .borrow_mut()
                .close_channels_of_webview(
                    webview_id,
                    opentray_spec::channel::ChannelCloseReason::PeerWebviewDestroyed,
                );
            self::bridge::deliver_channel_pushes(&session.bridge, &pushes, None);
            session.focus_tracker.borrow_mut().remove_target(webview_id);
            session.bridge.borrow_mut().remove_view(webview_id);
            {
                let mut bridge = session.bridge.borrow_mut();
                bridge.channel_loaded_views.remove(webview_id);
                bridge.channel_live_views.remove(webview_id);
                bridge.pending_channel_pushes.remove(webview_id);
            }
            if let Some(native) = session.webviews.remove(webview_id) {
                let wry_view = native.webview.webview();
                wry_view.removeFromSuperview();
                // Dropping the wry handle releases the WKWebView; ext
                // commands dispatch on the main thread.
            }
            // The layout document keeps its declaration; the re-solve simply
            // positions nothing for the destroyed id.
            session.layout_tracker.borrow_mut().remove_webview(webview_id);
            session.layout_tracker.borrow_mut().relayout();
        }
        self.registry.remove_view(&owner.tray_id, webview_id);
    }

    fn session(&self, tray_id: &str) -> Option<&WindowSession> {
        self.sessions.get(tray_id)
    }

    fn require_session(&self, tray_id: &str, command: &str) -> Result<&WindowSession, WebviewRuntimeError> {
        self.session(tray_id).ok_or_else(|| {
            WebviewRuntimeError::Rejected(format!(
                "{command} requires an active WebView window"
            ))
        })
    }

    fn active_show_settings(&self, tray_id: &str) -> WebviewShowSettings {
        self.session(tray_id)
            .map(|session| session.show_settings.clone())
            .unwrap_or_default()
    }

    fn ensure_session(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
        width: Option<f64>,
        height: Option<f64>,
        tray_bounds: Option<opentray_spec::Rect>,
        show_settings: WebviewShowSettings,
        owner_session_id: Option<String>,
        window_id: Option<String>,
        window_only: bool,
    ) -> Result<(), WebviewRuntimeError> {
        let initial_width = width.unwrap_or(420.0).max(240.0);
        let initial_height = height.unwrap_or(260.0).max(160.0);
        let requested_content = explicit_content_descriptor(html.as_ref(), url.as_ref());
        let owner = WindowOwner {
            app_id: self.app_id(),
            tray_id: tray_id.to_string(),
            session_id: owner_session_id,
            window_id: window_id.unwrap_or_else(|| DEFAULT_WINDOW_ID.to_string()),
        };

        // D18: a tray holds at most one window session. A second session for
        // the same tray is the typed `tray_session_active` rejection before
        // any window state exists; compatible re-shows reuse the live scope.
        match self.registry.open_window(owner.clone()) {
            Ok(OpenOutcome::Created) => {
                if let Err(error) = self.create_window_session(
                    owner,
                    html,
                    url,
                    initial_width,
                    initial_height,
                    tray_bounds,
                    show_settings,
                    window_only,
                ) {
                    // Roll the registry entry back so a failed create cannot
                    // block later shows with a phantom session.
                    self.registry.destroy_window(tray_id);
                    return Err(error);
                }
                return Ok(());
            }
            Ok(OpenOutcome::Reused) => {}
            Err(error) => {
                return Err(orchestration_error(error));
            }
        }

        let session = self.sessions.get_mut(tray_id).ok_or_else(|| {
            WebviewRuntimeError::Internal("window registry lost its native session".into())
        })?;
        // Re-show is a visibility verb. Do not silently replace the live JS/DOM runtime through
        // repeated show calls; force callers onto explicit content or destroy paths instead.
        if show_settings.bootstrap_requested {
            ensure_session_reuse_allowed(
                session.show_settings.session_bootstrap_settings(),
                show_settings.session_bootstrap_settings(),
                &session.content_descriptor,
                requested_content.as_ref(),
            )?;
        } else if let Some(requested_content) = requested_content.as_ref() {
            if &session.content_descriptor != requested_content {
                return Err(WebviewRuntimeError::Rejected(
                    "show cannot replace existing webview content; use setContent, navigate, or destroy then show again".into(),
                ));
            }
        }
        if session_has_no_primary(session) != window_only {
            return Err(WebviewRuntimeError::Rejected(
                "show cannot change windowOnly; destroy the session and show again".into(),
            ));
        }

        if let (Some(width), Some(height)) = (width, height) {
            let width = width.max(240.0);
            let height = height.max(160.0);
            session.window.setContentSize(NSSize::new(width, height));
        }
        session.bridge.borrow_mut().tray_bounds = tray_bounds;
        if tray_bounds.is_some() && width.is_some() && height.is_some() {
            apply_initial_window_position(&session.window, tray_bounds);
        }
        apply_reused_show_updates(session, &show_settings)?;
        Ok(())
    }

    fn ensure_script_session(
        &mut self,
        tray_id: &str,
        show_settings: WebviewShowSettings,
    ) -> Result<&WindowSession, WebviewRuntimeError> {
        if self.session(tray_id).is_none() {
            return self
                .ensure_session(
                    tray_id,
                    None,
                    None,
                    Some(420.0),
                    Some(260.0),
                    None,
                    show_settings,
                    None,
                    None,
                    false,
                )
                .map(|()| self.sessions.get(tray_id).expect("session created"));
        }
        Ok(self.sessions.get(tray_id).expect("session exists"))
    }

    fn set_content(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
    ) -> Result<(), WebviewRuntimeError> {
        if self.session(tray_id).is_none() {
            return Err(WebviewRuntimeError::Rejected(
                "setContent requires an existing webview session; call show first".into(),
            ));
        }
        let descriptor =
            explicit_content_descriptor(html.as_ref(), url.as_ref()).ok_or_else(|| {
                WebviewRuntimeError::Rejected("setContent requires html or url".into())
            })?;
        if self
            .session(tray_id)
            .is_some_and(|session| session.content_descriptor == descriptor)
        {
            return Ok(());
        }
        let primary_id = self
            .session(tray_id)
            .and_then(|session| bridge_primary_id(&session.bridge))
            .ok_or_else(|| {
                WebviewRuntimeError::Rejected(
                    "setContent requires an active webview in this window".into(),
                )
            })?;
        let session = self
            .sessions
            .get_mut(tray_id)
            .ok_or_else(|| WebviewRuntimeError::Internal("window session missing".into()))?;
        load_session_content(session, primary_id, html, url, descriptor)
    }

    #[allow(clippy::too_many_arguments)]
    fn create_window_session(
        &mut self,
        owner: WindowOwner,
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        tray_bounds: Option<opentray_spec::Rect>,
        show_settings: WebviewShowSettings,
        window_only: bool,
    ) -> Result<(), WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        validate_initial_style(&show_settings)?;
        let content_descriptor = initial_content_descriptor(html.as_ref(), url.as_ref());
        let page_source = page_source_state_for_content(&content_descriptor);
        let tray_id = owner.tray_id.clone();
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)),
                framed_window_style_mask(
                    show_settings.window.style.frameless,
                    show_settings
                        .window
                        .style
                        .resizable
                        .unwrap_or(!show_settings.window.style.frameless),
                    show_settings.navigator_window.window_controls_overlay,
                ),
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe { window.setReleasedWhenClosed(false) };
        window.setTitle(&NSString::from_str(
            show_settings
                .window
                .title
                .as_deref()
                .unwrap_or(DEFAULT_WINDOW_TITLE),
        ));
        window.center();

        let bridge = Rc::new(RefCell::new(NavigatorWindowBridge {
            views: Vec::new(),
            content_view: None,
            ipc_messages: VecDeque::new(),
            permission_messages: VecDeque::new(),
            window_events: VecDeque::new(),
            next_ipc_message_id: 1,
            next_permission_message_id: 1,
            style: WindowStyleState {
                app_mode: show_settings.window.style.app_mode,
                frameless: show_settings.window.style.frameless,
                resizable: show_settings
                    .window
                    .style
                    .resizable
                    .unwrap_or(!show_settings.window.style.frameless),
                resizable_override: show_settings.window.style.resizable,
                keep_on_top: show_settings.window.style.keep_on_top,
                auto_hide: show_settings.window.style.auto_hide,
                opacity: show_settings.window.style.opacity,
                background: show_settings.window.style.background.clone(),
                platform: self::style::WindowPlatformStyleState {
                    macos: self::style::MacosWindowStyleState {
                        corner_radius: show_settings.window.style.platform.macos.corner_radius,
                    },
                },
            },
            navigator_window: show_settings.navigator_window,
            navigator_screen: show_settings.navigator_screen,
            navigator_tray: show_settings.navigator_tray,
            metadata: WindowMetadataState {
                title: show_settings
                    .window
                    .title
                    .clone()
                    .unwrap_or_else(|| DEFAULT_WINDOW_TITLE.to_string()),
                icon: show_settings.window.icon.clone(),
                sync_title: show_settings.window.sync.title,
                sync_icon: show_settings.window.sync.icon,
            },
            app_region_drag: AppRegionDragState::default(),
            devtools_enabled: show_settings.window.devtools,
            download: show_settings.download,
            native_api_policy: show_settings.native_api_policy.clone(),
            browser_permission_policy: show_settings.browser_permission_policy.clone(),
            permission_manager_policy: show_settings.permission_manager_policy.clone(),
            page_source: page_source.clone(),
            page_access: resolve_page_access(&show_settings, &page_source),
            tray_bounds,
            size_constraints: WindowSizeConstraints::default(),
            layout: WindowLayoutState::default(),
            layout_tracker: Weak::new(),
            channels: Rc::new(RefCell::new(crate::channels::SessionChannels::new(
                owner.clone(),
            ))),
            channel_loaded_views: HashSet::new(),
            channel_live_views: HashSet::new(),
            pending_channel_pushes: HashMap::new(),
        }));

        window.contentView().ok_or_else(|| {
            WebviewRuntimeError::Internal("webview window has no content view".into())
        })?;
        bridge.borrow_mut().content_view = window.contentView();
        let event_outbox = Rc::new(RefCell::new(VecDeque::new()));
        let focus_tracker = Rc::new(RefCell::new(FocusTracker::new(
            owner.clone(),
            Rc::downgrade(&event_outbox),
        )));
        // Native layout engine: shares the bridge/outbox ownership graph so
        // the resize observers can re-run the whole transaction without the
        // runtime being reachable from AppKit callbacks.
        let layout_tracker = Rc::new(RefCell::new(LayoutTracker::new(
            owner.clone(),
            Rc::downgrade(&bridge),
            &window,
            Rc::downgrade(&event_outbox),
        )));
        bridge.borrow_mut().layout_tracker = Rc::downgrade(&layout_tracker);

        let mut primary: Option<PrimaryWebview> = None;
        if !window_only {
            primary = Some(self.build_primary_webview(
                &owner,
                &window,
                &bridge,
                &event_outbox,
                html,
                url,
                &show_settings,
            )?);
        }

        apply_window_style(&bridge, &window)?;
        apply_window_icon_from_bridge(&bridge, &window)?;
        apply_initial_window_position(&window, tray_bounds);

        let app = NSApplication::sharedApplication(mtm);
        set_activation_policy(&app, show_settings.window.style.app_mode);
        ensure_standard_edit_menu(&app, mtm);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        if let Some(primary) = primary.as_ref() {
            focus_webview_responder(&window, primary.webview.as_ref());
        }
        window.makeKeyAndOrderFront(None);
        // Accessory apps do not reliably surface new windows with key-ordering alone.
        // Force the window onto the current space so a CLI-launched webview can actually
        // be seen without promoting the whole process into a Dock app.
        window.orderFrontRegardless();

        let focus_observers =
            install_focus_observers(&window, &bridge, Rc::downgrade(&focus_tracker));
        let layout_observers = install_layout_observers(&window, Rc::downgrade(&layout_tracker));
        let window_delegate = RetainedWindowDelegate::install(&window, Rc::downgrade(&bridge), mtm);

        let mut session = WindowSession {
            window: window.clone(),
            bridge: bridge.clone(),
            webviews: HashMap::new(),
            event_outbox: event_outbox.clone(),
            focus_tracker: focus_tracker.clone(),
            layout_tracker: layout_tracker.clone(),
            _focus_observers: focus_observers,
            _layout_observers: layout_observers,
            _window_delegate: window_delegate,
            content_descriptor: content_descriptor.clone(),
            show_settings,
            window_only,
        };
        if let Some(primary) = primary {
            let primary_id = primary.webview_id.clone();
            let webview = primary.webview;
            let mut download_delegate = primary.download_delegate;
            focus_tracker
                .borrow_mut()
                .add_target(&primary_id, webview.as_ref(), Rc::clone(&primary.events));
            layout_tracker
                .borrow_mut()
                .add_webview(&primary_id, webview.as_ref(), Rc::clone(&primary.events));
            self.registry
                .add_view(&tray_id, Rc::clone(&primary.events))
                .map_err(orchestration_error)?;
            session.webviews.insert(
                primary_id,
                NativeWebview {
                    webview,
                    _download_navigation_delegate: download_delegate.take(),
                    content_descriptor: content_descriptor.clone(),
                },
            );
        }
        self.sessions.insert(tray_id.clone(), session);
        focus_tracker.borrow().reconcile(&window);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn build_primary_webview(
        &self,
        owner: &WindowOwner,
        window: &Retained<NSWindow>,
        bridge: &Rc<RefCell<NavigatorWindowBridge>>,
        event_outbox: &Rc<RefCell<VecDeque<WebviewEventFrame>>>,
        html: Option<String>,
        url: Option<String>,
        show_settings: &WebviewShowSettings,
    ) -> Result<PrimaryWebview, WebviewRuntimeError> {
        let host_view = AppKitViewHandle::new(
            bridge
                .borrow()
                .content_view
                .clone()
                .ok_or_else(|| WebviewRuntimeError::Internal("webview window has no content view".into()))?,
        );
        let webview_id = DEFAULT_WEBVIEW_ID.to_string();
        let policy = primary_bridge_policy(show_settings);
        let events = Rc::new(RefCell::new(ViewEvents::new(
            webview_id.clone(),
            policy,
        )));
        let initial_url = url.clone().unwrap_or_default();
        events
            .borrow_mut()
            .note_url_change(owner, &owner.window_id, initial_url);

        let bridge_for_ipc = Rc::clone(bridge);
        let window_for_ipc = window.clone();
        let webview_id_for_ipc = webview_id.clone();
        let bridge_for_title = Rc::clone(bridge);
        let window_for_title = window.clone();
        let events_for_title = Rc::clone(&events);
        let owner_for_title = owner.clone();
        let outbox_for_title = Rc::downgrade(event_outbox);
        let bridge_for_page_load = Rc::clone(bridge);
        let events_for_page_load = Rc::clone(&events);
        let owner_for_page_load = owner.clone();
        let outbox_for_page_load = Rc::downgrade(event_outbox);
        if std::env::var_os("OPENTRAY_WEBVIEW_DEBUG").is_some() {
            eprintln!(
                "opentray-ext-webview create window session: tray_id={} url={:?} html={} native_window={} native_screen={}",
                owner.tray_id,
                url,
                html.is_some(),
                show_settings.navigator_window.enabled,
                show_settings.navigator_screen.enabled
            );
        }
        let builder = WebViewBuilder::new()
            .with_initialization_script(navigator_window_bootstrap_script(
                show_settings.navigator_window,
                false,
                show_settings.navigator_screen,
                show_settings.navigator_tray,
                show_settings.window.sync.title,
                show_settings.window.sync.icon,
                &show_settings.native_api_policy,
                &show_settings.permission_manager_policy,
                // The primary webview keeps the legacy bridge projection:
                // message-channel surfaces belong to orchestration-era
                // children with an explicit policy (primary_bridge_policy).
                false,
                false,
                DEFAULT_WEBVIEW_ID,
            ))
            .with_ipc_handler(move |request| {
                handle_navigator_window_request(
                    request.body(),
                    &bridge_for_ipc,
                    &window_for_ipc,
                    &webview_id_for_ipc,
                );
            })
            .with_document_title_changed_handler(move |title| {
                // D19: per-view titleChange pushes straight from the native
                // observer; window title sync stays the window-level surface.
                handle_view_title_changed(&events_for_title, &outbox_for_title, &owner_for_title, &title);
                handle_document_title_changed(&bridge_for_title, &window_for_title, title);
            })
            .with_on_page_load_handler(move |event, url| {
                update_page_access_for_url(&bridge_for_page_load, &url);
                if matches!(event, PageLoadEvent::Started) {
                    handle_view_url_started(
                        &events_for_page_load,
                        &outbox_for_page_load,
                        &owner_for_page_load,
                        &url,
                    );
                }
                if matches!(event, PageLoadEvent::Finished) {
                    if let Err(error) = sync_native_metadata_to_page(&bridge_for_page_load) {
                        eprintln!("opentray-ext-webview metadata sync failed: {error}");
                    }
                }
            })
            .with_download_started_handler(|_, _| true)
            .with_download_completed_handler(|_, _, _| {})
            .with_devtools(show_settings.window.devtools)
            // `style.background` is mutable after the WebView is created. Keep WKWebView
            // alpha-capable from creation time, then let `apply_window_style` choose the
            // actual opaque or clear backing color for the current style.
            .with_transparent(true);
        let builder = if let Some(url) = url {
            builder.with_url(url)
        } else {
            builder.with_html(html.unwrap_or_else(default_webview_html))
        };
        let mut webview = Box::new(
            builder
                // ext-webview owns the NSWindow, while Wry owned the AppKit view wiring for the
                // WKWebView. Using Wry's normal window installation keeps autoresizing, focus, IPC,
                // and page rendering on the path Wry validates for macOS. This primary webview is
                // the "single layer, single fill" default layout (D8): it fills the content view
                // and resizes with the window until an explicit layout replaces it.
                .build(&host_view)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?,
        );
        let download_navigation_delegate =
            install_download_navigation_delegate(webview.as_ref(), bridge)?;
        register_bridge_view(bridge, &webview_id, policy, webview.as_mut());
        Ok(PrimaryWebview {
            webview_id,
            webview,
            download_delegate: Some(download_navigation_delegate),
            events,
        })
    }

    fn focus_window(&self, tray_id: &str) -> Result<(), WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        if let Some(session) = self.session(tray_id) {
            let app = NSApplication::sharedApplication(mtm);
            set_activation_policy(&app, !self.app_mode_windows.is_empty());
            #[allow(deprecated)]
            app.activateIgnoringOtherApps(true);
            if let Some(webview) = primary_webview(&session.bridge) {
                focus_webview_responder(&session.window, unsafe { webview.as_ref() });
            }
            if session.window.isMiniaturized() {
                session.window.deminiaturize(None);
            }
            session.window.makeKeyAndOrderFront(None);
            session.window.orderFrontRegardless();
            session.focus_tracker.borrow().reconcile(&session.window);
        }
        Ok(())
    }

    fn destroy_window_session(&mut self, tray_id: &str) {
        self.registry.destroy_window(tray_id);
        if let Some(session) = self.sessions.remove(tray_id) {
            // Channel law (D20): window destruction is a destroy entrance —
            // open channels close with `window_destroyed`, endpoints still
            // live observe once, host observations ride this command's
            // response flush, and no tombstone survives the session.
            let pushes = session
                .bridge
                .borrow()
                .channels
                .borrow_mut()
                .close_all(opentray_spec::channel::ChannelCloseReason::WindowDestroyed);
            self::bridge::deliver_channel_pushes(&session.bridge, &pushes, None);
            let events = session
                .bridge
                .borrow()
                .channels
                .borrow_mut()
                .drain_host_events();
            self.pending_channel_events.extend(events);
            session.bridge.borrow_mut().app_region_drag.stop();
            session.window.setDelegate(None);
            session.window.close();
        }
        self.app_mode_windows.remove(tray_id);
        self.sync_activation_policy_if_available();
    }

    fn sync_activation_policy(&self) -> Result<(), WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        let app = NSApplication::sharedApplication(mtm);
        set_activation_policy(&app, !self.app_mode_windows.is_empty());
        Ok(())
    }

    fn sync_activation_policy_if_available(&self) {
        if let Some(mtm) = MainThreadMarker::new() {
            let app = NSApplication::sharedApplication(mtm);
            set_activation_policy(&app, !self.app_mode_windows.is_empty());
        }
    }

    fn reconcile_app_mode_window(&mut self, tray_id: &str) {
        let is_live_app_mode = self
            .session(tray_id)
            .map(|session| {
                session.bridge.borrow().style.app_mode && window_is_visible(&session.window)
            })
            .unwrap_or(false);
        if is_live_app_mode {
            self.app_mode_windows.insert(tray_id.to_string());
        } else {
            self.app_mode_windows.remove(tray_id);
        }
    }

    fn flush_pending_events(&mut self) -> Vec<WebviewEventFrame> {
        let mut frames = Vec::new();
        for session in self.sessions.values() {
            frames.extend(session.event_outbox.borrow_mut().drain(..));
        }
        frames
    }

    /// App identity of the owning extension instance (D18 owner tuple
    /// source). Set once at `opentray_ext_init`; the dispatch layer already
    /// rejects commands whose envelope app id differs from it.
    pub(crate) fn set_app_id(&mut self, app_id: &str) {
        self.app_id = Some(app_id.to_string());
    }

    fn app_id(&self) -> String {
        self.app_id
            .clone()
            .unwrap_or_else(|| "opentray.default".to_string())
    }
}

fn session_has_no_primary(session: &WindowSession) -> bool {
    // The session's creation-time `windowOnly` fact is authoritative:
    // `bridge.views.first()` would flip to Some() as soon as an
    // orchestration child registers, misreading a populated windowOnly
    // session as primary-bearing.
    session.window_only
}

/// Layout-command inputs: the registered webview id set (the view-id
/// registry the layout protocol validates against) and the live logical
/// client-area viewport.
fn session_layout_inputs(session: &WindowSession) -> (HashSet<String>, LogicalViewport) {
    let view_ids: HashSet<String> = session
        .bridge
        .borrow()
        .views
        .iter()
        .map(|view| view.id.clone())
        .collect();
    let size = session
        .window
        .contentView()
        .map(|view| view.frame().size)
        .unwrap_or_else(|| NSSize::new(0.0, 0.0));
    (
        view_ids,
        LogicalViewport {
            width: size.width,
            height: size.height,
        },
    )
}

/// The primary webview's bridge policy, projected from the legacy show
/// settings so `list-webviews` reports the bridge the primary really has.
/// `webviewId`/`messageChannels`/`nativeApi` surfaces belong to the
/// orchestration-era children only.
fn primary_bridge_policy(show_settings: &WebviewShowSettings) -> WebviewBridgePolicy {
    WebviewBridgePolicy {
        webview_id: false,
        message_channels: false,
        navigator_window: show_settings.navigator_window.enabled,
        navigator_screen: show_settings.navigator_screen.enabled,
        native_api: false,
    }
}

fn bridge_primary_id(bridge: &Rc<RefCell<NavigatorWindowBridge>>) -> Option<String> {
    bridge.borrow().views.first().map(|view| view.id.clone())
}

fn primary_webview(bridge: &Rc<RefCell<NavigatorWindowBridge>>) -> Option<NonNull<WebView>> {
    bridge.borrow().primary_webview()
}

fn register_bridge_view(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    webview_id: &str,
    policy: WebviewBridgePolicy,
    webview: &mut WebView,
) {
    bridge.borrow_mut().views.push(WebViewBridge {
        id: webview_id.to_string(),
        policy,
        webview: NonNull::from(webview),
        listeners: HashMap::new(),
        next_event_id: 1,
    });
}

fn orchestration_error(error: OrchestrationError) -> WebviewRuntimeError {
    WebviewRuntimeError::Rejected(
        serde_json::to_string(&error.envelope)
            .unwrap_or_else(|_| format!("orchestration error {:?}", error.code())),
    )
}

/// Failure modes of child webview creation: typed rejections (duplicate id)
/// carry the frozen envelope; runtime failures stay ABI errors.
enum ChildCreateError {
    Typed(OrchestrationError),
    Runtime(WebviewRuntimeError),
}

/// Serializes a typed orchestration rejection into the command response
/// data shape (`{ error: { code, message } }`).
fn typed_rejection(error: OrchestrationError) -> Value {
    serde_json::to_value(&error.envelope).unwrap_or(Value::Null)
}

/// Frozen `channel.error` frame as the command response data (typed
/// channel rejections are Ok-data, like orchestration rejections).
fn channel_error_frame(
    owner: &opentray_spec::webview::WebviewOwnerTuple,
    code: opentray_spec::webview::OrchestrationErrorCode,
    message: impl Into<String>,
) -> Value {
    serde_json::to_value(opentray_spec::channel::ChannelFrame::Error {
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
fn channel_target_error(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    target: &str,
) -> Option<OrchestrationError> {
    let state = bridge.borrow();
    let view = state.views.iter().find(|view| view.id == target);
    let Some(view) = view else {
        return Some(OrchestrationError::new(
            opentray_spec::webview::OrchestrationErrorCode::UnknownView,
            format!("webview id {target} is not registered in this window session"),
        ));
    };
    if !view.policy.message_channels {
        return Some(OrchestrationError::new(
            opentray_spec::webview::OrchestrationErrorCode::BridgeRequired,
            format!("webview {target} has no message-channel page bridge"),
        ));
    }
    None
}

fn unknown_view_envelope(
    owner: &opentray_spec::webview::WebviewOwnerTuple,
    webview_id: &str,
) -> Value {
    let _ = owner;
    typed_rejection(OrchestrationError::new(
        opentray_spec::webview::OrchestrationErrorCode::UnknownView,
        format!("webview id {webview_id} is not registered in this window session"),
    ))
}

fn unknown_window_envelope(
    owner: &opentray_spec::webview::WebviewOwnerTuple,
    window_id: &str,
) -> Value {
    let _ = owner;
    typed_rejection(OrchestrationError::new(
        opentray_spec::webview::OrchestrationErrorCode::UnknownView,
        format!("window id {window_id} does not match the tray's active webview window session"),
    ))
}

fn orphan_window_error(owner: &opentray_spec::webview::WebviewOwnerTuple) -> OrchestrationError {
    OrchestrationError::new(
        opentray_spec::webview::OrchestrationErrorCode::UnknownView,
        format!("tray {} has no native window session", owner.tray_id),
    )
}

/// Native history navigation through WKWebView (D2 back/forward). Mirrors
/// the existing native-penetration pattern of installing delegates directly
/// on the wry-owned WKWebView instance.
fn wkwebview_go_back(webview: &WebView) -> Result<(), WebviewRuntimeError> {
    let wk_webview = webview.webview();
    let wk: &WKWebView = unsafe { &*Retained::as_ptr(&wk_webview).cast::<WKWebView>() };
    unsafe {
        wk.goBack();
    }
    Ok(())
}

fn wkwebview_go_forward(webview: &WebView) -> Result<(), WebviewRuntimeError> {
    let wk_webview = webview.webview();
    let wk: &WKWebView = unsafe { &*Retained::as_ptr(&wk_webview).cast::<WKWebView>() };
    unsafe {
        wk.goForward();
    }
    Ok(())
}

fn set_activation_policy(app: &NSApplication, app_mode: bool) {
    let target_policy = if app_mode {
        NSApplicationActivationPolicy::Regular
    } else {
        NSApplicationActivationPolicy::Accessory
    };
    // Unchanged policy = no-op. This runs on every drain tick (~60Hz per
    // shown window); re-asserting an already-applied policy re-set the
    // application icon and re-rendered the Dock tile every tick — measured as
    // a steady ~60% single-core burn on an otherwise idle broker (2026-09-09
    // CPU diagnosis). AppKit's current value is the sole truth here, so no
    // runtime-side cache is needed.
    if app.activationPolicy() == target_policy {
        return;
    }
    // AppKit may re-read the carrier bundle artwork while promoting an accessory
    // process into a regular Dock application. Preserve the Core App projection
    // across that transition and explicitly invalidate the Dock tile afterward.
    let application_icon = app.applicationIconImage();
    app.setActivationPolicy(target_policy);
    if let Some(application_icon) = application_icon.as_deref() {
        unsafe { app.setApplicationIconImage(Some(application_icon)) };
        app.dockTile().display();
    }
}

fn ensure_session_reuse_allowed(
    current_bootstrap: WebviewSessionBootstrapSettings,
    requested_bootstrap: WebviewSessionBootstrapSettings,
    current_content: &WebviewContentDescriptor,
    requested_content: Option<&WebviewContentDescriptor>,
) -> Result<(), WebviewRuntimeError> {
    if current_bootstrap != requested_bootstrap {
        return Err(WebviewRuntimeError::Rejected(
            "show cannot change bootstrap-level webview session settings; destroy the session and show again".into(),
        ));
    }
    if let Some(requested_content) = requested_content {
        if current_content != requested_content {
            return Err(WebviewRuntimeError::Rejected(
                "show cannot replace existing webview content; use setContent, navigate, or destroy then show again".into(),
            ));
        }
    }
    Ok(())
}

fn explicit_content_descriptor(
    html: Option<&String>,
    url: Option<&String>,
) -> Option<WebviewContentDescriptor> {
    match (html, url) {
        (Some(html), None) => Some(WebviewContentDescriptor::Html(html.clone())),
        (None, Some(url)) => Some(WebviewContentDescriptor::Url(url.clone())),
        _ => None,
    }
}

fn initial_content_descriptor(
    html: Option<&String>,
    url: Option<&String>,
) -> WebviewContentDescriptor {
    explicit_content_descriptor(html, url).unwrap_or(WebviewContentDescriptor::DefaultHtml)
}

fn page_source_state_for_content(content: &WebviewContentDescriptor) -> PageSourceState {
    match content {
        WebviewContentDescriptor::Url(url) => PageSourceState {
            url: Some(url.clone()),
            host_html: false,
        },
        WebviewContentDescriptor::DefaultHtml | WebviewContentDescriptor::Html(_) => {
            PageSourceState {
                url: None,
                host_html: true,
            }
        }
    }
}

fn load_session_content(
    session: &mut WindowSession,
    webview_id: String,
    html: Option<String>,
    url: Option<String>,
    descriptor: WebviewContentDescriptor,
) -> Result<(), WebviewRuntimeError> {
    let native = session.webviews.get_mut(&webview_id).ok_or_else(|| {
        WebviewRuntimeError::Internal("primary webview missing from session".into())
    })?;
    // Content replacement is allowed to rebuild the page runtime, but it stays explicit and
    // tray-scoped so hide/show reuse keeps session state unless the caller asks for replacement.
    match &descriptor {
        WebviewContentDescriptor::Html(_) => {
            let html = html.expect("html descriptor requires html payload");
            native
                .webview
                .load_html(&html)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
        WebviewContentDescriptor::Url(_) => {
            let url = url.expect("url descriptor requires url payload");
            native
                .webview
                .load_url(&url)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
        WebviewContentDescriptor::DefaultHtml => {
            native
                .webview
                .load_html(&default_webview_html())
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
    }
    native.content_descriptor = descriptor.clone();

    let page_source = page_source_state_for_content(&descriptor);
    {
        let mut bridge = session.bridge.borrow_mut();
        bridge.page_source = page_source.clone();
        bridge.page_access = resolve_page_access(&session.show_settings, &page_source);
    }
    session.content_descriptor = descriptor;
    Ok(())
}

fn apply_reused_show_updates(
    session: &mut WindowSession,
    show_settings: &WebviewShowSettings,
) -> Result<(), WebviewRuntimeError> {
    if let Some(title) = show_settings.window.title.clone() {
        update_window_title(
            &session.bridge,
            &session.window,
            title.clone(),
            MetadataSource::Native,
        )?;
        session.show_settings.window.title = Some(title);
    }
    if let Some(icon) = show_settings.window.icon.clone() {
        update_window_icon(
            &session.bridge,
            &session.window,
            Some(icon.clone()),
            MetadataSource::Native,
        )?;
        session.show_settings.window.icon = Some(icon);
    }

    if show_settings.window.style_requested {
        let requested_style = WindowStyleState {
            app_mode: show_settings.window.style.app_mode,
            frameless: show_settings.window.style.frameless,
            resizable: show_settings
                .window
                .style
                .resizable
                .unwrap_or(!show_settings.window.style.frameless),
            resizable_override: show_settings.window.style.resizable,
            keep_on_top: show_settings.window.style.keep_on_top,
            auto_hide: show_settings.window.style.auto_hide,
            opacity: show_settings.window.style.opacity,
            background: show_settings.window.style.background.clone(),
            platform: self::style::WindowPlatformStyleState {
                macos: self::style::MacosWindowStyleState {
                    corner_radius: show_settings.window.style.platform.macos.corner_radius,
                },
            },
        };
        if session.bridge.borrow().style != requested_style {
            {
                let mut bridge = session.bridge.borrow_mut();
                bridge.style = requested_style;
            }
            apply_window_style(&session.bridge, &session.window)?;
            let response = session.bridge.borrow().style_json()?;
            emit_window_event(&session.bridge, "stylechange", response)?;
            emit_overlay_geometry_change_if_enabled(&session.bridge, &session.window)?;
            session.show_settings.window.style = show_settings.window.style.clone();
            session.show_settings.window.style_requested = true;
        }
    }

    Ok(())
}

fn apply_initial_window_position(
    window: &Retained<NSWindow>,
    tray_bounds: Option<opentray_spec::Rect>,
) {
    let Some(bounds) = tray_bounds else {
        window.center();
        return;
    };
    let frame = window.frame();
    let screens = MainThreadMarker::new()
        .map(NSScreen::screens)
        .map(|screens| {
            screens
                .iter()
                .map(|screen| ScreenPlacement {
                    frame: screen.frame(),
                    visible_frame: screen.visibleFrame(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(origin) = initial_window_origin(frame.size, bounds, &screens) {
        window.setFrameOrigin(origin);
    }
}

#[derive(Clone, Copy)]
struct ScreenPlacement {
    frame: NSRect,
    visible_frame: NSRect,
}

fn initial_window_origin(
    window_size: NSSize,
    tray_bounds: opentray_spec::Rect,
    screens: &[ScreenPlacement],
) -> Option<NSPoint> {
    let width = window_size.width;
    let height = window_size.height;
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return None;
    }
    let padding = 8.0;
    let tray_center_x = tray_bounds.x as f64 + tray_bounds.width as f64 / 2.0;
    let tray_center_y = tray_bounds.y as f64 + tray_bounds.height as f64 / 2.0;
    let preferred_x = tray_center_x - width / 2.0;
    let preferred_y = tray_bounds.y as f64 - height - padding;

    let Some(screen) = screens
        .iter()
        .find(|screen| rect_contains_point(screen.frame, tray_center_x, tray_center_y))
        .copied()
        .or_else(|| screens.first().copied())
    else {
        return Some(NSPoint::new(preferred_x, preferred_y));
    };

    Some(NSPoint::new(
        clamp_window_axis(
            preferred_x,
            screen.visible_frame.origin.x,
            screen.visible_frame.origin.x + screen.visible_frame.size.width - width,
        ),
        clamp_window_axis(
            preferred_y,
            screen.visible_frame.origin.y,
            screen.visible_frame.origin.y + screen.visible_frame.size.height - height,
        ),
    ))
}

fn rect_contains_point(rect: NSRect, x: f64, y: f64) -> bool {
    x >= rect.origin.x
        && x <= rect.origin.x + rect.size.width
        && y >= rect.origin.y
        && y <= rect.origin.y + rect.size.height
}

fn clamp_window_axis(value: f64, min: f64, max: f64) -> f64 {
    if !min.is_finite() || !max.is_finite() {
        return value;
    }
    if max < min {
        return min;
    }
    value.clamp(min, max)
}

fn ensure_devtools_ready(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<NonNull<WebView>, WebviewRuntimeError> {
    let bridge_state = bridge.borrow();
    if !bridge_state.devtools_enabled {
        return Err(WebviewRuntimeError::Unsupported(
            "devtools are not enabled for this WebView window".into(),
        ));
    }
    bridge_state.primary_webview().ok_or_else(|| {
        WebviewRuntimeError::Rejected("devtools require an active WebView window".into())
    })
}

pub(super) fn open_devtools(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<Value, WebviewRuntimeError> {
    let webview = ensure_devtools_ready(bridge)?;
    unsafe {
        webview.as_ref().open_devtools();
    }
    Ok(Value::Null)
}

pub(super) fn close_devtools(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<Value, WebviewRuntimeError> {
    let webview = ensure_devtools_ready(bridge)?;
    unsafe {
        webview.as_ref().close_devtools();
    }
    Ok(Value::Null)
}

pub(super) fn devtools_open_state(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<Value, WebviewRuntimeError> {
    let webview = ensure_devtools_ready(bridge)?;
    unsafe {
        return Ok(Value::Bool(webview.as_ref().is_devtools_open()));
    }
}

impl NavigatorWindowBridge {
    /// Transport pointer of the primary webview (legacy single-webview
    /// surface). `None` while a `windowOnly` session hosts no webview yet.
    pub(super) fn primary_webview(&self) -> Option<NonNull<WebView>> {
        self.views.first().map(|view| view.webview)
    }

    /// Transport pointer for one webview by id.
    pub(super) fn view_webview(&self, webview_id: &str) -> Option<NonNull<WebView>> {
        self.views
            .iter()
            .find(|view| view.id == webview_id)
            .map(|view| view.webview)
    }

    fn capabilities_json(&self) -> Result<Value, WebviewRuntimeError> {
        let devtools = self.devtools_enabled;
        serde_json::to_value(WindowCapabilities {
            app_mode: true,
            close: true,
            focus: true,
            r#move: true,
            resize: true,
            resizable: true,
            maximize: true,
            minimize: true,
            restore: true,
            window_state: true,
            overlay: self.page_access.window && self.navigator_window.window_controls_overlay,
            app_region_drag: self.page_access.window,
            frameless: true,
            keep_on_top: true,
            auto_hide: true,
            opacity: true,
            title: true,
            icon: true,
            devtools,
            devtools_closable: devtools,
            devtools_state_queryable: devtools,
            screen: self.page_access.screen,
            tray: self.page_access.tray,
            global_bindings_enabled: self.page_access.window_globals,
            global_bindings_supported: true,
            screen_bindings_enabled: self.page_access.screen_globals,
            screen_bindings_supported: true,
            platform: "macos",
            background: true,
            multiwebview: true,
            webview_navigation: true,
            focus_webview: true,
            webview_id: true,
            webview_bridge_policy: true,
            message_channels: true,
            // geometryChange joins the unified push family with the layout
            // batch (D23): layout commits and overlay metric changes now
            // recompute per-view projections natively.
            webview_push_events: vec!["urlChange", "titleChange", "focused", "geometryChange"],
            platform_capabilities: WindowPlatformCapabilities {
                macos: MacosWindowCapabilities {
                    background_materials: supported_background_effects()
                        .iter()
                        .map(|effect| (*effect).to_string())
                        .collect(),
                    semantic_backgrounds: vec!["blur".to_string()],
                    background_states: vec![
                        "followsWindowActiveState".to_string(),
                        "active".to_string(),
                        "inactive".to_string(),
                    ],
                    corner_radius: true,
                },
            },
        })
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }

    fn style_json(&self) -> Result<Value, WebviewRuntimeError> {
        serde_json::to_value(&self.style)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }

    fn add_listener(&mut self, webview_id: &str, event: String, handler_id: u32) -> Option<u32> {
        let view = self
            .views
            .iter_mut()
            .find(|view| view.id == webview_id)?;
        let event_id = view.next_event_id;
        view.next_event_id = view.next_event_id.wrapping_add(1);
        view.listeners
            .entry(event)
            .or_default()
            .push(NavigatorWindowListener {
                event_id,
                handler_id,
            });
        Some(event_id)
    }

    fn remove_listener(&mut self, webview_id: &str, event: &str, event_id: u32) {
        let Some(view) = self.views.iter_mut().find(|view| view.id == webview_id) else {
            return;
        };
        let Some(listeners) = view.listeners.get_mut(event) else {
            return;
        };
        listeners.retain(|listener| listener.event_id != event_id);
        if listeners.is_empty() {
            view.listeners.remove(event);
        }
    }

    /// Test-facing assertion helper: whether any webview holds a listener for
    /// the event. The runtime emit paths tolerate empty listener sets
    /// themselves, so nothing outside tests consults this.
    #[cfg_attr(not(test), allow(dead_code))]
    fn has_listener(&self, event: &str) -> bool {
        self.views
            .iter()
            .any(|view| view.listeners.get(event).is_some_and(|l| !l.is_empty()))
    }

    /// Listeners for one event across all webviews, tagged with the owning
    /// webview so the callback evaluates in the page that registered it.
    fn listeners_for(&self, event: &str) -> Vec<(String, NavigatorWindowListener)> {
        let mut routed = Vec::new();
        for view in &self.views {
            for listener in view.listeners.get(event).cloned().unwrap_or_default() {
                routed.push((view.id.clone(), listener));
            }
        }
        routed
    }

    /// Listeners for one event registered by exactly one webview (D23
    /// per-view projection pushes never fan out to unrelated pages).
    pub(super) fn listeners_for_view(
        &self,
        webview_id: &str,
        event: &str,
    ) -> Vec<(String, NavigatorWindowListener)> {
        self.views
            .iter()
            .filter(|view| view.id == webview_id)
            .flat_map(|view| {
                view.listeners
                    .get(event)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(move |listener| (view.id.clone(), listener))
            })
            .collect()
    }

    /// Snapshot of the translucency-affecting style facts (D6 checkpoints).
    pub(super) fn style_facts(&self) -> StyleFacts {
        StyleFacts {
            frameless: self.style.frameless,
            translucent_background: matches!(
                self.style.background,
                crate::WebviewWindowBackground::Transparent
                    | crate::WebviewWindowBackground::PlatformMaterial { .. }
                    | crate::WebviewWindowBackground::Semantic { .. }
            ),
        }
    }

    /// Drops one webview's bridge handle (destroy-webview). Listener and
    /// transport state for that page goes away with it.
    pub(super) fn remove_view(&mut self, webview_id: &str) {
        self.views.retain(|view| view.id != webview_id);
    }
}

fn focus_webview_responder(window: &NSWindow, webview: &WebView) {
    let webview = webview.webview();
    // WryWebView is an ObjC WKWebView subclass. objc2 exposes that first superclass,
    // but not every AppKit supertype as Rust `AsRef` impls, so the NSView/NSResponder
    // cast stays localized at the native AppKit boundary.
    let view = unsafe { &*Retained::as_ptr(&webview).cast::<NSView>() };
    let responder = unsafe { &*Retained::as_ptr(&webview).cast::<NSResponder>() };
    window.setInitialFirstResponder(Some(view));
    window.makeFirstResponder(Some(responder));
}

fn install_focus_observers(
    window: &Retained<NSWindow>,
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    focus_tracker: Weak<RefCell<FocusTracker>>,
) -> Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> {
    let center = NSNotificationCenter::defaultCenter();
    let window_object = window.as_ref();
    let focus_bridge = Rc::downgrade(bridge);
    let blur_bridge = Rc::downgrade(bridge);
    let blur_window = window.clone();
    let focus_window = window.clone();
    let focus_tracker_for_key = focus_tracker.clone();
    let focus_tracker_for_blur = focus_tracker;
    let focus_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        queue_window_event(&focus_bridge, "focus", json!({}));
        if let Some(tracker) = focus_tracker_for_key.upgrade() {
            tracker.borrow().reconcile(&focus_window);
        }
    });
    let blur_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        queue_window_event(&blur_bridge, "blur", json!({}));
        if let Some(tracker) = focus_tracker_for_blur.upgrade() {
            tracker.borrow().reconcile(&blur_window);
        }
        let Some(bridge) = blur_bridge.upgrade() else {
            return;
        };
        let should_hide = {
            let state = bridge.borrow();
            window_is_visible(&blur_window)
                && should_auto_hide_on_blur(state.style.auto_hide, state.style.keep_on_top)
        };
        if should_hide {
            if let Err(error) = close_window(&bridge, &blur_window) {
                eprintln!("opentray-ext-webview failed to auto-hide macOS window: {error}");
            }
        }
    });
    unsafe {
        vec![
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidBecomeKeyNotification),
                Some(window_object),
                None,
                &focus_block,
            ),
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidResignKeyNotification),
                Some(window_object),
                None,
                &blur_block,
            ),
        ]
    }
}

pub(super) fn queue_window_event(
    bridge: &std::rc::Weak<RefCell<NavigatorWindowBridge>>,
    event: &str,
    payload: Value,
) {
    let Some(bridge) = bridge.upgrade() else {
        return;
    };
    bridge
        .borrow_mut()
        .window_events
        .push_back(window_event_payload(event, &payload));
    if let Err(error) = emit_window_event(&bridge, event, payload) {
        eprintln!("opentray-ext-webview failed to emit macOS {event} event: {error}");
    }
}

pub(super) fn window_event_payload(event: &str, payload: &Value) -> Value {
    let mut value = json!({ "type": event });
    if let (Some(target), Some(source)) = (value.as_object_mut(), payload.as_object()) {
        for (key, payload_value) in source {
            target.insert(key.clone(), payload_value.clone());
        }
    }
    value
}

struct AppKitViewHandle {
    ns_view: Retained<NSView>,
}

impl AppKitViewHandle {
    fn new(ns_view: Retained<NSView>) -> Self {
        Self { ns_view }
    }
}

impl HasWindowHandle for AppKitViewHandle {
    fn window_handle(&self) -> Result<WindowHandle<'_>, raw_window_handle::HandleError> {
        let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(
            NonNull::from(<Retained<NSView> as AsRef<NSView>>::as_ref(&self.ns_view)).cast(),
        ));
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

#[cfg(test)]
mod tests;
