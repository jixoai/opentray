use std::{cell::RefCell, io::Cursor, rc::Rc};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use objc2::{rc::Retained, AnyThread};
use objc2_app_kit::{NSImage, NSWindow};
use objc2_foundation::{NSData, NSString, NSURL};
use png::Encoder;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{WebviewRuntimeError, WebviewWindowIcon};

use super::{
    bridge::{emit_window_event, evaluate_bridge_script},
    NavigatorWindowBridge, WINDOW_INTERNALS_GLOBAL,
};

pub(super) const DEFAULT_WINDOW_TITLE: &str = "OpenTray WebView";

#[derive(Debug, Clone)]
pub(super) struct WindowMetadataState {
    pub(super) title: String,
    pub(super) icon: Option<WebviewWindowIcon>,
    pub(super) sync_title: crate::MetadataSyncSettings,
    pub(super) sync_icon: crate::MetadataSyncSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MetadataSource {
    Native,
    Page,
}

#[derive(Debug, Deserialize)]
pub(super) struct PageIconChangedPayload {
    pub(super) href: Option<String>,
}

pub(super) fn handle_document_title_changed(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    title: String,
) {
    let state = bridge.borrow();
    if !state.metadata.sync_title.page_to_native || !state.page_access.title_sync {
        return;
    }
    drop(state);
    if let Err(error) = update_window_title(bridge, window, title, MetadataSource::Page) {
        eprintln!("opentray-ext-webview title sync failed: {error}");
    }
}

pub(super) fn update_window_title(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    title: String,
    source: MetadataSource,
) -> Result<Value, WebviewRuntimeError> {
    let should_sync_to_page = {
        let mut state = bridge.borrow_mut();
        if state.metadata.title == title {
            return Ok(Value::String(title));
        }
        state.metadata.title = title.clone();
        source == MetadataSource::Native
            && state.metadata.sync_title.native_to_page
            && state.page_access.title_sync
    };
    // This stays window-scoped on purpose. A runtime host can own multiple extension windows,
    // so projecting one WebView title into NSApplication/Dock identity would make one window
    // mutate app-level state for every sibling projection.
    window.setTitle(&NSString::from_str(&title));
    if should_sync_to_page {
        sync_title_to_page(bridge, &title)?;
    }
    emit_window_event(bridge, "titlechange", json!({ "title": title.clone() }))?;
    Ok(Value::String(title))
}

pub(super) fn update_window_icon(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
    icon: Option<WebviewWindowIcon>,
    source: MetadataSource,
) -> Result<Value, WebviewRuntimeError> {
    let should_sync_to_page = {
        let mut state = bridge.borrow_mut();
        if state.metadata.icon == icon {
            return icon_json(state.metadata.icon.as_ref());
        }
        state.metadata.icon = icon.clone();
        source == MetadataSource::Native
            && state.metadata.sync_icon.native_to_page
            && state.page_access.icon_sync
    };
    apply_window_icon(window, icon.as_ref())?;
    if should_sync_to_page {
        sync_icon_to_page(bridge)?;
    }
    emit_window_event(bridge, "iconchange", icon_event_payload(icon.as_ref())?)?;
    icon_json(icon.as_ref())
}

pub(super) fn apply_window_icon_from_bridge(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> Result<(), WebviewRuntimeError> {
    let icon = bridge.borrow().metadata.icon.clone();
    apply_window_icon(window, icon.as_ref())
}

fn apply_window_icon(
    window: &Retained<NSWindow>,
    icon: Option<&WebviewWindowIcon>,
) -> Result<(), WebviewRuntimeError> {
    let native_icon = match icon {
        Some(icon) => project_native_window_icon(icon)?,
        None => None,
    };
    // ext-webview only owns window-level icon projection. Do not escalate this into Dock or
    // NSApplication icon mutation: that is host/app state, not per-window state. A future
    // Dock-visible web application should use a dedicated runtime atom, similar to ext-lynx.
    window.setMiniwindowImage(native_icon.as_deref());
    Ok(())
}

fn project_native_window_icon(
    icon: &WebviewWindowIcon,
) -> Result<Option<Retained<NSImage>>, WebviewRuntimeError> {
    match icon {
        WebviewWindowIcon::Encoded { data } => Ok(ns_image_from_bytes(data)),
        WebviewWindowIcon::Rgba {
            data,
            width,
            height,
        } => Ok(ns_image_from_bytes(&encode_rgba_png(
            data, *width, *height,
        )?)),
        WebviewWindowIcon::File { path } => {
            let file = NSString::from_str(path);
            Ok(NSImage::initWithContentsOfFile(NSImage::alloc(), &file))
        }
        WebviewWindowIcon::Href { href } => {
            if let Some(bytes) = decode_data_url_image_bytes(href) {
                return Ok(ns_image_from_bytes(&bytes));
            }
            if href.starts_with("file://") {
                let url = NSURL::URLWithString(&NSString::from_str(href));
                return Ok(
                    url.and_then(|url| NSImage::initWithContentsOfURL(NSImage::alloc(), &url))
                );
            }
            Ok(None)
        }
    }
}

fn ns_image_from_bytes(bytes: &[u8]) -> Option<Retained<NSImage>> {
    let data = NSData::from_vec(bytes.to_vec());
    NSImage::initWithData(NSImage::alloc(), &data)
}

fn encode_rgba_png(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, WebviewRuntimeError> {
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| WebviewRuntimeError::Rejected("rgba icon dimensions overflow".into()))?;
    if data.len() != expected_len {
        return Err(WebviewRuntimeError::Rejected(format!(
            "rgba icon requires {expected_len} bytes for {width}x{height}, got {}",
            data.len()
        )));
    }
    let mut output = Vec::new();
    let mut encoder = Encoder::new(Cursor::new(&mut output), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    writer
        .write_image_data(data)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    drop(writer);
    Ok(output)
}

fn decode_data_url_image_bytes(href: &str) -> Option<Vec<u8>> {
    let (_, encoded) = href.split_once(",")?;
    if !href.starts_with("data:image/") {
        return None;
    }
    BASE64_STANDARD.decode(encoded).ok()
}

pub(super) fn sync_native_metadata_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let (title, sync_title, sync_icon) = {
        let state = bridge.borrow();
        (
            state.metadata.title.clone(),
            state.metadata.sync_title.native_to_page && state.page_access.title_sync,
            state.metadata.sync_icon.native_to_page && state.page_access.icon_sync,
        )
    };
    if sync_title {
        sync_title_to_page(bridge, &title)?;
    }
    if sync_icon {
        sync_icon_to_page(bridge)?;
    }
    Ok(())
}

fn sync_title_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    title: &str,
) -> Result<(), WebviewRuntimeError> {
    let title_json = serde_json::to_string(title)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    evaluate_bridge_script(
        bridge,
        format!("{WINDOW_INTERNALS_GLOBAL}.setDocumentTitle({title_json});"),
    )
}

fn sync_icon_to_page(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
) -> Result<(), WebviewRuntimeError> {
    let href = bridge
        .borrow()
        .metadata
        .icon
        .as_ref()
        .and_then(window_icon_href_for_page);
    let href_json = serde_json::to_string(&href)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    evaluate_bridge_script(
        bridge,
        format!("{WINDOW_INTERNALS_GLOBAL}.setPageIconHref({href_json});"),
    )
}

fn window_icon_href_for_page(icon: &WebviewWindowIcon) -> Option<String> {
    match icon {
        WebviewWindowIcon::Href { href } => Some(href.clone()),
        WebviewWindowIcon::File { path } => Some(format!("file://{path}")),
        WebviewWindowIcon::Encoded { data } => Some(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(data)
        )),
        WebviewWindowIcon::Rgba {
            data,
            width,
            height,
        } => encode_rgba_png(data, *width, *height)
            .ok()
            .map(|bytes| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes))),
    }
}

pub(super) fn icon_json(icon: Option<&WebviewWindowIcon>) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(icon).map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

pub(super) fn icon_event_payload(
    icon: Option<&WebviewWindowIcon>,
) -> Result<Value, WebviewRuntimeError> {
    Ok(json!({ "icon": icon_json(icon)? }))
}
