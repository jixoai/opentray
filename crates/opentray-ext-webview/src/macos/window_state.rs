use objc2::rc::Retained;
use objc2_app_kit::NSWindow;
use serde::Serialize;
use serde_json::Value;

use crate::WebviewRuntimeError;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowStateSnapshot {
    state: WindowStateKind,
    minimized: bool,
    maximized: bool,
    visible: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum WindowStateKind {
    Normal,
    Minimized,
    Maximized,
}

pub(super) fn window_state_snapshot(window: &Retained<NSWindow>) -> WindowStateSnapshot {
    let minimized = window.isMiniaturized();
    let maximized = !minimized && window.isZoomed();
    let state = if minimized {
        WindowStateKind::Minimized
    } else if maximized {
        WindowStateKind::Maximized
    } else {
        WindowStateKind::Normal
    };
    WindowStateSnapshot {
        state,
        minimized,
        maximized,
        visible: window_is_visible(window),
    }
}

/// `&NSWindow` (not `&Retained<NSWindow>`) so delegate callbacks that own
/// only a borrowed window can share the same visibility truth (D19 batch C
/// push-driven app-mode reconciliation); `&Retained` call sites coerce.
pub(super) fn window_is_closed(window: &NSWindow) -> bool {
    !window.isVisible()
}

pub(super) fn window_is_visible(window: &NSWindow) -> bool {
    !window_is_closed(window) && !window.isMiniaturized()
}

pub(super) fn window_state_json(window: &Retained<NSWindow>) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(window_state_snapshot(window))
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}
