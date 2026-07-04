use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::ffi::OsStr;
use std::io::Cursor;
use std::num::NonZeroIsize;
use std::num::NonZeroU32;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut, NonNull};
use std::rc::Rc;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use opentray_spec::Rect;
use raw_window_handle::{
    DisplayHandle, HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
    Win32WindowHandle, WindowHandle, WindowsDisplayHandle,
};
use serde::Deserialize;
use serde_json::{json, Value};
use softbuffer::{Context as SoftbufferContext, Surface as SoftbufferSurface};
use url::Url;
use window_vibrancy::{
    apply_acrylic, apply_mica, apply_tabbed, clear_acrylic, clear_mica, clear_tabbed,
    Error as WindowVibrancyError,
};
use windows::Win32::Foundation::{HWND as WebView2Hwnd, RECT as WebView2Rect};
use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DwmExtendFrameIntoClientArea, DwmGetWindowAttribute,
    DwmSetWindowAttribute, DWMSBT_AUTO, DWMSBT_NONE, DWMWA_CAPTION_BUTTON_BOUNDS,
    DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_HOSTBACKDROPBRUSH, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND, DWMWCP_ROUND,
    DWMWCP_ROUNDSMALL, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND, DWM_SYSTEMBACKDROP_TYPE,
    DWM_WINDOW_CORNER_PREFERENCE,
};
use windows_sys::Win32::Graphics::Gdi::{
    ClientToScreen, CreateRectRgn, DeleteObject, GetMonitorInfoW, InvalidateRect,
    MonitorFromWindow, UpdateWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows_sys::Win32::UI::Controls::MARGINS;
use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateIcon, CreateWindowExW, DefWindowProcW, DestroyIcon, DestroyWindow, GetClientRect,
    GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
    LoadCursorW, LoadImageW, RegisterClassW, SendMessageW, SetForegroundWindow,
    SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, SetWindowTextW, ShowWindow,
    CS_HREDRAW, CS_OWNDC, CS_VREDRAW, CW_USEDEFAULT, GWLP_USERDATA, GWL_EXSTYLE, GWL_STYLE, HICON,
    HTCAPTION, HWND_NOTOPMOST, HWND_TOPMOST, ICON_BIG, ICON_SMALL, IDC_ARROW, IMAGE_ICON,
    LR_DEFAULTSIZE, LR_LOADFROMFILE, LWA_ALPHA, MINMAXINFO, SM_CXSIZE, SM_CYSIZE, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_MAXIMIZE, SW_MINIMIZE,
    SW_RESTORE, SW_SHOW, SW_SHOWMINNOACTIVE, SW_SHOWNORMAL, WA_INACTIVE, WM_ACTIVATE, WM_CLOSE,
    WM_ENTERSIZEMOVE, WM_ERASEBKGND, WM_EXITSIZEMOVE, WM_GETMINMAXINFO, WM_NCACTIVATE,
    WM_NCLBUTTONDOWN, WM_PAINT, WM_SETICON, WM_SETTINGCHANGE, WM_SIZE, WM_WINDOWPOSCHANGED,
    WNDCLASSW, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOREDIRECTIONBITMAP,
    WS_MAXIMIZE, WS_MAXIMIZEBOX, WS_MINIMIZE, WS_MINIMIZEBOX, WS_OVERLAPPEDWINDOW, WS_POPUP,
    WS_THICKFRAME, WS_VISIBLE,
};
use wry::{
    dpi::{PhysicalPosition, PhysicalSize},
    PageLoadEvent, Rect as WryRect, WebView, WebViewBuilder, WebViewExtWindows, RGBA,
};

mod appwindow;
mod appwindow_abi;
mod downloads;
mod geometry;

use self::appwindow::{
    apply_windows_titlebar_overlay, titlebar_metrics as appwindow_titlebar_metrics,
    WindowsTitlebarMetrics,
};
use self::downloads::install_download_handlers;
use self::geometry::WindowsGeometry;
use crate::bootstrap::navigator_window_bootstrap_script;
use crate::{
    normalize_opacity, parse_background_input, MetadataSyncSettings, NavigatorScreenSettings,
    NavigatorTraySettings, NavigatorWindowSettings, WebviewBackgroundEffectState,
    WebviewBackgroundInput, WebviewBrowserPermissionDecision, WebviewBrowserPermissionFamily,
    WebviewBrowserPermissionPolicy, WebviewCommand, WebviewDownloadSettings,
    WebviewInitialMacosStyle, WebviewInitialWindowsStyle, WebviewNativeApiPolicy,
    WebviewNativeApiSource, WebviewPermissionManagerPolicy, WebviewRuntimeError,
    WebviewSessionBootstrapSettings, WebviewShowSettings, WebviewWindowBackground,
    WebviewWindowIcon,
};

const CLASS_NAME: &str = "OpenTrayWebViewWindow";
const DEFAULT_TITLE: &str = "OpenTray WebView";
const WINDOW_NAMESPACE: &str = "opentray.window";
const SCREEN_NAMESPACE: &str = "opentray.screen";
const TRAY_NAMESPACE: &str = "opentray.tray";
const PAGE_IPC_NAMESPACE: &str = "opentray.ipc";
const PERMISSIONS_NAMESPACE: &str = "opentray.permissions";
const COMMAND_NAMESPACE: &str = "opentray.command";
const PRIVATE_SYNC_NAMESPACE: &str = "opentray.window.sync";
const WINDOW_INTERNALS_GLOBAL: &str = "window.__OPENTRAY_WINDOW_INTERNALS__";
const OPAQUE_BACKGROUND: RGBA = (255, 255, 255, 255);
const CLEAR_BACKGROUND: RGBA = (0, 0, 0, 0);
const WINDOWS_BACKGROUND_MATERIALS: &[&str] = &["auto", "mica", "acrylic", "tabbed"];
const WINDOWS_BACKGROUND_STATES: &[&str] = &["followsWindowActiveState", "active", "inactive"];
const WINDOWS_CORNER_PREFERENCES: &[&str] = &["default", "doNotRound", "round", "roundSmall"];
const WINDOWS_AUTO_CLEAR_WHITE_BLOCK_ENV: &str = "OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK";
const WINDOWS_LIVE_RESIZE_ARTIFACT_CLEAR_INTERVAL: Duration = Duration::from_millis(120);

thread_local! {
    static WINDOW_PROC_STATES: RefCell<HashMap<isize, WindowProcState>> = RefCell::new(HashMap::new());
}

#[derive(Default)]
pub(crate) struct WindowsWebviewRuntime {
    slot: Option<WindowsWebviewSlot>,
}

struct WindowsWebviewSlot {
    tray_id: String,
    webview: Box<WebView>,
    window: Box<Win32HostWindow>,
    bridge: Rc<RefCell<NavigatorWindowBridge>>,
    content_descriptor: WebviewContentDescriptor,
    show_settings: WebviewShowSettings,
}

#[derive(Clone, Copy, Default)]
struct WindowProcState {
    bridge: Option<NonNull<RefCell<NavigatorWindowBridge>>>,
    window: Option<NonNull<Win32HostWindow>>,
    webview: Option<NonNull<WebView>>,
    host_surface_fill_color: Option<u32>,
    backdrop_state_policy: WindowsBackdropStatePolicy,
    size_constraints: WindowSizeConstraints,
    resize_interaction_active: bool,
    last_resize_artifact_clear_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum WindowsBackdropStatePolicy {
    #[default]
    FollowWindowActivation,
    ForceActive,
    ForceInactive,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct WindowSizeConstraints {
    min_width: Option<i32>,
    min_height: Option<i32>,
    max_width: Option<i32>,
    max_height: Option<i32>,
}

pub(super) struct NavigatorWindowBridge {
    hwnd: HWND,
    window: Option<NonNull<Win32HostWindow>>,
    webview: Option<NonNull<WebView>>,
    content_descriptor: WebviewContentDescriptor,
    listeners: HashMap<String, Vec<NavigatorWindowListener>>,
    ipc_messages: VecDeque<Value>,
    permission_messages: VecDeque<Value>,
    window_events: VecDeque<Value>,
    next_event_id: u32,
    next_ipc_message_id: u32,
    next_permission_message_id: u32,
    style: WindowStyleState,
    navigator_window: NavigatorWindowSettings,
    navigator_screen: NavigatorScreenSettings,
    navigator_tray: NavigatorTraySettings,
    metadata: WindowMetadataState,
    download: WebviewDownloadSettings,
    native_api_policy: WebviewNativeApiPolicy,
    browser_permission_policy: WebviewBrowserPermissionPolicy,
    permission_manager_policy: WebviewPermissionManagerPolicy,
    page_source: PageSourceState,
    page_access: PageCapabilityAccess,
    tray_bounds: Option<Rect>,
    size_constraints: WindowSizeConstraints,
}

#[derive(Debug, Clone, Copy)]
struct NavigatorWindowListener {
    event_id: u32,
    handler_id: u32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowStyleState {
    frameless: bool,
    keep_on_top: bool,
    opacity: f64,
    background: WebviewWindowBackground,
    platform: WindowPlatformStyleState,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowPlatformStyleState {
    windows: WindowsWindowStyleState,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsWindowStyleState {
    corner_preference: Option<String>,
}

#[derive(Debug)]
struct WindowMetadataState {
    title: String,
    icon: Option<WebviewWindowIcon>,
    native_icon: Option<NativeWindowIcon>,
    sync_title: MetadataSyncSettings,
    sync_icon: MetadataSyncSettings,
}

#[derive(Debug)]
struct NativeWindowIcon {
    handle: HICON,
}

impl Drop for NativeWindowIcon {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                DestroyIcon(self.handle);
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MetadataSource {
    Native,
    Page,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsHostSurfaceKind {
    RedirectionSurface,
    TransparentNoRedirection,
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

#[derive(Debug, Deserialize)]
struct ExecCommandPayload {
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SizeConstraintPayload {
    width: Option<Option<f64>>,
    height: Option<Option<f64>>,
}

#[derive(Debug, Deserialize)]
struct TitlePayload {
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageIconChangedPayload {
    href: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStylePayload {
    frameless: Option<bool>,
    keep_on_top: Option<bool>,
    opacity: Option<f64>,
    background: Option<WebviewBackgroundInput>,
    platform: Option<SetStylePlatformPayload>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStylePlatformPayload {
    macos: Option<SetStyleMacosPayload>,
    windows: Option<SetStyleWindowsPayload>,
    #[allow(dead_code)]
    linux: Option<SetStyleLinuxPayload>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStyleMacosPayload {
    corner_radius: Option<Option<f64>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStyleWindowsPayload {
    corner_preference: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetStyleLinuxPayload {}

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
    keep_on_top: bool,
    opacity: bool,
    title: bool,
    icon: bool,
    screen: bool,
    tray: bool,
    global_bindings_enabled: bool,
    global_bindings_supported: bool,
    screen_bindings_enabled: bool,
    screen_bindings_supported: bool,
    platform: &'static str,
    background: bool,
    platform_capabilities: WindowPlatformCapabilities,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowPlatformCapabilities {
    windows: WindowsWindowCapabilities,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsWindowCapabilities {
    background_materials: Vec<String>,
    semantic_backgrounds: Vec<String>,
    background_states: Vec<String>,
    corner_preference: bool,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowStateSnapshot {
    state: WindowStateKind,
    minimized: bool,
    maximized: bool,
    visible: bool,
}

#[derive(Clone, Copy)]
struct WindowHostRebuildSnapshot {
    rect: RECT,
    state: WindowStateSnapshot,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum WindowStateKind {
    Normal,
    Minimized,
    Maximized,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenDetailState {
    id: String,
    label: String,
    is_primary: bool,
    frame: Rect,
    visible_frame: Rect,
    scale_factor: f64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenDetailsState {
    current_screen: Option<ScreenDetailState>,
    screens: Vec<ScreenDetailState>,
    is_extended: bool,
    coordinate_origin: &'static str,
}

impl WindowsWebviewRuntime {
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
                self.focus(tray_id)?;
                Ok(json!({ "type": "shown" }))
            }
            WebviewCommand::Hide => {
                self.hide(tray_id);
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
                self.focus(tray_id)?;
                Ok(json!({ "type": "navigated", "url": url }))
            }
            WebviewCommand::Evaluate { js } => {
                let show_settings = self.active_show_settings(tray_id);
                let slot = self.ensure_script_slot(tray_id, show_settings)?;
                slot.webview
                    .evaluate_script(&js)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus(tray_id)?;
                Ok(json!({ "type": "evaluated" }))
            }
            WebviewCommand::PostMessage { payload } => {
                let show_settings = self.active_show_settings(tray_id);
                let slot = self.ensure_script_slot(tray_id, show_settings)?;
                let payload_json = serde_json::to_string(&payload)
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                slot.webview
                    .evaluate_script(&format!(
                        "window.dispatchEvent(new MessageEvent('message', {{ data: {payload_json} }}));"
                    ))
                    .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
                self.focus(tray_id)?;
                Ok(json!({ "type": "message", "payload": payload }))
            }
            WebviewCommand::MoveTo { x, y } => {
                let slot = self
                    .slot
                    .as_mut()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "moveTo requires an active WebView window".into(),
                        )
                    })?;
                let x = finite_i32(x, "x")?;
                let y = finite_i32(y, "y")?;
                set_window_position(slot.window.hwnd, x, y)?;
                notify_webview_parent_window_position_changed_from_bridge(&slot.bridge)?;
                let response = json!({ "x": x, "y": y });
                emit_window_event(&slot.bridge, "moved", response.clone())?;
                Ok(response)
            }
            WebviewCommand::ResizeTo { width, height } => {
                let slot = self
                    .slot
                    .as_mut()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "resizeTo requires an active WebView window".into(),
                        )
                    })?;
                let width = finite_i32(width, "width")?;
                let height = finite_i32(height, "height")?;
                set_window_size(slot.window.hwnd, width, height)?;
                refresh_after_explicit_resize(&slot.bridge)?;
                maybe_auto_clear_windows_white_block_artifact(&slot.bridge)?;
                let response = json!({ "width": width, "height": height });
                emit_window_event(&slot.bridge, "resized", response.clone())?;
                emit_overlay_geometry_change_if_enabled(&slot.bridge)?;
                Ok(response)
            }
            WebviewCommand::GetBounds => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "getBounds requires an active WebView window".into(),
                        )
                    })?;
                window_bounds_json(slot.window.hwnd)
            }
            WebviewCommand::GetScreenDetails => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "getScreenDetails requires an active WebView window".into(),
                        )
                    })?;
                screen_details_json(slot.window.hwnd)
            }
            WebviewCommand::DrainIpcMessages => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "drainIpcMessages requires an active WebView window".into(),
                        )
                    })?;
                let messages: Vec<Value> =
                    slot.bridge.borrow_mut().ipc_messages.drain(..).collect();
                Ok(json!({ "type": "ipcMessages", "messages": messages }))
            }
            WebviewCommand::DrainPermissionMessages => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "drainPermissionMessages requires an active WebView window".into(),
                        )
                    })?;
                let messages: Vec<Value> = slot
                    .bridge
                    .borrow_mut()
                    .permission_messages
                    .drain(..)
                    .collect();
                Ok(json!({ "type": "permissionMessages", "messages": messages }))
            }
            WebviewCommand::ResolvePermissionMessage { id, result } => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "resolvePermissionMessage requires an active WebView window".into(),
                        )
                    })?;
                resolve_callback(&slot.bridge, id, result)?;
                Ok(json!({ "type": "permissionMessageResolved", "id": id }))
            }
            WebviewCommand::DrainWindowEvents => {
                let slot = self
                    .slot
                    .as_ref()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "drainWindowEvents requires an active WebView window".into(),
                        )
                    })?;
                let events: Vec<Value> = slot.bridge.borrow_mut().window_events.drain(..).collect();
                Ok(json!({ "type": "windowEvents", "events": events }))
            }
            WebviewCommand::SetStyle { style } => {
                let slot = self
                    .slot
                    .as_mut()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "setStyle requires an active WebView window".into(),
                        )
                    })?;
                let payload: SetStylePayload = serde_json::from_value(style).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!("setStyle payload is invalid: {error}"))
                })?;
                validate_style_request(&payload)?;
                let previous_background = slot.bridge.borrow().style.background.clone();
                let changed = apply_style_patch(&slot.bridge, payload)?;
                if changed {
                    apply_window_style(&slot.bridge, Some(&previous_background))?;
                    apply_webview_client_bounds_from_bridge(&slot.bridge)?;
                }
                let response = slot.bridge.borrow().style_json()?;
                if changed {
                    emit_window_event(&slot.bridge, "stylechange", response.clone())?;
                    emit_overlay_geometry_change_if_enabled(&slot.bridge)?;
                }
                Ok(response)
            }
            WebviewCommand::SetMinimumSize { width, height } => {
                let slot = self
                    .slot
                    .as_mut()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "setMinimumSize requires an active WebView window".into(),
                        )
                    })?;
                apply_window_size_constraint_patch(
                    &slot.bridge,
                    SizeConstraintKind::Minimum,
                    SizeConstraintPayload { width, height },
                )
            }
            WebviewCommand::SetMaximumSize { width, height } => {
                let slot = self
                    .slot
                    .as_mut()
                    .filter(|slot| slot.tray_id == tray_id)
                    .ok_or_else(|| {
                        WebviewRuntimeError::Rejected(
                            "setMaximumSize requires an active WebView window".into(),
                        )
                    })?;
                apply_window_size_constraint_patch(
                    &slot.bridge,
                    SizeConstraintKind::Maximum,
                    SizeConstraintPayload { width, height },
                )
            }
        }
    }

    pub(crate) fn session_closed(&mut self, _session_id: &str) {
        self.close();
    }

    fn active_show_settings(&self, tray_id: &str) -> WebviewShowSettings {
        self.slot
            .as_ref()
            .filter(|slot| slot.tray_id == tray_id)
            .map(|slot| slot.show_settings.clone())
            .unwrap_or_else(default_windows_show_settings)
    }

    fn ensure_slot(
        &mut self,
        tray_id: &str,
        html: Option<String>,
        url: Option<String>,
        width: Option<f64>,
        height: Option<f64>,
        tray_bounds: Option<Rect>,
        show_settings: WebviewShowSettings,
    ) -> Result<&mut WindowsWebviewSlot, WebviewRuntimeError> {
        let initial_width = width.unwrap_or(420.0).max(240.0).round() as i32;
        let initial_height = height.unwrap_or(260.0).max(160.0).round() as i32;
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
                initial_width,
                initial_height,
                tray_bounds,
                show_settings,
            )?);
            return Ok(self.slot.as_mut().expect("slot created"));
        }

        let slot = self.slot.as_ref().expect("slot exists");
        if show_settings.bootstrap_requested {
            ensure_session_reuse_allowed(
                slot.show_settings.session_bootstrap_settings(),
                show_settings.session_bootstrap_settings(),
                &slot.content_descriptor,
                requested_content.as_ref(),
            )?;
        } else if let Some(requested_content) = requested_content.as_ref() {
            if &slot.content_descriptor != requested_content {
                return Err(WebviewRuntimeError::Rejected(
                    "show cannot replace existing webview content; use setContent, navigate, or destroy then show again".into(),
                ));
            }
        }

        let slot = self.slot.as_mut().expect("slot exists");
        if let (Some(width), Some(height)) = (width, height) {
            let width = width.max(240.0).round() as i32;
            let height = height.max(160.0).round() as i32;
            slot.window.resize_to(width, height)?;
            slot.window.position_near_tray(width, height, tray_bounds)?;
        }
        slot.bridge.borrow_mut().tray_bounds = tray_bounds;
        apply_webview_client_bounds(&slot.webview, slot.window.hwnd)?;
        apply_reused_show_updates(slot, &show_settings)?;
        slot.window.show();
        Ok(slot)
    }

    fn ensure_script_slot(
        &mut self,
        tray_id: &str,
        show_settings: WebviewShowSettings,
    ) -> Result<&mut WindowsWebviewSlot, WebviewRuntimeError> {
        let needs_new_slot = self
            .slot
            .as_ref()
            .map(|slot| slot.tray_id != tray_id)
            .unwrap_or(true);
        if needs_new_slot {
            return self.ensure_slot(
                tray_id,
                None,
                None,
                Some(420.0),
                Some(260.0),
                None,
                show_settings,
            );
        }
        Ok(self.slot.as_mut().expect("slot exists"))
    }

    fn create_slot(
        tray_id: String,
        html: Option<String>,
        url: Option<String>,
        width: i32,
        height: i32,
        tray_bounds: Option<Rect>,
        show_settings: WebviewShowSettings,
    ) -> Result<WindowsWebviewSlot, WebviewRuntimeError> {
        validate_initial_style(&show_settings)?;
        let content_descriptor = initial_content_descriptor(html.as_ref(), url.as_ref());
        let page_source = page_source_state_for_content(&content_descriptor);
        let title = show_settings
            .window
            .title
            .as_deref()
            .unwrap_or(DEFAULT_TITLE);
        let style = window_style_from_initial(&show_settings.window.style)?;
        let window = Win32HostWindow::create(
            title,
            width,
            height,
            tray_bounds,
            wants_no_redirection_bitmap(&style),
        )?;
        let page_access = resolve_page_access(&show_settings, &page_source);
        let webview_bounds = client_webview_bounds(window.hwnd).unwrap_or(WryRect {
            position: PhysicalPosition::new(0, 0).into(),
            size: PhysicalSize::new(
                logical_to_physical_i32(window.hwnd, width.max(1)),
                logical_to_physical_i32(window.hwnd, height.max(1)),
            )
            .into(),
        });
        let bridge = Rc::new(RefCell::new(NavigatorWindowBridge {
            hwnd: window.hwnd,
            window: None,
            webview: None,
            content_descriptor: content_descriptor.clone(),
            listeners: HashMap::new(),
            ipc_messages: VecDeque::new(),
            permission_messages: VecDeque::new(),
            window_events: VecDeque::new(),
            next_event_id: 1,
            next_ipc_message_id: 1,
            next_permission_message_id: 1,
            style,
            navigator_window: show_settings.navigator_window,
            navigator_screen: show_settings.navigator_screen,
            navigator_tray: show_settings.navigator_tray,
            metadata: WindowMetadataState {
                title: show_settings
                    .window
                    .title
                    .clone()
                    .unwrap_or_else(|| DEFAULT_TITLE.to_string()),
                icon: show_settings.window.icon.clone(),
                native_icon: None,
                sync_title: show_settings.window.sync.title,
                sync_icon: show_settings.window.sync.icon,
            },
            download: show_settings.download,
            native_api_policy: show_settings.native_api_policy.clone(),
            browser_permission_policy: show_settings.browser_permission_policy.clone(),
            permission_manager_policy: show_settings.permission_manager_policy.clone(),
            page_source: page_source.clone(),
            page_access,
            tray_bounds,
            size_constraints: WindowSizeConstraints::default(),
        }));

        let webview = build_webview(
            &window,
            &bridge,
            show_settings.navigator_window,
            show_settings.navigator_screen,
            show_settings.navigator_tray,
            show_settings.window.sync.title,
            show_settings.window.sync.icon,
            &show_settings.native_api_policy,
            &show_settings.permission_manager_policy,
            webview_bounds,
            html,
            url,
        )?;
        let mut slot = WindowsWebviewSlot {
            tray_id,
            webview,
            window: Box::new(window),
            bridge,
            content_descriptor,
            show_settings,
        };
        slot.window.attach_webview(&slot.webview);
        {
            let mut bridge = slot.bridge.borrow_mut();
            bridge.window = Some(NonNull::from(slot.window.as_mut()));
            bridge.webview = Some(NonNull::from(slot.webview.as_mut()));
        }
        sync_window_proc_state(
            slot.window.hwnd,
            Some(NonNull::from(slot.bridge.as_ref())),
            Some(NonNull::from(slot.window.as_mut())),
            Some(NonNull::from(slot.webview.as_mut())),
            None,
            backdrop_state_policy(&slot.bridge.borrow().style.background),
            slot.bridge.borrow().size_constraints,
        );
        apply_window_style(&slot.bridge, None)?;
        apply_window_icon_from_bridge(&slot.bridge)?;
        apply_webview_client_bounds(&slot.webview, slot.window.hwnd)?;
        slot.window.show();
        maybe_auto_clear_windows_white_block_artifact(&slot.bridge)?;

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
        let descriptor =
            explicit_content_descriptor(html.as_ref(), url.as_ref()).ok_or_else(|| {
                WebviewRuntimeError::Rejected("setContent requires html or url".into())
            })?;
        if slot.content_descriptor == descriptor {
            return Ok(());
        }
        load_slot_content(slot, html, url, descriptor)
    }

    fn focus(&self, tray_id: &str) -> Result<(), WebviewRuntimeError> {
        let Some(slot) = self.slot.as_ref().filter(|slot| slot.tray_id == tray_id) else {
            return Ok(());
        };
        slot.window.show();
        slot.window.focus();
        Ok(())
    }

    fn hide(&self, tray_id: &str) {
        if let Some(slot) = self.slot.as_ref().filter(|slot| slot.tray_id == tray_id) {
            slot.window.hide();
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

    fn close(&mut self) {
        self.slot.take();
    }
}

impl Drop for WindowsWebviewSlot {
    fn drop(&mut self) {
        sync_window_proc_state(
            self.window.hwnd,
            None,
            None,
            None,
            None,
            WindowsBackdropStatePolicy::FollowWindowActivation,
            WindowSizeConstraints::default(),
        );
        self.window.detach_webview();
    }
}

fn handle_navigator_window_request(message: &str, bridge: &Rc<RefCell<NavigatorWindowBridge>>) {
    let request = match serde_json::from_str::<NavigatorWindowRequest>(message) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("opentray-ext-webview navigator request parse failed: {error}");
            return;
        }
    };
    if !matches!(
        request.namespace.as_str(),
        WINDOW_NAMESPACE
            | SCREEN_NAMESPACE
            | TRAY_NAMESPACE
            | PAGE_IPC_NAMESPACE
            | PERMISSIONS_NAMESPACE
            | COMMAND_NAMESPACE
            | PRIVATE_SYNC_NAMESPACE
    ) {
        return;
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
        PERMISSIONS_NAMESPACE if !access.permission_manager => Err(WebviewRuntimeError::Rejected(
            "navigator.opentrayPermissions is not enabled for the current page source".into(),
        )),
        COMMAND_NAMESPACE if !access.window => Err(WebviewRuntimeError::Rejected(
            "navigator.opentray.execCommand is not enabled for the current page source".into(),
        )),
        WINDOW_NAMESPACE => dispatch_navigator_window_command(
            bridge,
            &request.cmd,
            request.payload,
            request.options,
        ),
        SCREEN_NAMESPACE => dispatch_navigator_screen_command(bridge, &request.cmd),
        TRAY_NAMESPACE => dispatch_navigator_tray_command(bridge, &request.cmd),
        PAGE_IPC_NAMESPACE => dispatch_page_ipc_command(bridge, &request.cmd, request.payload),
        PERMISSIONS_NAMESPACE => {
            dispatch_permission_command(bridge, &request.cmd, request.callback, request.payload)
        }
        COMMAND_NAMESPACE => dispatch_page_exec_command(bridge, &request.cmd, request.payload),
        PRIVATE_SYNC_NAMESPACE => {
            dispatch_private_sync_command(bridge, &request.cmd, request.payload)
        }
        _ => return,
    };

    match result {
        Ok(response) => {
            if request.callback != 0 {
                if request.namespace == PERMISSIONS_NAMESPACE {
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
        }
        Err(error) => {
            if request.error != 0 {
                if let Err(callback_error) = reject_callback(bridge, request.error, &error) {
                    eprintln!("opentray-ext-webview navigator reject failed: {callback_error}");
                } else if webview_debug_enabled() {
                    eprintln!(
                        "opentray-ext-webview navigator callback rejected: {}::{} error={} -> {}",
                        request.namespace, request.cmd, request.error, error
                    );
                }
            } else {
                eprintln!("opentray-ext-webview navigator request failed: {error}");
            }
        }
    }
}

fn dispatch_permission_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    cmd: &str,
    callback: u32,
    payload: Value,
) -> Result<Value, WebviewRuntimeError> {
    if callback == 0 {
        return Err(WebviewRuntimeError::Rejected(
            "opentrayPermissions command requires callback".into(),
        ));
    }
    let id = {
        let mut state = bridge.borrow_mut();
        let id = state.next_permission_message_id;
        state.next_permission_message_id =
            state.next_permission_message_id.saturating_add(1).max(1);
        state
            .permission_messages
            .push_back(permission_message_payload(id, cmd, callback, payload)?);
        id
    };
    Ok(json!({ "queued": true, "id": id }))
}

fn permission_message_payload(
    id: u32,
    action: &str,
    callback: u32,
    payload: Value,
) -> Result<Value, WebviewRuntimeError> {
    let source = payload.get("source").cloned().unwrap_or(Value::Null);
    if !matches!(
        source.get("type").and_then(Value::as_str),
        Some("local" | "origin")
    ) {
        return Err(WebviewRuntimeError::Rejected(
            "opentrayPermissions command requires source".into(),
        ));
    }
    let mut message = json!({
        "id": callback,
        "nativeId": id,
        "source": "page",
        "action": action,
        "sourceScope": source,
    });
    if let Some(target) = message.as_object_mut() {
        for key in ["family", "decision", "sourceAction"] {
            if let Some(value) = payload.get(key) {
                target.insert(key.to_string(), value.clone());
            }
        }
    }
    Ok(message)
}

fn dispatch_page_ipc_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    cmd: &str,
    payload: Value,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "postMessage" => {
            let id = {
                let mut state = bridge.borrow_mut();
                let id = state.next_ipc_message_id;
                state.next_ipc_message_id = state.next_ipc_message_id.saturating_add(1).max(1);
                state
                    .ipc_messages
                    .push_back(json!({ "id": id, "source": "page", "payload": payload }));
                id
            };
            Ok(json!({ "queued": true, "id": id }))
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported page ipc command: {other}"
        ))),
    }
}

fn dispatch_page_exec_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    cmd: &str,
    payload: Value,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "execCommand" => {
            let payload: ExecCommandPayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("execCommand requires command: {error}"))
            })?;
            exec_page_command(bridge, payload.command.as_str())?;
            Ok(Value::Null)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported page command: {other}"
        ))),
    }
}

fn dispatch_navigator_window_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
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
            let hwnd = bridge.borrow().hwnd;
            emit_window_event(bridge, "closed", json!({ "visible": false }))?;
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
            }
            Ok(Value::Null)
        }
        "show" => {
            let hwnd = bridge.borrow().hwnd;
            unsafe {
                ShowWindow(hwnd, SW_SHOW);
            }
            let response = window_state_json(hwnd)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge)?;
            Ok(response)
        }
        "hide" => {
            let hwnd = bridge.borrow().hwnd;
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
            }
            let response = window_state_json(hwnd)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            Ok(response)
        }
        "minimize" => {
            let hwnd = bridge.borrow().hwnd;
            unsafe {
                ShowWindow(hwnd, SW_MINIMIZE);
            }
            let response = window_state_json(hwnd)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            Ok(response)
        }
        "maximize" => {
            let hwnd = bridge.borrow().hwnd;
            unsafe {
                ShowWindow(hwnd, SW_MAXIMIZE);
            }
            apply_webview_client_bounds_from_bridge(bridge)?;
            let response = window_state_json(hwnd)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge)?;
            Ok(response)
        }
        "restore" => {
            let hwnd = bridge.borrow().hwnd;
            unsafe {
                ShowWindow(hwnd, SW_RESTORE);
            }
            apply_webview_client_bounds_from_bridge(bridge)?;
            let response = window_state_json(hwnd)?;
            emit_window_event(bridge, "windowstatechange", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge)?;
            Ok(response)
        }
        "getWindowState" => window_state_json(bridge.borrow().hwnd),
        "isMaximized" => Ok(Value::Bool(unsafe { IsZoomed(bridge.borrow().hwnd) != 0 })),
        "isMinimized" => Ok(Value::Bool(unsafe { IsIconic(bridge.borrow().hwnd) != 0 })),
        "getBounds" => window_bounds_json(bridge.borrow().hwnd),
        "move" | "moveTo" => {
            let payload: MovePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("moveTo requires x and y: {error}"))
            })?;
            let x = finite_i32(payload.x, "x")?;
            let y = finite_i32(payload.y, "y")?;
            set_window_position(bridge.borrow().hwnd, x, y)?;
            notify_webview_parent_window_position_changed_from_bridge(bridge)?;
            let response = json!({ "x": x, "y": y });
            emit_window_event(bridge, "moved", response.clone())?;
            Ok(response)
        }
        "resize" | "resizeTo" => {
            let payload: ResizePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!(
                    "resizeTo requires width and height: {error}"
                ))
            })?;
            let width = finite_i32(payload.width.max(120.0), "width")?;
            let height = finite_i32(payload.height.max(80.0), "height")?;
            set_window_size(bridge.borrow().hwnd, width, height)?;
            refresh_after_explicit_resize(bridge)?;
            let response = json!({ "width": width, "height": height });
            emit_window_event(bridge, "resized", response.clone())?;
            emit_overlay_geometry_change_if_enabled(bridge)?;
            Ok(response)
        }
        "setMinimumSize" => {
            let payload: SizeConstraintPayload =
                serde_json::from_value(payload).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!(
                        "setMinimumSize requires width or height: {error}"
                    ))
                })?;
            apply_window_size_constraint_patch(bridge, SizeConstraintKind::Minimum, payload)
        }
        "setMaximumSize" => {
            let payload: SizeConstraintPayload =
                serde_json::from_value(payload).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!(
                        "setMaximumSize requires width or height: {error}"
                    ))
                })?;
            apply_window_size_constraint_patch(bridge, SizeConstraintKind::Maximum, payload)
        }
        "getTitlebarAreaRect" => {
            if !bridge.borrow().navigator_window.window_controls_overlay {
                return Err(WebviewRuntimeError::Unsupported(
                    "window controls overlay is not enabled for this WebView".into(),
                ));
            }
            titlebar_area_rect_json(bridge.borrow().hwnd)
        }
        "startAppRegionDrag" => {
            // SendMessageW enters the native move loop and re-enters WndProc; drop the bridge
            // borrow first so WM_ENTERSIZEMOVE can queue its interaction event without panicking.
            let hwnd = { bridge.borrow().hwnd };
            start_app_region_drag(hwnd)
        }
        "stopAppRegionDrag" => Ok(json!({ "active": false })),
        "getCapabilities" => bridge.borrow().capabilities_json(),
        "getTitle" => Ok(Value::String(bridge.borrow().metadata.title.clone())),
        "setTitle" => {
            let payload: TitlePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("setTitle requires title: {error}"))
            })?;
            update_window_title(bridge, payload.title, MetadataSource::Native)
        }
        "getIcon" => icon_json(bridge.borrow().metadata.icon.as_ref()),
        "setIcon" => {
            let icon =
                serde_json::from_value::<Option<WebviewWindowIcon>>(payload).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!("setIcon payload is invalid: {error}"))
                })?;
            update_window_icon(bridge, icon, MetadataSource::Native)
        }
        "getStyle" => bridge.borrow().style_json(),
        "setStyle" => {
            let payload: SetStylePayload = serde_json::from_value(payload).map_err(|error| {
                WebviewRuntimeError::Rejected(format!("setStyle payload is invalid: {error}"))
            })?;
            validate_style_request(&payload)?;
            let previous_background = bridge.borrow().style.background.clone();
            let changed = apply_style_patch(bridge, payload)?;
            if changed {
                apply_window_style(bridge, Some(&previous_background))?;
                apply_webview_client_bounds_from_bridge(bridge)?;
            }
            let response = bridge.borrow().style_json()?;
            if changed {
                emit_window_event(bridge, "stylechange", response.clone())?;
                emit_overlay_geometry_change_if_enabled(bridge)?;
            }
            Ok(response)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported navigator window command: {other}"
        ))),
    }
}

fn dispatch_navigator_screen_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    cmd: &str,
) -> Result<Value, WebviewRuntimeError> {
    match cmd {
        "getScreenDetails" => screen_details_json(bridge.borrow().hwnd),
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
            let state = bridge.borrow();
            if !state.metadata.sync_icon.page_to_native || !state.page_access.icon_sync {
                return Ok(Value::Null);
            }
            drop(state);
            let icon = payload
                .href
                .filter(|href| !href.is_empty())
                .map(|href| WebviewWindowIcon::Href { href });
            update_window_icon(bridge, icon, MetadataSource::Page)
        }
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported private sync command: {other}"
        ))),
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

fn build_webview(
    window: &impl HasWindowHandle,
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    navigator_window: NavigatorWindowSettings,
    navigator_screen: NavigatorScreenSettings,
    navigator_tray: NavigatorTraySettings,
    sync_title: MetadataSyncSettings,
    sync_icon: MetadataSyncSettings,
    native_api_policy: &WebviewNativeApiPolicy,
    permission_manager_policy: &WebviewPermissionManagerPolicy,
    bounds: WryRect,
    html: Option<String>,
    url: Option<String>,
) -> Result<Box<WebView>, WebviewRuntimeError> {
    let bridge_for_ipc = Rc::clone(bridge);
    let bridge_for_title = Rc::clone(bridge);
    let bridge_for_page_load = Rc::clone(bridge);
    let builder = WebViewBuilder::new()
        .with_initialization_script(navigator_window_bootstrap_script(
            navigator_window,
            navigator_screen,
            navigator_tray,
            sync_title,
            sync_icon,
            native_api_policy,
            permission_manager_policy,
        ))
        .with_ipc_handler(move |request| {
            handle_navigator_window_request(request.body(), &bridge_for_ipc);
        })
        .with_document_title_changed_handler(move |title| {
            handle_document_title_changed(&bridge_for_title, title);
        })
        .with_on_page_load_handler(move |event, url| {
            update_page_access_for_url(&bridge_for_page_load, &url);
            if matches!(event, PageLoadEvent::Finished) {
                if let Err(error) = sync_native_metadata_to_page(&bridge_for_page_load) {
                    eprintln!("opentray-ext-webview metadata sync failed: {error}");
                }
            }
        })
        .with_clipboard(true)
        // Keep the WebView2 controller alpha-capable from creation time. On Windows, toggling
        // into a clear-backed mode from an opaque-created controller can leave stale white client
        // regions because the underlying swap chain was allocated without the needed alpha path.
        .with_transparent(true)
        .with_bounds(bounds);
    let builder = if let Some(url) = url {
        builder.with_url(url)
    } else {
        builder.with_html(html.unwrap_or_else(default_webview_html))
    };
    let webview = builder
        .build_as_child(window)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    let webview = Box::new(webview);
    install_download_handlers(webview.as_ref(), bridge)?;
    Ok(webview)
}

fn client_webview_bounds(hwnd: HWND) -> Option<WryRect> {
    let (width, height) = physical_client_size(hwnd)?;
    Some(WryRect {
        position: PhysicalPosition::new(0, 0).into(),
        size: PhysicalSize::new(width, height).into(),
    })
}

fn physical_client_size(hwnd: HWND) -> Option<(i32, i32)> {
    let mut client = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe {
        GetClientRect(hwnd, &mut client);
    }
    let client_width = (client.right - client.left).max(0);
    let client_height = (client.bottom - client.top).max(0);
    if client_width == 0 || client_height == 0 {
        return None;
    }
    Some((client_width, client_height))
}

fn apply_webview_client_bounds(webview: &WebView, hwnd: HWND) -> Result<(), WebviewRuntimeError> {
    let Some((width, height)) = physical_client_size(hwnd) else {
        return Ok(());
    };
    // The Win32 host client rect is already in physical pixels. Apply it directly to WebView2 and
    // synchronously resize WRY_WEBVIEW; Wry's public set_bounds path uses an async child HWND move.
    // Chromium/WebView2 may still visually trail by one compositor frame during live interactive
    // resize. Treat that as a lower-level composition limitation unless the host switches to a
    // deeper resize/composition integration.
    let bounds = webview_controller_rect(width, height);
    unsafe {
        webview
            .controller()
            .SetBounds(bounds)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    if let Some(child_hwnd) = webview_parent_hwnd(webview) {
        set_child_window_bounds(child_hwnd, width, height)?;
    }
    notify_webview_parent_window_position_changed(webview)
}

fn webview_controller_rect(width: i32, height: i32) -> WebView2Rect {
    WebView2Rect {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
    }
}

fn webview_parent_hwnd(webview: &WebView) -> Option<HWND> {
    let mut parent = WebView2Hwnd::default();
    unsafe {
        webview.controller().ParentWindow(&mut parent).ok()?;
    }
    if parent.0.is_null() {
        None
    } else {
        Some(parent.0.cast())
    }
}

fn set_child_window_bounds(hwnd: HWND, width: i32, height: i32) -> Result<(), WebviewRuntimeError> {
    let ok = unsafe {
        SetWindowPos(
            hwnd,
            null_mut(),
            0,
            0,
            width,
            height,
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

fn apply_webview_client_bounds_from_bridge(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    let (hwnd, webview) = {
        let state = bridge.borrow();
        (state.hwnd, state.webview)
    };
    let Some(webview) = webview else {
        return Ok(());
    };
    apply_webview_client_bounds(unsafe { webview.as_ref() }, hwnd)
}

fn refresh_after_explicit_resize(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let hwnd = bridge.borrow().hwnd;
    apply_webview_client_bounds_from_bridge(bridge)?;
    // Explicit resize commands can expose the same stale host redirection surface family as the
    // transparent white-block issue (`tauri#10318`). Re-present the host surface in-place and let
    // WM_PAINT/WM_SIZE reuse the same path; do not hide/show, maximize, or rebuild the WebView.
    refresh_attached_window_surface(hwnd);
    refresh_native_window_surface(hwnd)
}

fn exec_page_command(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    command: &str,
) -> Result<(), WebviewRuntimeError> {
    match command {
        "clearWhiteBlock"
        | "clear-white-block"
        | "clearWindowArtifacts"
        | "clear-window-artifacts" => clear_windows_white_block_artifact(bridge),
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported page command: {other}"
        ))),
    }
}

fn maybe_auto_clear_windows_white_block_artifact(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    if !windows_auto_clear_white_block_enabled() {
        return Ok(());
    }
    if !bridge_background_needs_white_block_clear(bridge) {
        return Ok(());
    }
    clear_windows_white_block_artifact(bridge)
}

fn maybe_auto_clear_windows_white_block_artifact_during_live_resize(
    hwnd: HWND,
) -> Result<(), WebviewRuntimeError> {
    let bridge = WINDOW_PROC_STATES.with(|states| {
        let now = Instant::now();
        let mut states = states.borrow_mut();
        let Some(state) = states.get_mut(&(hwnd as isize)) else {
            return None;
        };
        if !state.resize_interaction_active
            || !should_run_live_resize_artifact_clear(state.last_resize_artifact_clear_at, now)
        {
            return None;
        }
        state.last_resize_artifact_clear_at = Some(now);
        state.bridge
    });
    let Some(bridge) = bridge else {
        return Ok(());
    };
    maybe_auto_clear_windows_white_block_artifact(unsafe { bridge.as_ref() })
}

fn should_run_live_resize_artifact_clear(last: Option<Instant>, now: Instant) -> bool {
    match last {
        Some(last) => now.duration_since(last) >= WINDOWS_LIVE_RESIZE_ARTIFACT_CLEAR_INTERVAL,
        None => true,
    }
}

fn clear_windows_white_block_artifact(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    let hwnd = bridge.borrow().hwnd;
    if is_window_maximized(hwnd) {
        // Windows DWM keeps the stale redirection artifact in maximized mode even after every
        // tested shell-state reset probe. The normal-window repair path uses the verified
        // `SW_SHOWMINNOACTIVE -> SW_RESTORE` reset, but that reset does not clear maximized
        // artifacts. Do not fight the user with maximize/restore loops here; leave the known
        // limitation explicit until a deeper DComp/AppWindow fix exists.
        return Ok(());
    }
    show_window_clear_white_block(hwnd, SW_SHOWMINNOACTIVE, SW_RESTORE);
    finish_shell_state_clear_white_block(bridge)
}

fn bridge_background_needs_white_block_clear(bridge: &RefCell<NavigatorWindowBridge>) -> bool {
    let background = bridge.borrow().style.background.clone();
    background_needs_white_block_clear(&background)
}

fn background_needs_white_block_clear(background: &WebviewWindowBackground) -> bool {
    !matches!(background, WebviewWindowBackground::Opaque)
}

fn windows_auto_clear_white_block_enabled() -> bool {
    match std::env::var(WINDOWS_AUTO_CLEAR_WHITE_BLOCK_ENV) {
        Ok(value) => !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "off" | "no"
        ),
        Err(_) => true,
    }
}

fn show_window_clear_white_block(hwnd: HWND, first: i32, second: i32) {
    unsafe {
        ShowWindow(hwnd, first);
        ShowWindow(hwnd, second);
    }
}

fn finish_shell_state_clear_white_block(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    let hwnd = bridge.borrow().hwnd;
    apply_webview_client_bounds_from_bridge(bridge)?;
    notify_webview_parent_window_position_changed_from_bridge(bridge)?;
    let response = window_state_json(hwnd)?;
    emit_window_event(bridge, "windowstatechange", response)?;
    emit_overlay_geometry_change_if_enabled(bridge)?;
    refresh_attached_window_surface(hwnd);
    refresh_native_window_surface(hwnd)
}
fn notify_webview_parent_window_position_changed(
    webview: &WebView,
) -> Result<(), WebviewRuntimeError> {
    unsafe { webview.controller().NotifyParentWindowPositionChanged() }
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn notify_webview_parent_window_position_changed_from_bridge(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    let webview = bridge.borrow().webview;
    let Some(webview) = webview else {
        return Ok(());
    };
    notify_webview_parent_window_position_changed(unsafe { webview.as_ref() })
}

fn default_windows_show_settings() -> WebviewShowSettings {
    WebviewShowSettings::default()
}

fn load_slot_content(
    slot: &mut WindowsWebviewSlot,
    html: Option<String>,
    url: Option<String>,
    descriptor: WebviewContentDescriptor,
) -> Result<(), WebviewRuntimeError> {
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
        bridge.content_descriptor = descriptor.clone();
        bridge.page_access = resolve_page_access_from_bridge(&bridge);
    }
    slot.content_descriptor = descriptor;
    Ok(())
}

fn apply_reused_show_updates(
    slot: &mut WindowsWebviewSlot,
    show_settings: &WebviewShowSettings,
) -> Result<(), WebviewRuntimeError> {
    if let Some(title) = show_settings.window.title.clone() {
        update_window_title(&slot.bridge, title.clone(), MetadataSource::Native)?;
        slot.show_settings.window.title = Some(title);
    }
    if let Some(icon) = show_settings.window.icon.clone() {
        update_window_icon(&slot.bridge, Some(icon.clone()), MetadataSource::Native)?;
        slot.show_settings.window.icon = Some(icon);
    }

    if show_settings.window.style_requested {
        let requested_style = window_style_from_initial(&show_settings.window.style)?;
        if slot.bridge.borrow().style != requested_style {
            let previous_background = slot.bridge.borrow().style.background.clone();
            slot.bridge.borrow_mut().style = requested_style;
            apply_window_style(&slot.bridge, Some(&previous_background))?;
            apply_webview_client_bounds_from_bridge(&slot.bridge)?;
            let response = slot.bridge.borrow().style_json()?;
            emit_window_event(&slot.bridge, "stylechange", response)?;
            emit_overlay_geometry_change_if_enabled(&slot.bridge)?;
            slot.show_settings.window.style = show_settings.window.style.clone();
            slot.show_settings.window.style_requested = true;
        }
    }

    Ok(())
}

fn validate_initial_style(settings: &WebviewShowSettings) -> Result<(), WebviewRuntimeError> {
    reject_macos_style(&settings.window.style.platform.macos)?;
    validate_initial_windows_style(&settings.window.style.platform.windows)?;
    validate_windows_background(&settings.window.style.background)
}

fn reject_macos_style(style: &WebviewInitialMacosStyle) -> Result<(), WebviewRuntimeError> {
    if style.corner_radius.is_some() {
        return Err(WebviewRuntimeError::Unsupported(
            "style.platform.macos is not supported on Windows".into(),
        ));
    }
    Ok(())
}

fn validate_style_request(payload: &SetStylePayload) -> Result<(), WebviewRuntimeError> {
    let macos_payload = payload
        .platform
        .as_ref()
        .and_then(|platform| platform.macos.as_ref());
    if macos_payload
        .map(|payload| payload.corner_radius.is_some())
        .unwrap_or(false)
    {
        return Err(WebviewRuntimeError::Unsupported(
            "platform.macos window style is not supported on Windows".into(),
        ));
    }
    if let Some(background) = payload.background.clone() {
        validate_windows_background(&parse_background_input(background)?)?;
    }
    if let Some(opacity) = payload.opacity {
        normalize_opacity(opacity)?;
    }
    let windows_payload = payload
        .platform
        .as_ref()
        .and_then(|platform| platform.windows.as_ref());
    if let Some(windows_payload) = windows_payload {
        if let Some(Some(preference)) = windows_payload.corner_preference.as_ref() {
            normalize_windows_corner_preference(preference)?;
        }
    }
    Ok(())
}

fn validate_initial_windows_style(
    style: &WebviewInitialWindowsStyle,
) -> Result<(), WebviewRuntimeError> {
    if let Some(preference) = style.corner_preference.as_deref() {
        normalize_windows_corner_preference(preference)?;
    }
    Ok(())
}

fn window_style_from_initial(
    style: &crate::WebviewInitialStyle,
) -> Result<WindowStyleState, WebviewRuntimeError> {
    reject_macos_style(&style.platform.macos)?;
    Ok(WindowStyleState {
        frameless: style.frameless,
        keep_on_top: style.keep_on_top,
        opacity: normalize_opacity(style.opacity)?,
        background: normalize_windows_background(&style.background)?,
        platform: WindowPlatformStyleState {
            windows: WindowsWindowStyleState {
                corner_preference: style
                    .platform
                    .windows
                    .corner_preference
                    .as_deref()
                    .map(normalize_windows_corner_preference)
                    .transpose()?,
            },
        },
    })
}

fn normalize_windows_background(
    background: &WebviewWindowBackground,
) -> Result<WebviewWindowBackground, WebviewRuntimeError> {
    match background {
        WebviewWindowBackground::PlatformMaterial { material, state } => {
            Ok(WebviewWindowBackground::PlatformMaterial {
                material: normalize_windows_background_material(material),
                state: normalize_windows_background_state(*state),
            })
        }
        WebviewWindowBackground::Opaque => Ok(WebviewWindowBackground::Opaque),
        WebviewWindowBackground::Transparent => Ok(WebviewWindowBackground::Transparent),
        WebviewWindowBackground::Semantic { token, state } => match token.as_str() {
            "blur" => Ok(WebviewWindowBackground::Semantic {
                token: "blur".to_string(),
                state: normalize_windows_background_state(*state),
            }),
            _ => Ok(WebviewWindowBackground::PlatformMaterial {
                material: "acrylic".to_string(),
                state: normalize_windows_background_state(*state),
            }),
        },
    }
}

fn validate_windows_background(
    background: &WebviewWindowBackground,
) -> Result<(), WebviewRuntimeError> {
    match background {
        WebviewWindowBackground::Opaque | WebviewWindowBackground::Transparent => Ok(()),
        WebviewWindowBackground::PlatformMaterial { .. }
        | WebviewWindowBackground::Semantic { .. } => Ok(()),
    }
}

fn normalize_windows_background_state(
    state: WebviewBackgroundEffectState,
) -> WebviewBackgroundEffectState {
    state
}

fn backdrop_state_policy(background: &WebviewWindowBackground) -> WindowsBackdropStatePolicy {
    let state = match background {
        WebviewWindowBackground::PlatformMaterial { state, .. }
        | WebviewWindowBackground::Semantic { state, .. } => *state,
        WebviewWindowBackground::Opaque | WebviewWindowBackground::Transparent => {
            WebviewBackgroundEffectState::FollowsWindowActiveState
        }
    };
    match state {
        WebviewBackgroundEffectState::FollowsWindowActiveState => {
            WindowsBackdropStatePolicy::FollowWindowActivation
        }
        WebviewBackgroundEffectState::Active => WindowsBackdropStatePolicy::ForceActive,
        WebviewBackgroundEffectState::Inactive => WindowsBackdropStatePolicy::ForceInactive,
    }
}

fn nc_activate_wparam_for_policy(wparam: WPARAM, policy: WindowsBackdropStatePolicy) -> WPARAM {
    match policy {
        WindowsBackdropStatePolicy::FollowWindowActivation => wparam,
        WindowsBackdropStatePolicy::ForceActive => 1,
        WindowsBackdropStatePolicy::ForceInactive => 0,
    }
}

fn current_nc_activate_wparam(hwnd: HWND) -> WPARAM {
    unsafe { usize::from(GetForegroundWindow() == hwnd) }
}

fn refresh_dwm_backdrop_activation_state(hwnd: HWND) {
    let wparam = with_window_proc_state(hwnd, |state| {
        nc_activate_wparam_for_policy(
            current_nc_activate_wparam(hwnd),
            state.backdrop_state_policy,
        )
    });
    unsafe {
        SendMessageW(hwnd, WM_NCACTIVATE, wparam, 0);
    }
}

fn normalize_windows_background_material(value: &str) -> String {
    if WINDOWS_BACKGROUND_MATERIALS.contains(&value) {
        return value.to_string();
    }
    match value {
        "micaAlt" | "tabbedWindow" => "tabbed".to_string(),
        "mainWindow" => "mica".to_string(),
        "transientWindow" => "acrylic".to_string(),
        _ => "acrylic".to_string(),
    }
}

fn normalize_windows_corner_preference(value: &str) -> Result<String, WebviewRuntimeError> {
    if WINDOWS_CORNER_PREFERENCES.contains(&value) {
        return Ok(value.to_string());
    }
    match value {
        "doNotRoundCorner" | "square" => Ok("doNotRound".to_string()),
        "small" => Ok("roundSmall".to_string()),
        other => Err(WebviewRuntimeError::Unsupported(format!(
            "Windows cornerPreference {other} is not supported"
        ))),
    }
}

fn apply_style_patch(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    payload: SetStylePayload,
) -> Result<bool, WebviewRuntimeError> {
    let mut bridge_state = bridge.borrow_mut();
    let mut changed = false;
    if let Some(frameless) = payload.frameless {
        if bridge_state.style.frameless != frameless {
            bridge_state.style.frameless = frameless;
            changed = true;
        }
    }
    if let Some(keep_on_top) = payload.keep_on_top {
        if bridge_state.style.keep_on_top != keep_on_top {
            bridge_state.style.keep_on_top = keep_on_top;
            changed = true;
        }
    }
    if let Some(opacity) = payload.opacity {
        let opacity = normalize_opacity(opacity)?;
        if bridge_state.style.opacity != opacity {
            bridge_state.style.opacity = opacity;
            changed = true;
        }
    }
    if let Some(background) = payload.background {
        let background = normalize_windows_background(&parse_background_input(background)?)?;
        if bridge_state.style.background != background {
            bridge_state.style.background = background;
            changed = true;
        }
    }
    if let Some(windows_payload) = payload.platform.and_then(|platform| platform.windows) {
        if let Some(corner_preference) = windows_payload.corner_preference {
            let corner_preference = corner_preference
                .as_deref()
                .map(normalize_windows_corner_preference)
                .transpose()?;
            if bridge_state.style.platform.windows.corner_preference != corner_preference {
                bridge_state.style.platform.windows.corner_preference = corner_preference;
                changed = true;
            }
        }
    }
    Ok(changed)
}

fn host_surface_kind(background: &WebviewWindowBackground) -> WindowsHostSurfaceKind {
    match background {
        WebviewWindowBackground::Opaque | WebviewWindowBackground::Transparent => {
            WindowsHostSurfaceKind::TransparentNoRedirection
        }
        WebviewWindowBackground::PlatformMaterial { .. }
        | WebviewWindowBackground::Semantic { .. } => WindowsHostSurfaceKind::RedirectionSurface,
    }
}

fn needs_host_window_rebuild_for_background_transition(
    _previous: &WebviewWindowBackground,
    _next: &WebviewWindowBackground,
) -> bool {
    // Windows can switch the host ex-style/backdrop in place. Rebuilding the HWND while a WebView2
    // child is attached reintroduces the white redirection bitmap that `tauri#10318` exposed.
    false
}

fn rebuild_host_window_for_background_transition(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let (hwnd, window, webview, style, title, tray_bounds, size_constraints) = {
        let state = bridge.borrow();
        (
            state.hwnd,
            state.window,
            state.webview,
            state.style.clone(),
            state.metadata.title.clone(),
            state.tray_bounds,
            state.size_constraints,
        )
    };
    let window =
        window.ok_or_else(|| WebviewRuntimeError::Internal("window bridge is not ready".into()))?;
    let webview = webview
        .ok_or_else(|| WebviewRuntimeError::Internal("webview bridge is not ready".into()))?;
    let snapshot = snapshot_window_host_rebuild_state(hwnd)?;
    let outer_width = (snapshot.rect.right - snapshot.rect.left).max(240);
    let outer_height = (snapshot.rect.bottom - snapshot.rect.top).max(160);
    let logical_width = physical_extent_to_logical_u32(hwnd, outer_width) as i32;
    let logical_height = physical_extent_to_logical_u32(hwnd, outer_height) as i32;
    let rebuilt_window = Box::new(Win32HostWindow::create(
        &title,
        logical_width,
        logical_height,
        tray_bounds,
        wants_no_redirection_bitmap(&style),
    )?);
    set_window_physical_position(rebuilt_window.hwnd, snapshot.rect.left, snapshot.rect.top)?;
    set_window_physical_size(rebuilt_window.hwnd, outer_width, outer_height)?;
    apply_native_window_style(rebuilt_window.hwnd, &style)?;
    let was_active = unsafe { GetForegroundWindow() == hwnd };
    unsafe {
        let old_window = replace_boxed_value_in_place(window, rebuilt_window);
        bridge.borrow_mut().hwnd = window.as_ref().hwnd;
        webview
            .as_ref()
            .reparent(window.as_ref().hwnd as isize)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        window.as_ref().attach_webview(webview.as_ref());
        sync_window_proc_state(
            window.as_ref().hwnd,
            Some(NonNull::from(bridge.as_ref())),
            Some(window),
            Some(webview),
            None,
            backdrop_state_policy(&style.background),
            size_constraints,
        );
        apply_webview_client_bounds(webview.as_ref(), window.as_ref().hwnd)?;
        sync_transparent_host_surface(bridge, &style)?;
        restore_rebuilt_window_host_state(window.as_ref().hwnd, snapshot, was_active);
        drop(old_window);
    }
    notify_webview_parent_window_position_changed_from_bridge(bridge)?;
    refresh_native_window_surface(bridge.borrow().hwnd)?;
    Ok(())
}

unsafe fn replace_boxed_value_in_place<T>(target: NonNull<T>, replacement: Box<T>) -> T {
    std::ptr::replace(target.as_ptr(), *replacement)
}

fn apply_window_style(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    previous_background: Option<&WebviewWindowBackground>,
) -> Result<(), WebviewRuntimeError> {
    let (hwnd, webview, style, overlay_enabled) = {
        let state = bridge.borrow();
        (
            state.hwnd,
            state.webview,
            state.style.clone(),
            state.navigator_window.window_controls_overlay,
        )
    };
    let was_maximized = is_window_maximized(hwnd);
    let needs_rebuild = previous_background
        .map(|background| {
            needs_host_window_rebuild_for_background_transition(background, &style.background)
        })
        .unwrap_or(false);

    if needs_rebuild {
        // Crossing Windows host-surface families requires a fresh host HWND to fully reset DWM
        // composition state. Reparent the existing WebView child into that new host so page state
        // survives while the host substrate is rebuilt cleanly.
        return rebuild_host_window_for_background_transition(bridge);
    }

    // Windows transparent white-block artifacts (`tauri#10318` / `#8633`) are host-surface
    // composition bugs. The durable fix is to keep the same HWND/WebView pair and explicitly
    // clear the transparent host surface during the native redraw lifecycle, not to rebuild the
    // host when background families change.
    // Keep the WebView2 controller alpha-capable at all times. The host background family owns
    // the visible window substrate on Windows; flipping the controller backing between opaque and
    // transparent at runtime can leave stale child-surface content behind even when the host is
    // already correct.
    apply_webview_background_color(webview, wants_clear_background(&style))?;
    apply_native_window_style(hwnd, &style)?;
    sync_transparent_host_surface(bridge, &style)?;
    apply_windows_titlebar_overlay(hwnd, overlay_enabled)?;
    refresh_dwm_backdrop_activation_state(hwnd);

    if was_maximized {
        unsafe {
            ShowWindow(hwnd, SW_MAXIMIZE);
        }
    }
    if let Some(webview) = webview {
        apply_webview_client_bounds(unsafe { webview.as_ref() }, hwnd)?;
    }
    notify_webview_parent_window_position_changed_from_bridge(bridge)?;
    refresh_native_window_surface(hwnd)?;
    Ok(())
}

fn apply_native_window_style(
    hwnd: HWND,
    style: &WindowStyleState,
) -> Result<(), WebviewRuntimeError> {
    let dark_mode = current_windows_dark_mode();
    let current_style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 };
    let style_bits = window_style_bits(style, current_style);
    let current_ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let ex_style_bits = window_ex_style_bits(style, current_ex_style);
    unsafe {
        SetWindowLongPtrW(hwnd, GWL_STYLE, style_bits as isize);
        if ex_style_bits != current_ex_style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style_bits);
        }
        SetWindowPos(
            hwnd,
            if style.keep_on_top {
                HWND_TOPMOST
            } else {
                HWND_NOTOPMOST
            },
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE,
        );
    }
    apply_window_opacity(hwnd, style.opacity)?;
    apply_native_window_theme(hwnd, dark_mode)?;
    apply_dwm_client_frame(hwnd, wants_dwm_extended_client_frame(style))?;
    apply_dwm_transparency(hwnd, wants_dwm_transparent_host(style))?;
    apply_dwm_backdrop(hwnd, &style.background, dark_mode)?;
    apply_dwm_corner_preference(hwnd, style.platform.windows.corner_preference.as_deref())?;
    Ok(())
}

fn sync_transparent_host_surface(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    style: &WindowStyleState,
) -> Result<(), WebviewRuntimeError> {
    let window = bridge.borrow().window;
    let Some(mut window) = window else {
        return Ok(());
    };
    let window = unsafe { window.as_mut() };
    let host_surface_fill_color = if wants_no_redirection_bitmap(style) {
        Some(host_surface_fill_color(&style.background))
    } else {
        None
    };
    if wants_no_redirection_bitmap(style) {
        window.ensure_transparent_surface()?;
        window.present_host_surface(host_surface_fill_color.expect("host fill color"))?;
    } else {
        window.disable_transparent_surface();
    }
    sync_window_proc_state(
        window.hwnd,
        Some(NonNull::from(bridge.as_ref())),
        Some(NonNull::from(window)),
        bridge.borrow().webview,
        host_surface_fill_color,
        backdrop_state_policy(&style.background),
        bridge.borrow().size_constraints,
    );
    Ok(())
}

fn host_surface_fill_color(background: &WebviewWindowBackground) -> u32 {
    match background {
        WebviewWindowBackground::Opaque => 0x00FF_FFFF,
        WebviewWindowBackground::Transparent => 0,
        WebviewWindowBackground::PlatformMaterial { .. }
        | WebviewWindowBackground::Semantic { .. } => 0,
    }
}

fn apply_webview_background_color(
    webview: Option<NonNull<WebView>>,
    clear: bool,
) -> Result<(), WebviewRuntimeError> {
    let Some(webview) = webview else {
        return Ok(());
    };
    unsafe { webview.as_ref() }
        .set_background_color(if clear {
            CLEAR_BACKGROUND
        } else {
            OPAQUE_BACKGROUND
        })
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn sync_window_proc_state(
    hwnd: HWND,
    bridge: Option<NonNull<RefCell<NavigatorWindowBridge>>>,
    window: Option<NonNull<Win32HostWindow>>,
    webview: Option<NonNull<WebView>>,
    host_surface_fill_color: Option<u32>,
    backdrop_state_policy: WindowsBackdropStatePolicy,
    size_constraints: WindowSizeConstraints,
) {
    WINDOW_PROC_STATES.with(|states| {
        let mut states = states.borrow_mut();
        if window.is_none() && webview.is_none() {
            states.remove(&(hwnd as isize));
            return;
        }
        let previous = states.get(&(hwnd as isize)).copied().unwrap_or_default();
        states.insert(
            hwnd as isize,
            WindowProcState {
                bridge,
                window,
                webview,
                host_surface_fill_color,
                backdrop_state_policy,
                size_constraints,
                resize_interaction_active: previous.resize_interaction_active,
                last_resize_artifact_clear_at: previous.last_resize_artifact_clear_at,
            },
        );
    });
}

fn with_window_proc_state<R>(hwnd: HWND, f: impl FnOnce(WindowProcState) -> R) -> R {
    WINDOW_PROC_STATES.with(|states| {
        let state = states
            .borrow()
            .get(&(hwnd as isize))
            .copied()
            .unwrap_or_default();
        f(state)
    })
}

fn sync_window_proc_size_constraints(hwnd: HWND, size_constraints: WindowSizeConstraints) {
    WINDOW_PROC_STATES.with(|states| {
        if let Some(state) = states.borrow_mut().get_mut(&(hwnd as isize)) {
            state.size_constraints = size_constraints;
        }
    });
}

fn set_window_proc_resize_interaction(hwnd: HWND, active: bool) {
    WINDOW_PROC_STATES.with(|states| {
        if let Some(state) = states.borrow_mut().get_mut(&(hwnd as isize)) {
            state.resize_interaction_active = active;
            if active {
                state.last_resize_artifact_clear_at = None;
            }
        }
    });
}

#[derive(Debug, Clone, Copy)]
enum SizeConstraintKind {
    Minimum,
    Maximum,
}

fn apply_window_size_constraint_patch(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    kind: SizeConstraintKind,
    payload: SizeConstraintPayload,
) -> Result<Value, WebviewRuntimeError> {
    if payload.width.is_none() && payload.height.is_none() {
        return Err(WebviewRuntimeError::Rejected(
            "size constraint update requires width or height".into(),
        ));
    }
    let hwnd = bridge.borrow().hwnd;
    let mut state = bridge.borrow_mut();
    let mut constraints = state.size_constraints;
    match kind {
        SizeConstraintKind::Minimum => {
            if let Some(width) = payload.width {
                constraints.min_width = positive_constraint_i32(width, "width")?;
            }
            if let Some(height) = payload.height {
                constraints.min_height = positive_constraint_i32(height, "height")?;
            }
        }
        SizeConstraintKind::Maximum => {
            if let Some(width) = payload.width {
                constraints.max_width = positive_constraint_i32(width, "width")?;
            }
            if let Some(height) = payload.height {
                constraints.max_height = positive_constraint_i32(height, "height")?;
            }
        }
    }
    validate_size_constraint_order(constraints)?;
    state.size_constraints = constraints;
    drop(state);
    sync_window_proc_size_constraints(hwnd, constraints);
    enforce_current_window_size_constraints(bridge, constraints)?;
    Ok(size_constraints_json(constraints))
}

fn positive_constraint_i32(
    value: Option<f64>,
    field: &str,
) -> Result<Option<i32>, WebviewRuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if !value.is_finite() || value <= 0.0 {
        return Err(WebviewRuntimeError::Rejected(format!(
            "{field} must be a finite positive number or null"
        )));
    }
    Ok(Some(value.round().clamp(1.0, i32::MAX as f64) as i32))
}

fn validate_size_constraint_order(
    constraints: WindowSizeConstraints,
) -> Result<(), WebviewRuntimeError> {
    if let (Some(min_width), Some(max_width)) = (constraints.min_width, constraints.max_width) {
        if min_width > max_width {
            return Err(WebviewRuntimeError::Rejected(
                "minimum width cannot exceed maximum width".into(),
            ));
        }
    }
    if let (Some(min_height), Some(max_height)) = (constraints.min_height, constraints.max_height) {
        if min_height > max_height {
            return Err(WebviewRuntimeError::Rejected(
                "minimum height cannot exceed maximum height".into(),
            ));
        }
    }
    Ok(())
}

fn enforce_current_window_size_constraints(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    constraints: WindowSizeConstraints,
) -> Result<(), WebviewRuntimeError> {
    let hwnd = bridge.borrow().hwnd;
    let current = window_bounds(hwnd)?;
    let width = constrain_dimension(
        current.width as i32,
        constraints.min_width,
        constraints.max_width,
    );
    let height = constrain_dimension(
        current.height as i32,
        constraints.min_height,
        constraints.max_height,
    );
    if width == current.width as i32 && height == current.height as i32 {
        return Ok(());
    }
    set_window_size(hwnd, width, height)?;
    refresh_after_explicit_resize(bridge)?;
    maybe_auto_clear_windows_white_block_artifact(bridge)?;
    let response = json!({ "width": width, "height": height });
    emit_window_event(bridge, "resized", response)?;
    emit_overlay_geometry_change_if_enabled(bridge)
}

fn constrain_dimension(value: i32, min: Option<i32>, max: Option<i32>) -> i32 {
    value.clamp(min.unwrap_or(1), max.unwrap_or(i32::MAX))
}

fn size_constraints_json(constraints: WindowSizeConstraints) -> Value {
    json!({
        "minWidth": constraints.min_width,
        "minHeight": constraints.min_height,
        "maxWidth": constraints.max_width,
        "maxHeight": constraints.max_height,
    })
}

fn window_style_bits(style: &WindowStyleState, current_style: u32) -> u32 {
    let state_style = current_style & (WS_VISIBLE | WS_MAXIMIZE | WS_MINIMIZE);
    let child_safe_style = WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
    if style.frameless {
        WS_POPUP | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | child_safe_style | state_style
    } else {
        WS_OVERLAPPEDWINDOW | child_safe_style | state_style
    }
}

fn window_ex_style_bits(style: &WindowStyleState, current_ex_style: isize) -> isize {
    let no_redirection_bitmap = WS_EX_NOREDIRECTIONBITMAP as isize;
    let layered = WS_EX_LAYERED as isize;
    let with_redirection = if wants_no_redirection_bitmap(style) {
        current_ex_style | no_redirection_bitmap
    } else {
        current_ex_style & !no_redirection_bitmap
    };
    if wants_layered_opacity(style) {
        with_redirection | layered
    } else {
        with_redirection & !layered
    }
}

fn wants_no_redirection_bitmap(style: &WindowStyleState) -> bool {
    if wants_layered_opacity(style) {
        return false;
    }
    matches!(
        host_surface_kind(&style.background),
        WindowsHostSurfaceKind::TransparentNoRedirection
    )
}

fn wants_layered_opacity(style: &WindowStyleState) -> bool {
    style.opacity < 1.0
}

fn opacity_alpha_byte(opacity: f64) -> u8 {
    (opacity.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn apply_window_opacity(hwnd: HWND, opacity: f64) -> Result<(), WebviewRuntimeError> {
    if opacity >= 1.0 {
        return Ok(());
    }
    let alpha = opacity_alpha_byte(opacity);
    let ok = unsafe { SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) };
    if ok == 0 {
        return Err(WebviewRuntimeError::Internal(
            "Windows window opacity could not be applied".into(),
        ));
    }
    Ok(())
}

fn wants_clear_background(style: &WindowStyleState) -> bool {
    matches!(
        style.background,
        WebviewWindowBackground::Transparent
            | WebviewWindowBackground::PlatformMaterial { .. }
            | WebviewWindowBackground::Semantic { .. }
    )
}

fn wants_dwm_extended_client_frame(style: &WindowStyleState) -> bool {
    wants_clear_background(style)
}

fn wants_dwm_transparent_host(style: &WindowStyleState) -> bool {
    wants_clear_host_background(style)
}

fn wants_clear_host_background(style: &WindowStyleState) -> bool {
    wants_clear_background(style)
}

fn current_windows_dark_mode() -> Option<bool> {
    let subkey = wide_null("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let value_name = wide_null("AppsUseLightTheme");
    let mut value = 1u32;
    let mut value_size = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            (&mut value as *mut u32).cast(),
            &mut value_size,
        )
    };
    if result == 0 {
        Some(apps_use_light_theme_to_dark_mode(value))
    } else {
        None
    }
}

fn apps_use_light_theme_to_dark_mode(value: u32) -> bool {
    value == 0
}

fn apply_native_window_theme(
    hwnd: HWND,
    dark_mode: Option<bool>,
) -> Result<(), WebviewRuntimeError> {
    let Some(dark_mode) = dark_mode else {
        return Ok(());
    };
    let value = u32::from(dark_mode);
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            (&value as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }
    Ok(())
}

fn apply_dwm_transparency(hwnd: HWND, enabled: bool) -> Result<(), WebviewRuntimeError> {
    let region = if enabled {
        let region = unsafe { CreateRectRgn(0, 0, -1, -1) };
        if region.is_null() {
            return Err(WebviewRuntimeError::Internal(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        region
    } else {
        null_mut()
    };
    let blur = DWM_BLURBEHIND {
        dwFlags: if enabled {
            DWM_BB_ENABLE | DWM_BB_BLURREGION
        } else {
            DWM_BB_ENABLE
        },
        fEnable: if enabled { 1 } else { 0 },
        hRgnBlur: region,
        fTransitionOnMaximized: 0,
    };
    let result = unsafe { DwmEnableBlurBehindWindow(hwnd, &blur) };
    if !region.is_null() {
        unsafe {
            DeleteObject(region);
        }
    }
    if hresult_failed(result) {
        return Err(WebviewRuntimeError::Unsupported(format!(
            "Windows transparent host background could not be applied: {}",
            format_hresult(result)
        )));
    }
    Ok(())
}

fn apply_dwm_client_frame(hwnd: HWND, enabled: bool) -> Result<(), WebviewRuntimeError> {
    let margins = if enabled {
        MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        }
    } else {
        MARGINS::default()
    };
    let result = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };
    if hresult_failed(result) {
        return Err(WebviewRuntimeError::Unsupported(format!(
            "Windows DWM client frame could not be applied: {}",
            format_hresult(result)
        )));
    }
    Ok(())
}

fn refresh_native_window_surface(hwnd: HWND) -> Result<(), WebviewRuntimeError> {
    let invalidated = unsafe { InvalidateRect(hwnd, null(), 1) };
    if invalidated == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let updated = unsafe { UpdateWindow(hwnd) };
    if updated == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

fn apply_dwm_backdrop(
    hwnd: HWND,
    background: &WebviewWindowBackground,
    dark_mode: Option<bool>,
) -> Result<(), WebviewRuntimeError> {
    reset_dwm_backdrop_state(hwnd)?;
    match resolved_windows_backdrop(background) {
        Some("mica") => apply_window_vibrancy_backdrop(hwnd, "Windows Mica backdrop", |window| {
            apply_mica(window, dark_mode)
        }),
        Some("acrylic") => {
            apply_window_vibrancy_backdrop(hwnd, "Windows Acrylic backdrop", |window| {
                apply_acrylic(window, None)
            })
        }
        Some("tabbed") => {
            apply_window_vibrancy_backdrop(hwnd, "Windows Tabbed backdrop", |window| {
                apply_tabbed(window, dark_mode)
            })
        }
        Some("auto") => apply_dwm_system_backdrop(hwnd, DWMSBT_AUTO),
        None => Ok(()),
        Some(other) => Err(WebviewRuntimeError::Unsupported(format!(
            "background material {other} is not supported on Windows"
        ))),
    }
}

fn resolved_windows_backdrop(background: &WebviewWindowBackground) -> Option<&str> {
    match background {
        WebviewWindowBackground::PlatformMaterial { material, .. } => Some(material.as_str()),
        WebviewWindowBackground::Semantic { token, .. } if token == "blur" => Some("acrylic"),
        WebviewWindowBackground::Opaque
        | WebviewWindowBackground::Transparent
        | WebviewWindowBackground::Semantic { .. } => None,
    }
}

fn apply_window_vibrancy_backdrop<F>(
    hwnd: HWND,
    label: &str,
    apply: F,
) -> Result<(), WebviewRuntimeError>
where
    F: FnOnce(HwndHostHandle) -> Result<(), WindowVibrancyError>,
{
    apply(HwndHostHandle { hwnd }).map_err(|error| {
        WebviewRuntimeError::Unsupported(format!("{label} could not be applied: {error}"))
    })
}

fn reset_dwm_backdrop_state(hwnd: HWND) -> Result<(), WebviewRuntimeError> {
    // DWM can retain the previous material kind across transitions unless every substrate hook is
    // cleared before the next target backdrop is applied.
    clear_window_vibrancy_backdrops(hwnd);
    clear_dwm_host_backdrop(hwnd);
    apply_dwm_system_backdrop(hwnd, DWMSBT_NONE)
}

fn clear_window_vibrancy_backdrops(hwnd: HWND) {
    let window = HwndHostHandle { hwnd };
    let _ = clear_mica(window);
    let _ = clear_tabbed(window);
    let _ = clear_acrylic(window);
}

fn clear_dwm_host_backdrop(hwnd: HWND) {
    let value = 0u32;
    let _ = set_dwm_attribute(
        hwnd,
        DWMWA_USE_HOSTBACKDROPBRUSH as u32,
        &value,
        "Windows host backdrop",
    );
}

fn apply_dwm_system_backdrop(
    hwnd: HWND,
    value: DWM_SYSTEMBACKDROP_TYPE,
) -> Result<(), WebviewRuntimeError> {
    set_dwm_attribute(
        hwnd,
        DWMWA_SYSTEMBACKDROP_TYPE as u32,
        &value,
        "Windows backdrop",
    )
}

fn apply_dwm_corner_preference(
    hwnd: HWND,
    preference: Option<&str>,
) -> Result<(), WebviewRuntimeError> {
    let value: DWM_WINDOW_CORNER_PREFERENCE = match preference {
        Some("default") | None => DWMWCP_DEFAULT,
        Some("doNotRound") => DWMWCP_DONOTROUND,
        Some("round") => DWMWCP_ROUND,
        Some("roundSmall") => DWMWCP_ROUNDSMALL,
        Some(other) => {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "Windows cornerPreference {other} is not supported"
            )))
        }
    };
    set_dwm_attribute(
        hwnd,
        DWMWA_WINDOW_CORNER_PREFERENCE as u32,
        &value,
        "Windows corner preference",
    )
}

fn set_dwm_attribute<T>(
    hwnd: HWND,
    attribute: u32,
    value: &T,
    label: &str,
) -> Result<(), WebviewRuntimeError> {
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            (value as *const T).cast(),
            std::mem::size_of::<T>() as u32,
        )
    };
    if hresult_failed(result) {
        return Err(WebviewRuntimeError::Unsupported(format!(
            "{label} could not be applied: {}",
            format_hresult(result)
        )));
    }
    Ok(())
}

fn hresult_failed(result: i32) -> bool {
    result < 0
}

fn format_hresult(result: i32) -> String {
    format!("HRESULT 0x{:08X}", result as u32)
}

fn update_window_title(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    title: String,
    source: MetadataSource,
) -> Result<Value, WebviewRuntimeError> {
    let (hwnd, should_sync_to_page) = {
        let mut state = bridge.borrow_mut();
        if state.metadata.title == title {
            return Ok(Value::String(title));
        }
        state.metadata.title = title.clone();
        (
            state.hwnd,
            source == MetadataSource::Native
                && state.metadata.sync_title.native_to_page
                && state.page_access.title_sync,
        )
    };
    set_window_title(hwnd, &title)?;
    if webview_debug_enabled() {
        eprintln!("opentray-ext-webview window title updated: {title}");
    }
    if should_sync_to_page {
        sync_title_to_page(bridge, &title)?;
    }
    emit_window_event(bridge, "titlechange", json!({ "title": title.clone() }))?;
    Ok(Value::String(title))
}

fn update_window_icon(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    icon: Option<WebviewWindowIcon>,
    source: MetadataSource,
) -> Result<Value, WebviewRuntimeError> {
    let (hwnd, should_sync_to_page) = {
        let mut state = bridge.borrow_mut();
        if state.metadata.icon == icon {
            return icon_json(state.metadata.icon.as_ref());
        }
        state.metadata.icon = icon.clone();
        (
            state.hwnd,
            source == MetadataSource::Native
                && state.metadata.sync_icon.native_to_page
                && state.page_access.icon_sync,
        )
    };
    let native_icon = project_native_window_icon(icon.as_ref())?;
    apply_native_window_icon(hwnd, native_icon.as_ref());
    bridge.borrow_mut().metadata.native_icon = native_icon;
    if should_sync_to_page {
        sync_icon_to_page(bridge)?;
    }
    emit_window_event(bridge, "iconchange", icon_event_payload(icon.as_ref())?)?;
    icon_json(icon.as_ref())
}

fn project_native_window_icon(
    icon: Option<&WebviewWindowIcon>,
) -> Result<Option<NativeWindowIcon>, WebviewRuntimeError> {
    let Some(icon) = icon else {
        return Ok(None);
    };
    match icon {
        WebviewWindowIcon::Rgba {
            data,
            width,
            height,
        } => create_native_icon_from_rgba(data.clone(), *width, *height).map(Some),
        WebviewWindowIcon::Encoded { data } => decode_png_rgba(data)
            .and_then(|decoded| {
                create_native_icon_from_rgba(decoded.data, decoded.width, decoded.height)
            })
            .map(Some)
            .or_else(|_| Ok(None)),
        WebviewWindowIcon::File { path } => load_native_icon_from_path(Path::new(path)).map(Some),
        WebviewWindowIcon::Href { href } => {
            if let Some(bytes) = decode_data_url_image_bytes(href) {
                return decode_png_rgba(&bytes)
                    .and_then(|decoded| {
                        create_native_icon_from_rgba(decoded.data, decoded.width, decoded.height)
                    })
                    .map(Some)
                    .or_else(|_| Ok(None));
            }
            if href.starts_with("file://") {
                if let Ok(url) = Url::parse(href) {
                    if let Ok(path) = url.to_file_path() {
                        return load_native_icon_from_path(&path).map(Some);
                    }
                }
            }
            Ok(None)
        }
    }
}

fn apply_window_icon_from_bridge(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let (hwnd, icon) = {
        let state = bridge.borrow();
        (state.hwnd, state.metadata.icon.clone())
    };
    let native_icon = project_native_window_icon(icon.as_ref())?;
    apply_native_window_icon(hwnd, native_icon.as_ref());
    bridge.borrow_mut().metadata.native_icon = native_icon;
    Ok(())
}

fn apply_native_window_icon(hwnd: HWND, icon: Option<&NativeWindowIcon>) {
    let handle = icon.map(|icon| icon.handle).unwrap_or(null_mut());
    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as WPARAM, handle as LPARAM);
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as WPARAM, handle as LPARAM);
    }
}

fn create_native_icon_from_rgba(
    data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<NativeWindowIcon, WebviewRuntimeError> {
    if width == 0 || height == 0 {
        return Err(WebviewRuntimeError::Rejected(
            "rgba icon dimensions must be greater than zero".into(),
        ));
    }
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| WebviewRuntimeError::Rejected("rgba icon dimensions overflow".into()))?;
    if data.len() != expected_len {
        return Err(WebviewRuntimeError::Rejected(format!(
            "rgba icon requires {expected_len} bytes for {width}x{height}, got {}",
            data.len()
        )));
    }

    let mut bgra = data;
    let mut and_mask = Vec::with_capacity(expected_len / 4);
    for pixel in bgra.chunks_exact_mut(4) {
        and_mask.push(pixel[3].wrapping_sub(u8::MAX));
        pixel.swap(0, 2);
    }
    let handle = unsafe {
        CreateIcon(
            null_mut(),
            i32::try_from(width).unwrap_or(i32::MAX),
            i32::try_from(height).unwrap_or(i32::MAX),
            1,
            32,
            and_mask.as_ptr(),
            bgra.as_ptr(),
        )
    };
    if handle.is_null() {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(NativeWindowIcon { handle })
}

fn load_native_icon_from_path(path: &Path) -> Result<NativeWindowIcon, WebviewRuntimeError> {
    let path = path
        .to_str()
        .ok_or_else(|| WebviewRuntimeError::Rejected("icon file path must be UTF-8".into()))?;
    let path = wide_null(path);
    let handle = unsafe {
        LoadImageW(
            null_mut(),
            path.as_ptr(),
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_LOADFROMFILE,
        )
    };
    if handle.is_null() {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(NativeWindowIcon {
        handle: handle as HICON,
    })
}

struct DecodedPngRgba {
    data: Vec<u8>,
    width: u32,
    height: u32,
}

fn decode_png_rgba(bytes: &[u8]) -> Result<DecodedPngRgba, WebviewRuntimeError> {
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|error| WebviewRuntimeError::Rejected(format!("icon PNG is invalid: {error}")))?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|error| WebviewRuntimeError::Rejected(format!("icon PNG is invalid: {error}")))?;
    let pixels = &buffer[..info.buffer_size()];
    let data = match info.color_type {
        png::ColorType::Rgba => pixels.to_vec(),
        png::ColorType::Rgb => {
            let mut rgba = Vec::with_capacity(pixels.len() / 3 * 4);
            for pixel in pixels.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
            rgba
        }
        png::ColorType::Grayscale => {
            let mut rgba = Vec::with_capacity(pixels.len() * 4);
            for value in pixels {
                rgba.extend_from_slice(&[*value, *value, *value, 255]);
            }
            rgba
        }
        png::ColorType::GrayscaleAlpha => {
            let mut rgba = Vec::with_capacity(pixels.len() / 2 * 4);
            for pixel in pixels.chunks_exact(2) {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
            }
            rgba
        }
        png::ColorType::Indexed => {
            return Err(WebviewRuntimeError::Rejected(
                "indexed PNG window icons are not supported on Windows yet".into(),
            ))
        }
    };
    Ok(DecodedPngRgba {
        data,
        width: info.width,
        height: info.height,
    })
}

fn decode_data_url_image_bytes(href: &str) -> Option<Vec<u8>> {
    if !href.starts_with("data:image/") {
        return None;
    }
    let (_, encoded) = href.split_once(",")?;
    BASE64_STANDARD.decode(encoded).ok()
}

fn handle_document_title_changed(bridge: &Rc<RefCell<NavigatorWindowBridge>>, title: String) {
    let state = bridge.borrow();
    if !state.metadata.sync_title.page_to_native || !state.page_access.title_sync {
        return;
    }
    drop(state);
    if let Err(error) = update_window_title(bridge, title, MetadataSource::Page) {
        eprintln!("opentray-ext-webview title sync failed: {error}");
    }
}

fn sync_native_metadata_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let (title, sync_title, sync_icon) = {
        let state = bridge.borrow();
        (
            state.metadata.title.clone(),
            state.metadata.sync_title.native_to_page && state.page_access.title_sync,
            state.metadata.sync_icon.native_to_page && state.page_access.icon_sync,
        )
    };
    if sync_title {
        sync_title_to_page(bridge, &title)?;
    }
    if sync_icon {
        sync_icon_to_page(bridge)?;
    }
    Ok(())
}

fn sync_title_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    title: &str,
) -> Result<(), WebviewRuntimeError> {
    let title_json = serde_json::to_string(title)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    evaluate_bridge_script(
        bridge,
        format!("{WINDOW_INTERNALS_GLOBAL}.setDocumentTitle({title_json});"),
    )
}

fn sync_icon_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let href = bridge
        .borrow()
        .metadata
        .icon
        .as_ref()
        .and_then(window_icon_href_for_page);
    let href_json = serde_json::to_string(&href)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    evaluate_bridge_script(
        bridge,
        format!("{WINDOW_INTERNALS_GLOBAL}.setPageIconHref({href_json});"),
    )
}

fn window_icon_href_for_page(icon: &WebviewWindowIcon) -> Option<String> {
    match icon {
        WebviewWindowIcon::Href { href } => Some(href.clone()),
        WebviewWindowIcon::File { path } => Some(format!("file://{path}")),
        WebviewWindowIcon::Encoded { data } => Some(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(data)
        )),
        WebviewWindowIcon::Rgba {
            data,
            width,
            height,
        } => encode_rgba_png(data, *width, *height)
            .ok()
            .map(|bytes| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes))),
    }
}

fn encode_rgba_png(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, WebviewRuntimeError> {
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| WebviewRuntimeError::Rejected("rgba icon dimensions overflow".into()))?;
    if data.len() != expected_len {
        return Err(WebviewRuntimeError::Rejected(format!(
            "rgba icon requires {expected_len} bytes for {width}x{height}, got {}",
            data.len()
        )));
    }
    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(Cursor::new(&mut output), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    writer
        .write_image_data(data)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    drop(writer);
    Ok(output)
}

fn icon_json(icon: Option<&WebviewWindowIcon>) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(icon).map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn icon_event_payload(icon: Option<&WebviewWindowIcon>) -> Result<Value, WebviewRuntimeError> {
    Ok(json!({ "icon": icon_json(icon)? }))
}

fn resolve_callback(
    bridge: &RefCell<NavigatorWindowBridge>,
    callback_id: u32,
    payload: Value,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, callback_script(callback_id, &payload)?)
}

fn reject_callback(
    bridge: &RefCell<NavigatorWindowBridge>,
    callback_id: u32,
    error: &WebviewRuntimeError,
) -> Result<(), WebviewRuntimeError> {
    evaluate_bridge_script(bridge, error_callback_script(callback_id, error)?)
}

pub(super) fn emit_window_event(
    bridge: &RefCell<NavigatorWindowBridge>,
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

fn emit_overlay_geometry_change_if_enabled(
    bridge: &RefCell<NavigatorWindowBridge>,
) -> Result<(), WebviewRuntimeError> {
    let should_emit = {
        let state = bridge.borrow();
        state.navigator_window.window_controls_overlay
            && state.has_listener("overlay.geometrychange")
    };
    if !should_emit {
        return Ok(());
    }
    let rect = titlebar_area_rect_json(bridge.borrow().hwnd)?;
    emit_window_event(
        bridge,
        "overlay.geometrychange",
        json!({ "titlebarAreaRect": rect }),
    )
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
    bridge: &RefCell<NavigatorWindowBridge>,
    script: String,
) -> Result<(), WebviewRuntimeError> {
    let webview = bridge
        .borrow()
        .webview
        .ok_or_else(|| WebviewRuntimeError::Internal("webview bridge is not ready".into()))?;
    unsafe { webview.as_ref() }
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

fn webview_debug_enabled() -> bool {
    std::env::var_os("OPENTRAY_WEBVIEW_DEBUG").is_some()
}

fn window_state_json(hwnd: HWND) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(window_state_snapshot(hwnd))
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn window_bounds_json(hwnd: HWND) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(window_bounds(hwnd)?)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn window_bounds(hwnd: HWND) -> Result<Rect, WebviewRuntimeError> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(physical_rect_to_public_window_rect(hwnd, rect))
}

fn snapshot_window_host_rebuild_state(
    hwnd: HWND,
) -> Result<WindowHostRebuildSnapshot, WebviewRuntimeError> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(WindowHostRebuildSnapshot {
        rect,
        state: window_state_snapshot(hwnd),
    })
}

fn restore_rebuilt_window_host_state(
    hwnd: HWND,
    snapshot: WindowHostRebuildSnapshot,
    was_active: bool,
) {
    unsafe {
        match snapshot.state.state {
            WindowStateKind::Minimized => {
                ShowWindow(hwnd, SW_MINIMIZE);
            }
            WindowStateKind::Maximized => {
                ShowWindow(hwnd, SW_SHOW);
                ShowWindow(hwnd, SW_MAXIMIZE);
            }
            WindowStateKind::Normal => {
                ShowWindow(hwnd, SW_SHOW);
            }
        }
        if was_active && snapshot.state.visible && !snapshot.state.minimized {
            SetForegroundWindow(hwnd);
        }
    }
}

fn window_state_snapshot(hwnd: HWND) -> WindowStateSnapshot {
    let minimized = unsafe { IsIconic(hwnd) != 0 };
    let maximized = is_window_maximized(hwnd);
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
        visible: unsafe { IsWindowVisible(hwnd) != 0 },
    }
}

fn is_window_maximized(hwnd: HWND) -> bool {
    unsafe { IsIconic(hwnd) == 0 && IsZoomed(hwnd) != 0 }
}

fn screen_details_json(hwnd: HWND) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(screen_details(hwnd))
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn screen_details(hwnd: HWND) -> ScreenDetailsState {
    let current_screen = current_monitor_detail(hwnd);
    ScreenDetailsState {
        current_screen: current_screen.clone(),
        screens: current_screen.into_iter().collect(),
        is_extended: false,
        coordinate_origin: "topLeft",
    }
}

fn current_monitor_detail(hwnd: HWND) -> Option<ScreenDetailState> {
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        rcWork: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        dwFlags: 0,
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return None;
    }
    Some(ScreenDetailState {
        id: "screen-0".to_string(),
        label: "Display 1".to_string(),
        is_primary: info.dwFlags & 1 != 0,
        frame: physical_rect_to_public_window_rect(hwnd, info.rcMonitor),
        visible_frame: physical_rect_to_public_window_rect(hwnd, info.rcWork),
        scale_factor: windows_geometry(hwnd).scale_factor(),
    })
}

fn titlebar_area_rect_json(hwnd: HWND) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(titlebar_area_rect_payload(hwnd))
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsTitlebarAreaRectPayload {
    unit: &'static str,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    client_width: u32,
    client_height: u32,
}

fn titlebar_area_rect_payload(hwnd: HWND) -> WindowsTitlebarAreaRectPayload {
    let Some((client_width, client_height)) = physical_client_size(hwnd) else {
        return WindowsTitlebarAreaRectPayload {
            unit: "physical",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            client_width: 0,
            client_height: 0,
        };
    };
    // AppWindowTitleBar insets are the official overlay layout contract. DWM caption bounds are a
    // system-derived fallback for runtimes that can extend content but cannot expose AppWindow.
    // Keep these values physical. The bootstrap script converts them to the page's CSS px after
    // WebView2, page zoom, DPR, and viewport rules have settled.
    let metrics = appwindow_titlebar_metrics(hwnd)
        .ok()
        .filter(|metrics| metrics.right_inset > 0.0 || metrics.left_inset > 0.0)
        .or_else(|| dwm_caption_button_titlebar_metrics(hwnd, client_width))
        .unwrap_or_else(|| fallback_titlebar_metrics(hwnd));
    let rect = titlebar_area_rect_from_metrics(client_width, metrics);
    WindowsTitlebarAreaRectPayload {
        unit: "physical",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        client_width: client_width.max(0) as u32,
        client_height: client_height.max(0) as u32,
    }
}

fn titlebar_area_rect_from_metrics(client_width: i32, metrics: WindowsTitlebarMetrics) -> Rect {
    let x = metrics.left_inset.round().max(0.0) as i32;
    let width = ((client_width as f64) - metrics.left_inset - metrics.right_inset)
        .max(0.0)
        .round() as u32;
    Rect {
        x,
        y: 0,
        width,
        height: metrics.height.round().max(1.0) as u32,
    }
}

fn dwm_caption_button_titlebar_metrics(
    hwnd: HWND,
    client_width: i32,
) -> Option<WindowsTitlebarMetrics> {
    let mut bounds = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_BUTTON_BOUNDS as u32,
            (&mut bounds as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if hresult_failed(result) {
        return None;
    }
    let (client_left, client_top) = client_origin_in_window_coordinates(hwnd)?;
    let (left, top, right, bottom) =
        client_rect_from_window_relative_rect(bounds, (client_left, client_top))?;
    if right <= left || bottom <= top {
        return None;
    }
    Some(WindowsTitlebarMetrics {
        left_inset: 0.0,
        right_inset: ((client_width as f64) - left).max(right - left).max(0.0),
        height: (bottom - top).max(1.0),
    })
}

fn client_rect_from_window_relative_rect(
    rect: RECT,
    client_origin: (i32, i32),
) -> Option<(f64, f64, f64, f64)> {
    let raw_left = (rect.left - client_origin.0) as f64;
    let raw_top = (rect.top - client_origin.1) as f64;
    let raw_right = (rect.right - client_origin.0) as f64;
    let raw_bottom = (rect.bottom - client_origin.1) as f64;
    Some((
        raw_left.min(raw_right),
        raw_top.min(raw_bottom),
        raw_left.max(raw_right),
        raw_top.max(raw_bottom),
    ))
}

fn client_origin_in_window_coordinates(hwnd: HWND) -> Option<(i32, i32)> {
    let mut window = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut window) } == 0 {
        return None;
    }
    let mut client_origin = POINT { x: 0, y: 0 };
    if unsafe { ClientToScreen(hwnd, &mut client_origin) } == 0 {
        return None;
    }
    Some((client_origin.x - window.left, client_origin.y - window.top))
}

fn fallback_titlebar_metrics(hwnd: HWND) -> WindowsTitlebarMetrics {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let dpi = if dpi == 0 { 96 } else { dpi };
    WindowsTitlebarMetrics {
        left_inset: 0.0,
        right_inset: physical_system_metric(SM_CXSIZE, dpi) * 3.0,
        height: physical_system_metric(SM_CYSIZE, dpi).max(40.0),
    }
}

fn physical_system_metric(index: i32, dpi: u32) -> f64 {
    let value = unsafe { GetSystemMetricsForDpi(index, dpi) };
    if value <= 0 {
        return 0.0;
    }
    (value as f64).max(0.0)
}

fn start_app_region_drag(hwnd: HWND) -> Result<Value, WebviewRuntimeError> {
    unsafe {
        ReleaseCapture();
        SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION as WPARAM, 0);
    }
    Ok(json!({ "active": true }))
}

fn set_window_title(hwnd: HWND, title: &str) -> Result<(), WebviewRuntimeError> {
    let title = wide_null(title);
    if unsafe { SetWindowTextW(hwnd, title.as_ptr()) } == 0 {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

fn set_window_position(hwnd: HWND, x: i32, y: i32) -> Result<(), WebviewRuntimeError> {
    set_window_physical_position(
        hwnd,
        logical_to_physical_i32(hwnd, x),
        logical_to_physical_i32(hwnd, y),
    )
}

fn set_window_physical_position(hwnd: HWND, x: i32, y: i32) -> Result<(), WebviewRuntimeError> {
    if unsafe {
        SetWindowPos(
            hwnd,
            null_mut(),
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    } == 0
    {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

fn set_window_size(hwnd: HWND, width: i32, height: i32) -> Result<(), WebviewRuntimeError> {
    set_window_physical_size(
        hwnd,
        logical_to_physical_i32(hwnd, width),
        logical_to_physical_i32(hwnd, height),
    )
}

fn set_window_physical_size(
    hwnd: HWND,
    width: i32,
    height: i32,
) -> Result<(), WebviewRuntimeError> {
    if unsafe {
        SetWindowPos(
            hwnd,
            null_mut(),
            0,
            0,
            width,
            height,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    } == 0
    {
        return Err(WebviewRuntimeError::Internal(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(())
}

fn window_dpi(hwnd: HWND) -> u32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        96
    } else {
        dpi
    }
}

fn windows_geometry(hwnd: HWND) -> WindowsGeometry {
    WindowsGeometry::from_dpi(window_dpi(hwnd))
}

fn logical_to_physical_i32(hwnd: HWND, value: i32) -> i32 {
    windows_geometry(hwnd).logical_to_physical_i32(value)
}

fn physical_to_logical_i32(hwnd: HWND, value: i32) -> i32 {
    windows_geometry(hwnd).physical_to_logical_i32(value)
}

fn physical_extent_to_logical_u32(hwnd: HWND, value: i32) -> u32 {
    physical_to_logical_i32(hwnd, value.max(0)).max(0) as u32
}

fn physical_rect_to_public_window_rect(hwnd: HWND, rect: RECT) -> Rect {
    windows_geometry(hwnd).physical_rect_to_logical_rect(rect)
}

#[cfg(test)]
fn logical_to_physical_i32_for_dpi(dpi: u32, value: i32) -> i32 {
    opentray_spec::geometry::logical_to_physical_i32_for_dpi(dpi, value)
}

#[cfg(test)]
fn physical_to_logical_i32_for_dpi(dpi: u32, value: i32) -> i32 {
    opentray_spec::geometry::physical_to_logical_i32_for_dpi(dpi, value)
}

#[cfg(test)]
fn physical_rect_to_public_window_rect_for_dpi(dpi: u32, rect: RECT) -> Rect {
    WindowsGeometry::from_dpi(dpi).physical_rect_to_logical_rect(rect)
}

fn finite_i32(value: f64, field: &str) -> Result<i32, WebviewRuntimeError> {
    if !value.is_finite() {
        return Err(WebviewRuntimeError::Rejected(format!(
            "{field} must be a finite number"
        )));
    }
    Ok(value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32)
}

fn resolve_page_access(
    show_settings: &WebviewShowSettings,
    page_source: &PageSourceState,
) -> PageCapabilityAccess {
    let title_sync_requested = show_settings.window.sync.title.page_to_native
        || show_settings.window.sync.title.native_to_page;
    let icon_sync_requested = show_settings.window.sync.icon.page_to_native
        || show_settings.window.sync.icon.native_to_page;
    let permission_manager =
        policy_allows(
            &show_settings.native_api_policy,
            Some(
                show_settings
                    .permission_manager_policy
                    .default_src
                    .as_slice(),
            ),
            page_source,
        ) || exact_remote_permission_manager_origin_allows(show_settings, page_source);
    let window = show_settings.navigator_window.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.window.as_deref(),
            page_source,
        );
    let screen = show_settings.navigator_screen.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.screen.as_deref(),
            page_source,
        );
    let tray = show_settings.navigator_tray.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.tray.as_deref(),
            page_source,
        );
    PageCapabilityAccess {
        window,
        screen,
        tray,
        window_globals: show_settings.navigator_window.bind_window_globals
            && window
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.window_globals.as_deref(),
                page_source,
            ),
        screen_globals: show_settings.navigator_screen.bind_screen_globals
            && screen
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.screen_globals.as_deref(),
                page_source,
            ),
        title_sync: title_sync_requested
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.title_sync.as_deref(),
                page_source,
            ),
        icon_sync: icon_sync_requested
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.icon_sync.as_deref(),
                page_source,
            ),
        permission_manager,
    }
}

fn resolve_page_access_from_bridge(bridge: &NavigatorWindowBridge) -> PageCapabilityAccess {
    let title_sync_requested =
        bridge.metadata.sync_title.page_to_native || bridge.metadata.sync_title.native_to_page;
    let icon_sync_requested =
        bridge.metadata.sync_icon.page_to_native || bridge.metadata.sync_icon.native_to_page;
    let permission_manager = policy_allows(
        &bridge.native_api_policy,
        Some(bridge.permission_manager_policy.default_src.as_slice()),
        &bridge.page_source,
    ) || exact_remote_permission_manager_origin_allows_bridge(bridge);
    let window = bridge.navigator_window.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.window.as_deref(),
            &bridge.page_source,
        );
    let screen = bridge.navigator_screen.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.screen.as_deref(),
            &bridge.page_source,
        );
    let tray = bridge.navigator_tray.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.tray.as_deref(),
            &bridge.page_source,
        );
    PageCapabilityAccess {
        window,
        screen,
        tray,
        window_globals: bridge.navigator_window.bind_window_globals
            && window
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.window_globals.as_deref(),
                &bridge.page_source,
            ),
        screen_globals: bridge.navigator_screen.bind_screen_globals
            && screen
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.screen_globals.as_deref(),
                &bridge.page_source,
            ),
        title_sync: title_sync_requested
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.title_sync.as_deref(),
                &bridge.page_source,
            ),
        icon_sync: icon_sync_requested
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.icon_sync.as_deref(),
                &bridge.page_source,
            ),
        permission_manager,
    }
}

fn exact_remote_permission_manager_origin_allows(
    show_settings: &WebviewShowSettings,
    page_source: &PageSourceState,
) -> bool {
    let ResolvedPageSource::Remote {
        origin: Some(origin),
    } = classify_page_source(page_source)
    else {
        return false;
    };
    show_settings
        .permission_manager_policy
        .remote_origins
        .iter()
        .any(|allowed| allowed == &origin)
}

fn exact_remote_permission_manager_origin_allows_bridge(bridge: &NavigatorWindowBridge) -> bool {
    let ResolvedPageSource::Remote {
        origin: Some(origin),
    } = classify_page_source(&bridge.page_source)
    else {
        return false;
    };
    bridge
        .permission_manager_policy
        .remote_origins
        .iter()
        .any(|allowed| allowed == &origin)
}

fn update_page_access_for_url(bridge: &Rc<RefCell<NavigatorWindowBridge>>, url: &str) {
    let mut state = bridge.borrow_mut();
    let keep_host_html =
        state.page_source.host_html && state.page_source.url.is_none() && url == "about:blank";
    state.page_source.host_html = keep_host_html;
    state.page_source.url = Some(url.to_string());
    state.page_access = resolve_page_access_from_bridge(&state);
}

fn policy_allows(
    policy: &WebviewNativeApiPolicy,
    directive: Option<&[WebviewNativeApiSource]>,
    page_source: &PageSourceState,
) -> bool {
    let rules = directive.unwrap_or(&policy.default_src);
    let source = classify_page_source(page_source);
    rules.iter().any(|rule| match_source_rule(rule, &source))
}

fn resolve_browser_permission_decision(
    policy: &WebviewBrowserPermissionPolicy,
    family: WebviewBrowserPermissionFamily,
    page_source: &PageSourceState,
) -> WebviewBrowserPermissionDecision {
    let source = classify_page_source(page_source);
    let matched = policy.rules.iter().find(|rule| {
        rule.family == family
            && rule
                .sources
                .iter()
                .any(|candidate| match_source_rule(candidate, &source))
    });
    matched
        .map(|rule| rule.decision)
        .unwrap_or_else(|| match source {
            ResolvedPageSource::Local => WebviewBrowserPermissionDecision::Allow,
            ResolvedPageSource::Remote { .. } => WebviewBrowserPermissionDecision::Deny,
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedPageSource {
    Local,
    Remote { origin: Option<String> },
}

fn classify_page_source(page_source: &PageSourceState) -> ResolvedPageSource {
    if page_source.host_html {
        return ResolvedPageSource::Local;
    }
    let Some(url_text) = page_source.url.as_deref() else {
        return ResolvedPageSource::Local;
    };
    let Ok(url) = Url::parse(url_text) else {
        return ResolvedPageSource::Remote { origin: None };
    };
    match url.scheme() {
        "file" | "data" | "about" => ResolvedPageSource::Local,
        "http" | "https" => {
            let host = url.host_str().unwrap_or_default();
            if is_loopback_host(host) {
                ResolvedPageSource::Local
            } else {
                ResolvedPageSource::Remote {
                    origin: Some(url.origin().ascii_serialization()),
                }
            }
        }
        _ => ResolvedPageSource::Remote { origin: None },
    }
}

fn match_source_rule(rule: &WebviewNativeApiSource, source: &ResolvedPageSource) -> bool {
    match rule {
        WebviewNativeApiSource::None => false,
        WebviewNativeApiSource::Any => true,
        WebviewNativeApiSource::Local => matches!(source, ResolvedPageSource::Local),
        WebviewNativeApiSource::Remote => matches!(source, ResolvedPageSource::Remote { .. }),
        WebviewNativeApiSource::Origin(expected) => matches!(
            source,
            ResolvedPageSource::Remote {
                origin: Some(actual)
            } if actual == expected
        ),
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
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
            keep_on_top: true,
            opacity: true,
            title: true,
            icon: true,
            screen: self.page_access.screen,
            tray: self.page_access.tray,
            global_bindings_enabled: self.page_access.window_globals,
            global_bindings_supported: true,
            screen_bindings_enabled: self.page_access.screen_globals,
            screen_bindings_supported: true,
            platform: "windows",
            background: true,
            platform_capabilities: WindowPlatformCapabilities {
                windows: WindowsWindowCapabilities {
                    background_materials: WINDOWS_BACKGROUND_MATERIALS
                        .iter()
                        .map(|material| (*material).to_string())
                        .collect(),
                    semantic_backgrounds: vec!["blur".to_string()],
                    background_states: WINDOWS_BACKGROUND_STATES
                        .iter()
                        .map(|state| (*state).to_string())
                        .collect(),
                    corner_preference: true,
                },
            },
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

struct Win32HostWindow {
    hwnd: HWND,
    transparent_surface: Option<TransparentHostSurface>,
}

struct TransparentHostSurface {
    #[allow(dead_code)]
    context: SoftbufferContext<WindowsDisplayBridge>,
    surface: SoftbufferSurface<WindowsDisplayBridge, HwndHostHandle>,
}

impl Win32HostWindow {
    fn create(
        title: &str,
        width: i32,
        height: i32,
        tray_bounds: Option<Rect>,
        no_redirection_bitmap: bool,
    ) -> Result<Self, WebviewRuntimeError> {
        let hinstance = unsafe { GetModuleHandleW(null()) };
        if hinstance.is_null() {
            return Err(WebviewRuntimeError::Internal(
                "failed to resolve current module handle".into(),
            ));
        }
        register_window_class(hinstance);

        let class_name = wide_null(CLASS_NAME);
        let title = wide_null(title);
        let (x, y) = initial_window_position(width, height, tray_bounds);
        // Plain opaque/transparent host backgrounds share the same no-redirection substrate on
        // Windows. Material backdrops still need the redirection surface so DWM can own the
        // backdrop composition path.
        let ex_style = if no_redirection_bitmap {
            WS_EX_NOREDIRECTIONBITMAP
        } else {
            0
        };
        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                x,
                y,
                width,
                height,
                null_mut(),
                null_mut(),
                hinstance,
                null(),
            )
        };
        if hwnd.is_null() {
            return Err(WebviewRuntimeError::Internal(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        set_window_size(hwnd, width, height)?;
        if tray_bounds.is_some() {
            set_window_position(hwnd, x, y)?;
        }
        let mut window = Self {
            hwnd,
            transparent_surface: None,
        };
        if no_redirection_bitmap {
            window.ensure_transparent_surface()?;
            // Start from a known transparent surface before the real style fill is applied.
            window.present_host_surface(0)?;
        }
        Ok(window)
    }

    fn show(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_SHOW);
        }
    }

    fn hide(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_HIDE);
        }
    }

    fn focus(&self) {
        unsafe {
            ShowWindow(self.hwnd, SW_SHOWNORMAL);
            SetForegroundWindow(self.hwnd);
        }
    }

    fn resize_to(&self, width: i32, height: i32) -> Result<(), WebviewRuntimeError> {
        set_window_size(self.hwnd, width, height)
    }

    fn position_near_tray(
        &self,
        width: i32,
        height: i32,
        tray_bounds: Option<Rect>,
    ) -> Result<(), WebviewRuntimeError> {
        if tray_bounds.is_none() {
            return Ok(());
        }
        let (x, y) = initial_window_position(width, height, tray_bounds);
        set_window_position(self.hwnd, x, y)
    }

    fn attach_webview(&self, webview: &WebView) {
        unsafe {
            SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, webview as *const WebView as isize);
        }
    }

    fn detach_webview(&self) {
        unsafe {
            SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
        }
    }

    fn ensure_transparent_surface(&mut self) -> Result<(), WebviewRuntimeError> {
        if self.transparent_surface.is_some() {
            return Ok(());
        }
        let display = WindowsDisplayBridge;
        let window = HwndHostHandle { hwnd: self.hwnd };
        let context = SoftbufferContext::new(display)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        let surface = SoftbufferSurface::new(&context, window)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        self.transparent_surface = Some(TransparentHostSurface { context, surface });
        Ok(())
    }

    fn disable_transparent_surface(&mut self) {
        self.transparent_surface = None;
    }

    fn present_host_surface(&mut self, fill_color: u32) -> Result<(), WebviewRuntimeError> {
        let Some(surface) = self.transparent_surface.as_mut() else {
            return Ok(());
        };
        let mut client = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        unsafe {
            GetClientRect(self.hwnd, &mut client);
        }
        let width = (client.right - client.left).max(0) as u32;
        let height = (client.bottom - client.top).max(0) as u32;
        let (Some(width), Some(height)) = (NonZeroU32::new(width), NonZeroU32::new(height)) else {
            return Ok(());
        };
        surface
            .surface
            .resize(width, height)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        let mut buffer = surface
            .surface
            .buffer_mut()
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        buffer.fill(fill_color);
        buffer
            .present()
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
    }
}

impl Drop for Win32HostWindow {
    fn drop(&mut self) {
        if !self.hwnd.is_null() {
            unsafe {
                SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
                DestroyWindow(self.hwnd);
            }
        }
    }
}

impl HasWindowHandle for Win32HostWindow {
    fn window_handle(&self) -> Result<WindowHandle<'_>, raw_window_handle::HandleError> {
        let hwnd = NonZeroIsize::new(self.hwnd as isize)
            .ok_or(raw_window_handle::HandleError::Unavailable)?;
        let raw = RawWindowHandle::Win32(Win32WindowHandle::new(hwnd));
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

#[derive(Clone, Copy)]
struct HwndHostHandle {
    hwnd: HWND,
}

impl HasWindowHandle for HwndHostHandle {
    fn window_handle(&self) -> Result<WindowHandle<'_>, raw_window_handle::HandleError> {
        let hwnd = NonZeroIsize::new(self.hwnd as isize)
            .ok_or(raw_window_handle::HandleError::Unavailable)?;
        let raw = RawWindowHandle::Win32(Win32WindowHandle::new(hwnd));
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

#[derive(Clone, Copy)]
struct WindowsDisplayBridge;

impl HasDisplayHandle for WindowsDisplayBridge {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, raw_window_handle::HandleError> {
        Ok(unsafe {
            DisplayHandle::borrow_raw(RawDisplayHandle::Windows(WindowsDisplayHandle::new()))
        })
    }
}

fn register_window_class(hinstance: HINSTANCE) {
    let class_name = wide_null(CLASS_NAME);
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW | CS_OWNDC,
        lpfnWndProc: Some(window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: null_mut(),
        hCursor: unsafe { LoadCursorW(null_mut(), IDC_ARROW) },
        hbrBackground: null_mut(),
        lpszMenuName: null(),
        lpszClassName: class_name.as_ptr(),
    };
    unsafe {
        RegisterClassW(&class);
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLOSE => {
            ShowWindow(hwnd, SW_HIDE);
            0
        }
        WM_ERASEBKGND => 1,
        WM_SETTINGCHANGE => {
            if let Err(error) = apply_native_window_theme(hwnd, current_windows_dark_mode()) {
                eprintln!("opentray-ext-webview failed to update Windows native theme: {error}");
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_NCACTIVATE => {
            let wparam = with_window_proc_state(hwnd, |state| {
                nc_activate_wparam_for_policy(wparam, state.backdrop_state_policy)
            });
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_ACTIVATE => {
            emit_window_focus_change(hwnd, (wparam & 0xffff) != WA_INACTIVE as usize);
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_GETMINMAXINFO => {
            apply_minmax_info(hwnd, lparam);
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_ENTERSIZEMOVE => {
            set_window_proc_resize_interaction(hwnd, true);
            emit_window_interaction_change(hwnd, true);
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_EXITSIZEMOVE => {
            set_window_proc_resize_interaction(hwnd, false);
            emit_window_interaction_change(hwnd, false);
            with_window_proc_state(hwnd, |state| {
                if let Some(bridge) = state.bridge {
                    if let Err(error) =
                        maybe_auto_clear_windows_white_block_artifact(unsafe { bridge.as_ref() })
                    {
                        eprintln!(
                            "opentray-ext-webview failed to auto-clear Windows resize artifact: {error}"
                        );
                    }
                }
            });
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_WINDOWPOSCHANGED => {
            refresh_attached_window_surface(hwnd);
            let result = DefWindowProcW(hwnd, msg, wparam, lparam);
            refresh_attached_window_surface(hwnd);
            result
        }
        WM_SIZE => {
            let result = DefWindowProcW(hwnd, msg, wparam, lparam);
            refresh_attached_window_surface(hwnd);
            if let Err(error) =
                maybe_auto_clear_windows_white_block_artifact_during_live_resize(hwnd)
            {
                eprintln!(
                    "opentray-ext-webview failed to auto-clear Windows live resize artifact: {error}"
                );
            }
            result
        }
        WM_PAINT => {
            let result = DefWindowProcW(hwnd, msg, wparam, lparam);
            refresh_attached_window_surface(hwnd);
            result
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn apply_minmax_info(hwnd: HWND, lparam: LPARAM) {
    if lparam == 0 {
        return;
    }
    let constraints = with_window_proc_state(hwnd, |state| state.size_constraints);
    unsafe {
        let minmax = &mut *(lparam as *mut MINMAXINFO);
        if let Some(width) = constraints.min_width {
            minmax.ptMinTrackSize.x = logical_to_physical_i32(hwnd, width);
        }
        if let Some(height) = constraints.min_height {
            minmax.ptMinTrackSize.y = logical_to_physical_i32(hwnd, height);
        }
        if let Some(width) = constraints.max_width {
            minmax.ptMaxTrackSize.x = logical_to_physical_i32(hwnd, width);
        }
        if let Some(height) = constraints.max_height {
            minmax.ptMaxTrackSize.y = logical_to_physical_i32(hwnd, height);
        }
    }
}

fn refresh_attached_window_surface(hwnd: HWND) {
    with_window_proc_state(hwnd, |state| {
        if let (Some(mut window), Some(fill_color)) = (state.window, state.host_surface_fill_color)
        {
            if let Err(error) = unsafe { window.as_mut() }.present_host_surface(fill_color) {
                eprintln!("opentray-ext-webview failed to present Windows host surface: {error}");
            }
        }
        if let Some(webview) = state.webview {
            if let Err(error) = apply_webview_client_bounds(unsafe { webview.as_ref() }, hwnd) {
                eprintln!("opentray-ext-webview failed to resize Windows WebView child: {error}");
            }
        }
    });
}

fn emit_window_interaction_change(hwnd: HWND, active: bool) {
    with_window_proc_state(hwnd, |state| {
        if let Some(bridge) = state.bridge {
            let bridge = unsafe { bridge.as_ref() };
            bridge
                .borrow_mut()
                .window_events
                .push_back(json!({ "type": "windowinteractionchange", "active": active }));
            if let Err(error) = emit_window_event(
                bridge,
                "windowinteractionchange",
                json!({ "active": active }),
            ) {
                eprintln!("opentray-ext-webview failed to emit Windows interaction event: {error}");
            }
        }
    });
}

fn emit_window_focus_change(hwnd: HWND, focused: bool) {
    let event = if focused { "focus" } else { "blur" };
    with_window_proc_state(hwnd, |state| {
        if let Some(bridge) = state.bridge {
            let bridge = unsafe { bridge.as_ref() };
            bridge
                .borrow_mut()
                .window_events
                .push_back(json!({ "type": event }));
            if let Err(error) = emit_window_event(bridge, event, json!({})) {
                eprintln!("opentray-ext-webview failed to emit Windows {event} event: {error}");
            }
        }
    });
}

fn initial_window_position(width: i32, height: i32, tray_bounds: Option<Rect>) -> (i32, i32) {
    let Some(bounds) = tray_bounds else {
        return (CW_USEDEFAULT, CW_USEDEFAULT);
    };
    let tray_width = i32::try_from(bounds.width).unwrap_or(i32::MAX);
    let x = bounds.x + (tray_width - width) / 2;
    let y = bounds.y - height - 8;
    (x.max(0), y.max(0))
}

fn default_webview_html() -> String {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenTray WebView</title>
    <style>
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: transparent;
      }
      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: #102018;
        font: 15px system-ui, sans-serif;
      }
      main {
        max-width: 360px;
        padding: 24px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenTray WebView</h1>
      <p>This window is rendered by the Windows WebView runtime.</p>
    </main>
  </body>
</html>"#
        .to_string()
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_white_block_auto_clear_only_targets_translucent_backgrounds() {
        assert!(!background_needs_white_block_clear(
            &WebviewWindowBackground::Opaque
        ));
        assert!(background_needs_white_block_clear(
            &WebviewWindowBackground::Transparent
        ));
        assert!(background_needs_white_block_clear(
            &WebviewWindowBackground::PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::Active,
            }
        ));
        assert!(background_needs_white_block_clear(
            &WebviewWindowBackground::Semantic {
                token: "blur".to_string(),
                state: WebviewBackgroundEffectState::Active,
            }
        ));
    }

    #[test]
    fn windows_live_resize_white_block_clear_is_throttled() {
        let now = Instant::now();

        assert!(should_run_live_resize_artifact_clear(None, now));
        assert!(!should_run_live_resize_artifact_clear(
            Some(now - Duration::from_millis(30)),
            now
        ));
        assert!(should_run_live_resize_artifact_clear(
            Some(now - Duration::from_millis(200)),
            now
        ));
    }

    #[test]
    fn validate_style_request_accepts_windows_background_family() {
        validate_style_request(&SetStylePayload {
            frameless: None,
            keep_on_top: None,
            opacity: Some(0.64),
            background: Some(WebviewBackgroundInput::Keyword("mica".to_string())),
            platform: Some(SetStylePlatformPayload {
                macos: None,
                windows: Some(SetStyleWindowsPayload {
                    corner_preference: Some(Some("round".to_string())),
                }),
                linux: None,
            }),
        })
        .expect("windows DWM style should be supported");

        validate_style_request(&SetStylePayload {
            frameless: None,
            keep_on_top: None,
            opacity: None,
            background: Some(WebviewBackgroundInput::Keyword("sidebar".to_string())),
            platform: None,
        })
        .expect("generic background material should fall back on Windows");

        validate_style_request(&SetStylePayload {
            frameless: None,
            keep_on_top: None,
            opacity: None,
            background: Some(WebviewBackgroundInput::Object(
                crate::WebviewBackgroundObjectInput {
                    kind: "semantic".to_string(),
                    material: None,
                    token: Some("blur".to_string()),
                    state: Some("active".to_string()),
                },
            )),
            platform: None,
        })
        .expect("generic background state should fall back on Windows");
    }

    #[test]
    fn validate_style_request_rejects_invalid_opacity() {
        let error = validate_style_request(&SetStylePayload {
            frameless: None,
            keep_on_top: None,
            opacity: Some(1.1),
            background: None,
            platform: None,
        })
        .expect_err("opacity outside 0..1 should be rejected");

        assert_eq!(error.to_string(), "opacity must be between 0 and 1");
    }

    #[test]
    fn window_style_from_initial_normalizes_windows_background_aliases() {
        let mut style = crate::WebviewInitialStyle {
            opacity: 0.64,
            background: crate::WebviewWindowBackground::PlatformMaterial {
                material: "micaAlt".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            },
            ..crate::WebviewInitialStyle::default()
        };
        style.platform.windows.corner_preference = Some("small".to_string());

        let state = window_style_from_initial(&style).expect("windows style");
        assert_eq!(state.opacity, 0.64);

        assert_eq!(
            state.background,
            crate::WebviewWindowBackground::PlatformMaterial {
                material: "tabbed".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }
        );
        assert_eq!(
            state.platform.windows,
            WindowsWindowStyleState {
                corner_preference: Some("roundSmall".to_string()),
            }
        );

        style.background = crate::WebviewWindowBackground::PlatformMaterial {
            material: "hudWindow".to_string(),
            state: WebviewBackgroundEffectState::Active,
        };
        let state = window_style_from_initial(&style).expect("windows fallback style");
        assert_eq!(
            state.background,
            crate::WebviewWindowBackground::PlatformMaterial {
                material: "acrylic".to_string(),
                state: WebviewBackgroundEffectState::Active,
            }
        );
    }

    #[test]
    fn windows_background_states_are_exposed_as_dwm_policies() {
        assert_eq!(
            WINDOWS_BACKGROUND_STATES,
            &["followsWindowActiveState", "active", "inactive"]
        );
    }

    #[test]
    fn windows_background_state_policy_tracks_requested_material_state() {
        assert_eq!(
            backdrop_state_policy(&crate::WebviewWindowBackground::PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }),
            WindowsBackdropStatePolicy::FollowWindowActivation
        );
        assert_eq!(
            backdrop_state_policy(&crate::WebviewWindowBackground::PlatformMaterial {
                material: "tabbed".to_string(),
                state: WebviewBackgroundEffectState::Active,
            }),
            WindowsBackdropStatePolicy::ForceActive
        );
        assert_eq!(
            backdrop_state_policy(&crate::WebviewWindowBackground::Semantic {
                token: "blur".to_string(),
                state: WebviewBackgroundEffectState::Inactive,
            }),
            WindowsBackdropStatePolicy::ForceInactive
        );
        assert_eq!(
            backdrop_state_policy(&crate::WebviewWindowBackground::Transparent),
            WindowsBackdropStatePolicy::FollowWindowActivation
        );
    }

    #[test]
    fn nc_activate_policy_rewrites_dwm_activation_state() {
        assert_eq!(
            nc_activate_wparam_for_policy(0, WindowsBackdropStatePolicy::FollowWindowActivation),
            0
        );
        assert_eq!(
            nc_activate_wparam_for_policy(0, WindowsBackdropStatePolicy::ForceActive),
            1
        );
        assert_eq!(
            nc_activate_wparam_for_policy(1, WindowsBackdropStatePolicy::ForceInactive),
            0
        );
    }

    #[test]
    fn semantic_blur_resolves_to_windows_acrylic() {
        let style = WindowStyleState {
            frameless: false,
            keep_on_top: false,
            opacity: 1.0,
            background: crate::WebviewWindowBackground::Semantic {
                token: "blur".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            },
            platform: WindowPlatformStyleState {
                windows: WindowsWindowStyleState {
                    corner_preference: None,
                },
            },
        };

        assert_eq!(
            resolved_windows_backdrop(&style.background),
            Some("acrylic")
        );
        assert!(wants_clear_background(&style));
        assert!(wants_dwm_extended_client_frame(&style));
        assert!(wants_dwm_transparent_host(&style));
    }

    #[test]
    fn default_webview_html_keeps_root_transparent() {
        let html = default_webview_html();
        assert!(html.contains("html,"));
        assert!(html.contains("background: transparent;"));
        assert!(!html.contains("linear-gradient"));
    }

    #[test]
    fn default_windows_show_settings_start_opaque() {
        let settings = default_windows_show_settings();
        assert_eq!(
            settings.window.style.background,
            crate::WebviewWindowBackground::Opaque
        );
        assert_eq!(settings.window.style.opacity, 1.0);
    }

    #[test]
    fn multiple_downloads_policy_defaults_local_allow_and_deny_remote_on_windows() {
        assert_eq!(
            resolve_browser_permission_decision(
                &WebviewBrowserPermissionPolicy::default(),
                WebviewBrowserPermissionFamily::MultipleDownloads,
                &PageSourceState {
                    url: None,
                    host_html: true,
                },
            ),
            WebviewBrowserPermissionDecision::Allow
        );
        assert_eq!(
            resolve_browser_permission_decision(
                &WebviewBrowserPermissionPolicy::default(),
                WebviewBrowserPermissionFamily::MultipleDownloads,
                &PageSourceState {
                    url: Some("https://tools.example/export".to_string()),
                    host_html: false,
                },
            ),
            WebviewBrowserPermissionDecision::Deny
        );
    }

    #[test]
    fn multiple_downloads_policy_respects_exact_remote_allow_rule_on_windows() {
        let policy = WebviewBrowserPermissionPolicy {
            rules: vec![WebviewBrowserPermissionRule {
                family: WebviewBrowserPermissionFamily::MultipleDownloads,
                sources: vec![WebviewNativeApiSource::Origin(
                    "https://tools.example".to_string(),
                )],
                decision: WebviewBrowserPermissionDecision::Allow,
                prompt: false,
            }],
        };

        assert_eq!(
            resolve_browser_permission_decision(
                &policy,
                WebviewBrowserPermissionFamily::MultipleDownloads,
                &PageSourceState {
                    url: Some("https://tools.example/export".to_string()),
                    host_html: false,
                },
            ),
            WebviewBrowserPermissionDecision::Allow
        );
        assert_eq!(
            resolve_browser_permission_decision(
                &policy,
                WebviewBrowserPermissionFamily::MultipleDownloads,
                &PageSourceState {
                    url: Some("https://other.example/export".to_string()),
                    host_html: false,
                },
            ),
            WebviewBrowserPermissionDecision::Deny
        );
    }

    #[test]
    fn no_redirection_bitmap_is_used_for_plain_host_backgrounds() {
        let mut style = window_style_from_initial(&crate::WebviewInitialStyle::default())
            .expect("opaque style");
        assert!(wants_no_redirection_bitmap(&style));

        style.background = crate::WebviewWindowBackground::Transparent;
        assert!(wants_no_redirection_bitmap(&style));

        style.opacity = 0.5;
        assert!(!wants_no_redirection_bitmap(&style));
        assert!(wants_layered_opacity(&style));
        assert_eq!(opacity_alpha_byte(style.opacity), 128);

        style.opacity = 1.0;
        style.background = crate::WebviewWindowBackground::PlatformMaterial {
            material: "mica".to_string(),
            state: WebviewBackgroundEffectState::FollowsWindowActiveState,
        };
        assert!(!wants_no_redirection_bitmap(&style));
    }

    #[test]
    fn host_surface_kind_tracks_background_family_without_runtime_rebuilds() {
        use crate::WebviewWindowBackground::{Opaque, PlatformMaterial, Semantic, Transparent};

        assert_eq!(
            host_surface_kind(&Opaque),
            WindowsHostSurfaceKind::TransparentNoRedirection
        );
        assert_eq!(
            host_surface_kind(&Transparent),
            WindowsHostSurfaceKind::TransparentNoRedirection
        );
        assert_eq!(
            host_surface_kind(&PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }),
            WindowsHostSurfaceKind::RedirectionSurface
        );
        assert_eq!(
            host_surface_kind(&Semantic {
                token: "blur".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }),
            WindowsHostSurfaceKind::RedirectionSurface
        );

        assert!(!needs_host_window_rebuild_for_background_transition(
            &Opaque,
            &PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }
        ));
        assert!(!needs_host_window_rebuild_for_background_transition(
            &Opaque,
            &Transparent
        ));
        assert!(!needs_host_window_rebuild_for_background_transition(
            &Transparent,
            &PlatformMaterial {
                material: "tabbed".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }
        ));
        assert!(!needs_host_window_rebuild_for_background_transition(
            &PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            },
            &Semantic {
                token: "blur".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            }
        ));
    }

    #[test]
    fn windows_material_uses_clear_host_and_webview_backing() {
        let style = window_style_from_initial(&crate::WebviewInitialStyle {
            background: crate::WebviewWindowBackground::PlatformMaterial {
                material: "mica".to_string(),
                state: WebviewBackgroundEffectState::FollowsWindowActiveState,
            },
            ..crate::WebviewInitialStyle::default()
        })
        .expect("material style");

        assert!(wants_clear_background(&style));
        assert!(wants_dwm_extended_client_frame(&style));
        assert!(wants_dwm_transparent_host(&style));
    }

    #[test]
    fn window_style_bits_preserve_window_state_and_child_clipping() {
        let style = window_style_from_initial(&crate::WebviewInitialStyle::default())
            .expect("default style");
        let bits = window_style_bits(&style, WS_VISIBLE | WS_MAXIMIZE);

        assert_eq!(bits & WS_VISIBLE, WS_VISIBLE);
        assert_eq!(bits & WS_MAXIMIZE, WS_MAXIMIZE);
        assert_eq!(bits & WS_CLIPCHILDREN, WS_CLIPCHILDREN);
        assert_eq!(bits & WS_CLIPSIBLINGS, WS_CLIPSIBLINGS);
    }

    #[test]
    fn titlebar_area_rect_reserves_right_caption_control_inset() {
        let rect = titlebar_area_rect_from_metrics(
            800,
            WindowsTitlebarMetrics {
                left_inset: 0.0,
                right_inset: 138.0,
                height: 42.0,
            },
        );

        assert_eq!(
            rect,
            Rect {
                x: 0,
                y: 0,
                width: 662,
                height: 42,
            }
        );
    }

    #[test]
    fn titlebar_area_rect_reserves_left_and_right_titlebar_insets() {
        let rect = titlebar_area_rect_from_metrics(
            800,
            WindowsTitlebarMetrics {
                left_inset: 24.0,
                right_inset: 132.0,
                height: 40.0,
            },
        );

        assert_eq!(
            rect,
            Rect {
                x: 24,
                y: 0,
                width: 644,
                height: 40,
            }
        );
    }

    #[test]
    fn titlebar_area_rect_clamps_oversized_titlebar_insets() {
        let rect = titlebar_area_rect_from_metrics(
            120,
            WindowsTitlebarMetrics {
                left_inset: 16.0,
                right_inset: 180.0,
                height: 0.0,
            },
        );

        assert_eq!(
            rect,
            Rect {
                x: 16,
                y: 0,
                width: 0,
                height: 1,
            }
        );
    }

    #[test]
    fn webview_controller_rect_uses_physical_client_size() {
        assert_eq!(
            webview_controller_rect(1440, 960),
            WebView2Rect {
                left: 0,
                top: 0,
                right: 1440,
                bottom: 960,
            }
        );
    }

    #[test]
    fn public_window_geometry_converts_physical_bounds_to_logical_pixels() {
        let rect = physical_rect_to_public_window_rect_for_dpi(
            144,
            RECT {
                left: 150,
                top: 90,
                right: 780,
                bottom: 540,
            },
        );

        assert_eq!(
            rect,
            Rect {
                x: 100,
                y: 60,
                width: 420,
                height: 300,
            }
        );
    }

    #[test]
    fn public_window_geometry_converts_logical_inputs_to_windows_physical_pixels() {
        assert_eq!(logical_to_physical_i32_for_dpi(144, 420), 630);
        assert_eq!(logical_to_physical_i32_for_dpi(144, 300), 450);
        assert_eq!(physical_to_logical_i32_for_dpi(144, 630), 420);
        assert_eq!(physical_to_logical_i32_for_dpi(144, 450), 300);
    }

    #[test]
    fn window_relative_rect_converts_to_physical_client_rect() {
        let rect = client_rect_from_window_relative_rect(
            RECT {
                left: 175,
                top: 14,
                right: 245,
                bottom: 44,
            },
            (10, 8),
        );

        assert_eq!(rect, Some((165.0, 6.0, 235.0, 36.0)));
    }

    #[test]
    fn opaque_background_restores_opaque_backing() {
        let style = window_style_from_initial(&crate::WebviewInitialStyle::default())
            .expect("default style");
        assert!(!wants_clear_background(&style));
        assert_eq!(resolved_windows_backdrop(&style.background), None);
    }

    #[test]
    fn windows_theme_registry_value_maps_to_dark_mode() {
        assert!(apps_use_light_theme_to_dark_mode(0));
        assert!(!apps_use_light_theme_to_dark_mode(1));
    }
}
