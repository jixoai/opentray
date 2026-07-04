use std::{
    cell::RefCell,
    path::PathBuf,
    rc::{Rc, Weak},
};

use serde_json::json;
use webview2_com::{
    take_pwstr, BytesReceivedChangedEventHandler, DownloadStartingEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2DownloadOperation, ICoreWebView2DownloadStartingEventArgs, ICoreWebView2_4,
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED,
        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED, COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS,
    },
    StateChangedEventHandler,
};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::{WebView, WebViewExtWindows};

use crate::{
    WebviewBrowserPermissionDecision, WebviewBrowserPermissionFamily, WebviewRuntimeError,
};

use super::{emit_window_event, resolve_browser_permission_decision, NavigatorWindowBridge};

pub(super) fn install_download_handlers(
    webview: &WebView,
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let webview4: ICoreWebView2_4 = webview
        .webview()
        .cast()
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    let bridge = Rc::downgrade(bridge);
    let mut token = 0i64;
    unsafe {
        webview4
            .add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let operation = args.DownloadOperation()?;
                    let metadata = download_metadata(&operation, &args)?;
                    let Some(bridge_ref) = bridge.upgrade() else {
                        return Ok(());
                    };
                    let (decision, save_as) = {
                        let state = bridge_ref.borrow();
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
                        WebviewBrowserPermissionDecision::Deny
                        | WebviewBrowserPermissionDecision::Prompt => {
                            args.SetCancel(true)?;
                            emit_download_event(
                                &bridge,
                                "downloadfailed",
                                json!({
                                    "url": metadata.url,
                                    "filename": metadata.filename,
                                }),
                            );
                            return Ok(());
                        }
                    }

                    attach_progress_handlers(&operation, &bridge, &metadata)?;
                    if !save_as {
                        let result_file_path = HSTRING::from(args_result_file_path(&args)?);
                        args.SetResultFilePath(&result_file_path)?;
                        args.SetHandled(true)?;
                    }
                    emit_download_event(
                        &bridge,
                        "downloadstarted",
                        json!({
                            "url": metadata.url,
                            "filename": metadata.filename,
                        }),
                    );
                    Ok(())
                })),
                &mut token,
            )
            .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    Ok(())
}

#[derive(Clone)]
struct DownloadMetadata {
    url: String,
    filename: String,
}

fn attach_progress_handlers(
    operation: &ICoreWebView2DownloadOperation,
    bridge: &Weak<RefCell<NavigatorWindowBridge>>,
    metadata: &DownloadMetadata,
) -> windows::core::Result<()> {
    let progress_bridge = bridge.clone();
    let progress_metadata = metadata.clone();
    let mut progress_token = 0i64;
    unsafe {
        operation.add_BytesReceivedChanged(
            &BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                let Some(operation) = operation else {
                    return Ok(());
                };
                let mut received = 0i64;
                let mut total = 0i64;
                operation.BytesReceived(&mut received)?;
                operation.TotalBytesToReceive(&mut total)?;
                emit_download_event(
                    &progress_bridge,
                    "downloadprogress",
                    json!({
                        "url": progress_metadata.url,
                        "filename": progress_metadata.filename,
                        "receivedBytes": received.max(0),
                        "totalBytes": if total > 0 { Some(total) } else { None },
                    }),
                );
                Ok(())
            })),
            &mut progress_token,
        )?;
    }

    let state_bridge = bridge.clone();
    let state_metadata = metadata.clone();
    let mut state_token = 0i64;
    unsafe {
        operation.add_StateChanged(
            &StateChangedEventHandler::create(Box::new(move |operation, _| {
                let Some(operation) = operation else {
                    return Ok(());
                };
                let mut state = 0i32;
                operation.State(&mut state)?;
                if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                    return Ok(());
                }
                if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                    emit_download_event(
                        &state_bridge,
                        "downloadcompleted",
                        json!({
                            "url": state_metadata.url,
                            "filename": state_metadata.filename,
                            "success": true,
                        }),
                    );
                    return Ok(());
                }
                let mut interrupt_reason = 0i32;
                operation.InterruptReason(&mut interrupt_reason)?;
                let event =
                    if interrupt_reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                        "downloadcanceled"
                    } else {
                        "downloadfailed"
                    };
                emit_download_event(
                    &state_bridge,
                    event,
                    json!({
                        "url": state_metadata.url,
                        "filename": state_metadata.filename,
                    }),
                );
                Ok(())
            })),
            &mut state_token,
        )?;
    }
    Ok(())
}

fn download_metadata(
    operation: &ICoreWebView2DownloadOperation,
    args: &ICoreWebView2DownloadStartingEventArgs,
) -> windows::core::Result<DownloadMetadata> {
    let mut uri = PWSTR::null();
    unsafe {
        operation.Uri(&mut uri)?;
    }
    let url = take_pwstr(uri);
    let result_file_path = args_result_file_path(args)?;
    let filename = PathBuf::from(&result_file_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "download".to_string());
    Ok(DownloadMetadata { url, filename })
}

fn args_result_file_path(
    args: &ICoreWebView2DownloadStartingEventArgs,
) -> windows::core::Result<String> {
    let mut path = PWSTR::null();
    unsafe {
        args.ResultFilePath(&mut path)?;
    }
    Ok(take_pwstr(path))
}

fn emit_download_event(
    bridge: &Weak<RefCell<NavigatorWindowBridge>>,
    event: &str,
    payload: serde_json::Value,
) {
    let Some(bridge) = bridge.upgrade() else {
        return;
    };
    if let Err(error) = emit_window_event(bridge.as_ref(), event, payload) {
        eprintln!("opentray-ext-webview failed to emit Windows {event} event: {error}");
    }
}
