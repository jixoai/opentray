use serde::{Deserialize, Serialize};

pub type LeaseId = String;
pub type SurfaceId = String;
pub type TrayId = String;
pub type MenuItemId = u32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceOptions {
    pub app_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Icon>,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRef {
    pub surface_id: SurfaceId,
    pub app_id: String,
}

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
    pub icon: Icon,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TrayEvent {
    Ready {
        surface_id: SurfaceId,
    },
    MenuClick {
        surface_id: SurfaceId,
        tray_id: TrayId,
        item_id: MenuItemId,
    },
    TrayClick {
        surface_id: SurfaceId,
        button: MouseButton,
        x: i32,
        y: i32,
    },
    TrayDoubleClick {
        surface_id: SurfaceId,
        button: MouseButton,
        x: i32,
        y: i32,
    },
}

const fn default_true() -> bool {
    true
}
