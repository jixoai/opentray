//! Windows multi-webview orchestration (`add-webview-orchestration` task
//! 4.1 — platform generalization of the macOS 3.3/3.4 batches).
//!
//! This module owns the Windows-native half of the orchestration laws while
//! reusing the platform-neutral decision cores (`crate::orchestration` for
//! owner tuples / style exclusivity / event sequence state, `crate::layout`
//! for the Taffy solve):
//!
//! - **D18 owner tuples:** [`WindowSession`] per tray, registered in the
//!   runtime's `WindowRegistry`; `session_closed` removes exactly the
//!   windows whose owner tuple matches the closing session.
//! - **D1 sibling views:** every webview of one window is a WebView2
//!   controller whose WRY child HWND is a sibling child of the same host
//!   HWND (`build_as_child`); stacking order is the child HWND z-order,
//!   re-applied by the layout transaction's restack pass.
//! - **Windows WebView2 Profile Law / shared environment:** one retained
//!   `WebContext` per window session (declared last so it drops after every
//!   controller); every controller — primary and orchestration children
//!   alike — is built from that same context, so they share one WebView2
//!   environment and one profile directory. Destroying one controller never
//!   disposes the environment; a controller creation failure reports the
//!   resolved profile path.
//! - **D7/D23 layout:** layout commits and window resizes run one native
//!   transaction — solve (logical px) → apply frames (controller bounds →
//!   WRY child bounds, DPI-converted at apply time) → box paint windows →
//!   z-order restack → per-view overlay/titlebar safe-area projection
//!   refresh with `geometryChange` pushes. The WM_SIZE ordering law (host
//!   paint → N controller bounds → WRY child bounds → parent-position
//!   notification) is preserved; every controller is updated in one resize
//!   pass.
//! - **D19 push events:** per-view `urlChange`/`titleChange` push from the
//!   wry page-load/title callbacks and `focused` edges from the WebView2
//!   controller GotFocus/LostFocus handlers, all through the D19 batch B
//!   routing seam ([`push_event_frame`]): `try_submit` into the host
//!   EventPort when the broker attached one, the session event outbox only
//!   as the declared legacy fallback — never through the 16 ms window-event
//!   drain.
//!
//! Typed orchestration rejections serialize the frozen
//! `{ error: { code, message } }` envelope as the command response data
//! (the extension ABI's own error channel is category-level).

use std::{
    cell::RefCell,
    collections::HashSet,
    collections::VecDeque,
    path::Path,
    ptr::NonNull,
    rc::{Rc, Weak},
};

use opentray_spec::webview::{
    WebviewBoxStyle, WebviewBridgePolicy, WebviewEventFrame, WebviewLayoutDocument,
    WebviewListEntry, WebviewLoadPhase, WebviewNavigationType, WebviewOrchestrationCommand,
    WebviewOrchestrationResult,
};
use serde_json::Value;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2NavigationCompletedEventArgs, ICoreWebView2NavigationStartingEventArgs,
};
use webview2_com::{
    take_pwstr, FocusChangedEventHandler, NavigationCompletedEventHandler,
    NavigationStartingEventHandler,
};
use windows_core::{BOOL, PWSTR};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetForegroundWindow, SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER,
};
use wry::{
    Rect as WryRect, WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows,
    WebViewExtWindows,
};

use crate::layout::{
    project_overlay_safe_area, solve_layout, LayoutSolution, LayoutViewKey, LogicalRect,
    LogicalViewport,
};
use crate::orchestration::{
    webview_creation_allowed, BlockedNavigationRing, OrchestrationError, ViewEvents, WindowOwner,
};

use super::box_view::{BoxHostWindow, PhysicalBoxRect};
use super::{
    appwindow_titlebar_metrics, backdrop_state_policy, client_webview_bounds,
    emit_window_event_to_view, handle_navigator_window_request, native_host_paint_policy,
    physical_client_size, sync_window_proc_state, webview_controller_rect, webview_parent_hwnd,
    windows_geometry, NavigatorWindowBridge, WebViewBridgeView, WebviewContentDescriptor,
    WebviewRuntimeError, WebviewShowSettings, Win32HostWindow, WindowSizeConstraints,
    WindowsBackdropStatePolicy, WindowsNativeHostPaint,
};

/// Owner identity + D19 push-event legacy fallback outbox shared between the
/// session, the bridge (through a weak handle), and the native observers. On
/// a direct-EventPort host the migrated five families (url/title/focus/
/// geometry/loadState) submit through `try_submit` and never touch this
/// queue; it stays only as the declared legacy delivery for hosts that never
/// attached a port. Every command response flushes it into extension
/// envelopes. This queue is deliberately separate from the legacy
/// `window_events` drain path.
pub(crate) struct SessionEventCore {
    pub owner: WindowOwner,
    pub outbox: VecDeque<WebviewEventFrame>,
    /// Owning instance's EventPort state (D19 final review B1): producers
    /// route through the port captured at session creation, never a
    /// process-wide latest.
    pub port: std::sync::Arc<crate::event_port::InstancePortState>,
}

/// Native focus reconciliation for one window (D19 `focused` edges): the
/// WebView2 controller GotFocus/LostFocus callbacks update the focused-view
/// id and emit both edges through the D19 batch B routing seam — pure push,
/// no polling, never the 16 ms drain.
pub(crate) struct FocusTracker {
    owner: WindowOwner,
    outbox: Weak<RefCell<SessionEventCore>>,
    targets: Vec<FocusTarget>,
    focused_view: Option<String>,
}

struct FocusTarget {
    webview_id: String,
    events: Rc<RefCell<ViewEvents>>,
}

impl FocusTracker {
    pub(super) fn new(owner: WindowOwner, outbox: Weak<RefCell<SessionEventCore>>) -> Self {
        Self {
            owner,
            outbox,
            targets: Vec::new(),
            focused_view: None,
        }
    }

    pub(super) fn add_target(&mut self, webview_id: &str, events: Rc<RefCell<ViewEvents>>) {
        self.targets.push(FocusTarget {
            webview_id: webview_id.to_string(),
            events,
        });
    }

    pub(super) fn remove_target(&mut self, webview_id: &str) {
        self.targets
            .retain(|target| target.webview_id != webview_id);
        if self.focused_view.as_deref() == Some(webview_id) {
            self.focused_view = None;
        }
    }

    fn emit_edges(&mut self) {
        let owner = self.owner.clone();
        let window_id = owner.window_id.clone();
        let focused = self.focused_view.clone();
        for target in &self.targets {
            let focused = Some(target.webview_id.as_str()) == focused.as_deref();
            let frame = target
                .events
                .borrow_mut()
                .focus_edge(&owner, &window_id, focused);
            push_event_frame(&self.outbox, frame);
        }
    }

    /// A controller reported focus gain (native GotFocus callback).
    pub(super) fn view_gained_focus(&mut self, webview_id: &str) {
        if self.focused_view.as_deref() == Some(webview_id) {
            return;
        }
        self.focused_view = Some(webview_id.to_string());
        self.emit_edges();
    }

    /// A controller reported focus loss. Focus transfers between sibling
    /// controllers deliver LostFocus(old) before GotFocus(new), so the
    /// losing edge emits first and the gaining edge follows — no churn.
    pub(super) fn view_lost_focus(&mut self, webview_id: &str) {
        if self.focused_view.as_deref() != Some(webview_id) {
            return;
        }
        self.focused_view = None;
        self.emit_edges();
    }

    /// The host window deactivated (WM_ACTIVATE inactive): no view of this
    /// window owns keyboard focus.
    pub(super) fn window_lost_focus(&mut self) {
        if self.focused_view.is_none() {
            return;
        }
        self.focused_view = None;
        self.emit_edges();
    }

    /// Explicit per-webview focus command: raise the window, move native
    /// focus into the controller, and reconcile edges from the tracker.
    pub(super) fn focus_view(
        &mut self,
        hwnd: HWND,
        webview_id: &str,
        webview: &WebView,
    ) -> Result<(), WebviewRuntimeError> {
        unsafe {
            SetForegroundWindow(hwnd);
        }
        webview
            .focus()
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        self.view_gained_focus(webview_id);
        Ok(())
    }
}

/// One native webview of a window session: the wry controller allocation
/// (stable heap address for the session's lifetime) and the shared per-view
/// event state (also registered in the runtime's `WindowRegistry` and focus
/// tracker).
pub(super) struct SessionWebview {
    pub id: String,
    pub webview: Box<WebView>,
    pub events: Rc<RefCell<ViewEvents>>,
}

/// One native window session owned by one tray (D18). Field order is
/// load-bearing for drop: the controllers close first, then the host HWND
/// destroys (taking its children with it), and the retained `WebContext`
/// — the shared WebView2 environment/profile owner — drops last, so the
/// environment provably outlives every child controller (Windows WebView2
/// Profile Law / shared-environment requirement).
pub(super) struct WindowSession {
    pub webviews: Vec<SessionWebview>,
    pub event_core: Rc<RefCell<SessionEventCore>>,
    pub focus_tracker: Rc<RefCell<FocusTracker>>,
    pub content_descriptor: WebviewContentDescriptor,
    pub show_settings: WebviewShowSettings,
    pub window: Box<Win32HostWindow>,
    pub bridge: Rc<RefCell<NavigatorWindowBridge>>,
    /// Retained WebContext of the session's shared WebView2 environment.
    /// MUST stay the last field (see struct docs).
    pub webview_context: WebContext,
}

impl Drop for WindowSession {
    fn drop(&mut self) {
        // Detach the WndProc state before any field drops so a message that
        // arrives mid-teardown cannot observe a half-dropped session.
        sync_window_proc_state(
            self.window.hwnd,
            None,
            None,
            Vec::new(),
            None,
            WindowsNativeHostPaint::None,
            WindowsBackdropStatePolicy::FollowWindowActivation,
            WindowSizeConstraints::default(),
        );
        self.window.detach_webview();
    }
}

impl WindowSession {
    /// Registers a controller into the session + bridge bookkeeping.
    pub(super) fn register_webview(
        &mut self,
        mut entry: SessionWebview,
        policy: WebviewBridgePolicy,
    ) {
        let id = entry.id.clone();
        let events = Rc::clone(&entry.events);
        let webview_ptr = NonNull::from(entry.webview.as_mut());
        self.bridge.borrow_mut().views.push(WebViewBridgeView::new(
            &id,
            policy,
            webview_ptr,
            events,
        ));
        self.webviews.push(entry);
        self.sync_proc_webviews();
    }

    /// Removes one webview's registration; the returned allocation closes
    /// its controller when dropped while the shared environment, profile
    /// state, and sibling controllers stay alive (Profile Law).
    pub(super) fn unregister_webview(&mut self, webview_id: &str) -> Option<SessionWebview> {
        self.bridge.borrow_mut().remove_view(webview_id);
        self.focus_tracker.borrow_mut().remove_target(webview_id);
        let index = self
            .webviews
            .iter()
            .position(|view| view.id == webview_id)?;
        let removed = self.webviews.remove(index);
        self.sync_proc_webviews();
        Some(removed)
    }

    /// Publishes the live controller pointer set to the WndProc state so
    /// the WM_SIZE/WM_PAINT resize passes cover every controller.
    pub(super) fn sync_proc_webviews(&mut self) {
        let webviews: Vec<NonNull<WebView>> = self
            .webviews
            .iter()
            .map(|view| NonNull::from(view.webview.as_ref()))
            .collect();
        let (paint, backdrop, constraints) = {
            let state = self.bridge.borrow();
            (
                native_host_paint_policy(&state.style),
                backdrop_state_policy(&state.style.background),
                state.size_constraints,
            )
        };
        sync_window_proc_state(
            self.window.hwnd,
            Some(NonNull::from(self.bridge.as_ref())),
            Some(NonNull::from(self.window.as_mut())),
            webviews,
            None,
            paint,
            backdrop,
            constraints,
        );
    }
}

/// Styles a controller-creation failure with the resolved profile path —
/// the Windows WebView2 Profile Law's error-shape contract.
pub(super) fn controller_creation_error(profile: &Path, cause: wry::Error) -> WebviewRuntimeError {
    WebviewRuntimeError::Internal(format!(
        "WebView2 creation failed using profile '{}': {cause}",
        profile.display()
    ))
}

/// Installs the per-controller GotFocus/LostFocus observers (D19 `focused`
/// edges, push-only). The handlers borrow the tracker weakly so the session
/// can tear down freely; WebView2 invokes them on the UI thread only.
pub(super) fn install_focus_observers(
    webview: &WebView,
    tracker: &Rc<RefCell<FocusTracker>>,
    webview_id: &str,
) -> Result<(), WebviewRuntimeError> {
    let controller = webview.controller();
    let gained_tracker = Rc::downgrade(tracker);
    let gained_id = webview_id.to_string();
    // Registration tokens are only needed to detach handlers explicitly; the
    // session drops whole controllers instead, and the closures hold the
    // tracker weakly, so the tokens are intentionally discarded.
    let mut gained_token = 0i64;
    unsafe {
        controller
            .add_GotFocus(
                &FocusChangedEventHandler::create(Box::new(move |_sender, _args| {
                    if let Some(tracker) = gained_tracker.upgrade() {
                        tracker.borrow_mut().view_gained_focus(&gained_id);
                    }
                    Ok(())
                })),
                &mut gained_token,
            )
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    let lost_tracker = Rc::downgrade(tracker);
    let lost_id = webview_id.to_string();
    let mut lost_token = 0i64;
    unsafe {
        controller
            .add_LostFocus(
                &FocusChangedEventHandler::create(Box::new(move |_sender, _args| {
                    if let Some(tracker) = lost_tracker.upgrade() {
                        tracker.borrow_mut().view_lost_focus(&lost_id);
                    }
                    Ok(())
                })),
                &mut lost_token,
            )
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    Ok(())
}

/// Installs the per-webview navigation lifecycle observers (D24
/// `loadState`, push-only). `NavigationStarting` emits `started` with the
/// navigation's URI; `NavigationCompleted` emits `finished`, or `failed`
/// with the numeric `WebErrorStatus` in `errorCode` when WebView2 reports
/// `IsSuccess = false`. Windows has no native navigation progress
/// surface, so `progress` stays absent (consumers render an
/// indeterminate affordance from the phase). Both handlers push through
/// the D19 batch B routing seam — `try_submit` on a direct-EventPort
/// host, the session outbox only as the legacy fallback — and never the
/// 16 ms window-event drain; they hold the event state weakly so the
/// session can tear down freely.
pub(super) fn install_load_state_observers(
    webview: &WebView,
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Weak<RefCell<SessionEventCore>>,
    owner: &WindowOwner,
) -> Result<(), WebviewRuntimeError> {
    let core = webview.webview();
    // The completed-navigation args carry no URI; the starting handler
    // records the pending navigation's URL so the completion (or failure)
    // frame reports the navigation it belongs to.
    let pending_url = Rc::new(RefCell::new(String::new()));
    // add-navigation-favicon-surface: navigation ids cancelled by a
    // declarative rule, each carrying the URL it was blocked for. A
    // cancelled WebView2 navigation still fires NavigationCompleted
    // (IsSuccess = false, OperationCanceled); the completed handler swaps
    // that platform status for the stable `navigation_blocked` code with
    // the blocked URL exactly once per id. R1 P1: the URL rides the entry
    // (the shared pending-url slot holds whatever navigation started last,
    // so a concurrent pair could misattribute the failure), and the ring
    // is bounded: entries whose completion never arrives (controller
    // teardown, pathological callbacks) age out instead of growing.
    let blocked_navigations = Rc::new(RefCell::new(BlockedNavigationRing::new(64)));

    let start_events = Rc::clone(events);
    let start_outbox = Weak::clone(outbox);
    let start_owner = owner.clone();
    let start_pending = Rc::clone(&pending_url);
    let start_blocked = Rc::clone(&blocked_navigations);
    let mut start_token = 0i64;
    unsafe {
        core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(
                move |_sender, args: Option<ICoreWebView2NavigationStartingEventArgs>| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let uri = {
                        let mut pointer = PWSTR::null();
                        args.Uri(&mut pointer)?;
                        take_pwstr(pointer)
                    };
                    let mut is_user_initiated = BOOL::default();
                    let _ = args.IsUserInitiated(&mut is_user_initiated);
                    let mut is_redirected = BOOL::default();
                    let _ = args.IsRedirected(&mut is_redirected);
                    let navigation_id = match (|| -> Result<u64, windows_core::Error> {
                        let mut id = 0u64;
                        args.NavigationId(&mut id)?;
                        Ok(id)
                    })() {
                        Ok(id) => id,
                        Err(error) => {
                            // R2 P2: an unreadable id never keys the ring.
                            // The blocked failure frame is emitted HERE
                            // (before the veto return), so the stable code
                            // cannot be lost; the completion's ordinary
                            // failed path may add one platform-coded
                            // OperationCanceled frame — the documented cost.
                            eprintln!(
                                "opentray-ext-webview NavigationStarting id read failed: {error}"
                            );
                            if !uri.is_empty()
                                && start_events.borrow().navigation_blocked(&uri)
                            {
                                push_view_event(
                                    &start_events,
                                    &start_outbox,
                                    &start_owner,
                                    |events, owner, window_id| {
                                        events.note_load_state(
                                            owner,
                                            window_id,
                                            WebviewLoadPhase::Failed,
                                            uri.clone(),
                                            Some(crate::orchestration::ViewEvents::BLOCKED_ERROR_CODE),
                                            None,
                                        )
                                    },
                                );
                                args.SetCancel(true)?;
                            }
                            return Ok(());
                        }
                    };
                    // The decision point: `navigationAction` observation
                    // first (Windows projection truth: IsRedirected maps to
                    // redirect exactly; an unredirected user-initiated
                    // navigation maps to link — link/form are not separable;
                    // everything else is other), then the synchronous rule
                    // veto. A blocked navigation never reports `started` and
                    // never seeds the pending url.
                    let navigation_type = if is_redirected.as_bool() {
                        WebviewNavigationType::Redirect
                    } else if is_user_initiated.as_bool() {
                        WebviewNavigationType::Link
                    } else {
                        WebviewNavigationType::Other
                    };
                    push_view_event(
                        &start_events,
                        &start_outbox,
                        &start_owner,
                        |events, owner, window_id| {
                            events.note_navigation_action(
                                owner,
                                window_id,
                                uri.clone(),
                                navigation_type,
                                Some(is_user_initiated.as_bool()),
                            )
                        },
                    );
                    let blocked = !uri.is_empty() && start_events.borrow().navigation_blocked(&uri);
                    if blocked {
                        // R2 P2: eviction is not silent loss — the evicted
                        // navigation's terminal failed frame is emitted now
                        // (its eventual completion misses the ring and runs
                        // the ordinary platform path).
                        let evicted =
                            start_blocked.borrow_mut().block(navigation_id, uri.clone());
                        if let Some((_, evicted_url)) = evicted {
                            push_view_event(
                                &start_events,
                                &start_outbox,
                                &start_owner,
                                |events, owner, window_id| {
                                    events.note_load_state(
                                        owner,
                                        window_id,
                                        WebviewLoadPhase::Failed,
                                        evicted_url,
                                        Some(crate::orchestration::ViewEvents::BLOCKED_ERROR_CODE),
                                        None,
                                    )
                                },
                            );
                        }
                        args.SetCancel(true)?;
                        return Ok(());
                    }
                    *start_pending.borrow_mut() = uri.clone();
                    push_view_event(
                        &start_events,
                        &start_outbox,
                        &start_owner,
                        |events, owner, window_id| {
                            events.note_load_state(
                                owner,
                                window_id,
                                WebviewLoadPhase::Started,
                                uri.clone(),
                                None,
                                None,
                            )
                        },
                    );
                    Ok(())
                },
            )),
            &mut start_token,
        )
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }

    let done_events = Rc::clone(events);
    let done_outbox = Weak::clone(outbox);
    let done_owner = owner.clone();
    let done_pending = Rc::clone(&pending_url);
    let done_blocked = Rc::clone(&blocked_navigations);
    let mut done_token = 0i64;
    unsafe {
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(
                move |_sender,
                      args: Option<ICoreWebView2NavigationCompletedEventArgs>| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut success = BOOL::default();
                    args.IsSuccess(&mut success)?;
                    // A rule-blocked navigation completes as cancelled;
                    // report the stable blocked code with the URL it was
                    // blocked for instead of the platform's
                    // OperationCanceled status (R1 P1: the shared pending
                    // slot is not authoritative for a cancelled pair).
                    let blocked_navigation_id =
                        match (|| -> Result<u64, windows_core::Error> {
                            let mut id = 0u64;
                            args.NavigationId(&mut id)?;
                            Ok(id)
                        })() {
                        Ok(id) => id,
                        Err(error) => {
                            // Invariant: a blocked navigation's stable failed
                            // frame was already emitted — at the veto (ring
                            // entry or eviction compensation) or at the
                            // starting-side id failure — so dropping this
                            // frame cannot lose the blocked code; it can
                            // only drop an ordinary platform frame.
                            eprintln!(
                                "opentray-ext-webview NavigationCompleted id read failed: {error}"
                            );
                            return Ok(());
                        }
                    };
                    let blocked_url = done_blocked.borrow_mut().take(blocked_navigation_id);
                    if let Some(url) = blocked_url {
                        push_view_event(
                            &done_events,
                            &done_outbox,
                            &done_owner,
                            |events, owner, window_id| {
                                events.note_load_state(
                                    owner,
                                    window_id,
                                    WebviewLoadPhase::Failed,
                                    url,
                                    Some(crate::orchestration::ViewEvents::BLOCKED_ERROR_CODE),
                                    None,
                                )
                            },
                        );
                        return Ok(());
                    }
                    let url = done_pending.borrow().clone();
                    if success.as_bool() {
                        push_view_event(
                            &done_events,
                            &done_outbox,
                            &done_owner,
                            |events, owner, window_id| {
                                events.note_load_state(
                                    owner,
                                    window_id,
                                    WebviewLoadPhase::Finished,
                                    url.clone(),
                                    None,
                                    None,
                                )
                            },
                        );
                    } else {
                        let mut status =
                            webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS(0);
                        args.WebErrorStatus(&mut status)?;
                        let error_code = status.0;
                        push_view_event(
                            &done_events,
                            &done_outbox,
                            &done_owner,
                            |events, owner, window_id| {
                                events.note_load_state(
                                    owner,
                                    window_id,
                                    WebviewLoadPhase::Failed,
                                    url.clone(),
                                    Some(error_code),
                                    None,
                                )
                            },
                        );
                    }
                    Ok(())
                },
            )),
            &mut done_token,
        )
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Layout transaction (D3–D8/D23 Windows face)
// ---------------------------------------------------------------------------

/// One unit of a layout apply pass, computed pure so the WM_SIZE ordering
/// law ("host paint → N controller bounds → WRY child bounds →
/// parent-position notification", one pass covering every controller) stays
/// unit-testable without a window server.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum ApplyStep {
    /// Controller bounds + WRY child bounds for one webview, physical px.
    ControllerBounds {
        id: String,
        physical: PhysicalBoxRect,
        visible: bool,
    },
    /// Box paint window geometry, physical px.
    BoxPaint {
        id: String,
        physical: PhysicalBoxRect,
        visible: bool,
    },
}

/// Pure apply plan for one solved layout against one scale factor.
#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct ApplyPlan {
    /// Steps in stacking order (bottom-to-top).
    pub steps: Vec<ApplyStep>,
    /// Bottom-to-top z-order keys driving the restack pass.
    pub z_keys: Vec<LayoutViewKey>,
}

fn logical_to_physical(value: f64, scale: f64) -> i32 {
    (value * scale).round().clamp(0.0, i32::MAX as f64) as i32
}

fn physical_rect(rect: LogicalRect, scale: f64) -> PhysicalBoxRect {
    PhysicalBoxRect {
        x: logical_to_physical(rect.x, scale),
        y: logical_to_physical(rect.y, scale),
        width: logical_to_physical(rect.width, scale),
        height: logical_to_physical(rect.height, scale),
    }
}

/// Computes the pure apply plan: per-view physical geometry (DPI-converted
/// at apply time from the logical solve) in stacking order, plus the
/// bottom-to-top z keys. The applier walks `steps` once — every controller
/// is updated in one pass.
pub(super) fn layout_apply_plan(solution: &LayoutSolution, scale: f64) -> ApplyPlan {
    let mut steps = Vec::with_capacity(solution.views.len());
    let mut z_keys = Vec::with_capacity(solution.views.len());
    for solved in &solution.views {
        z_keys.push(solved.key.clone());
        let physical = physical_rect(solved.rect, scale);
        let step = if solved.key.is_box {
            ApplyStep::BoxPaint {
                id: solved.key.id.clone(),
                physical,
                visible: solved.visible,
            }
        } else {
            ApplyStep::ControllerBounds {
                id: solved.key.id.clone(),
                physical,
                visible: solved.visible,
            }
        };
        steps.push(step);
    }
    ApplyPlan { steps, z_keys }
}

/// Effective layout document for one bridge: the explicit one, or the
/// default single-fill layout over the first registered webview. `None`
/// when the window hosts no webview and no explicit document exists.
fn effective_document(bridge: &NavigatorWindowBridge) -> Option<WebviewLayoutDocument> {
    if bridge.layout.document.is_none() && bridge.views.is_empty() {
        return None;
    }
    let first = bridge.views.first().map(|view| view.id.clone());
    Some(bridge.layout.effective_document(first.as_deref()))
}

/// Full layout transaction against the live window: solve the effective
/// document on the current viewport, then apply. Runs on layout commits,
/// webview create/destroy, and window resize (WM_SIZE/WM_PAINT paths) —
/// resize relayout never round-trips through JS (D7). Takes the bridge by
/// plain borrow so the WndProc path (which holds a `&RefCell` view of the
/// session's bridge) shares one implementation; `&Rc` callers deref-coerce.
pub(super) fn relayout(hwnd: HWND, bridge: &RefCell<NavigatorWindowBridge>) {
    let document = {
        let state = bridge.borrow();
        effective_document(&state)
    };
    let Some(document) = document else {
        return;
    };
    let Some(viewport) = logical_viewport(hwnd) else {
        return;
    };
    let Ok(solution) = solve_layout(&document, viewport) else {
        return;
    };
    apply_layout_solution(hwnd, bridge, &solution);
}

/// Applies an already-validated solution (the command path validates and
/// solves once, then hands the solution here; resize paths call
/// [`relayout`]). One transaction: apply frames → boxes → z-order →
/// projections. No bridge `borrow_mut` is held across a Win32 mutation
/// call.
pub(super) fn apply_layout_solution(
    hwnd: HWND,
    bridge: &RefCell<NavigatorWindowBridge>,
    solution: &LayoutSolution,
) {
    let scale = windows_geometry(hwnd).scale_factor();
    let plan = layout_apply_plan(solution, scale);

    // Phase 1 — webview frames: controller bounds then WRY child bounds per
    // view (the WM_SIZE ordering law), applied without a bridge borrow held
    // across the Win32 calls.
    let controller_targets: Vec<(String, NonNull<WebView>, PhysicalBoxRect, bool)> = {
        let state = bridge.borrow();
        plan.steps
            .iter()
            .filter_map(|step| match step {
                ApplyStep::ControllerBounds {
                    id,
                    physical,
                    visible,
                } => state
                    .views
                    .iter()
                    .find(|view| &view.id == id)
                    .map(|view| (id.clone(), view.webview, *physical, *visible)),
                ApplyStep::BoxPaint { .. } => None,
            })
            .collect()
    };
    for (id, webview, physical, visible) in controller_targets {
        let webview = unsafe { webview.as_ref() };
        if let Err(error) = apply_controller_frame(webview, physical) {
            eprintln!("opentray-ext-webview failed to apply layout bounds for {id}: {error}");
        }
        let _ = webview.set_visible(visible);
    }

    // Phase 2 — box paint windows (created/updated/removed against the
    // solved set; the box map lives on the bridge). Box Win32 calls stay
    // outside the borrow; only the map mutation borrows.
    let solved_boxes: Vec<(String, PhysicalBoxRect, bool, WebviewBoxStyle)> = plan
        .steps
        .iter()
        .filter_map(|step| match step {
            ApplyStep::BoxPaint {
                id,
                physical,
                visible,
            } => solution
                .views
                .iter()
                .find(|view| &view.key.id == id)
                .and_then(|view| view.box_style.clone())
                .map(|style| (id.clone(), *physical, *visible, style)),
            _ => None,
        })
        .collect();
    let existing_boxes: Vec<(String, PhysicalBoxRect, bool, WebviewBoxStyle)> = {
        let state = bridge.borrow();
        solved_boxes
            .iter()
            .filter(|(id, ..)| state.boxes.contains_key(id))
            .cloned()
            .collect()
    };
    for (id, physical, visible, style) in existing_boxes {
        if let Some(window) = bridge.borrow().boxes.get(&id) {
            window.update(&style, physical, visible, None);
        }
    }
    {
        let mut state = bridge.borrow_mut();
        let live: HashSet<&String> = solved_boxes.iter().map(|(id, ..)| id).collect();
        let mut created: Vec<(String, BoxHostWindow)> = Vec::new();
        state.boxes.retain(|id, _| live.contains(id));
        for (id, physical, visible, style) in &solved_boxes {
            if state.boxes.contains_key(id) {
                continue;
            }
            if let Ok(created_window) = BoxHostWindow::create(hwnd, style, *physical, *visible) {
                created.push((id.clone(), created_window));
            }
        }
        for (id, window) in created {
            state.boxes.insert(id, window);
        }
    }

    // Phase 3 — record applied geometry + stacking; restack the child HWNDs
    // when the z-order changed (layer array order is the stacking law).
    let z_changed = {
        let mut state = bridge.borrow_mut();
        let z_changed = state.layout.z_order != plan.z_keys;
        state.layout.rects.clear();
        for solved in &solution.views {
            state
                .layout
                .rects
                .insert(solved.key.id.clone(), solved.rect);
        }
        state.layout.z_order = plan.z_keys.clone();
        z_changed
    };
    if z_changed {
        restack_children(hwnd, bridge, &plan.z_keys);
    }

    // Phase 4 — hide webviews the solved tree no longer positions (their
    // browsing contexts stay alive; unreferenced views leave the
    // composition until a layout references them again).
    let unpositioned: Vec<NonNull<WebView>> = {
        let state = bridge.borrow();
        state
            .views
            .iter()
            .filter(|view| solution.rect_for(&view.id).is_none())
            .map(|view| view.webview)
            .collect()
    };
    for webview in unpositioned {
        let _ = unsafe { webview.as_ref() }.set_visible(false);
    }

    // Phase 5 — recompute per-view overlay/titlebar safe-area projections
    // and push `geometryChange` (D23) from the same recompute.
    refresh_overlay_projection(hwnd, bridge);
}

/// Applies one solved frame to a controller: WebView2 controller bounds
/// (origin 0,0 — the WRY child HWND carries the position) followed by the
/// synchronous WRY child HWND move, physical pixels end to end.
fn apply_controller_frame(
    webview: &WebView,
    physical: PhysicalBoxRect,
) -> Result<(), WebviewRuntimeError> {
    unsafe {
        webview
            .controller()
            .SetBounds(webview_controller_rect(
                physical.width.max(1),
                physical.height.max(1),
            ))
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    if let Some(child) = webview_parent_hwnd(webview) {
        set_child_window_bounds_at(child, physical)?;
    }
    Ok(())
}

/// Synchronous WRY child placement (position + size, physical px). Mirrors
/// the existing WM_SIZE path: wry's public `set_bounds` uses an async
/// child HWND move (`SWP_ASYNCWINDOWPOS`); the resize law requires the
/// synchronous form.
fn set_child_window_bounds_at(
    child: HWND,
    physical: PhysicalBoxRect,
) -> Result<(), WebviewRuntimeError> {
    let ok = unsafe {
        SetWindowPos(
            child,
            std::ptr::null_mut(),
            physical.x,
            physical.y,
            physical.width.max(1),
            physical.height.max(1),
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
    };
    if ok == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

/// Restacks the sibling child HWNDs (webview WRY children + box windows)
/// bottom-to-top. `SetWindowPos(hwnd, after, …)` places `hwnd` directly
/// below `after`, so the chain walks the top-first z list downward.
fn restack_children(
    _hwnd: HWND,
    bridge: &RefCell<NavigatorWindowBridge>,
    z_keys: &[LayoutViewKey],
) {
    let (boxes, webviews): (Vec<(String, HWND)>, Vec<(String, HWND)>) = {
        let state = bridge.borrow();
        let boxes = state
            .boxes
            .iter()
            .map(|(id, window)| (id.clone(), window.hwnd()))
            .collect();
        let webviews = state
            .views
            .iter()
            .filter_map(|view| {
                webview_parent_hwnd(unsafe { view.webview.as_ref() })
                    .map(|child| (view.id.clone(), child))
            })
            .collect();
        (boxes, webviews)
    };
    let stack: Vec<HWND> = z_keys
        .iter()
        .filter_map(|key| {
            if key.is_box {
                boxes
                    .iter()
                    .find(|(id, _)| id == &key.id)
                    .map(|(_, hwnd)| *hwnd)
            } else {
                webviews
                    .iter()
                    .find(|(id, _)| id == &key.id)
                    .map(|(_, hwnd)| *hwnd)
            }
        })
        .collect();
    let mut insert_after: HWND = HWND_TOP;
    for hwnd in stack.iter().rev() {
        unsafe {
            SetWindowPos(
                *hwnd,
                insert_after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        insert_after = *hwnd;
    }
}

/// Logical client-area viewport of the host window.
pub(super) fn logical_viewport(hwnd: HWND) -> Option<LogicalViewport> {
    let (width, height) = physical_client_size(hwnd)?;
    let scale = windows_geometry(hwnd).scale_factor();
    Some(LogicalViewport {
        width: width as f64 / scale,
        height: height as f64 / scale,
    })
}

/// Full-client logical rect (the default-layout view rect).
pub(super) fn full_client_logical_rect(hwnd: HWND) -> LogicalRect {
    let viewport = logical_viewport(hwnd).unwrap_or_default();
    LogicalRect::new(0.0, 0.0, viewport.width, viewport.height)
}

// ---------------------------------------------------------------------------
// D23 per-view overlay/titlebar safe-area projection
// ---------------------------------------------------------------------------

/// Window-level overlay safe area in logical client coordinates: the
/// AppWindowTitleBar insets (`LeftInset`/`RightInset`/`Height` — the
/// safe-area authority, read synchronously on the HWND-owning STA)
/// converted from physical to logical at the window's current scale. The
/// single projection source; per-view values derive from it through
/// [`project_overlay_safe_area`].
pub(super) fn window_overlay_safe_area(hwnd: HWND) -> Option<LogicalRect> {
    let metrics = appwindow_titlebar_metrics(hwnd).ok()?;
    let scale = windows_geometry(hwnd).scale_factor();
    let viewport = logical_viewport(hwnd)?;
    Some(overlay_safe_area_from_metrics(metrics, viewport, scale))
}

/// Pure safe-area face: physical AppWindowTitleBar insets + logical
/// viewport + scale factor → the logical window-level safe-area rect
/// (top-left origin, client-area coordinates). Unit-testable without a
/// window server.
pub(super) fn overlay_safe_area_from_metrics(
    metrics: super::WindowsTitlebarMetrics,
    viewport: LogicalViewport,
    scale: f64,
) -> LogicalRect {
    if scale <= 0.0 {
        return LogicalRect::default();
    }
    let left = (metrics.left_inset / scale).max(0.0);
    let right = (metrics.right_inset / scale).max(0.0);
    let height = (metrics.height / scale).max(0.0);
    LogicalRect::new(left, 0.0, (viewport.width - left - right).max(0.0), height)
}

/// Recomputes every view's overlay/titlebar projection and pushes both
/// surfaces from one recompute: the unified `geometryChange` frames through
/// the D19 batch B routing seam (subscribed views only, edge semantics), and
/// the frozen page-bridge `overlay.geometrychange` `{ rect | null }`
/// payload to the views that listen for it. A view without a recorded
/// layout rect fills the client area (the single-webview default-layout
/// regression path: full-window webviews keep today's values).
pub(super) fn refresh_overlay_projection(hwnd: HWND, bridge: &RefCell<NavigatorWindowBridge>) {
    let overlay_enabled = bridge.borrow().navigator_window.window_controls_overlay;
    if !overlay_enabled {
        return;
    }
    let Some(safe_area) = window_overlay_safe_area(hwnd) else {
        return;
    };
    let Some(core) = bridge.borrow().event_core.upgrade() else {
        return;
    };
    let owner = core.borrow().owner.clone();
    let window_id = owner.window_id.clone();
    let full_rect = full_client_logical_rect(hwnd);
    let views: Vec<(String, Rc<RefCell<ViewEvents>>, LogicalRect)> = {
        let state = bridge.borrow();
        state
            .views
            .iter()
            .map(|view| {
                let rect = state
                    .layout
                    .rects
                    .get(&view.id)
                    .copied()
                    .unwrap_or(full_rect);
                (view.id.clone(), Rc::clone(&view.events), rect)
            })
            .collect()
    };
    for (id, events, view_rect) in views {
        // The frozen wire/page payload DTO (field-isomorphic with the page
        // bridge's `overlay.geometrychange`); `null` when the view does not
        // intersect the overlay region.
        let projected =
            project_overlay_safe_area(safe_area, view_rect).map(|rect| rect.to_geometry_rect());
        let previous = events.borrow().overlay_rect;
        let frame = events
            .borrow_mut()
            .note_geometry_change(&owner, &window_id, projected);
        // D19 batch B: geometryChange is an Edge record through the
        // EventPort when attached; the outbox is only the legacy fallback
        // (see [`push_event_frame`]).
        push_event_frame(&Rc::downgrade(&core), frame);
        if previous != projected {
            // Frozen per-view page-bridge payload (D23): view-local logical
            // pixels, `null` when the view does not intersect the overlay
            // region. Only listening (bridged) pages observe it.
            if let Err(error) = emit_window_event_to_view(
                bridge,
                &id,
                "overlay.geometrychange",
                serde_json::json!({ "rect": projected }),
            ) {
                eprintln!("opentray-ext-webview failed to emit per-view geometry change: {error}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Orchestration command dispatch (frozen wire tags)
// ---------------------------------------------------------------------------

impl super::WindowsWebviewRuntime {
    /// Multi-webview orchestration commands. Typed rejections return the
    /// frozen `{ error: { code, message } }` envelope as the command
    /// response data, before any state changes (the ABI error channel is
    /// category-level and cannot carry the orchestration registry).
    pub(super) fn handle_orchestration(
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
                browser,
                favicon,
                navigation_rules,
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
                if let Some(rules) = navigation_rules.as_deref() {
                    if rules.iter().any(|rule| rule.pattern.trim().is_empty()) {
                        return Ok(typed_rejection(OrchestrationError::new(
                            opentray_spec::webview::OrchestrationErrorCode::InvalidPayload,
                            "navigation rules require a non-empty pattern",
                        )));
                    }
                }
                match self.create_child_webview(
                    &owner,
                    &window_id,
                    &webview_id,
                    url,
                    html,
                    policy,
                    browser,
                    favicon,
                    navigation_rules.unwrap_or_default(),
                ) {
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
                self.destroy_child_webview(&owner, &window_id, &webview_id);
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
                    webview2_go_back(native.webview.as_ref())?;
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
                    webview2_go_forward(native.webview.as_ref())?;
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
                let Some(native) = session.webviews.iter().find(|view| view.id == webview_id)
                else {
                    return Ok(unknown_view_envelope(&owner, &webview_id));
                };
                let hwnd = session.window.hwnd;
                session.focus_tracker.borrow_mut().focus_view(
                    hwnd,
                    &webview_id,
                    native.webview.as_ref(),
                )?;
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
            Command::GetWebviewFavicon {
                owner,
                window_id,
                webview_id,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    if !events.borrow().favicon_enabled {
                        return Ok(typed_rejection(OrchestrationError::new(
                            opentray_spec::webview::OrchestrationErrorCode::FaviconDisabled,
                            "get-webview-favicon requires the create option favicon: true",
                        )));
                    }
                    let events = events.borrow();
                    WebviewOrchestrationResult::GetWebviewFaviconResult {
                        owner,
                        window_id,
                        webview_id,
                        value: events
                            .favicon
                            .clone()
                            .map(|href| opentray_spec::webview::WebviewFaviconValue { href }),
                        seq: events.favicon_seq,
                    }
                }
                None => return Ok(unknown_view_envelope(&owner, &webview_id)),
            },
            Command::SetWebviewNavigationRules {
                owner,
                window_id,
                webview_id,
                rules,
            } => match self.view_events(&owner, &window_id, &webview_id) {
                Some(events) => {
                    if rules.iter().any(|rule| rule.pattern.trim().is_empty()) {
                        return Ok(typed_rejection(OrchestrationError::new(
                            opentray_spec::webview::OrchestrationErrorCode::InvalidPayload,
                            "navigation rules require a non-empty pattern",
                        )));
                    }
                    events.borrow_mut().navigation_rules = rules;
                    WebviewOrchestrationResult::WebviewAck {
                        owner,
                        command: "set-webview-navigation-rules".to_string(),
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
                let (view_ids, viewport) =
                    session_layout_inputs(&session.bridge, session.window.hwnd);
                match crate::layout::validated_solve(&layout, &|id| view_ids.contains(id), viewport)
                {
                    Err(error) => return Ok(typed_rejection(error)),
                    Ok(solution) => {
                        // One native transaction (D7/D23): store the document
                        // (the resize re-solve authority), then apply frames,
                        // boxes, stacking, and projections.
                        session.bridge.borrow_mut().layout.document = Some(layout);
                        apply_layout_solution(session.window.hwnd, &session.bridge, &solution);
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
                let first_view = session
                    .bridge
                    .borrow()
                    .views
                    .first()
                    .map(|view| view.id.clone());
                // Materialize the effective document (the default layout
                // becomes explicit on first update), merge the patch, then
                // re-validate — an inverted patch rejects before any state
                // changes, leaving the applied layout untouched.
                let mut document = {
                    let state = session.bridge.borrow();
                    state.layout.effective_document(first_view.as_deref())
                };
                if !crate::layout::apply_sizing_patch(&mut document, &view_id, &patch) {
                    return Ok(unknown_view_envelope(&owner, &view_id));
                }
                let (view_ids, viewport) =
                    session_layout_inputs(&session.bridge, session.window.hwnd);
                match crate::layout::validated_solve(
                    &document,
                    &|id| view_ids.contains(id),
                    viewport,
                ) {
                    Err(error) => return Ok(typed_rejection(error)),
                    Ok(solution) => {
                        session.bridge.borrow_mut().layout.document = Some(document);
                        apply_layout_solution(session.window.hwnd, &session.bridge, &solution);
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

    /// Resolves the window session addressed by an orchestration command.
    /// Returns `None` for unknown tray/window bindings; orchestration
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
    ) -> Result<&mut SessionWebview, Value> {
        if self.resolve_window(owner, window_id).is_none() {
            return Err(unknown_window_envelope(owner, window_id));
        }
        self.sessions
            .get_mut(&owner.tray_id)
            .and_then(|session| {
                session
                    .webviews
                    .iter_mut()
                    .find(|view| view.id == webview_id)
            })
            .ok_or_else(|| unknown_view_envelope(owner, webview_id))
    }

    /// Creates one sibling controller: registry handle first (duplicate ids
    /// reject with zero native state), then the native build from the
    /// session's shared WebContext, then registration into the session,
    /// focus tracker, bridge, and the layout transaction (the effective
    /// layout decides the child's place immediately).
    #[allow(clippy::too_many_arguments)]
    fn create_child_webview(
        &mut self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
        webview_id: &str,
        url: Option<String>,
        html: Option<String>,
        policy: WebviewBridgePolicy,
        browser: Option<opentray_spec::webview::WebviewBrowserOptions>,
        favicon: bool,
        navigation_rules: Vec<opentray_spec::webview::WebviewNavigationRule>,
    ) -> Result<(), ChildCreateError> {
        let window_owner = WindowOwner {
            app_id: owner.app_id.clone(),
            tray_id: owner.tray_id.clone(),
            session_id: Some(owner.session_id.clone()),
            window_id: window_id.to_string(),
        };
        let events = Rc::new(RefCell::new(ViewEvents::new(webview_id, policy)));
        events.borrow_mut().note_url_change(
            &window_owner,
            window_id,
            url.clone().unwrap_or_default(),
        );
        events.borrow_mut().navigation_rules = navigation_rules;
        events.borrow_mut().favicon_enabled = favicon;
        if let Err(error) = self.registry.add_view(&owner.tray_id, Rc::clone(&events)) {
            return Err(ChildCreateError::Typed(error));
        }

        let build = self.build_child_webview(
            &window_owner,
            webview_id,
            url,
            html,
            policy,
            browser.unwrap_or_default(),
            Rc::clone(&events),
            favicon,
        );
        match build {
            Ok(entry) => {
                let session = self
                    .sessions
                    .get_mut(&owner.tray_id)
                    .ok_or_else(|| ChildCreateError::Typed(orphan_window_error(owner)))?;
                session
                    .focus_tracker
                    .borrow_mut()
                    .add_target(webview_id, Rc::clone(&events));
                let hwnd = session.window.hwnd;
                session.register_webview(entry, policy);
                // The effective layout decides the child's place immediately:
                // referenced views move, unreferenced views stay hidden until
                // a layout claims them (default layout = first webview only).
                relayout(hwnd, &session.bridge);
                Ok(())
            }
            Err(error) => {
                self.registry.remove_view(&window_owner, webview_id);
                Err(ChildCreateError::Runtime(error))
            }
        }
    }

    /// Builds one orchestration child: same shared WebContext (environment +
    /// profile), per-webview bridge policy decides the bootstrap script, and
    /// the D19 observers push url/title straight into the outbox.
    #[allow(clippy::too_many_arguments)]
    fn build_child_webview(
        &mut self,
        window_owner: &WindowOwner,
        webview_id: &str,
        url: Option<String>,
        html: Option<String>,
        policy: WebviewBridgePolicy,
        browser: opentray_spec::webview::WebviewBrowserOptions,
        events: Rc<RefCell<ViewEvents>>,
        favicon: bool,
    ) -> Result<SessionWebview, WebviewRuntimeError> {
        // D26 popup capture: taken before the session borrow so the
        // new-window closure holds the tracker weakly (a runtime that is
        // gone denies popups instead of resurrecting bookkeeping).
        let popup_tracker = Rc::downgrade(&self.popups);
        let session = self
            .sessions
            .get_mut(&window_owner.tray_id)
            .ok_or_else(|| WebviewRuntimeError::Internal("window session missing".into()))?;
        let profile_path = session
            .webview_context
            .data_directory()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("<wry-default>"));
        let bridge = Rc::clone(&session.bridge);
        let outbox_for_title = Rc::downgrade(&session.event_core);
        let outbox_for_page_load = Rc::downgrade(&session.event_core);
        let events_for_title = Rc::clone(&events);
        let events_for_page_load = Rc::clone(&events);
        let owner_for_title = window_owner.clone();
        let owner_for_page_load = window_owner.clone();
        let bridge_for_channel_loads = Rc::downgrade(&bridge);
        let webview_id_for_channel_loads = webview_id.to_string();
        let tracker = Rc::clone(&session.focus_tracker);
        let devtools = session.show_settings.window.devtools;
        let host_window: &Win32HostWindow = &session.window;
        let event_core = Rc::downgrade(&session.event_core);
        // P1-1 structurization: one resolved popup policy per session. Future
        // popup configurability (e.g. window.toolbar carrier inheritance)
        // projects through PopupOpenContext, never loose captures here.
        let popup_context = super::popups::PopupOpenContext {
            session_id: window_owner.session_id.clone().unwrap_or_default(),
            opener_hwnd: host_window.hwnd,
        };

        // Browser options (per-webview): Windows' WebView2 default UA is
        // already a full Edge UA, so browserlike shaping is a no-op here —
        // only an explicit override or the autoplay switch act on the builder
        // below. Incognito would require a second ephemeral WebContext and
        // would change the profile law; absent stays the persistent profile.
        let browser_options = browser;

        let mut builder = WebViewBuilder::new_with_web_context(&mut session.webview_context)
            .with_document_title_changed_handler(move |title| {
                // D19: per-view titleChange pushes straight from the native
                // observer; window title metadata stays the primary
                // webview's surface.
                push_view_event(
                    &events_for_title,
                    &outbox_for_title,
                    &owner_for_title,
                    |events, owner, window_id| {
                        events.note_title_change(owner, window_id, title.clone())
                    },
                );
            })
            .with_on_page_load_handler(move |event, url| {
                if matches!(event, wry::PageLoadEvent::Started) {
                    push_view_event(
                        &events_for_page_load,
                        &outbox_for_page_load,
                        &owner_for_page_load,
                        |events, owner, window_id| {
                            events.note_url_change(owner, window_id, url.to_string())
                        },
                    );
                    // Channel law (D11): a document navigation closes the
                    // page-side endpoints. The helper discriminates the
                    // view's very first load (recorded in the bridge
                    // state) from later navigations, and drops pushes
                    // held back for a document that is being replaced.
                    if let Some(bridge) = bridge_for_channel_loads.upgrade() {
                        super::channels::handle_view_channel_navigation_started(
                            &bridge,
                            &webview_id_for_channel_loads,
                        );
                    }
                }
                if matches!(event, wry::PageLoadEvent::Finished) {
                    // The document can now consume channel pushes; flush
                    // everything held back for it.
                    if let Some(bridge) = bridge_for_channel_loads.upgrade() {
                        super::channels::handle_view_channel_page_finished(
                            &bridge,
                            &webview_id_for_channel_loads,
                        );
                    }
                }
            })
            .with_devtools(devtools)
            // Keep the controller alpha-capable from creation time (the
            // same creation rule as the primary webview).
            .with_transparent(true)
            // D26 auxiliary popups: every new-window navigation intent of
            // this webview (a[target], window.open, middle-click,
            // context-menu "open in new window") is handled by opening a
            // plain popup window that shares this session's WebView2
            // environment. `Create` makes wry set Handled=true and route
            // the navigation into the popup controller; `Deny` keeps the
            // request handled (never delegated to an external browser).
            .with_new_window_req_handler(move |_uri, features| {
                let Some(tracker) = popup_tracker.upgrade() else {
                    return wry::NewWindowResponse::Deny;
                };
                match super::popups::spawn_popup(&tracker, &popup_context, &features) {
                    Ok(core) => wry::NewWindowResponse::Create { webview: core },
                    Err(error) => {
                        eprintln!("opentray-ext-webview popup open failed: {error}");
                        wry::NewWindowResponse::Deny
                    }
                }
            });

        // Per-webview bridge policy (D2): a policy-less child gets no
        // bootstrap script and no ipc surface — the arbitrary-content
        // webview is bridgeless by default. The `favicon` create option is
        // the one exception: it injects the observe-only script (no bridge
        // surface) so a bridgeless view can still report favicon changes.
        if let Some(script) =
            crate::bootstrap::webview_bridge_bootstrap_script(policy, &webview_id, favicon)
                .or_else(|| favicon.then(crate::bootstrap::favicon_observe_only_script))
        {
            let bridge_for_ipc = Rc::clone(&bridge);
            let webview_id_for_ipc = webview_id.to_string();
            let events_for_favicon = Rc::clone(&events);
            let outbox_for_favicon = Rc::downgrade(&session.event_core);
            let owner_for_favicon = window_owner.clone();
            builder = builder
                .with_initialization_script(script)
                .with_ipc_handler(move |request| {
                    if favicon {
                        report_view_favicon(
                            request.body(),
                            &events_for_favicon,
                            &outbox_for_favicon,
                            &owner_for_favicon,
                        );
                    }
                    handle_navigator_window_request(
                        request.body(),
                        &bridge_for_ipc,
                        &webview_id_for_ipc,
                    );
                });
        }

        let initial_bounds = client_webview_bounds(host_window.hwnd).unwrap_or(WryRect {
            position: wry::dpi::PhysicalPosition::new(0, 0).into(),
            size: wry::dpi::PhysicalSize::new(1, 1).into(),
        });
        builder = builder.with_bounds(initial_bounds);
        if let Some(user_agent) = browser_options.resolved_user_agent() {
            builder = builder.with_user_agent(user_agent);
        }
        let builder = match (url, html) {
            (Some(url), None) => builder.with_url(url),
            (None, Some(html)) => builder.with_html(html),
            _ => unreachable!("create-webview content pair validated before build"),
        };
        let webview = Box::new(
            builder
                // D1: sibling native view inside the same host HWND. The
                // effective layout assigns the real bounds immediately
                // after the build returns.
                .with_autoplay(browser_options.autoplay())
                // Contract-5 (P1-4): trusted shell UI never shows the
                // engine's native context menu. Default resolution keys off
                // the bridge surface (any capability ⇒ no menu via
                // AreDefaultContextMenusEnabled); an explicit contextMenu
                // value wins either way.
                .with_default_context_menus(
                    browser_options.context_menu(policy.has_bridge_surface()),
                )
                .build_as_child(host_window)
                .map_err(|error| controller_creation_error(&profile_path, error))?,
        );
        install_focus_observers(webview.as_ref(), &tracker, webview_id)?;
        // D24 loadState: navigation lifecycle pushes from the raw
        // WebView2 callbacks into the same per-view outbox.
        install_load_state_observers(webview.as_ref(), &events, &event_core, window_owner)?;
        Ok(SessionWebview {
            id: webview_id.to_string(),
            webview,
            events,
        })
    }

    /// Destroys one sibling controller. Dropping the `Box<WebView>` closes
    /// the controller; the shared environment, profile state, and sibling
    /// controllers stay alive (Profile Law). The layout document keeps its
    /// declaration — the next solve simply positions nothing for the id.
    /// harden-lifecycle-ownership D2: view teardown is owner-validated —
    /// the addressed window must still be resident under the exact owner
    /// tuple, so a stale destroy can never strip a view from a session it
    /// no longer addresses.
    fn destroy_child_webview(
        &mut self,
        owner: &opentray_spec::webview::WebviewOwnerTuple,
        window_id: &str,
        webview_id: &str,
    ) {
        let expected = WindowOwner {
            app_id: owner.app_id.clone(),
            tray_id: owner.tray_id.clone(),
            session_id: Some(owner.session_id.clone()),
            window_id: window_id.to_string(),
        };
        if !self.registry.resident_matches(&expected) {
            return;
        }
        let Some(session) = self.sessions.get_mut(&owner.tray_id) else {
            self.registry.remove_view(&expected, webview_id);
            return;
        };
        // Channel law (D11/D20): peer teardown closes the destroyed view's
        // channels first, while the surviving endpoints' pages are still
        // live to observe through. The pure registry skips pushes
        // addressed to the dying view itself.
        let pushes = session
            .bridge
            .borrow()
            .channels
            .borrow_mut()
            .close_channels_of_webview(
                webview_id,
                opentray_spec::channel::ChannelCloseReason::PeerWebviewDestroyed,
            );
        super::channels::deliver_channel_pushes(&session.bridge, &pushes, None);
        {
            let mut bridge = session.bridge.borrow_mut();
            bridge.channel_loaded_views.remove(webview_id);
            bridge.channel_live_views.remove(webview_id);
            bridge.pending_channel_pushes.remove(webview_id);
        }
        let removed = session.unregister_webview(webview_id);
        drop(removed);
        let hwnd = session.window.hwnd;
        relayout(hwnd, &session.bridge);
        self.registry.remove_view(&expected, webview_id);
    }
}

/// D19 batch B routing seam for the five push-event families. When the
/// broker attached an EventPort, the frame goes straight into the host
/// EventHub (`try_submit` under the frozen classification table; Edge
/// backpressure parks in the extension's bounded retry queue) — the
/// command-response outbox is retired for migrated families so one event can
/// never ride both paths. When no port was ever attached (legacy host), the
/// declared legacy fallback keeps the outbox/response-flush delivery.
pub(super) fn push_event_frame(
    outbox: &Weak<RefCell<SessionEventCore>>,
    frame: Option<WebviewEventFrame>,
) {
    let Some(frame) = frame else {
        return;
    };
    let Some(core) = outbox.upgrade() else {
        return;
    };
    // Direct delivery through the hub; every non-legacy outcome consumed the
    // frame (Edge backpressure already parked in the extension retry queue).
    // The port is the session core's captured instance state (B1), never a
    // process-wide latest.
    let status = core.borrow().port.submit_frame(&frame);
    if matches!(status, crate::event_port::SubmitStatus::LegacyFlush) {
        core.borrow_mut().outbox.push_back(frame);
    }
}

/// add-navigation-favicon-surface: page-side favicon reports turned into
/// per-view `faviconChange` frames (Latest class). Shared shape with the
/// macOS bridge interceptor; the observe-only bootstrap script and the
/// bridged observer both post `opentray.window.sync::pageIconChanged`.
fn report_view_favicon(
    message: &str,
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Weak<RefCell<SessionEventCore>>,
    owner: &WindowOwner,
) {
    let Ok(value) = serde_json::from_str::<Value>(message) else {
        return;
    };
    if value.get("namespace").and_then(Value::as_str) != Some("opentray.window.sync")
        || value.get("cmd").and_then(Value::as_str) != Some("pageIconChanged")
    {
        return;
    }
    let Some(reported) = value
        .get("payload")
        .and_then(|payload| payload.get("href"))
        .and_then(Value::as_str)
    else {
        return;
    };
    // Spec: the frame carries an absolute http(s) href resolved against the
    // document URL (also rejects data:/blob:/file: reports).
    let base = events.borrow().url.clone();
    let Some(href) = crate::orchestration::resolve_webview_favicon_href(&base, reported) else {
        return;
    };
    push_view_event(events, outbox, owner, |events, owner, window_id| {
        events.note_favicon_change(owner, window_id, href)
    });
}

/// Pushes one D19 event frame from a native observer through the routing
/// seam ([`push_event_frame`]).
fn push_view_event(
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Weak<RefCell<SessionEventCore>>,
    owner: &WindowOwner,
    make: impl FnOnce(&mut ViewEvents, &WindowOwner, &str) -> Option<WebviewEventFrame>,
) {
    let frame = make(&mut events.borrow_mut(), owner, &owner.window_id);
    push_event_frame(outbox, frame);
}

/// Native history navigation through WebView2 (`ICoreWebView2::GoBack` /
/// `GoForward`), mirroring the macOS WKWebView penetration pattern.
fn webview2_go_back(webview: &WebView) -> Result<(), WebviewRuntimeError> {
    unsafe { webview.webview().GoBack() }
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn webview2_go_forward(webview: &WebView) -> Result<(), WebviewRuntimeError> {
    unsafe { webview.webview().GoForward() }
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

/// Layout-command inputs: the registered webview id set (the view-id
/// registry the layout protocol validates against) and the live logical
/// client-area viewport.
pub(super) fn session_layout_inputs(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    hwnd: HWND,
) -> (HashSet<String>, LogicalViewport) {
    let view_ids: HashSet<String> = {
        let state = bridge.borrow();
        state.views.iter().map(|view| view.id.clone()).collect()
    };
    let viewport = logical_viewport(hwnd).unwrap_or_default();
    (view_ids, viewport)
}

/// Failure modes of child webview creation: typed rejections (duplicate id)
/// carry the frozen envelope; runtime failures stay ABI errors.
pub(super) enum ChildCreateError {
    Typed(OrchestrationError),
    Runtime(WebviewRuntimeError),
}

/// Serializes a typed orchestration rejection into the command response
/// data shape (`{ error: { code, message } }`).
pub(super) fn typed_rejection(error: OrchestrationError) -> Value {
    serde_json::to_value(&error.envelope).unwrap_or(Value::Null)
}

pub(super) fn unknown_view_envelope(
    owner: &opentray_spec::webview::WebviewOwnerTuple,
    webview_id: &str,
) -> Value {
    let _ = owner;
    typed_rejection(OrchestrationError::new(
        opentray_spec::webview::OrchestrationErrorCode::UnknownView,
        format!("webview id {webview_id} is not registered in this window session"),
    ))
}

pub(super) fn unknown_window_envelope(
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

/// Converts a typed orchestration rejection into an ABI-level rejection
/// whose message carries the frozen envelope (the `show`-path form used
/// before any window state exists).
pub(super) fn orchestration_error(error: OrchestrationError) -> WebviewRuntimeError {
    WebviewRuntimeError::Rejected(
        serde_json::to_string(&error.envelope)
            .unwrap_or_else(|_| format!("orchestration error {:?}", error.envelope.error.code)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solved_column_with_box() -> LayoutSolution {
        // toolbar (44) / content (rest) plus one border box layer.
        let document: opentray_spec::webview::WebviewLayoutDocument =
            serde_json::from_value(serde_json::json!({
                "layers": [
                    { "root": { "dir": "column", "children": [
                        { "id": "toolbar", "height": 44 },
                        { "id": "content", "flex": 1 }
                    ]}},
                    { "root": { "kind": "box", "id": "ring", "width": 120, "height": 40 } }
                ]
            }))
            .expect("document");
        solve_layout(
            &document,
            LogicalViewport {
                width: 800.0,
                height: 600.0,
            },
        )
        .expect("solve")
    }

    /// The WM_SIZE ordering-law face: one apply pass covers every controller
    /// in stacking order (bottom-to-top), boxes included, and the z keys
    /// carry the layer-array stacking law.
    #[test]
    fn apply_plan_covers_all_controllers_in_one_pass_with_stacking_order() {
        let solution = solved_column_with_box();
        let plan = layout_apply_plan(&solution, 1.0);
        let ids: Vec<&str> = plan
            .steps
            .iter()
            .map(|step| match step {
                ApplyStep::ControllerBounds { id, .. } | ApplyStep::BoxPaint { id, .. } => {
                    id.as_str()
                }
            })
            .collect();
        assert_eq!(ids, vec!["toolbar", "content", "ring"]);
        assert!(matches!(plan.steps[0], ApplyStep::ControllerBounds { .. }));
        assert!(matches!(plan.steps[2], ApplyStep::BoxPaint { .. }));
        // Stacking keys: bottom-to-top, box on the top layer.
        assert_eq!(plan.z_keys.len(), 3);
        assert!(plan.z_keys[2].is_box);
        assert!(!plan.z_keys[0].is_box);
        // Every controller is positioned exactly once — a single pass.
        assert_eq!(
            plan.steps
                .iter()
                .filter(|step| matches!(step, ApplyStep::ControllerBounds { .. }))
                .count(),
            2
        );
    }

    /// Logical→physical conversion happens at apply time through the
    /// window's scale factor (D21).
    #[test]
    fn apply_plan_converts_logical_rects_through_the_scale_factor() {
        let solution = solved_column_with_box();
        let plan = layout_apply_plan(&solution, 2.0);
        match &plan.steps[0] {
            ApplyStep::ControllerBounds { physical, .. } => {
                assert_eq!(physical.y, 0);
                assert_eq!(physical.width, 1600);
                assert_eq!(physical.height, 88); // 44 logical * 2.0
            }
            other => panic!("toolbar must be the first controller step: {other:?}"),
        }
        match &plan.steps[1] {
            ApplyStep::ControllerBounds { physical, .. } => {
                assert_eq!(physical.y, 88);
                assert_eq!(physical.height, 1112); // 556 logical * 2.0
            }
            other => panic!("content must be the second controller step: {other:?}"),
        }
    }

    /// Controller creation failures name the resolved profile path — the
    /// Windows WebView2 Profile Law error shape.
    #[test]
    fn controller_creation_error_names_the_profile_path() {
        let error = controller_creation_error(
            Path::new(r"C:\home\.opentray\webview\1.0.0\caller"),
            wry::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "bootstrap failed",
            )),
        );
        let message = match error {
            WebviewRuntimeError::Internal(message) => message,
            other => panic!("expected internal error, got {other:?}"),
        };
        assert!(
            message.contains(r"webview\1.0.0\caller"),
            "message: {message}"
        );
        assert!(message.starts_with("WebView2 creation failed using profile"));
    }

    /// Focus tracker edges: gaining/losing a view and window deactivation
    /// emit exactly the expected edge frames with per-view sequences. The
    /// frames route through the batch B seam, which addresses the session
    /// core's captured per-instance EventPort state (B1); a fresh port-less
    /// state keeps this test on the legacy-flush leg regardless of the
    /// event_port fixture tests running concurrently in the same binary.
    #[test]
    fn focus_tracker_emits_push_edges_without_polling() {
        let owner = WindowOwner {
            app_id: "app".into(),
            tray_id: "tray".into(),
            session_id: Some("session".into()),
            window_id: "win".into(),
        };
        let core = Rc::new(RefCell::new(SessionEventCore {
            owner: owner.clone(),
            outbox: VecDeque::new(),
            port: std::sync::Arc::new(crate::event_port::InstancePortState::new()),
        }));
        let mut tracker = FocusTracker::new(owner, Rc::downgrade(&core));
        let toolbar = Rc::new(RefCell::new(ViewEvents::new(
            "toolbar",
            WebviewBridgePolicy::default(),
        )));
        let content = Rc::new(RefCell::new(ViewEvents::new(
            "content",
            WebviewBridgePolicy::default(),
        )));
        toolbar
            .borrow_mut()
            .subscribe(&[opentray_spec::webview::WebviewEventKind::Focused]);
        content
            .borrow_mut()
            .subscribe(&[opentray_spec::webview::WebviewEventKind::Focused]);
        tracker.add_target("toolbar", Rc::clone(&toolbar));
        tracker.add_target("content", Rc::clone(&content));

        tracker.view_gained_focus("content");
        let frames = core.borrow_mut().outbox.drain(..).collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].webview_id, "content");

        // Transfer content -> toolbar: losing edge first, gaining edge after.
        tracker.view_lost_focus("content");
        tracker.view_gained_focus("toolbar");
        let frames = core.borrow_mut().outbox.drain(..).collect::<Vec<_>>();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].webview_id, "content");
        assert!(matches!(
            frames[0].payload,
            opentray_spec::webview::WebviewEventPayload::Focused { focused: false }
        ));
        assert_eq!(frames[1].webview_id, "toolbar");
        assert!(matches!(
            frames[1].payload,
            opentray_spec::webview::WebviewEventPayload::Focused { focused: true }
        ));

        // Window deactivation clears the focused view with one losing edge.
        tracker.window_lost_focus();
        let frames = core.borrow_mut().outbox.drain(..).collect::<Vec<_>>();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].webview_id, "toolbar");
    }

    /// harden-lifecycle-ownership D2, Windows twin of the macOS seam: the
    /// window registry's destroy/remove APIs are owner-tuple validated, so
    /// a stale destroy collected by a closing session's sweep cannot
    /// remove a newer same-tray session that registered before the destroy
    /// step ran (registry level — the GUI paths run on Windows runners).
    #[test]
    fn late_destroy_cannot_remove_a_newer_same_tray_session() {
        use crate::orchestration::{DestroyOutcome, WindowRegistry, DEFAULT_WINDOW_ID};

        fn owner(tray: &str, session: Option<&str>) -> WindowOwner {
            WindowOwner {
                app_id: "app".to_string(),
                tray_id: tray.to_string(),
                session_id: session.map(str::to_string),
                window_id: DEFAULT_WINDOW_ID.to_string(),
            }
        }
        fn view(id: &str) -> Rc<RefCell<ViewEvents>> {
            Rc::new(RefCell::new(ViewEvents::new(
                id,
                opentray_spec::webview::WebviewBridgePolicy::default(),
            )))
        }

        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", Some("session-old")))
            .expect("old window");
        registry.add_view("tray-1", view("old-view")).expect("view");

        // Phase 1: the sweep collects the closing session's entries.
        let collected = registry.session_closed("session-old");
        assert_eq!(collected.len(), 1);
        let stale = collected[0]
            .owner
            .clone()
            .expect("attributed closing entry");

        // Phase 2: a new same-tray session becomes resident before the
        // destroy step runs.
        registry
            .open_window(owner("tray-1", Some("session-new")))
            .expect("new window");
        registry.add_view("tray-1", view("new-view")).expect("view");

        // Phase 3: the stale destroy is Superseded, cannot strip the newer
        // session's views, and the newer session survives whole.
        assert!(matches!(
            registry.destroy_window(&stale),
            DestroyOutcome::Superseded
        ));
        assert!(registry.remove_view(&stale, "new-view").is_none());
        assert_eq!(
            registry.window("tray-1").unwrap().view_ids(),
            vec!["new-view"]
        );
        assert_eq!(registry.session_closed("session-new").len(), 1);
        assert!(registry.window("tray-1").is_none());
    }
}
