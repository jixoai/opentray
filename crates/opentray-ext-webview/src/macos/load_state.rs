//! D24 `loadState` native observation for one webview.
//!
//! wry's `on_page_load` covers the `started` (commit) and `finished`
//! (didFinishNavigation) phases, but WebKit reports load failures only
//! through `WKNavigationDelegate` — wry implements neither `didFail*` method,
//! and progress is only observable through `WKWebView.estimatedProgress`
//! KVO. This module installs one outermost navigation-delegate wrapper per
//! webview (the same native-penetration pattern as the download delegate in
//! `downloads.rs`): every method the wrapped delegate implements is
//! forwarded unchanged, the two failure callbacks are owned here, and the
//! delegate doubles as the estimatedProgress KVO observer so intermediate
//! progress frames push straight into the D19 event outbox — never through
//! the 16 ms window-event drain.

use std::{
    cell::RefCell,
    collections::VecDeque,
    ffi::c_void,
    ptr,
    rc::{Rc, Weak},
};

use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    DeclaredClass, MainThreadMarker,
};
use objc2_foundation::{
    ns_string, NSDictionary, NSKeyValueChangeKey, NSKeyValueObservingOptions,
    NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSString,
};
use objc2_web_kit::{
    WKDownload, WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKNavigationResponse, WKNavigationResponsePolicy, WKWebView,
};
use opentray_spec::webview::{WebviewEventFrame, WebviewLoadPhase};

use crate::WebviewRuntimeError;
use wry::{WebView, WebViewExtMacOS};

use crate::orchestration::{ViewEvents, WindowOwner};

pub(super) struct LoadStateNavigationDelegateIvars {
    original: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
    webview: Retained<WKWebView>,
    events: Weak<RefCell<ViewEvents>>,
    outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>,
    owner: WindowOwner,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[ivars = LoadStateNavigationDelegateIvars]
    pub(super) struct LoadStateNavigationDelegate;

    unsafe impl NSObjectProtocol for LoadStateNavigationDelegate {}

    unsafe impl WKNavigationDelegate for LoadStateNavigationDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn navigation_policy(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            handler: &block2::Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    decidePolicyForNavigationAction: action,
                    decisionHandler: handler
                ];
            }
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn navigation_policy_response(
            &self,
            webview: &WKWebView,
            response: &WKNavigationResponse,
            handler: &block2::Block<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    decidePolicyForNavigationResponse: response,
                    decisionHandler: handler
                ];
            }
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish_navigation(&self, webview: &WKWebView, navigation: &WKNavigation) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    didFinishNavigation: navigation
                ];
            }
        }

        #[unsafe(method(webView:didCommitNavigation:))]
        fn did_commit_navigation(&self, webview: &WKWebView, navigation: &WKNavigation) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    didCommitNavigation: navigation
                ];
            }
        }

        #[unsafe(method(webView:navigationAction:didBecomeDownload:))]
        fn navigation_download_action(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            download: &WKDownload,
        ) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    navigationAction: action,
                    didBecomeDownload: download
                ];
            }
        }

        #[unsafe(method(webView:navigationResponse:didBecomeDownload:))]
        fn navigation_download_response(
            &self,
            webview: &WKWebView,
            response: &WKNavigationResponse,
            download: &WKDownload,
        ) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webView: webview,
                    navigationResponse: response,
                    didBecomeDownload: download
                ];
            }
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn web_content_process_did_terminate(&self, webview: &WKWebView) {
            unsafe {
                let _: () = msg_send![
                    &*self.ivars().original,
                    webViewWebContentProcessDidTerminate: webview
                ];
            }
        }

        // Failure paths are owned here: neither wry's delegate nor the
        // download wrapper implements them, so there is nothing to forward
        // to — the loadState failure frame is this delegate's observation.
        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail_navigation(
            &self,
            webview: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &objc2_foundation::NSError,
        ) {
            self.emit_failed(webview, error);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional_navigation(
            &self,
            webview: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &objc2_foundation::NSError,
        ) {
            self.emit_failed(webview, error);
        }
    }

    impl LoadStateNavigationDelegate {
        /// estimatedProgress KVO callback: pushes an in-flight progress frame
        /// through the ViewEvents throttle (gated on `load_in_flight`,
        /// ≥ 0.05 delta, strictly below 1.0).
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe_value(
            &self,
            key_path: Option<&NSString>,
            _object: Option<&AnyObject>,
            _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>,
            _context: *mut c_void,
        ) {
            if key_path != Some(ns_string!("estimatedProgress")) {
                return;
            }
            let ivars = self.ivars();
            let Some(events) = ivars.events.upgrade() else {
                return;
            };
            let progress = unsafe { ivars.webview.estimatedProgress() };
            let url = current_webview_url(&ivars.webview, &events);
            let frame = events
                .borrow_mut()
                .note_load_progress(&ivars.owner, &ivars.owner.window_id, url, progress);
            super::push_event_frame(&ivars.outbox, frame);
        }
    }
);

impl LoadStateNavigationDelegate {
    fn new(
        original: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
        webview: Retained<WKWebView>,
        events: Weak<RefCell<ViewEvents>>,
        outbox: Weak<RefCell<VecDeque<WebviewEventFrame>>>,
        owner: WindowOwner,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        let delegate = mtm
            .alloc::<LoadStateNavigationDelegate>()
            .set_ivars(LoadStateNavigationDelegateIvars {
                original,
                webview,
                events,
                outbox,
                owner,
            });
        unsafe { msg_send![super(delegate), init] }
    }

    fn emit_failed(&self, webview: &WKWebView, error: &objc2_foundation::NSError) {
        let ivars = self.ivars();
        let Some(events) = ivars.events.upgrade() else {
            return;
        };
        let url = current_webview_url(webview, &events);
        let error_code = error.code();
        let frame = events.borrow_mut().note_load_state(
            &ivars.owner,
            &ivars.owner.window_id,
            WebviewLoadPhase::Failed,
            url,
            Some(error_code as i64),
            None,
        );
        super::push_event_frame(&ivars.outbox, frame);
    }
}

impl Drop for LoadStateNavigationDelegate {
    fn drop(&mut self) {
        // The ivars retain the observed WKWebView, so the KVO target is still
        // alive here. Ext commands and session teardown run on the main
        // thread, matching the registration thread.
        unsafe {
            self.ivars().webview.removeObserver_forKeyPath(
                self,
                ns_string!("estimatedProgress"),
            );
        }
    }
}

/// Installs the loadState wrapper as the outermost navigation delegate of
/// one webview and registers the estimatedProgress KVO observation. Must run
/// after any other delegate wrapper (downloads) so this delegate observes
/// every navigation first and forwards to the rest of the chain.
pub(super) fn install_load_state_delegate(
    webview: &WebView,
    events: &Rc<RefCell<ViewEvents>>,
    outbox: &Rc<RefCell<VecDeque<WebviewEventFrame>>>,
    owner: &WindowOwner,
) -> Result<Retained<LoadStateNavigationDelegate>, WebviewRuntimeError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
    })?;
    let wk_webview = webview.webview();
    let original_delegate = unsafe { wk_webview.navigationDelegate() }.ok_or_else(|| {
        WebviewRuntimeError::Internal("wkwebview navigation delegate is missing".into())
    })?;
    // Upcast the wry subclass to the WKWebView base type the ivars keep.
    let wk: Retained<WKWebView> = unsafe { Retained::cast_unchecked(wk_webview) };
    let delegate = LoadStateNavigationDelegate::new(
        original_delegate,
        wk.clone(),
        Rc::downgrade(events),
        Rc::downgrade(outbox),
        owner.clone(),
        mtm,
    );
    unsafe {
        wk.addObserver_forKeyPath_options_context(
            &delegate,
            ns_string!("estimatedProgress"),
            NSKeyValueObservingOptions::New,
            ptr::null_mut(),
        );
        let delegate_proto = ProtocolObject::from_ref(&*delegate);
        wk.setNavigationDelegate(Some(delegate_proto));
    }
    Ok(delegate)
}

/// Best-effort URL for a load observation: the webview's current URL when
/// non-empty, otherwise the last url tracked by the view's event state
/// (provisional failures can still report the previous document's URL).
fn current_webview_url(webview: &WKWebView, events: &Rc<RefCell<ViewEvents>>) -> String {
    let live = unsafe { webview.URL() }
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
        .unwrap_or_default();
    if !live.is_empty() {
        return live;
    }
    events.borrow().url.clone()
}
