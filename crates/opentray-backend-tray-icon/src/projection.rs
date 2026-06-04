use std::collections::HashMap;

use opentray_core::{SurfaceProjection, TrayProjection};
use opentray_spec::{Icon, Menu, MenuItem, MenuItemId, SurfaceId, Tooltip, TrayEvent, TrayId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconProjection {
    pub space_id: SurfaceId,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Option<TrayIconAsset>,
    pub trays: Vec<TrayIconTrayProjection>,
    pub routes: TrayIconRouteTable,
}

impl TrayIconProjection {
    pub fn from_surface_projection(projection: &SurfaceProjection) -> Self {
        let mut routes = TrayIconRouteTable::default();
        let trays = projection
            .trays
            .iter()
            .map(|tray| {
                TrayIconTrayProjection::from_tray_projection(
                    &projection.surface.space_id,
                    tray,
                    &mut routes,
                )
            })
            .collect();

        Self {
            space_id: projection.surface.space_id.clone(),
            title: projection.title.clone(),
            tooltip: projection.tooltip.clone(),
            icon: projection.icon.as_ref().map(TrayIconAsset::from_icon),
            trays,
            routes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconTrayProjection {
    pub tray_icon_id: String,
    pub tray_id: TrayId,
    pub title: String,
    pub tooltip: Option<Tooltip>,
    pub icon: TrayIconAsset,
    pub menu: TrayIconMenuProjection,
}

impl TrayIconTrayProjection {
    fn from_tray_projection(
        space_id: &str,
        tray: &TrayProjection,
        routes: &mut TrayIconRouteTable,
    ) -> Self {
        let tray_icon_id = stable_tray_icon_id(space_id, &tray.tray_id);
        let menu =
            TrayIconMenuProjection::from_menu(space_id, &tray.tray_id, tray.menu.as_ref(), routes);
        if let Some(primary_menu_id) = menu.primary_menu_id.clone() {
            routes.insert_primary_event(&tray_icon_id, primary_menu_id);
        }

        Self {
            tray_icon_id,
            tray_id: tray.tray_id.clone(),
            title: tray.title.clone(),
            tooltip: tray.tooltip.clone(),
            icon: TrayIconAsset::from_icon(&tray.icon),
            menu,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayIconAsset {
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

impl TrayIconAsset {
    fn from_icon(icon: &Icon) -> Self {
        match icon {
            Icon::Rgba {
                data,
                width,
                height,
            } => Self::Rgba {
                data: data.clone(),
                width: *width,
                height: *height,
            },
            Icon::Encoded { data } => Self::Encoded { data: data.clone() },
            Icon::File { path } => Self::File { path: path.clone() },
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrayIconMenuProjection {
    pub entries: Vec<TrayIconMenuEntry>,
    pub primary_menu_id: Option<String>,
    pub click_item_count: usize,
}

impl TrayIconMenuProjection {
    fn from_menu(
        space_id: &str,
        tray_id: &str,
        menu: Option<&Menu>,
        routes: &mut TrayIconRouteTable,
    ) -> Self {
        let mut primary_menu_id = None;
        let mut click_item_count = 0;
        let entries = menu
            .map(|menu| {
                menu.items
                    .iter()
                    .map(|item| {
                        menu_entry(
                            space_id,
                            tray_id,
                            item,
                            routes,
                            &mut primary_menu_id,
                            &mut click_item_count,
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        Self {
            entries,
            primary_menu_id,
            click_item_count,
        }
    }

    pub fn has_primary_event(&self) -> bool {
        self.primary_menu_id.is_some()
    }

    pub fn has_single_primary_event(&self) -> bool {
        self.primary_menu_id.is_some() && self.click_item_count == 1
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayIconMenuEntry {
    Item {
        menu_id: String,
        title: String,
        enabled: bool,
        shortcut: Option<String>,
    },
    Check {
        menu_id: String,
        title: String,
        enabled: bool,
        checked: bool,
    },
    Radio {
        menu_id: String,
        title: String,
        enabled: bool,
        checked: bool,
        group: u32,
    },
    Separator,
    Submenu {
        title: String,
        enabled: bool,
        entries: Vec<TrayIconMenuEntry>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconMenuRoute {
    pub space_id: SurfaceId,
    pub tray_id: TrayId,
    pub item_id: MenuItemId,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrayIconRouteTable {
    routes: HashMap<String, TrayIconMenuRoute>,
    primary_routes: HashMap<String, String>,
}

impl TrayIconRouteTable {
    pub fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        self.routes.get(menu_id).map(|route| TrayEvent::MenuClick {
            space_id: route.space_id.clone(),
            tray_id: route.tray_id.clone(),
            item_id: route.item_id,
        })
    }

    pub fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
        self.primary_routes
            .get(tray_icon_id)
            .and_then(|menu_id| self.menu_event(menu_id))
    }

    fn insert(&mut self, space_id: &str, tray_id: &str, item_id: MenuItemId) -> String {
        let menu_id = stable_menu_id(space_id, tray_id, item_id);
        self.routes.insert(
            menu_id.clone(),
            TrayIconMenuRoute {
                space_id: space_id.to_string(),
                tray_id: tray_id.to_string(),
                item_id,
            },
        );
        menu_id
    }

    fn insert_primary_event(&mut self, tray_icon_id: &str, menu_id: String) {
        self.primary_routes
            .entry(tray_icon_id.to_string())
            .or_insert(menu_id);
    }
}

fn menu_entry(
    space_id: &str,
    tray_id: &str,
    item: &MenuItem,
    routes: &mut TrayIconRouteTable,
    primary_menu_id: &mut Option<String>,
    click_item_count: &mut usize,
) -> TrayIconMenuEntry {
    match item {
        MenuItem::Item {
            id,
            title,
            primary_event,
            enabled,
            shortcut,
        } => {
            *click_item_count += 1;
            let menu_id = routes.insert(space_id, tray_id, *id);
            if *primary_event && *enabled && primary_menu_id.is_none() {
                *primary_menu_id = Some(menu_id.clone());
            }
            TrayIconMenuEntry::Item {
                menu_id,
                title: title.clone(),
                enabled: *enabled,
                shortcut: shortcut.clone(),
            }
        }
        MenuItem::Check {
            id,
            title,
            enabled,
            checked,
        } => {
            *click_item_count += 1;
            TrayIconMenuEntry::Check {
                menu_id: routes.insert(space_id, tray_id, *id),
                title: title.clone(),
                enabled: *enabled,
                checked: *checked,
            }
        }
        MenuItem::Radio {
            id,
            title,
            enabled,
            checked,
            group,
        } => {
            *click_item_count += 1;
            TrayIconMenuEntry::Radio {
                menu_id: routes.insert(space_id, tray_id, *id),
                title: title.clone(),
                enabled: *enabled,
                checked: *checked,
                group: *group,
            }
        }
        MenuItem::Separator => TrayIconMenuEntry::Separator,
        MenuItem::Submenu {
            title,
            enabled,
            items,
        } => TrayIconMenuEntry::Submenu {
            title: title.clone(),
            enabled: *enabled,
            entries: items
                .iter()
                .map(|item| {
                    menu_entry(
                        space_id,
                        tray_id,
                        item,
                        routes,
                        primary_menu_id,
                        click_item_count,
                    )
                })
                .collect(),
        },
    }
}

pub(crate) fn stable_tray_icon_id(space_id: &str, tray_id: &str) -> String {
    format!(
        "opentray-tray:{}:{}",
        encode_component(space_id),
        encode_component(tray_id)
    )
}

fn stable_menu_id(space_id: &str, tray_id: &str, item_id: MenuItemId) -> String {
    format!(
        "opentray:{}:{}:{}",
        encode_component(space_id),
        encode_component(tray_id),
        item_id
    )
}

fn encode_component(input: &str) -> String {
    input
        .replace('%', "%25")
        .replace(':', "%3A")
        .replace('/', "%2F")
}

#[cfg(test)]
mod tests {
    use opentray_spec::{Icon, Menu, MenuItem, SurfaceRef};

    use super::*;

    fn icon() -> Icon {
        Icon::Rgba {
            data: vec![0, 0, 0, 0],
            width: 1,
            height: 1,
        }
    }

    #[test]
    fn menu_ids_preserve_full_route_context() {
        let projection = TrayIconProjection::from_surface_projection(&SurfaceProjection {
            surface: SurfaceRef {
                space_id: "surface:1".to_string(),
            },
            title: Some("Host".to_string()),
            tooltip: None,
            icon: None,
            trays: vec![
                TrayProjection {
                    tray_id: "tray/a".to_string(),
                    title: "A".to_string(),
                    tooltip: None,
                    icon: icon(),
                    menu: Some(menu(1)),
                },
                TrayProjection {
                    tray_id: "tray/b".to_string(),
                    title: "B".to_string(),
                    tooltip: None,
                    icon: icon(),
                    menu: Some(menu(1)),
                },
            ],
        });

        let left = first_menu_id(&projection.trays[0]);
        let right = first_menu_id(&projection.trays[1]);

        assert_ne!(left, right);
        assert_eq!(
            projection.routes.menu_event(&left),
            Some(TrayEvent::MenuClick {
                space_id: "surface:1".to_string(),
                tray_id: "tray/a".to_string(),
                item_id: 1,
            })
        );
    }

    #[test]
    fn submenu_routes_nested_items() {
        let projection = TrayIconProjection::from_surface_projection(&SurfaceProjection {
            surface: SurfaceRef {
                space_id: "surface-1".to_string(),
            },
            title: None,
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon: icon(),
                menu: Some(Menu {
                    items: vec![MenuItem::Submenu {
                        title: "More".to_string(),
                        enabled: true,
                        items: vec![MenuItem::Check {
                            id: 9,
                            title: "Enabled".to_string(),
                            enabled: true,
                            checked: true,
                        }],
                    }],
                }),
            }],
        });

        assert!(projection
            .routes
            .menu_event("opentray:surface-1:tray-1:9")
            .is_some());
    }

    #[test]
    fn primary_event_routes_to_same_menu_click() {
        let projection = TrayIconProjection::from_surface_projection(&SurfaceProjection {
            surface: SurfaceRef {
                space_id: "surface-1".to_string(),
            },
            title: None,
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon: icon(),
                menu: Some(Menu {
                    items: vec![primary_item(8, "Show Window", true, true)],
                }),
            }],
        });

        let tray = &projection.trays[0];
        assert_eq!(tray.tray_icon_id, "opentray-tray:surface-1:tray-1");
        assert!(tray.menu.has_primary_event());
        assert!(tray.menu.has_single_primary_event());
        assert_eq!(
            projection.routes.primary_event(&tray.tray_icon_id),
            Some(TrayEvent::MenuClick {
                space_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 8,
            })
        );
    }

    #[test]
    fn disabled_primary_event_is_not_direct_target() {
        let projection = TrayIconProjection::from_surface_projection(&SurfaceProjection {
            surface: SurfaceRef {
                space_id: "surface-1".to_string(),
            },
            title: None,
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon: icon(),
                menu: Some(Menu {
                    items: vec![primary_item(8, "Show Window", true, false)],
                }),
            }],
        });

        let tray = &projection.trays[0];
        assert!(tray.menu.primary_menu_id.is_none());
        assert_eq!(projection.routes.primary_event(&tray.tray_icon_id), None);
    }

    #[test]
    fn duplicate_primary_events_use_first_enabled_item() {
        let projection = TrayIconProjection::from_surface_projection(&SurfaceProjection {
            surface: SurfaceRef {
                space_id: "surface-1".to_string(),
            },
            title: None,
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon: icon(),
                menu: Some(Menu {
                    items: vec![
                        primary_item(8, "Show Window", true, true),
                        primary_item(9, "Other", true, true),
                    ],
                }),
            }],
        });

        let tray = &projection.trays[0];
        assert!(tray.menu.has_primary_event());
        assert!(!tray.menu.has_single_primary_event());
        assert_eq!(
            projection.routes.primary_event(&tray.tray_icon_id),
            Some(TrayEvent::MenuClick {
                space_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 8,
            })
        );
    }

    fn menu(id: MenuItemId) -> Menu {
        Menu {
            items: vec![MenuItem::Item {
                id,
                title: "Open".to_string(),
                primary_event: false,
                enabled: true,
                shortcut: None,
            }],
        }
    }

    fn primary_item(id: MenuItemId, title: &str, primary_event: bool, enabled: bool) -> MenuItem {
        MenuItem::Item {
            id,
            title: title.to_string(),
            primary_event,
            enabled,
            shortcut: None,
        }
    }

    fn first_menu_id(tray: &TrayIconTrayProjection) -> String {
        match &tray.menu.entries[0] {
            TrayIconMenuEntry::Item { menu_id, .. } => menu_id.clone(),
            entry => panic!("unexpected menu entry: {entry:?}"),
        }
    }
}
