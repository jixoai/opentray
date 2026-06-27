use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::{NSScreen, NSWindow};
use objc2_foundation::NSRect;
use opentray_spec::Rect;
use serde::Serialize;
use serde_json::Value;

use crate::WebviewRuntimeError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenDetailState {
    id: String,
    label: String,
    is_primary: bool,
    frame: Rect,
    visible_frame: Rect,
    scale_factor: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenDetailsState {
    current_screen: Option<ScreenDetailState>,
    screens: Vec<ScreenDetailState>,
    is_extended: bool,
    coordinate_origin: &'static str,
}

pub(super) fn screen_details_json(
    window: &Retained<NSWindow>,
) -> Result<Value, WebviewRuntimeError> {
    serde_json::to_value(build_screen_details(window)?)
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))
}

fn build_screen_details(
    window: &Retained<NSWindow>,
) -> Result<ScreenDetailsState, WebviewRuntimeError> {
    let mtm = MainThreadMarker::new().ok_or_else(|| {
        // NSScreen snapshots are AppKit-owned state. This is a runtime precondition failure,
        // not a missing feature toggle that page code could enable later.
        WebviewRuntimeError::Unsupported("screen details require the main thread".into())
    })?;
    let screen_list = NSScreen::screens(mtm);
    let main_screen = NSScreen::mainScreen(mtm);
    let current_screen = window.screen();
    let mut screens = Vec::new();
    let mut current_index = None;
    for (index, screen) in screen_list.iter().enumerate() {
        if current_screen
            .as_ref()
            .map(|current| {
                std::ptr::eq::<NSScreen>(
                    current.as_ref() as &NSScreen,
                    screen.as_ref() as &NSScreen,
                )
            })
            .unwrap_or(false)
        {
            current_index = Some(index);
        }
        let detail = ScreenDetailState {
            id: format!("screen-{index}"),
            label: screen.localizedName().to_string(),
            is_primary: main_screen
                .as_ref()
                .map(|primary| {
                    std::ptr::eq::<NSScreen>(
                        primary.as_ref() as &NSScreen,
                        screen.as_ref() as &NSScreen,
                    )
                })
                .unwrap_or(false),
            frame: ns_rect_to_rect(screen.frame()),
            visible_frame: ns_rect_to_rect(screen.visibleFrame()),
            scale_factor: screen.backingScaleFactor() as f64,
        };
        screens.push(detail);
    }
    let current_screen = current_index.and_then(|index| screens.get(index).cloned());
    Ok(ScreenDetailsState {
        current_screen,
        is_extended: screens.len() > 1,
        screens,
        coordinate_origin: "bottomLeft",
    })
}

fn ns_rect_to_rect(rect: NSRect) -> Rect {
    Rect {
        x: rect.origin.x.round() as i32,
        y: rect.origin.y.round() as i32,
        width: rect.size.width.max(0.0).round() as u32,
        height: rect.size.height.max(0.0).round() as u32,
    }
}
