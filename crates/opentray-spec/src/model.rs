use serde::{Deserialize, Serialize};

pub type SessionId = String;
pub type SpaceId = String;
pub type LeaseId = SessionId;
pub type SurfaceId = SpaceId;
pub type TrayId = String;
pub type MenuItemId = u32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<SpaceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    #[serde(default)]
    pub default: bool,
}

pub type SurfaceOptions = SpaceOptions;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceRef {
    pub space_id: SpaceId,
}

pub type SurfaceRef = SpaceRef;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_id: Option<TrayId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<Tooltip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub menu: Option<Menu>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tooltip {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    pub items: Vec<MenuItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MenuItem {
    Item {
        id: MenuItemId,
        title: String,
        #[serde(rename = "primaryEvent", default, skip_serializing_if = "is_false")]
        primary_event: bool,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shortcut: Option<String>,
    },
    Check {
        id: MenuItemId,
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
    },
    Radio {
        id: MenuItemId,
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
        group: u32,
    },
    Separator,
    Submenu {
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        items: Vec<MenuItem>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Icon {
    Rgba {
        data: Vec<u8>,
        width: u32,
        height: u32,
    },
    Encoded {
        data: Vec<u8>,
    },
    File {
        path: String,
    },
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Logical desktop rectangle used by window, screen, and tray geometry APIs.
///
/// Native boundaries convert to or from physical pixels before crossing the ABI.
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrayEvent {
    Ready {
        space_id: SpaceId,
    },
    MenuClick {
        space_id: SpaceId,
        tray_id: TrayId,
        item_id: MenuItemId,
    },
    TrayClick {
        space_id: SpaceId,
        tray_id: TrayId,
        button: MouseButton,
        x: i32,
        y: i32,
    },
    TrayDoubleClick {
        space_id: SpaceId,
        tray_id: TrayId,
        button: MouseButton,
        x: i32,
        y: i32,
    },
}

const fn default_true() -> bool {
    true
}

const fn is_false(value: &bool) -> bool {
    !*value
}
