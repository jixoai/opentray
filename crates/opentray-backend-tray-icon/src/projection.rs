use std::{collections::HashMap, io::Cursor};

use opentray_core::{AppProjection, TrayProjection};
use opentray_spec::{
    AppId, Icon, IconImage, Menu, MenuItem, MenuItemId, Tooltip, TrayEvent, TrayId,
};
use png::{ColorType, Decoder, Transformations};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconProjection {
    pub app_id: AppId,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Option<TrayIconAsset>,
    pub trays: Vec<TrayIconTrayProjection>,
    pub routes: TrayIconRouteTable,
}

impl TrayIconProjection {
    pub fn from_app_projection(
        projection: &AppProjection,
    ) -> Result<Self, opentray_core::BackendError> {
        let mut routes = TrayIconRouteTable::default();
        let fallback_title = projection
            .title
            .as_deref()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or(&projection.app.app_id);
        let trays = projection
            .trays
            .iter()
            .map(|tray| {
                TrayIconTrayProjection::from_tray_projection(
                    &projection.app.app_id,
                    fallback_title,
                    tray,
                    &mut routes,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            app_id: projection.app.app_id.clone(),
            title: projection.title.clone(),
            tooltip: projection.tooltip.clone(),
            icon: projection
                .icon
                .as_ref()
                .and_then(TrayIconSelection::from_app_icon)
                .map(TrayIconAsset::from_selection)
                .transpose()?,
            trays,
            routes,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconTrayProjection {
    pub tray_icon_id: String,
    pub tray_id: TrayId,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Option<TrayIconAsset>,
    pub menu: TrayIconMenuProjection,
}

impl TrayIconTrayProjection {
    fn from_tray_projection(
        app_id: &str,
        fallback_title: &str,
        tray: &TrayProjection,
        routes: &mut TrayIconRouteTable,
    ) -> Result<Self, opentray_core::BackendError> {
        let tray_icon_id = stable_tray_icon_id(app_id, &tray.tray_id);
        routes.insert_tray(&tray_icon_id, app_id, &tray.tray_id);
        let menu =
            TrayIconMenuProjection::from_menu(app_id, &tray.tray_id, tray.menu.as_ref(), routes);
        if let Some(primary_menu_id) = menu.primary_menu_id.clone() {
            routes.insert_primary_event(&tray_icon_id, primary_menu_id);
        }

        let selection = tray.icon.as_ref().and_then(TrayIconSelection::from_icon);
        let icon = selection
            .as_ref()
            .map(|selection| TrayIconAsset::from_selection(*selection))
            .transpose()?;
        let title = selection
            .and_then(|selection| selection.text.cloned())
            .or_else(|| tray.icon.as_ref().and_then(|icon| icon.text_only.clone()))
            .or_else(|| {
                if icon.as_ref().is_some_and(TrayIconAsset::has_visible_pixels) {
                    None
                } else {
                    Some(fallback_title.to_string())
                }
            });

        Ok(Self {
            tray_icon_id,
            tray_id: tray.tray_id.clone(),
            title,
            tooltip: tray.tooltip.clone(),
            icon,
            menu,
        })
    }
}

#[derive(Clone, Copy)]
struct TrayIconSelection<'a> {
    image: &'a IconImage,
    text: Option<&'a String>,
    is_template: bool,
}

impl<'a> TrayIconSelection<'a> {
    fn from_icon(icon: &'a Icon) -> Option<Self> {
        let os = current_icon_os();
        if let Some(selection) = effective_icon_only(icon, os) {
            return Some(selection);
        }
        if icon.text_only.is_some() {
            return None;
        }
        if let Some(selection) = effective_icon_text(icon, os) {
            return Some(selection);
        }
        icon.fallback.as_ref().map(|fallback| Self {
            image: &fallback.image,
            text: fallback.text.as_ref(),
            is_template: false,
        })
    }

    fn from_app_icon(icon: &'a Icon) -> Option<Self> {
        let os = current_icon_os();
        let platform_icon = match os {
            IconOs::Darwin => icon
                .darwin_icon_only
                .as_ref()
                .filter(|candidate| !candidate.is_template)
                .map(|candidate| Self {
                    image: &candidate.image,
                    text: None,
                    is_template: false,
                }),
            IconOs::Win32 => icon.win32_icon_only.as_ref().map(|image| Self {
                image,
                text: None,
                is_template: false,
            }),
            IconOs::Linux => icon.linux_icon_only.as_ref().map(|image| Self {
                image,
                text: None,
                is_template: false,
            }),
            IconOs::Other => None,
        };
        platform_icon
            .or_else(|| {
                icon.icon_only.as_ref().map(|image| Self {
                    image,
                    text: None,
                    is_template: false,
                })
            })
            .or_else(|| match os {
                IconOs::Darwin => icon
                    .darwin_icon_text
                    .as_ref()
                    .filter(|candidate| !candidate.is_template)
                    .map(|candidate| Self {
                        image: &candidate.image,
                        text: Some(&candidate.text),
                        is_template: false,
                    }),
                IconOs::Win32 => icon.win32_icon_text.as_ref().map(|candidate| Self {
                    image: &candidate.image,
                    text: Some(&candidate.text),
                    is_template: false,
                }),
                IconOs::Linux => icon.linux_icon_text.as_ref().map(|candidate| Self {
                    image: &candidate.image,
                    text: Some(&candidate.text),
                    is_template: false,
                }),
                IconOs::Other => None,
            })
            .or_else(|| {
                icon.icon_text.as_ref().map(|candidate| Self {
                    image: &candidate.image,
                    text: Some(&candidate.text),
                    is_template: false,
                })
            })
            .or_else(|| {
                icon.fallback.as_ref().map(|fallback| Self {
                    image: &fallback.image,
                    text: fallback.text.as_ref(),
                    is_template: false,
                })
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IconOs {
    Darwin,
    Win32,
    Linux,
    Other,
}

fn current_icon_os() -> IconOs {
    if cfg!(target_os = "macos") {
        IconOs::Darwin
    } else if cfg!(target_os = "windows") {
        IconOs::Win32
    } else if cfg!(target_os = "linux") {
        IconOs::Linux
    } else {
        IconOs::Other
    }
}

fn effective_icon_only(icon: &Icon, os: IconOs) -> Option<TrayIconSelection<'_>> {
    match os {
        IconOs::Darwin => icon
            .darwin_icon_only
            .as_ref()
            .map(|candidate| TrayIconSelection {
                image: &candidate.image,
                text: None,
                is_template: candidate.is_template,
            }),
        IconOs::Win32 => icon
            .win32_icon_only
            .as_ref()
            .map(|image| TrayIconSelection {
                image,
                text: None,
                is_template: false,
            }),
        IconOs::Linux => icon
            .linux_icon_only
            .as_ref()
            .map(|image| TrayIconSelection {
                image,
                text: None,
                is_template: false,
            }),
        IconOs::Other => None,
    }
    .or_else(|| {
        icon.icon_only.as_ref().map(|image| TrayIconSelection {
            image,
            text: None,
            is_template: false,
        })
    })
}

fn effective_icon_text(icon: &Icon, os: IconOs) -> Option<TrayIconSelection<'_>> {
    match os {
        IconOs::Darwin => icon
            .darwin_icon_text
            .as_ref()
            .map(|candidate| TrayIconSelection {
                image: &candidate.image,
                text: Some(&candidate.text),
                is_template: candidate.is_template,
            }),
        IconOs::Win32 => icon
            .win32_icon_text
            .as_ref()
            .map(|candidate| TrayIconSelection {
                image: &candidate.image,
                text: Some(&candidate.text),
                is_template: false,
            }),
        IconOs::Linux => icon
            .linux_icon_text
            .as_ref()
            .map(|candidate| TrayIconSelection {
                image: &candidate.image,
                text: Some(&candidate.text),
                is_template: false,
            }),
        IconOs::Other => None,
    }
    .or_else(|| {
        icon.icon_text.as_ref().map(|candidate| TrayIconSelection {
            image: &candidate.image,
            text: Some(&candidate.text),
            is_template: false,
        })
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayIconAsset {
    Rgba {
        data: Vec<u8>,
        width: u32,
        height: u32,
        is_template: bool,
    },
}

impl TrayIconAsset {
    pub fn has_visible_pixels(&self) -> bool {
        match self {
            Self::Rgba { data, .. } => data.chunks_exact(4).any(|pixel| pixel[3] != 0),
        }
    }

    pub fn is_template(&self) -> bool {
        match self {
            Self::Rgba { is_template, .. } => *is_template,
        }
    }

    fn from_selection(
        selection: TrayIconSelection<'_>,
    ) -> Result<Self, opentray_core::BackendError> {
        Self::from_icon_image(selection.image, selection.is_template)
    }

    fn from_icon_image(
        image: &IconImage,
        is_template: bool,
    ) -> Result<Self, opentray_core::BackendError> {
        match image {
            IconImage::Rgba {
                data,
                width,
                height,
            } => Self::from_rgba(data, *width, *height, is_template),
            IconImage::Encoded { data } => decode_png_bytes(
                data,
                "encoded tray icon bytes",
                "tray_icon_encoded_decode_failed",
                is_template,
            ),
            IconImage::File { path } => decode_png_file(path, is_template),
        }
    }

    fn from_rgba(
        data: &[u8],
        width: u32,
        height: u32,
        is_template: bool,
    ) -> Result<Self, opentray_core::BackendError> {
        validate_rgba_dimensions(width, height, "rgba tray icon")?;
        let expected_length = rgba_byte_len(width, height)?;
        if data.len() != expected_length {
            return Err(tray_icon_failure(
                "tray_icon_rgba_invalid_length",
                format!(
                    "rgba tray icon requires {expected_length} bytes for {width}x{height}, got {}",
                    data.len()
                ),
            ));
        }

        Ok(Self::Rgba {
            data: data.to_vec(),
            width,
            height,
            is_template,
        })
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
        app_id: &str,
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
                            app_id,
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
    pub app_id: AppId,
    pub tray_id: TrayId,
    pub item_id: MenuItemId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayIconTrayRoute {
    pub app_id: AppId,
    pub tray_id: TrayId,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrayIconRouteTable {
    routes: HashMap<String, TrayIconMenuRoute>,
    tray_routes: HashMap<String, TrayIconTrayRoute>,
    primary_routes: HashMap<String, String>,
}

impl TrayIconRouteTable {
    pub fn menu_event(&self, menu_id: &str) -> Option<TrayEvent> {
        self.routes.get(menu_id).map(|route| TrayEvent::MenuClick {
            app_id: route.app_id.clone(),
            tray_id: route.tray_id.clone(),
            item_id: route.item_id,
        })
    }

    pub fn primary_event(&self, tray_icon_id: &str) -> Option<TrayEvent> {
        self.primary_routes
            .get(tray_icon_id)
            .and_then(|menu_id| self.menu_event(menu_id))
    }

    pub fn tray_click_event(
        &self,
        tray_icon_id: &str,
        button: opentray_spec::MouseButton,
        x: i32,
        y: i32,
    ) -> Option<TrayEvent> {
        self.tray_routes
            .get(tray_icon_id)
            .map(|route| TrayEvent::TrayClick {
                app_id: route.app_id.clone(),
                tray_id: route.tray_id.clone(),
                button,
                x,
                y,
            })
    }

    fn insert_tray(&mut self, tray_icon_id: &str, app_id: &str, tray_id: &str) {
        self.tray_routes.insert(
            tray_icon_id.to_string(),
            TrayIconTrayRoute {
                app_id: app_id.to_string(),
                tray_id: tray_id.to_string(),
            },
        );
    }

    fn insert(&mut self, app_id: &str, tray_id: &str, item_id: MenuItemId) -> String {
        let menu_id = stable_menu_id(app_id, tray_id, item_id);
        self.routes.insert(
            menu_id.clone(),
            TrayIconMenuRoute {
                app_id: app_id.to_string(),
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
    app_id: &str,
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
            let menu_id = routes.insert(app_id, tray_id, *id);
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
                menu_id: routes.insert(app_id, tray_id, *id),
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
                menu_id: routes.insert(app_id, tray_id, *id),
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
                        app_id,
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

pub(crate) fn stable_tray_icon_id(app_id: &str, tray_id: &str) -> String {
    format!(
        "opentray-tray:{}:{}",
        encode_component(app_id),
        encode_component(tray_id)
    )
}

fn stable_menu_id(app_id: &str, tray_id: &str, item_id: MenuItemId) -> String {
    format!(
        "opentray:{}:{}:{}",
        encode_component(app_id),
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

fn decode_png_file(
    path: &str,
    is_template: bool,
) -> Result<TrayIconAsset, opentray_core::BackendError> {
    let bytes = std::fs::read(path).map_err(|error| {
        tray_icon_failure(
            "tray_icon_file_read_failed",
            format!("failed to read tray icon file {path}: {error}"),
        )
    })?;
    decode_png_bytes(
        &bytes,
        &format!("file tray icon: {path}"),
        "tray_icon_file_decode_failed",
        is_template,
    )
}

fn decode_png_bytes(
    bytes: &[u8],
    source: &str,
    error_code: &'static str,
    is_template: bool,
) -> Result<TrayIconAsset, opentray_core::BackendError> {
    let mut decoder = Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(Transformations::normalize_to_color8() | Transformations::ALPHA);
    let mut reader = decoder.read_info().map_err(|error| {
        tray_icon_failure(
            error_code,
            format!("failed to decode {source} as PNG: {error}"),
        )
    })?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).map_err(|error| {
        tray_icon_failure(
            error_code,
            format!("failed to decode {source} as PNG: {error}"),
        )
    })?;
    buffer.truncate(info.buffer_size());

    let data = match info.color_type {
        ColorType::Rgba => buffer,
        ColorType::Rgb => rgb_to_rgba(buffer, source, error_code)?,
        ColorType::GrayscaleAlpha => grayscale_alpha_to_rgba(buffer, source, error_code)?,
        ColorType::Grayscale => grayscale_to_rgba(buffer, source, error_code)?,
        other => {
            return Err(tray_icon_failure(
                error_code,
                format!("decoded {source} into unsupported PNG color type {other:?}"),
            ));
        }
    };

    Ok(TrayIconAsset::Rgba {
        data,
        width: info.width,
        height: info.height,
        is_template,
    })
}

fn rgb_to_rgba(
    data: Vec<u8>,
    source: &str,
    error_code: &'static str,
) -> Result<Vec<u8>, opentray_core::BackendError> {
    let mut output = Vec::with_capacity((data.len() / 3).saturating_mul(4));
    let chunks = data.chunks_exact(3);
    if !chunks.remainder().is_empty() {
        return Err(tray_icon_failure(
            error_code,
            format!(
                "decoded {source} into malformed RGB data with {} bytes",
                data.len()
            ),
        ));
    }
    for chunk in chunks {
        output.extend_from_slice(chunk);
        output.push(255);
    }
    Ok(output)
}

fn grayscale_alpha_to_rgba(
    data: Vec<u8>,
    source: &str,
    error_code: &'static str,
) -> Result<Vec<u8>, opentray_core::BackendError> {
    let mut output = Vec::with_capacity((data.len() / 2).saturating_mul(4));
    let chunks = data.chunks_exact(2);
    if !chunks.remainder().is_empty() {
        return Err(tray_icon_failure(
            error_code,
            format!(
                "decoded {source} into malformed grayscale-alpha data with {} bytes",
                data.len()
            ),
        ));
    }
    for chunk in chunks {
        let gray = chunk[0];
        let alpha = chunk[1];
        output.extend_from_slice(&[gray, gray, gray, alpha]);
    }
    Ok(output)
}

fn grayscale_to_rgba(
    data: Vec<u8>,
    source: &str,
    error_code: &'static str,
) -> Result<Vec<u8>, opentray_core::BackendError> {
    let mut output = Vec::with_capacity(data.len().saturating_mul(4));
    for gray in data {
        output.extend_from_slice(&[gray, gray, gray, 255]);
    }
    if output.is_empty() {
        return Err(tray_icon_failure(
            error_code,
            format!("decoded {source} into empty grayscale data"),
        ));
    }
    Ok(output)
}

fn validate_rgba_dimensions(
    width: u32,
    height: u32,
    source: &str,
) -> Result<(), opentray_core::BackendError> {
    if width == 0 {
        return Err(tray_icon_failure(
            "tray_icon_rgba_invalid_size",
            format!("{source} width must be a positive integer, got {width}"),
        ));
    }
    if height == 0 {
        return Err(tray_icon_failure(
            "tray_icon_rgba_invalid_size",
            format!("{source} height must be a positive integer, got {height}"),
        ));
    }
    Ok(())
}

fn rgba_byte_len(width: u32, height: u32) -> Result<usize, opentray_core::BackendError> {
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| {
            tray_icon_failure(
                "tray_icon_rgba_invalid_size",
                "rgba tray icon dimensions overflow".to_string(),
            )
        })?;
    pixels.checked_mul(4).ok_or_else(|| {
        tray_icon_failure(
            "tray_icon_rgba_invalid_size",
            "rgba tray icon byte size overflow".to_string(),
        )
    })
}

fn tray_icon_failure(
    code: &'static str,
    message: impl Into<String>,
) -> opentray_core::BackendError {
    opentray_core::BackendError::Failure(format!("{code}: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Cursor,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use opentray_spec::{
        AppRef, DarwinIcon, DarwinIconText, Icon, IconImage, IconText, Menu, MenuItem, SimpleIcon,
    };
    use png::Encoder;

    use super::*;

    fn icon() -> Option<Icon> {
        Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1))
    }

    #[test]
    fn menu_ids_preserve_full_route_context() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface:1".to_string(),
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
        })
        .expect("projection");

        let left = first_menu_id(&projection.trays[0]);
        let right = first_menu_id(&projection.trays[1]);

        assert_ne!(left, right);
        assert_eq!(
            projection.routes.menu_event(&left),
            Some(TrayEvent::MenuClick {
                app_id: "surface:1".to_string(),
                tray_id: "tray/a".to_string(),
                item_id: 1,
            })
        );
    }

    #[test]
    fn submenu_routes_nested_items() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
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
        })
        .expect("projection");

        assert!(projection
            .routes
            .menu_event("opentray:surface-1:tray-1:9")
            .is_some());
    }

    #[test]
    fn primary_event_routes_to_same_menu_click() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
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
        })
        .expect("projection");

        let tray = &projection.trays[0];
        assert_eq!(tray.tray_icon_id, "opentray-tray:surface-1:tray-1");
        assert!(tray.menu.has_primary_event());
        assert_eq!(
            projection.routes.primary_event(&tray.tray_icon_id),
            Some(TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 8,
            })
        );
    }

    #[test]
    fn tray_click_routes_to_owning_tray() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
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
        })
        .expect("projection");

        let tray = &projection.trays[0];
        assert_eq!(
            projection.routes.tray_click_event(
                &tray.tray_icon_id,
                opentray_spec::MouseButton::Left,
                10,
                20
            ),
            Some(TrayEvent::TrayClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                button: opentray_spec::MouseButton::Left,
                x: 10,
                y: 20,
            })
        );
    }

    #[test]
    fn disabled_primary_event_is_not_direct_target() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
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
        })
        .expect("projection");

        let tray = &projection.trays[0];
        assert!(tray.menu.primary_menu_id.is_none());
        assert_eq!(projection.routes.primary_event(&tray.tray_icon_id), None);
    }

    #[test]
    fn duplicate_primary_events_use_first_enabled_item() {
        let projection = TrayIconProjection::from_app_projection(&AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
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
        })
        .expect("projection");

        let tray = &projection.trays[0];
        assert!(tray.menu.has_primary_event());
        assert_eq!(
            projection.routes.primary_event(&tray.tray_icon_id),
            Some(TrayEvent::MenuClick {
                app_id: "surface-1".to_string(),
                tray_id: "tray-1".to_string(),
                item_id: 8,
            })
        );
    }

    #[test]
    fn encoded_png_icon_is_normalized_to_rgba() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_icon(
            Icon::encoded(rgba_png_bytes(&[13, 37, 91, 255], 1, 1)),
        ))
        .expect("projection");

        assert_eq!(
            projection.trays[0].icon,
            Some(TrayIconAsset::Rgba {
                data: vec![13, 37, 91, 255],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
    }

    #[test]
    fn file_png_icon_is_normalized_to_rgba() {
        let path = temp_png_path("file_png_icon_is_normalized_to_rgba");
        fs::write(&path, rgba_png_bytes(&[21, 42, 84, 255], 1, 1)).expect("write png");

        let projection = TrayIconProjection::from_app_projection(&projection_with_icon(
            Icon::file(path.to_string_lossy().into_owned()),
        ))
        .expect("projection");

        let _ = fs::remove_file(&path);
        assert_eq!(
            projection.trays[0].icon,
            Some(TrayIconAsset::Rgba {
                data: vec![21, 42, 84, 255],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
    }

    #[test]
    fn missing_icon_projects_app_name_as_visible_tray_text() {
        let projection =
            TrayIconProjection::from_app_projection(&projection_with_optional_icon(None))
                .expect("projection");

        assert_eq!(projection.trays[0].icon, None);
        assert_eq!(projection.trays[0].title.as_deref(), Some("Status App"));
    }

    #[test]
    fn template_only_darwin_icon_is_not_projected_as_application_artwork() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_app_icon(Icon {
            icon_only: None,
            darwin_icon_only: Some(DarwinIcon {
                image: rgba_image([1, 2, 3, 4]),
                is_template: true,
            }),
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        }))
        .expect("projection");

        assert_eq!(projection.icon, None);
    }

    #[test]
    fn generic_app_artwork_survives_a_template_only_darwin_candidate() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_app_icon(Icon {
            icon_only: Some(rgba_image([9, 10, 11, 12])),
            darwin_icon_only: Some(DarwinIcon {
                image: rgba_image([1, 2, 3, 4]),
                is_template: true,
            }),
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        }))
        .expect("projection");

        assert_eq!(
            projection.icon,
            Some(TrayIconAsset::Rgba {
                data: vec![9, 10, 11, 12],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
    }

    #[test]
    fn transparent_icon_projects_app_name_as_visible_tray_text() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_optional_icon(
            Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1)),
        ))
        .expect("projection");

        assert_eq!(
            projection.trays[0].icon,
            Some(TrayIconAsset::Rgba {
                data: vec![0, 0, 0, 0],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
        assert_eq!(projection.trays[0].title.as_deref(), Some("Status App"));
    }

    #[test]
    fn invalid_png_icon_reports_typed_failure() {
        let error =
            TrayIconProjection::from_app_projection(&projection_with_icon(Icon::encoded(vec![
                0, 1, 2,
            ])))
            .expect_err("projection");

        assert!(matches!(
            error,
            opentray_core::BackendError::Failure(message) if message.contains("tray_icon_encoded_decode_failed")
        ));
    }

    #[test]
    fn responsive_icon_prefers_icon_only_candidate() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_icon(Icon {
            icon_only: Some(IconImage::Rgba {
                data: vec![1, 2, 3, 4],
                width: 1,
                height: 1,
            }),
            darwin_icon_only: None,
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: Some(IconText {
                image: IconImage::Rgba {
                    data: vec![5, 6, 7, 8],
                    width: 1,
                    height: 1,
                },
                text: "Visible".to_string(),
            }),
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: Some(SimpleIcon {
                image: IconImage::Rgba {
                    data: vec![9, 10, 11, 12],
                    width: 1,
                    height: 1,
                },
                text: Some("Fallback".to_string()),
            }),
        }))
        .expect("projection");

        assert_eq!(
            projection.trays[0].icon,
            Some(TrayIconAsset::Rgba {
                data: vec![1, 2, 3, 4],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
        assert_eq!(projection.trays[0].title, None);
    }

    #[test]
    fn text_only_icon_preserves_unsupported_image_absence() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_icon(Icon {
            icon_only: None,
            darwin_icon_only: None,
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: Some("Build".to_string()),
            icon_text: Some(IconText {
                image: IconImage::Rgba {
                    data: vec![5, 6, 7, 8],
                    width: 1,
                    height: 1,
                },
                text: "Build".to_string(),
            }),
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: Some(SimpleIcon {
                image: IconImage::Rgba {
                    data: vec![9, 10, 11, 12],
                    width: 1,
                    height: 1,
                },
                text: Some("Fallback".to_string()),
            }),
        }))
        .expect("projection");

        assert_eq!(projection.trays[0].icon, None);
        assert_eq!(projection.trays[0].title.as_deref(), Some("Build"));
    }

    #[test]
    fn icon_text_candidate_supplies_visible_text_when_image_supported() {
        let projection = TrayIconProjection::from_app_projection(&projection_with_icon(Icon {
            icon_only: None,
            darwin_icon_only: None,
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: Some(IconText {
                image: IconImage::Rgba {
                    data: vec![5, 6, 7, 8],
                    width: 1,
                    height: 1,
                },
                text: "Build".to_string(),
            }),
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        }))
        .expect("projection");

        assert_eq!(
            projection.trays[0].icon,
            Some(TrayIconAsset::Rgba {
                data: vec![5, 6, 7, 8],
                width: 1,
                height: 1,
                is_template: false,
            })
        );
        assert_eq!(projection.trays[0].title.as_deref(), Some("Build"));
    }

    #[test]
    fn darwin_icon_only_shadows_generic_icon_only_candidate() {
        let icon = Icon {
            icon_only: Some(rgba_image([1, 2, 3, 4])),
            darwin_icon_only: Some(DarwinIcon {
                image: rgba_image([5, 6, 7, 8]),
                is_template: true,
            }),
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        };

        let selection = effective_icon_only(&icon, IconOs::Darwin).expect("selection");

        assert_selection(selection, &[5, 6, 7, 8], None, true);
    }

    #[test]
    fn win32_icon_only_shadows_generic_icon_only_candidate() {
        let icon = Icon {
            icon_only: Some(rgba_image([1, 2, 3, 4])),
            darwin_icon_only: None,
            win32_icon_only: Some(rgba_image([9, 10, 11, 12])),
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        };

        let selection = effective_icon_only(&icon, IconOs::Win32).expect("selection");

        assert_selection(selection, &[9, 10, 11, 12], None, false);
    }

    #[test]
    fn non_matching_os_icon_candidate_does_not_shadow_generic() {
        let icon = Icon {
            icon_only: Some(rgba_image([1, 2, 3, 4])),
            darwin_icon_only: None,
            win32_icon_only: Some(rgba_image([9, 10, 11, 12])),
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        };

        let selection = effective_icon_only(&icon, IconOs::Darwin).expect("selection");

        assert_selection(selection, &[1, 2, 3, 4], None, false);
    }

    #[test]
    fn darwin_icon_text_carries_template_and_visible_text() {
        let icon = Icon {
            icon_only: None,
            darwin_icon_only: None,
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: Some(IconText {
                image: rgba_image([1, 2, 3, 4]),
                text: "Generic".to_string(),
            }),
            darwin_icon_text: Some(DarwinIconText {
                image: rgba_image([5, 6, 7, 8]),
                text: "Darwin".to_string(),
                is_template: true,
            }),
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: None,
        };

        let selection = effective_icon_text(&icon, IconOs::Darwin).expect("selection");

        assert_selection(selection, &[5, 6, 7, 8], Some("Darwin"), true);
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

    fn rgba_image(data: [u8; 4]) -> IconImage {
        IconImage::Rgba {
            data: data.to_vec(),
            width: 1,
            height: 1,
        }
    }

    fn assert_selection(
        selection: TrayIconSelection<'_>,
        expected_data: &[u8],
        expected_text: Option<&str>,
        expected_template: bool,
    ) {
        match selection.image {
            IconImage::Rgba {
                data,
                width,
                height,
            } => {
                assert_eq!(data, expected_data);
                assert_eq!((*width, *height), (1, 1));
            }
            image => panic!("unexpected image: {image:?}"),
        }
        assert_eq!(selection.text.map(String::as_str), expected_text);
        assert_eq!(selection.is_template, expected_template);
    }

    fn projection_with_icon(icon: Icon) -> AppProjection {
        projection_with_optional_icon(Some(icon))
    }

    fn projection_with_app_icon(icon: Icon) -> AppProjection {
        AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
            },
            title: Some("Status App".to_string()),
            tooltip: None,
            icon: Some(icon),
            trays: vec![],
        }
    }

    fn projection_with_optional_icon(icon: Option<Icon>) -> AppProjection {
        AppProjection {
            app: AppRef {
                app_id: "surface-1".to_string(),
            },
            title: Some("Status App".to_string()),
            tooltip: None,
            icon: None,
            trays: vec![TrayProjection {
                tray_id: "tray-1".to_string(),
                title: "Tray".to_string(),
                tooltip: None,
                icon,
                menu: None,
            }],
        }
    }

    fn rgba_png_bytes(data: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut output = Vec::new();
        let mut encoder = Encoder::new(Cursor::new(&mut output), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(data).expect("png data");
        drop(writer);
        output
    }

    fn temp_png_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "opentray-backend-tray-icon-{name}-{}-{nonce}.png",
            std::process::id()
        ))
    }
}
