mod app_menu;
mod bootstrap;
mod bridge;
mod demo_html;
mod drag;
mod metadata;
mod overlay;
mod policy;
mod screen;
mod style;
mod window_state;

use std::{cell::RefCell, collections::HashMap, ptr::NonNull, rc::Rc};

use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSBackingStoreType, NSResponder, NSScreen, NSView, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use raw_window_handle::{AppKitWindowHandle, HasWindowHandle, RawWindowHandle, WindowHandle};
use serde_json::{json, Value};
use wry::{PageLoadEvent, WebView, WebViewBuilder, WebViewExtMacOS, RGBA};

use crate::{
    NavigatorScreenSettings, NavigatorTraySettings, NavigatorWindowSettings, WebviewCommand,
    WebviewNativeApiPolicy, WebviewRuntimeError, WebviewSessionBootstrapSettings,
    WebviewShowSettings,
};

use self::app_menu::ensure_standard_edit_menu;
use self::bootstrap::navigator_window_bootstrap_script;
use self::bridge::{emit_window_event, handle_navigator_window_request};
use self::demo_html::default_webview_html;
use self::drag::AppRegionDragState;
use self::metadata::{
    apply_window_icon_from_bridge, handle_document_title_changed, sync_native_metadata_to_page,
    update_window_icon, update_window_title, MetadataSource, WindowMetadataState,
    DEFAULT_WINDOW_TITLE,
};
use self::overlay::emit_overlay_geometry_change_if_enabled;
use self::policy::{resolve_page_access, update_page_access_for_url};
use self::style::{
    apply_window_style, framed_window_style_mask, supported_background_effects,
    validate_initial_style, WindowStyleState,
};

const WINDOW_NAMESPACE: &str = "opentray.window";
const SCREEN_NAMESPACE: &str = "opentray.screen";
const TRAY_NAMESPACE: &str = "opentray.tray";
const PRIVATE_SYNC_NAMESPACE: &str = "opentray.window.sync";
const WINDOW_INTERNALS_GLOBAL: &str = "window.__OPENTRAY_WINDOW_INTERNALS__";
const OPAQUE_BACKGROUND: RGBA = (255, 255, 255, 255);
const CLEAR_BACKGROUND: RGBA = (0, 0, 0, 0);

#[derive(Default)]
pub(crate) struct MacosWebviewRuntime {
    slot: Option<WebviewSlot>,
}

struct WebviewSlot {
    tray_id: String,
    window: Retained<NSWindow>,
    webview: Box<WebView>,
    bridge: Rc<RefCell<NavigatorWindowBridge>>,
    content_descriptor: WebviewContentDescriptor,
    show_settings: WebviewShowSettings,
}

struct NavigatorWindowBridge {
    webview: Option<NonNull<WebView>>,
    content_view: Option<Retained<NSView>>,
    listeners: HashMap<String, Vec<NavigatorWindowListener>>,
    next_event_id: u32,
    style: WindowStyleState,
    navigator_window: NavigatorWindowSettings,
    navigator_screen: NavigatorScreenSettings,
    navigator_tray: NavigatorTraySettings,
    metadata: WindowMetadataState,
    app_region_drag: AppRegionDragState,
    native_api_policy: WebviewNativeApiPolicy,
    page_source: PageSourceState,
    page_access: PageCapabilityAccess,
    tray_bounds: Option<opentray_spec::Rect>,
}

#[derive(Debug, Clone, Copy)]
struct NavigatorWindowListener {
    event_id: u32,
    handler_id: u32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCapabilities {
    close: bool,
    r#move: bool,
    resize: bool,
    maximize: bool,
    minimize: bool,
    restore: bool,
    window_state: bool,
    overlay: bool,
    app_region_drag: bool,
    frameless: bool,
    transparent: bool,
    keep_on_top: bool,
    corner_radius: bool,
    title: bool,
    icon: bool,
    screen: bool,
    tray: bool,
    background_effects: Vec<String>,
    global_bindings_enabled: bool,
    global_bindings_supported: bool,
    screen_bindings_enabled: bool,
    screen_bindings_supported: bool,
    platform: &'static str,
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
            } => {
                self.ensure_slot(
                    tray_id,
                    html,
                    url,
                    width,
                    height,
                    tray_bounds.or(fallback_rect),
                    show_settings,
                )?;
                self.focus()?;
                Ok(json!({ "type": "shown" }))
            }
            WebviewCommand::Hide => {
                self.hide(tray_id)?;
                Ok(json!({ "type": "hidden" }))
            }
            WebviewCommand::Destroy => {
                self.destroy_slot(tray_id);
                Ok(json!({ "type": "destroyed" }))
            }
            WebviewCommand::SetContent { html, url } => {
                self.set_content(tray_id, html, url)?;
                Ok(json!({ "type": "contentSet" }))
            }
            WebviewCommand::Navigate { url } => {
                self.set_content(tray_id, None, Some(url.clone()))?;
                self.focus()?;
                Ok(json!({ "type": "navigated", "url": url }))
            }
            WebviewCommand::Evaluate { js } => {
                let show_settings = self.active_show_settings(tray_id);
                let slot =
                    self.ensure_slot(tray_id, None, None, 420.0, 260.0, None, show_settings)?;
                slot.webview
                    .evaluate_script(&js)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus()?;
                Ok(json!({ "type": "evaluated" }))
            }
            WebviewCommand::PostMessage { payload } => {
                let show_settings = self.active_show_settings(tray_id);
                let slot =
                    self.ensure_slot(tray_id, None, None, 420.0, 260.0, None, show_settings)?;
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

    fn active_show_settings(&self, tray_id: &str) -> WebviewShowSettings {
        self.slot
            .as_ref()
            .filter(|slot| slot.tray_id == tray_id)
            .map(|slot| slot.show_settings.clone())
            .unwrap_or_default()
    }

    fn ensure_slot(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        tray_bounds: Option<opentray_spec::Rect>,
        show_settings: WebviewShowSettings,
    ) -> Result<&mut WebviewSlot, WebviewRuntimeError> {
        let width = width.max(240.0);
        let height = height.max(160.0);
        let requested_content = explicit_content_descriptor(html.as_ref(), url.as_ref());
        let needs_new_slot = self
            .slot
            .as_ref()
            .map(|slot| slot.tray_id != tray_id)
            .unwrap_or(true);

        if needs_new_slot {
            self.close();
            self.slot = Some(Self::create_slot(
                tray_id.to_string(),
                html,
                url,
                width,
                height,
                tray_bounds,
                show_settings,
            )?);
            return Ok(self.slot.as_mut().expect("slot created"));
        }

        let slot = self.slot.as_ref().expect("slot exists");
        // Re-show is a visibility verb. Do not silently replace the live JS/DOM runtime through
        // repeated show calls; force callers onto explicit content or destroy paths instead.
        ensure_session_reuse_allowed(
            slot.show_settings.session_bootstrap_settings(),
            show_settings.session_bootstrap_settings(),
            &slot.content_descriptor,
            requested_content.as_ref(),
        )?;

        let slot = self.slot.as_mut().expect("slot exists");
        slot.window.setContentSize(NSSize::new(width, height));
        slot.bridge.borrow_mut().tray_bounds = tray_bounds;
        apply_initial_window_position(&slot.window, tray_bounds);
        apply_reused_show_updates(slot, &show_settings)?;
        Ok(slot)
    }

    fn set_content(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
    ) -> Result<(), WebviewRuntimeError> {
        let slot = self
            .slot
            .as_mut()
            .filter(|slot| slot.tray_id == tray_id)
            .ok_or_else(|| {
                WebviewRuntimeError::Rejected(
                    "setContent requires an existing webview session; call show first".into(),
                )
            })?;
        let descriptor = explicit_content_descriptor(html.as_ref(), url.as_ref()).ok_or_else(|| {
            WebviewRuntimeError::Rejected("setContent requires html or url".into())
        })?;
        if slot.content_descriptor == descriptor {
            return Ok(());
        }
        load_slot_content(slot, html, url, descriptor)
    }

    fn create_slot(
        tray_id: String,
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        tray_bounds: Option<opentray_spec::Rect>,
        show_settings: WebviewShowSettings,
    ) -> Result<WebviewSlot, WebviewRuntimeError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
        })?;
        validate_initial_style(&show_settings)?;
        let content_descriptor = initial_content_descriptor(html.as_ref(), url.as_ref());
        let page_source = page_source_state_for_content(&content_descriptor);
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)),
                framed_window_style_mask(
                    show_settings.window.style.frameless,
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
            webview: None,
            content_view: None,
            listeners: HashMap::new(),
            next_event_id: 1,
            style: WindowStyleState {
                frameless: show_settings.window.style.frameless,
                transparent: show_settings.window.style.transparent,
                keep_on_top: show_settings.window.style.keep_on_top,
                background_effect: show_settings.window.style.background_effect.clone(),
                background_effect_state: show_settings.window.style.background_effect_state,
                corner_radius: show_settings.window.style.corner_radius,
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
            native_api_policy: show_settings.native_api_policy.clone(),
            page_source: page_source.clone(),
            page_access: resolve_page_access(&show_settings, &page_source),
            tray_bounds,
        }));

        let content_view = window.contentView().ok_or_else(|| {
            WebviewRuntimeError::Internal("webview window has no content view".into())
        })?;
        let host_view = AppKitViewHandle::new(content_view);
        let bridge_for_ipc = Rc::clone(&bridge);
        let window_for_ipc = window.clone();
        let bridge_for_title = Rc::clone(&bridge);
        let window_for_title = window.clone();
        let bridge_for_page_load = Rc::clone(&bridge);
        if std::env::var_os("OPENTRAY_WEBVIEW_DEBUG").is_some() {
            eprintln!(
                "opentray-ext-webview create slot: tray_id={tray_id} url={:?} html={} native_window={} native_screen={}",
                url,
                html.is_some(),
                show_settings.navigator_window.enabled,
                show_settings.navigator_screen.enabled
            );
        }
        let builder = WebViewBuilder::new()
            .with_initialization_script(navigator_window_bootstrap_script(
                show_settings.navigator_window,
                show_settings.navigator_screen,
                show_settings.navigator_tray,
                show_settings.window.sync.title,
                show_settings.window.sync.icon,
                &show_settings.native_api_policy,
            ))
            .with_ipc_handler(move |request| {
                handle_navigator_window_request(request.body(), &bridge_for_ipc, &window_for_ipc);
            })
            .with_document_title_changed_handler(move |title| {
                handle_document_title_changed(&bridge_for_title, &window_for_title, title);
            })
            .with_on_page_load_handler(move |event, url| {
                update_page_access_for_url(&bridge_for_page_load, &url);
                if matches!(event, PageLoadEvent::Finished) {
                    if let Err(error) = sync_native_metadata_to_page(&bridge_for_page_load) {
                        eprintln!("opentray-ext-webview metadata sync failed: {error}");
                    }
                }
            });
        let builder = if show_settings.window.style.transparent
            || show_settings.window.style.background_effect.is_some()
        {
            builder.with_transparent(true)
        } else {
            builder
        };
        let builder = if let Some(url) = url {
            builder.with_url(url)
        } else {
            builder.with_html(html.unwrap_or_else(default_webview_html))
        };
        let mut webview = Box::new(
            builder
                // ext-webview owns the NSWindow, while Wry owns the AppKit view wiring for the
                // WKWebView. Using Wry's normal window installation keeps autoresizing, focus, IPC,
                // and page rendering on the path Wry validates for macOS.
                .build(&host_view)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?,
        );
        {
            let mut bridge_state = bridge.borrow_mut();
            bridge_state.webview = Some(NonNull::from(webview.as_mut()));
            bridge_state.content_view = window.contentView();
        }
        apply_window_style(&bridge, &window)?;
        apply_window_icon_from_bridge(&bridge, &window)?;
        apply_initial_window_position(&window, tray_bounds);

        let app = NSApplication::sharedApplication(mtm);
        ensure_standard_edit_menu(&app, mtm);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        focus_webview_responder(&window, webview.as_ref());
        window.makeKeyAndOrderFront(None);
        // Accessory apps do not reliably surface new windows with key-ordering alone.
        // Force the window onto the current space so a CLI-launched webview can actually
        // be seen without promoting the whole process into a Dock app.
        window.orderFrontRegardless();

        Ok(WebviewSlot {
            tray_id,
            window,
            webview,
            bridge,
            content_descriptor,
            show_settings,
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
            focus_webview_responder(&slot.window, slot.webview.as_ref());
            slot.window.makeKeyAndOrderFront(None);
            slot.window.orderFrontRegardless();
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
            slot.bridge.borrow_mut().app_region_drag.stop();
            slot.window.close();
        }
    }

    fn destroy_slot(&mut self, tray_id: &str) {
        let matches_tray = self
            .slot
            .as_ref()
            .map(|slot| slot.tray_id == tray_id)
            .unwrap_or(false);
        if matches_tray {
            self.close();
        }
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

fn load_slot_content(
    slot: &mut WebviewSlot,
    html: Option<String>,
    url: Option<String>,
    descriptor: WebviewContentDescriptor,
) -> Result<(), WebviewRuntimeError> {
    // Content replacement is allowed to rebuild the page runtime, but it stays explicit and
    // tray-scoped so hide/show reuse keeps session state unless the caller asks for replacement.
    match &descriptor {
        WebviewContentDescriptor::Html(_) => {
            let html = html.expect("html descriptor requires html payload");
            slot.webview
                .load_html(&html)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
        WebviewContentDescriptor::Url(_) => {
            let url = url.expect("url descriptor requires url payload");
            slot.webview
                .load_url(&url)
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
        WebviewContentDescriptor::DefaultHtml => {
            slot.webview
                .load_html(&default_webview_html())
                .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
    }

    let page_source = page_source_state_for_content(&descriptor);
    {
        let mut bridge = slot.bridge.borrow_mut();
        bridge.page_source = page_source.clone();
        bridge.page_access = resolve_page_access(&slot.show_settings, &page_source);
    }
    slot.content_descriptor = descriptor;
    Ok(())
}

fn apply_reused_show_updates(
    slot: &mut WebviewSlot,
    show_settings: &WebviewShowSettings,
) -> Result<(), WebviewRuntimeError> {
    if let Some(title) = show_settings.window.title.clone() {
        update_window_title(&slot.bridge, &slot.window, title.clone(), MetadataSource::Native)?;
        slot.show_settings.window.title = Some(title);
    }
    if let Some(icon) = show_settings.window.icon.clone() {
        update_window_icon(
            &slot.bridge,
            &slot.window,
            Some(icon.clone()),
            MetadataSource::Native,
        )?;
        slot.show_settings.window.icon = Some(icon);
    }

    let requested_style = WindowStyleState {
        frameless: show_settings.window.style.frameless,
        transparent: show_settings.window.style.transparent,
        keep_on_top: show_settings.window.style.keep_on_top,
        background_effect: show_settings.window.style.background_effect.clone(),
        background_effect_state: show_settings.window.style.background_effect_state,
        corner_radius: show_settings.window.style.corner_radius,
    };
    if slot.bridge.borrow().style != requested_style {
        {
            let mut bridge = slot.bridge.borrow_mut();
            bridge.style = requested_style;
        }
        apply_window_style(&slot.bridge, &slot.window)?;
        let response = slot.bridge.borrow().style_json()?;
        emit_window_event(&slot.bridge, "stylechange", response)?;
        emit_overlay_geometry_change_if_enabled(&slot.bridge, &slot.window)?;
        slot.show_settings.window.style = show_settings.window.style.clone();
    }

    Ok(())
}

fn apply_initial_window_position(window: &Retained<NSWindow>, tray_bounds: Option<opentray_spec::Rect>) {
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

impl NavigatorWindowBridge {
    fn capabilities_json(&self) -> Result<Value, WebviewRuntimeError> {
        serde_json::to_value(WindowCapabilities {
            close: true,
            r#move: true,
            resize: true,
            maximize: true,
            minimize: true,
            restore: true,
            window_state: true,
            overlay: self.page_access.window && self.navigator_window.window_controls_overlay,
            app_region_drag: self.page_access.window,
            frameless: true,
            transparent: true,
            keep_on_top: true,
            corner_radius: true,
            title: true,
            icon: true,
            screen: self.page_access.screen,
            tray: self.page_access.tray,
            background_effects: supported_background_effects()
                .iter()
                .map(|effect| (*effect).to_string())
                .collect(),
            global_bindings_enabled: self.page_access.window_globals,
            global_bindings_supported: true,
            screen_bindings_enabled: self.page_access.screen_globals,
            screen_bindings_supported: true,
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

    fn has_listener(&self, event: &str) -> bool {
        self.listeners
            .get(event)
            .map(|listeners| !listeners.is_empty())
            .unwrap_or(false)
    }

    fn listeners_for(&self, event: &str) -> Vec<NavigatorWindowListener> {
        self.listeners.get(event).cloned().unwrap_or_default()
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
