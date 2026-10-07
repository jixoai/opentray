// Orthogonal intents (2026-10-07; original user request: create-opentray 生
// 成的网页支持快捷键缩放，能力下放内核层、默认启用):
// 1. Keyboard zoom shortcuts are a native window-shell capability: macOS has
//    no browser-menu carrier, so a process-wide keyDown local monitor (the
//    soft-resize pattern) routes Cmd+Plus / Cmd+Minus / Cmd+Zero to the
//    focused webview's WKWebView `pageZoom`.
// 2. Routing state is per window session (windowNumber → target), registered
//    at show time from the common style and removed at session close — the
//    monitor itself stays installed for the process (an empty ledger is a
//    no-op pass-through).
// 3. The zoom ladder is a pure function (step ±20%, clamped to
//    [0.25, 5.0], Zero resets) so the ladder is unit-testable without AppKit.

use std::{cell::RefCell, collections::HashMap, ptr::NonNull, rc::Rc};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSWindow};
use objc2_foundation::NSString;
use objc2_web_kit::WKWebView;
use wry::WryWebView;

use super::FocusTracker;

/// Geometric zoom step: each shortcut activation scales by 20%.
pub(super) const ZOOM_STEP: f64 = 1.2;
/// Chromium-style page-zoom clamp range.
pub(super) const ZOOM_MIN: f64 = 0.25;
pub(super) const ZOOM_MAX: f64 = 5.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ZoomAction {
    In,
    Out,
    Reset,
}

/// The zoom ladder as a pure function: In compounds by [`ZOOM_STEP`] toward
/// [`ZOOM_MAX`], Out divides toward [`ZOOM_MIN`], Reset returns to 1.0.
pub(super) fn next_zoom_factor(current: f64, action: ZoomAction) -> f64 {
    let current = current.clamp(ZOOM_MIN, ZOOM_MAX);
    match action {
        ZoomAction::In => (current * ZOOM_STEP).min(ZOOM_MAX),
        ZoomAction::Out => (current / ZOOM_STEP).max(ZOOM_MIN),
        ZoomAction::Reset => 1.0,
    }
}

/// Classifies a keyDown as a zoom action. The modifier contract is
/// Command (Option and Control must be absent; Shift is tolerated so both
/// the bare `=` and shifted `+` key tops zoom in). `charactersIgnoringModifiers`
/// is exactly the shifted-keytop-stable view this needs.
pub(super) fn zoom_action_for_key(
    characters_ignoring_modifiers: Option<&NSString>,
    modifier_flags: NSEventModifierFlags,
) -> Option<ZoomAction> {
    if !modifier_flags.contains(NSEventModifierFlags::Command)
        || modifier_flags.contains(NSEventModifierFlags::Control)
        || modifier_flags.contains(NSEventModifierFlags::Option)
    {
        return None;
    }
    let characters = characters_ignoring_modifiers?;
    let text = characters.to_string();
    let mut chars = text.chars();
    let first = chars.next()?;
    if chars.next().is_some() {
        return None; // multi-character keys are not shortcuts
    }
    match first {
        '+' | '=' => Some(ZoomAction::In),
        '-' | '_' => Some(ZoomAction::Out),
        '0' => Some(ZoomAction::Reset),
        _ => None,
    }
}

struct ZoomShortcutTarget {
    enabled: Rc<std::cell::Cell<bool>>,
    focus_tracker: Rc<RefCell<FocusTracker>>,
    /// webview_id → (WKWebView, current page zoom). The Retained keeps the
    /// webview alive for the monitor independent of session borrow state.
    /// The wry handle is the WKWebView subclass instance itself.
    views: HashMap<String, (Retained<WKWebView>, f64)>,
}

/// The installed monitor token plus the block that must outlive it.
type ZoomMonitorSlot = (
    Retained<AnyObject>,
    RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent>,
);

thread_local! {
    /// Per-window zoom routing keyed by NSWindow windowNumber. AppKit local
    /// event monitors fire on the main thread only, so the ledger never
    /// crosses threads.
    static ZOOM_SHORTCUT_LEDGER: RefCell<HashMap<isize, ZoomShortcutTarget>> =
        RefCell::new(HashMap::new());
    /// Installed-once process monitor plus the block that must outlive it.
    static ZOOM_SHORTCUT_MONITOR: RefCell<Option<ZoomMonitorSlot>> = RefCell::new(None);
}

/// Installs the process-wide keyDown monitor on first use. An empty ledger
/// makes the handler a pure pass-through, so install-once is safe even when
/// every session opted out.
fn ensure_monitor_installed() {
    ZOOM_SHORTCUT_MONITOR.with(|monitor_slot| {
        if monitor_slot.borrow().is_some() {
            return;
        }
        let block =
            RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent { handle_key_down(event) });
        let mask = NSEventMask::KeyDown;
        let Some(monitor) =
            (unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) })
        else {
            // Without the monitor the shortcuts are absent, never wrong:
            // fail soft and keep every keyDown flowing.
            return;
        };
        *monitor_slot.borrow_mut() = Some((monitor, block));
    });
}

fn handle_key_down(event: NonNull<NSEvent>) -> *mut NSEvent {
    let Some(mtm) = MainThreadMarker::new() else {
        return event.as_ptr();
    };
    let event_ref = unsafe { event.as_ref() };
    if event_ref.r#type() != NSEventType::KeyDown {
        return event.as_ptr();
    }
    let Some(window) = event_ref.window(mtm) else {
        return event.as_ptr();
    };
    let action = zoom_action_for_key(
        event_ref.charactersIgnoringModifiers().as_deref(),
        event_ref.modifierFlags(),
    );
    let Some(action) = action else {
        return event.as_ptr();
    };
    let consumed = ZOOM_SHORTCUT_LEDGER.with(|ledger| {
        let mut ledger = ledger.borrow_mut();
        let Some(target) = ledger.get_mut(&window.windowNumber()) else {
            return false;
        };
        if !target.enabled.get() {
            return false;
        }
        // Same first-responder walk the focus push family uses: WKWebView
        // hands first responder to inner editing views while the page holds
        // keyboard focus.
        let focused = window.firstResponder().and_then(|responder| {
            target
                .focus_tracker
                .borrow()
                .owner_of_responder(Retained::as_ptr(&responder).cast::<AnyObject>())
        });
        let Some(webview_id) = focused else {
            return false;
        };
        let Some((webview, zoom)) = target.views.get_mut(&webview_id) else {
            return false;
        };
        let next = next_zoom_factor(*zoom, action);
        unsafe { webview.setPageZoom(next) };
        *zoom = next;
        true
    });
    if consumed {
        std::ptr::null_mut()
    } else {
        event.as_ptr()
    }
}

/// Shared enable flag so a future retained-style path can flip the gate
/// without re-registering the session.
pub(super) type ZoomShortcutGate = Rc<std::cell::Cell<bool>>;

/// Registers one window session for zoom-shortcut routing. Returns the
/// shared gate; the caller seeds it from the show-time style.
pub(super) fn register_session(
    window: &NSWindow,
    enabled: bool,
    focus_tracker: Rc<RefCell<FocusTracker>>,
) -> ZoomShortcutGate {
    ensure_monitor_installed();
    let gate = Rc::new(std::cell::Cell::new(enabled));
    ZOOM_SHORTCUT_LEDGER.with(|ledger| {
        ledger.borrow_mut().insert(
            window.windowNumber(),
            ZoomShortcutTarget {
                enabled: Rc::clone(&gate),
                focus_tracker,
                views: HashMap::new(),
            },
        );
    });
    gate
}

/// Drops one window session's zoom routing (session close).
pub(super) fn remove_session(window: &NSWindow) {
    ZOOM_SHORTCUT_LEDGER.with(|ledger| {
        ledger.borrow_mut().remove(&window.windowNumber());
    });
}

/// Tracks a webview under its session so the shortcut can zoom it while
/// focused. The ladder always starts from 1.0 (page default). The wry handle
/// IS the WKWebView instance (same object, typed by wry's own wrapper).
pub(super) fn add_webview(window: &NSWindow, webview_id: &str, webview: Retained<WryWebView>) {
    // Same native-penetration idiom as the history-navigation helpers: the
    // wry handle IS the WKWebView instance, re-typed for setPageZoom.
    let wk: Retained<WKWebView> = unsafe { Retained::cast_unchecked(webview) };
    ZOOM_SHORTCUT_LEDGER.with(|ledger| {
        if let Some(target) = ledger.borrow_mut().get_mut(&window.windowNumber()) {
            target.views.insert(webview_id.to_string(), (wk, 1.0));
        }
    });
}

/// Stops tracking a webview (view destroy within a live session).
pub(super) fn remove_webview(window: &NSWindow, webview_id: &str) {
    ZOOM_SHORTCUT_LEDGER.with(|ledger| {
        if let Some(target) = ledger.borrow_mut().get_mut(&window.windowNumber()) {
            target.views.remove(webview_id);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_ladder_steps_and_clamps() {
        let mut factor = 1.0;
        for _ in 0..20 {
            factor = next_zoom_factor(factor, ZoomAction::In);
        }
        assert!((factor - ZOOM_MAX).abs() < f64::EPSILON);
        for _ in 0..40 {
            factor = next_zoom_factor(factor, ZoomAction::Out);
        }
        assert!((factor - ZOOM_MIN).abs() < f64::EPSILON);
        assert!((next_zoom_factor(factor, ZoomAction::Reset) - 1.0).abs() < f64::EPSILON);
        // The ladder is symmetric around each step at mid-range.
        let up = next_zoom_factor(1.0, ZoomAction::In);
        assert!((next_zoom_factor(up, ZoomAction::Out) - 1.0).abs() < 1e-9);
    }
}
