//! Windows auxiliary popup windows (`add-webview-orchestration` task 8.4,
//! D26 — the Windows half of the frozen auxiliary-popup contract).
//!
//! A popup is a plain OS window hosting a single webview, opened for a
//! new-window navigation intent (`a[target]`, `window.open`, middle-click,
//! context-menu "open in new window" — all four funnel into WebView2's
//! `NewWindowRequested`). The request is always *handled*: wry sets
//! `Handled=true` and routes the navigation into the popup controller we
//! return through `NewWindowResponse::Create`; it is never delegated to
//! an external browser.
//!
//! Laws implemented here:
//!
//! - **Shared environment (Profile Law):** the popup controller is built
//!   from the opener's `ICoreWebView2Environment` (wry
//!   `with_environment`), so popups share one WebView2 environment and
//!   one profile directory with the window session that opened them.
//! - **No tray window session:** popups never enter the
//!   [`crate::orchestration::WindowRegistry`] and never touch the
//!   one-session-per-tray law; they carry no window/webview ids and are
//!   not addressable through orchestration commands.
//! - **Session/lease ownership:** each popup records the extension
//!   session id of the webview that opened it;
//!   [`close_session_popups`] closes exactly the closing session's
//!   popups without touching other owners' popups.
//! - **Plain v1 surface:** no toolbar, no layout surface, no bridge; the
//!   window title follows the document one-way through the wry
//!   document-title callback.
//!
//! The native bookkeeping (window class, WndProc, popup slots) lives in
//! this module so the ownership rules stay testable without a window
//! server: [`PopupTracker`] entries carry `native: None` in the
//! cargo-test harness and the attribution sweep is exercised as pure
//! state.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ptr::{null, null_mut};
use std::rc::{Rc, Weak};

use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
use webview2_com::WindowCloseRequestedEventHandler;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetSysColorBrush, COLOR_WINDOW};
use windows_sys::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForWindow};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, LoadCursorW, RegisterClassW,
    SetWindowTextW, SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW,
    SWP_NOACTIVATE, SWP_NOZORDER, SW_SHOW, WM_CLOSE, WM_DESTROY, WM_SIZE, WNDCLASSW,
    WS_OVERLAPPEDWINDOW,
};
use wry::{
    NewWindowFeatures, Rect as WryRect, WebView, WebViewBuilder, WebViewBuilderExtWindows,
    WebViewExtWindows,
};

use super::{webview_controller_rect, webview_parent_hwnd, WebviewRuntimeError};

const POPUP_CLASS_NAME: &str = "OpenTrayWebviewPopupWindow";
/// Default logical client size when the new-window request carries no
/// size features (middle-click / context-menu entries never do).
const POPUP_DEFAULT_LOGICAL_SIZE: (f64, f64) = (900.0, 600.0);

thread_local! {
    /// Live popup slots keyed by host HWND. The WndProc reads them on
    /// WM_SIZE (controller resize) and removes them on WM_DESTROY.
    static POPUP_SLOTS: RefCell<HashMap<isize, PopupSlot>> = RefCell::new(HashMap::new());
}

/// WndProc-side popup state: everything needed to resize the single
/// controller and to detach the tracker entry when the user closes the
/// popup window. `Clone` bumps the COM controller's refcount only.
#[derive(Clone)]
struct PopupSlot {
    entry_id: u64,
    tracker: Weak<RefCell<PopupTracker>>,
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    child_hwnd: Option<HWND>,
}

/// Session-owned auxiliary popup bookkeeping. One tracker lives on the
/// runtime; webview build closures capture a weak handle so a popup can
/// be registered from inside WebView2's `NewWindowRequested` callback
/// (dispatched by wry onto the message loop) without reaching the runtime
/// struct.
#[derive(Default)]
pub(crate) struct PopupTracker {
    next_id: u64,
    popups: Vec<PopupEntry>,
}

/// One tracked popup. `native` is `None` only in the cargo-test harness
/// (there is no window server to create real hosts there); production
/// popup creation always attaches it.
struct PopupEntry {
    id: u64,
    session_id: String,
    native: Option<PopupNative>,
}

/// Native half of one popup. Drop order is load-bearing: the controller
/// closes first (while the host HWND is still alive), then the host
/// window destroys — mirroring [`super::orchestration::WindowSession`].
struct PopupNative {
    /// Held for lifetime only: dropping it closes the WebView2
    /// controller (and wry's container child) while the host HWND is
    /// still alive; nothing reads the field afterwards.
    #[allow(dead_code)]
    webview: Box<WebView>,
    hwnd: HWND,
}

impl Drop for PopupNative {
    fn drop(&mut self) {
        // The webview field drops first (controller.Close + wry child
        // HWND destroy); this explicit step then removes the host window.
        // DestroyWindow on an already-destroyed HWND is a harmless no-op.
        unsafe {
            DestroyWindow(self.hwnd);
        }
    }
}

impl PopupTracker {
    /// Number of live popups (any owner). Introspection for the
    /// attribution tests; no v1 runtime consumer.
    #[cfg(test)]
    pub(crate) fn total(&self) -> usize {
        self.popups.len()
    }

    /// Removes and returns the popups owned by the closing session
    /// (session close and lease cleanup share this sweep). The caller
    /// drops the returned entries *outside* any tracker borrow so the
    /// native teardown (WM_DESTROY re-entrancy) never meets a live
    /// `borrow_mut`.
    fn take_session_popups(&mut self, session_id: &str) -> Vec<PopupEntry> {
        let mut mine = Vec::new();
        let mut rest = Vec::new();
        for popup in self.popups.drain(..) {
            if popup.session_id == session_id {
                mine.push(popup);
            } else {
                rest.push(popup);
            }
        }
        self.popups = rest;
        mine
    }

    fn allocate_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// Removes one entry by id (the WM_DESTROY path for user-closed
    /// popups). Same borrow discipline as [`Self::take_session_popups`].
    fn remove_entry(&mut self, id: u64) -> Option<PopupEntry> {
        let index = self.popups.iter().position(|p| p.id == id)?;
        Some(self.popups.remove(index))
    }
}

/// Closes every popup owned by `session_id` (session close / lease
/// cleanup). The WndProc slots detach first so the destroying windows
/// cannot re-enter the tracker; entries then drop outside the borrow.
pub(crate) fn close_session_popups(tracker: &Rc<RefCell<PopupTracker>>, session_id: &str) {
    let entries = tracker.borrow_mut().take_session_popups(session_id);
    for entry in entries {
        if let Some(native) = entry.native {
            detach_popup_slot(native.hwnd);
            drop(native);
        }
    }
}

/// Detaches the WndProc slot of one popup host (idempotent).
fn detach_popup_slot(hwnd: HWND) {
    POPUP_SLOTS.with(|slots| {
        slots.borrow_mut().remove(&(hwnd as isize));
    });
}

/// Opens one auxiliary popup for a new-window navigation intent.
///
/// The popup window is sized from the request's window features when
/// present (`window.open` width/height), otherwise a plain default, and
/// scaled through the opener window's DPI. The controller is built from
/// the opener's environment (shared WebView2 environment/profile —
/// Windows WebView2 Profile Law); the returned `ICoreWebView2` is handed
/// back to wry as the `NewWindowResponse::Create` target, which sets
/// `Handled=true` and `SetNewWindow`, routing the requested navigation
/// into the popup as a top-level context.
pub(crate) fn spawn_popup(
    tracker: &Rc<RefCell<PopupTracker>>,
    session_id: &str,
    opener_hwnd: HWND,
    features: &NewWindowFeatures,
) -> Result<ICoreWebView2, WebviewRuntimeError> {
    let scale = window_scale(opener_hwnd);
    let (logical_width, logical_height) = features
        .size
        .map(|size| (size.width, size.height))
        .unwrap_or(POPUP_DEFAULT_LOGICAL_SIZE);
    let client_width = (logical_width * scale).round().max(200.0) as i32;
    let client_height = (logical_height * scale).round().max(150.0) as i32;
    let (outer_width, outer_height) = outer_window_size(client_width, client_height);

    let hwnd = create_popup_host_window(outer_width, outer_height)?;

    let environment = features.opener.environment.clone();
    let title_hwnd = hwnd;
    let mut builder = WebViewBuilder::new()
        // Shared environment: the popup controller joins the opener's
        // WebView2 environment and profile (never a fresh one).
        .with_environment(environment)
        .with_document_title_changed_handler(move |title| {
            // One-way title follow: the document title drives the window
            // text; the popup exposes no title command surface.
            let wide = wide_null(&title);
            unsafe {
                SetWindowTextW(title_hwnd, wide.as_ptr());
            }
        });
    let (x, y, width, height) = client_rect(hwnd).unwrap_or((0, 0, client_width.max(1), client_height.max(1)));
    builder = builder.with_bounds(WryRect {
        position: wry::dpi::PhysicalPosition::new(x, y).into(),
        size: wry::dpi::PhysicalSize::new(width.max(1), height.max(1)).into(),
    });
    let webview = Box::new(
        builder
            .build_as_child(&PopupHostHandle { hwnd })
            .map_err(|error| popup_creation_error(hwnd, error))?,
    );

    let entry_id = tracker.borrow_mut().allocate_id();
    let controller = webview.controller();
    let child_hwnd = webview_parent_hwnd(webview.as_ref());
    let core = webview.webview();
    // JS `window.close()` must close the popup host, not only wry's
    // internal container child (wry's own handler destroys that child
    // alone). Both handlers may run in either order; destroying the host
    // drives WM_DESTROY → slot detach → tracker entry drop, which closes
    // the controller regardless.
    {
        let close_hwnd = hwnd;
        let mut close_token = 0i64;
        unsafe {
            core.add_WindowCloseRequested(
                &WindowCloseRequestedEventHandler::create(Box::new(move |_sender, _args| {
                    DestroyWindow(close_hwnd);
                    Ok(())
                })),
                &mut close_token,
            )
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
        }
    }
    POPUP_SLOTS.with(|slots| {
        slots.borrow_mut().insert(
            hwnd as isize,
            PopupSlot {
                entry_id,
                tracker: Rc::downgrade(tracker),
                controller,
                child_hwnd,
            },
        );
    });
    tracker.borrow_mut().popups.push(PopupEntry {
        id: entry_id,
        session_id: session_id.to_string(),
        native: Some(PopupNative { webview, hwnd }),
    });
    unsafe {
        ShowWindow(hwnd, SW_SHOW);
    }
    Ok(core)
}

/// Scale factor (logical→physical multiplier) of the opener window's
/// monitor. Popups inherit the opener's DPI context.
fn window_scale(hwnd: HWND) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f64 / 96.0
    }
}

/// Outer (window-creation) size for a desired client area under the
/// popup's frame style, DPI-adjusted.
fn outer_window_size(client_width: i32, client_height: i32) -> (i32, i32) {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: client_width,
        bottom: client_height,
    };
    // AdjustWindowRectExForDpi's DPI input only selects the frame metric
    // table; 96 yields the unscaled frame, then real creation proceeds at
    // the opener-derived size already converted above.
    let ok = unsafe { AdjustWindowRectExForDpi(&mut rect, WS_OVERLAPPEDWINDOW, 0, 0, 96) };
    if ok == 0 {
        (client_width + 32, client_height + 48)
    } else {
        (rect.right - rect.left, rect.bottom - rect.top)
    }
}

/// Physical client rectangle of one window.
fn client_rect(hwnd: HWND) -> Option<(i32, i32, i32, i32)> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetClientRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    Some((
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    ))
}

fn wide_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn popup_creation_error(hwnd: HWND, error: wry::Error) -> WebviewRuntimeError {
    unsafe {
        DestroyWindow(hwnd);
    }
    WebviewRuntimeError::Internal(format!("popup WebView2 creation failed: {error}"))
}

/// Raw handle wrapper so wry can attach the controller to the popup HWND.
struct PopupHostHandle {
    hwnd: HWND,
}

impl raw_window_handle::HasWindowHandle for PopupHostHandle {
    fn window_handle(
        &self,
    ) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError> {
        let hwnd = std::num::NonZeroIsize::new(self.hwnd as isize)
            .ok_or(raw_window_handle::HandleError::Unavailable)?;
        let raw =
            raw_window_handle::RawWindowHandle::Win32(raw_window_handle::Win32WindowHandle::new(
                hwnd,
            ));
        Ok(unsafe { raw_window_handle::WindowHandle::borrow_raw(raw) })
    }
}

fn register_popup_class(hinstance: windows_sys::Win32::Foundation::HINSTANCE) {
    let class_name = wide_null(POPUP_CLASS_NAME);
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(popup_window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: hinstance,
        hIcon: null_mut(),
        hCursor: unsafe { LoadCursorW(null_mut(), IDC_ARROW) },
        hbrBackground: unsafe { GetSysColorBrush(COLOR_WINDOW) },
        lpszMenuName: null(),
        lpszClassName: class_name.as_ptr(),
    };
    unsafe {
        RegisterClassW(&class);
    }
}

fn create_popup_host_window(width: i32, height: i32) -> Result<HWND, WebviewRuntimeError> {
    let hinstance = unsafe { GetModuleHandleW(null()) };
    if hinstance.is_null() {
        return Err(WebviewRuntimeError::Internal(
            "failed to resolve current module handle".into(),
        ));
    }
    register_popup_class(hinstance);
    let class_name = wide_null(POPUP_CLASS_NAME);
    let title = wide_null("OpenTray");
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
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
    Ok(hwnd)
}

/// Resizes one popup's controller (and the wry child HWND, synchronously)
/// to the host window's current client area — the same synchronous form
/// as the session layout transaction (`controller.SetBounds` + immediate
/// child `SetWindowPos`, never wry's async public `set_bounds`).
fn resize_popup_client(hwnd: HWND, slot: &PopupSlot) {
    let Some((_, _, width, height)) = client_rect(hwnd).map(|(x, y, w, h)| (x, y, w, h)) else {
        return;
    };
    unsafe {
        if slot
            .controller
            .SetBounds(webview_controller_rect(width.max(1), height.max(1)))
            .is_err()
        {
            return;
        }
    }
    let Some(child) = slot.child_hwnd else {
        return;
    };
    unsafe {
        SetWindowPos(
            child,
            null_mut(),
            0,
            0,
            width.max(1),
            height.max(1),
            SWP_NOACTIVATE | SWP_NOZORDER,
        );
    }
}

/// Popup host WndProc. Deliberately separate from the tray window proc:
/// WM_CLOSE *destroys* (the tray hide-on-close law must not apply to
/// popups), WM_SIZE resizes the single controller, and WM_DESTROY
/// detaches the slot and drops the tracker entry (user-closed popups do
/// not wait for the session sweep). It never posts quit messages — the
/// broker owns the shared message loop.
unsafe extern "system" fn popup_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLOSE => {
            DestroyWindow(hwnd);
            0
        }
        WM_SIZE => {
            let result = DefWindowProcW(hwnd, msg, wparam, lparam);
            let slot = POPUP_SLOTS.with(|slots| slots.borrow().get(&(hwnd as isize)).cloned());
            if let Some(slot) = slot {
                resize_popup_client(hwnd, &slot);
            }
            result
        }
        WM_DESTROY => {
            let slot = POPUP_SLOTS.with(|slots| slots.borrow_mut().remove(&(hwnd as isize)));
            if let Some(slot) = slot {
                // Take the entry out under a short borrow; drop the native
                // half only after the borrow is gone (the drop destroys
                // windows and closes controllers — no re-entrant borrow).
                let native = slot.tracker.upgrade().and_then(|tracker| {
                    tracker
                        .borrow_mut()
                        .remove_entry(slot.entry_id)
                        .and_then(|entry| entry.native)
                });
                drop(native);
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, session_id: &str) -> PopupEntry {
        PopupEntry {
            id,
            session_id: session_id.to_string(),
            native: None,
        }
    }

    #[test]
    fn popup_ids_allocate_monotonically() {
        let mut tracker = PopupTracker::default();
        let first = tracker.allocate_id();
        let second = tracker.allocate_id();
        assert!(second > first);
    }

    #[test]
    fn session_sweep_closes_only_the_closing_sessions_popups() {
        let mut tracker = PopupTracker::default();
        tracker.popups.push(entry(1, "session-1"));
        tracker.popups.push(entry(2, "session-2"));
        tracker.popups.push(entry(3, "session-1"));
        tracker.popups.push(entry(4, "session-3"));

        let closed = tracker.take_session_popups("session-1");
        assert_eq!(
            closed.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![1, 3],
            "exactly the closing session's popups are taken, in open order"
        );
        assert_eq!(tracker.total(), 2);
        assert_eq!(
            tracker.popups.iter().map(|p| p.id).collect::<Vec<_>>(),
            vec![2, 4],
            "other owners' popups stay open in order"
        );

        // A session with no popups sweeps nothing and disturbs nobody.
        assert!(tracker.take_session_popups("session-none").is_empty());
        assert_eq!(tracker.total(), 2);
    }

    #[test]
    fn user_close_removes_exactly_one_entry() {
        let mut tracker = PopupTracker::default();
        tracker.popups.push(entry(7, "session-1"));
        tracker.popups.push(entry(8, "session-1"));
        let removed = tracker.remove_entry(7).expect("entry removed");
        assert_eq!(removed.id, 7);
        assert_eq!(tracker.total(), 1);
        assert!(tracker.remove_entry(7).is_none(), "removal is idempotent");
    }

    #[test]
    fn popups_never_enter_the_window_registry() {
        // The structural law: popup bookkeeping is tracker-local. A tray
        // with open popups still has no window-registry entry for them, so
        // the one-session-per-tray law is untouched (a window session
        // opens — and a second one rejects — exactly as before).
        use crate::orchestration::{OpenOutcome, WindowOwner, WindowRegistry};
        let mut registry = WindowRegistry::new();
        let mut tracker = PopupTracker::default();
        tracker.popups.push(entry(1, "session-1"));
        assert!(
            registry.window("tray-with-popups").is_none(),
            "popups occupy no tray window session"
        );
        assert_eq!(
            registry.open_window(WindowOwner {
                app_id: "app".into(),
                tray_id: "tray-with-popups".into(),
                session_id: Some("session-1".into()),
                window_id: "default".into(),
            }),
            Ok(OpenOutcome::Created),
            "the tray's window session opens independently of its popups"
        );
        assert!(registry.window("tray-with-popups").is_some());
    }
}
