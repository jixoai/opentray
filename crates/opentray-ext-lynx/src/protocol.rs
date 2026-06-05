use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::LynxRuntimeError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LynxCommand {
    Show {
        bundle_path: String,
        launch: LynxLaunchConfig,
    },
    Hide,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LynxWindowStyleConfig {
    pub frameless: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum LynxWindowIconConfig {
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
    Href {
        href: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LynxLaunchConfig {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub min_width: Option<u32>,
    pub min_height: Option<u32>,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub native_window_api: bool,
    pub bind_window_globals: bool,
    pub native_screen_api: bool,
    pub bind_screen_globals: bool,
    pub title: Option<String>,
    pub icon: Option<LynxWindowIconConfig>,
    pub style: LynxWindowStyleConfig,
}

impl Default for LynxLaunchConfig {
    fn default() -> Self {
        Self {
            width: None,
            height: None,
            min_width: None,
            min_height: None,
            max_width: None,
            max_height: None,
            native_window_api: false,
            bind_window_globals: false,
            native_screen_api: false,
            bind_screen_globals: false,
            title: None,
            icon: None,
            style: LynxWindowStyleConfig::default(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowCommandData {
    bundle_path: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    min_width: Option<f64>,
    min_height: Option<f64>,
    max_width: Option<f64>,
    max_height: Option<f64>,
    // Alpha compatibility: older clients may still send fitContentSize.
    // The current host law ignores it and uses explicit startup controls only.
    #[serde(rename = "fitContentSize")]
    _deprecated_fit_content_size: Option<bool>,
    native_window_api: Option<bool>,
    bind_window_globals: Option<bool>,
    native_screen_api: Option<bool>,
    bind_screen_globals: Option<bool>,
    title: Option<String>,
    icon: Option<LynxWindowIconConfig>,
    style: Option<LynxWindowStyleConfig>,
}

pub(crate) fn parse_lynx_command(data: &Value) -> Result<LynxCommand, LynxRuntimeError> {
    let command_type = data
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| LynxRuntimeError::Rejected("lynx command requires type".into()))?;

    match command_type {
        "show" => {
            let parsed: ShowCommandData =
                serde_json::from_value(data.clone()).map_err(|error| {
                    LynxRuntimeError::Rejected(format!("invalid lynx show command: {error}"))
                })?;
            Ok(LynxCommand::Show {
                bundle_path: parsed.bundle_path.ok_or_else(|| {
                    LynxRuntimeError::Rejected("lynx show command requires bundlePath".into())
                })?,
                launch: LynxLaunchConfig {
                    width: parse_dimension("width", parsed.width)?,
                    height: parse_dimension("height", parsed.height)?,
                    min_width: parse_dimension("minWidth", parsed.min_width)?,
                    min_height: parse_dimension("minHeight", parsed.min_height)?,
                    max_width: parse_dimension("maxWidth", parsed.max_width)?,
                    max_height: parse_dimension("maxHeight", parsed.max_height)?,
                    native_window_api: parsed.native_window_api.unwrap_or(false),
                    bind_window_globals: parsed.bind_window_globals.unwrap_or(false),
                    native_screen_api: parsed.native_screen_api.unwrap_or(false),
                    bind_screen_globals: parsed.bind_screen_globals.unwrap_or(false),
                    title: parsed.title,
                    icon: parsed.icon,
                    style: parsed.style.unwrap_or_default(),
                },
            })
        }
        "hide" => Ok(LynxCommand::Hide),
        other => Err(LynxRuntimeError::Rejected(format!(
            "unsupported lynx command: {other}"
        ))),
    }
}

fn parse_dimension(name: &str, value: Option<f64>) -> Result<Option<u32>, LynxRuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if !value.is_finite() || value <= 0.0 {
        return Err(LynxRuntimeError::Rejected(format!(
            "lynx {name} must be a positive finite number"
        )));
    }
    if value > u32::MAX as f64 {
        return Err(LynxRuntimeError::Rejected(format!(
            "lynx {name} exceeds supported size range"
        )));
    }
    Ok(Some(value.round() as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_show_command_requires_bundle_path() {
        let command = parse_lynx_command(&serde_json::json!({
            "type": "show",
            "bundlePath": "/tmp/demo.main.lynx.bundle"
        }))
        .expect("show command");

        assert_eq!(
            command,
            LynxCommand::Show {
                bundle_path: "/tmp/demo.main.lynx.bundle".into(),
                launch: LynxLaunchConfig::default(),
            }
        );
    }

    #[test]
    fn parse_show_command_captures_window_launch_options() {
        let command = parse_lynx_command(&serde_json::json!({
            "type": "show",
            "bundlePath": "/tmp/demo.main.lynx.bundle",
            "width": 520,
            "minWidth": 320,
            "maxHeight": 720,
            "nativeWindowApi": true,
            "bindWindowGlobals": true,
            "nativeScreenApi": true,
            "bindScreenGlobals": false,
            "title": "OpenTray Lynx",
            "icon": {
                "type": "href",
                "href": "data:image/png;base64,AAAA"
            },
            "style": {
                "frameless": true
            }
        }))
        .expect("show command");

        assert_eq!(
            command,
            LynxCommand::Show {
                bundle_path: "/tmp/demo.main.lynx.bundle".into(),
                launch: LynxLaunchConfig {
                    width: Some(520),
                    height: None,
                    min_width: Some(320),
                    min_height: None,
                    max_width: None,
                    max_height: Some(720),
                    native_window_api: true,
                    bind_window_globals: true,
                    native_screen_api: true,
                    bind_screen_globals: false,
                    title: Some("OpenTray Lynx".into()),
                    icon: Some(LynxWindowIconConfig::Href {
                        href: "data:image/png;base64,AAAA".into(),
                    }),
                    style: LynxWindowStyleConfig {
                        frameless: Some(true),
                    },
                },
            }
        );
    }

    #[test]
    fn parse_dimension_rejects_non_positive_values() {
        let error = parse_lynx_command(&serde_json::json!({
            "type": "show",
            "bundlePath": "/tmp/demo.main.lynx.bundle",
            "width": 0
        }))
        .expect_err("width should be rejected");

        assert_eq!(
            error.to_string(),
            "lynx width must be a positive finite number"
        );
    }
}
