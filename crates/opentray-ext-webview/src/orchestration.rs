//! Platform-neutral multi-webview orchestration bookkeeping.
//!
//! Pure state core for `add-webview-orchestration` decisions D2/D6/D18/D19:
//! owner-tuple window ownership, precise `session_closed` cleanup, the two
//! v1 style-exclusivity checkpoints, per-view push-event sequence numbers,
//! and focus edge transitions. Platform runtimes (macOS today, Windows in
//! the generalization batch) embed [`ViewEvents`] handles into their native
//! webview slots and call these functions; nothing here touches AppKit,
//! Win32, or wry, so the laws are testable without a native window server.
//!
//! Wire shapes come from `opentray-spec::webview` (frozen by the shared
//! fixtures). Error results are typed [`WebviewErrorEnvelope`]s carried as
//! the command response data, because the extension ABI's own error channel
//! is category-level (`rejected`/`unsupported`/`internal`) and cannot carry
//! the orchestration error registry.

use std::collections::HashSet;

use opentray_spec::webview::{
    OrchestrationErrorCode, WebviewBridgePolicy, WebviewErrorEnvelope, WebviewEventFrame,
    WebviewEventKind, WebviewLoadPhase, WebviewOwnerTuple,
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
pub(crate) fn webview_creation_allowed(facts: StyleFacts, existing_webviews: usize) -> Result<(), OrchestrationError> {
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
    pub(crate) fn note_load_state(
        &mut self,
        owner: &WindowOwner,
        window_id: &str,
        phase: WebviewLoadPhase,
        url: impl Into<String>,
        error_code: Option<i32>,
    ) -> Option<WebviewEventFrame> {
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
        ))
    }
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

    /// Removes the window registration for one tray (explicit destroy).
    pub fn destroy_window(&mut self, tray_id: &str) -> Option<WindowEntry> {
        let index = self.entries.iter().position(|(tray, _)| tray == tray_id)?;
        let (_, entry) = self.entries.remove(index);
        Some(entry)
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

    /// Removes a webview registration; returns the removed handle.
    pub fn remove_view(
        &mut self,
        tray_id: &str,
        webview_id: &str,
    ) -> Option<std::rc::Rc<std::cell::RefCell<ViewEvents>>> {
        let entry = self.window_mut(tray_id)?;
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
    /// Transitional rule: windows created by legacy `show` commands that do
    /// not carry `sessionId` are unattributed and are removed by any session
    /// close. This preserves the pre-orchestration single-client lease
    /// cleanup guarantee; once clients attribute sessions, every window is
    /// matched exactly and the transitional branch is unreachable.
    pub fn session_closed(&mut self, closing_session_id: &str) -> Vec<WindowEntry> {
        let mut removed = Vec::new();
        let mut index = 0;
        while index < self.entries.len() {
            let (_, entry) = &mut self.entries[index];
            let matches = entry
                .owner
                .as_ref()
                .map(|owner| match &owner.session_id {
                    Some(recorded) => recorded == closing_session_id,
                    None => true,
                })
                .unwrap_or(true);
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
        assert_eq!(registry.window("tray-1").unwrap().view_ids(), Vec::<String>::new());
        assert!(registry
            .window("tray-1")
            .unwrap()
            .owner
            .as_ref()
            .unwrap()
            .session_id
            .as_deref()
            == Some("session-1"));
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

    #[test]
    fn legacy_unattributed_windows_follow_the_transitional_cleanup_rule() {
        let mut registry = WindowRegistry::new();
        registry
            .open_window(owner("tray-legacy", None))
            .expect("legacy window");
        registry
            .open_window(owner("tray-new", Some("session-9")))
            .expect("attributed window");
        registry.add_view("tray-legacy", view("default")).expect("view");

        // Any session close removes the unattributed legacy window …
        let removed = registry.session_closed("session-9");
        assert_eq!(removed.len(), 2);
        // … and everything is gone afterwards.
        assert!(registry.window("tray-legacy").is_none());
        assert!(registry.window("tray-new").is_none());
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
        assert!(registry.destroy_window("tray-1").is_some());
        assert!(registry.window("tray-1").is_none());
        assert!(registry.window("tray-2").is_some());
        // Destroy → new session for the same tray creates from scratch.
        assert_eq!(
            registry.open_window(owner("tray-1", Some("session-3"))),
            Ok(OpenOutcome::Created)
        );
    }

    #[test]
    fn style_exclusivity_checkpoints_reject_before_state_changes() {
        // Checkpoint (1): creating a second webview in a translucent-style window.
        let error = webview_creation_allowed(style(true, false), 1)
            .expect_err("frameless window cannot gain a second webview");
        assert_eq!(error.code(), OrchestrationErrorCode::MultiwebviewUnsupportedStyle);
        let error = webview_creation_allowed(style(false, true), 1)
            .expect_err("material window cannot gain a second webview");
        assert_eq!(error.code(), OrchestrationErrorCode::MultiwebviewUnsupportedStyle);
        // First webview in such a window is legal (single webview stays supported).
        assert!(webview_creation_allowed(style(true, false), 0).is_ok());
        // Framed opaque windows accept multiple webviews.
        assert!(webview_creation_allowed(style(false, false), 3).is_ok());

        // Checkpoint (2): applying a translucent style to a multi-webview window.
        let error = style_change_allowed(style(true, false), 2)
            .expect_err("multi-webview window cannot become frameless");
        assert_eq!(error.code(), OrchestrationErrorCode::MultiwebviewUnsupportedStyle);
        let error = style_change_allowed(style(false, true), 2)
            .expect_err("multi-webview window cannot become material");
        assert_eq!(error.code(), OrchestrationErrorCode::MultiwebviewUnsupportedStyle);
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
        assert_eq!(lost.payload, opentray_spec::webview::WebviewEventPayload::Focused { focused: false });
        assert_eq!(lost.owner.session_id, "session-1");
        assert_eq!(lost.window_id, "win-1");
        let gained = by_id.get("toolbar").expect("toolbar gains focus");
        assert_eq!(gained.payload, opentray_spec::webview::WebviewEventPayload::Focused { focused: true });

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
        assert!(focus_owner_transition(&mut views, &unattributed, "win", Some("content")).is_empty());
        assert!(views[0].focused);
        // Subscribed but unattributed: still no frame (frame schema requires
        // a session id).
        views[0].subscribe(&[WebviewEventKind::Focused]);
        views[0].focused = false;
        assert!(focus_owner_transition(&mut views, &unattributed, "win", Some("content")).is_empty());
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
        assert!(events.note_url_change(&owner, "win", "https://example.org").is_none());
        assert_eq!(events.url, "https://example.org");
        assert_eq!(events.url_seq, 1);

        events.subscribe(&[WebviewEventKind::UrlChange, WebviewEventKind::TitleChange]);
        let frame = events
            .note_url_change(&owner, "win", "https://example.org/articles/1")
            .expect("subscribed url change emits a frame");
        assert_eq!(frame.seq, 2);
        assert_eq!(frame.kind, WebviewEventKind::UrlChange);
        assert!(frame.is_coherent());
        assert_eq!(frame.payload, opentray_spec::webview::WebviewEventPayload::UrlChange {
            url: "https://example.org/articles/1".to_string(),
        });

        let title_frame = events
            .note_title_change(&owner, "win", "Example Article")
            .expect("subscribed title change emits a frame");
        assert_eq!(title_frame.seq, 3, "one per-view counter across kinds");
        assert_eq!(events.title, "Example Article");
        assert_eq!(events.title_seq, 3);

        // The query pair returns the latest value with its own sequence.
        events.unsubscribe(&[WebviewEventKind::UrlChange]);
        assert!(events.note_url_change(&owner, "win", "https://example.org/next").is_none());
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
        assert!(registry.remove_view("tray-1", "content").is_some());
        assert!(registry.remove_view("tray-1", "content").is_none());
    }

    #[test]
    fn load_state_frames_are_subscribed_edges_with_monotonic_seq() {
        let legacy_owner = owner("tray-legacy", None);
        let owner = owner("tray-1", Some("session-1"));
        let mut events = ViewEvents::new("content", WebviewBridgePolicy::default());

        // Unsubscribed and unattributed views stay silent.
        assert!(events
            .note_load_state(&owner, "win", WebviewLoadPhase::Started, "https://a.example/", None)
            .is_none());
        events.subscribe(&[WebviewEventKind::LoadState]);
        assert!(events
            .note_load_state(&legacy_owner, "win", WebviewLoadPhase::Started, "https://a.example/", None)
            .is_none());

        // Every native navigation transition is one edge: no dedupe.
        let started = events
            .note_load_state(&owner, "win", WebviewLoadPhase::Started, "https://a.example/", None)
            .expect("started frame");
        assert_eq!(started.seq, 1);
        let finished = events
            .note_load_state(&owner, "win", WebviewLoadPhase::Finished, "https://a.example/", None)
            .expect("finished frame");
        assert_eq!(finished.seq, 2);
        let failed = events
            .note_load_state(&owner, "win", WebviewLoadPhase::Failed, "https://b.example/", Some(3))
            .expect("failed frame");
        assert_eq!(failed.seq, 3);
        for frame in [&started, &finished, &failed] {
            assert_eq!(frame.webview_id, "content");
            assert_eq!(frame.kind, WebviewEventKind::LoadState);
            assert!(frame.is_coherent());
        }
        assert!(matches!(
            started.payload,
            opentray_spec::webview::WebviewEventPayload::LoadState { ref phase, error_code: None, progress: None, .. }
                if *phase == WebviewLoadPhase::Started
        ));
        let wire = serde_json::to_value(&failed).unwrap();
        assert_eq!(
            wire["payload"],
            serde_json::json!({ "phase": "failed", "url": "https://b.example/", "errorCode": 3 }),
            "failed payload carries the numeric error code and omits progress"
        );
        let started_wire = serde_json::to_value(&started).unwrap();
        assert_eq!(
            started_wire["payload"],
            serde_json::json!({ "phase": "started", "url": "https://a.example/" }),
            "optional fields stay absent when unknown"
        );

        // Unsubscribing silences later transitions without disturbing seq.
        events.unsubscribe(&[WebviewEventKind::LoadState]);
        assert!(events
            .note_load_state(&owner, "win", WebviewLoadPhase::Started, "https://c.example/", None)
            .is_none());
    }
}
