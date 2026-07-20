use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

pub type SessionId = String;
pub type AppId = String;
pub type TrayId = String;
pub type MenuItemId = u32;

/// Canonical App icon variant used when an asset omits `variant`.
pub const DEFAULT_APP_ICON_VARIANT: &str = "default";

/// One validated set of native application identity assets.
///
/// The transparent representation keeps the wire shape as an array while the
/// newtype prevents invalid assets from entering Core through Rust callers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct AppIcon(Vec<AppIconAsset>);

impl AppIcon {
    pub fn assets(&self) -> &[AppIconAsset] {
        &self.0
    }

    pub fn darwin(&self) -> Option<&AppIconSource> {
        self.0.iter().find_map(|asset| match asset {
            AppIconAsset::Darwin { source, .. } => Some(source),
            _ => None,
        })
    }

    pub fn windows(&self) -> Option<&AppIconSource> {
        self.0.iter().find_map(|asset| match asset {
            AppIconAsset::Windows { source, .. } => Some(source),
            _ => None,
        })
    }

    /// Returns whether at least one asset declares the semantic variant.
    pub fn has_variant(&self, variant: &str) -> bool {
        self.0.iter().any(|asset| asset.has_variant(variant))
    }

    /// Produces a platform-neutral projection containing only matching assets.
    pub fn for_variant(&self, variant: &str) -> Option<Self> {
        let assets = self
            .0
            .iter()
            .filter(|asset| asset.has_variant(variant))
            .cloned()
            .collect::<Vec<_>>();
        (!assets.is_empty()).then_some(Self(assets))
    }

    fn validate(assets: &[AppIconAsset]) -> Result<(), String> {
        if assets.is_empty() {
            return Err("appIcon asset array must not be empty".to_string());
        }
        let mut darwin = std::collections::HashSet::new();
        let mut windows = std::collections::HashSet::new();
        let mut linux_svg = std::collections::HashSet::new();
        let mut linux_png_sizes = std::collections::HashSet::new();
        for asset in assets {
            asset.source().validate()?;
            match asset {
                AppIconAsset::Darwin { variant, .. } => {
                    for name in variant.names() {
                        if !darwin.insert(name.clone()) {
                            return Err(format!(
                                "appIcon contains duplicate Darwin asset for variant {name}"
                            ));
                        }
                    }
                }
                AppIconAsset::Windows { variant, .. } => {
                    for name in variant.names() {
                        if !windows.insert(name.clone()) {
                            return Err(format!(
                                "appIcon contains duplicate Windows asset for variant {name}"
                            ));
                        }
                    }
                }
                AppIconAsset::LinuxPng { variant, size, .. } => {
                    if *size == 0 {
                        return Err("Linux appIcon PNG size must be greater than zero".to_string());
                    }
                    for name in variant.names() {
                        if !linux_png_sizes.insert((name.clone(), *size)) {
                            return Err(format!(
                                "appIcon contains duplicate Linux PNG size {size} for variant {name}"
                            ));
                        }
                    }
                }
                AppIconAsset::LinuxSvg { variant, .. } => {
                    for name in variant.names() {
                        if !linux_svg.insert(name.clone()) {
                            return Err(format!(
                                "appIcon contains duplicate Linux SVG asset for variant {name}"
                            ));
                        }
                    }
                }
            }
        }
        if !assets
            .iter()
            .any(|asset| asset.has_variant(DEFAULT_APP_ICON_VARIANT))
        {
            return Err("appIcon does not declare a default variant".to_string());
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for AppIcon {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let assets = Vec::<AppIconAsset>::deserialize(deserializer)?;
        Self::validate(&assets).map_err(de::Error::custom)?;
        Ok(Self(assets))
    }
}

/// A native application icon source. Raw RGBA and tray-only variants are not
/// part of this contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AppIconSource {
    Encoded { data: Vec<u8> },
    File { path: String },
}

impl AppIconSource {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Encoded { data } if data.is_empty() => {
                Err("appIcon encoded source must not be empty".to_string())
            }
            Self::File { path } if path.trim().is_empty() => {
                Err("appIcon file source path must not be empty".to_string())
            }
            _ => Ok(()),
        }
    }
}

/// One or more semantic names which select the same native App icon asset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppIconVariant(Vec<String>);

impl AppIconVariant {
    /// Returns every semantic name aliased to this native asset.
    pub fn names(&self) -> &[String] {
        &self.0
    }

    /// Returns whether this asset participates in the semantic variant.
    pub fn contains(&self, variant: &str) -> bool {
        self.0.iter().any(|name| name == variant)
    }

    fn validate(names: Vec<String>) -> Result<Self, String> {
        if names.is_empty() {
            return Err("appIcon variant array must not be empty".to_string());
        }
        let mut seen = std::collections::HashSet::new();
        for name in &names {
            if !is_valid_app_icon_variant_name(name) {
                return Err(format!(
                    "appIcon variant must match ^[a-z][a-z0-9-]{{0,63}}$: {name}"
                ));
            }
            if !seen.insert(name.clone()) {
                return Err(format!(
                    "appIcon asset contains duplicate variant name {name}"
                ));
            }
        }
        Ok(Self(names))
    }
}

impl Default for AppIconVariant {
    fn default() -> Self {
        Self(vec![DEFAULT_APP_ICON_VARIANT.to_string()])
    }
}

impl Serialize for AppIconVariant {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if let [variant] = self.0.as_slice() {
            variant.serialize(serializer)
        } else {
            self.0.serialize(serializer)
        }
    }
}

impl<'de> Deserialize<'de> for AppIconVariant {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum WireVariant {
            One(String),
            Many(Vec<String>),
        }

        let names = match WireVariant::deserialize(deserializer)? {
            WireVariant::One(name) => vec![name],
            WireVariant::Many(names) => names,
        };
        Self::validate(names).map_err(de::Error::custom)
    }
}

fn is_valid_app_icon_variant_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(first) if first.is_ascii_lowercase())
        && name.len() <= 64
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// One platform-standard application icon asset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppIconAsset {
    Darwin {
        variant: AppIconVariant,
        source: AppIconSource,
    },
    Windows {
        variant: AppIconVariant,
        source: AppIconSource,
    },
    LinuxPng {
        variant: AppIconVariant,
        size: u32,
        source: AppIconSource,
    },
    LinuxSvg {
        variant: AppIconVariant,
        source: AppIconSource,
    },
}

impl AppIconAsset {
    /// Returns the native file or encoded-byte source.
    pub fn source(&self) -> &AppIconSource {
        match self {
            Self::Darwin { source, .. }
            | Self::Windows { source, .. }
            | Self::LinuxPng { source, .. }
            | Self::LinuxSvg { source, .. } => source,
        }
    }

    /// Returns the normalized semantic variant declaration.
    pub fn variant(&self) -> &AppIconVariant {
        match self {
            Self::Darwin { variant, .. }
            | Self::Windows { variant, .. }
            | Self::LinuxPng { variant, .. }
            | Self::LinuxSvg { variant, .. } => variant,
        }
    }

    /// Returns whether this native asset participates in the semantic variant.
    pub fn has_variant(&self, variant: &str) -> bool {
        self.variant().contains(variant)
    }
}

impl Serialize for AppIconAsset {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let value = match self {
            Self::Darwin { variant, source } => serde_json::json!({
                "platform": "darwin",
                "format": "icns",
                "variant": variant,
                "source": source,
            }),
            Self::Windows { variant, source } => serde_json::json!({
                "platform": "windows",
                "format": "ico",
                "variant": variant,
                "source": source,
            }),
            Self::LinuxPng {
                variant,
                size,
                source,
            } => serde_json::json!({
                "platform": "linux",
                "format": "png",
                "variant": variant,
                "size": size,
                "source": source,
            }),
            Self::LinuxSvg { variant, source } => serde_json::json!({
                "platform": "linux",
                "format": "svg",
                "variant": variant,
                "source": source,
            }),
        };
        value.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for AppIconAsset {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireAsset {
            platform: String,
            format: String,
            source: AppIconSource,
            #[serde(default)]
            variant: AppIconVariant,
            #[serde(default)]
            size: Option<u32>,
        }

        let asset = WireAsset::deserialize(deserializer)?;
        match (asset.platform.as_str(), asset.format.as_str(), asset.size) {
            ("darwin", "icns", None) => Ok(Self::Darwin {
                variant: asset.variant,
                source: asset.source,
            }),
            ("windows", "ico", None) => Ok(Self::Windows {
                variant: asset.variant,
                source: asset.source,
            }),
            ("linux", "png", Some(size)) if size > 0 => Ok(Self::LinuxPng {
                variant: asset.variant,
                size,
                source: asset.source,
            }),
            ("linux", "svg", None) => Ok(Self::LinuxSvg {
                variant: asset.variant,
                source: asset.source,
            }),
            ("linux", "png", _) => Err(de::Error::custom(
                "Linux PNG appIcon asset requires a positive integer size",
            )),
            (platform, format, _) => Err(de::Error::custom(format!(
                "unsupported appIcon platform/format pair: {platform}/{format}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<AppId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon: Option<AppIcon>,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    pub app_id: AppId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub app_id: AppId,
    pub app_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon: Option<AppIcon>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_icon_variant: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayOptions {
    pub id: TrayId,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Icon {
    pub icon_only: Option<IconImage>,
    pub darwin_icon_only: Option<DarwinIcon>,
    pub win32_icon_only: Option<IconImage>,
    pub linux_icon_only: Option<IconImage>,
    pub text_only: Option<String>,
    pub icon_text: Option<IconText>,
    pub darwin_icon_text: Option<DarwinIconText>,
    pub win32_icon_text: Option<IconText>,
    pub linux_icon_text: Option<IconText>,
    pub fallback: Option<SimpleIcon>,
}

impl Icon {
    pub fn rgba(data: Vec<u8>, width: u32, height: u32) -> Self {
        Self::simple(IconImage::Rgba {
            data,
            width,
            height,
        })
    }

    pub fn encoded(data: Vec<u8>) -> Self {
        Self::simple(IconImage::Encoded { data })
    }

    pub fn file(path: impl Into<String>) -> Self {
        Self::simple(IconImage::File { path: path.into() })
    }

    pub fn simple(image: IconImage) -> Self {
        Self {
            icon_only: None,
            darwin_icon_only: None,
            win32_icon_only: None,
            linux_icon_only: None,
            text_only: None,
            icon_text: None,
            darwin_icon_text: None,
            win32_icon_text: None,
            linux_icon_text: None,
            fallback: Some(SimpleIcon { image, text: None }),
        }
    }
}

impl Serialize for Icon {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut object = Map::new();
        if let Some(fallback) = &self.fallback {
            merge_object(&mut object, fallback).map_err(serde::ser::Error::custom)?;
        }
        if let Some(icon_only) = &self.icon_only {
            object.insert(
                "icon-only".to_string(),
                serde_json::to_value(icon_only).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_only) = &self.darwin_icon_only {
            object.insert(
                "darwin-icon-only".to_string(),
                serde_json::to_value(icon_only).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_only) = &self.win32_icon_only {
            object.insert(
                "win32-icon-only".to_string(),
                serde_json::to_value(icon_only).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_only) = &self.linux_icon_only {
            object.insert(
                "linux-icon-only".to_string(),
                serde_json::to_value(icon_only).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(text_only) = &self.text_only {
            object.insert("text-only".to_string(), Value::String(text_only.clone()));
        }
        if let Some(icon_text) = &self.icon_text {
            object.insert(
                "icon-text".to_string(),
                serde_json::to_value(icon_text).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_text) = &self.darwin_icon_text {
            object.insert(
                "darwin-icon-text".to_string(),
                serde_json::to_value(icon_text).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_text) = &self.win32_icon_text {
            object.insert(
                "win32-icon-text".to_string(),
                serde_json::to_value(icon_text).map_err(serde::ser::Error::custom)?,
            );
        }
        if let Some(icon_text) = &self.linux_icon_text {
            object.insert(
                "linux-icon-text".to_string(),
                serde_json::to_value(icon_text).map_err(serde::ser::Error::custom)?,
            );
        }
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Icon {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("icon must be an object"))?;
        let icon_only = object
            .get("icon-only")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let darwin_icon_only = object
            .get("darwin-icon-only")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let win32_icon_only = object
            .get("win32-icon-only")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let linux_icon_only = object
            .get("linux-icon-only")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let text_only = object
            .get("text-only")
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| de::Error::custom("icon text-only must be a string"))
            })
            .transpose()?;
        let icon_text = object
            .get("icon-text")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let darwin_icon_text = object
            .get("darwin-icon-text")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let win32_icon_text = object
            .get("win32-icon-text")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let linux_icon_text = object
            .get("linux-icon-text")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?;
        let fallback = if object.contains_key("type") {
            Some(serde_json::from_value(value).map_err(de::Error::custom)?)
        } else {
            None
        };
        Ok(Self {
            icon_only,
            darwin_icon_only,
            win32_icon_only,
            linux_icon_only,
            text_only,
            icon_text,
            darwin_icon_text,
            win32_icon_text,
            linux_icon_text,
            fallback,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum IconImage {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimpleIcon {
    pub image: IconImage,
    pub text: Option<String>,
}

impl Serialize for SimpleIcon {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut object = image_object(&self.image).map_err(serde::ser::Error::custom)?;
        if let Some(text) = &self.text {
            object.insert("text".to_string(), Value::String(text.clone()));
        }
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for SimpleIcon {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("simple icon must be an object"))?;
        let image = serde_json::from_value(value.clone()).map_err(de::Error::custom)?;
        let text = object
            .get("text")
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| de::Error::custom("simple icon text must be a string"))
            })
            .transpose()?;
        Ok(Self { image, text })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconText {
    pub image: IconImage,
    pub text: String,
}

impl Serialize for IconText {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut object = image_object(&self.image).map_err(serde::ser::Error::custom)?;
        object.insert("text".to_string(), Value::String(self.text.clone()));
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for IconText {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let simple = SimpleIcon::deserialize(deserializer)?;
        let text = simple
            .text
            .ok_or_else(|| de::Error::custom("icon-text candidate requires text"))?;
        Ok(Self {
            image: simple.image,
            text,
        })
    }
}

pub type Win32Icon = IconImage;

pub type LinuxIcon = IconImage;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DarwinIcon {
    pub image: IconImage,
    pub is_template: bool,
}

impl Serialize for DarwinIcon {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut object = image_object(&self.image).map_err(serde::ser::Error::custom)?;
        if self.is_template {
            object.insert("isTemplate".to_string(), Value::Bool(true));
        }
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for DarwinIcon {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("darwin icon must be an object"))?;
        let is_template = object
            .get("isTemplate")
            .map(|value| {
                value
                    .as_bool()
                    .ok_or_else(|| de::Error::custom("darwin icon isTemplate must be a boolean"))
            })
            .transpose()?
            .unwrap_or(false);
        let image = serde_json::from_value(value).map_err(de::Error::custom)?;
        Ok(Self { image, is_template })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DarwinIconText {
    pub image: IconImage,
    pub text: String,
    pub is_template: bool,
}

impl Serialize for DarwinIconText {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut object = image_object(&self.image).map_err(serde::ser::Error::custom)?;
        object.insert("text".to_string(), Value::String(self.text.clone()));
        if self.is_template {
            object.insert("isTemplate".to_string(), Value::Bool(true));
        }
        object.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for DarwinIconText {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("darwin-icon-text candidate must be an object"))?;
        let icon = DarwinIcon::deserialize(value.clone()).map_err(de::Error::custom)?;
        let text = object
            .get("text")
            .map(|value| {
                value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                    de::Error::custom("darwin-icon-text candidate text must be a string")
                })
            })
            .transpose()?
            .ok_or_else(|| de::Error::custom("darwin-icon-text candidate requires text"))?;
        Ok(Self {
            image: icon.image,
            text,
            is_template: icon.is_template,
        })
    }
}

fn image_object(image: &IconImage) -> Result<Map<String, Value>, serde_json::Error> {
    match serde_json::to_value(image)? {
        Value::Object(object) => Ok(object),
        _ => unreachable!("IconImage serializes as an object"),
    }
}

fn merge_object<T: Serialize>(
    target: &mut Map<String, Value>,
    value: &T,
) -> Result<(), serde_json::Error> {
    match serde_json::to_value(value)? {
        Value::Object(object) => {
            target.extend(object);
            Ok(())
        }
        _ => unreachable!("icon component serializes as an object"),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn app_icon_platform_assets_roundtrip_as_an_array() {
        let value = json!([
            {
                "platform": "darwin",
                "format": "icns",
                "source": { "type": "file", "path": "AppIcon.icns" }
            },
            {
                "platform": "windows",
                "format": "ico",
                "source": { "type": "encoded", "data": [0, 0, 1, 0] }
            },
            {
                "platform": "linux",
                "format": "png",
                "size": 128,
                "source": { "type": "file", "path": "128x128/app.png" }
            },
            {
                "platform": "linux",
                "format": "svg",
                "source": { "type": "file", "path": "scalable/app.svg" }
            }
        ]);
        let app_icon: AppIcon = serde_json::from_value(value.clone()).expect("app icon");
        let normalized = serde_json::to_value(app_icon).expect("serialize");

        assert_eq!(normalized[0]["variant"], "default");
        assert_eq!(normalized[1]["variant"], "default");
        assert_eq!(normalized[2]["variant"], "default");
        assert_eq!(normalized[3]["variant"], "default");
    }

    #[test]
    fn app_icon_rejects_non_standard_formats_and_duplicate_assets() {
        let wrong_format = serde_json::from_value::<AppIcon>(json!([{
            "platform": "darwin",
            "format": "png",
            "source": { "type": "file", "path": "app.png" }
        }]))
        .expect_err("Darwin requires ICNS");
        assert!(wrong_format
            .to_string()
            .contains("unsupported appIcon platform/format pair"));

        let duplicate = serde_json::from_value::<AppIcon>(json!([
            {
                "platform": "windows",
                "format": "ico",
                "source": { "type": "file", "path": "one.ico" }
            },
            {
                "platform": "windows",
                "format": "ico",
                "source": { "type": "file", "path": "two.ico" }
            }
        ]))
        .expect_err("one Windows asset");
        assert!(duplicate
            .to_string()
            .contains("duplicate Windows asset for variant default"));
    }

    #[test]
    fn app_icon_variants_support_aliases_and_semantic_selection() {
        let app_icon = serde_json::from_value::<AppIcon>(json!([
            {
                "platform": "darwin",
                "format": "icns",
                "variant": ["default", "empty"],
                "source": { "type": "file", "path": "empty.icns" }
            },
            {
                "platform": "darwin",
                "format": "icns",
                "variant": "files",
                "source": { "type": "file", "path": "files.icns" }
            }
        ]))
        .expect("variant catalog");

        assert!(app_icon.has_variant("default"));
        assert!(app_icon.has_variant("empty"));
        assert!(app_icon.has_variant("files"));
        let empty = app_icon.for_variant("empty").expect("empty variant");
        let files = app_icon.for_variant("files").expect("files variant");
        assert_eq!(empty.darwin(), app_icon.assets()[0].source().into());
        assert_eq!(files.darwin(), app_icon.assets()[1].source().into());
        assert!(app_icon.for_variant("missing").is_none());
    }

    #[test]
    fn app_icon_variants_reject_invalid_names_duplicates_and_missing_default() {
        let invalid_name = serde_json::from_value::<AppIcon>(json!([{
            "platform": "darwin",
            "format": "icns",
            "variant": "Dark",
            "source": { "type": "file", "path": "dark.icns" }
        }]))
        .expect_err("lowercase semantic name");
        assert!(invalid_name.to_string().contains("variant must match"));

        let duplicate_alias = serde_json::from_value::<AppIcon>(json!([{
            "platform": "darwin",
            "format": "icns",
            "variant": ["default", "default"],
            "source": { "type": "file", "path": "default.icns" }
        }]))
        .expect_err("unique aliases");
        assert!(duplicate_alias
            .to_string()
            .contains("duplicate variant name default"));

        let missing_default = serde_json::from_value::<AppIcon>(json!([{
            "platform": "darwin",
            "format": "icns",
            "variant": "files",
            "source": { "type": "file", "path": "files.icns" }
        }]))
        .expect_err("default is required");
        assert!(missing_default
            .to_string()
            .contains("does not declare a default variant"));

        let duplicate_for_variant = serde_json::from_value::<AppIcon>(json!([
            {
                "platform": "linux",
                "format": "png",
                "variant": ["default", "empty"],
                "size": 32,
                "source": { "type": "file", "path": "empty-32.png" }
            },
            {
                "platform": "linux",
                "format": "png",
                "variant": "empty",
                "size": 32,
                "source": { "type": "file", "path": "other-empty-32.png" }
            }
        ]))
        .expect_err("size uniqueness is per variant");
        assert!(duplicate_for_variant
            .to_string()
            .contains("duplicate Linux PNG size 32 for variant empty"));
    }

    #[test]
    fn responsive_icon_candidates_roundtrip() {
        let icon: Icon = serde_json::from_value(json!({
            "type": "file",
            "path": "fallback.png",
            "text": "Fallback",
            "icon-only": { "type": "encoded", "data": [1, 2, 3] },
            "darwin-icon-only": {
                "type": "file",
                "path": "darwin.png",
                "isTemplate": true
            },
            "win32-icon-only": { "type": "file", "path": "win32.png" },
            "linux-icon-only": { "type": "file", "path": "linux.png" },
            "text-only": "Build",
            "icon-text": {
                "type": "rgba",
                "data": [0, 0, 0, 0],
                "width": 1,
                "height": 1,
                "text": "Build"
            },
            "darwin-icon-text": {
                "type": "file",
                "path": "darwin-text.png",
                "text": "Build",
                "isTemplate": true
            },
            "win32-icon-text": {
                "type": "file",
                "path": "win32-text.png",
                "text": "Build"
            },
            "linux-icon-text": {
                "type": "file",
                "path": "linux-text.png",
                "text": "Build"
            }
        }))
        .expect("icon");

        assert_eq!(
            icon.icon_only,
            Some(IconImage::Encoded {
                data: vec![1, 2, 3]
            })
        );
        assert_eq!(
            icon.darwin_icon_only,
            Some(DarwinIcon {
                image: IconImage::File {
                    path: "darwin.png".to_string(),
                },
                is_template: true,
            })
        );
        assert_eq!(
            icon.win32_icon_only,
            Some(IconImage::File {
                path: "win32.png".to_string(),
            })
        );
        assert_eq!(
            icon.linux_icon_only,
            Some(IconImage::File {
                path: "linux.png".to_string(),
            })
        );
        assert_eq!(icon.text_only.as_deref(), Some("Build"));
        assert_eq!(
            icon.icon_text,
            Some(IconText {
                image: IconImage::Rgba {
                    data: vec![0, 0, 0, 0],
                    width: 1,
                    height: 1,
                },
                text: "Build".to_string(),
            })
        );
        assert_eq!(
            icon.darwin_icon_text,
            Some(DarwinIconText {
                image: IconImage::File {
                    path: "darwin-text.png".to_string(),
                },
                text: "Build".to_string(),
                is_template: true,
            })
        );
        assert_eq!(
            icon.win32_icon_text,
            Some(IconText {
                image: IconImage::File {
                    path: "win32-text.png".to_string(),
                },
                text: "Build".to_string(),
            })
        );
        assert_eq!(
            icon.linux_icon_text,
            Some(IconText {
                image: IconImage::File {
                    path: "linux-text.png".to_string(),
                },
                text: "Build".to_string(),
            })
        );
        assert_eq!(
            icon.fallback,
            Some(SimpleIcon {
                image: IconImage::File {
                    path: "fallback.png".to_string(),
                },
                text: Some("Fallback".to_string()),
            })
        );

        let encoded = serde_json::to_value(icon).expect("serialized icon");
        assert_eq!(encoded["type"], "file");
        assert_eq!(encoded["icon-text"]["text"], "Build");
        assert_eq!(encoded["darwin-icon-only"]["isTemplate"], true);
        assert_eq!(encoded["darwin-icon-text"]["isTemplate"], true);
        assert_eq!(encoded["win32-icon-text"]["text"], "Build");
        assert_eq!(encoded["linux-icon-only"]["path"], "linux.png");
    }

    #[test]
    fn icon_text_requires_text() {
        let error = serde_json::from_value::<Icon>(json!({
            "icon-text": { "type": "file", "path": "missing-text.png" }
        }))
        .expect_err("missing text");

        assert!(error
            .to_string()
            .contains("icon-text candidate requires text"));
    }

    #[test]
    fn darwin_icon_template_defaults_to_false() {
        let icon: Icon = serde_json::from_value(json!({
            "darwin-icon-only": { "type": "file", "path": "darwin.png" }
        }))
        .expect("icon");

        assert_eq!(
            icon.darwin_icon_only,
            Some(DarwinIcon {
                image: IconImage::File {
                    path: "darwin.png".to_string(),
                },
                is_template: false,
            })
        );
        let encoded = serde_json::to_value(icon).expect("serialized icon");
        assert!(encoded["darwin-icon-only"].get("isTemplate").is_none());
    }

    #[test]
    fn darwin_icon_text_requires_text() {
        let error = serde_json::from_value::<Icon>(json!({
            "darwin-icon-text": { "type": "file", "path": "missing-text.png" }
        }))
        .expect_err("missing text");

        assert!(error
            .to_string()
            .contains("darwin-icon-text candidate requires text"));
    }
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
        app_id: AppId,
    },
    MenuClick {
        app_id: AppId,
        tray_id: TrayId,
        item_id: MenuItemId,
    },
    TrayClick {
        app_id: AppId,
        tray_id: TrayId,
        button: MouseButton,
        x: i32,
        y: i32,
    },
    TrayDoubleClick {
        app_id: AppId,
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
