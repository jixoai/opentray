use std::{cell::RefCell, rc::Rc};

use objc2::rc::Retained;
use objc2_app_kit::{NSWindow, NSWindowButton};
use opentray_spec::Rect;
use serde_json::{json, Value};

use crate::WebviewRuntimeError;

use super::{bridge::emit_window_event, NavigatorWindowBridge};

const DEFAULT_OVERLAY_HEIGHT: f64 = 44.0;
const CONTROL_CLUSTER_PADDING: f64 = 12.0;

pub(super) fn titlebar_area_rect_json(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(titlebar_area_rect(bridge, window))
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

pub(super) fn emit_overlay_geometry_change_if_enabled(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> Result<(), WebviewRuntimeError> {
    let enabled = {
        let state = bridge.borrow();
        state.page_access.window
            && state.navigator_window.window_controls_overlay
            && state.has_listener("overlay.geometrychange")
    };
    if !enabled {
        return Ok(());
    }
    let rect = titlebar_area_rect_json(bridge, window)?;
    emit_window_event(
        bridge,
        "overlay.geometrychange",
        json!({ "titlebarAreaRect": rect }),
    )
}

fn titlebar_area_rect(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> Rect {
    let style = bridge.borrow().style.clone();
    let content_size = window
        .contentView()
        .map(|view| view.frame().size)
        .unwrap_or_else(|| window.frame().size);
    let width = content_size.width.max(0.0);
    let height = titlebar_height(window, content_size.height);
    let control_right_edge = if style.frameless {
        0.0
    } else {
        native_control_cluster_right_edge(window)
    };
    let x = control_right_edge;
    Rect {
        x: x.round() as i32,
        y: 0,
        width: (width - x).max(0.0).round() as u32,
        height: height.round() as u32,
    }
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
