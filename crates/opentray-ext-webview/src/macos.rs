use std::{cell::RefCell, collections::HashMap, ptr::NonNull, rc::Rc};

use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSBackingStoreType, NSView, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use raw_window_handle::{AppKitWindowHandle, HasWindowHandle, RawWindowHandle, WindowHandle};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wry::{WebView, WebViewBuilder};

use crate::{NavigatorWindowSettings, WebviewCommand, WebviewRuntimeError};

const WINDOW_NAMESPACE: &str = "opentray.window";
const WINDOW_INTERNALS_GLOBAL: &str = "window.__OPENTRAY_WINDOW_INTERNALS__";

#[derive(Default)]
pub(crate) struct MacosWebviewRuntime {
    slot: Option<WebviewSlot>,
}

struct WebviewSlot {
    tray_id: String,
    window: Retained<NSWindow>,
    webview: Box<WebView>,
    navigator_window: NavigatorWindowSettings,
}

struct NavigatorWindowBridge {
    webview: Option<NonNull<WebView>>,
    listeners: HashMap<String, Vec<NavigatorWindowListener>>,
    next_event_id: u32,
    style: WindowStyleState,
    navigator_window: NavigatorWindowSettings,
}

#[derive(Debug, Clone, Copy)]
struct NavigatorWindowListener {
    event_id: u32,
    handler_id: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowStyleState {
    frameless: bool,
    transparent: bool,
    background_effect: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCapabilities {
    close: bool,
    r#move: bool,
    resize: bool,
    frameless: bool,
    transparent: bool,
    background_effects: Vec<String>,
    global_bindings_enabled: bool,
    global_bindings_supported: bool,
    platform: &'static str,
}

#[derive(Debug, Deserialize)]
struct NavigatorWindowRequest {
    namespace: String,
    cmd: String,
    callback: u32,
    error: u32,
    #[serde(default)]
    payload: Value,
    #[serde(default)]
    options: Option<Value>,
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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStylePayload {
    frameless: Option<bool>,
    transparent: Option<bool>,
    background_effect: Option<String>,
}

impl MacosWebviewRuntime {
    pub(crate) fn handle(
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
                fallback_rect: _,
                navigator_window,
            } => {
                self.ensure_slot(tray_id, html, url, width, height, navigator_window)?;
                self.focus()?;
                Ok(json!({ "type": "shown" }))
            }
            WebviewCommand::Hide => {
                self.hide(tray_id)?;
                Ok(json!({ "type": "hidden" }))
            }
            WebviewCommand::Navigate { url } => {
                let navigator_window = self.active_navigator_window(tray_id);
                self.ensure_slot(
                    tray_id,
                    None,
                    Some(url.clone()),
                    420.0,
                    260.0,
                    navigator_window,
                )?;
                self.focus()?;
                Ok(json!({ "type": "navigated", "url": url }))
            }
            WebviewCommand::Evaluate { js } => {
                let navigator_window = self.active_navigator_window(tray_id);
                let slot = self.ensure_slot(tray_id, None, None, 420.0, 260.0, navigator_window)?;
                slot.webview
                    .evaluate_script(&js)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus()?;
                Ok(json!({ "type": "evaluated" }))
            }
            WebviewCommand::PostMessage { payload } => {
                let navigator_window = self.active_navigator_window(tray_id);
                let slot = self.ensure_slot(tray_id, None, None, 420.0, 260.0, navigator_window)?;
                let payload_json = serde_json::to_string(&payload)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                slot.webview
                    .evaluate_script(&format!(
                        "window.dispatchEvent(new MessageEvent('message', {{ data: {payload_json} }}));"
                    ))
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus()?;
                Ok(json!({ "type": "message", "payload": payload }))
            }
        }
    }

    pub(crate) fn lease_closed(&mut self, _lease_id: &str) {
        self.close();
    }

    fn active_navigator_window(&self, tray_id: &str) -> NavigatorWindowSettings {
        self.slot
            .as_ref()
            .filter(|slot| slot.tray_id == tray_id)
            .map(|slot| slot.navigator_window)
            .unwrap_or_default()
    }

    fn ensure_slot(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        navigator_window: NavigatorWindowSettings,
    ) -> Result<&mut WebviewSlot, WebviewRuntimeError> {
        let width = width.max(240.0);
        let height = height.max(160.0);
        let needs_new_slot = self
            .slot
            .as_ref()
            .map(|slot| slot.tray_id != tray_id || slot.navigator_window != navigator_window)
            .unwrap_or(true);

        if needs_new_slot {
            self.close();
            self.slot = Some(Self::create_slot(
                tray_id.to_string(),
                html,
                url,
                width,
                height,
                navigator_window,
            )?);
            return Ok(self.slot.as_mut().expect("slot created"));
        }

        let slot = self.slot.as_mut().expect("slot exists");
        slot.window.setContentSize(NSSize::new(width, height));
        if let Some(url) = url {
            slot.webview
                .load_url(&url)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        } else if let Some(html) = html {
            slot.webview
                .load_html(&html)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
        Ok(slot)
    }

    fn create_slot(
        tray_id: String,
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        navigator_window: NavigatorWindowSettings,
    ) -> Result<WebviewSlot, WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)),
                framed_window_style_mask(false),
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe { window.setReleasedWhenClosed(false) };
        window.setTitle(&NSString::from_str("OpenTray WebView"));
        window.center();

        let bridge = Rc::new(RefCell::new(NavigatorWindowBridge {
            webview: None,
            listeners: HashMap::new(),
            next_event_id: 1,
            style: WindowStyleState {
                frameless: false,
                transparent: false,
                background_effect: None,
            },
            navigator_window,
        }));

        let content_view = window.contentView().ok_or_else(|| {
            WebviewRuntimeError::Internal("webview window has no content view".into())
        })?;
        let host_view = AppKitViewHandle::new(content_view);
        let bridge_for_ipc = Rc::clone(&bridge);
        let window_for_ipc = window.clone();
        let builder = WebViewBuilder::new()
            .with_initialization_script(navigator_window_bootstrap_script(navigator_window))
            .with_ipc_handler(move |request| {
                handle_navigator_window_request(request.body(), &bridge_for_ipc, &window_for_ipc);
            });
        let builder = if let Some(url) = url {
            builder.with_url(url)
        } else {
            builder.with_html(html.unwrap_or_else(default_webview_html))
        };
        let mut webview = Box::new(
            builder
                .build(&host_view)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?,
        );
        bridge.borrow_mut().webview = Some(NonNull::from(webview.as_mut()));

        let app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        window.makeKeyAndOrderFront(None);

        Ok(WebviewSlot {
            tray_id,
            window,
            webview,
            navigator_window,
        })
    }

    fn focus(&self) -> Result<(), WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        if let Some(slot) = &self.slot {
            let app = NSApplication::sharedApplication(mtm);
            #[allow(deprecated)]
            app.activateIgnoringOtherApps(true);
            slot.window.makeKeyAndOrderFront(None);
        }
        Ok(())
    }

    fn hide(&mut self, tray_id: &str) -> Result<(), WebviewRuntimeError> {
        let Some(slot) = self.slot.as_ref() else {
            return Ok(());
        };
        if slot.tray_id != tray_id {
            return Ok(());
        }
        slot.window.orderOut(None);
        Ok(())
    }

    fn close(&mut self) {
        if let Some(slot) = self.slot.take() {
            slot.window.close();
        }
    }
}

impl NavigatorWindowBridge {
    fn capabilities_json(&self) -> Result<Value, WebviewRuntimeError> {
        serde_json::to_value(WindowCapabilities {
            close: true,
            r#move: true,
            resize: true,
            frameless: true,
            transparent: false,
            background_effects: Vec::new(),
            global_bindings_enabled: self.navigator_window.bind_window_globals,
            global_bindings_supported: self.navigator_window.enabled,
            platform: "macos",
        })
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }

    fn style_json(&self) -> Result<Value, WebviewRuntimeError> {
        serde_json::to_value(&self.style)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }

    fn add_listener(&mut self, event: String, handler_id: u32) -> u32 {
        let event_id = self.next_event_id;
        self.next_event_id = self.next_event_id.wrapping_add(1);
        self.listeners
            .entry(event)
            .or_default()
            .push(NavigatorWindowListener {
                event_id,
                handler_id,
            });
        event_id
    }

    fn remove_listener(&mut self, event: &str, event_id: u32) {
        let Some(listeners) = self.listeners.get_mut(event) else {
            return;
        };
        listeners.retain(|listener| listener.event_id != event_id);
        if listeners.is_empty() {
            self.listeners.remove(event);
        }
    }

    fn listeners_for(&self, event: &str) -> Vec<NavigatorWindowListener> {
        self.listeners.get(event).cloned().unwrap_or_default()
    }
}

fn handle_navigator_window_request(
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
        return;
    }

    let result = dispatch_navigator_window_command(
        bridge,
        window,
        &request.cmd,
        request.payload,
        request.options,
    );
    match result {
        Ok(response) => {
            if let Err(error) = resolve_callback(bridge, request.callback, response) {
                eprintln!("opentray-ext-webview navigator callback failed: {error}");
            }
        }
        Err(error) => {
            if let Err(callback_error) = reject_callback(bridge, request.error, &error) {
                eprintln!("opentray-ext-webview navigator reject failed: {callback_error}");
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
            window.orderOut(None);
            Ok(Value::Null)
        }
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
            Ok(response)
        }
        "getCapabilities" => bridge.borrow().capabilities_json(),
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
            drop(bridge_state);

            if changed {
                let frameless = bridge.borrow().style.frameless;
                window.setStyleMask(framed_window_style_mask(frameless));
            }
            let response = bridge.borrow().style_json()?;
            if changed {
                emit_window_event(bridge, "stylechange", response.clone())?;
            }
            Ok(response)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported navigator window command: {other}"
        ))),
    }
}

fn validate_style_request(payload: &SetStylePayload) -> Result<(), WebviewRuntimeError> {
    if payload.transparent == Some(true) {
        return Err(WebviewRuntimeError::Unsupported(
            "transparent WebView windows are not implemented on macOS yet".into(),
        ));
    }
    if let Some(effect) = payload.background_effect.as_ref() {
        if !effect.is_empty() {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "background effect {effect} is not implemented on macOS yet"
            )));
        }
    }
    Ok(())
}

fn resolve_callback(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    callback_id: u32,
    payload: Value,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, callback_script(callback_id, &payload)?)
}

fn reject_callback(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    callback_id: u32,
    error: &WebviewRuntimeError,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, error_callback_script(callback_id, error)?)
}

fn emit_window_event(
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

fn callback_script(callback_id: u32, payload: &Value) -> Result<String, WebviewRuntimeError> {
    let payload_json = serde_json::to_string(payload)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    Ok(format!(
        "{WINDOW_INTERNALS_GLOBAL}.runCallback({callback_id}, {payload_json});"
    ))
}

fn error_callback_script(
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

fn evaluate_bridge_script(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    script: String,
) -> Result<(), WebviewRuntimeError> {
    // Native -> page callbacks stay behind extension-owned internals, not the public navigator API.
    let webview_ptr = bridge
        .borrow()
        .webview
        .ok_or_else(|| WebviewRuntimeError::Internal("webview bridge is not ready".into()))?;
    unsafe { webview_ptr.as_ref() }
        .evaluate_script(&script)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn navigator_error_code(error: &WebviewRuntimeError) -> &'static str {
    match error {
        WebviewRuntimeError::Rejected(_) => "rejected",
        WebviewRuntimeError::Unsupported(_) => "unsupported",
        WebviewRuntimeError::Internal(_) => "internal",
    }
}

fn framed_window_style_mask(frameless: bool) -> NSWindowStyleMask {
    if frameless {
        NSWindowStyleMask::Borderless
    } else {
        NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable
    }
}

fn navigator_window_bootstrap_script(settings: NavigatorWindowSettings) -> String {
    let enabled = js_bool(settings.enabled);
    let bind_window_globals = js_bool(settings.bind_window_globals);
    r#"(function () {
  const enabled = __OPENTRAY_ENABLED__;
  const bindWindowGlobals = __OPENTRAY_BIND_GLOBALS__;
  const INTERNALS_KEY = "__OPENTRAY_WINDOW_INTERNALS__";
  const API_KEY = "__OPENTRAY_WINDOW_API__";
  if (!window[INTERNALS_KEY]) {
    const callbacks = new Map();
    const domListeners = Object.create(null);
    let fallbackId = 1;
    const originalWindowFns = {
      close: window.close,
      moveTo: window.moveTo,
      resizeTo: window.resizeTo
    };
    const nextCallbackId = () => {
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        return window.crypto.getRandomValues(new Uint32Array(1))[0];
      }
      return fallbackId++;
    };
    const registerCallback = (callback, once = false) => {
      const id = nextCallbackId();
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        if (typeof callback === "function") callback(data);
      });
      return id;
    };
    const unregisterCallback = (id) => {
      callbacks.delete(id);
    };
    const runCallback = (id, data) => {
      const callback = callbacks.get(id);
      if (callback) callback(data);
    };
    // Public navigator.window delegates through private internals; pages never touch Wry IPC directly.
    const invoke = (cmd, payload = {}, options) =>
      new Promise((resolve, reject) => {
        const callback = registerCallback((response) => {
          unregisterCallback(error);
          resolve(response);
        }, true);
        const error = registerCallback((response) => {
          unregisterCallback(callback);
          reject(response);
        }, true);
        window.ipc.postMessage(
          JSON.stringify({
            namespace: "opentray.window",
            cmd,
            callback,
            error,
            payload,
            options
          })
        );
      });
    const createApi = () => {
      if (window[API_KEY]) return window[API_KEY];
      const api = {
        invoke,
        async listen(event, handler) {
          const handlerId = registerCallback((eventData) => {
            if (typeof handler === "function") handler(eventData);
          });
          const result = await invoke("listen", { event, handler: handlerId });
          const eventId =
            result && typeof result.eventId === "number" ? result.eventId : handlerId;
          return async () => {
            unregisterCallback(handlerId);
            await invoke("unlisten", { event, eventId });
          };
        },
        async once(event, handler) {
          let unlisten = async () => {};
          unlisten = await api.listen(event, async (eventData) => {
            await unlisten();
            if (typeof handler === "function") handler(eventData);
          });
          return unlisten;
        },
        close() {
          return invoke("close");
        },
        move(x, y) {
          return invoke("move", { x, y });
        },
        moveTo(x, y) {
          return invoke("moveTo", { x, y });
        },
        resize(width, height) {
          return invoke("resize", { width, height });
        },
        resizeTo(width, height) {
          return invoke("resizeTo", { width, height });
        },
        getStyle() {
          return invoke("getStyle");
        },
        setStyle(style) {
          return invoke("setStyle", style ?? {});
        },
        getCapabilities() {
          return invoke("getCapabilities");
        },
        addEventListener(event, handler) {
          const eventListeners = (domListeners[event] ??= new Map());
          if (eventListeners.has(handler)) return;
          const pending = api.listen(event, handler).then((unlisten) => {
            eventListeners.set(handler, unlisten);
            return unlisten;
          });
          eventListeners.set(handler, pending);
        },
        removeEventListener(event, handler) {
          const eventListeners = domListeners[event];
          if (!eventListeners) return;
          const unlisten = eventListeners.get(handler);
          eventListeners.delete(handler);
          if (typeof unlisten === "function") {
            void unlisten();
            return;
          }
          if (unlisten && typeof unlisten.then === "function") {
            void unlisten.then((resolved) => {
              if (typeof resolved === "function") {
                return resolved();
              }
            });
          }
        }
      };
      Object.freeze(api);
      Object.defineProperty(window, API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const restoreGlobals = () => {
      try {
        window.close = originalWindowFns.close;
        window.moveTo = originalWindowFns.moveTo;
        window.resizeTo = originalWindowFns.resizeTo;
      } catch (_) {}
    };
    const install = (config) => {
      const api = createApi();
      Object.defineProperty(navigator, "window", {
        value: api,
        configurable: true
      });
      Object.defineProperty(navigator, "opentrayWindow", {
        value: api,
        configurable: true
      });
      if (config && config.bindWindowGlobals) {
        // Global overrides are opt-in because they intentionally change standard browser behavior.
        try {
          window.close = () => {
            void api.close();
          };
          window.moveTo = (x, y) => {
            void api.moveTo(Number(x), Number(y));
          };
          window.resizeTo = (width, height) => {
            void api.resizeTo(Number(width), Number(height));
          };
        } catch (_) {}
      } else {
        restoreGlobals();
      }
    };
    const uninstall = () => {
      try {
        delete navigator.window;
        delete navigator.opentrayWindow;
      } catch (_) {}
      restoreGlobals();
    };
    Object.defineProperty(window, INTERNALS_KEY, {
      value: Object.freeze({
        registerCallback,
        unregisterCallback,
        runCallback,
        invoke,
        install,
        uninstall
      }),
      configurable: false
    });
  }
  const internals = window[INTERNALS_KEY];
  if (enabled) {
    internals.install({ bindWindowGlobals });
  } else {
    internals.uninstall();
  }
})();"#
        .replace("__OPENTRAY_ENABLED__", enabled)
        .replace("__OPENTRAY_BIND_GLOBALS__", bind_window_globals)
}

fn js_bool(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
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

fn default_webview_html() -> String {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenTray WebView</title>
    <style>
      body {
        margin: 0;
        color: #18220f;
        background: linear-gradient(135deg, #fff8e7 0%, #e9f0d8 100%);
        font: 15px ui-rounded, "SF Pro Rounded", "Avenir Next", sans-serif;
      }
      main {
        padding: 22px;
      }
      section {
        display: grid;
        gap: 12px;
      }
      .card {
        margin-top: 12px;
        border: 1px solid rgba(24, 34, 15, 0.16);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.72);
      }
      .label {
        margin-bottom: 5px;
        color: #7b5b1d;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        color: #f8f3de;
        background: #2d654d;
        font: inherit;
      }
      code,
      pre {
        word-break: break-word;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenTray WebView</h1>
      <p>Dynamic extension runtime.</p>
      <section>
        <div class="card">
          <div class="label">navigator.window</div>
          <code id="navigator-status">Waiting for bootstrap.</code>
          <div class="actions">
            <button id="capabilities-button">Capabilities</button>
            <button id="frameless-button">Toggle Frameless</button>
            <button id="resize-button">Grow</button>
            <button id="move-button">Move</button>
            <button id="close-button">Close</button>
          </div>
        </div>
        <div class="card">
          <div class="label">postMessage</div>
          <code id="message-status">Waiting for a message.</code>
        </div>
        <div class="card">
          <div class="label">evaluate</div>
          <code id="eval-status">Waiting for script execution.</code>
        </div>
        <div class="card">
          <div class="label">events</div>
          <pre id="event-status">Waiting for native events.</pre>
        </div>
      </section>
    </main>
    <script>
      window.addEventListener("message", (event) => {
        const target = document.getElementById("message-status");
        if (target) {
          target.textContent = JSON.stringify(event.data);
        }
      });
      window.__OPENTRAY_EVALUATE__ = (payload) => {
        const target = document.getElementById("eval-status");
        if (target) {
          target.textContent = JSON.stringify(payload);
        }
      };
      const navigatorStatus = document.getElementById("navigator-status");
      const eventStatus = document.getElementById("event-status");
      const pageWindow = navigator.window ?? navigator.opentrayWindow;
      if (!pageWindow) {
        navigatorStatus.textContent = "navigator.window is disabled for this page.";
      } else {
        navigatorStatus.textContent = "navigator.window is ready.";
        pageWindow
          .getCapabilities()
          .then((capabilities) => {
            navigatorStatus.textContent = JSON.stringify(capabilities);
          })
          .catch((error) => {
            navigatorStatus.textContent = JSON.stringify(error);
          });
        void pageWindow.listen("moved", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("resized", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("stylechange", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("closed", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        document.getElementById("capabilities-button")?.addEventListener("click", async () => {
          navigatorStatus.textContent = JSON.stringify(await pageWindow.getCapabilities(), null, 2);
        });
        document.getElementById("frameless-button")?.addEventListener("click", async () => {
          const style = await pageWindow.getStyle();
          await pageWindow.setStyle({ frameless: !style.frameless });
          navigatorStatus.textContent = JSON.stringify(await pageWindow.getStyle(), null, 2);
        });
        document.getElementById("resize-button")?.addEventListener("click", () => {
          void pageWindow.resizeTo(520, 320);
        });
        document.getElementById("move-button")?.addEventListener("click", () => {
          void pageWindow.moveTo(120, 120);
        });
        document.getElementById("close-button")?.addEventListener("click", () => {
          void pageWindow.close();
        });
      }
    </script>
  </body>
</html>"#
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn navigator_window_script_uses_private_ipc_internals() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
        });

        assert!(script.contains("navigator, \"window\""));
        assert!(script.contains("\"opentray.window\""));
        assert!(script.contains("window.ipc.postMessage"));
        assert!(script.contains("listen(event, handler)"));
        assert!(script.contains("runCallback"));
        assert!(!script.contains("window.postMessage("));
    }

    #[test]
    fn navigator_window_script_installs_promoted_and_prefixed_api() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
        });

        assert!(script.contains("Object.defineProperty(navigator, \"window\""));
        assert!(script.contains("Object.defineProperty(navigator, \"opentrayWindow\""));
        assert!(script.contains("value: api"));
    }

    #[test]
    fn navigator_window_script_exposes_tauri_like_async_methods() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
        });

        assert!(script.contains("const invoke = (cmd, payload = {}, options) =>"));
        assert!(script.contains("async listen(event, handler)"));
        assert!(script.contains("async once(event, handler)"));
        assert!(script.contains("close()"));
        assert!(script.contains("moveTo(x, y)"));
        assert!(script.contains("resizeTo(width, height)"));
        assert!(script.contains("getStyle()"));
        assert!(script.contains("setStyle(style)"));
        assert!(script.contains("getCapabilities()"));
    }

    #[test]
    fn navigator_window_script_uses_scoped_invoke_request_shape() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
        });

        assert!(script.contains("namespace: \"opentray.window\""));
        assert!(script.contains("cmd,"));
        assert!(script.contains("callback,"));
        assert!(script.contains("error,"));
        assert!(script.contains("payload,"));
        assert!(script.contains("options"));
    }

    #[test]
    fn navigator_window_script_routes_dom_listener_compatibility_over_listen() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: false,
        });

        assert!(script.contains("addEventListener(event, handler)"));
        assert!(script.contains("api.listen(event, handler).then((unlisten) =>"));
        assert!(script.contains("removeEventListener(event, handler)"));
        assert!(script.contains("await invoke(\"unlisten\", { event, eventId });"));
    }

    #[test]
    fn navigator_window_script_can_bind_window_globals() {
        let script = navigator_window_bootstrap_script(NavigatorWindowSettings {
            enabled: true,
            bind_window_globals: true,
        });

        assert!(script.contains("window.close = () =>"));
        assert!(script.contains("window.moveTo = (x, y) =>"));
        assert!(script.contains("window.resizeTo = (width, height) =>"));
    }

    #[test]
    fn navigator_window_runtime_binds_window_globals_only_when_enabled() {
        let default_runtime = run_node_probe(
            &navigator_window_bootstrap_script(NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
            }),
            r#"
const sameObject = navigator.window === navigator.opentrayWindow;
return {
  sameObject,
  closeSame: window.close === originalClose,
  moveSame: window.moveTo === originalMoveTo,
  resizeSame: window.resizeTo === originalResizeTo
};
"#,
        );

        assert_eq!(default_runtime["sameObject"], Value::Bool(true));
        assert_eq!(default_runtime["closeSame"], Value::Bool(true));
        assert_eq!(default_runtime["moveSame"], Value::Bool(true));
        assert_eq!(default_runtime["resizeSame"], Value::Bool(true));

        let bound_runtime = run_node_probe(
            &navigator_window_bootstrap_script(NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: true,
            }),
            r#"
return {
  closeChanged: window.close !== originalClose,
  moveChanged: window.moveTo !== originalMoveTo,
  resizeChanged: window.resizeTo !== originalResizeTo
};
"#,
        );

        assert_eq!(bound_runtime["closeChanged"], Value::Bool(true));
        assert_eq!(bound_runtime["moveChanged"], Value::Bool(true));
        assert_eq!(bound_runtime["resizeChanged"], Value::Bool(true));
    }

    #[test]
    fn navigator_window_runtime_unlistens_handlers_and_resolves_first_callback() {
        let runtime = run_node_probe(
            &navigator_window_bootstrap_script(NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
            }),
            r#"
const invokePromise = navigator.window.invoke("ping", { hello: "world" });
const invokeRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(invokeRequest.callback, { ok: 1 });
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(invokeRequest.callback, { ok: 2 });
const invokeResult = await invokePromise;

const events = [];
const listenPromise = navigator.window.listen("resized", (event) => {
  events.push(event);
});
const listenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(listenRequest.callback, { eventId: 77 });
const unlisten = await listenPromise;
const handlerId = listenRequest.payload.handler;

window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(handlerId, {
  event: "resized",
  id: 77,
  payload: { width: 320, height: 200 }
});
await Promise.resolve();

const unlistenPromise = unlisten();
const unlistenRequest = messages.shift();
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(unlistenRequest.callback, null);
await unlistenPromise;
window.__OPENTRAY_WINDOW_INTERNALS__.runCallback(handlerId, {
  event: "resized",
  id: 77,
  payload: { width: 640, height: 400 }
});
await Promise.resolve();

return {
  invokePayload: invokeResult,
  unlistenCmd: unlistenRequest.cmd,
  unlistenEventId: unlistenRequest.payload.eventId,
  eventCount: events.length,
  eventPayload: events[0]?.payload ?? null
};
"#,
        );

        assert_eq!(runtime["invokePayload"]["ok"], Value::from(1));
        assert_eq!(runtime["unlistenCmd"], Value::String("unlisten".to_string()));
        assert_eq!(runtime["unlistenEventId"], Value::from(77));
        assert_eq!(runtime["eventCount"], Value::from(1));
        assert_eq!(runtime["eventPayload"]["width"], Value::from(320));
        assert_eq!(runtime["eventPayload"]["height"], Value::from(200));
    }

    #[test]
    fn navigator_window_request_shape_parses_inside_extension_runtime() {
        let request: NavigatorWindowRequest = serde_json::from_value(json!({
            "namespace": "opentray.window",
            "cmd": "resizeTo",
            "callback": 12,
            "error": 18,
            "payload": { "width": 420, "height": 280 },
            "options": { "source": "test" }
        }))
        .expect("navigator request");

        assert_eq!(request.namespace, "opentray.window");
        assert_eq!(request.cmd, "resizeTo");
        assert_eq!(request.callback, 12);
        assert_eq!(request.error, 18);
        assert_eq!(request.payload["width"], Value::from(420));
        assert_eq!(
            request.options.expect("options")["source"],
            Value::String("test".to_string())
        );
    }

    #[test]
    fn navigator_window_callback_scripts_use_private_run_callback() {
        let success = callback_script(7, &json!({ "ok": true })).expect("success callback");
        assert_eq!(
            success,
            format!("{WINDOW_INTERNALS_GLOBAL}.runCallback(7, {{\"ok\":true}});")
        );

        let rejected = error_callback_script(
            9,
            &WebviewRuntimeError::Unsupported("transparent WebView windows are not implemented on macOS yet".into()),
        )
        .expect("error callback");
        assert!(rejected.contains(&format!("{WINDOW_INTERNALS_GLOBAL}.runCallback(9,")));
        assert!(rejected.contains("\"code\":\"unsupported\""));
        assert!(rejected.contains("\"message\":\"transparent WebView windows are not implemented on macOS yet\""));
    }

    #[test]
    fn validate_style_request_rejects_platform_fragile_effects() {
        let transparent_error = validate_style_request(&SetStylePayload {
            frameless: None,
            transparent: Some(true),
            background_effect: None,
        })
        .expect_err("transparent should be unsupported");
        assert_eq!(
            transparent_error.to_string(),
            "transparent WebView windows are not implemented on macOS yet"
        );

        let blur_error = validate_style_request(&SetStylePayload {
            frameless: None,
            transparent: None,
            background_effect: Some("blur".to_string()),
        })
        .expect_err("blur should be unsupported");
        assert_eq!(
            blur_error.to_string(),
            "background effect blur is not implemented on macOS yet"
        );
    }

    #[test]
    fn navigator_window_bridge_tracks_listener_ids() {
        let mut bridge = NavigatorWindowBridge {
            webview: None,
            listeners: HashMap::new(),
            next_event_id: 1,
            style: WindowStyleState {
                frameless: false,
                transparent: false,
                background_effect: None,
            },
            navigator_window: NavigatorWindowSettings {
                enabled: true,
                bind_window_globals: false,
            },
        };

        let event_id = bridge.add_listener("resized".to_string(), 42);
        assert_eq!(event_id, 1);
        assert_eq!(bridge.listeners_for("resized").len(), 1);

        bridge.remove_listener("resized", event_id);
        assert!(bridge.listeners_for("resized").is_empty());
    }

    fn run_node_probe(script: &str, probe: &str) -> Value {
        let injected_script = serde_json::to_string(script).expect("serialize injected script");
        let program = format!(
            r#"
const messages = [];
const originalClose = () => "close";
const originalMoveTo = () => "move";
const originalResizeTo = () => "resize";
let nextRandom = 1;
const windowObject = {{
  close: originalClose,
  moveTo: originalMoveTo,
  resizeTo: originalResizeTo,
  ipc: {{
    postMessage(payload) {{
      messages.push(JSON.parse(payload));
    }}
  }},
  crypto: {{
    getRandomValues(values) {{
      values[0] = nextRandom++;
      return values;
    }}
  }}
}};
try {{
  delete globalThis.navigator;
}} catch (_error) {{}}
Object.defineProperty(globalThis, "navigator", {{
  value: {{}},
  configurable: true,
  writable: true
}});
globalThis.window = windowObject;
globalThis.messages = messages;
const injectedScript = {injected_script};
eval(injectedScript);
const result = await (async () => {{
{probe}
}})();
process.stdout.write(JSON.stringify(result));
"#,
        );

        let output = Command::new("node")
            .arg("--input-type=module")
            .arg("--eval")
            .arg(program)
            .output()
            .expect("node must be available to validate injected navigator runtime behavior");
        assert!(
            output.status.success(),
            "node probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).expect("node probe returned JSON")
    }
}
