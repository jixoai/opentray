//! Native layout transaction for macOS (add-webview-orchestration D5/D7/D23).
//!
//! [`LayoutTracker`] owns the native half of the declarative layout engine:
//! it holds the native webview targets (stable pointers into the window
//! session's `Box<WebView>` allocations — the FocusTracker pattern) plus the
//! layout-engine-owned box views, and runs the **layout commit transaction**:
//!
//! 1. solve (platform-neutral `crate::layout::solve_layout`, logical pixels);
//! 2. apply frames — wry `set_bounds` in logical pixels (wry converts
//!    through the window's current `backingScaleFactor`; an already-logical
//!    value passes through exactly), visibility from layer flags, box views
//!    created/updated/removed, z-order re-applied when stacking changed;
//! 3. recompute per-view overlay/titlebar safe-area projections and push
//!    `geometryChange` (unified event family) to subscribed views plus the
//!    page-bridge `overlay.geometrychange` to listening bridged views.
//!
//! Steps 1–3 run synchronously on the main thread inside one call, so no
//! page can observe a half-applied state between the commit's start and end:
//! script evaluations hop to the main queue and land strictly after the
//! transaction returns.
//!
//! Window resize (`windowDidResize`) re-runs the whole transaction natively —
//! the JS side never computes coordinates and no relayout IPC round-trips
//! (D7). During a live drag, per-view projection *pushes* are suppressed
//! until the drag ends (one final refresh) so a 60 Hz resize cannot flood
//! the event channel; the native geometry itself still tracks every tick.
//! Custom drag regions are event-driven on macOS (`startAppRegionDrag`
//! stores no static regions), so no stale translation can survive a commit;
//! Windows' static-region re-registration consumes
//! `crate::layout::translate_drag_region` in its generalization batch.

use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    ptr::NonNull,
    rc::{Rc, Weak},
};

use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{NSObjectProtocol, ProtocolObject},
    MainThreadMarker,
};
use objc2_app_kit::{
    NSView, NSWindow, NSWindowDidEndLiveResizeNotification, NSWindowDidResizeNotification,
    NSWindowWillStartLiveResizeNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter};
use opentray_spec::webview::{WebviewEventFrame, WebviewLayoutDocument};
use wry::{
    dpi::{LogicalPosition, LogicalSize},
    Rect as WryRect, WebView, WebViewExtMacOS,
};

use crate::layout::{
    project_overlay_safe_area, solve_layout, LayoutSolution, LogicalRect, LogicalViewport,
};
use crate::orchestration::{ViewEvents, WindowOwner};

use super::box_view::BoxBackgroundView;
use super::overlay::{emit_view_geometry_change, window_overlay_safe_area};
use super::NavigatorWindowBridge;

/// One native webview target. The `NonNull<WebView>` points into the window
/// session's `Box<WebView>` allocations, whose addresses are stable for the
/// session's lifetime (HashMap storage, never moved out); `view_ptr` is the
/// WKWebView's NSView for stacking operations — the FocusTracker ownership
/// model.
struct LayoutWebviewTarget {
    webview_id: String,
    webview: NonNull<WebView>,
    view_ptr: NonNull<NSView>,
    events: Rc<RefCell<ViewEvents>>,
}

/// Native layout engine for one window session.
pub(crate) struct LayoutTracker {
    owner: WindowOwner,
    bridge: Weak<RefCell<NavigatorWindowBridge>>,
    /// The AppKit window is held through an `objc2` weak ref: `load()`
    /// returns the live `Retained<NSWindow>` or `None` once the window is
    /// gone, matching the tracker's borrowed-observer role in the session.
    window: objc2::rc::Weak<NSWindow>,
    outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    webviews: Vec<LayoutWebviewTarget>,
    boxes: HashMap<String, Retained<BoxBackgroundView>>,
    /// Set once an explicit layout takes over bounds ownership: the primary
    /// webview's wry autoresizing (default-layout fill) is cleared exactly
    /// then, never before, so default single-view windows keep their
    /// zero-regression resize behavior.
    bounds_owned: bool,
    /// Live-resize gate for projection pushes (see module docs).
    in_live_resize: bool,
}

impl LayoutTracker {
    pub(super) fn new(
        owner: WindowOwner,
        bridge: Weak<RefCell<NavigatorWindowBridge>>,
        window: &Retained<NSWindow>,
        outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    ) -> Self {
        Self {
            owner,
            bridge,
            window: objc2::rc::Weak::from_retained(window),
            outbox,
            webviews: Vec::new(),
            boxes: HashMap::new(),
            bounds_owned: false,
            in_live_resize: false,
        }
    }

    /// Registers a native webview target (primary or created child).
    pub(super) fn add_webview(
        &mut self,
        webview_id: &str,
        webview: &WebView,
        events: Rc<RefCell<ViewEvents>>,
    ) {
        let wry_view = webview.webview();
        let view_ptr =
            NonNull::from(unsafe { &*Retained::as_ptr(&wry_view).cast::<NSView>() });
        self.webviews.push(LayoutWebviewTarget {
            webview_id: webview_id.to_string(),
            webview: NonNull::from(webview),
            view_ptr,
            events,
        });
    }

    /// Drops a webview target (destroy-webview); the layout document keeps
    /// its declaration and the next solve simply positions nothing for it.
    pub(super) fn remove_webview(&mut self, webview_id: &str) {
        self.webviews.retain(|target| target.webview_id != webview_id);
    }

    /// Full native transaction for the current layout state: solve the
    /// effective document against the live viewport, apply, and refresh
    /// projections. Runs on layout commits, webview create/destroy, and
    /// window resize.
    pub(super) fn relayout(&mut self) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let Some(document) = self.effective_document() else {
            return;
        };
        let Some(viewport) = self.viewport() else {
            return;
        };
        let Ok(solution) = solve_layout(&document, viewport) else {
            return;
        };
        self.apply_solution(&solution);
    }

    /// Applies an already-solved solution (the command path validates and
    /// solves once, then hands the solution to the transaction).
    pub(super) fn apply_solution(&mut self, solution: &LayoutSolution) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let Some(window) = self.window.load() else {
            return;
        };
        let Some(content_view) = window.contentView() else {
            return;
        };
        let content_height = content_view.frame().size.height;
        let explicit = self
            .bridge
            .upgrade()
            .is_some_and(|bridge| bridge.borrow().layout.document.is_some());
        if explicit && !self.bounds_owned {
            // First explicit layout: bounds ownership moves from wry's
            // autoresizing to the layout engine for every webview target.
            self.clear_webview_autoresizing();
            self.bounds_owned = true;
        }

        let mut next_z_order = Vec::new();
        for solved in &solution.views {
            next_z_order.push(solved.key.clone());
            if solved.key.is_box {
                self.apply_box(solved, &content_view, content_height);
            } else {
                self.apply_webview(solved);
            }
        }
        self.hide_unpositioned(solution);
        self.remove_dropped_boxes(solution);

        // Store the applied geometry, then reorder stacking when it changed.
        let z_changed = {
            let Some(bridge) = self.bridge.upgrade() else {
                return;
            };
            let mut state = bridge.borrow_mut();
            let layout = &mut state.layout;
            let z_changed = layout.z_order != next_z_order;
            layout.rects.clear();
            for solved in &solution.views {
                layout.rects.insert(solved.key.id.clone(), solved.rect);
            }
            layout.z_order = next_z_order;
            z_changed
        };
        if z_changed {
            self.restack(solution);
        }
        self.refresh_overlay_projection();
    }

    /// Re-solves nothing; refreshes per-view projections from the live
    /// window-level safe area and the last applied rects. Used when the
    /// overlay metric changed (style/size/scale) without a document change.
    pub(super) fn refresh_overlay_projection(&self) {
        let Some(window) = self.window.load() else {
            return;
        };
        let Some(bridge) = self.bridge.upgrade() else {
            return;
        };
        let page_bridge_enabled = {
            let state = bridge.borrow();
            state.page_access.window && state.navigator_window.window_controls_overlay
        };
        let safe_area = window_overlay_safe_area(&bridge, &window);
        let content_size = window
            .contentView()
            .map(|view| view.frame().size)
            .unwrap_or_default();
        let full_rect = LogicalRect::new(0.0, 0.0, content_size.width, content_size.height);

        for target in &self.webviews {
            // Default-layout invariant: a view with no recorded rect fills
            // the client area (the single-webview regression path).
            let view_rect = {
                let state = bridge.borrow();
                state
                    .layout
                    .rects
                    .get(&target.webview_id)
                    .copied()
                    .unwrap_or(full_rect)
            };
            let projected =
                project_overlay_safe_area(safe_area, view_rect).map(|rect| rect.to_geometry_rect());

            // Live-resize gate: cache silently during the drag; the DidEnd
            // refresh emits exactly one final projection change.
            if self.in_live_resize {
                target.events.borrow_mut().overlay_rect = projected;
                continue;
            }
            let changed = target.events.borrow().overlay_rect != projected;
            let frame = target.events.borrow_mut().note_geometry_change(
                &self.owner,
                &self.owner.window_id,
                projected,
            );
            if let Some(frame) = frame {
                if let Some(outbox) = self.outbox.upgrade() {
                    outbox.borrow_mut().push_back(frame);
                }
            }
            if changed && page_bridge_enabled {
                if let Err(error) =
                    emit_view_geometry_change(&bridge, &target.webview_id, projected)
                {
                    eprintln!(
                        "opentray-ext-webview failed to emit per-view geometry change: {error}"
                    );
                }
            }
        }
    }

    fn apply_webview(&mut self, solved: &crate::layout::SolvedView) {
        let Some(target) = self
            .webviews
            .iter()
            .find(|target| target.webview_id == solved.key.id)
        else {
            return;
        };
        let webview = unsafe { target.webview.as_ref() };
        let rect = solved.rect;
        if let Err(error) = webview.set_bounds(WryRect {
            position: LogicalPosition::new(rect.x, rect.y).into(),
            size: LogicalSize::new(rect.width, rect.height).into(),
        }) {
            eprintln!(
                "opentray-ext-webview failed to apply layout bounds for {}: {error}",
                solved.key.id
            );
        }
        if let Err(error) = webview.set_visible(solved.visible) {
            eprintln!(
                "opentray-ext-webview failed to apply layout visibility for {}: {error}",
                solved.key.id
            );
        }
    }

    fn apply_box(
        &mut self,
        solved: &crate::layout::SolvedView,
        content_view: &Retained<NSView>,
        content_height: f64,
    ) {
        let style = solved
            .box_style
            .clone()
            .unwrap_or_default();
        if let Some(view) = self.boxes.get(&solved.key.id) {
            view.update(&style, solved.rect, content_height);
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let view = BoxBackgroundView::create(&style, solved.rect, content_height, mtm);
        content_view.addSubview(view.as_ref());
        self.boxes.insert(solved.key.id.clone(), view);
    }

    /// Hides webview targets the solved tree does not position (destroyed or
    /// unreferenced views keep their native browsing context but leave the
    /// composition until a layout references them again).
    fn hide_unpositioned(&mut self, solution: &LayoutSolution) {
        for target in &self.webviews {
            if solution.rect_for(&target.webview_id).is_some() {
                continue;
            }
            let _ = unsafe { target.webview.as_ref() }.set_visible(false);
        }
    }

    /// Removes box views the new document dropped, detaching them from the
    /// view hierarchy before the last `Retained` goes away.
    fn remove_dropped_boxes(&mut self, solution: &LayoutSolution) {
        let dropped: Vec<Retained<BoxBackgroundView>> = {
            let live: Vec<&String> = solution
                .views
                .iter()
                .filter(|view| view.key.is_box)
                .map(|view| &view.key.id)
                .collect();
            let mut dropped = Vec::new();
            self.boxes.retain(|id, view| {
                if live.contains(&id) {
                    true
                } else {
                    dropped.push(view.clone());
                    false
                }
            });
            dropped
        };
        for view in dropped {
            view.removeFromSuperview();
        }
    }

    fn clear_webview_autoresizing(&mut self) {
        for target in &self.webviews {
            // WryWebView is a WKWebView subclass; the NSView cast stays
            // localized at the AppKit boundary (focus_webview_responder
            // pattern). An empty mask fixes the frame fully — the layout
            // transaction is the only bounds authority from here on.
            unsafe {
                (*target.view_ptr.as_ptr())
                    .setAutoresizingMask(objc2_app_kit::NSAutoresizingMaskOptions::ViewNotSizable)
            };
        }
    }

    /// Re-applies stacking order: our native views are detached and re-added
    /// bottom-to-top (AppKit stacks subviews in add order; later siblings
    /// paint above earlier ones — matching the protocol's stacking law).
    fn restack(&mut self, solution: &LayoutSolution) {
        let views: Vec<&NSView> = solution
            .views
            .iter()
            .filter_map(|solved| self.native_view(solved))
            .collect();
        for view in &views {
            (*view).removeFromSuperview();
        }
        let Some(window) = self.window.load() else {
            return;
        };
        let Some(content_view) = window.contentView() else {
            return;
        };
        for view in views {
            content_view.addSubview(view);
        }
    }

    /// Borrows the native NSView for one solved view. Webview pointers come
    /// from the registered targets (stable for the session lifetime); box
    /// views from this tracker's ownership map.
    fn native_view(&self, solved: &crate::layout::SolvedView) -> Option<&NSView> {
        if solved.key.is_box {
            // The reference stays valid for `&self` because the box map owns
            // a `Retained` for the session's lifetime.
            return self
                .boxes
                .get(&solved.key.id)
                .map(|view| unsafe { &*Retained::as_ptr(view).cast::<NSView>() });
        }
        let target = self
            .webviews
            .iter()
            .find(|target| target.webview_id == solved.key.id)?;
        Some(unsafe { target.view_ptr.as_ref() })
    }

    /// Effective document: the explicit one, or the default single-fill
    /// layout over the first registered webview. `None` when there is
    /// nothing to lay out (no explicit document and no webviews).
    fn effective_document(&self) -> Option<WebviewLayoutDocument> {
        let bridge = self.bridge.upgrade()?;
        let state = bridge.borrow();
        if state.layout.document.is_none() && state.views.is_empty() {
            return None;
        }
        let first = state.views.first().map(|view| view.id.clone());
        Some(state.layout.effective_document(first.as_deref()))
    }

    fn viewport(&self) -> Option<LogicalViewport> {
        let window = self.window.load()?;
        let size = window
            .contentView()
            .map(|view| view.frame().size)
            .unwrap_or_default();
        Some(LogicalViewport {
            width: size.width,
            height: size.height,
        })
    }

    /// Live-resize lifecycle (projection push gate; see module docs).
    pub(super) fn live_resize_began(&mut self) {
        self.in_live_resize = true;
    }

    pub(super) fn live_resize_ended(&mut self) {
        if !self.in_live_resize {
            return;
        }
        self.in_live_resize = false;
        self.refresh_overlay_projection();
    }

    /// Test accessor: the registered webview ids in registration order.
    #[cfg(test)]
    pub(super) fn webview_ids(&self) -> Vec<String> {
        self.webviews
            .iter()
            .map(|target| target.webview_id.clone())
            .collect()
    }
}

/// Installs the resize/live-resize observers that keep applied geometry and
/// projections tracking the window natively (D7: zero relayout IPC).
pub(super) fn install_layout_observers(
    window: &Retained<NSWindow>,
    tracker: Weak<RefCell<LayoutTracker>>,
) -> Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> {
    let center = NSNotificationCenter::defaultCenter();
    let window_object = window.as_ref();
    let resize_tracker = tracker.clone();
    let resize_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Some(tracker) = resize_tracker.upgrade() {
            if let Ok(mut tracker) = tracker.try_borrow_mut() {
                tracker.relayout();
            }
        }
    });
    let begin_tracker = tracker.clone();
    let begin_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Some(tracker) = begin_tracker.upgrade() {
            if let Ok(mut tracker) = tracker.try_borrow_mut() {
                tracker.live_resize_began();
            }
        }
    });
    let end_tracker = tracker;
    let end_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Some(tracker) = end_tracker.upgrade() {
            if let Ok(mut tracker) = tracker.try_borrow_mut() {
                tracker.live_resize_ended();
            }
        }
    });
    unsafe {
        vec![
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidResizeNotification),
                Some(window_object),
                None,
                &resize_block,
            ),
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowWillStartLiveResizeNotification),
                Some(window_object),
                None,
                &begin_block,
            ),
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidEndLiveResizeNotification),
                Some(window_object),
                None,
                &end_block,
            ),
        ]
    }
}
