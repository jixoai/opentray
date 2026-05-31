use opentray_core::{SurfaceProjection, TrayProjection};
use opentray_spec::{Icon, Menu, MenuItem, SurfaceRef, Tooltip};

pub fn surface_projection() -> SurfaceProjection {
    SurfaceProjection {
        surface: SurfaceRef {
            surface_id: "human-check".to_string(),
            app_id: "examples".to_string(),
        },
        title: Some("OpenTray Human Check".to_string()),
        tooltip: Some(Tooltip {
            title: "Projection".to_string(),
            description: "Built without a native GUI loop".to_string(),
        }),
        icon: None,
        trays: vec![TrayProjection {
            tray_id: "status".to_string(),
            title: "Status".to_string(),
            tooltip: Some(Tooltip {
                title: "Injected runtime".to_string(),
                description: "Applied by the example runtime atom".to_string(),
            }),
            icon: Icon::Rgba {
                data: visible_icon_rgba(),
                width: 32,
                height: 32,
            },
            menu: Some(Menu {
                items: vec![
                    MenuItem::Item {
                        id: 42,
                        title: "Open Panel".to_string(),
                        enabled: true,
                        shortcut: Some("CmdOrCtrl+O".to_string()),
                    },
                    MenuItem::Separator,
                    MenuItem::Check {
                        id: 43,
                        title: "Enabled".to_string(),
                        enabled: true,
                        checked: true,
                    },
                    MenuItem::Item {
                        id: 99,
                        title: "Quit Example".to_string(),
                        enabled: true,
                        shortcut: Some("CmdOrCtrl+Q".to_string()),
                    },
                ],
            }),
        }],
    }
}

pub fn visible_icon_rgba() -> Vec<u8> {
    let width = 32;
    let height = 32;
    let mut data = Vec::with_capacity(width * height * 4);

    for y in 0..height {
        for x in 0..width {
            let in_core = (10..22).contains(&x) && (10..22).contains(&y);
            let in_cross = (x >= 14 && x <= 17) || (y >= 14 && y <= 17);
            let (r, g, b, a) = if in_core || in_cross {
                (36, 170, 255, 255)
            } else {
                (12, 12, 12, 0)
            };

            data.extend([r, g, b, a]);
        }
    }

    data
}
