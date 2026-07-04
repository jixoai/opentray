use std::{cell::RefCell, collections::HashMap};

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSEvent;
#[cfg(target_os = "macos")]
use objc2_foundation::NSRect;
use opentray_core::BackendError;
#[cfg(target_os = "windows")]
use opentray_spec::geometry::DpiScale;
use opentray_spec::{AppId, MouseButton, TrayEvent};
use tray_icon::menu::{
    CheckMenuItem, Menu as NativeMenu, MenuItem as NativeMenuItem, PredefinedMenuItem, Submenu,
};
use tray_icon::{Icon as NativeIcon, TrayIcon, TrayIconBuilder};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{RECT, S_OK};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONEAREST};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

use crate::{
    TrayIconAsset, TrayIconMenuEntry, TrayIconMenuProjection, TrayIconProjection,
    TrayIconRouteTable, TrayIconRuntime,
};

/// Native `tray-icon` runtime atom for macOS and Windows tray surfaces.
///
/// This runtime only owns native tray handles and applies already-compiled
/// `TrayIconProjection` values. It intentionally does not create or run the OS
/// event loop: callers must invoke it on the thread that owns an active native
/// event loop. On macOS, that means the main thread after event-loop startup.
#[derive(Default)]
pub struct NativeTrayIconRuntime {
    surfaces: RefCell<HashMap<AppId, NativeAppState>>,
    #[cfg(target_os = "macos")]
    last_interaction_bounds: RefCell<HashMap<String, opentray_spec::Rect>>,
}

impl NativeTrayIconRuntime {
    /// Creates an empty native tray runtime.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns how many native tray handles are currently owned by the runtime.
    pub fn icon_count(&self) -> usize {
        self.surfaces
            .borrow()
            .values()
            .map(|surface| surface.icons.len())
            .sum()
    }
}

impl TrayIconRuntime for NativeTrayIconRuntime {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError> {
        let TrayIconProjection {
            app_id,
            trays,
            routes,
            ..
        } = projection;
        let mut surfaces = self.surfaces.borrow_mut();
        let previous = surfaces.remove(&app_id);
        let mut previous_icons = previous.map(|state| state.icons).unwrap_or_default();
        let mut icons = HashMap::with_capacity(trays.len());
        let mut direct_primary_routes = HashMap::new();

        for tray in trays {
            let tray_icon_id = tray.tray_icon_id.clone();
            let icon_is_template = tray.icon.as_ref().is_some_and(TrayIconAsset::is_template);
            let icon = native_icon(tray.icon.as_ref())?;
            let menu_policy = native_menu_policy(&tray.menu);
            let menu = if menu_policy.attach_menu {
                Some(native_menu(&tray.menu)?)
            } else {
                None
            };
            let tooltip = tray
                .tooltip
                .as_ref()
                .map(|tooltip| format!("{}: {}", tooltip.title, tooltip.description))
                .or_else(|| tray.title.clone());
            if menu_policy.direct_primary {
                if let Some(primary_menu_id) = tray.menu.primary_menu_id.clone() {
                    direct_primary_routes.insert(tray_icon_id.clone(), primary_menu_id);
                }
            }

            let native = if let Some(native) = previous_icons.remove(&tray_icon_id) {
                apply_native_tray_update(
                    &native,
                    icon,
                    icon_is_template,
                    tray.title,
                    tooltip,
                    menu,
                    menu_policy,
                )?;
                native
            } else {
                create_native_tray(
                    tray_icon_id.clone(),
                    icon,
                    icon_is_template,
                    tray.title,
                    tooltip,
                    menu,
                    menu_policy,
                )?
            };

            icons.insert(tray_icon_id, native);
        }

        if icons.is_empty() {
            surfaces.remove(&app_id);
        } else {
            surfaces.insert(
                app_id,
                NativeAppState {
                    icons,
                    routes,
                    direct_primary_routes,
                },
            );
        }
        Ok(())
    }

    fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        self.surfaces
            .borrow()
            .values()
            .find_map(|surface| surface.routes.menu_event(menu_id))
    }

    fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
        self.surfaces.borrow().values().find_map(|surface| {
            surface
                .direct_primary_routes
                .get(tray_icon_id)
                .and_then(|menu_id| surface.routes.menu_event(menu_id))
        })
    }

    fn tray_click_event(
        &self,
        tray_icon_id: &str,
        button: MouseButton,
        x: i32,
        y: i32,
    ) -> Option<TrayEvent> {
        self.surfaces
            .borrow()
            .values()
            .find_map(|surface| surface.routes.tray_click_event(tray_icon_id, button, x, y))
    }

    fn tray_bounds(&self, tray_icon_id: &str) -> Result<Option<opentray_spec::Rect>, BackendError> {
        #[cfg(target_os = "macos")]
        if let Some(bounds) = self
            .last_interaction_bounds
            .borrow()
            .get(tray_icon_id)
            .copied()
        {
            return Ok(Some(bounds));
        }
        Ok(self
            .surfaces
            .borrow()
            .values()
            .find_map(|surface| surface.icons.get(tray_icon_id).and_then(native_tray_bounds)))
    }

    fn record_tray_interaction(&self, tray_icon_id: &str) {
        #[cfg(not(target_os = "macos"))]
        let _ = tray_icon_id;
        #[cfg(target_os = "macos")]
        if let Some(bounds) = self.surfaces.borrow().values().find_map(|surface| {
            surface
                .icons
                .get(tray_icon_id)
                .and_then(native_tray_bounds_from_mouse)
        }) {
            self.last_interaction_bounds
                .borrow_mut()
                .insert(tray_icon_id.to_string(), bounds);
        }
    }
}

fn create_native_tray(
    tray_icon_id: String,
    icon: Option<NativeIcon>,
    icon_is_template: bool,
    title: Option<String>,
    tooltip: Option<String>,
    menu: Option<NativeMenu>,
    menu_policy: NativeMenuPolicy,
) -> Result<TrayIcon, BackendError> {
    let mut builder = TrayIconBuilder::new().with_id(tray_icon_id);
    if let Some(tooltip) = tooltip {
        builder = builder.with_tooltip(tooltip);
    }
    if let Some(title) = title {
        builder = builder.with_title(title);
    }
    if let Some(icon) = icon {
        builder = builder
            .with_icon(icon)
            .with_icon_as_template(icon_is_template);
    }
    if let Some(menu) = menu {
        builder = builder.with_menu(Box::new(menu));
    }

    let native = builder
        .with_menu_on_left_click(menu_policy.show_menu_on_left_click)
        .with_menu_on_right_click(menu_policy.show_menu_on_right_click)
        .build()
        .map_err(|error| BackendError::Failure(error.to_string()))?;
    native.set_icon_as_template(icon_is_template);
    Ok(native)
}

fn apply_native_tray_update(
    native: &TrayIcon,
    icon: Option<NativeIcon>,
    icon_is_template: bool,
    title: Option<String>,
    tooltip: Option<String>,
    menu: Option<NativeMenu>,
    menu_policy: NativeMenuPolicy,
) -> Result<(), BackendError> {
    #[cfg(target_os = "macos")]
    native
        .set_icon_with_as_template(icon, icon_is_template)
        .map_err(|error| BackendError::Failure(error.to_string()))?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = icon_is_template;
        native
            .set_icon(icon)
            .map_err(|error| BackendError::Failure(error.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    native.set_title(Some(title.unwrap_or_default()));
    #[cfg(not(target_os = "macos"))]
    native.set_title(title);
    native
        .set_tooltip(tooltip)
        .map_err(|error| BackendError::Failure(error.to_string()))?;
    native.set_menu(menu.map(|menu| Box::new(menu) as Box<dyn tray_icon::menu::ContextMenu>));
    native.set_show_menu_on_left_click(menu_policy.show_menu_on_left_click);
    native.set_show_menu_on_right_click(menu_policy.show_menu_on_right_click);
    Ok(())
}

struct NativeAppState {
    icons: HashMap<String, TrayIcon>,
    routes: TrayIconRouteTable,
    direct_primary_routes: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NativeMenuPolicy {
    attach_menu: bool,
    show_menu_on_left_click: bool,
    show_menu_on_right_click: bool,
    direct_primary: bool,
}

#[cfg(target_os = "windows")]
fn native_menu_policy(menu: &TrayIconMenuProjection) -> NativeMenuPolicy {
    let direct_primary = menu.has_primary_event();
    NativeMenuPolicy {
        attach_menu: true,
        show_menu_on_left_click: !direct_primary,
        show_menu_on_right_click: true,
        direct_primary,
    }
}

#[cfg(target_os = "macos")]
fn native_menu_policy(menu: &TrayIconMenuProjection) -> NativeMenuPolicy {
    let direct_primary = menu.has_primary_event();
    NativeMenuPolicy {
        // tray-icon 0.24 exposes independent macOS left/right menu toggles.
        // A primary item is therefore a left-click route while the attached
        // NSMenu remains available through the normal right-click context menu.
        attach_menu: true,
        show_menu_on_left_click: !direct_primary,
        show_menu_on_right_click: true,
        direct_primary,
    }
}

fn native_icon(asset: Option<&TrayIconAsset>) -> Result<Option<NativeIcon>, BackendError> {
    let asset = match asset {
        Some(asset) => asset,
        None => return Ok(None),
    };
    match asset {
        // The projection layer already normalized every icon source into RGBA.
        TrayIconAsset::Rgba {
            data,
            width,
            height,
            ..
        } => NativeIcon::from_rgba(data.clone(), *width, *height)
            .map(Some)
            .map_err(|error| BackendError::Failure(error.to_string())),
    }
}

fn native_menu(projection: &TrayIconMenuProjection) -> Result<NativeMenu, BackendError> {
    let menu = NativeMenu::new();

    for entry in &projection.entries {
        append_menu_entry(&menu, entry)?;
    }

    Ok(menu)
}

#[cfg(target_os = "macos")]
fn native_tray_bounds(icon: &TrayIcon) -> Option<opentray_spec::Rect> {
    let mtm = MainThreadMarker::new()?;
    let status_item = icon.ns_status_item()?;
    let button = status_item.button(mtm)?;
    let window = button.window()?;
    let button_rect_in_window = button.convertRect_toView(button.bounds(), None);
    Some(ns_window_frame_to_rect(
        window.convertRectToScreen(button_rect_in_window),
    ))
}

#[cfg(target_os = "macos")]
fn native_tray_bounds_from_mouse(icon: &TrayIcon) -> Option<opentray_spec::Rect> {
    let mut bounds = native_tray_bounds(icon)?;
    let mouse = NSEvent::mouseLocation();
    bounds.x = (mouse.x - bounds.width as f64 / 2.0).round() as i32;
    Some(bounds)
}

#[cfg(target_os = "windows")]
fn native_tray_bounds(icon: &TrayIcon) -> Option<opentray_spec::Rect> {
    // Normalize tray geometry to logical desktop pixels before it crosses the backend boundary.
    // Placement math then sees the same unit system as window and screen snapshots.
    let rect = icon.rect()?;
    let dpi = tray_rect_dpi(&rect)?;
    let scale = DpiScale::from_dpi(dpi);
    let width = i32::try_from(rect.size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(rect.size.height).unwrap_or(i32::MAX);
    Some(opentray_spec::Rect {
        x: scale.physical_to_logical_i32(rect.position.x.round() as i32),
        y: scale.physical_to_logical_i32(rect.position.y.round() as i32),
        width: scale.physical_extent_to_logical_u32(width),
        height: scale.physical_extent_to_logical_u32(height),
    })
}

#[cfg(target_os = "windows")]
fn tray_rect_dpi(rect: &tray_icon::Rect) -> Option<u32> {
    let width = i32::try_from(rect.size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(rect.size.height).unwrap_or(i32::MAX);
    let x = rect
        .position
        .x
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
    let y = rect
        .position
        .y
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
    let physical_rect = RECT {
        left: x,
        top: y,
        right: x.saturating_add(width),
        bottom: y.saturating_add(height),
    };
    let monitor = unsafe { MonitorFromRect(&physical_rect, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return None;
    }
    let mut dpi_x = 0u32;
    let mut dpi_y = 0u32;
    let result = unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    if result != S_OK || dpi_x == 0 || dpi_y == 0 {
        return None;
    }
    Some(dpi_x)
}

#[cfg(target_os = "macos")]
fn ns_window_frame_to_rect(frame: NSRect) -> opentray_spec::Rect {
    opentray_spec::Rect {
        x: frame.origin.x.round() as i32,
        y: frame.origin.y.round() as i32,
        width: frame.size.width.max(0.0).round() as u32,
        height: frame.size.height.max(0.0).round() as u32,
    }
}

fn append_menu_entry(menu: &NativeMenu, entry: &TrayIconMenuEntry) -> Result<(), BackendError> {
    match entry {
        TrayIconMenuEntry::Item {
            menu_id,
            title,
            enabled,
            ..
        } => menu.append(&NativeMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            None,
        )),
        TrayIconMenuEntry::Check {
            menu_id,
            title,
            enabled,
            checked,
        } => menu.append(&CheckMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            *checked,
            None,
        )),
        TrayIconMenuEntry::Radio {
            menu_id,
            title,
            enabled,
            checked,
            ..
        } => menu.append(&CheckMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            *checked,
            None,
        )),
        TrayIconMenuEntry::Separator => menu.append(&PredefinedMenuItem::separator()),
        TrayIconMenuEntry::Submenu {
            title,
            enabled,
            entries,
        } => {
            let submenu = Submenu::new(title, *enabled);
            for entry in entries {
                append_submenu_entry(&submenu, entry)?;
            }
            menu.append(&submenu)
        }
    }
    .map_err(|error| BackendError::Failure(error.to_string()))
}

fn append_submenu_entry(submenu: &Submenu, entry: &TrayIconMenuEntry) -> Result<(), BackendError> {
    match entry {
        TrayIconMenuEntry::Item {
            menu_id,
            title,
            enabled,
            ..
        } => submenu.append(&NativeMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            None,
        )),
        TrayIconMenuEntry::Check {
            menu_id,
            title,
            enabled,
            checked,
        } => submenu.append(&CheckMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            *checked,
            None,
        )),
        TrayIconMenuEntry::Radio {
            menu_id,
            title,
            enabled,
            checked,
            ..
        } => submenu.append(&CheckMenuItem::with_id(
            menu_id.clone(),
            title,
            *enabled,
            *checked,
            None,
        )),
        TrayIconMenuEntry::Separator => submenu.append(&PredefinedMenuItem::separator()),
        TrayIconMenuEntry::Submenu {
            title,
            enabled,
            entries,
        } => {
            let child = Submenu::new(title, *enabled);
            for entry in entries {
                append_submenu_entry(&child, entry)?;
            }
            submenu.append(&child)
        }
    }
    .map_err(|error| BackendError::Failure(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    fn menu(primary: bool, click_item_count: usize) -> TrayIconMenuProjection {
        TrayIconMenuProjection {
            entries: Vec::new(),
            primary_menu_id: primary.then(|| "native-menu-id".to_string()),
            click_item_count,
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_single_primary_routes_left_click_and_keeps_context_menu() {
        assert_eq!(
            native_menu_policy(&menu(true, 1)),
            NativeMenuPolicy {
                attach_menu: true,
                show_menu_on_left_click: false,
                show_menu_on_right_click: true,
                direct_primary: true,
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_multi_item_primary_routes_left_click_and_keeps_context_menu() {
        assert_eq!(
            native_menu_policy(&menu(true, 2)),
            NativeMenuPolicy {
                attach_menu: true,
                show_menu_on_left_click: false,
                show_menu_on_right_click: true,
                direct_primary: true,
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_tray_bounds_use_appkit_global_points() {
        let rect = ns_window_frame_to_rect(NSRect::new(
            NSPoint::new(1500.0, 2490.0),
            NSSize::new(196.0, 60.0),
        ));

        assert_eq!(
            rect,
            opentray_spec::Rect {
                x: 1500,
                y: 2490,
                width: 196,
                height: 60,
            }
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_primary_keeps_context_menu_for_right_click() {
        assert_eq!(
            native_menu_policy(&menu(true, 2)),
            NativeMenuPolicy {
                attach_menu: true,
                show_menu_on_left_click: false,
                show_menu_on_right_click: true,
                direct_primary: true,
            }
        );
    }
}
