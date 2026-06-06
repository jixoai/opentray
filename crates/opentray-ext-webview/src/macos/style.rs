use std::{cell::RefCell, rc::Rc};

use objc2::rc::Retained;
use objc2_app_kit::{
    NSColor, NSFloatingWindowLevel, NSNormalWindowLevel, NSWindow, NSWindowStyleMask,
    NSWindowTitleVisibility,
};
use serde::{Deserialize, Serialize};
use window_vibrancy::{
    apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
};
use wry::RGBA;

use crate::{WebviewBackgroundEffectState, WebviewRuntimeError, WebviewShowSettings};

use super::{AppKitViewHandle, NavigatorWindowBridge, CLEAR_BACKGROUND, OPAQUE_BACKGROUND};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowStyleState {
    pub(super) frameless: bool,
    pub(super) transparent: bool,
    pub(super) keep_on_top: bool,
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
    pub(super) material: Option<String>,
    pub(super) material_state: WebviewBackgroundEffectState,
    pub(super) corner_radius: Option<f64>,
}

impl Default for WindowStyleState {
    fn default() -> Self {
        Self {
            frameless: false,
            transparent: false,
            keep_on_top: false,
            platform: WindowPlatformStyleState {
                macos: MacosWindowStyleState {
                    material: None,
                    material_state: WebviewBackgroundEffectState::FollowsWindowActiveState,
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
    pub(super) transparent: Option<bool>,
    pub(super) keep_on_top: Option<bool>,
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
    pub(super) material: Option<Option<String>>,
    pub(super) material_state: Option<String>,
    pub(super) corner_radius: Option<Option<f64>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetStyleWindowsPayload {
    pub(super) backdrop: Option<Option<String>>,
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
        .map(|payload| payload.backdrop.is_some() || payload.corner_preference.is_some())
        .unwrap_or(false)
    {
        // A cross-platform contract may carry multiple family placeholders, but the macOS
        // substrate must still reject real Windows family requests truthfully.
        return Err(WebviewRuntimeError::Unsupported(
            "platform.windows window style is not supported on macOS".into(),
        ));
    }
    let macos_payload = payload
        .platform
        .as_ref()
        .and_then(|platform| platform.macos.as_ref());
    if let Some(effect) = macos_payload
        .and_then(|payload| payload.material.as_ref())
        .and_then(|material| material.as_ref())
    {
        if !effect.is_empty() && parse_background_effect(effect).is_none() {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "background effect {effect} is not supported on macOS"
            )));
        }
    }
    if let Some(state) = macos_payload.and_then(|payload| payload.material_state.as_deref()) {
        if parse_background_effect_state(state).is_none() {
            return Err(WebviewRuntimeError::Unsupported(format!(
                "background effect state {state} is not supported on macOS"
            )));
        }
    }
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
        .backdrop
        .is_some()
        || show_settings
            .window
            .style
            .platform
            .windows
            .corner_preference
            .is_some()
    {
        Some(SetStyleWindowsPayload {
            backdrop: Some(show_settings.window.style.platform.windows.backdrop.clone()),
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
        transparent: Some(show_settings.window.style.transparent),
        keep_on_top: Some(show_settings.window.style.keep_on_top),
        platform: Some(SetStylePlatformPayload {
            macos: Some(SetStyleMacosPayload {
                material: Some(show_settings.window.style.platform.macos.material.clone()),
                material_state: Some(
                    background_effect_state_name(
                        show_settings.window.style.platform.macos.material_state,
                    )
                    .to_string(),
                ),
                corner_radius: Some(show_settings.window.style.platform.macos.corner_radius),
            }),
            windows: windows_payload,
            linux: Some(SetStyleLinuxPayload {}),
        }),
    })
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
    // `transparent` and `backgroundEffect` are orthogonal requested states.
    // On macOS, any vibrancy/material surface still needs a non-opaque, clear backing
    // layer underneath so AppKit can composite the material correctly.
    style.transparent || style.platform.macos.material.is_some()
}

pub(super) fn parse_background_effect_state(state: &str) -> Option<WebviewBackgroundEffectState> {
    match state {
        "followsWindowActiveState" => Some(WebviewBackgroundEffectState::FollowsWindowActiveState),
        "active" => Some(WebviewBackgroundEffectState::Active),
        "inactive" => Some(WebviewBackgroundEffectState::Inactive),
        _ => None,
    }
}

fn background_effect_state_name(state: WebviewBackgroundEffectState) -> &'static str {
    match state {
        WebviewBackgroundEffectState::FollowsWindowActiveState => "followsWindowActiveState",
        WebviewBackgroundEffectState::Active => "active",
        WebviewBackgroundEffectState::Inactive => "inactive",
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
    let wants_clear_background = requires_clear_backing(&style);
    window.setStyleMask(framed_window_style_mask(style.frameless, overlay_enabled));
    window.setLevel(if style.keep_on_top {
        NSFloatingWindowLevel
    } else {
        NSNormalWindowLevel
    });
    window.setOpaque(!wants_clear_background);
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
    if let Some(effect) = style
        .platform
        .macos
        .material
        .as_deref()
        .and_then(parse_background_effect)
    {
        apply_vibrancy(
            &host_view,
            effect,
            Some(native_background_effect_state(
                style.platform.macos.material_state,
            )),
            style.platform.macos.corner_radius,
        )
        .map_err(|error| WebviewRuntimeError::Internal(error.to_string()))?;
    }
    apply_corner_radius(&host_view.ns_view, style.platform.macos.corner_radius);
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

fn apply_corner_radius(content_view: &Retained<objc2_app_kit::NSView>, radius: Option<f64>) {
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
