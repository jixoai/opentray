//! Platform-neutral multi-webview orchestration bookkeeping.
//!
//! Pure state core for `add-webview-orchestration` decisions D2/D6/D18/D19
//! plus the owner-walk rounds D24/D26: owner-tuple window ownership, precise
//! `session_closed` cleanup, the two v1 style-exclusivity checkpoints,
//! per-view push-event sequence numbers, focus edge transitions, the
//! `loadState` navigation lifecycle (in-flight gating, progress throttling),
//! and auxiliary popup ownership. Platform runtimes (macOS today, Windows in
//! the generalization batch) embed [`ViewEvents`] handles into their native
//! webview slots and call these functions; nothing here touches AppKit,
//! Win32, or wry, so the laws are testable without a native window server.
//!
//! Wire shapes come from `opentray-spec::webview` (frozen by the shared
//! fixtures). Error results are typed [`WebviewErrorEnvelope`]s carried as
//! the command response data, because the extension ABI's own error channel
//! is category-level (`rejected`/`unsupported`/`internal`) and cannot carry
//! the orchestration error registry.

use std::collections::{HashSet, VecDeque};

use opentray_spec::webview::{
    matches_webview_navigation_pattern, OrchestrationErrorCode, WebviewBridgePolicy,
    WebviewErrorEnvelope, WebviewEventFrame, WebviewEventKind, WebviewLoadPhase,
    WebviewNavigationRule, WebviewNavigationType, WebviewOwnerTuple,
    WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE,
};

/// Default window-session id bound when a legacy `show` command carries no
/// explicit window id. The facade always supplies one once it adopts the
/// orchestration surface.
pub(crate) const DEFAULT_WINDOW_ID: &str = "default";

/// Default id of the primary webview created by a legacy `show`.
pub(crate) const DEFAULT_WEBVIEW_ID: &str = "default";

/// Owner identity of one window session. `session_id` is `None` while a
/// legacy client that does not yet send `sessionId` owns the window; see
/// [`WindowRegistry::session_closed`] for the transitional cleanup rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowOwner {
    pub app_id: String,
    pub tray_id: String,
    pub session_id: Option<String>,
    pub window_id: String,
}

impl WindowOwner {
    /// Full protocol owner tuple, available only for attributed sessions.
    /// Unattributed windows cannot emit event frames because the frozen
    /// frame schema requires a session id.
    pub fn owner_tuple(&self) -> Option<WebviewOwnerTuple> {
        let session_id = self.session_id.clone()?;
        Some(WebviewOwnerTuple {
            app_id: self.app_id.clone(),
            tray_id: self.tray_id.clone(),
            session_id,
        })
    }
}

/// Typed orchestration rejection. The wire body is the frozen
/// `{ error: { code, message } }` envelope; the platform runtime returns it
/// as the command response data instead of a result frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OrchestrationError {
    pub envelope: WebviewErrorEnvelope,
}

impl OrchestrationError {
    pub fn new(code: OrchestrationErrorCode, message: impl Into<String>) -> Self {
        Self {
            envelope: WebviewErrorEnvelope::new(code, message),
        }
    }

    pub fn code(&self) -> OrchestrationErrorCode {
        self.envelope.error.code
    }
}

/// Translucency-affecting style facts of one window (D6: frameless or a
/// material/transparent background). The platform style state stays the
/// single authority; runtimes snapshot these facts at checkpoint time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct StyleFacts {
    pub frameless: bool,
    pub translucent_background: bool,
}

impl StyleFacts {
    /// True when the window is in a translucency-affecting style state.
    pub fn affects_translucency(self) -> bool {
        self.frameless || self.translucent_background
    }
}

/// Style-exclusivity checkpoint (1): may a window in this style state host
/// one more webview? Rejected before any child state exists.
pub(crate) fn webview_creation_allowed(
    facts: StyleFacts,
    existing_webviews: usize,
) -> Result<(), OrchestrationError> {
    if existing_webviews >= 1 && facts.affects_translucency() {
        return Err(OrchestrationError::new(
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle,
            "multi-webview composition is not supported in a frameless or material window style",
        ));
    }
    Ok(())
}

/// Style-exclusivity checkpoint (2): may this style be applied to a window
/// already hosting webviews? Rejected before the style state changes, so a
/// failed mutation leaves the previous style in place.
pub(crate) fn style_change_allowed(
    new_facts: StyleFacts,
    existing_webviews: usize,
) -> Result<(), OrchestrationError> {
    if existing_webviews > 1 && new_facts.affects_translucency() {
        return Err(OrchestrationError::new(
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle,
            "frameless or material styles cannot be applied to a window hosting multiple webviews",
        ));
    }
    Ok(())
}

/// Per-view push-event state (D19): one monotonically increasing sequence
/// counter per view across all event kinds, field-level value caches for the
/// `(value, seq)` queries, the view's frozen bridge policy, and the set of
/// subscribed event kinds. Shared with native callbacks through
/// `Rc<RefCell<ViewEvents>>`, so events are pushed from native observers
/// directly and never ride the 16 ms window-event drain.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ViewEvents {
    pub webview_id: String,
    pub policy: WebviewBridgePolicy,
    pub subscribed: HashSet<WebviewEventKind>,
    pub next_seq: u64,
    pub url: String,
    pub url_seq: u64,
    pub title: String,
    pub title_seq: u64,
    pub focused: bool,
    /// D23: last recorded overlay/titlebar safe-area projection in view-local
    /// logical pixels (`None` = no overlay intersection or never computed).
    /// Change detection only — geometryChange is an edge event with no query
    /// pair, so this cache never rides a `(value, seq)` response.
    pub overlay_rect: Option<opentray_spec::webview::WebviewGeometryRect>,
    /// D24: whether a navigation is currently in flight (between `started`
    /// and its terminal `finished`/`failed`). Gates the estimatedProgress
    /// push path so idle KVO ticks and post-failure drift stay silent.
    pub load_in_flight: bool,
    /// D24: last progress value that was accepted for a push frame (None
    /// while no load is in flight). Throttles progress frames so native
    /// progress observers cannot flood the outbox.
    pub last_load_progress: Option<f64>,
    /// Latest-class favicon cache (`faviconChange`): the settled absolute
    /// href and the seq it was last recorded at, feeding the
    /// `get-webview-favicon` `(value, seq)` query. `None` until the first
    /// observation.
    pub favicon: Option<String>,
    pub favicon_seq: u64,
    /// Declarative navigation rules, evaluated synchronously at every
    /// native navigation decision point (create option or
    /// `set-webview-navigation-rules`).
    pub navigation_rules: Vec<WebviewNavigationRule>,
    /// The `favicon` create capability. Gates the `get-webview-favicon`
    /// query (typed `favicon_disabled` rejection otherwise); the page-side
    /// observer injection already happened (or not) at bootstrap.
    pub favicon_enabled: bool,
}

impl ViewEvents {
    pub fn new(webview_id: impl Into<String>, policy: WebviewBridgePolicy) -> Self {
        Self {
            webview_id: webview_id.into(),
            policy,
            subscribed: HashSet::new(),
            next_seq: 1,
            url: String::new(),
            url_seq: 0,
            title: String::new(),
            title_seq: 0,
            focused: false,
            overlay_rect: None,
            load_in_flight: false,
            last_load_progress: None,
            favicon: None,
            favicon_seq: 0,
            navigation_rules: Vec::new(),
            favicon_enabled: false,
        }
    }

    pub fn subscribe(&mut self, kinds: &[WebviewEventKind]) {
        self.subscribed.extend(kinds.iter().copied());
    }

    pub fn unsubscribe(&mut self, kinds: &[WebviewEventKind]) {
        for kind in kinds {
            self.subscribed.remove(kind);
        }
    }

    pub fn is_subscribed(&self, kind: WebviewEventKind) -> bool {
        self.subscribed.contains(&kind)
    }

    fn allocate_seq(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.wrapping_add(1);
        seq
    }

    /// Records a URL change. The sequence advances and the cache refreshes
    /// even while unsubscribed (pure push, no replay); a frame is produced
    /// only for subscribed, owner-attributed views.
    pub fn note_url_change(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        url: impl Into<String>,
    ) -> Option<WebviewEventFrame> {
        self.url = url.into();
        let seq = self.allocate_seq();
        self.url_seq = seq;
        if !self.is_subscribed(WebviewEventKind::UrlChange) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_url_change(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            self.url.clone(),
        ))
    }

    /// Records a title change under the same rules as [`Self::note_url_change`].
    pub fn note_title_change(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        title: impl Into<String>,
    ) -> Option<WebviewEventFrame> {
        self.title = title.into();
        let seq = self.allocate_seq();
        self.title_seq = seq;
        if !self.is_subscribed(WebviewEventKind::TitleChange) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_title_change(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            self.title.clone(),
        ))
    }

    /// Emits a focus edge frame for this view if the boolean edge changed and
    /// the view subscribes to `focused`. The tracked flag updates even
    /// without a subscription or owner attribution; native focus trackers
    /// call this per view from their observers.
    pub(crate) fn focus_edge(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        focused: bool,
    ) -> Option<WebviewEventFrame> {
        if self.focused == focused {
            return None;
        }
        self.focused = focused;
        if !self.is_subscribed(WebviewEventKind::Focused) {
            return None;
        }
        let seq = self.allocate_seq();
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_focused(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            focused,
        ))
    }

    /// Records an overlay/titlebar safe-area projection change (D23) and
    /// emits a `geometryChange` frame only when the projection actually
    /// changed and the view subscribes to it. Edge semantics like
    /// [`Self::focus_edge`]: the cache always refreshes (unsubscribed or
    /// unattributed views stay silent), so a later subscription cannot
    /// replay stale geometry and the first recorded change wins the seq.
    pub(crate) fn note_geometry_change(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        rect: Option<opentray_spec::webview::WebviewGeometryRect>,
    ) -> Option<WebviewEventFrame> {
        if self.overlay_rect == rect {
            return None;
        }
        self.overlay_rect = rect;
        if !self.is_subscribed(WebviewEventKind::GeometryChange) {
            return None;
        }
        let seq = self.allocate_seq();
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_geometry_change(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            self.overlay_rect,
        ))
    }

    /// Records a navigation lifecycle transition (D24 `loadState`). Unlike
    /// the query-paired caches there is no stored value to dedupe — every
    /// native navigation callback is a state transition worth one frame —
    /// so the only gates are the subscription and owner attribution, and
    /// the per-view sequence still advances only for emitted frames
    /// (mirroring [`Self::focus_edge`]; `loadState` has no query pair).
    /// `started` marks a load in flight and `finished`/`failed` terminate
    /// it (macOS progress throttling keys off that in-flight state);
    /// `failed` carries the platform error code when the substrate reports
    /// one, and `progress` rides phases where the substrate can report it.
    pub(crate) fn note_load_state(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        phase: WebviewLoadPhase,
        url: impl Into<String>,
        error_code: Option<i32>,
        progress: Option<f64>,
    ) -> Option<WebviewEventFrame> {
        match phase {
            WebviewLoadPhase::Started => {
                self.load_in_flight = true;
                self.last_load_progress = None;
            }
            WebviewLoadPhase::Finished | WebviewLoadPhase::Failed => {
                self.load_in_flight = false;
                self.last_load_progress = None;
            }
        }
        if !self.is_subscribed(WebviewEventKind::LoadState) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        let seq = self.allocate_seq();
        Some(WebviewEventFrame::new_load_state(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            phase,
            url,
            error_code,
            progress,
        ))
    }

    /// Records an intermediate progress observation (D24) from a native
    /// progress source (macOS `estimatedProgress` KVO; Windows has none).
    /// Frames flow only while a load is in flight, the value advanced by at
    /// least 0.05 since the last accepted observation, and the value has not
    /// reached 1.0 — the terminal phase carries full-progress authority. The
    /// throttle state always refreshes for accepted observations, subscribed
    /// or not.
    pub(crate) fn note_load_progress(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        url: impl Into<String>,
        progress: f64,
    ) -> Option<WebviewEventFrame> {
        if !self.load_in_flight || !(0.0..1.0).contains(&progress) {
            return None;
        }
        let advanced = self
            .last_load_progress
            .map_or(true, |last| progress - last >= 0.05);
        if !advanced {
            return None;
        }
        self.last_load_progress = Some(progress);
        let seq = self.allocate_seq();
        if !self.is_subscribed(WebviewEventKind::LoadState) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_load_state(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            WebviewLoadPhase::Started,
            url,
            None,
            Some(progress),
        ))
    }

    /// Records a navigation decision observation (`navigationAction`, Edge
    /// class): every native decision point is one edge worth one frame, so
    /// like [`Self::note_load_state`] the only gates are subscription and
    /// owner attribution and the seq advances only for emitted frames.
    /// Platform runtimes call this from their navigation delegates with the
    /// platform-projected [`WebviewNavigationType`] and optional
    /// user-initiated flag, then apply [`Self::navigation_blocked`] to
    /// decide cancellation.
    pub(crate) fn note_navigation_action(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        url: impl Into<String>,
        navigation_type: WebviewNavigationType,
        is_user_initiated: Option<bool>,
    ) -> Option<WebviewEventFrame> {
        if !self.is_subscribed(WebviewEventKind::NavigationAction) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        let seq = self.allocate_seq();
        Some(WebviewEventFrame::new_navigation_action(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            url,
            navigation_type,
            is_user_initiated,
        ))
    }

    /// Records a settled favicon href (`faviconChange`, Latest class): the
    /// cache and its seq refresh on every observation even while
    /// unsubscribed (the `get-webview-favicon` query must converge), but a
    /// repeated href is not a state change and produces neither a seq nor a
    /// frame.
    pub(crate) fn note_favicon_change(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        href: impl Into<String>,
    ) -> Option<WebviewEventFrame> {
        let href = href.into();
        // An empty href is never favicon state (the page bridge filters
        // null/empty reports; the frame guard rejects them on the wire).
        if href.is_empty() || self.favicon.as_deref() == Some(href.as_str()) {
            return None;
        }
        self.favicon = Some(href);
        let seq = self.allocate_seq();
        self.favicon_seq = seq;
        if !self.is_subscribed(WebviewEventKind::FaviconChange) {
            return None;
        }
        let tuple = owner.owner_tuple()?;
        Some(WebviewEventFrame::new_favicon_change(
            tuple,
            window_id,
            self.webview_id.clone(),
            seq,
            self.favicon.clone().expect("just set"),
        ))
    }

    /// Synchronous rule evaluation for one navigation decision: any `block`
    /// rule whose pattern matches the full URL cancels the navigation.
    /// Platform runtimes call this on the UI thread inside their navigation
    /// delegates — it never awaits IPC, so the veto is race-free.
    pub(crate) fn navigation_blocked(&self, url: &str) -> bool {
        self.navigation_rules.iter().any(|rule| {
            rule.action == opentray_spec::webview::WebviewNavigationRuleAction::Block
                && matches_webview_navigation_pattern(&rule.pattern, url)
        })
    }

    /// The stable `loadState failed` error code a rule-blocked navigation
    /// reports, exposed for platform delegates building the failed frame.
    pub(crate) const BLOCKED_ERROR_CODE: i32 = WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE;
}

/// add-navigation-favicon-surface: the Windows blocked-navigation ledger.
/// Platform-neutral so the eviction, matching, and idempotence semantics
/// are testable without a WebView2 host (R2 P2: the Windows observers
/// delegate every ring decision here; the twin tests below cover the
/// interleaving/eviction/duplicate/unknown cases Codex asked for).
///
/// Eviction is not silent semantic loss: when the ring is full, [`Self::block`]
/// returns the evicted entry and the caller emits that navigation's terminal
/// `failed(navigation_blocked)` frame immediately. The evicted navigation's
/// eventual `NavigationCompleted` no longer matches the ring and reports
/// through the ordinary platform path — one duplicate OperationCanceled
/// frame is the documented cost of 64+ concurrently-blocked navigations on
/// one view. The same immediate-frame rule covers a `NavigationStarting`
/// whose NavigationId getter failed (the id must never key the ring).
///
/// Lifecycle: one ring per controller, owned by the observer closures. A
/// destroyed controller stops firing events (WebView2 drops its handlers
/// with the sender), the closures and the ring die with it, and a re-created
/// view id gets a fresh controller, fresh closures, and a fresh ring — a
/// late completion can never reach a successor view.
pub(crate) struct BlockedNavigationRing {
    entries: VecDeque<(u64, String)>,
    capacity: usize,
}

impl BlockedNavigationRing {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    /// Records one blocked navigation; returns the evicted entry when the
    /// ring was full (the caller emits its failed frame now).
    pub(crate) fn block(&mut self, id: u64, url: String) -> Option<(u64, String)> {
        let evicted = if self.entries.len() >= self.capacity {
            self.entries.pop_front()
        } else {
            None
        };
        self.entries.push_back((id, url));
        evicted
    }

    /// Takes the URL of one completed navigation, if it was blocked.
    /// Idempotent-by-removal: a second completion of the same id misses.
    pub(crate) fn take(&mut self, id: u64) -> Option<String> {
        let index = self.entries.iter().position(|(entry, _)| *entry == id)?;
        self.entries.remove(index).map(|(_, url)| url)
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Resolves one page-reported favicon href into the absolute http(s)
/// address the `faviconChange` frame carries, per the favicon spec: the
/// DOM `link.href` property is already absolute (the common path), the
/// `getAttribute` fallback may be relative, and only http/https with a
/// host survive. R2 P1: resolution is the standard WHATWG join against
/// the view's tracked URL (`url::Url::parse` + `join`), not hand-rolled
/// string splicing — query-only (`?v=2`), fragment-only, `../`/`.` walks,
/// ports and userinfo all follow browser semantics, and non-http(s)
/// results (`data:`, `blob:`, `file:`, ...) reject.
pub(crate) fn resolve_webview_favicon_href(base_url: &str, href: &str) -> Option<String> {
    if href.is_empty() {
        return None;
    }
    let Ok(base) = url::Url::parse(base_url) else {
        return None;
    };
    if !http_https_with_host(&base) {
        return None;
    }
    let Ok(joined) = base.join(href) else {
        return None;
    };
    if !http_https_with_host(&joined) {
        return None;
    }
    Some(joined.to_string())
}

fn http_https_with_host(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
}

/// Applies a new focus owner to every view of one window and returns the
/// emitted edge frames (`focused: true` for the gained view, `focused: false`
/// for the lost one). `None` means no view owns keyboard focus (for example
/// the window resigned key); every previously focused view emits a losing
/// edge. Sequence numbers stay per-view and monotonic across both edges.
#[allow(dead_code)]
pub(crate) fn focus_owner_transition(
    views: &mut [ViewEvents],
    owner: &WindowOwner,
    window_id: &str,
    focused_view: Option<&str>,
) -> Vec<WebviewEventFrame> {
    let mut frames = Vec::new();
    for view in views.iter_mut() {
        let focused = Some(view.webview_id.as_str()) == focused_view;
        if let Some(frame) = view.focus_edge(owner, window_id, focused) {
            frames.push(frame);
        }
    }
    frames
}

/// Outcome of opening a window scope for a tray.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OpenOutcome {
    /// An existing window session for this tray was reused (hide → show).
    Reused,
    /// A new window session was registered.
    Created,
}

/// Outcome of an owner-validated window destroy
/// (harden-lifecycle-ownership D2). Destroy-style registry APIs are typed
/// by the full owner tuple; a bare tray-keyed removal is not expressible.
#[derive(Debug)]
pub(crate) enum DestroyOutcome {
    /// The addressed tuple was resident; its entry was removed.
    Removed,
    /// No entry is registered under the tray — e.g. the caller's own
    /// session sweep already collected it. Nothing was removed; teardown
    /// keyed by the same tuple may proceed.
    Vacant,
    /// A different owner is resident under the tray. The destroy is stale:
    /// it removed nothing and the resident session stays untouched.
    Superseded,
}

/// One registered window session: owner identity plus the per-view event
/// handles. Native webview pointers and NSWindow/Win32 resources stay in
/// the platform runtime, keyed by the same tray id.
#[derive(Debug, Default)]
pub(crate) struct WindowEntry {
    pub owner: Option<WindowOwner>,
    pub views: Vec<std::rc::Rc<std::cell::RefCell<ViewEvents>>>,
}

impl WindowEntry {
    /// Diagnostic/test accessor for the session's webview ids in creation
    /// order.
    #[allow(dead_code)]
    pub fn view_ids(&self) -> Vec<String> {
        self.views
            .iter()
            .map(|view| view.borrow().webview_id.clone())
            .collect()
    }
}

/// Tray-keyed window-session registry with owner-tuple authority (D18).
#[derive(Debug, Default)]
pub(crate) struct WindowRegistry {
    entries: Vec<(String, WindowEntry)>,
}

impl WindowRegistry {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn window(&self, tray_id: &str) -> Option<&WindowEntry> {
        self.entries
            .iter()
            .find(|(tray, _)| tray == tray_id)
            .map(|(_, entry)| entry)
    }

    pub fn window_mut(&mut self, tray_id: &str) -> Option<&mut WindowEntry> {
        self.entries
            .iter_mut()
            .find(|(tray, _)| tray == tray_id)
            .map(|(_, entry)| entry)
    }

    /// Registers or reuses the window scope for one tray. A tray holds at
    /// most one active window session: a second session with a different
    /// session identity fails with the typed error `tray_session_active`
    /// before any window state exists, leaving the live session untouched.
    pub fn open_window(&mut self, owner: WindowOwner) -> Result<OpenOutcome, OrchestrationError> {
        if let Some(entry) = self.window_mut(&owner.tray_id) {
            let existing_session = entry
                .owner
                .as_ref()
                .and_then(|existing| existing.session_id.clone());
            if existing_session == owner.session_id {
                // Same owning session: a compatible re-show reuses the scope.
                entry.owner = Some(owner);
                return Ok(OpenOutcome::Reused);
            }
            let current = match existing_session {
                Some(session) => format!("session {session}"),
                None => "an unattributed legacy session".to_string(),
            };
            return Err(OrchestrationError::new(
                OrchestrationErrorCode::TraySessionActive,
                format!(
                    "tray {} already hosts an active webview window session ({current}); \
                     destroy it before opening another window session",
                    owner.tray_id
                ),
            ));
        }
        self.entries.push((
            owner.tray_id.clone(),
            WindowEntry {
                owner: Some(owner),
                views: Vec::new(),
            },
        ));
        Ok(OpenOutcome::Created)
    }

    /// Whether `expected` is the currently resident owner of the tray's
    /// window session. View-level destroys require a live matching
    /// registration (harden-lifecycle-ownership D2): a stale tuple must
    /// never strip state from a session it no longer addresses.
    pub fn resident_matches(&self, expected: &WindowOwner) -> bool {
        self.window(&expected.tray_id)
            .and_then(|entry| entry.owner.as_ref())
            .is_some_and(|resident| resident == expected)
    }

    /// Removes the window registration for one tray, validated against the
    /// full owner tuple (harden-lifecycle-ownership D2): a destroy
    /// addressing any tuple other than the one currently resident removes
    /// nothing and never touches the resident session. `Vacant` means the
    /// tray holds no registration — for a caller that just collected the
    /// entry through its own session sweep, teardown may proceed; the
    /// outcome itself proves no newer owner superseded it.
    pub fn destroy_window(&mut self, expected: &WindowOwner) -> DestroyOutcome {
        let Some(index) = self
            .entries
            .iter()
            .position(|(tray, _)| *tray == expected.tray_id)
        else {
            return DestroyOutcome::Vacant;
        };
        if !self.entries[index]
            .1
            .owner
            .as_ref()
            .is_some_and(|resident| resident == expected)
        {
            return DestroyOutcome::Superseded;
        }
        self.entries.remove(index);
        DestroyOutcome::Removed
    }

    /// Registers a webview's shared event handle inside a tray's window.
    /// Duplicate ids inside one window session are a plain rejection (the
    /// frozen typed registry has no duplicate-id code; uniqueness itself is
    /// checked by the caller before any native state exists).
    pub fn add_view(
        &mut self,
        tray_id: &str,
        view: std::rc::Rc<std::cell::RefCell<ViewEvents>>,
    ) -> Result<(), OrchestrationError> {
        let entry = self.window_mut(tray_id).ok_or_else(|| {
            OrchestrationError::new(
                OrchestrationErrorCode::UnknownView,
                format!("tray {tray_id} has no active webview window session"),
            )
        })?;
        let id = view.borrow().webview_id.clone();
        if entry
            .views
            .iter()
            .any(|existing| existing.borrow().webview_id == id)
        {
            return Err(OrchestrationError::new(
                OrchestrationErrorCode::UnknownView,
                format!("webview id {id} already exists in this window session"),
            ));
        }
        entry.views.push(view);
        Ok(())
    }

    /// Removes a webview registration, validated against the window's full
    /// owner tuple (harden-lifecycle-ownership D2): a stale destroy can
    /// never strip a view from a session it no longer addresses. Returns
    /// the removed handle.
    pub fn remove_view(
        &mut self,
        expected: &WindowOwner,
        webview_id: &str,
    ) -> Option<std::rc::Rc<std::cell::RefCell<ViewEvents>>> {
        if !self.resident_matches(expected) {
            return None;
        }
        let entry = self.window_mut(&expected.tray_id)?;
        let index = entry
            .views
            .iter()
            .position(|view| view.borrow().webview_id == webview_id)?;
        Some(entry.views.remove(index))
    }

    /// Session cleanup keyed by the closing session id (D18): destroys
    /// exactly the windows whose owner tuple matches the closing session and
    /// never touches another live session's windows.
    ///
    /// Transitional rule (tightened by harden-lifecycle-ownership D2):
    /// windows created by legacy `show` commands that do not carry
    /// `sessionId` are unattributed and are swept only when the closing
    /// session could have owned them — a closing session that holds
    /// attributed windows is a modern client, and sweeping a legacy
    /// client's lease on its close would be collateral damage. A closing
    /// session with no attributed windows may be the legacy client itself,
    /// which preserves the pre-orchestration single-client lease cleanup
    /// guarantee; once clients attribute sessions, every window is matched
    /// exactly and the transitional branch is unreachable.
    pub fn session_closed(&mut self, closing_session_id: &str) -> Vec<WindowEntry> {
        let closing_owns_attributed = self.entries.iter().any(|(_, entry)| {
            entry
                .owner
                .as_ref()
                .and_then(|owner| owner.session_id.as_deref())
                .is_some_and(|recorded| recorded == closing_session_id)
        });
        let mut removed = Vec::new();
        let mut index = 0;
        while index < self.entries.len() {
            let (_, entry) = &mut self.entries[index];
            let matches = match entry
                .owner
                .as_ref()
                .and_then(|owner| owner.session_id.as_deref())
            {
                Some(recorded) => recorded == closing_session_id,
                None => !closing_owns_attributed,
            };
            if matches {
                let (_, entry) = self.entries.remove(index);
                removed.push(entry);
            } else {
                index += 1;
            }
        }
        removed
    }
}

/// Owner identity of one auxiliary popup window (D26): popups hang off the
/// creating window session's owner tuple, never occupy the tray's window
/// session slot, and never influence `tray_session_active`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PopupEntry {
    pub tray_id: String,
    pub session_id: Option<String>,
    pub popup_id: String,
}

/// Auxiliary popup bookkeeping (D26). Pure ownership state, generic over the
/// native payload a platform stores beside each popup (macOS: the plain
/// NSWindow+webview carrier). The ledger is the cleanup authority: closing a
/// session removes exactly that session's popups (with the transitional
/// unattributed rule of [`WindowRegistry::session_closed`]), an explicit
/// window destroy removes that tray's popups, and other owners' popups are
/// never touched.
#[derive(Debug)]
pub(crate) struct PopupLedger<T> {
    popups: Vec<(PopupEntry, T)>,
}

impl<T> Default for PopupLedger<T> {
    fn default() -> Self {
        Self { popups: Vec::new() }
    }
}

impl<T> PopupLedger<T> {
    /// Records one popup under its creating window session's owner tuple.
    pub fn record(&mut self, owner: &WindowOwner, popup_id: impl Into<String>, value: T) {
        self.popups.push((
            PopupEntry {
                tray_id: owner.tray_id.clone(),
                session_id: owner.session_id.clone(),
                popup_id: popup_id.into(),
            },
            value,
        ));
    }

    /// Total popup count (diagnostics and tests).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn len(&self) -> usize {
        self.popups.len()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn is_empty(&self) -> bool {
        self.popups.is_empty()
    }

    /// Popup ids owned by one tray (diagnostics and tests).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn popup_ids_of_tray(&self, tray_id: &str) -> Vec<String> {
        self.popups
            .iter()
            .filter(|(entry, _)| entry.tray_id == tray_id)
            .map(|(entry, _)| entry.popup_id.clone())
            .collect()
    }

    /// Removes and returns every popup owned by the closing session (D26:
    /// session close and lease cleanup close all of that session's popups
    /// without touching other owners'). Unattributed legacy popups follow
    /// the transitional rule tightened by harden-lifecycle-ownership D2:
    /// they close only when the closing session could have owned them (a
    /// closing session that holds attributed popups is a modern client and
    /// must not sweep a legacy lease as collateral).
    pub fn close_all_of_session(&mut self, closing_session_id: &str) -> Vec<(PopupEntry, T)> {
        let closing_owns_attributed = self
            .popups
            .iter()
            .any(|(entry, _)| entry.session_id.as_deref() == Some(closing_session_id));
        let mut kept = Vec::new();
        let mut removed = Vec::new();
        for pair in self.popups.drain(..) {
            let matches = match pair.0.session_id.as_deref() {
                Some(recorded) => recorded == closing_session_id,
                None => !closing_owns_attributed,
            };
            if matches {
                removed.push(pair);
            } else {
                kept.push(pair);
            }
        }
        self.popups = kept;
        removed
    }

    /// Removes and returns every popup owned by one tray (explicit window
    /// destroy): the tray's whole auxiliary set goes with its window.
    pub fn close_all_of_tray(&mut self, tray_id: &str) -> Vec<(PopupEntry, T)> {
        let mut kept = Vec::new();
        let mut removed = Vec::new();
        for pair in self.popups.drain(..) {
            if pair.0.tray_id == tray_id {
                removed.push(pair);
            } else {
                kept.push(pair);
            }
        }
        self.popups = kept;
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn owner(tray: &str, session: Option<&str>) -> WindowOwner {
        WindowOwner {
            app_id: "app-1".to_string(),
            tray_id: tray.to_string(),
            session_id: session.map(str::to_string),
            window_id: DEFAULT_WINDOW_ID.to_string(),
        }
    }

    fn style(frameless: bool, translucent: bool) -> StyleFacts {
        StyleFacts {
            frameless,
            translucent_background: translucent,
        }
    }

    fn view(id: &str) -> Rc<RefCell<ViewEvents>> {
        Rc::new(RefCell::new(ViewEvents::new(
            id,
            WebviewBridgePolicy::default(),
        )))
    }

    #[test]
    fn second_window_session_for_a_tray_is_a_typed_rejection() {
        let mut registry = WindowRegistry::new();
        assert_eq!(
            registry.open_window(owner("tray-1", Some("session-1"))),
            Ok(OpenOutcome::Created)
        );
        // Same session identity re-shows reuse the live scope.
        assert_eq!(
            registry.open_window(owner("tray-1", Some("session-1"))),
            Ok(OpenOutcome::Reused)
        );
        // A second session for the same tray is rejected before any state change.
        let error = registry
            .open_window(owner("tray-1", Some("session-2")))
            .expect_err("second session for one tray must be rejected");
        assert_eq!(error.code(), OrchestrationErrorCode::TraySessionActive);
        let message = error.envelope.error.message.clone();
        assert_eq!(
            serde_json::to_value(&error.envelope).unwrap(),
            serde_json::json!({
                "error": {
                    "code": "tray_session_active",
                    "message": message
                }
            })
        );
        // The live session is untouched.
        assert_eq!(
            registry.window("tray-1").unwrap().view_ids(),
            Vec::<String>::new()
        );
        assert!(
            registry
                .window("tray-1")
                .unwrap()
                .owner
                .as_ref()
                .unwrap()
                .session_id
                .as_deref()
                == Some("session-1")
        );
    }

    #[test]
    fn distinct_trays_coexist_and_session_cleanup_is_exact() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", Some("session-1")))
            .expect("window one");
        registry
            .open_window(owner("tray-2", Some("session-2")))
            .expect("window two");
        registry.add_view("tray-1", view("toolbar")).expect("view");
        registry.add_view("tray-1", view("content")).expect("view");
        registry.add_view("tray-2", view("panel")).expect("view");

        // Closing session-1 removes exactly tray-1's window and its views.
        let removed = registry.session_closed("session-1");
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].view_ids(), vec!["toolbar", "content"]);
        assert!(registry.window("tray-1").is_none());
        // The other live session stays alive and observable.
        assert_eq!(registry.window("tray-2").unwrap().view_ids(), vec!["panel"]);

        // Closing session-2 removes the remaining window.
        assert_eq!(registry.session_closed("session-2").len(), 1);
        assert!(registry.window("tray-2").is_none());
    }

    /// harden-lifecycle-ownership D2: the transitional unattributed rule
    /// sweeps a legacy entry only when the closing session could have owned
    /// it. A closing session that holds attributed windows is a modern
    /// client — its close must not take a legacy client's lease as
    /// collateral.
    #[test]
    fn unattributed_windows_are_swept_only_by_a_session_that_could_own_them() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-legacy", None))
            .expect("legacy window");
        registry
            .open_window(owner("tray-new", Some("session-9")))
            .expect("attributed window");
        registry
            .add_view("tray-legacy", view("default"))
            .expect("view");

        // Closing the attributed session-9 removes exactly its own window …
        let removed = registry.session_closed("session-9");
        assert_eq!(removed.len(), 1);
        // … and leaves the legacy lease alive instead of sweeping it as
        // collateral.
        assert_eq!(
            registry.window("tray-legacy").unwrap().view_ids(),
            vec!["default"]
        );

        // A closing session that holds no attributed window could be the
        // legacy client itself — its close still sweeps the unattributed
        // lease, preserving the pre-orchestration single-client cleanup
        // guarantee.
        let removed = registry.session_closed("session-legacy-client");
        assert_eq!(removed.len(), 1);
        assert!(registry.window("tray-legacy").is_none());
    }

    #[test]
    fn legacy_show_reuses_unattributed_scope_but_new_session_is_rejected() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", None))
            .expect("legacy window");
        assert_eq!(
            registry.open_window(owner("tray-1", None)),
            Ok(OpenOutcome::Reused)
        );
        // An attributed session cannot hijack a live legacy scope.
        let error = registry
            .open_window(owner("tray-1", Some("session-2")))
            .expect_err("identity mismatch must be rejected");
        assert_eq!(error.code(), OrchestrationErrorCode::TraySessionActive);
    }

    #[test]
    fn destroy_window_removes_only_that_tray() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", Some("session-1")))
            .expect("window one");
        registry
            .open_window(owner("tray-2", Some("session-1")))
            .expect("window two");
        assert!(matches!(
            registry.destroy_window(&owner("tray-1", Some("session-1"))),
            DestroyOutcome::Removed
        ));
        assert!(registry.window("tray-1").is_none());
        assert!(registry.window("tray-2").is_some());
        // Destroy → new session for the same tray creates from scratch.
        assert_eq!(
            registry.open_window(owner("tray-1", Some("session-3"))),
            Ok(OpenOutcome::Created)
        );
    }

    /// harden-lifecycle-ownership D2: destroy/remove discriminate on the
    /// full owner tuple — a mismatch on any component (app, tray, session,
    /// window) is `Superseded`/`None` and removes nothing from the resident
    /// session.
    #[test]
    fn destroy_and_remove_are_owner_tuple_validated() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", Some("session-1")))
            .expect("window");
        registry.add_view("tray-1", view("content")).expect("view");

        // Wrong session id.
        assert!(matches!(
            registry.destroy_window(&owner("tray-1", Some("session-2"))),
            DestroyOutcome::Superseded
        ));
        // Wrong window id (the tuple includes windowId).
        let mut wrong_window = owner("tray-1", Some("session-1"));
        wrong_window.window_id = "win-other".to_string();
        assert!(matches!(
            registry.destroy_window(&wrong_window),
            DestroyOutcome::Superseded
        ));
        // Wrong app id.
        let mut wrong_app = owner("tray-1", Some("session-1"));
        wrong_app.app_id = "app-other".to_string();
        assert!(matches!(
            registry.destroy_window(&wrong_app),
            DestroyOutcome::Superseded
        ));
        assert!(registry.window("tray-1").is_some());
        // A view removal under any stale tuple removes nothing.
        assert!(registry
            .remove_view(&owner("tray-1", Some("session-2")), "content")
            .is_none());
        assert!(registry.remove_view(&wrong_window, "content").is_none());
        assert_eq!(
            registry.window("tray-1").unwrap().view_ids(),
            vec!["content"]
        );
        // A tray with no registration is Vacant, not Superseded: nothing
        // newer superseded the caller, teardown may proceed.
        assert!(matches!(
            registry.destroy_window(&owner("tray-x", Some("session-x"))),
            DestroyOutcome::Vacant
        ));
        // The exact tuple removes.
        assert!(matches!(
            registry.destroy_window(&owner("tray-1", Some("session-1"))),
            DestroyOutcome::Removed
        ));
        assert!(registry.window("tray-1").is_none());
    }

    /// harden-lifecycle-ownership D2 reentrancy seam (registry level):
    /// `session_closed` collects the closing session's entries first and
    /// destroys afterwards. A new same-tray session that registers between
    /// those two steps must survive the stale destroy whole — its window
    /// registration and its webviews stay untouched.
    #[test]
    fn late_destroy_cannot_remove_a_newer_same_tray_session() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-1", Some("session-old")))
            .expect("old window");
        registry.add_view("tray-1", view("old-view")).expect("view");

        // Phase 1: the sweep collects the closing session's entries.
        let collected = registry.session_closed("session-old");
        assert_eq!(collected.len(), 1);
        let stale = collected[0]
            .owner
            .clone()
            .expect("attributed closing entry");

        // Phase 2: a new same-tray session becomes resident before the
        // destroy step runs.
        registry
            .open_window(owner("tray-1", Some("session-new")))
            .expect("new window");
        registry.add_view("tray-1", view("new-view")).expect("view");

        // Phase 3: the stale destroy is Superseded, cannot strip the newer
        // session's views, and the newer session survives whole.
        assert!(matches!(
            registry.destroy_window(&stale),
            DestroyOutcome::Superseded
        ));
        assert!(registry.remove_view(&stale, "new-view").is_none());
        assert_eq!(
            registry.window("tray-1").unwrap().view_ids(),
            vec!["new-view"]
        );
        // The newer session still owns its tray afterwards.
        assert_eq!(
            registry.session_closed("session-new").len(),
            1,
            "the newer session is still the resident owner"
        );
        assert!(registry.window("tray-1").is_none());
    }

    #[test]
    fn style_exclusivity_checkpoints_reject_before_state_changes() {
        // Checkpoint (1): creating a second webview in a translucent-style window.
        let error = webview_creation_allowed(style(true, false), 1)
            .expect_err("frameless window cannot gain a second webview");
        assert_eq!(
            error.code(),
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle
        );
        let error = webview_creation_allowed(style(false, true), 1)
            .expect_err("material window cannot gain a second webview");
        assert_eq!(
            error.code(),
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle
        );
        // First webview in such a window is legal (single webview stays supported).
        assert!(webview_creation_allowed(style(true, false), 0).is_ok());
        // Framed opaque windows accept multiple webviews.
        assert!(webview_creation_allowed(style(false, false), 3).is_ok());

        // Checkpoint (2): applying a translucent style to a multi-webview window.
        let error = style_change_allowed(style(true, false), 2)
            .expect_err("multi-webview window cannot become frameless");
        assert_eq!(
            error.code(),
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle
        );
        let error = style_change_allowed(style(false, true), 2)
            .expect_err("multi-webview window cannot become material");
        assert_eq!(
            error.code(),
            OrchestrationErrorCode::MultiwebviewUnsupportedStyle
        );
        // Single-webview windows may still change style freely.
        assert!(style_change_allowed(style(true, true), 1).is_ok());
        // Framed-opaque style changes on multi-webview windows stay legal.
        assert!(style_change_allowed(style(false, false), 4).is_ok());
    }

    #[test]
    fn focus_transition_emits_both_edges_with_per_view_sequences() {
        let mut views = vec![
            ViewEvents::new("toolbar", WebviewBridgePolicy::default()),
            ViewEvents::new("content", WebviewBridgePolicy::default()),
        ];
        for view in &mut views {
            view.subscribe(&[
                WebviewEventKind::UrlChange,
                WebviewEventKind::TitleChange,
                WebviewEventKind::Focused,
                WebviewEventKind::GeometryChange,
            ]);
        }
        views[1].focused = true; // content starts focused

        let owner = owner("tray-1", Some("session-1"));
        let frames = focus_owner_transition(&mut views, &owner, "win-1", Some("toolbar"));

        assert_eq!(frames.len(), 2, "losing and gaining edges");
        let by_id: std::collections::HashMap<_, _> = frames
            .iter()
            .map(|frame| (frame.webview_id.as_str(), frame))
            .collect();
        let lost = by_id.get("content").expect("content loses focus");
        assert_eq!(
            lost.payload,
            opentray_spec::webview::WebviewEventPayload::Focused { focused: false }
        );
        assert_eq!(lost.owner.session_id, "session-1");
        assert_eq!(lost.window_id, "win-1");
        let gained = by_id.get("toolbar").expect("toolbar gains focus");
        assert_eq!(
            gained.payload,
            opentray_spec::webview::WebviewEventPayload::Focused { focused: true }
        );

        // Both views' counters moved; per-view monotonicity continues.
        assert_eq!(views[0].next_seq, 2);
        assert_eq!(views[1].next_seq, 2);
        let frames = focus_owner_transition(&mut views, &owner, "win-1", None);
        assert_eq!(frames.len(), 1, "only toolbar had focus to lose");
        assert_eq!(frames[0].webview_id, "toolbar");
        assert_eq!(views[0].next_seq, 3);
        assert_eq!(views[1].next_seq, 2, "content sequence is untouched");
    }

    #[test]
    fn focus_edges_without_subscription_or_attribution_stay_silent() {
        let mut views = vec![ViewEvents::new("content", WebviewBridgePolicy::default())];
        let attributed = owner("tray-1", Some("session-1"));
        let unattributed = owner("tray-1", None);
        // No subscription: no frames, but the tracked flag still updates.
        assert!(
            focus_owner_transition(&mut views, &unattributed, "win", Some("content")).is_empty()
        );
        assert!(views[0].focused);
        // Subscribed but unattributed: still no frame (frame schema requires
        // a session id).
        views[0].subscribe(&[WebviewEventKind::Focused]);
        views[0].focused = false;
        assert!(
            focus_owner_transition(&mut views, &unattributed, "win", Some("content")).is_empty()
        );
        assert!(views[0].focused);
        // Subscribed and attributed: the frame flows.
        views[0].focused = false;
        let frames = focus_owner_transition(&mut views, &attributed, "win", Some("content"));
        assert_eq!(frames.len(), 1);
    }

    #[test]
    fn url_and_title_events_follow_subscription_and_query_pair_semantics() {
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        let owner = owner("tray-1", Some("session-1"));

        // Unsubscribed changes still advance the sequence and refresh the cache.
        assert!(events
            .note_url_change(&owner, "win", "https://example.org")
            .is_none());
        assert_eq!(events.url, "https://example.org");
        assert_eq!(events.url_seq, 1);

        events.subscribe(&[WebviewEventKind::UrlChange, WebviewEventKind::TitleChange]);
        let frame = events
            .note_url_change(&owner, "win", "https://example.org/articles/1")
            .expect("subscribed url change emits a frame");
        assert_eq!(frame.seq, 2);
        assert_eq!(frame.kind, WebviewEventKind::UrlChange);
        assert!(frame.is_coherent());
        assert_eq!(
            frame.payload,
            opentray_spec::webview::WebviewEventPayload::UrlChange {
                url: "https://example.org/articles/1".to_string(),
            }
        );

        let title_frame = events
            .note_title_change(&owner, "win", "Example Article")
            .expect("subscribed title change emits a frame");
        assert_eq!(title_frame.seq, 3, "one per-view counter across kinds");
        assert_eq!(events.title, "Example Article");
        assert_eq!(events.title_seq, 3);

        // The query pair returns the latest value with its own sequence.
        events.unsubscribe(&[WebviewEventKind::UrlChange]);
        assert!(events
            .note_url_change(&owner, "win", "https://example.org/next")
            .is_none());
        assert_eq!(events.url, "https://example.org/next");
        assert_eq!(events.url_seq, 4, "cache and seq advance without delivery");
    }

    #[test]
    fn registry_view_registration_rejects_unknown_windows_and_duplicates() {
        let mut registry = WindowRegistry::new();
        let error = registry
            .add_view("tray-missing", view("content"))
            .expect_err("no window session");
        assert_eq!(error.code(), OrchestrationErrorCode::UnknownView);

        registry
            .open_window(owner("tray-1", Some("session-1")))
            .expect("window");
        registry.add_view("tray-1", view("content")).expect("view");
        let error = registry
            .add_view("tray-1", view("content"))
            .expect_err("duplicate id");
        assert_eq!(error.code(), OrchestrationErrorCode::UnknownView);
        let window_owner = owner("tray-1", Some("session-1"));
        assert!(registry.remove_view(&window_owner, "content").is_some());
        assert!(registry.remove_view(&window_owner, "content").is_none());
    }

    #[test]
    fn favicon_href_resolution_follows_the_absolute_https_http_contract() {
        let cases: &[(&str, &str, Option<&str>)] = &[
            // The common path: the DOM href property is already absolute.
            (
                "https://example.org/page",
                "https://cdn.example.org/icon.ico",
                Some("https://cdn.example.org/icon.ico"),
            ),
            (
                "https://example.org/page",
                "http://other.example/i.png",
                Some("http://other.example/i.png"),
            ),
            // Explicit non-http schemes never reach the wire.
            ("https://example.org/", "data:image/png;base64,xxx", None),
            (
                "https://example.org/",
                "blob:https://example.org/uuid",
                None,
            ),
            ("https://example.org/", "file:///tmp/icon.ico", None),
            ("https://example.org/", "javascript:void(0)", None),
            ("https://example.org/", "", None),
            // Scheme-relative joins the base scheme.
            (
                "https://example.org/page",
                "//cdn.example.org/i.ico",
                Some("https://cdn.example.org/i.ico"),
            ),
            (
                "http://example.org/page",
                "//cdn.example.org/i.ico",
                Some("http://cdn.example.org/i.ico"),
            ),
            // Path-absolute joins the origin.
            (
                "https://example.org/a/b",
                "/favicon.ico",
                Some("https://example.org/favicon.ico"),
            ),
            // Relative joins the base directory (naive, no ../ rebase).
            (
                "https://example.org/a/b",
                "icon.ico",
                Some("https://example.org/a/icon.ico"),
            ),
            (
                "https://example.org/a/",
                "icon.ico",
                Some("https://example.org/a/icon.ico"),
            ),
            (
                "https://example.org",
                "icon.ico",
                Some("https://example.org/icon.ico"),
            ),
            // A non-http(s) base cannot anchor anything.
            ("about:blank", "/favicon.ico", None),
            ("", "/favicon.ico", None),
            // R2 P1: standard WHATWG join semantics — query-only and
            // fragment-only keep the document path, `../`/`.` rebase,
            // ports and userinfo are part of the authority.
            (
                "https://example.org/a/b",
                "?v=2",
                Some("https://example.org/a/b?v=2"),
            ),
            (
                "https://example.org/a/b",
                "#icon",
                Some("https://example.org/a/b#icon"),
            ),
            (
                "https://example.org/a/b",
                "../icon.ico",
                Some("https://example.org/icon.ico"),
            ),
            (
                "https://example.org/a/b",
                "./icon.ico",
                Some("https://example.org/a/icon.ico"),
            ),
            (
                "https://example.org:8443/a",
                "icon.ico",
                Some("https://example.org:8443/icon.ico"),
            ),
            (
                "https://user:pw@example.org/a",
                "icon.ico",
                Some("https://user:pw@example.org/icon.ico"),
            ),
            // Scheme case-insensitivity and joined results that lose the
            // host (or change scheme) reject.
            (
                "HTTPS://example.org/a",
                "icon.ico",
                Some("https://example.org/icon.ico"),
            ),
            // Standard-join truth: WHATWG parsing folds the extra slash of
            // a special scheme, so `https:///x` is host `x` — legal; an
            // empty host (`//`) and malformed IPv6 reject.
            (
                "https://example.org/a",
                "https:///icon.ico",
                Some("https://icon.ico/"),
            ),
            ("https://example.org/a", "//", None),
            ("https://example.org/a", "https://[::1", None),
        ];
        for (base, href, expected) in cases {
            assert_eq!(
                resolve_webview_favicon_href(base, href),
                expected.map(str::to_string),
                "base {base:?} href {href:?}"
            );
        }
    }

    #[test]
    fn blocked_ring_pairs_completions_with_their_blocked_urls_and_evicts_with_notice() {
        let mut ring = BlockedNavigationRing::new(2);
        // Interleaved A/B starts, completions arrive in the opposite order:
        // each completion carries its own blocked URL.
        assert!(ring.block(10, "https://example.org/a".into()).is_none());
        assert!(ring.block(11, "https://example.org/b".into()).is_none());
        assert_eq!(ring.take(11).as_deref(), Some("https://example.org/b"));
        assert_eq!(ring.take(10).as_deref(), Some("https://example.org/a"));

        // Capacity eviction hands the caller the evicted entry so it can
        // emit the terminal failed frame immediately (the evicted id's
        // completion later misses the ring). With capacity 2 already held
        // by 12/13, blocking 14 evicts 12.
        assert!(ring.block(12, "https://example.org/c".into()).is_none());
        assert!(ring.block(13, "https://example.org/d".into()).is_none());
        let evicted = ring
            .block(14, "https://example.org/e".into())
            .expect("full ring evicts");
        assert_eq!(evicted, (12, "https://example.org/c".to_string()));
        assert!(ring.take(12).is_none());
        assert_eq!(ring.take(13).as_deref(), Some("https://example.org/d"));
        assert_eq!(ring.take(14).as_deref(), Some("https://example.org/e"));

        // Unknown and duplicate ids miss exactly once each.
        assert!(ring.take(999).is_none());
        assert!(ring.block(15, "https://example.org/f".into()).is_none());
        assert_eq!(ring.take(15).as_deref(), Some("https://example.org/f"));
        assert!(ring.take(15).is_none());
        assert_eq!(ring.len(), 0);
    }

    #[test]
    fn favicon_query_is_capability_gated() {
        let attributed = owner("tray-1", Some("session-1"));
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        assert!(!events.favicon_enabled);
        events.favicon_enabled = true;
        assert!(events.favicon_enabled);
        // The gate is pure state; the typed rejection lives in the command
        // handlers (both platforms), asserted through the frozen
        // `favicon_disabled` code below.
        assert_eq!(
            serde_json::to_value(opentray_spec::webview::OrchestrationErrorCode::FaviconDisabled)
                .unwrap(),
            serde_json::json!("favicon_disabled")
        );
        // Silence unused-variable lint for the owner binding shape used by
        // the sibling tests.
        let _ = &attributed;
    }

    #[test]
    fn navigation_action_frames_follow_subscription_and_carry_the_projection() {
        use opentray_spec::webview::WebviewEventPayload;

        let attributed = owner("tray-1", Some("session-1"));
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        // Unsubscribed: no frame, no seq burn (Edge class, no query pair).
        assert!(events
            .note_navigation_action(
                &attributed,
                "win",
                "https://example.org/a",
                WebviewNavigationType::Link,
                Some(true)
            )
            .is_none());
        events.subscribe(&[WebviewEventKind::NavigationAction]);
        let frame = events
            .note_navigation_action(
                &attributed,
                "win",
                "https://example.org/a",
                WebviewNavigationType::Link,
                Some(true),
            )
            .expect("subscribed view emits");
        assert_eq!(frame.seq, 1);
        assert!(frame.is_coherent());
        let WebviewEventPayload::NavigationAction {
            url,
            navigation_type,
            is_user_initiated,
        } = &frame.payload
        else {
            panic!("payload variant");
        };
        assert_eq!(url, "https://example.org/a");
        assert_eq!(*navigation_type, WebviewNavigationType::Link);
        assert_eq!(*is_user_initiated, Some(true));
        // The optional flag serializes away when the platform cannot
        // attribute a gesture (macOS truth).
        let redirect = events
            .note_navigation_action(
                &attributed,
                "win",
                "https://example.org/login",
                WebviewNavigationType::Redirect,
                None,
            )
            .expect("subscribed view emits");
        let value = serde_json::to_value(&redirect).expect("serialize");
        assert!(value["payload"].get("isUserInitiated").is_none());
        // Unattributed legacy owner: state-only, no frame.
        let legacy = WindowOwner {
            app_id: "app-1".into(),
            tray_id: "tray-1".into(),
            session_id: None,
            window_id: "win".into(),
        };
        assert!(events
            .note_navigation_action(
                &legacy,
                "win",
                "https://example.org/b",
                WebviewNavigationType::Other,
                None
            )
            .is_none());
    }

    #[test]
    fn favicon_change_is_latest_with_dedupe_and_query_pair() {
        let attributed = owner("tray-1", Some("session-1"));
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        // Cache refreshes while unsubscribed so the query converges.
        assert!(events
            .note_favicon_change(&attributed, "win", "https://example.org/favicon.ico")
            .is_none());
        assert_eq!(
            events.favicon.as_deref(),
            Some("https://example.org/favicon.ico")
        );
        assert_eq!(events.favicon_seq, 1);
        events.subscribe(&[WebviewEventKind::FaviconChange]);
        // A repeated href is not a state change: no seq, no frame.
        assert!(events
            .note_favicon_change(&attributed, "win", "https://example.org/favicon.ico")
            .is_none());
        assert_eq!(events.favicon_seq, 1);
        let frame = events
            .note_favicon_change(&attributed, "win", "https://example.org/favicon-2.ico")
            .expect("changed href emits");
        assert_eq!(frame.seq, 2);
        assert!(frame.is_coherent());
        assert_eq!(
            events.favicon.as_deref(),
            Some("https://example.org/favicon-2.ico")
        );
        assert_eq!(events.favicon_seq, 2);
        // An empty href never reaches the state (the interceptor filters;
        // the core would mark it incoherent anyway).
        let empty = events.note_favicon_change(&attributed, "win", "");
        assert!(empty.is_none());
        assert!(matches!(empty, None));
        assert_eq!(
            events.favicon.as_deref(),
            Some("https://example.org/favicon-2.ico")
        );
    }

    #[test]
    fn navigation_rules_block_synchronously_and_drive_the_failed_code() {
        let attributed = owner("tray-1", Some("session-1"));
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        assert!(!events.navigation_blocked("https://example.org/ads"));
        events.navigation_rules = vec![WebviewNavigationRule {
            pattern: "*://*.tracker.example/*".to_string(),
            action: opentray_spec::webview::WebviewNavigationRuleAction::Block,
        }];
        assert!(events.navigation_blocked("https://cdn.tracker.example/pixel.gif"));
        assert!(!events.navigation_blocked("https://example.org/ok"));
        // The terminal frame a blocked navigation reports carries the
        // stable code, not a platform status.
        events.subscribe(&[WebviewEventKind::LoadState]);
        let frame = events
            .note_load_state(
                &attributed,
                "win",
                WebviewLoadPhase::Failed,
                "https://cdn.tracker.example/pixel.gif".to_string(),
                Some(ViewEvents::BLOCKED_ERROR_CODE),
                None,
            )
            .expect("subscribed failed frame");
        let value = serde_json::to_value(&frame).expect("serialize");
        assert_eq!(
            value["payload"]["errorCode"],
            ViewEvents::BLOCKED_ERROR_CODE
        );
        assert_eq!(
            ViewEvents::BLOCKED_ERROR_CODE,
            WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE
        );
    }

    #[test]
    fn load_state_lifecycle_frames_follow_subscription_and_seq_semantics() {
        use opentray_spec::webview::WebviewEventPayload;

        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        let attributed = owner("tray-1", Some("session-1"));

        // Unsubscribed transitions flip the in-flight state but do NOT
        // advance the sequence — the focus_edge family convention: seq
        // advances only for emitted frames.
        assert!(events
            .note_load_state(
                &attributed,
                "win",
                WebviewLoadPhase::Started,
                "https://example.org",
                None,
                None
            )
            .is_none());
        assert!(events.load_in_flight);
        assert_eq!(events.next_seq, 1);

        events.subscribe(&[WebviewEventKind::LoadState]);
        let started = events
            .note_load_state(
                &attributed,
                "win",
                WebviewLoadPhase::Started,
                "https://example.org/a",
                None,
                None,
            )
            .expect("subscribed started emits");
        assert!(started.is_coherent());
        assert!(
            started.payload
                == WebviewEventPayload::LoadState {
                    phase: WebviewLoadPhase::Started,
                    url: "https://example.org/a".to_string(),
                    error_code: None,
                    progress: None,
                }
        );

        let finished = events
            .note_load_state(
                &attributed,
                "win",
                WebviewLoadPhase::Finished,
                "https://example.org/a",
                None,
                Some(1.0),
            )
            .expect("subscribed finished emits");
        assert_eq!(finished.seq, 2, "one per-view counter across kinds");
        assert!(
            finished.payload
                == WebviewEventPayload::LoadState {
                    phase: WebviewLoadPhase::Finished,
                    url: "https://example.org/a".to_string(),
                    error_code: None,
                    progress: Some(1.0),
                }
        );
        assert!(!events.load_in_flight);

        // Failed frames carry the platform error code.
        events.note_load_state(
            &attributed,
            "win",
            WebviewLoadPhase::Started,
            "https://unreachable.example",
            None,
            None,
        );
        let failed = events
            .note_load_state(
                &attributed,
                "win",
                WebviewLoadPhase::Failed,
                "https://unreachable.example",
                Some(-1003),
                None,
            )
            .expect("subscribed failure emits");
        assert!(failed.is_coherent());
        assert!(
            failed.payload
                == WebviewEventPayload::LoadState {
                    phase: WebviewLoadPhase::Failed,
                    url: "https://unreachable.example".to_string(),
                    error_code: Some(-1003),
                    progress: None,
                }
        );
        assert!(!events.load_in_flight);

        // Unattributed views stay silent (the frozen frame schema requires a
        // session id) but the lifecycle state still tracks.
        let unattributed = owner("tray-1", None);
        assert!(events
            .note_load_state(
                &unattributed,
                "win",
                WebviewLoadPhase::Started,
                "https://example.org",
                None,
                None
            )
            .is_none());
        assert!(events.load_in_flight);
    }

    #[test]
    fn load_progress_frames_are_throttled_and_in_flight_gated() {
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());
        let attributed = owner("tray-1", Some("session-1"));
        events.subscribe(&[WebviewEventKind::LoadState]);

        // No load in flight: progress observations stay silent.
        assert!(events
            .note_load_progress(&attributed, "win", "https://example.org", 0.1)
            .is_none());

        events.note_load_state(
            &attributed,
            "win",
            WebviewLoadPhase::Started,
            "https://example.org",
            None,
            None,
        );
        // First in-flight observation is accepted even at low values.
        let first = events
            .note_load_progress(&attributed, "win", "https://example.org", 0.02)
            .expect("first in-flight progress emits");
        assert!(first.is_coherent());
        // Small drift below the 0.05 threshold stays silent.
        assert!(events
            .note_load_progress(&attributed, "win", "https://example.org", 0.03)
            .is_none());
        // Advancing past the threshold emits again.
        let second = events
            .note_load_progress(&attributed, "win", "https://example.org", 0.1)
            .expect("threshold-crossing progress emits");
        assert_eq!(second.seq, first.seq + 1);
        // Reaching 1.0 is the finished frame's authority, not the progress path.
        assert!(events
            .note_load_progress(&attributed, "win", "https://example.org", 1.0)
            .is_none());
        // After the terminal phase, further KVO drift stays silent.
        events.note_load_state(
            &attributed,
            "win",
            WebviewLoadPhase::Finished,
            "https://example.org",
            None,
            Some(1.0),
        );
        assert!(events
            .note_load_progress(&attributed, "win", "https://example.org", 0.4)
            .is_none());
        assert_eq!(events.last_load_progress, None);
    }

    #[test]
    fn popup_ledger_session_cleanup_closes_only_the_closing_sessions_popups() {
        let mut ledger = PopupLedger::<()>::default();
        let session_one = owner("tray-1", Some("session-1"));
        let session_two = owner("tray-2", Some("session-2"));
        ledger.record(&session_one, "popup-a", ());
        ledger.record(&session_one, "popup-b", ());
        ledger.record(&session_two, "popup-c", ());
        assert_eq!(ledger.len(), 3);

        // Closing session-1 closes both of its popups and nothing else.
        let removed = ledger.close_all_of_session("session-1");
        assert_eq!(
            removed
                .iter()
                .map(|(entry, _)| entry.popup_id.clone())
                .collect::<Vec<_>>(),
            vec!["popup-a".to_string(), "popup-b".to_string()]
        );
        assert_eq!(
            ledger.popup_ids_of_tray("tray-2"),
            vec!["popup-c".to_string()]
        );
        assert_eq!(ledger.len(), 1);

        // Closing session-2 drains the ledger.
        assert_eq!(ledger.close_all_of_session("session-2").len(), 1);
        assert!(ledger.is_empty());

        // Unattributed legacy popups follow the transitional rule only when
        // the closing session could have owned them: closing session-9 here
        // holds no attributed popups, so it may be the legacy client and the
        // legacy popup closes with it; attributed ones survive a foreign
        // session's close untouched.
        let legacy = owner("tray-3", None);
        ledger.record(&legacy, "popup-legacy", ());
        ledger.record(&session_one, "popup-d", ());
        let removed = ledger.close_all_of_session("session-9");
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].0.popup_id, "popup-legacy");
        assert_eq!(ledger.popup_ids_of_tray("tray-1"), vec!["popup-d"]);
    }

    /// harden-lifecycle-ownership D2: a closing session that holds
    /// attributed popups is a modern client — its close must not sweep an
    /// unattributed legacy popup as collateral.
    #[test]
    fn popup_ledger_unattributed_rule_sweeps_only_a_possible_owner() {
        let mut ledger = PopupLedger::<()>::default();
        let legacy = owner("tray-legacy", None);
        let modern = owner("tray-new", Some("session-9"));
        ledger.record(&legacy, "popup-legacy", ());
        ledger.record(&modern, "popup-modern", ());

        // Closing the attributed session-9 takes exactly its own popup …
        let removed = ledger.close_all_of_session("session-9");
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].0.popup_id, "popup-modern");
        // … and the legacy popup survives the modern session's close.
        assert_eq!(
            ledger.popup_ids_of_tray("tray-legacy"),
            vec!["popup-legacy"]
        );

        // A session owning no attributed popups may be the legacy client.
        assert_eq!(ledger.close_all_of_session("session-legacy").len(), 1);
        assert!(ledger.is_empty());
    }

    #[test]
    fn popup_ledger_tray_destroy_and_tray_session_isolation() {
        let mut ledger = PopupLedger::<u8>::default();
        let session_one = owner("tray-1", Some("session-1"));
        let session_two = owner("tray-2", Some("session-2"));
        ledger.record(&session_one, "popup-a", 1);
        ledger.record(&session_two, "popup-b", 2);

        // Explicit destroy of tray-1's window removes exactly tray-1's popup.
        let removed = ledger.close_all_of_tray("tray-1");
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].0.popup_id, "popup-a");
        assert_eq!(
            ledger.popup_ids_of_tray("tray-2"),
            vec!["popup-b".to_string()]
        );

        // Popups never influence the one-window-session-per-tray law: a tray
        // with open popups still rejects a second window session, and after
        // its session closes the registry holds no popup-created phantom.
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-2", Some("session-2")))
            .expect("window");
        ledger.record(&session_two, "popup-c", 3);
        let error = registry
            .open_window(owner("tray-2", Some("session-other")))
            .expect_err("popups do not relax tray_session_active");
        assert_eq!(error.code(), OrchestrationErrorCode::TraySessionActive);
        assert_eq!(registry.session_closed("session-2").len(), 1);
        assert!(registry.window("tray-2").is_none());
        assert_eq!(ledger.close_all_of_session("session-2").len(), 2);
    }
}
