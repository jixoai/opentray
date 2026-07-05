use std::{
    cell::RefCell,
    collections::HashMap,
    ffi::c_void,
    path::{Path, PathBuf},
    ptr,
    rc::{Rc, Weak},
};

use dirs::download_dir;
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    AnyThread, DeclaredClass, MainThreadMarker,
};
use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
use objc2_foundation::{
    ns_string, NSCopying, NSDictionary, NSKeyValueChangeKey, NSKeyValueObservingOptions,
    NSObjectNSKeyValueObserverRegistration, NSObjectProtocol, NSProgress, NSProgressReporting,
    NSString, NSURL,
};
use objc2_web_kit::{
    WKDownload, WKDownloadDelegate, WKNavigation, WKNavigationAction, WKNavigationActionPolicy,
    WKNavigationDelegate, WKNavigationResponse, WKNavigationResponsePolicy, WKWebView,
};
use serde_json::json;
use wry::{WebView, WebViewExtMacOS};

use crate::{
    WebviewBrowserPermissionDecision, WebviewBrowserPermissionFamily, WebviewRuntimeError,
};

use super::{
    policy::resolve_browser_permission_decision, queue_window_event, NavigatorWindowBridge,
};

#[derive(Clone)]
struct DownloadMetadata {
    url: String,
    filename: String,
    suggested_filename: Option<String>,
}

pub(super) fn install_download_navigation_delegate(
    webview: &WebView,
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<Retained<DownloadNavigationDelegate>, WebviewRuntimeError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        WebviewRuntimeError::Unsupported("webview runtime requires the main thread".into())
    })?;
    let wry_webview = webview.webview();
    let original_delegate = unsafe { wry_webview.navigationDelegate() }.ok_or_else(|| {
        WebviewRuntimeError::Internal("wkwebview navigation delegate is missing".into())
    })?;
    let download_delegate = DownloadEventDelegate::new(Rc::downgrade(bridge), mtm);
    let navigation_delegate =
        DownloadNavigationDelegate::new(original_delegate, download_delegate, mtm);
    let delegate_proto = ProtocolObject::from_ref(&*navigation_delegate);
    unsafe {
        wry_webview.setNavigationDelegate(Some(delegate_proto));
    }
    Ok(navigation_delegate)
}

pub(super) struct DownloadNavigationDelegateIvars {
    original: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
    download_delegate: Retained<DownloadEventDelegate>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[ivars = DownloadNavigationDelegateIvars]
    pub(super) struct DownloadNavigationDelegate;

    unsafe impl NSObjectProtocol for DownloadNavigationDelegate {}

    unsafe impl WKNavigationDelegate for DownloadNavigationDelegate {
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
            _webview: &WKWebView,
            _action: &WKNavigationAction,
            download: &WKDownload,
        ) {
            let delegate_proto = ProtocolObject::from_ref(&*self.ivars().download_delegate);
            unsafe {
                download.setDelegate(Some(delegate_proto));
            }
        }

        #[unsafe(method(webView:navigationResponse:didBecomeDownload:))]
        fn navigation_download_response(
            &self,
            _webview: &WKWebView,
            _response: &WKNavigationResponse,
            download: &WKDownload,
        ) {
            let delegate_proto = ProtocolObject::from_ref(&*self.ivars().download_delegate);
            unsafe {
                download.setDelegate(Some(delegate_proto));
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
    }
);

impl DownloadNavigationDelegate {
    fn new(
        original: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
        download_delegate: Retained<DownloadEventDelegate>,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        let delegate =
            mtm.alloc::<DownloadNavigationDelegate>()
                .set_ivars(DownloadNavigationDelegateIvars {
                    original,
                    download_delegate,
                });
        unsafe { msg_send![super(delegate), init] }
    }
}

struct DownloadEventDelegateIvars {
    bridge: Weak<RefCell<NavigatorWindowBridge>>,
    metadata: RefCell<HashMap<usize, DownloadMetadata>>,
    observers: RefCell<HashMap<usize, Vec<Retained<DownloadProgressObserver>>>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[ivars = DownloadEventDelegateIvars]
    struct DownloadEventDelegate;

    unsafe impl NSObjectProtocol for DownloadEventDelegate {}

    unsafe impl WKDownloadDelegate for DownloadEventDelegate {
        #[unsafe(method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:))]
        fn download_policy(
            &self,
            download: &WKDownload,
            _response: &objc2_foundation::NSURLResponse,
            suggested_filename: &NSString,
            handler: &block2::Block<dyn Fn(*const NSURL)>,
        ) {
            match self.resolve_destination(download, &suggested_filename.to_string()) {
                Some(path) => {
                    let path = NSString::from_str(&path.display().to_string());
                    let ns_url = NSURL::fileURLWithPath_isDirectory(&path, false);
                    (*handler).call((Retained::as_ptr(&ns_url),));
                }
                None => {
                    (*handler).call((ptr::null_mut(),));
                }
            }
        }

        #[unsafe(method(downloadDidFinish:))]
        fn download_did_finish(&self, download: &WKDownload) {
            let key = download_key(download);
            self.detach_progress_observers(key);
            let metadata = self
                .ivars()
                .metadata
                .borrow_mut()
                .remove(&key)
                .unwrap_or_else(|| fallback_download_metadata(download));
            emit_download_event(
                &self.ivars().bridge,
                "downloadcompleted",
                json!({
                    "url": metadata.url,
                    "filename": metadata.filename,
                    "suggestedFilename": metadata.suggested_filename.as_deref(),
                    "success": true,
                }),
            );
        }

        #[unsafe(method(download:didFailWithError:resumeData:))]
        fn download_did_fail(
            &self,
            download: &WKDownload,
            _error: &objc2_foundation::NSError,
            _resume_data: Option<&objc2_foundation::NSData>,
        ) {
            let key = download_key(download);
            self.detach_progress_observers(key);
            let metadata = self
                .ivars()
                .metadata
                .borrow_mut()
                .remove(&key)
                .unwrap_or_else(|| fallback_download_metadata(download));
            emit_download_event(
                &self.ivars().bridge,
                "downloadfailed",
                json!({
                    "url": metadata.url,
                    "filename": metadata.filename,
                    "suggestedFilename": metadata.suggested_filename.as_deref(),
                }),
            );
        }
    }
);

impl DownloadEventDelegate {
    fn new(bridge: Weak<RefCell<NavigatorWindowBridge>>, mtm: MainThreadMarker) -> Retained<Self> {
        let delegate = mtm
            .alloc::<DownloadEventDelegate>()
            .set_ivars(DownloadEventDelegateIvars {
                bridge,
                metadata: RefCell::new(HashMap::new()),
                observers: RefCell::new(HashMap::new()),
            });
        unsafe { msg_send![super(delegate), init] }
    }

    fn resolve_destination(
        &self,
        download: &WKDownload,
        suggested_filename: &str,
    ) -> Option<PathBuf> {
        let Some(bridge) = self.ivars().bridge.upgrade() else {
            return None;
        };
        let metadata = fallback_download_metadata_with_filename(download, suggested_filename);
        let (decision, save_as) = {
            let state = bridge.borrow();
            let decision = if !state.download.enabled {
                WebviewBrowserPermissionDecision::Deny
            } else {
                resolve_browser_permission_decision(
                    &state.browser_permission_policy,
                    WebviewBrowserPermissionFamily::MultipleDownloads,
                    &state.page_source,
                )
            };
            (decision, state.download.save_as)
        };
        match decision {
            WebviewBrowserPermissionDecision::Allow => {}
            WebviewBrowserPermissionDecision::Deny => {
                emit_download_event(
                    &self.ivars().bridge,
                    "downloadfailed",
                    json!({
                        "url": metadata.url,
                        "filename": metadata.filename,
                        "suggestedFilename": metadata.suggested_filename.as_deref(),
                    }),
                );
                return None;
            }
            WebviewBrowserPermissionDecision::Prompt => {
                // The download change must not invent a parallel prompt surface while
                // the carrier-owned permission substrate is still absent here.
                emit_download_event(
                    &self.ivars().bridge,
                    "downloadfailed",
                    json!({
                        "url": metadata.url,
                        "filename": metadata.filename,
                        "suggestedFilename": metadata.suggested_filename.as_deref(),
                    }),
                );
                return None;
            }
        }

        let destination = if save_as {
            match prompt_save_as_path(&metadata.filename) {
                Some(path) => path,
                None => {
                    emit_download_event(
                        &self.ivars().bridge,
                        "downloadcanceled",
                        json!({
                            "url": metadata.url,
                            "filename": metadata.filename,
                            "suggestedFilename": metadata.suggested_filename.as_deref(),
                        }),
                    );
                    return None;
                }
            }
        } else {
            default_download_path(&metadata.filename)
        };

        // Preserve the substrate suggestion even when the final save target is deduplicated.
        let final_metadata = DownloadMetadata {
            url: metadata.url,
            filename: basename(&destination).unwrap_or(metadata.filename),
            suggested_filename: metadata.suggested_filename,
        };
        let key = download_key(download);
        self.ivars()
            .metadata
            .borrow_mut()
            .insert(key, final_metadata.clone());
        self.attach_progress_observers(download, key, &final_metadata);
        emit_download_event(
            &self.ivars().bridge,
            "downloadstarted",
            json!({
                "url": final_metadata.url,
                "filename": final_metadata.filename,
                "suggestedFilename": final_metadata.suggested_filename.as_deref(),
            }),
        );
        Some(destination)
    }

    fn attach_progress_observers(
        &self,
        download: &WKDownload,
        key: usize,
        metadata: &DownloadMetadata,
    ) {
        let progress = download.progress();
        let observers = [
            DownloadProgressObserver::new(
                progress.clone(),
                ns_string!("completedUnitCount"),
                self.ivars().bridge.clone(),
                metadata.clone(),
            ),
            DownloadProgressObserver::new(
                progress,
                ns_string!("totalUnitCount"),
                self.ivars().bridge.clone(),
                metadata.clone(),
            ),
        ];
        self.ivars()
            .observers
            .borrow_mut()
            .insert(key, observers.into_iter().collect());
    }

    fn detach_progress_observers(&self, key: usize) {
        self.ivars().observers.borrow_mut().remove(&key);
    }
}

struct DownloadProgressObserverIvars {
    progress: Retained<NSProgress>,
    key_path: Retained<NSString>,
    bridge: Weak<RefCell<NavigatorWindowBridge>>,
    metadata: DownloadMetadata,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = DownloadProgressObserverIvars]
    struct DownloadProgressObserver;

    impl DownloadProgressObserver {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe_value(
            &self,
            _key_path: Option<&NSString>,
            _object: Option<&AnyObject>,
            _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>,
            _context: *mut c_void,
        ) {
            let completed = self.ivars().progress.completedUnitCount();
            let total = self.ivars().progress.totalUnitCount();
            emit_download_event(
                &self.ivars().bridge,
                "downloadprogress",
                json!({
                    "url": self.ivars().metadata.url,
                    "filename": self.ivars().metadata.filename,
                    "suggestedFilename": self.ivars().metadata.suggested_filename.as_deref(),
                    "receivedBytes": completed.max(0),
                    "totalBytes": if total > 0 { Some(total) } else { None },
                }),
            );
        }
    }

    unsafe impl NSObjectProtocol for DownloadProgressObserver {}
);

impl DownloadProgressObserver {
    fn new(
        progress: Retained<NSProgress>,
        key_path: &NSString,
        bridge: Weak<RefCell<NavigatorWindowBridge>>,
        metadata: DownloadMetadata,
    ) -> Retained<Self> {
        let observer = Self::alloc().set_ivars(DownloadProgressObserverIvars {
            progress,
            key_path: key_path.copy(),
            bridge,
            metadata,
        });
        let observer: Retained<Self> = unsafe { msg_send![super(observer), init] };
        unsafe {
            observer
                .ivars()
                .progress
                .addObserver_forKeyPath_options_context(
                    &observer,
                    key_path,
                    NSKeyValueObservingOptions::New,
                    ptr::null_mut(),
                );
        }
        observer
    }
}

impl Drop for DownloadProgressObserver {
    fn drop(&mut self) {
        unsafe {
            self.ivars()
                .progress
                .removeObserver_forKeyPath(&self, &self.ivars().key_path);
        }
    }
}

fn emit_download_event(
    bridge: &Weak<RefCell<NavigatorWindowBridge>>,
    event: &str,
    payload: serde_json::Value,
) {
    queue_window_event(bridge, event, payload);
}

fn download_key(download: &WKDownload) -> usize {
    download as *const WKDownload as usize
}

fn fallback_download_metadata(download: &WKDownload) -> DownloadMetadata {
    download_metadata_from_fallback(download, None)
}

fn fallback_download_metadata_with_filename(
    download: &WKDownload,
    suggested_filename: &str,
) -> DownloadMetadata {
    download_metadata_from_fallback(download, Some(suggested_filename))
}

fn download_metadata_from_fallback(
    download: &WKDownload,
    suggested_filename: Option<&str>,
) -> DownloadMetadata {
    let url = unsafe {
        download
            .originalRequest()
            .and_then(|request| request.URL())
            .and_then(|url| url.absoluteString())
            .map(|url| url.to_string())
            .unwrap_or_default()
    };
    download_metadata_from_parts(&url, suggested_filename, None)
}

fn download_metadata_from_parts(
    url: &str,
    suggested_filename: Option<&str>,
    final_filename: Option<&str>,
) -> DownloadMetadata {
    let suggested_filename = suggested_filename
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let filename = final_filename
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| suggested_filename.clone())
        .or_else(|| {
            url.rsplit('/')
                .next()
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "download".to_string());
    DownloadMetadata {
        url: url.to_string(),
        filename,
        suggested_filename,
    }
}

fn prompt_save_as_path(suggested_filename: &str) -> Option<PathBuf> {
    let mtm = MainThreadMarker::new()?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setNameFieldStringValue(&NSString::from_str(suggested_filename));
    if let Some(default_dir) = download_dir() {
        let directory = NSString::from_str(&default_dir.display().to_string());
        let directory_url = NSURL::fileURLWithPath_isDirectory(&directory, true);
        panel.setDirectoryURL(Some(&directory_url));
    }
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    let url = panel.URL()?;
    let path = url.path()?;
    Some(PathBuf::from(path.to_string()))
}

fn default_download_path(suggested_filename: &str) -> PathBuf {
    let mut destination =
        download_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    destination.push(suggested_filename);
    dedupe_destination(destination)
}

fn dedupe_destination(mut destination: PathBuf) -> PathBuf {
    let base_name = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download")
        .to_string();
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let mut counter = 1;
    while destination.exists() {
        destination.set_file_name(format!("{base_name} ({counter}){extension}"));
        counter += 1;
    }
    destination
}

fn basename(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{dedupe_destination, download_metadata_from_parts};
    use std::fs::{create_dir_all, remove_dir_all, write};
    use std::path::PathBuf;

    #[test]
    fn macos_default_download_path_deduplicates_existing_filename() {
        let base_dir = std::env::temp_dir().join(format!(
            "opentray-download-dedupe-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("epoch")
                .as_nanos()
        ));
        create_dir_all(&base_dir).expect("create temp dir");
        let original = base_dir.join("report.json");
        write(&original, "{}").expect("seed original file");

        let deduped = dedupe_destination(PathBuf::from(&original));
        assert_eq!(deduped, base_dir.join("report (1).json"));

        remove_dir_all(&base_dir).expect("remove temp dir");
    }

    #[test]
    fn download_metadata_preserves_suggested_filename_separately_from_final_filename() {
        let metadata = download_metadata_from_parts(
            "blob:http://127.0.0.1/export",
            Some("backup.json"),
            Some("backup (6).json"),
        );

        assert_eq!(metadata.filename, "backup (6).json");
        assert_eq!(metadata.suggested_filename.as_deref(), Some("backup.json"));
    }

    #[test]
    fn download_metadata_uses_null_suggestion_when_fallback_is_synthetic() {
        let metadata =
            download_metadata_from_parts("https://tools.example/export/report.json", None, None);

        assert_eq!(metadata.filename, "report.json");
        assert_eq!(metadata.suggested_filename, None);
    }
}
