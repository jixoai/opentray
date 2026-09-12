//! D26 auxiliary popup windows.
//!
//! Every new-window navigation intent of a session webview (`a[target]`,
//! `window.open`, middle-click, the context menu's "open in new window")
//! funnels into WebKit's `WKUIDelegate` new-webview callback. wry routes
//! that callback into the builder's new-window request handler, so each
//! session webview is built with a handler that materializes the popup
//! itself: a plain titled `NSWindow` hosting one bridgeless wry webview
//! created from the opener's `WKWebViewConfiguration` (WebKit loads the
//! navigation request into the returned web view). Popups carry no toolbar,
//! their window title follows the document one-way, they never occupy the
//! tray's window session, and the shared [`PopupLedger`] owns their cleanup
//! by owner tuple.

use std::cell::RefCell;
use std::rc::Rc;

use objc2::rc::Retained;
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::WKWebView;
use wry::{
    dpi::{LogicalPosition, LogicalSize},
    NewWindowFeatures, NewWindowResponse, Rect as WryRect, WebView, WebViewBuilder,
    WebViewBuilderExtMacos, WebViewExtMacOS,
};

use crate::WebviewRuntimeError;
use crate::orchestration::{PopupLedger, WindowOwner};

use super::AppKitViewHandle;

/// One auxiliary popup: the plain carrier window plus its webview. Dropping
/// the entry closes the window (session close, window destroy, and lease
/// cleanup all funnel into ledger removal).
pub(super) struct PopupWindow {
    /// Owning wry handle; the field is never read, but dropping it (after
    /// `Drop` closes the window) removes the child view and releases the
    /// WKWebView.
    _webview: Box<WebView>,
    window: Retained<NSWindow>,
}

impl Drop for PopupWindow {
    fn drop(&mut self) {
        // ext commands and session teardown run on the main thread. The
        // wry webview field drops right after and removes its child view.
        self.window.close();
    }
}

/// Shared native popup ownership: one ledger per runtime, shared into every
/// session webview's new-window handler through a `Weak` handle.
pub(super) type SharedPopupLedger = Rc<RefCell<PopupLedger<PopupWindow>>>;

/// The new-window handler closure installed on every session webview. The
/// `Weak` ledger handle denies orphan popups once the runtime is gone.
pub(super) fn new_window_handler(
    ledger: &SharedPopupLedger,
    owner: &WindowOwner,
    devtools: bool,
) -> impl Fn(String, NewWindowFeatures) -> NewWindowResponse + 'static {
    let ledger = Rc::downgrade(ledger);
    let owner = owner.clone();
    move |url, features| match ledger.upgrade() {
        Some(ledger) => match open_popup(&url, features, &ledger, &owner, devtools) {
            Ok(webview) => NewWindowResponse::Create { webview },
            Err(error) => {
                eprintln!("opentray-ext-webview popup open failed for {url}: {error}");
                NewWindowResponse::Deny
            }
        },
        None => NewWindowResponse::Deny,
    }
}

/// Materializes one popup for a new-window navigation intent and records it
/// under the creating window session's owner tuple. Returns the WKWebView
/// WebKit will load the navigation request into.
fn open_popup(
    url: &str,
    features: NewWindowFeatures,
    ledger: &SharedPopupLedger,
    owner: &WindowOwner,
    devtools: bool,
) -> Result<Retained<WKWebView>, WebviewRuntimeError> {
    let mtm = objc2::MainThreadMarker::new().ok_or_else(|| {
        WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
    })?;
    let width = features.size.map_or(980.0, |size| size.width.max(240.0));
    let height = features.size.map_or(640.0, |size| size.height.max(160.0));
    let screen_height = objc2_app_kit::NSScreen::screens(mtm)
        .iter()
        .next()
        .map(|screen| screen.frame().size.height)
        .unwrap_or(800.0);
    // WebKit window features use top-left screen coordinates; AppKit origins
    // sit in the bottom-left corner.
    let origin = features
        .position
        .map(|position| NSPoint::new(position.x, (screen_height - position.y - height).max(0.0)));

    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            mtm.alloc::<NSWindow>(),
            NSRect::new(
                origin.unwrap_or_else(|| NSPoint::new(0.0, 0.0)),
                NSSize::new(width, height),
            ),
            NSWindowStyleMask::Titled
                | NSWindowStyleMask::Closable
                | NSWindowStyleMask::Miniaturizable
                | NSWindowStyleMask::Resizable,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe { window.setReleasedWhenClosed(false) };
    // Title follows the document one-way; until the first document title
    // callback the pending target is the most honest label available.
    window.setTitle(&NSString::from_str(url));
    if origin.is_none() {
        window.center();
    }
    let content_view = window
        .contentView()
        .ok_or_else(|| WebviewRuntimeError::Internal("popup window has no content view".into()))?;
    let host_view = AppKitViewHandle::new(content_view);

    let window_for_title = window.clone();
    let builder = WebViewBuilder::new()
        // WebKit requires the returned web view to adopt the configuration
        // it handed the delegate (shared data store, preferences, cookies).
        .with_webview_configuration(features.opener.target_configuration)
        .with_document_title_changed_handler(move |title| {
            window_for_title.setTitle(&NSString::from_str(&title));
        })
        .with_download_started_handler(|_, _| true)
        .with_download_completed_handler(|_, _, _| {})
        .with_devtools(devtools)
        .with_transparent(true)
        // Popups are plain webviews: no bridge policy, no ipc surface, no
        // initial content of their own — WebKit loads the navigation
        // request into the returned view. Nested new-window intents route
        // through the same handler, so popups of popups stay owned by the
        // same session.
        .with_new_window_req_handler(new_window_handler(ledger, owner, devtools))
        .with_bounds(WryRect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(width, height).into(),
        });
    let webview = Box::new(
        builder
            .build_as_child(&host_view)
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?,
    );

    window.makeKeyAndOrderFront(None);
    // Accessory apps do not reliably surface new windows with key-ordering
    // alone (same carrier law as the main window session).
    window.orderFrontRegardless();

    // Retain the WKWebView before the wry handle moves into the ledger;
    // WebKit needs the returned view alive, and the shared retain guarantees
    // that independently of the ledger entry's lifetime.
    let wk_webview = webview.webview();
    let popup_id = format!("popup-{:p}", window.as_ref() as &NSWindow);
    ledger.borrow_mut().record(
        owner,
        popup_id,
        PopupWindow {
            _webview: webview,
            window,
        },
    );
    // SAFETY: `WryWebView` subclasses `WKWebView`, so the cast only erases
    // the subclass type of an already-retained object.
    Ok(unsafe { Retained::cast_unchecked(wk_webview) })
}
