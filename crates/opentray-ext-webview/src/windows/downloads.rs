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
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON,
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
                                    "suggestedFilename": metadata.suggested_filename.as_deref(),
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
                            "suggestedFilename": metadata.suggested_filename.as_deref(),
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
    suggested_filename: Option<String>,
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
                        "suggestedFilename": progress_metadata.suggested_filename.as_deref(),
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
                let mut state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
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
                            "suggestedFilename": state_metadata.suggested_filename.as_deref(),
                            "success": true,
                        }),
                    );
                    return Ok(());
                }
                let mut interrupt_reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
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
                        "suggestedFilename": state_metadata.suggested_filename.as_deref(),
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
    let suggested_filename = download_suggested_filename(operation)?;
    Ok(DownloadMetadata {
        url,
        filename,
        suggested_filename,
    })
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

fn download_suggested_filename(
    operation: &ICoreWebView2DownloadOperation,
) -> windows::core::Result<Option<String>> {
    let mut disposition = PWSTR::null();
    unsafe {
        operation.ContentDisposition(&mut disposition)?;
    }
    // WebView2 does not expose a dedicated suggested-file-name API in this hook, so stay honest:
    // only surface `suggestedFilename` when the substrate gives a distinct source fact.
    Ok(parse_content_disposition_filename(&take_pwstr(disposition)))
}

fn parse_content_disposition_filename(disposition: &str) -> Option<String> {
    let mut suggested_filename = None;
    let mut plain_filename = None;
    for parameter in disposition.split(';').skip(1) {
        let Some((name, raw_value)) = parameter.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let value = raw_value.trim();
        if name.eq_ignore_ascii_case("filename*") {
            suggested_filename = decode_rfc5987_filename(value);
            if suggested_filename.is_some() {
                break;
            }
            continue;
        }
        if name.eq_ignore_ascii_case("filename") && plain_filename.is_none() {
            plain_filename = decode_quoted_header_value(value);
        }
    }
    suggested_filename
        .or(plain_filename)
        .filter(|value| !value.is_empty())
}

fn decode_rfc5987_filename(value: &str) -> Option<String> {
    let value = strip_optional_quotes(value);
    let (_, encoded_value) = value.split_once("''")?;
    let decoded_bytes = percent_decode_bytes(encoded_value)?;
    String::from_utf8(decoded_bytes).ok()
}

fn decode_quoted_header_value(value: &str) -> Option<String> {
    let value = strip_optional_quotes(value);
    let mut decoded = String::with_capacity(value.len());
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            decoded.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        decoded.push(ch);
    }
    Some(decoded)
}

fn strip_optional_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|trimmed| trimmed.strip_suffix('"'))
        .unwrap_or(value)
}

fn percent_decode_bytes(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push((hex_value(high)? << 4) | hex_value(low)?);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    Some(decoded)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(10 + (value - b'a')),
        b'A'..=b'F' => Some(10 + (value - b'A')),
        _ => None,
    }
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

#[cfg(test)]
mod tests {
    use super::parse_content_disposition_filename;

    #[test]
    fn parses_plain_filename_from_content_disposition() {
        let filename = parse_content_disposition_filename(r#"attachment; filename="backup.json""#);

        assert_eq!(filename.as_deref(), Some("backup.json"));
    }

    #[test]
    fn prefers_rfc5987_filename_over_plain_filename() {
        let filename = parse_content_disposition_filename(
            "attachment; filename=\"backup.json\"; filename*=UTF-8''backup%20final.json",
        );

        assert_eq!(filename.as_deref(), Some("backup final.json"));
    }

    #[test]
    fn returns_none_when_content_disposition_has_no_filename() {
        let filename = parse_content_disposition_filename("attachment");

        assert_eq!(filename, None);
    }
}
