use std::{cell::RefCell, rc::Rc};

use objc2::rc::Retained;
use objc2_app_kit::{NSWindow, NSWindowButton};
use opentray_spec::Rect;
use serde_json::{json, Value};

use crate::layout::{project_overlay_safe_area, LogicalRect, LogicalViewport};
use crate::WebviewRuntimeError;

use super::bridge::emit_window_event_to_view;
use super::NavigatorWindowBridge;

const DEFAULT_OVERLAY_HEIGHT: f64 = 44.0;
const CONTROL_CLUSTER_PADDING: f64 = 12.0;

/// Page-bridge `getTitlebarAreaRect` (D23): the window-level safe area
/// projected into the receiving webview's own viewport coordinates — the
/// intersection of the overlay region with that webview's current layout
/// rect, translated into view-local space; no intersection yields an empty
/// rect. A view with no recorded layout rect fills the client area (the
/// default single-fill layout), so full-window webviews keep reporting
/// exactly the window-level values they report today.
pub(super) fn titlebar_area_rect_json(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    source_webview: &str,
) -> Result<Value, WebviewRuntimeError> {
    let safe_area = window_overlay_safe_area(bridge, window);
    let content_size = window
        .contentView()
        .map(|view| LogicalViewport {
            width: view.frame().size.width,
            height: view.frame().size.height,
        })
        .unwrap_or_default();
    let full_rect = LogicalRect::new(0.0, 0.0, content_size.width, content_size.height);
    let view_rect = {
        let state = bridge.borrow();
        state
            .layout
            .rects
            .get(source_webview)
            .copied()
            .unwrap_or(full_rect)
    };
    let projected = project_overlay_safe_area(safe_area, view_rect).unwrap_or_default();
    // The legacy query DTO stays integer-rounded; the frozen event payload
    // carries the unrounded f64 rect from the same projection.
    let rect = Rect {
        x: projected.x.round() as i32,
        y: projected.y.round() as i32,
        width: (projected.width.max(0.0)).round() as u32,
        height: (projected.height.max(0.0)).round() as u32,
    };
    serde_json::to_value(rect).map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

/// Overlay metric changes (style/size/scale) and layout commits both land
/// here now: refresh every per-view projection through the window's layout
/// tracker, which pushes the unified `geometryChange` frames and the frozen
/// page-bridge `overlay.geometrychange` `{ rect | null }` payloads from one
/// projection recompute. The cheap window-level gates stay; per-view
/// listener and subscription checks live in the tracker.
pub(super) fn emit_overlay_geometry_change_if_enabled(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    _window: &Retained<NSWindow>,
) -> Result<(), WebviewRuntimeError> {
    let enabled = {
        let state = bridge.borrow();
        state.navigator_window.window_controls_overlay
    };
    if !enabled {
        return Ok(());
    }
    if let Some(tracker) = bridge.borrow().layout_tracker.upgrade() {
        tracker.borrow_mut().refresh_overlay_projection();
    }
    Ok(())
}

/// Window-level overlay safe area in logical pixels (top-left origin,
/// client-area coordinates): the titlebar strip minus the caption-button
/// cluster exclusion. This is the single projection source; per-view values
/// derive from it through `project_overlay_safe_area`.
pub(super) fn window_overlay_safe_area(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> LogicalRect {
    let style = bridge.borrow().style.clone();
    let content_size = window
        .contentView()
        .map(|view| LogicalViewport {
            width: view.frame().size.width,
            height: view.frame().size.height,
        })
        .unwrap_or_default();
    let width = content_size.width.max(0.0);
    let height = titlebar_height(window, content_size.height);
    let control_right_edge = if style.frameless {
        0.0
    } else {
        native_control_cluster_right_edge(window)
    };
    let x = control_right_edge;
    LogicalRect::new(x, 0.0, (width - x).max(0.0), height.max(0.0))
}

/// Emits the per-view frozen page-bridge payload. Kept here so the event
/// surface stays beside its projection source; the tracker calls it.
pub(super) fn emit_view_geometry_change(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    webview_id: &str,
    projected: Option<opentray_spec::webview::WebviewGeometryRect>,
) -> Result<(), WebviewRuntimeError> {
    emit_window_event_to_view(
        bridge,
        webview_id,
        "overlay.geometrychange",
        json!({ "rect": projected }),
    )
}

fn titlebar_height(window: &Retained<NSWindow>, content_height: f64) -> f64 {
    let layout = window.contentLayoutRect();
    let native_titlebar_height = (content_height - layout.size.height).max(0.0);
    native_titlebar_height
        .max(native_button_height(window))
        .max(DEFAULT_OVERLAY_HEIGHT)
}

fn native_button_height(window: &Retained<NSWindow>) -> f64 {
    window
        .standardWindowButton(NSWindowButton::CloseButton)
        .map(|button| button.frame().size.height + CONTROL_CLUSTER_PADDING)
        .unwrap_or(0.0)
}

fn native_control_cluster_right_edge(window: &Retained<NSWindow>) -> f64 {
    [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|button| window.standardWindowButton(button))
    .map(|button| {
        let frame = button.frame();
        frame.origin.x + frame.size.width
    })
    .fold(0.0, f64::max)
        + CONTROL_CLUSTER_PADDING
}
