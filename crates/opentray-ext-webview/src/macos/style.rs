use std::{cell::RefCell, rc::Rc};

use objc2::rc::Retained;
use objc2_app_kit::{
    NSColor, NSFloatingWindowLevel, NSNormalWindowLevel, NSView, NSWindow, NSWindowStyleMask,
    NSWindowTitleVisibility,
};
use serde::{Deserialize, Serialize};
use window_vibrancy::{
    apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
};
use wry::RGBA;

use crate::{
    normalize_opacity, parse_background_input, WebviewBackgroundEffectState,
    WebviewBackgroundInput, WebviewRuntimeError, WebviewShowSettings, WebviewWindowBackground,
};

use super::{AppKitViewHandle, NavigatorWindowBridge, CLEAR_BACKGROUND, OPAQUE_BACKGROUND};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowStyleState {
    pub(super) frameless: bool,
    pub(super) keep_on_top: bool,
    pub(super) opacity: f64,
    pub(super) background: WebviewWindowBackground,
    pub(super) platform: WindowPlatformStyleState,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowPlatformStyleState {
    pub(super) macos: MacosWindowStyleState,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MacosWindowStyleState {
    pub(super) corner_radius: Option<f64>,
}

impl Default for WindowStyleState {
    fn default() -> Self {
        Self {
            frameless: false,
            keep_on_top: false,
            opacity: 1.0,
            background: WebviewWindowBackground::Opaque,
            platform: WindowPlatformStyleState {
                macos: MacosWindowStyleState {
                    corner_radius: None,
                },
            },
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStylePayload {
    pub(super) frameless: Option<bool>,
    pub(super) keep_on_top: Option<bool>,
    pub(super) opacity: Option<f64>,
    pub(super) background: Option<WebviewBackgroundInput>,
    pub(super) platform: Option<SetStylePlatformPayload>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStylePlatformPayload {
    pub(super) macos: Option<SetStyleMacosPayload>,
    pub(super) windows: Option<SetStyleWindowsPayload>,
    #[allow(dead_code)]
    pub(super) linux: Option<SetStyleLinuxPayload>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStyleMacosPayload {
    pub(super) corner_radius: Option<Option<f64>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStyleWindowsPayload {
    pub(super) corner_preference: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStyleLinuxPayload {}

pub(super) fn validate_style_request(payload: &SetStylePayload) -> Result<(), WebviewRuntimeError> {
    let windows_payload = payload
        .platform
        .as_ref()
        .and_then(|platform| platform.windows.as_ref());
    if windows_payload
        .map(|payload| payload.corner_preference.is_some())
        .unwrap_or(false)
    {
        // A cross-platform contract may carry multiple family placeholders, but the macOS
        // substrate must still reject real Windows family requests truthfully.
        return Err(WebviewRuntimeError::Unsupported(
            "platform.windows window style is not supported on macOS".into(),
        ));
    }
    if let Some(background) = payload.background.clone() {
        validate_background(&parse_background_input(background)?)?;
    }
    if let Some(opacity) = payload.opacity {
        normalize_opacity(opacity)?;
    }
    let macos_payload = payload
        .platform
        .as_ref()
        .and_then(|platform| platform.macos.as_ref());
    if let Some(Some(radius)) = macos_payload.and_then(|payload| payload.corner_radius) {
        normalize_corner_radius(radius)?;
    }
    Ok(())
}

pub(super) fn validate_initial_style(
    show_settings: &WebviewShowSettings,
) -> Result<(), WebviewRuntimeError> {
    let windows_payload = if show_settings
        .window
        .style
        .platform
        .windows
        .corner_preference
        .is_some()
    {
        Some(SetStyleWindowsPayload {
            corner_preference: Some(
                show_settings
                    .window
                    .style
                    .platform
                    .windows
                    .corner_preference
                    .clone(),
            ),
        })
    } else {
        None
    };

    validate_style_request(&SetStylePayload {
        frameless: Some(show_settings.window.style.frameless),
        keep_on_top: Some(show_settings.window.style.keep_on_top),
        opacity: Some(show_settings.window.style.opacity),
        background: None,
        platform: Some(SetStylePlatformPayload {
            macos: Some(SetStyleMacosPayload {
                corner_radius: Some(show_settings.window.style.platform.macos.corner_radius),
            }),
            windows: windows_payload,
            linux: Some(SetStyleLinuxPayload {}),
        }),
    })?;
    validate_background(&show_settings.window.style.background)
}

pub(super) fn framed_window_style_mask(frameless: bool, overlay: bool) -> NSWindowStyleMask {
    if frameless {
        NSWindowStyleMask::Borderless
    } else {
        let mut mask = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable;
        if overlay {
            mask |= NSWindowStyleMask::FullSizeContentView;
        }
        mask
    }
}

pub(super) fn supported_background_effects() -> &'static [&'static str] {
    &[
        "appearanceBased",
        "sidebar",
        "hudWindow",
        "windowBackground",
        "contentBackground",
        "underWindowBackground",
    ]
}

#[allow(deprecated)]
fn parse_background_effect(effect: &str) -> Option<NSVisualEffectMaterial> {
    match effect {
        "appearanceBased" => Some(NSVisualEffectMaterial::AppearanceBased),
        "sidebar" => Some(NSVisualEffectMaterial::Sidebar),
        "hudWindow" => Some(NSVisualEffectMaterial::HudWindow),
        "windowBackground" => Some(NSVisualEffectMaterial::WindowBackground),
        "contentBackground" => Some(NSVisualEffectMaterial::ContentBackground),
        "underWindowBackground" => Some(NSVisualEffectMaterial::UnderWindowBackground),
        _ => None,
    }
}

fn requires_clear_backing(style: &WindowStyleState) -> bool {
    matches!(
        style.background,
        WebviewWindowBackground::Transparent
            | WebviewWindowBackground::PlatformMaterial { .. }
            | WebviewWindowBackground::Semantic { .. }
    ) || style.platform.macos.corner_radius.is_some()
}

fn validate_background(background: &WebviewWindowBackground) -> Result<(), WebviewRuntimeError> {
    resolve_macos_background_effect(background).map(|_| ())
}

#[allow(deprecated)]
fn resolve_macos_background_effect(
    background: &WebviewWindowBackground,
) -> Result<Option<(NSVisualEffectMaterial, WebviewBackgroundEffectState)>, WebviewRuntimeError> {
    match background {
        WebviewWindowBackground::Opaque | WebviewWindowBackground::Transparent => Ok(None),
        WebviewWindowBackground::PlatformMaterial { material, state } => {
            let effect = parse_background_effect(material).ok_or_else(|| {
                WebviewRuntimeError::Unsupported(format!(
                    "background material {material} is not supported on macOS"
                ))
            })?;
            Ok(Some((effect, *state)))
        }
        WebviewWindowBackground::Semantic { token, state } => match token.as_str() {
            "blur" => Ok(Some((NSVisualEffectMaterial::HudWindow, *state))),
            other => Err(WebviewRuntimeError::Unsupported(format!(
                "background token {other} is not supported on macOS"
            ))),
        },
    }
}

fn native_background_effect_state(state: WebviewBackgroundEffectState) -> NSVisualEffectState {
    match state {
        WebviewBackgroundEffectState::FollowsWindowActiveState => {
            NSVisualEffectState::FollowsWindowActiveState
        }
        WebviewBackgroundEffectState::Active => NSVisualEffectState::Active,
        WebviewBackgroundEffectState::Inactive => NSVisualEffectState::Inactive,
    }
}

pub(super) fn apply_window_style(
    bridge: &Rc<RefCell<NavigatorWindowBridge>>,
    window: &Retained<NSWindow>,
) -> Result<(), WebviewRuntimeError> {
    let (style, content_view, webview_ptr) = {
        let state = bridge.borrow();
        (
            state.style.clone(),
            state.content_view.clone(),
            state.webview,
        )
    };
    let content_view = content_view
        .ok_or_else(|| WebviewRuntimeError::Internal("content view is not ready".into()))?;
    let webview_ptr = webview_ptr
        .ok_or_else(|| WebviewRuntimeError::Internal("webview bridge is not ready".into()))?;
    let host_view = AppKitViewHandle::new(content_view);
    let overlay_enabled = {
        let state = bridge.borrow();
        state.navigator_window.window_controls_overlay
    };
    let wants_clear_background =
        requires_clear_backing(&style) || style.platform.macos.corner_radius.is_some();
    window.setStyleMask(framed_window_style_mask(style.frameless, overlay_enabled));
    window.setLevel(if style.keep_on_top {
        NSFloatingWindowLevel
    } else {
        NSNormalWindowLevel
    });
    window.setOpaque(!wants_clear_background);
    window.setAlphaValue(style.opacity);
    window.setMovableByWindowBackground(style.frameless);
    window.setTitlebarAppearsTransparent(wants_clear_background || overlay_enabled);
    window.setTitleVisibility(if overlay_enabled {
        NSWindowTitleVisibility::Hidden
    } else {
        NSWindowTitleVisibility::Visible
    });
    let background_color = ns_color(if wants_clear_background {
        CLEAR_BACKGROUND
    } else {
        OPAQUE_BACKGROUND
    });
    window.setBackgroundColor(Some(&background_color));
    unsafe { webview_ptr.as_ref() }
        .set_background_color(if wants_clear_background {
            CLEAR_BACKGROUND
        } else {
            OPAQUE_BACKGROUND
        })
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    clear_vibrancy(&host_view).map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    if let Some((effect, state)) = resolve_macos_background_effect(&style.background)? {
        apply_vibrancy(
            &host_view,
            effect,
            Some(native_background_effect_state(state)),
            style.platform.macos.corner_radius,
        )
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    apply_corner_radius(window, style.platform.macos.corner_radius)?;
    Ok(())
}

pub(super) fn normalize_corner_radius(radius: f64) -> Result<f64, WebviewRuntimeError> {
    if !radius.is_finite() {
        return Err(WebviewRuntimeError::Rejected(
            "cornerRadius must be a finite number".into(),
        ));
    }
    Ok(radius.clamp(0.0, 128.0))
}

fn apply_corner_radius(
    window: &Retained<NSWindow>,
    radius: Option<f64>,
) -> Result<(), WebviewRuntimeError> {
    let frame_view = window_frame_view(window).ok_or_else(|| {
        WebviewRuntimeError::Internal("webview window frame view is not ready".into())
    })?;
    apply_layer_corner_radius(&frame_view, radius);
    Ok(())
}

fn window_frame_view(window: &Retained<NSWindow>) -> Option<Retained<NSView>> {
    let content_view = window.contentView()?;
    // AppKit installs the content view inside the theme frame; that frame owns the native
    // window silhouette, while the content view belongs to page/WebView composition.
    unsafe { content_view.superview() }
}

fn apply_layer_corner_radius(content_view: &Retained<NSView>, radius: Option<f64>) {
    if radius.is_some() {
        content_view.setWantsLayer(true);
    }
    if let Some(layer) = content_view.layer() {
        layer.setCornerRadius(radius.unwrap_or(0.0));
        layer.setMasksToBounds(radius.is_some());
    }
}

fn ns_color((red, green, blue, alpha): RGBA) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(
        red as f64 / 255.0,
        green as f64 / 255.0,
        blue as f64 / 255.0,
        alpha as f64 / 255.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSBackingStoreType;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    #[test]
    fn corner_radius_requires_clear_backing_even_with_opaque_background() {
        let mut style = WindowStyleState::default();
        assert!(!requires_clear_backing(&style));

        style.platform.macos.corner_radius = Some(18.0);
        assert!(requires_clear_backing(&style));
    }

    #[test]
    fn corner_radius_targets_theme_frame_layer_not_content_layer() {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("skipping AppKit layer test outside the main thread");
            return;
        };
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(320.0, 200.0)),
                framed_window_style_mask(true, false),
                NSBackingStoreType::Buffered,
                true,
            )
        };
        let content_view = window.contentView().expect("content view should exist");

        apply_corner_radius(&window, Some(18.0)).expect("corner radius should apply");

        let frame_view = unsafe {
            content_view
                .superview()
                .expect("content view should be mounted in a theme frame")
        };
        let frame_layer = frame_view
            .layer()
            .expect("theme frame should become layer-backed");
        assert_eq!(frame_layer.cornerRadius(), 18.0);
        assert!(frame_layer.masksToBounds());

        let content_layer_radius = content_view
            .layer()
            .map(|layer| layer.cornerRadius())
            .unwrap_or(0.0);
        assert_eq!(content_layer_radius, 0.0);

        apply_corner_radius(&window, None).expect("corner radius should clear");

        let frame_layer = frame_view
            .layer()
            .expect("theme frame layer should remain readable");
        assert_eq!(frame_layer.cornerRadius(), 0.0);
        assert!(!frame_layer.masksToBounds());
    }
}
