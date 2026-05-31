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
                data: vec![0, 0, 0, 255],
                width: 1,
                height: 1,
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
                ],
            }),
        }],
    }
}
