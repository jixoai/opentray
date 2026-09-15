//! Multi-webview orchestration protocol for `ext-webview`.
//!
//! These DTOs are the platform-neutral wire contracts for one window session
//! hosting sibling webview native views (`openspec/changes/add-webview-orchestration`,
//! decisions D2/D8/D18/D19 and the webview-extension / webview-layout spec
//! deltas). They ride the existing extension command/event envelopes; every
//! frame carries the owner tuple `(appId, trayId, sessionId)` so
//! session-scoped ids never collide across sessions. The TypeScript mirror
//! lives in `packages/spec/src/webview.ts`; both sides are pinned to the same
//! wire shapes by the shared fixtures in `fixtures/frames/`.

use serde::{de, Deserialize, Serialize, Serializer};
use serde_json::Value;

use crate::model::{AppId, SessionId, TrayId};

pub type WindowId = String;
pub type WebviewId = String;
pub type ViewId = String;

/// Identity of the app/tray/session trio that owns one window session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewOwnerTuple {
    pub app_id: AppId,
    pub tray_id: TrayId,
    pub session_id: SessionId,
}

/// Per-child bridge policy, frozen as a boolean field set (D2). Every field
/// defaults to `false`; omitting the policy entirely means no bridge. The
/// policy is bootstrap-immutable for the webview's lifetime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebviewBridgePolicy {
    pub webview_id: bool,
    pub message_channels: bool,
    pub navigator_window: bool,
    pub navigator_screen: bool,
    pub native_api: bool,
}

impl Default for WebviewBridgePolicy {
    /// All-false policy: the arbitrary-content webview is bridgeless by default.
    fn default() -> Self {
        Self {
            webview_id: false,
            message_channels: false,
            navigator_window: false,
            navigator_screen: false,
            native_api: false,
        }
    }
}

impl WebviewBridgePolicy {
    /// True when any bridge capability is admitted: the child hosts trusted
    /// shell UI (bootstrap script installed, bridge surfaces reachable). The
    /// context-menu default and other trusted-UI facts key off this verdict.
    pub fn has_bridge_surface(&self) -> bool {
        self.webview_id
            || self.message_channels
            || self.navigator_window
            || self.navigator_screen
            || self.native_api
    }
}

/// Typed error-code registry for the whole orchestration surface (D20).
/// `queue_overflow` is shared across two namespaces: it is both a channel
/// close reason and a `channel.post` error code; every other reason and
/// error code stays in its own namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestrationErrorCode {
    UnknownView,
    InvalidLayoutMeasure,
    MultiwebviewUnsupportedStyle,
    TraySessionActive,
    BridgeRequired,
    SessionScope,
    NotOpen,
    PayloadTooLarge,
    QueueOverflow,
    InvalidPayload,
}

pub const ORCHESTRATION_ERROR_CODES: &[&str] = &[
    "unknown_view",
    "invalid_layout_measure",
    "multiwebview_unsupported_style",
    "tray_session_active",
    "bridge_required",
    "session_scope",
    "not_open",
    "payload_too_large",
    "queue_overflow",
    "invalid_payload",
];

impl OrchestrationErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UnknownView => "unknown_view",
            Self::InvalidLayoutMeasure => "invalid_layout_measure",
            Self::MultiwebviewUnsupportedStyle => "multiwebview_unsupported_style",
            Self::TraySessionActive => "tray_session_active",
            Self::BridgeRequired => "bridge_required",
            Self::SessionScope => "session_scope",
            Self::NotOpen => "not_open",
            Self::PayloadTooLarge => "payload_too_large",
            Self::QueueOverflow => "queue_overflow",
            Self::InvalidPayload => "invalid_payload",
        }
    }
}

/// Typed error body `{ code, message }` used by wire error envelopes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewErrorBody {
    pub code: OrchestrationErrorCode,
    pub message: String,
}

/// Typed error envelope `{ error: { code, message } }` used by wire frames
/// and protocol-level validation results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebviewErrorEnvelope {
    pub error: WebviewErrorBody,
}

impl WebviewErrorEnvelope {
    pub fn new(code: OrchestrationErrorCode, message: impl Into<String>) -> Self {
        Self {
            error: WebviewErrorBody {
                code,
                message: message.into(),
            },
        }
    }
}

/// Per-webview browser-behavior options (create-webview). Defaults make a
/// content webview behave like an ordinary browser tab; every field is an
/// explicit opt-out or override for the application that needs otherwise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebviewBrowserOptions {
    /// Full User-Agent override. When set it wins over `browserlikeUserAgent`
    /// (which only shapes the engine default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    /// Append the standard browser tokens to the engine-default UA (macOS:
    /// the Safari `Version/… Safari/…` suffix; Windows: the WebView2 default
    /// UA is already a full Edge UA so this is a no-op). Default `true` —
    /// UA-sniffing sites (portal homepages) loop or misbranch on the bare
    /// engine UA. `false` restores the bare engine identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browserlike_user_agent: Option<bool>,
    /// Ephemeral (non-persistent) storage profile. Default `false` —
    /// cookies/localStorage persist like a normal browser profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incognito: Option<bool>,
    /// Allow media autoplay without a user gesture. Default `false` (the
    /// engine's conservative default; browsers similarly gate audible
    /// autoplay).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoplay: Option<bool>,
    /// Engine-native context menu (right-click Reload/Inspect etc.).
    /// Default depends on the child's bridge policy: disabled for a bridged
    /// child (trusted shell UI must not leak engine commands), enabled for a
    /// bridgeless child (ordinary content behaves like a browser tab). An
    /// explicit value wins either way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_menu: Option<bool>,
}

impl WebviewBrowserOptions {
    pub fn resolved_user_agent(&self) -> Option<&str> {
        self.user_agent.as_deref()
    }
    pub fn browserlike_user_agent(&self) -> bool {
        self.browserlike_user_agent.unwrap_or(true)
    }
    pub fn incognito(&self) -> bool {
        self.incognito.unwrap_or(false)
    }
    pub fn autoplay(&self) -> bool {
        self.autoplay.unwrap_or(false)
    }
    /// Resolved context-menu admission. `bridged` is the opening child's
    /// [`WebviewBridgePolicy::has_bridge_surface`] verdict: a bridged child
    /// is trusted shell UI and disables the engine menu by default.
    pub fn context_menu(&self, bridged: bool) -> bool {
        self.context_menu.unwrap_or(!bridged)
    }
}

/// Host→broker orchestration commands (ext-command data payloads). Tag names
/// follow the core protocol's kebab-case convention and never collide with
/// the single-webview command surface (`navigate`, `focus`, ...).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WebviewOrchestrationCommand {
    CreateWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        html: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bridge: Option<WebviewBridgePolicy>,
        /// Browser-behavior options (UA shaping, incognito, autoplay). Absent
        /// means every default: browserlike UA on, persistent profile,
        /// gesture-gated autoplay.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        browser: Option<WebviewBrowserOptions>,
        /// Opt in to native favicon observation (`faviconChange` events plus
        /// the `getFavicon` query). Absent means off.
        #[serde(default = "default_false", skip_serializing_if = "is_false")]
        favicon: bool,
        /// Declarative navigation rules evaluated synchronously on the
        /// platform UI thread at every navigation decision point. Absent
        /// means no rules.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        navigation_rules: Option<Vec<WebviewNavigationRule>>,
    },
    DestroyWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    ListWebviews {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
    },
    NavigateWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        url: String,
    },
    BackWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    ForwardWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    FocusWebview {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    SetWebviewLayout {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        layout: WebviewLayoutDocument,
    },
    UpdateWebviewLayout {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        view_id: ViewId,
        patch: WebviewLayoutSizing,
    },
    GetWebviewUrl {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    GetWebviewTitle {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    SubscribeWebviewEvents {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        kinds: Vec<WebviewEventKind>,
    },
    UnsubscribeWebviewEvents {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        kinds: Vec<WebviewEventKind>,
    },
    GetWebviewFavicon {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
    },
    SetWebviewNavigationRules {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        rules: Vec<WebviewNavigationRule>,
    },
}

impl WebviewOrchestrationCommand {
    /// Wire tag of this command (the `type` discriminant).
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::CreateWebview { .. } => "create-webview",
            Self::DestroyWebview { .. } => "destroy-webview",
            Self::ListWebviews { .. } => "list-webviews",
            Self::NavigateWebview { .. } => "navigate-webview",
            Self::BackWebview { .. } => "back-webview",
            Self::ForwardWebview { .. } => "forward-webview",
            Self::FocusWebview { .. } => "focus-webview",
            Self::SetWebviewLayout { .. } => "set-webview-layout",
            Self::UpdateWebviewLayout { .. } => "update-webview-layout",
            Self::GetWebviewUrl { .. } => "get-webview-url",
            Self::GetWebviewTitle { .. } => "get-webview-title",
            Self::SubscribeWebviewEvents { .. } => "subscribe-webview-events",
            Self::UnsubscribeWebviewEvents { .. } => "unsubscribe-webview-events",
            Self::GetWebviewFavicon { .. } => "get-webview-favicon",
            Self::SetWebviewNavigationRules { .. } => "set-webview-navigation-rules",
        }
    }
}

/// One entry of a `list-webviews` result: id plus its frozen bridge policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewListEntry {
    pub webview_id: WebviewId,
    pub bridge: WebviewBridgePolicy,
}

/// Broker→host result frames for the orchestration commands. The url/title
/// results carry the `(value, seq)` query pair (D19 race rule).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WebviewOrchestrationResult {
    WebviewAck {
        owner: WebviewOwnerTuple,
        command: String,
    },
    ListWebviewsResult {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webviews: Vec<WebviewListEntry>,
    },
    GetWebviewUrlResult {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        url: String,
        seq: u64,
    },
    GetWebviewTitleResult {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        title: String,
        seq: u64,
    },
    GetWebviewFaviconResult {
        owner: WebviewOwnerTuple,
        window_id: WindowId,
        webview_id: WebviewId,
        /// `None` until the first settled favicon is observed (and for
        /// webviews created without the `favicon` option).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        href: Option<String>,
        seq: u64,
    },
}

/// Unified per-view event family (D19; `loadState` joined with D24).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WebviewEventKind {
    UrlChange,
    TitleChange,
    Focused,
    GeometryChange,
    LoadState,
    NavigationAction,
    FaviconChange,
}

pub const WEBVIEW_EVENT_KINDS: &[&str] = &[
    "urlChange",
    "titleChange",
    "focused",
    "geometryChange",
    "loadState",
    "navigationAction",
    "faviconChange",
];

/// Navigation lifecycle phase of a `loadState` event (D24). The phase
/// vocabulary is cross-platform frozen; `progress` is best-effort and may
/// be omitted entirely by a platform that cannot report it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WebviewLoadPhase {
    Started,
    Finished,
    Failed,
}

/// Navigation action attribution (add-navigation-favicon-surface). The
/// platform projection is documented truth: Windows maps `IsRedirected` to
/// Redirect exactly and cannot separate link from form (user-initiated
/// projects as Link); macOS maps `WKNavigationAction.navigationType` and
/// does not distinguish redirect from Other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WebviewNavigationType {
    Link,
    Form,
    BackForward,
    Reload,
    Redirect,
    Other,
}

/// Stable numeric `loadState failed` code for a navigation cancelled by a
/// declarative navigation rule. Outside platform ranges by construction
/// (WebView2 `WebErrorStatus` and WebKit domain codes are small integers).
pub const WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE: i32 = 4500001;

/// One declarative navigation rule; v1 actions: block only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewNavigationRule {
    /// Glob over the full URL; `*` matches any run of characters including
    /// separators. Everything else is literal.
    pub pattern: String,
    pub action: WebviewNavigationRuleAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebviewNavigationRuleAction {
    #[serde(rename = "block")]
    Block,
}

/// Shared URL-glob semantics, mirroring the TypeScript facade contract in
/// `@opentray/spec` exactly: matched against the full absolute URL; every
/// character is literal except `*`, which matches any character run.
/// Classic star-backtracking matcher — no regex dependency, linear-ish,
/// no pathological backtracking beyond consecutive-star runs.
pub fn matches_webview_navigation_pattern(pattern: &str, url: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let url: Vec<char> = url.chars().collect();
    let (mut pi, mut ui) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ui < url.len() {
        if pi < pattern.len() && pattern[pi] == '*' {
            star = pi;
            mark = ui;
            pi += 1;
        } else if pi < pattern.len() && pattern[pi] == url[ui] {
            pi += 1;
            ui += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ui = mark;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

/// View-local logical-pixel rectangle; same fields as the page-bridge
/// overlay payload (`rect | null`, `null` meaning no overlay intersection).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewGeometryRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Field-frozen event payloads.
///
/// Variant order is load-bearing for the `untagged` deserialization:
/// `LoadState` must come first because its payload carries `url` too —
/// an untagged `UrlChange` would otherwise swallow `{"phase", "url"}`
/// frames (unknown fields are ignored), while `LoadState`'s required
/// `phase` field rejects plain `{"url"}` frames so they still fall
/// through to `UrlChange`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WebviewEventPayload {
    #[serde(rename_all = "camelCase")]
    NavigationAction {
        url: String,
        navigation_type: WebviewNavigationType,
        /// Omitted when the platform cannot attribute a gesture (macOS).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        is_user_initiated: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    FaviconChange {
        href: String,
    },
    #[serde(rename_all = "camelCase")]
    LoadState {
        phase: WebviewLoadPhase,
        url: String,
        /// Numeric platform error code (WebView2 `WebErrorStatus` /
        /// WKWebView underlying error domain code) on `failed`; absent
        /// otherwise.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_code: Option<i32>,
        /// Load progress in `[0, 1]` when the platform can report it;
        /// omitted when it cannot (consumers render an indeterminate
        /// affordance from the phase alone).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        progress: Option<f64>,
    },
    UrlChange {
        url: String,
    },
    TitleChange {
        title: String,
    },
    Focused {
        focused: bool,
    },
    GeometryChange {
        rect: Option<WebviewGeometryRect>,
    },
}

/// Wire tag of the unified event frame; serializes as `"webview-event"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebviewEventTag {
    #[serde(rename = "webview-event")]
    WebviewEvent,
}

/// One per-view push event frame. Payload variant and `kind` are validated
/// against each other by [`WebviewEventFrame::is_coherent`]; consumers must
/// call it (or construct via the `new_*` helpers) before trusting a decoded
/// frame from the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewEventFrame {
    #[serde(rename = "type")]
    pub frame_type: WebviewEventTag,
    pub owner: WebviewOwnerTuple,
    pub window_id: WindowId,
    pub webview_id: WebviewId,
    pub kind: WebviewEventKind,
    pub seq: u64,
    pub payload: WebviewEventPayload,
}

impl WebviewEventFrame {
    pub fn new_url_change(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        url: impl Into<String>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::UrlChange,
            seq,
            payload: WebviewEventPayload::UrlChange { url: url.into() },
        }
    }

    pub fn new_title_change(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        title: impl Into<String>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::TitleChange,
            seq,
            payload: WebviewEventPayload::TitleChange {
                title: title.into(),
            },
        }
    }

    pub fn new_focused(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        focused: bool,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::Focused,
            seq,
            payload: WebviewEventPayload::Focused { focused },
        }
    }

    pub fn new_geometry_change(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        rect: Option<WebviewGeometryRect>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::GeometryChange,
            seq,
            payload: WebviewEventPayload::GeometryChange { rect },
        }
    }

    /// `loadState` frame (D24): navigation lifecycle phase plus the target
    /// URL; `error_code` rides failures, `progress` ∈ [0,1] rides phases the
    /// platform can measure and is omitted otherwise.
    pub fn new_load_state(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        phase: WebviewLoadPhase,
        url: impl Into<String>,
        error_code: Option<i32>,
        progress: Option<f64>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::LoadState,
            seq,
            payload: WebviewEventPayload::LoadState {
                phase,
                url: url.into(),
                error_code,
                // Windows has no native navigation progress surface (the
                // phase drives the consumer's indeterminate affordance);
                // macOS fills estimatedProgress observations here.
                progress,
            },
        }
    }

    /// `navigationAction` frame: every native navigation decision point,
    /// before the load surfaces as `loadState` phases.
    pub fn new_navigation_action(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        url: impl Into<String>,
        navigation_type: WebviewNavigationType,
        is_user_initiated: Option<bool>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::NavigationAction,
            seq,
            payload: WebviewEventPayload::NavigationAction {
                url: url.into(),
                navigation_type: navigation_type,
                is_user_initiated: is_user_initiated,
            },
        }
    }

    /// `faviconChange` frame: the settled, resolved favicon href.
    pub fn new_favicon_change(
        owner: WebviewOwnerTuple,
        window_id: impl Into<String>,
        webview_id: impl Into<String>,
        seq: u64,
        href: impl Into<String>,
    ) -> Self {
        Self {
            frame_type: WebviewEventTag::WebviewEvent,
            owner,
            window_id: window_id.into(),
            webview_id: webview_id.into(),
            kind: WebviewEventKind::FaviconChange,
            seq,
            payload: WebviewEventPayload::FaviconChange { href: href.into() },
        }
    }

    /// True when the payload variant matches the declared `kind`.
    pub fn is_coherent(&self) -> bool {
        match (self.kind, &self.payload) {
            (
                WebviewEventKind::NavigationAction,
                WebviewEventPayload::NavigationAction { url, .. },
            ) => !url.is_empty(),
            (WebviewEventKind::FaviconChange, WebviewEventPayload::FaviconChange { href }) => {
                !href.is_empty()
            }
            _ => matches!(
                (self.kind, &self.payload),
                (
                    WebviewEventKind::UrlChange,
                    WebviewEventPayload::UrlChange { .. }
                ) | (
                    WebviewEventKind::TitleChange,
                    WebviewEventPayload::TitleChange { .. }
                ) | (
                    WebviewEventKind::Focused,
                    WebviewEventPayload::Focused { .. }
                ) | (
                    WebviewEventKind::GeometryChange,
                    WebviewEventPayload::GeometryChange { .. }
                ) | (
                    WebviewEventKind::LoadState,
                    WebviewEventPayload::LoadState { .. }
                )
            ),
        }
    }
}

/// Declarative layered flex layout protocol (D3/D4/D8). One JSON document:
/// an ordered array of layers (bottom-to-top; array order is the z-order),
/// each layer owning one independent flex tree. There is no zIndex field
/// anywhere; v1 has no padding/align/justify/percent/basis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLayoutDocument {
    pub layers: Vec<WebviewLayoutLayer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLayoutLayer {
    pub root: WebviewLayoutNode,
    /// Layer visibility switch (implementation-reserved detail; default true).
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub visible: bool,
}

fn default_false() -> bool {
    false
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn default_true() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

/// Node sizing fields, logical pixels, client-area coordinates. Also the
/// incremental patch type for `layout.update(viewId, patch)`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebviewLayoutSizing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flex: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_height: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WebviewLayoutDirection {
    Row,
    Column,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLayoutContainerNode {
    pub dir: WebviewLayoutDirection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<f64>,
    pub children: Vec<WebviewLayoutNode>,
    #[serde(flatten)]
    pub sizing: WebviewLayoutSizing,
}

/// Literal `kind: "webview"` tag; omission means the same (default kind).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebviewViewKindTag {
    #[serde(rename = "webview")]
    Webview,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLayoutViewNode {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<WebviewViewKindTag>,
    pub id: ViewId,
    #[serde(flatten)]
    pub sizing: WebviewLayoutSizing,
}

/// Literal `kind: "box"` tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebviewBoxKindTag {
    #[serde(rename = "box")]
    Box,
}

/// Box view paint fields (D5): solid background, border ring, corner radius.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebviewBoxStyle {
    /// Solid color, `#RRGGBB` or `#RRGGBBAA`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<WebviewBoxBorder>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<f64>,
}

impl Default for WebviewBoxStyle {
    fn default() -> Self {
        Self {
            background: None,
            border: None,
            corner_radius: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewBoxBorder {
    pub width: f64,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLayoutBoxNode {
    pub kind: WebviewBoxKindTag,
    pub id: ViewId,
    #[serde(flatten)]
    pub style: WebviewBoxStyle,
    #[serde(flatten)]
    pub sizing: WebviewLayoutSizing,
}

/// One layout tree node: a flex container, a webview view reference
/// (default kind), or a box view (`kind: "box"`).
///
/// Serialization delegates to the variant struct. Deserialization
/// dispatches structurally: `dir` → container; `kind: "box"` → box;
/// otherwise (including `kind: "webview"` or no kind) → webview view.
#[derive(Debug, Clone, PartialEq)]
pub enum WebviewLayoutNode {
    Container(WebviewLayoutContainerNode),
    WebviewView(WebviewLayoutViewNode),
    BoxView(WebviewLayoutBoxNode),
}

impl Serialize for WebviewLayoutNode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Container(node) => node.serialize(serializer),
            Self::WebviewView(node) => node.serialize(serializer),
            Self::BoxView(node) => node.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for WebviewLayoutNode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("layout node must be an object"))?;
        if object.contains_key("dir") {
            return Ok(Self::Container(
                serde_json::from_value(value).map_err(de::Error::custom)?,
            ));
        }
        match object.get("kind").and_then(Value::as_str) {
            Some("box") => Ok(Self::BoxView(
                serde_json::from_value(value).map_err(de::Error::custom)?,
            )),
            Some("webview") | None => Ok(Self::WebviewView(
                serde_json::from_value(value).map_err(de::Error::custom)?,
            )),
            Some(other) => Err(de::Error::custom(format!(
                "unknown layout node kind: {other}"
            ))),
        }
    }
}

/// Protocol-level layout validation, performed before any solving (D21):
/// every measure must be finite, non-negative, with `min ≤ max` per axis,
/// and every referenced view id must be registered. NaN, ±Infinity,
/// negative values, and inverted min/max reject with `invalid_layout_measure`;
/// unregistered ids reject with `unknown_view`.
pub fn validate_webview_layout(
    document: &WebviewLayoutDocument,
    has_view: &dyn Fn(&str) -> bool,
) -> Result<(), WebviewErrorEnvelope> {
    for layer in &document.layers {
        validate_layout_node(&layer.root, "root", has_view)?;
    }
    Ok(())
}

fn validate_layout_node(
    node: &WebviewLayoutNode,
    label: &str,
    has_view: &dyn Fn(&str) -> bool,
) -> Result<(), WebviewErrorEnvelope> {
    match node {
        WebviewLayoutNode::BoxView(box_node) => {
            check_view_registered(&box_node.id, has_view)?;
            check_sizing(&box_node.sizing, label)?;
            if let Some(border) = &box_node.style.border {
                check_measure(border.width, &format!("{label}.border.width"))?;
            }
            if let Some(corner_radius) = box_node.style.corner_radius {
                check_measure(corner_radius, &format!("{label}.cornerRadius"))?;
            }
            Ok(())
        }
        WebviewLayoutNode::WebviewView(view_node) => {
            check_view_registered(&view_node.id, has_view)?;
            check_sizing(&view_node.sizing, label)
        }
        WebviewLayoutNode::Container(container) => {
            if let Some(gap) = container.gap {
                check_measure(gap, &format!("{label}.gap"))?;
            }
            check_sizing(&container.sizing, label)?;
            for (index, child) in container.children.iter().enumerate() {
                validate_layout_node(child, &format!("{label}.children[{index}]"), has_view)?;
            }
            Ok(())
        }
    }
}

fn check_view_registered(
    view_id: &str,
    has_view: &dyn Fn(&str) -> bool,
) -> Result<(), WebviewErrorEnvelope> {
    if has_view(view_id) {
        Ok(())
    } else {
        Err(WebviewErrorEnvelope::new(
            OrchestrationErrorCode::UnknownView,
            format!("layout references unregistered view id {view_id}"),
        ))
    }
}

fn check_measure(value: f64, label: &str) -> Result<(), WebviewErrorEnvelope> {
    if !value.is_finite() || value < 0.0 {
        return Err(WebviewErrorEnvelope::new(
            OrchestrationErrorCode::InvalidLayoutMeasure,
            format!("{label} must be a finite non-negative number (got {value})"),
        ));
    }
    Ok(())
}

fn check_sizing(sizing: &WebviewLayoutSizing, label: &str) -> Result<(), WebviewErrorEnvelope> {
    let fields: [(&str, Option<f64>); 7] = [
        ("width", sizing.width),
        ("height", sizing.height),
        ("flex", sizing.flex),
        ("minWidth", sizing.min_width),
        ("minHeight", sizing.min_height),
        ("maxWidth", sizing.max_width),
        ("maxHeight", sizing.max_height),
    ];
    for (field, value) in fields {
        if let Some(measure) = value {
            check_measure(measure, &format!("{label}.{field}"))?;
        }
    }
    if let (Some(min), Some(max)) = (sizing.min_width, sizing.max_width) {
        if min > max {
            return Err(WebviewErrorEnvelope::new(
                OrchestrationErrorCode::InvalidLayoutMeasure,
                format!("{label}: minWidth must not exceed maxWidth"),
            ));
        }
    }
    if let (Some(min), Some(max)) = (sizing.min_height, sizing.max_height) {
        if min > max {
            return Err(WebviewErrorEnvelope::new(
                OrchestrationErrorCode::InvalidLayoutMeasure,
                format!("{label}: minHeight must not exceed maxHeight"),
            ));
        }
    }
    Ok(())
}

/// Test-only shared helpers for the frame fixture suites.
#[cfg(test)]
pub(crate) mod test_support {
    use serde_json::Value;

    /// `serde_json::Value` equality distinguishes f64 `44.0` from u64 `44`;
    /// the wire contract is numeric equality, so integral floats within the
    /// exact-integer range are normalized on both sides before comparing.
    pub(crate) fn normalize_numbers(value: &Value) -> Value {
        const EXACT_LIMIT: f64 = 9_007_199_254_740_992.0; // 2^53
        match value {
            Value::Number(number) => match number.as_f64() {
                Some(float)
                    if float.fract() == 0.0 && float.abs() <= EXACT_LIMIT && float.is_finite() =>
                {
                    if float >= 0.0 {
                        Value::from(float as u64)
                    } else {
                        Value::from(float as i64)
                    }
                }
                _ => value.clone(),
            },
            Value::Array(items) => Value::Array(items.iter().map(normalize_numbers).collect()),
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, item)| (key.clone(), normalize_numbers(item)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use serde_json::json;

    use super::*;

    fn owner() -> WebviewOwnerTuple {
        WebviewOwnerTuple {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
        }
    }

    fn fixtures(file: &str) -> Vec<(String, Value)> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/frames")
            .join(file);
        let raw = fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {file}: {error}"));
        let entries: Vec<Value> =
            serde_json::from_str(&raw).unwrap_or_else(|error| panic!("parse {file}: {error}"));
        entries
            .into_iter()
            .map(|entry| {
                let name = entry["name"].as_str().expect("fixture name").to_string();
                (name, entry["frame"].clone())
            })
            .collect()
    }

    fn build_command(name: &str) -> Option<WebviewOrchestrationCommand> {
        let owner = owner();
        let window = "win-1".to_string();
        let command = match name {
            "create-webview with toolbar bridge policy" => {
                WebviewOrchestrationCommand::CreateWebview {
                    owner,
                    window_id: window,
                    webview_id: "toolbar".to_string(),
                    url: Some("http://127.0.0.1:5173/toolbar.html".to_string()),
                    html: None,
                    bridge: Some(WebviewBridgePolicy {
                        webview_id: true,
                        message_channels: true,
                        ..WebviewBridgePolicy::default()
                    }),
                    browser: None,
                    favicon: false,
                    navigation_rules: None,
                }
            }
            "create-webview without bridge policy" => WebviewOrchestrationCommand::CreateWebview {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
                url: Some("https://news.ycombinator.com".to_string()),
                html: None,
                bridge: None,
                browser: None,
                favicon: false,
                navigation_rules: None,
            },
            "create-webview with html content" => WebviewOrchestrationCommand::CreateWebview {
                owner,
                window_id: window,
                webview_id: "banner".to_string(),
                url: None,
                html: Some("<p>offline</p>".to_string()),
                bridge: None,
                browser: None,
                favicon: false,
                navigation_rules: None,
            },
            "destroy-webview" => WebviewOrchestrationCommand::DestroyWebview {
                owner,
                window_id: window,
                webview_id: "banner".to_string(),
            },
            "list-webviews" => WebviewOrchestrationCommand::ListWebviews {
                owner,
                window_id: window,
            },
            "create-webview with favicon and navigation rules" => {
                WebviewOrchestrationCommand::CreateWebview {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    url: Some("https://example.org".to_string()),
                    html: None,
                    bridge: None,
                    browser: None,
                    favicon: true,
                    navigation_rules: Some(vec![WebviewNavigationRule {
                        pattern: "*://*.tracker.example/*".to_string(),
                        action: WebviewNavigationRuleAction::Block,
                    }]),
                }
            }
            "get-webview-favicon" => WebviewOrchestrationCommand::GetWebviewFavicon {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
            },
            "set-webview-navigation-rules" => {
                WebviewOrchestrationCommand::SetWebviewNavigationRules {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    rules: vec![WebviewNavigationRule {
                        pattern: "*://*.tracker.example/*".to_string(),
                        action: WebviewNavigationRuleAction::Block,
                    }],
                }
            }
            "navigate-webview" => WebviewOrchestrationCommand::NavigateWebview {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
                url: "https://example.org".to_string(),
            },
            "back-webview" => WebviewOrchestrationCommand::BackWebview {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
            },
            "forward-webview" => WebviewOrchestrationCommand::ForwardWebview {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
            },
            "focus-webview" => WebviewOrchestrationCommand::FocusWebview {
                owner,
                window_id: window,
                webview_id: "toolbar".to_string(),
            },
            "get-webview-url" => WebviewOrchestrationCommand::GetWebviewUrl {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
            },
            "get-webview-title" => WebviewOrchestrationCommand::GetWebviewTitle {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
            },
            "set-webview-layout toolbar column" => WebviewOrchestrationCommand::SetWebviewLayout {
                owner,
                window_id: window,
                layout: WebviewLayoutDocument {
                    layers: vec![WebviewLayoutLayer {
                        root: WebviewLayoutNode::Container(WebviewLayoutContainerNode {
                            dir: WebviewLayoutDirection::Column,
                            gap: Some(1.0),
                            children: vec![
                                WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                                    kind: None,
                                    id: "toolbar".to_string(),
                                    sizing: WebviewLayoutSizing {
                                        height: Some(44.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                                WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                                    kind: None,
                                    id: "content".to_string(),
                                    sizing: WebviewLayoutSizing {
                                        flex: Some(1.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                            ],
                            sizing: WebviewLayoutSizing::default(),
                        }),
                        visible: true,
                    }],
                },
            },
            "set-webview-layout layered box ring" => {
                WebviewOrchestrationCommand::SetWebviewLayout {
                    owner,
                    window_id: window,
                    layout: WebviewLayoutDocument {
                        layers: vec![
                            WebviewLayoutLayer {
                                root: WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                                    kind: None,
                                    id: "content".to_string(),
                                    sizing: WebviewLayoutSizing {
                                        flex: Some(1.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                                visible: true,
                            },
                            WebviewLayoutLayer {
                                root: WebviewLayoutNode::BoxView(WebviewLayoutBoxNode {
                                    kind: WebviewBoxKindTag::Box,
                                    id: "ring".to_string(),
                                    style: WebviewBoxStyle {
                                        background: Some("#00000000".to_string()),
                                        border: Some(WebviewBoxBorder {
                                            width: 2.0,
                                            color: "#333333AA".to_string(),
                                        }),
                                        corner_radius: Some(8.0),
                                    },
                                    sizing: WebviewLayoutSizing {
                                        width: Some(800.0),
                                        height: Some(600.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                                visible: true,
                            },
                        ],
                    },
                }
            }
            "set-webview-layout explicit webview kind and hidden layer" => {
                WebviewOrchestrationCommand::SetWebviewLayout {
                    owner,
                    window_id: window,
                    layout: WebviewLayoutDocument {
                        layers: vec![
                            WebviewLayoutLayer {
                                root: WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                                    kind: Some(WebviewViewKindTag::Webview),
                                    id: "content".to_string(),
                                    sizing: WebviewLayoutSizing {
                                        flex: Some(1.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                                visible: true,
                            },
                            WebviewLayoutLayer {
                                root: WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                                    kind: None,
                                    id: "banner".to_string(),
                                    sizing: WebviewLayoutSizing {
                                        height: Some(24.0),
                                        ..WebviewLayoutSizing::default()
                                    },
                                }),
                                visible: false,
                            },
                        ],
                    },
                }
            }
            "update-webview-layout sizing patch" => {
                WebviewOrchestrationCommand::UpdateWebviewLayout {
                    owner,
                    window_id: window,
                    view_id: "toolbar".to_string(),
                    patch: WebviewLayoutSizing {
                        height: Some(48.0),
                        min_height: Some(32.0),
                        max_height: Some(64.0),
                        ..WebviewLayoutSizing::default()
                    },
                }
            }
            "subscribe-webview-events" => WebviewOrchestrationCommand::SubscribeWebviewEvents {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
                kinds: vec![
                    WebviewEventKind::UrlChange,
                    WebviewEventKind::TitleChange,
                    WebviewEventKind::Focused,
                    WebviewEventKind::GeometryChange,
                ],
            },
            "unsubscribe-webview-events" => WebviewOrchestrationCommand::UnsubscribeWebviewEvents {
                owner,
                window_id: window,
                webview_id: "content".to_string(),
                kinds: vec![WebviewEventKind::UrlChange, WebviewEventKind::TitleChange],
            },
            _ => return None,
        };
        Some(command)
    }

    fn build_result(name: &str) -> Option<WebviewOrchestrationResult> {
        let owner = owner();
        let window = "win-1".to_string();
        let result = match name {
            "list-webviews-result" => WebviewOrchestrationResult::ListWebviewsResult {
                owner,
                window_id: window,
                webviews: vec![
                    WebviewListEntry {
                        webview_id: "toolbar".to_string(),
                        bridge: WebviewBridgePolicy {
                            webview_id: true,
                            message_channels: true,
                            ..WebviewBridgePolicy::default()
                        },
                    },
                    WebviewListEntry {
                        webview_id: "content".to_string(),
                        bridge: WebviewBridgePolicy::default(),
                    },
                ],
            },
            "get-webview-url-result returns value and seq" => {
                WebviewOrchestrationResult::GetWebviewUrlResult {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    url: "https://example.org/articles/1".to_string(),
                    seq: 41,
                }
            }
            "get-webview-title-result returns value and seq" => {
                WebviewOrchestrationResult::GetWebviewTitleResult {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    title: "Example Article".to_string(),
                    seq: 12,
                }
            }
            "get-webview-favicon-result returns value and seq" => {
                WebviewOrchestrationResult::GetWebviewFaviconResult {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    href: Some("https://example.org/favicon.ico".to_string()),
                    seq: 71,
                }
            }
            "get-webview-favicon-result unset href" => {
                WebviewOrchestrationResult::GetWebviewFaviconResult {
                    owner,
                    window_id: window,
                    webview_id: "content".to_string(),
                    href: None,
                    seq: 0,
                }
            }
            "webview-ack echoes the command" => WebviewOrchestrationResult::WebviewAck {
                owner,
                command: "navigate-webview".to_string(),
            },
            _ => return None,
        };
        Some(result)
    }

    /// Shared wire-shape suite: `packages/spec/src/webview.test.ts` builds
    /// the same frames from the same fixture names, so the TypeScript and
    /// Rust DTOs are pinned to identical field-level wire shapes.
    #[test]
    fn command_and_result_frames_match_shared_fixtures() {
        let entries = fixtures("orchestration-commands.json");
        assert!(entries.len() >= 20, "expected at least 20 command fixtures");
        for (name, frame) in entries {
            let value = build_command(&name)
                .map(|command| serde_json::to_value(&command).expect("serialize command"))
                .or_else(|| {
                    build_result(&name)
                        .map(|result| serde_json::to_value(&result).expect("serialize result"))
                })
                .unwrap_or_else(|| panic!("missing Rust builder for fixture {name}"));
            assert_eq!(
                test_support::normalize_numbers(&value),
                test_support::normalize_numbers(&frame),
                "wire shape mismatch for fixture {name}"
            );
            // Round-trip: the fixture JSON decodes back and re-serializes to
            // the identical shape (command or result).
            let decoded = serde_json::from_value::<WebviewOrchestrationCommand>(frame.clone())
                .map(|command| serde_json::to_value(&command).expect("serialize command"))
                .or_else(|_| {
                    serde_json::from_value::<WebviewOrchestrationResult>(frame.clone())
                        .map(|result| serde_json::to_value(&result).expect("serialize result"))
                })
                .unwrap_or_else(|error| {
                    panic!("fixture {name} decodes as command or result: {error}")
                });
            assert_eq!(
                test_support::normalize_numbers(&decoded),
                test_support::normalize_numbers(&frame),
                "round-trip mismatch for fixture {name}"
            );
        }
    }

    #[test]
    fn event_frames_match_shared_fixtures_and_stay_coherent() {
        let entries = fixtures("webview-event-frames.json");
        assert!(entries.len() >= 11, "expected at least 11 event fixtures");
        let owner = owner();
        for (name, frame) in entries {
            let built = match name.as_str() {
                "urlChange" => WebviewEventFrame::new_url_change(
                    owner.clone(),
                    "win-1",
                    "content",
                    41,
                    "https://example.org/articles/1",
                ),
                "titleChange" => WebviewEventFrame::new_title_change(
                    owner.clone(),
                    "win-1",
                    "content",
                    12,
                    "Example Article",
                ),
                "focused gained edge" => {
                    WebviewEventFrame::new_focused(owner.clone(), "win-1", "toolbar", 3, true)
                }
                "focused lost edge" => {
                    WebviewEventFrame::new_focused(owner.clone(), "win-1", "content", 7, false)
                }
                "geometryChange with view-local rect" => WebviewEventFrame::new_geometry_change(
                    owner.clone(),
                    "win-1",
                    "bar",
                    2,
                    Some(WebviewGeometryRect {
                        x: 0.0,
                        y: 0.0,
                        width: 800.0,
                        height: 44.0,
                    }),
                ),
                "geometryChange with fractional logical pixels" => {
                    WebviewEventFrame::new_geometry_change(
                        owner.clone(),
                        "win-1",
                        "bar",
                        3,
                        Some(WebviewGeometryRect {
                            x: 12.5,
                            y: 0.5,
                            width: 300.25,
                            height: 44.0,
                        }),
                    )
                }
                "geometryChange null rect means no overlay intersection" => {
                    WebviewEventFrame::new_geometry_change(
                        owner.clone(),
                        "win-1",
                        "content",
                        9,
                        None,
                    )
                }
                "loadState started with progress" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    5,
                    WebviewLoadPhase::Started,
                    "https://example.org/articles/1",
                    None,
                    Some(0.1),
                ),
                "loadState started without progress" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    6,
                    WebviewLoadPhase::Started,
                    "https://example.org",
                    None,
                    None,
                ),
                "loadState finished carries full progress" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    7,
                    WebviewLoadPhase::Finished,
                    "https://example.org/articles/1",
                    None,
                    Some(1.0),
                ),
                "loadState started" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    21,
                    WebviewLoadPhase::Started,
                    "https://example.org/articles/2",
                    None,
                    None,
                ),
                "loadState finished" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    22,
                    WebviewLoadPhase::Finished,
                    "https://example.org/articles/2",
                    None,
                    None,
                ),
                "loadState failed with errorCode" => WebviewEventFrame::new_load_state(
                    owner.clone(),
                    "win-1",
                    "content",
                    8,
                    WebviewLoadPhase::Failed,
                    "https://unreachable.example.org",
                    Some(-1003),
                    None,
                ),
                "navigationAction link user initiated" => WebviewEventFrame::new_navigation_action(
                    owner.clone(),
                    "win-1",
                    "content",
                    61,
                    "https://example.org/articles/2",
                    WebviewNavigationType::Link,
                    Some(true),
                ),
                "navigationAction redirect without user flag" => {
                    WebviewEventFrame::new_navigation_action(
                        owner.clone(),
                        "win-1",
                        "content",
                        62,
                        "https://example.org/login",
                        WebviewNavigationType::Redirect,
                        None,
                    )
                }
                "faviconChange settled href" => WebviewEventFrame::new_favicon_change(
                    owner.clone(),
                    "win-1",
                    "content",
                    71,
                    "https://example.org/favicon.ico",
                ),
                other => panic!("missing Rust builder for fixture {other}"),
            };
            assert!(built.is_coherent(), "fixture {name} must be coherent");
            let value = serde_json::to_value(&built).expect("serialize event frame");
            assert_eq!(
                test_support::normalize_numbers(&value),
                test_support::normalize_numbers(&frame),
                "wire shape mismatch for fixture {name}"
            );
            // Decoding the fixture JSON yields an equal frame.
            let decoded: WebviewEventFrame = serde_json::from_value(frame)
                .unwrap_or_else(|error| panic!("decode {name}: {error}"));
            assert!(decoded.is_coherent());
            assert_eq!(decoded, built);
        }
    }

    #[test]
    fn navigation_pattern_glob_matches_shared_semantics() {
        // Same table as the TypeScript suite in `packages/spec/src/webview.test.ts`:
        // `*` crosses separators, everything else is literal, query is sensitive.
        let cases: &[(&str, &str, bool)] = &[
            (
                "*://*.tracker.example/*",
                "https://cdn.tracker.example/pixel.gif?id=9",
                true,
            ),
            (
                "*://*.tracker.example/*",
                "https://tracker.example.evil.net/pixel.gif",
                false,
            ),
            (
                "https://example.org/exact/path",
                "https://example.org/exact/path",
                true,
            ),
            (
                "https://example.org/exact/path",
                "https://example.org/exact/path?utm=1",
                false,
            ),
            ("*", "https://any.example/deep/path?q=1", true),
            ("https://example.org/*", "https://example.org/", true),
            ("https://example.org/*", "https://example.org", false),
            // The leading dot in `*.tracker.example` is literal: the bare
            // host needs its own rule (or `*tracker.example`).
            (
                "*://*.tracker.example/*",
                "https://tracker.example/pixel.gif",
                false,
            ),
        ];
        for (pattern, url, expected) in cases {
            assert_eq!(
                matches_webview_navigation_pattern(pattern, url),
                *expected,
                "pattern {pattern:?} vs url {url:?}"
            );
        }
    }

    #[test]
    fn navigation_rules_serialize_and_the_blocked_code_is_frozen() {
        let rule: WebviewNavigationRule =
            serde_json::from_str(r#"{"pattern":"*://*.tracker.example/*","action":"block"}"#)
                .expect("decode rule");
        assert_eq!(rule.action, WebviewNavigationRuleAction::Block);
        let value = serde_json::to_value(&rule).expect("encode rule");
        assert_eq!(
            value,
            serde_json::json!({"pattern": "*://*.tracker.example/*", "action": "block"})
        );
        // Unknown actions reject instead of coercing.
        assert!(serde_json::from_str::<WebviewNavigationRule>(
            r#"{"pattern":"x","action":"allow"}"#
        )
        .is_err());
        assert_eq!(WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE, 4500001);
    }

    #[test]
    fn navigation_event_frames_decode_and_reject_empty_fields() {
        let owner = owner();
        let frame = WebviewEventFrame::new_navigation_action(
            owner.clone(),
            "win-1",
            "content",
            61,
            "https://example.org/a",
            WebviewNavigationType::Link,
            Some(true),
        );
        assert!(frame.is_coherent());
        let value = serde_json::to_value(&frame).expect("serialize");
        assert_eq!(value["payload"]["navigationType"], "link");
        assert_eq!(value["payload"]["isUserInitiated"], true);
        // `redirect` frame without the optional flag omits it on the wire.
        let redirect = WebviewEventFrame::new_navigation_action(
            owner.clone(),
            "win-1",
            "content",
            62,
            "https://example.org/login",
            WebviewNavigationType::Redirect,
            None,
        );
        let value = serde_json::to_value(&redirect).expect("serialize");
        assert!(value["payload"].get("isUserInitiated").is_none());
        // Empty url / empty href are incoherent, mirroring the TS guard.
        let empty_url = WebviewEventFrame::new_navigation_action(
            owner,
            "win-1",
            "content",
            63,
            "",
            WebviewNavigationType::Other,
            None,
        );
        assert!(!empty_url.is_coherent());
        let empty_href = WebviewEventFrame::new_favicon_change(
            WebviewOwnerTuple {
                app_id: "app-1".to_string(),
                tray_id: "tray-1".to_string(),
                session_id: "session-1".to_string(),
            },
            "win-1",
            "content",
            72,
            "",
        );
        assert!(!empty_href.is_coherent());
    }

    #[test]
    fn event_kind_payload_mismatch_is_detectable() {
        let raw = json!({
            "type": "webview-event",
            "owner": { "appId": "app-1", "trayId": "tray-1", "sessionId": "session-1" },
            "windowId": "win-1",
            "webviewId": "content",
            "kind": "urlChange",
            "seq": 1,
            "payload": { "title": "wrong payload for kind" }
        });
        let frame: WebviewEventFrame =
            serde_json::from_value(raw).expect("payload parses untagged");
        assert!(!frame.is_coherent());
    }

    #[test]
    fn bridge_policy_defaults_to_all_false_and_serializes_every_field() {
        let policy = WebviewBridgePolicy::default();
        assert_eq!(
            serde_json::to_value(policy).unwrap(),
            json!({
                "webviewId": false,
                "messageChannels": false,
                "navigatorWindow": false,
                "navigatorScreen": false,
                "nativeApi": false
            })
        );
        let partial: WebviewBridgePolicy = serde_json::from_value(json!({
            "webviewId": true,
            "messageChannels": true
        }))
        .expect("missing fields default to false");
        assert!(partial.webview_id && partial.message_channels && !partial.native_api);
    }

    #[test]
    fn layout_node_kinds_dispatch_on_dir_and_kind() {
        let document: WebviewLayoutDocument = serde_json::from_value(json!({
            "layers": [
                { "root": { "id": "content", "flex": 1 } },
                { "root": { "kind": "webview", "id": "side" } },
                { "root": { "kind": "box", "id": "ring", "cornerRadius": 8 } },
                { "root": { "dir": "row", "gap": 2, "children": [] } }
            ]
        }))
        .expect("layout document");
        assert_eq!(document.layers.len(), 4);
        assert!(matches!(
            document.layers[0].root,
            WebviewLayoutNode::WebviewView(_)
        ));
        assert!(matches!(
            document.layers[1].root,
            WebviewLayoutNode::WebviewView(_)
        ));
        assert!(matches!(
            document.layers[2].root,
            WebviewLayoutNode::BoxView(_)
        ));
        assert!(matches!(
            document.layers[3].root,
            WebviewLayoutNode::Container(_)
        ));
        assert_eq!(document.layers[0].visible, true);
        // Unknown kinds are rejected instead of guessed.
        let bad: Result<WebviewLayoutDocument, _> = serde_json::from_value(
            json!({ "layers": [{ "root": { "kind": "spinner", "id": "x" } }] }),
        );
        assert!(bad.is_err());
    }

    #[test]
    fn layout_validation_rejects_unknown_views_and_bad_measures() {
        let known = |id: &str| matches!(id, "toolbar" | "content" | "ring" | "banner" | "bar");
        let document = |root: Value| -> WebviewLayoutDocument {
            serde_json::from_value(json!({ "layers": [{ "root": root }] })).expect("layout")
        };
        let view_document = |sizing: WebviewLayoutSizing| WebviewLayoutDocument {
            layers: vec![WebviewLayoutLayer {
                root: WebviewLayoutNode::WebviewView(WebviewLayoutViewNode {
                    kind: None,
                    id: "content".to_string(),
                    sizing,
                }),
                visible: true,
            }],
        };
        let box_document = |style: WebviewBoxStyle| WebviewLayoutDocument {
            layers: vec![WebviewLayoutLayer {
                root: WebviewLayoutNode::BoxView(WebviewLayoutBoxNode {
                    kind: WebviewBoxKindTag::Box,
                    id: "ring".to_string(),
                    style,
                    sizing: WebviewLayoutSizing::default(),
                }),
                visible: true,
            }],
        };

        // Valid documents pass.
        assert!(
            validate_webview_layout(&document(json!({ "id": "content", "flex": 1 })), &known)
                .is_ok()
        );
        assert!(validate_webview_layout(
            &document(json!({ "kind": "box", "id": "ring", "border": { "width": 2.0, "color": "#333333AA" } })),
            &known
        )
        .is_ok());

        // Unknown view id.
        let error = validate_webview_layout(
            &document(json!({ "dir": "column", "children": [{ "id": "sidebar" }] })),
            &known,
        )
        .unwrap_err();
        assert_eq!(error.error.code, OrchestrationErrorCode::UnknownView);
        assert!(error.error.message.contains("sidebar"));

        // Invalid measures expressible through JSON.
        for bad_root in [
            json!({ "id": "content", "width": -1.0 }),
            json!({ "id": "content", "minWidth": 300.0, "maxWidth": 200.0 }),
            json!({ "id": "content", "minHeight": 90.0, "maxHeight": 44.0 }),
            json!({ "id": "content", "flex": -2.0 }),
            json!({ "dir": "column", "gap": -5.0, "children": [] }),
            json!({ "kind": "box", "id": "ring", "cornerRadius": -1.0 }),
        ] {
            let error = validate_webview_layout(&document(bad_root), &known).unwrap_err();
            assert_eq!(
                error.error.code,
                OrchestrationErrorCode::InvalidLayoutMeasure,
                "expected invalid_layout_measure"
            );
        }

        // Non-finite measures cannot ride JSON; they are constructed in Rust
        // exactly like a native caller would, and must still be rejected
        // before solving.
        for non_finite in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let error = validate_webview_layout(
                &view_document(WebviewLayoutSizing {
                    width: Some(non_finite),
                    ..WebviewLayoutSizing::default()
                }),
                &known,
            )
            .unwrap_err();
            assert_eq!(
                error.error.code,
                OrchestrationErrorCode::InvalidLayoutMeasure
            );
            let error = validate_webview_layout(
                &box_document(WebviewBoxStyle {
                    background: None,
                    border: Some(WebviewBoxBorder {
                        width: non_finite,
                        color: "#000000".to_string(),
                    }),
                    corner_radius: None,
                }),
                &known,
            )
            .unwrap_err();
            assert_eq!(
                error.error.code,
                OrchestrationErrorCode::InvalidLayoutMeasure
            );
        }

        // Boundary min == max is legal.
        assert!(validate_webview_layout(
            &document(json!({ "id": "toolbar", "minWidth": 44.0, "maxWidth": 44.0 })),
            &known
        )
        .is_ok());

        // The error envelope serializes as the frozen wire shape.
        let envelope =
            WebviewErrorEnvelope::new(OrchestrationErrorCode::InvalidLayoutMeasure, "no");
        assert_eq!(
            serde_json::to_value(&envelope).unwrap(),
            json!({ "error": { "code": "invalid_layout_measure", "message": "no" } })
        );
    }

    #[test]
    fn registries_freeze_their_spellings() {
        assert_eq!(ORCHESTRATION_ERROR_CODES.len(), 10);
        assert!(ORCHESTRATION_ERROR_CODES.contains(&"multiwebview_unsupported_style"));
        assert_eq!(
            serde_json::to_value(OrchestrationErrorCode::MultiwebviewUnsupportedStyle).unwrap(),
            json!("multiwebview_unsupported_style")
        );
        assert_eq!(
            serde_json::to_value(OrchestrationErrorCode::QueueOverflow).unwrap(),
            json!("queue_overflow")
        );
        assert_eq!(
            WEBVIEW_EVENT_KINDS,
            &[
                "urlChange",
                "titleChange",
                "focused",
                "geometryChange",
                "loadState",
                "navigationAction",
                "faviconChange"
            ]
        );
        assert_eq!(
            serde_json::to_value(WebviewEventKind::GeometryChange).unwrap(),
            json!("geometryChange")
        );
        assert_eq!(
            serde_json::to_value(WebviewEventKind::LoadState).unwrap(),
            json!("loadState")
        );
        // loadState phases freeze their spellings; optional payload fields are
        // omitted from the wire when absent (D24).
        assert_eq!(
            serde_json::to_value(WebviewLoadPhase::Started).unwrap(),
            json!("started")
        );
        let failed = WebviewEventFrame::new_load_state(
            owner(),
            "win-1",
            "content",
            8,
            WebviewLoadPhase::Failed,
            "https://unreachable.example.org",
            None,
            None,
        );
        assert_eq!(
            serde_json::to_value(&failed.payload).unwrap(),
            json!({ "phase": "failed", "url": "https://unreachable.example.org" })
        );
        // Command tags never collide with the single-webview command surface.
        let command = build_command("focus-webview").unwrap();
        assert_eq!(command.command_type(), "focus-webview");
    }

    /// Contract-5: the context-menu admission default keys off the child's
    /// bridge surface — trusted shell UI hides the engine menu, ordinary
    /// content keeps the browser-tab behavior — and an explicit value wins.
    #[test]
    fn context_menu_default_depends_on_bridge_surface_and_explicit_wins() {
        let bridged = WebviewBridgePolicy {
            webview_id: true,
            message_channels: true,
            ..WebviewBridgePolicy::default()
        };
        assert!(bridged.has_bridge_surface());
        let bridgeless = WebviewBridgePolicy::default();
        assert!(!bridgeless.has_bridge_surface());
        // Any single capability is enough to make the child trusted shell UI.
        let navigator_only = WebviewBridgePolicy {
            navigator_window: true,
            ..WebviewBridgePolicy::default()
        };
        assert!(navigator_only.has_bridge_surface());

        let defaults = WebviewBrowserOptions::default();
        assert!(
            !defaults.context_menu(true),
            "bridged child defaults to no engine menu"
        );
        assert!(
            defaults.context_menu(false),
            "bridgeless child keeps the engine menu"
        );

        assert!(
            WebviewBrowserOptions {
                context_menu: Some(true),
                ..WebviewBrowserOptions::default()
            }
            .context_menu(true),
            "explicit contextMenu=true re-admits the menu on shell UI"
        );
        assert!(
            !WebviewBrowserOptions {
                context_menu: Some(false),
                ..WebviewBrowserOptions::default()
            }
            .context_menu(false),
            "explicit contextMenu=false also applies to plain content"
        );
    }
}
