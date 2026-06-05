use std::{cell::RefCell, rc::Rc};

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2_app_kit::NSWindow;
use objc2_foundation::{NSPoint, NSSize};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{WebviewRuntimeError, WebviewWindowIcon};

use super::{
    metadata::{
        icon_json, update_window_icon, update_window_title, MetadataSource, PageIconChangedPayload,
    },
    overlay::{emit_overlay_geometry_change_if_enabled, titlebar_area_rect_json},
    screen::screen_details_json,
    style::{
        apply_window_style, normalize_corner_radius, parse_background_effect_state,
        validate_style_request, SetStylePayload,
    },
    window_state::window_state_json,
    NavigatorWindowBridge, PRIVATE_SYNC_NAMESPACE, SCREEN_NAMESPACE, TRAY_NAMESPACE,
    WINDOW_INTERNALS_GLOBAL, WINDOW_NAMESPACE,
};

struct MainThreadWebView(usize);

// WebKit views are main-thread objects. This wrapper is only used to hop from a WebKit IPC
// callback back onto the main queue so JavaScript evaluation happens after the current IPC stack
// unwinds, avoiding synchronous script-message reentrancy.
unsafe impl Send for MainThreadWebView {}

impl MainThreadWebView {
    fn evaluate_script(self, script: &str) -> Result<(), wry::Error> {
        let webview = unsafe { &*(self.0 as *const wry::WebView) };
        webview.evaluate_script(script)
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct NavigatorWindowRequest {
    pub(super) namespace: String,
    pub(super) cmd: String,
    pub(super) callback: u32,
    pub(super) error: u32,
    #[serde(default)]
    pub(super) payload: Value,
    #[serde(default)]
    pub(super) options: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ListenPayload {
    event: String,
    handler: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnlistenPayload {
    event: String,
    event_id: u32,
}

#[derive(Debug, Deserialize)]
struct MovePayload {
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
struct ResizePayload {
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
struct TitlePayload {
    title: String,
}

pub(super) fn handle_navigator_window_request(
    message: &str,
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) {
    let request = match serde_json::from_str::<NavigatorWindowRequest>(message) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("opentray-ext-webview navigator request parse failed: {error}");
            return;
        }
    };
    if request.namespace != WINDOW_NAMESPACE {
        if request.namespace != SCREEN_NAMESPACE
            && request.namespace != TRAY_NAMESPACE
            && request.namespace != PRIVATE_SYNC_NAMESPACE
        {
            return;
        }
    }

    if webview_debug_enabled() {
        eprintln!(
            "opentray-ext-webview navigator request: {}::{} callback={} error={}",
            request.namespace, request.cmd, request.callback, request.error
        );
    }

    let access = bridge.borrow().page_access;

    let result = match request.namespace.as_str() {
        WINDOW_NAMESPACE if !access.window => Err(WebviewRuntimeError::Rejected(
            "navigator.window is not enabled for the current page source".into(),
        )),
        SCREEN_NAMESPACE if !access.screen => Err(WebviewRuntimeError::Rejected(
            "navigator.screen is not enabled for the current page source".into(),
        )),
        TRAY_NAMESPACE if !access.tray => Err(WebviewRuntimeError::Rejected(
            "navigator.opentray.tray is not enabled for the current page source".into(),
        )),
        WINDOW_NAMESPACE => dispatch_navigator_window_command(
            bridge,
            window,
            &request.cmd,
            request.payload,
            request.options,
        ),
        SCREEN_NAMESPACE => dispatch_navigator_screen_command(window, &request.cmd),
        TRAY_NAMESPACE => dispatch_navigator_tray_command(bridge, &request.cmd),
        PRIVATE_SYNC_NAMESPACE => {
            dispatch_private_sync_command(bridge, window, &request.cmd, request.payload)
        }
        _ => return,
    };
    match result {
        Ok(response) => {
            if request.callback == 0 {
                return;
            }
            if let Err(error) = resolve_callback(bridge, request.callback, response) {
                eprintln!("opentray-ext-webview navigator callback failed: {error}");
            } else if webview_debug_enabled() {
                eprintln!(
                    "opentray-ext-webview navigator callback resolved: {}::{} callback={}",
                    request.namespace, request.cmd, request.callback
                );
            }
        }
        Err(error) => {
            if request.error == 0 {
                eprintln!("opentray-ext-webview navigator request failed: {error}");
                return;
            }
            if let Err(callback_error) = reject_callback(bridge, request.error, &error) {
                eprintln!("opentray-ext-webview navigator reject failed: {callback_error}");
            } else {
                eprintln!(
                    "opentray-ext-webview navigator callback rejected: {}::{} error={} -> {}",
                    request.namespace, request.cmd, request.error, error
                );
            }
        }
    }
}

fn dispatch_navigator_window_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    cmd: &str,
    payload: Value,
    _options: Option<Value>,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "listen" => {
            let payload: ListenPayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("listen requires event and handler: {error}"))
            })?;
            let event_id = bridge
                .borrow_mut()
                .add_listener(payload.event, payload.handler);
            Ok(json!({ "eventId": event_id }))
        }
        "unlisten" => {
            let payload: UnlistenPayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!(
                    "unlisten requires event and eventId: {error}"
                ))
            })?;
            bridge
                .borrow_mut()
                .remove_listener(&payload.event, payload.event_id);
            Ok(Value::Null)
        }
        "close" => {
            emit_window_event(bridge, "closed", json!({ "visible": false }))?;
            bridge.borrow_mut().app_region_drag.stop();
            window.orderOut(None);
            Ok(Value::Null)
        }
        "minimize" => {
            window.miniaturize(None);
            let response = window_state_json(window)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            Ok(response)
        }
        "maximize" => {
            if !window.isZoomed() {
                window.zoom(None);
            }
            let response = window_state_json(window)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge, window)?;
            Ok(response)
        }
        "restore" => {
            if window.isMiniaturized() {
                window.deminiaturize(None);
            }
            if window.isZoomed() {
                window.zoom(None);
            }
            let response = window_state_json(window)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge, window)?;
            Ok(response)
        }
        "getWindowState" => window_state_json(window),
        "isMaximized" => Ok(Value::Bool(window.isZoomed() && !window.isMiniaturized())),
        "isMinimized" => Ok(Value::Bool(window.isMiniaturized())),
        "move" | "moveTo" => {
            let payload: MovePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("moveTo requires x and y: {error}"))
            })?;
            window.setFrameOrigin(NSPoint::new(payload.x, payload.y));
            let response = json!({ "x": payload.x, "y": payload.y });
            emit_window_event(bridge, "moved", response.clone())?;
            Ok(response)
        }
        "resize" | "resizeTo" => {
            let payload: ResizePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!(
                    "resizeTo requires width and height: {error}"
                ))
            })?;
            let width = payload.width.max(120.0);
            let height = payload.height.max(80.0);
            window.setContentSize(NSSize::new(width, height));
            let response = json!({ "width": width, "height": height });
            emit_window_event(bridge, "resized", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge, window)?;
            Ok(response)
        }
        "getTitlebarAreaRect" => {
            if !bridge.borrow().navigator_window.window_controls_overlay {
                // Overlay geometry is a capability gate on this session, not proof that the
                // runtime lacks overlay support everywhere on the platform.
                return Err(WebviewRuntimeError::Unsupported(
                    "window controls overlay is not enabled for this WebView".into(),
                ));
            }
            titlebar_area_rect_json(bridge, window)
        }
        "startAppRegionDrag" => bridge.borrow_mut().app_region_drag.start(window),
        "stopAppRegionDrag" => Ok(bridge.borrow_mut().app_region_drag.stop()),
        "getCapabilities" => bridge.borrow().capabilities_json(),
        "getTitle" => Ok(Value::String(bridge.borrow().metadata.title.clone())),
        "setTitle" => {
            let payload: TitlePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("setTitle requires title: {error}"))
            })?;
            update_window_title(bridge, window, payload.title, MetadataSource::Native)
        }
        "getIcon" => icon_json(bridge.borrow().metadata.icon.as_ref()),
        "setIcon" => {
            let icon = parse_set_icon_payload(payload)?;
            update_window_icon(bridge, window, icon, MetadataSource::Native)
        }
        "getStyle" => bridge.borrow().style_json(),
        "setStyle" => {
            let payload: SetStylePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("setStyle payload is invalid: {error}"))
            })?;
            validate_style_request(&payload)?;

            let mut bridge_state = bridge.borrow_mut();
            let mut changed = false;
            if let Some(frameless) = payload.frameless {
                if bridge_state.style.frameless != frameless {
                    bridge_state.style.frameless = frameless;
                    changed = true;
                }
            }
            if let Some(transparent) = payload.transparent {
                if bridge_state.style.transparent != transparent {
                    bridge_state.style.transparent = transparent;
                    changed = true;
                }
            }
            if let Some(keep_on_top) = payload.keep_on_top {
                if bridge_state.style.keep_on_top != keep_on_top {
                    bridge_state.style.keep_on_top = keep_on_top;
                    changed = true;
                }
            }
            if let Some(macos_payload) = payload.platform.and_then(|platform| platform.macos) {
                if let Some(material) = macos_payload.material {
                    let normalized_material =
                        material.and_then(|material| (!material.is_empty()).then_some(material));
                    if bridge_state.style.platform.macos.material != normalized_material {
                        bridge_state.style.platform.macos.material = normalized_material;
                        changed = true;
                    }
                }
                if let Some(material_state) = macos_payload.material_state.as_deref() {
                    let normalized_state = parse_background_effect_state(material_state)
                        .ok_or_else(|| {
                            WebviewRuntimeError::Unsupported(format!(
                                "background effect state {material_state} is not supported on macOS"
                            ))
                        })?;
                    if bridge_state.style.platform.macos.material_state != normalized_state {
                        bridge_state.style.platform.macos.material_state = normalized_state;
                        changed = true;
                    }
                }
                if let Some(corner_radius) = macos_payload.corner_radius {
                    let normalized_radius = match corner_radius {
                        Some(radius) => Some(normalize_corner_radius(radius)?),
                        None => None,
                    };
                    if bridge_state.style.platform.macos.corner_radius != normalized_radius {
                        bridge_state.style.platform.macos.corner_radius = normalized_radius;
                        changed = true;
                    }
                }
            }
            drop(bridge_state);

            if changed {
                apply_window_style(bridge, window)?;
            }
            let response = bridge.borrow().style_json()?;
            if changed {
                emit_window_event(bridge, "stylechange", response.clone())?;
                emit_overlay_geometry_change_if_enabled(bridge, window)?;
            }
            Ok(response)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported navigator window command: {other}"
        ))),
    }
}

pub(super) fn parse_set_icon_payload(
    payload: Value,
) -> Result<Option<WebviewWindowIcon>, WebviewRuntimeError> {
    serde_json::from_value::<Option<WebviewWindowIcon>>(payload).map_err(|error| {
        WebviewRuntimeError::Rejected(format!("setIcon payload is invalid: {error}"))
    })
}

fn dispatch_navigator_screen_command(
    window: &Retained<NSWindow>,
    cmd: &str,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "getScreenDetails" => screen_details_json(window),
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported navigator screen command: {other}"
        ))),
    }
}

fn dispatch_navigator_tray_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    cmd: &str,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "getBounds" => {
            let bounds = bridge.borrow().tray_bounds;
            // Tray placement uses an availability result on purpose: this session may simply
            // lack an injected tray anchor even though tray bounds are a supported capability.
            Ok(json!({
                "kind": if bounds.is_some() { "native" } else { "unavailable" },
                "source": if bounds.is_some() { "host.trayBounds" } else { "host.unavailable" },
                "rect": bounds
            }))
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported navigator tray command: {other}"
        ))),
    }
}

fn dispatch_private_sync_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    cmd: &str,
    payload: Value,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "pageIconChanged" => {
            let payload: PageIconChangedPayload =
                serde_json::from_value(payload).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!(
                        "pageIconChanged requires href payload: {error}"
                    ))
                })?;
            let icon = payload
                .href
                .filter(|href| !href.is_empty())
                .map(|href| WebviewWindowIcon::Href { href });
            let state = bridge.borrow();
            if !state.metadata.sync_icon.page_to_native || !state.page_access.icon_sync {
                return Ok(Value::Null);
            }
            drop(state);
            update_window_icon(bridge, window, icon, MetadataSource::Page)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported private sync command: {other}"
        ))),
    }
}

pub(super) fn resolve_callback(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    callback_id: u32,
    payload: Value,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, callback_script(callback_id, &payload)?)
}

pub(super) fn reject_callback(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    callback_id: u32,
    error: &WebviewRuntimeError,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, error_callback_script(callback_id, error)?)
}

pub(super) fn emit_window_event(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    event: &str,
    payload: Value,
) -> Result<(), WebviewRuntimeError> {
    let listeners = bridge.borrow().listeners_for(event);
    if listeners.is_empty() {
        return Ok(());
    }
    for listener in listeners {
        evaluate_bridge_script(
            bridge,
            listener_event_script(listener.handler_id, listener.event_id, event, &payload)?,
        )?;
    }
    Ok(())
}

pub(super) fn callback_script(
    callback_id: u32,
    payload: &Value,
) -> Result<String, WebviewRuntimeError> {
    let payload_json = serde_json::to_string(payload)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    Ok(format!(
        "{WINDOW_INTERNALS_GLOBAL}.runCallback({callback_id}, {payload_json});"
    ))
}

pub(super) fn error_callback_script(
    callback_id: u32,
    error: &WebviewRuntimeError,
) -> Result<String, WebviewRuntimeError> {
    callback_script(
        callback_id,
        &json!({
            "code": navigator_error_code(error),
            "message": error.to_string(),
        }),
    )
}

fn listener_event_script(
    handler_id: u32,
    event_id: u32,
    event: &str,
    payload: &Value,
) -> Result<String, WebviewRuntimeError> {
    callback_script(
        handler_id,
        &json!({
            "event": event,
            "id": event_id,
            "payload": payload,
        }),
    )
}

pub(super) fn evaluate_bridge_script(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    script: String,
) -> Result<(), WebviewRuntimeError> {
    // Native -> page callbacks stay behind extension-owned internals, not the public navigator API.
    let webview_ptr = bridge
        .borrow()
        .webview
        .ok_or_else(|| WebviewRuntimeError::Internal("webview bridge is not ready".into()))?;
    let webview = MainThreadWebView(webview_ptr.as_ptr() as usize);
    DispatchQueue::main().exec_async(move || {
        if webview_debug_enabled() {
            eprintln!("opentray-ext-webview evaluate bridge script: {script}");
        }
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("opentray-ext-webview evaluate_script failed: {error}; script={script}");
        }
    });
    Ok(())
}

fn webview_debug_enabled() -> bool {
    std::env::var_os("OPENTRAY_WEBVIEW_DEBUG").is_some()
}

fn navigator_error_code(error: &WebviewRuntimeError) -> &'static str {
    match error {
        WebviewRuntimeError::Rejected(_) => "rejected",
        WebviewRuntimeError::Unsupported(_) => "unsupported",
        WebviewRuntimeError::Internal(_) => "internal",
    }
}
