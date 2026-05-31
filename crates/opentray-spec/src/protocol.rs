use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    Icon, Menu, SurfaceId, SurfaceOptions, SurfaceRef, Tooltip, TrayEvent, TrayId, TrayOptions,
};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientFrame {
    Init {
        version: u32,
    },
    CreateSurface {
        #[serde(flatten)]
        options: SurfaceOptions,
    },
    ResolveDefaultSurface,
    CreateTray {
        surface: SurfaceRef,
        tray: TrayOptions,
    },
    DestroyTray {
        surface_id: SurfaceId,
        tray_id: TrayId,
    },
    SetTrayMenu {
        surface_id: SurfaceId,
        tray_id: TrayId,
        menu: Menu,
    },
    SetTrayIcon {
        surface_id: SurfaceId,
        tray_id: TrayId,
        icon: Icon,
    },
    SetTrayTooltip {
        surface_id: SurfaceId,
        tray_id: TrayId,
        tooltip: Tooltip,
    },
    LoadExt {
        surface_id: SurfaceId,
        name: String,
        path: String,
    },
    ExtCommand {
        surface_id: SurfaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    UnloadExt {
        surface_id: SurfaceId,
        name: String,
    },
    Exit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerFrame {
    Ready {
        version: u32,
    },
    SurfaceCreated {
        surface: SurfaceRef,
    },
    DefaultSurface {
        surface: SurfaceRef,
    },
    TrayCreated {
        surface_id: SurfaceId,
        tray_id: TrayId,
    },
    Event {
        event: TrayEvent,
    },
    ExtEvent {
        surface_id: SurfaceId,
        tray_id: TrayId,
        ext: String,
        data: Value,
    },
    Error {
        message: String,
    },
}
