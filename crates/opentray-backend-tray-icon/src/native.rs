use std::{cell::RefCell, collections::HashMap};

use opentray_core::BackendError;
use opentray_spec::{SurfaceId, TrayEvent};
use tray_icon::menu::{
    CheckMenuItem, Menu as NativeMenu, MenuItem as NativeMenuItem, PredefinedMenuItem, Submenu,
};
use tray_icon::{Icon as NativeIcon, TrayIcon, TrayIconBuilder};

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
    surfaces: RefCell<HashMap<SurfaceId, NativeSurfaceState>>,
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
            surface_id,
            trays,
            routes,
            ..
        } = projection;
        let mut icons = Vec::with_capacity(trays.len());

        for tray in trays {
            let icon = native_icon(&tray.icon)?;
            let menu = native_menu(&tray.menu)?;
            let tooltip = tray
                .tooltip
                .as_ref()
                .map(|tooltip| format!("{}: {}", tooltip.title, tooltip.description))
                .unwrap_or_else(|| tray.title.clone());

            let native = TrayIconBuilder::new()
                .with_tooltip(tooltip)
                .with_title(tray.title)
                .with_icon(icon)
                .with_menu(Box::new(menu))
                .build()
                .map_err(|error| BackendError::Failure(error.to_string()))?;

            icons.push(native);
        }

        let mut surfaces = self.surfaces.borrow_mut();
        if icons.is_empty() {
            surfaces.remove(&surface_id);
        } else {
            surfaces.insert(surface_id, NativeSurfaceState { icons, routes });
        }
        Ok(())
    }

    fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        self.surfaces
            .borrow()
            .values()
            .find_map(|surface| surface.routes.menu_event(menu_id))
    }
}

struct NativeSurfaceState {
    icons: Vec<TrayIcon>,
    routes: TrayIconRouteTable,
}

fn native_icon(asset: &TrayIconAsset) -> Result<NativeIcon, BackendError> {
    match asset {
        TrayIconAsset::Rgba {
            data,
            width,
            height,
        } => NativeIcon::from_rgba(data.clone(), *width, *height)
            .map_err(|error| BackendError::Failure(error.to_string())),
        TrayIconAsset::Encoded { .. } => Err(BackendError::Unsupported(
            "tray_icon_encoded_icon_unimplemented",
        )),
        TrayIconAsset::File { .. } => Err(BackendError::Unsupported(
            "tray_icon_file_icon_unimplemented",
        )),
    }
}

fn native_menu(projection: &TrayIconMenuProjection) -> Result<NativeMenu, BackendError> {
    let menu = NativeMenu::new();

    for entry in &projection.entries {
        append_menu_entry(&menu, entry)?;
    }

    Ok(menu)
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
