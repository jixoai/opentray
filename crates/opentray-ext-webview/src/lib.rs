#[cfg(target_os = "macos")]
mod macos;

use std::ffi::{c_char, c_void, CString};
use std::fmt;

use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope, Rect,
    EXT_ABI_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED, EXT_OK,
};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

#[cfg(target_os = "macos")]
type WebviewRuntime = macos::MacosWebviewRuntime;

#[cfg(not(target_os = "macos"))]
type WebviewRuntime = UnsupportedWebviewRuntime;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NavigatorWindowSettings {
    pub enabled: bool,
    pub bind_window_globals: bool,
    pub window_controls_overlay: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NavigatorScreenSettings {
    pub enabled: bool,
    pub bind_screen_globals: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NavigatorTraySettings {
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct MetadataSyncSettings {
    pub page_to_native: bool,
    pub native_to_page: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct WebviewMetadataSyncSettings {
    pub title: MetadataSyncSettings,
    pub icon: MetadataSyncSettings,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewInitialStyle {
    pub frameless: bool,
    pub transparent: bool,
    pub keep_on_top: bool,
    pub platform: WebviewInitialPlatformStyle,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewInitialPlatformStyle {
    pub macos: WebviewInitialMacosStyle,
    pub windows: WebviewInitialWindowsStyle,
    pub linux: WebviewInitialLinuxStyle,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewInitialMacosStyle {
    pub material: Option<String>,
    pub material_state: WebviewBackgroundEffectState,
    pub corner_radius: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewInitialWindowsStyle {
    pub backdrop: Option<String>,
    pub corner_preference: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewInitialLinuxStyle;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WebviewBackgroundEffectState {
    #[default]
    FollowsWindowActiveState,
    Active,
    Inactive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WebviewNativeApiSource {
    None,
    Any,
    Local,
    Remote,
    Origin(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WebviewNativeApiPolicy {
    pub default_src: Vec<WebviewNativeApiSource>,
    pub window: Option<Vec<WebviewNativeApiSource>>,
    pub screen: Option<Vec<WebviewNativeApiSource>>,
    pub tray: Option<Vec<WebviewNativeApiSource>>,
    pub window_globals: Option<Vec<WebviewNativeApiSource>>,
    pub screen_globals: Option<Vec<WebviewNativeApiSource>>,
    pub title_sync: Option<Vec<WebviewNativeApiSource>>,
    pub icon_sync: Option<Vec<WebviewNativeApiSource>>,
}

impl Default for WebviewNativeApiPolicy {
    fn default() -> Self {
        Self {
            default_src: vec![WebviewNativeApiSource::Local],
            window: None,
            screen: None,
            tray: None,
            window_globals: None,
            screen_globals: None,
            title_sync: None,
            icon_sync: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum WebviewWindowIcon {
    Rgba {
        data: Vec<u8>,
        width: u32,
        height: u32,
    },
    Encoded {
        data: Vec<u8>,
    },
    File {
        path: String,
    },
    Href {
        href: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewWindowOptions {
    pub title: Option<String>,
    pub icon: Option<WebviewWindowIcon>,
    pub style: WebviewInitialStyle,
    pub sync: WebviewMetadataSyncSettings,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct WebviewShowSettings {
    pub navigator_window: NavigatorWindowSettings,
    pub navigator_screen: NavigatorScreenSettings,
    pub navigator_tray: NavigatorTraySettings,
    pub window: WebviewWindowOptions,
    pub native_api_policy: WebviewNativeApiPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WebviewSessionBootstrapSettings {
    pub navigator_window: NavigatorWindowSettings,
    pub navigator_screen: NavigatorScreenSettings,
    pub navigator_tray: NavigatorTraySettings,
    pub sync: WebviewMetadataSyncSettings,
    pub native_api_policy: WebviewNativeApiPolicy,
}

impl WebviewShowSettings {
    pub(crate) fn session_bootstrap_settings(&self) -> WebviewSessionBootstrapSettings {
        WebviewSessionBootstrapSettings {
            navigator_window: self.navigator_window,
            navigator_screen: self.navigator_screen,
            navigator_tray: self.navigator_tray,
            sync: self.window.sync,
            native_api_policy: self.native_api_policy.clone(),
        }
    }
}

struct WebviewExtension {
    surface_id: String,
    runtime: WebviewRuntime,
}

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
struct UnsupportedWebviewRuntime;

#[cfg(not(target_os = "macos"))]
impl UnsupportedWebviewRuntime {
    fn handle(
        &mut self,
        _tray_id: &str,
        _command: WebviewCommand,
    ) -> Result<Value, WebviewRuntimeError> {
        Err(WebviewRuntimeError::Unsupported(
            "webview runtime is not implemented for this platform".into(),
        ))
    }

    fn lease_closed(&mut self, _lease_id: &str) {}
}

#[derive(Debug, Clone, PartialEq)]
enum WebviewCommand {
    Show {
        html: Option<String>,
        url: Option<String>,
        width: f64,
        height: f64,
        tray_bounds: Option<Rect>,
        fallback_rect: Option<Rect>,
        show_settings: WebviewShowSettings,
    },
    Hide,
    Destroy,
    SetContent {
        html: Option<String>,
        url: Option<String>,
    },
    Navigate {
        url: String,
    },
    Evaluate {
        js: String,
    },
    PostMessage {
        payload: Value,
    },
}

#[derive(Debug)]
enum WebviewRuntimeError {
    Rejected(String),
    Unsupported(String),
    Internal(String),
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowCommandData {
    html: Option<String>,
    url: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    #[serde(rename = "fallbackRect")]
    fallback_rect: Option<Rect>,
    native_window_api: Option<bool>,
    bind_window_globals: Option<bool>,
    native_screen_api: Option<bool>,
    bind_screen_globals: Option<bool>,
    native_tray_api: Option<bool>,
    window_controls_overlay: Option<bool>,
    title: Option<String>,
    icon: Option<WebviewWindowIcon>,
    style: Option<ShowWindowStyleData>,
    title_sync: Option<TitleSyncInput>,
    icon_sync: Option<IconSyncInput>,
    native_api_policy: Option<NativeApiPolicyInput>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetContentCommandData {
    html: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowWindowStyleData {
    frameless: Option<bool>,
    transparent: Option<bool>,
    keep_on_top: Option<bool>,
    platform: Option<ShowWindowPlatformStyleData>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowWindowPlatformStyleData {
    macos: Option<ShowWindowMacosStyleData>,
    windows: Option<ShowWindowWindowsStyleData>,
    #[allow(dead_code)]
    linux: Option<ShowWindowLinuxStyleData>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowWindowMacosStyleData {
    material: Option<String>,
    material_state: Option<String>,
    corner_radius: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowWindowWindowsStyleData {
    backdrop: Option<String>,
    corner_preference: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowWindowLinuxStyleData {}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeApiPolicyInput {
    default_src: Option<Vec<String>>,
    window: Option<Vec<String>>,
    screen: Option<Vec<String>>,
    tray: Option<Vec<String>>,
    window_globals: Option<Vec<String>>,
    screen_globals: Option<Vec<String>>,
    title_sync: Option<Vec<String>>,
    icon_sync: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum TitleSyncInput {
    Enabled(bool),
    Directions(TitleSyncDirectionsInput),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TitleSyncDirectionsInput {
    document_to_window: Option<bool>,
    window_to_document: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum IconSyncInput {
    Enabled(bool),
    Directions(IconSyncDirectionsInput),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IconSyncDirectionsInput {
    favicon_to_window: Option<bool>,
    window_to_favicon: Option<bool>,
}

impl WebviewRuntimeError {
    fn code(&self) -> ExtResultCode {
        match self {
            Self::Rejected(_) => EXT_ERR_REJECTED,
            Self::Unsupported(_) => EXT_ERR_UNSUPPORTED,
            Self::Internal(_) => EXT_ERR_INTERNAL,
        }
    }
}

impl fmt::Display for WebviewRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(message) | Self::Unsupported(message) | Self::Internal(message) => {
                write!(f, "{message}")
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn opentray_ext_abi_version() -> u32 {
    EXT_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_init(
    context: *const ExtContext,
    out_instance: *mut *mut c_void,
) -> ExtResultCode {
    if context.is_null() || out_instance.is_null() {
        return EXT_ERR_REJECTED;
    }

    let surface_id = match unsafe { read_ext_string((*context).surface_id) } {
        Some(value) => value,
        None => return EXT_ERR_REJECTED,
    };
    let instance = Box::new(WebviewExtension {
        surface_id,
        runtime: WebviewRuntime::default(),
    });
    unsafe {
        *out_instance = Box::into_raw(instance).cast::<c_void>();
    }
    EXT_OK
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_command(
    instance: *mut c_void,
    context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    if instance.is_null() || context.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(bytes) = (unsafe { ext_bytes_as_slice(envelope_json) }) else {
        return EXT_ERR_REJECTED;
    };
    let Ok(envelope) = serde_json::from_slice::<ExtensionEnvelope>(bytes) else {
        return EXT_ERR_REJECTED;
    };

    let extension = unsafe { &mut *instance.cast::<WebviewExtension>() };
    if envelope.scope.surface_id != extension.surface_id {
        return EXT_ERR_REJECTED;
    }
    let Some(tray_id) = envelope.scope.tray_id.as_deref() else {
        return EXT_ERR_REJECTED;
    };
    let Ok(command) = parse_webview_command(&envelope.data) else {
        return EXT_ERR_REJECTED;
    };
    let tray_bounds = unsafe { read_tray_bounds(context) };
    let command = inject_tray_bounds(command, tray_bounds);
    let event = match extension.runtime.handle(tray_id, command) {
        Ok(event) => event,
        Err(error) => {
            eprintln!("opentray-ext-webview command failed: {error}");
            return error.code();
        }
    };

    let events = vec![ExtensionEnvelope {
        scope: envelope.scope,
        data: event,
    }];
    write_owned_events(out_events_json, &events)
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_lease_closed(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    lease_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    if instance.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(lease_id) = (unsafe { read_ext_string(lease_id) }) else {
        return EXT_ERR_REJECTED;
    };
    let extension = unsafe { &mut *instance.cast::<WebviewExtension>() };
    extension.runtime.lease_closed(&lease_id);
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<WebviewExtension>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(bytes: ExtOwnedBytes) {
    if !bytes.ptr.is_null() {
        drop(unsafe { CString::from_raw(bytes.ptr) });
    }
}

fn parse_webview_command(data: &Value) -> Result<WebviewCommand, WebviewRuntimeError> {
    let command_type = data
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| WebviewRuntimeError::Rejected("webview command requires type".into()))?;

    match command_type {
        "show" => {
            let parsed: ShowCommandData =
                serde_json::from_value(data.clone()).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!("invalid webview show command: {error}"))
                })?;
            let (html, url) = parse_optional_content_pair(
                parsed.html,
                parsed.url,
                "show",
                ContentPairRequirement::Optional,
            )?;
            let bind_window_globals = parsed.bind_window_globals.unwrap_or(false);
            let bind_screen_globals = parsed.bind_screen_globals.unwrap_or(false);
            let style = parsed.style.as_ref();
            let macos_style = style
                .and_then(|style| style.platform.as_ref())
                .and_then(|platform| platform.macos.as_ref());
            let windows_style = style
                .and_then(|style| style.platform.as_ref())
                .and_then(|platform| platform.windows.as_ref());
            Ok(WebviewCommand::Show {
                html,
                url,
                width: parsed.width.unwrap_or(420.0),
                height: parsed.height.unwrap_or(260.0),
                tray_bounds: None,
                fallback_rect: parsed.fallback_rect,
                show_settings: WebviewShowSettings {
                    navigator_window: NavigatorWindowSettings {
                        enabled: parsed.native_window_api.unwrap_or(false)
                            || bind_window_globals
                            || parsed.window_controls_overlay.unwrap_or(false),
                        bind_window_globals,
                        window_controls_overlay: parsed.window_controls_overlay.unwrap_or(false),
                    },
                    navigator_screen: NavigatorScreenSettings {
                        enabled: parsed.native_screen_api.unwrap_or(false) || bind_screen_globals,
                        bind_screen_globals,
                    },
                    navigator_tray: NavigatorTraySettings {
                        enabled: parsed.native_tray_api.unwrap_or(false),
                    },
                    window: WebviewWindowOptions {
                        title: parsed.title,
                        icon: parsed.icon,
                        style: WebviewInitialStyle {
                            frameless: style.and_then(|style| style.frameless).unwrap_or(false),
                            transparent: style.and_then(|style| style.transparent).unwrap_or(false),
                            keep_on_top: style.and_then(|style| style.keep_on_top).unwrap_or(false),
                            platform: WebviewInitialPlatformStyle {
                                macos: WebviewInitialMacosStyle {
                                    material: macos_style
                                        .and_then(|style| style.material.clone())
                                        .filter(|material| !material.is_empty()),
                                    material_state: macos_style
                                        .and_then(|style| style.material_state.as_deref())
                                        .map(parse_background_effect_state)
                                        .transpose()?
                                        .unwrap_or_default(),
                                    corner_radius: macos_style
                                        .and_then(|style| style.corner_radius)
                                        .map(normalize_corner_radius)
                                        .transpose()?,
                                },
                                windows: WebviewInitialWindowsStyle {
                                    backdrop: windows_style
                                        .and_then(|style| style.backdrop.clone())
                                        .filter(|backdrop| !backdrop.is_empty()),
                                    corner_preference: windows_style
                                        .and_then(|style| style.corner_preference.clone())
                                        .filter(|preference| !preference.is_empty()),
                                },
                                linux: WebviewInitialLinuxStyle,
                            },
                        },
                        sync: WebviewMetadataSyncSettings {
                            title: parse_title_sync(parsed.title_sync),
                            icon: parse_icon_sync(parsed.icon_sync),
                        },
                    },
                    native_api_policy: parse_native_api_policy(parsed.native_api_policy)?,
                },
            })
        }
        "hide" => Ok(WebviewCommand::Hide),
        "destroy" => Ok(WebviewCommand::Destroy),
        "setContent" => {
            let parsed: SetContentCommandData =
                serde_json::from_value(data.clone()).map_err(|error| {
                    WebviewRuntimeError::Rejected(format!(
                        "invalid webview setContent command: {error}"
                    ))
                })?;
            let (html, url) = parse_optional_content_pair(
                parsed.html,
                parsed.url,
                "setContent",
                ContentPairRequirement::ExactlyOne,
            )?;
            Ok(WebviewCommand::SetContent { html, url })
        }
        "navigate" => Ok(WebviewCommand::Navigate {
            url: required_string(data, "url")?,
        }),
        "evaluate" => Ok(WebviewCommand::Evaluate {
            js: required_string(data, "js")?,
        }),
        "postMessage" => Ok(WebviewCommand::PostMessage {
            payload: data.get("payload").cloned().unwrap_or(Value::Null),
        }),
        other => Err(WebviewRuntimeError::Rejected(format!(
            "unsupported webview command: {other}"
        ))),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContentPairRequirement {
    Optional,
    ExactlyOne,
}

fn parse_optional_content_pair(
    html: Option<String>,
    url: Option<String>,
    command_name: &str,
    requirement: ContentPairRequirement,
) -> Result<(Option<String>, Option<String>), WebviewRuntimeError> {
    if html.is_some() && url.is_some() {
        return Err(WebviewRuntimeError::Rejected(format!(
            "webview {command_name} command accepts html or url, but not both"
        )));
    }
    if matches!(requirement, ContentPairRequirement::ExactlyOne) && html.is_none() && url.is_none()
    {
        return Err(WebviewRuntimeError::Rejected(format!(
            "webview {command_name} command requires html or url"
        )));
    }
    Ok((html, url))
}

fn required_string(data: &Value, key: &str) -> Result<String, WebviewRuntimeError> {
    data.get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| WebviewRuntimeError::Rejected(format!("webview command requires {key}")))
}

fn normalize_corner_radius(radius: f64) -> Result<f64, WebviewRuntimeError> {
    if !radius.is_finite() {
        return Err(WebviewRuntimeError::Rejected(
            "cornerRadius must be a finite number".into(),
        ));
    }
    Ok(radius.clamp(0.0, 128.0))
}

fn parse_background_effect_state(
    state: &str,
) -> Result<WebviewBackgroundEffectState, WebviewRuntimeError> {
    match state {
        "followsWindowActiveState" => Ok(WebviewBackgroundEffectState::FollowsWindowActiveState),
        "active" => Ok(WebviewBackgroundEffectState::Active),
        "inactive" => Ok(WebviewBackgroundEffectState::Inactive),
        other => Err(WebviewRuntimeError::Unsupported(format!(
            "background effect state {other} is not supported on macOS"
        ))),
    }
}

fn parse_title_sync(input: Option<TitleSyncInput>) -> MetadataSyncSettings {
    match input {
        Some(TitleSyncInput::Enabled(enabled)) => MetadataSyncSettings {
            page_to_native: enabled,
            native_to_page: enabled,
        },
        Some(TitleSyncInput::Directions(directions)) => MetadataSyncSettings {
            page_to_native: directions.document_to_window.unwrap_or(false),
            native_to_page: directions.window_to_document.unwrap_or(false),
        },
        None => MetadataSyncSettings::default(),
    }
}

fn parse_icon_sync(input: Option<IconSyncInput>) -> MetadataSyncSettings {
    match input {
        Some(IconSyncInput::Enabled(enabled)) => MetadataSyncSettings {
            page_to_native: enabled,
            native_to_page: enabled,
        },
        Some(IconSyncInput::Directions(directions)) => MetadataSyncSettings {
            page_to_native: directions.favicon_to_window.unwrap_or(false),
            native_to_page: directions.window_to_favicon.unwrap_or(false),
        },
        None => MetadataSyncSettings::default(),
    }
}

fn parse_native_api_policy(
    input: Option<NativeApiPolicyInput>,
) -> Result<WebviewNativeApiPolicy, WebviewRuntimeError> {
    let Some(input) = input else {
        return Ok(WebviewNativeApiPolicy::default());
    };
    Ok(WebviewNativeApiPolicy {
        default_src: parse_native_api_sources(input.default_src)?
            .unwrap_or_else(|| WebviewNativeApiPolicy::default().default_src),
        window: parse_native_api_sources(input.window)?,
        screen: parse_native_api_sources(input.screen)?,
        tray: parse_native_api_sources(input.tray)?,
        window_globals: parse_native_api_sources(input.window_globals)?,
        screen_globals: parse_native_api_sources(input.screen_globals)?,
        title_sync: parse_native_api_sources(input.title_sync)?,
        icon_sync: parse_native_api_sources(input.icon_sync)?,
    })
}

unsafe fn read_tray_bounds(context: *const ExtHostContext) -> Option<Rect> {
    if context.is_null() {
        return None;
    }
    let mut rect = Rect {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    };
    let context = unsafe { &*context };
    match (context.get_rect)(context.host_data, &mut rect) {
        EXT_OK => Some(rect),
        _ => None,
    }
}

fn inject_tray_bounds(command: WebviewCommand, tray_bounds: Option<Rect>) -> WebviewCommand {
    match command {
        WebviewCommand::Show {
            html,
            url,
            width,
            height,
            tray_bounds: _,
            fallback_rect,
            show_settings,
        } => WebviewCommand::Show {
            html,
            url,
            width,
            height,
            tray_bounds,
            fallback_rect,
            show_settings,
        },
        other => other,
    }
}

fn parse_native_api_sources(
    input: Option<Vec<String>>,
) -> Result<Option<Vec<WebviewNativeApiSource>>, WebviewRuntimeError> {
    let Some(input) = input else {
        return Ok(None);
    };
    let mut rules = Vec::with_capacity(input.len());
    for value in input {
        rules.push(parse_native_api_source(&value)?);
    }
    Ok(Some(rules))
}

fn parse_native_api_source(value: &str) -> Result<WebviewNativeApiSource, WebviewRuntimeError> {
    match value {
        "'none'" => Ok(WebviewNativeApiSource::None),
        "*" => Ok(WebviewNativeApiSource::Any),
        "'local'" => Ok(WebviewNativeApiSource::Local),
        "'remote'" => Ok(WebviewNativeApiSource::Remote),
        _ => {
            let url = Url::parse(value).map_err(|error| {
                WebviewRuntimeError::Rejected(format!(
                    "invalid nativeApiPolicy source {value:?}: {error}"
                ))
            })?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err(WebviewRuntimeError::Rejected(format!(
                    "nativeApiPolicy source {value:?} must use http or https origin syntax"
                )));
            }
            if !url.username().is_empty() || url.password().is_some() {
                return Err(WebviewRuntimeError::Rejected(format!(
                    "nativeApiPolicy source {value:?} must not include credentials"
                )));
            }
            if url.query().is_some() || url.fragment().is_some() {
                return Err(WebviewRuntimeError::Rejected(format!(
                    "nativeApiPolicy source {value:?} must not include query or fragment"
                )));
            }
            if url.path() != "/" {
                return Err(WebviewRuntimeError::Rejected(format!(
                    "nativeApiPolicy source {value:?} must be an origin, not a full path"
                )));
            }
            let origin = url.origin().ascii_serialization();
            if origin == "null" {
                return Err(WebviewRuntimeError::Rejected(format!(
                    "nativeApiPolicy source {value:?} is not a stable origin"
                )));
            }
            Ok(WebviewNativeApiSource::Origin(origin))
        }
    }
}

unsafe fn read_ext_string(bytes: ExtBytes) -> Option<String> {
    let slice = unsafe { ext_bytes_as_slice(bytes) }?;
    String::from_utf8(slice.to_vec()).ok()
}

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

fn write_owned_json(out: *mut ExtOwnedBytes, json: &str) -> ExtResultCode {
    if out.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Ok(value) = CString::new(json) else {
        return EXT_ERR_REJECTED;
    };
    let len = value.as_bytes().len();
    unsafe {
        *out = ExtOwnedBytes {
            ptr: value.into_raw().cast::<c_char>(),
            len,
        };
    }
    EXT_OK
}

fn write_owned_events(out: *mut ExtOwnedBytes, events: &[ExtensionEnvelope]) -> ExtResultCode {
    let Ok(json) = serde_json::to_string(events) else {
        return EXT_ERR_REJECTED;
    };
    write_owned_json(out, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::CStr, ptr};

    #[test]
    fn abi_version_matches_public_contract() {
        assert_eq!(opentray_ext_abi_version(), EXT_ABI_VERSION);
    }

    #[test]
    fn parse_show_command_keeps_extension_owned_protocol() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "html": "<main />",
            "width": 360,
            "height": 220,
            "fallbackRect": { "x": 1, "y": 2, "width": 3, "height": 4 }
        }))
        .expect("show command");

        assert_eq!(
            command,
            WebviewCommand::Show {
                html: Some("<main />".to_string()),
                url: None,
                width: 360.0,
                height: 220.0,
                tray_bounds: None,
                fallback_rect: Some(Rect {
                    x: 1,
                    y: 2,
                    width: 3,
                    height: 4,
                }),
                show_settings: WebviewShowSettings::default(),
            }
        );
    }

    #[test]
    fn parse_show_command_reads_window_metadata_and_injection_flags() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "width": 360,
            "height": 220,
            "nativeWindowApi": true,
            "bindWindowGlobals": true,
            "windowControlsOverlay": true,
            "nativeScreenApi": true,
            "bindScreenGlobals": true,
            "nativeTrayApi": true,
            "title": "OpenTray Status",
            "icon": {
              "type": "href",
              "href": "data:image/png;base64,abc"
            },
            "style": {
              "frameless": true,
              "transparent": true,
              "keepOnTop": true,
              "platform": {
                "macos": {
                  "material": "hudWindow",
                  "materialState": "active",
                  "cornerRadius": 18
                }
              }
            },
            "titleSync": {
              "documentToWindow": true,
              "windowToDocument": true
            },
            "iconSync": true,
            "nativeApiPolicy": {
              "defaultSrc": ["'local'"],
              "window": ["https://example.com"],
              "screen": ["'local'"],
              "tray": ["'local'"],
              "windowGlobals": ["'none'"],
              "titleSync": ["https://example.com"],
              "iconSync": ["'local'"]
            }
        }))
        .expect("show command");

        assert_eq!(
            command,
            WebviewCommand::Show {
                html: None,
                url: None,
                width: 360.0,
                height: 220.0,
                tray_bounds: None,
                fallback_rect: None,
                show_settings: WebviewShowSettings {
                    navigator_window: NavigatorWindowSettings {
                        enabled: true,
                        bind_window_globals: true,
                        window_controls_overlay: true,
                    },
                    navigator_screen: NavigatorScreenSettings {
                        enabled: true,
                        bind_screen_globals: true,
                    },
                    navigator_tray: NavigatorTraySettings { enabled: true },
                    window: WebviewWindowOptions {
                        title: Some("OpenTray Status".to_string()),
                        icon: Some(WebviewWindowIcon::Href {
                            href: "data:image/png;base64,abc".to_string(),
                        }),
                        style: WebviewInitialStyle {
                            frameless: true,
                            transparent: true,
                            keep_on_top: true,
                            platform: WebviewInitialPlatformStyle {
                                macos: WebviewInitialMacosStyle {
                                    material: Some("hudWindow".to_string()),
                                    material_state: WebviewBackgroundEffectState::Active,
                                    corner_radius: Some(18.0),
                                },
                                windows: WebviewInitialWindowsStyle::default(),
                                linux: WebviewInitialLinuxStyle,
                            },
                        },
                        sync: WebviewMetadataSyncSettings {
                            title: MetadataSyncSettings {
                                page_to_native: true,
                                native_to_page: true,
                            },
                            icon: MetadataSyncSettings {
                                page_to_native: true,
                                native_to_page: true,
                            },
                        },
                    },
                    native_api_policy: WebviewNativeApiPolicy {
                        default_src: vec![WebviewNativeApiSource::Local],
                        window: Some(vec![WebviewNativeApiSource::Origin(
                            "https://example.com".to_string(),
                        )]),
                        screen: Some(vec![WebviewNativeApiSource::Local]),
                        tray: Some(vec![WebviewNativeApiSource::Local]),
                        window_globals: Some(vec![WebviewNativeApiSource::None]),
                        screen_globals: None,
                        title_sync: Some(vec![WebviewNativeApiSource::Origin(
                            "https://example.com".to_string(),
                        )]),
                        icon_sync: Some(vec![WebviewNativeApiSource::Local]),
                    },
                },
            }
        );
    }

    #[test]
    fn parse_show_command_defaults_native_api_policy_to_local_only() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "url": "https://example.com",
            "nativeWindowApi": true
        }))
        .expect("show command");

        let WebviewCommand::Show { show_settings, .. } = command else {
            panic!("expected show command");
        };

        assert_eq!(
            show_settings.native_api_policy,
            WebviewNativeApiPolicy::default()
        );
    }

    #[test]
    fn parse_show_command_preserves_platform_specific_style_families() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "show",
            "style": {
              "frameless": true,
              "platform": {
                "macos": {
                  "material": "hudWindow"
                },
                "windows": {
                  "backdrop": "mica",
                  "cornerPreference": "round"
                },
                "linux": {}
              }
            }
        }))
        .expect("show command");

        let WebviewCommand::Show { show_settings, .. } = command else {
            panic!("expected show command");
        };

        assert_eq!(
            show_settings.window.style.platform.macos.material,
            Some("hudWindow".to_string())
        );
        assert_eq!(
            show_settings.window.style.platform.windows,
            WebviewInitialWindowsStyle {
                backdrop: Some("mica".to_string()),
                corner_preference: Some("round".to_string()),
            }
        );
        assert_eq!(
            show_settings.window.style.platform.linux,
            WebviewInitialLinuxStyle
        );
    }

    #[test]
    fn parse_set_content_command_requires_explicit_content() {
        let command = parse_webview_command(&serde_json::json!({
            "type": "setContent",
            "html": "<main>updated</main>"
        }))
        .expect("setContent command");

        assert_eq!(
            command,
            WebviewCommand::SetContent {
                html: Some("<main>updated</main>".to_string()),
                url: None,
            }
        );

        let error = parse_webview_command(&serde_json::json!({
            "type": "setContent"
        }))
        .expect_err("setContent should require html or url");

        assert_eq!(
            error.to_string(),
            "webview setContent command requires html or url"
        );
    }

    #[test]
    fn parse_show_command_rejects_ambiguous_content_sources() {
        let error = parse_webview_command(&serde_json::json!({
            "type": "show",
            "html": "<main />",
            "url": "https://example.com"
        }))
        .expect_err("show should reject both html and url");

        assert_eq!(
            error.to_string(),
            "webview show command accepts html or url, but not both"
        );
    }

    #[test]
    fn parse_show_command_rejects_invalid_native_api_policy_source() {
        let error = parse_webview_command(&serde_json::json!({
            "type": "show",
            "nativeWindowApi": true,
            "nativeApiPolicy": {
              "window": ["https://example.com/path"]
            }
        }))
        .expect_err("path sources should be rejected");

        assert_eq!(
            error.to_string(),
            r#"nativeApiPolicy source "https://example.com/path" must be an origin, not a full path"#
        );
    }

    #[test]
    fn lease_closed_returns_empty_event_array() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
            runtime: WebviewRuntime::default(),
        }))
        .cast::<c_void>();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_lease_closed(
                instance,
                &unsupported_host_context(),
                ExtBytes {
                    ptr: c"lease-1".as_ptr(),
                    len: "lease-1".len(),
                },
                &mut output,
            )
        };

        assert_eq!(result, EXT_OK);
        let value = unsafe { CStr::from_ptr(output.ptr) };
        assert_eq!(value.to_str().unwrap(), "[]");
        unsafe {
            opentray_ext_free_string(output);
            opentray_ext_deinit(instance);
        }
    }

    #[test]
    fn hide_command_returns_platform_specific_result() {
        let instance = Box::into_raw(Box::new(WebviewExtension {
            surface_id: "surface-1".to_string(),
            runtime: WebviewRuntime::default(),
        }))
        .cast::<c_void>();
        let envelope = CString::new(
            serde_json::to_string(&ExtensionEnvelope {
                scope: opentray_spec::ExtensionScope {
                    surface_id: "surface-1".to_string(),
                    tray_id: Some("tray-1".to_string()),
                    ext: "webview".to_string(),
                },
                data: serde_json::json!({ "type": "hide" }),
            })
            .unwrap(),
        )
        .unwrap();
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_command(
                instance,
                &unsupported_host_context(),
                borrowed_bytes(&envelope),
                &mut output,
            )
        };

        #[cfg(target_os = "macos")]
        {
            assert_eq!(result, EXT_OK);
            let json = unsafe { CStr::from_ptr(output.ptr) }.to_str().unwrap();
            assert!(json.contains("\"type\":\"hidden\""));
            unsafe { opentray_ext_free_string(output) };
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(result, EXT_ERR_UNSUPPORTED);
        }

        unsafe { opentray_ext_deinit(instance) };
    }

    extern "C" fn unsupported_send_event(
        _host_data: *mut c_void,
        _event_json: ExtBytes,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_get_rect(_host_data: *mut c_void, _out: *mut Rect) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_invoke_host(
        _host_data: *mut c_void,
        _capability: ExtBytes,
        _request_json: ExtBytes,
        _out_response_json: *mut ExtOwnedBytes,
    ) -> ExtResultCode {
        EXT_ERR_REJECTED
    }

    extern "C" fn unsupported_free_host_string(_host_data: *mut c_void, _bytes: ExtOwnedBytes) {}

    fn unsupported_host_context() -> ExtHostContext {
        ExtHostContext {
            host_data: ptr::null_mut(),
            send_event: unsupported_send_event,
            get_rect: unsupported_get_rect,
            invoke_host: unsupported_invoke_host,
            free_host_string: unsupported_free_host_string,
        }
    }

    fn borrowed_bytes(value: &CString) -> ExtBytes {
        ExtBytes {
            ptr: value.as_ptr(),
            len: value.as_bytes().len(),
        }
    }
}
