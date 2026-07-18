mod abi_support;

use std::ffi::{c_char, c_void, CString};
use std::fmt;

use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope,
    EXT_ABI_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED, EXT_OK,
};
use serde::{Deserialize, Serialize};

use abi_support::{clear_error, record_error};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum BadgePlatform {
    Darwin,
    Win32,
    Linux,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BadgeState {
    badge_text: String,
    badge_count: Option<i64>,
    progress_value: u32,
    progress_max: u32,
    progress_state: String,
    overlay_icon: String,
    attention: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BadgeCapabilityFamily {
    badge_text: String,
    progress: String,
    overlay_icon: String,
    attention: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BadgeCapabilities {
    platform: BadgePlatform,
    mode: String,
    capabilities: BadgeCapabilityFamily,
    state: BadgeState,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum BadgeCommand {
    GetCapabilities,
    SetBadge {
        value: String,
    },
    ClearBadge,
    SetProgress {
        value: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<u32>,
    },
    SetProgressState {
        value: String,
    },
    SetOverlayIcon {
        value: String,
    },
    SetAttention {
        value: bool,
    },
    ShowPanel,
    HidePanel,
    Reset,
}

#[derive(Debug)]
struct BadgeExtension {
    state: BadgeCapabilities,
}

#[derive(Debug)]
enum BadgeRuntimeError {
    Unsupported(String),
    Internal(String),
}

impl BadgeRuntimeError {
    fn code(&self) -> ExtResultCode {
        match self {
            Self::Unsupported(_) => EXT_ERR_UNSUPPORTED,
            Self::Internal(_) => EXT_ERR_INTERNAL,
        }
    }

    fn category(&self) -> &'static str {
        match self {
            Self::Unsupported(_) => "unsupported",
            Self::Internal(_) => "internal",
        }
    }
}

impl fmt::Display for BadgeRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported(message) | Self::Internal(message) => write!(f, "{message}"),
        }
    }
}

#[no_mangle]
pub extern "C" fn opentray_ext_abi_version() -> u32 {
    EXT_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_init(
    context: *const ExtContext,
    out_instance: *mut *mut c_void,
) -> ExtResultCode {
    clear_error();
    if context.is_null() || out_instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_init_context",
            "init requires context and output instance pointers",
        );
    }
    let instance = Box::new(BadgeExtension {
        state: default_capabilities(platform_from_env()),
    });
    unsafe {
        *out_instance = Box::into_raw(instance).cast::<c_void>();
    }
    EXT_OK
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_command(
    instance: *mut c_void,
    _context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    clear_error();
    if instance.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_instance",
            "badge command requires an initialized instance",
        );
    }
    let Some(bytes) = ext_bytes_as_slice(envelope_json) else {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_command_envelope",
            "badge command envelope bytes are missing",
        );
    };
    let envelope = match serde_json::from_slice::<ExtensionEnvelope>(bytes) {
        Ok(envelope) => envelope,
        Err(error) => {
            return record_error(
                EXT_ERR_REJECTED,
                "invalid_command_envelope",
                format!("badge command envelope is invalid: {error}"),
            )
        }
    };
    let Some(tray_id) = envelope.scope.tray_id.as_deref() else {
        return record_error(
            EXT_ERR_REJECTED,
            "missing_tray_scope",
            "badge command requires a tray id",
        );
    };
    let command = match serde_json::from_value::<BadgeCommand>(envelope.data) {
        Ok(command) => command,
        Err(error) => {
            return record_error(
                EXT_ERR_REJECTED,
                "invalid_command",
                format!("badge command is invalid: {error}"),
            )
        }
    };
    let extension = unsafe { &mut *instance.cast::<BadgeExtension>() };
    match extension.handle(tray_id, command) {
        Ok(events) => write_owned_events(out_events_json, &events),
        Err(error) => {
            eprintln!("opentray-ext-badge command failed: {error}");
            record_error(error.code(), error.category(), error.to_string())
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_session_closed(
    _instance: *mut c_void,
    _context: *const ExtHostContext,
    _session_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    clear_error();
    write_owned_json(out_events_json, "[]")
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_deinit(instance: *mut c_void) {
    if !instance.is_null() {
        drop(unsafe { Box::from_raw(instance.cast::<BadgeExtension>()) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn opentray_ext_free_string(ptr: *mut c_char, _len: usize) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

impl BadgeExtension {
    fn handle(
        &mut self,
        tray_id: &str,
        command: BadgeCommand,
    ) -> Result<Vec<ExtensionEnvelope>, BadgeRuntimeError> {
        let payload = match command {
            BadgeCommand::GetCapabilities => serde_json::to_value(&self.state)
                .map_err(|error| BadgeRuntimeError::Internal(error.to_string()))?,
            BadgeCommand::SetBadge { value } => {
                let trimmed = value.trim().to_string();
                let parsed = trimmed.parse::<i64>().ok();
                self.state.state.badge_text = trimmed.clone();
                self.state.state.badge_count = parsed;
                result_payload("setBadge", &self.state)
            }
            BadgeCommand::ClearBadge => {
                self.state.state.badge_text.clear();
                self.state.state.badge_count = None;
                result_payload("clearBadge", &self.state)
            }
            BadgeCommand::SetProgress { value: _, max: _ } => {
                // The current Dock helper can project labels and attention, but has no
                // truthful progress substrate; reject instead of persisting fake parity.
                return Err(BadgeRuntimeError::Unsupported(
                    "progress is unsupported on the current dock helper projection".to_string(),
                ));
            }
            BadgeCommand::SetProgressState { value: _ } => {
                // Progress state is a native projection family, not badge source data.
                return Err(BadgeRuntimeError::Unsupported(
                    "progress state is unsupported on the current dock helper projection"
                        .to_string(),
                ));
            }
            BadgeCommand::SetOverlayIcon { value } => {
                self.state.state.overlay_icon = value;
                result_payload("setOverlayIcon", &self.state)
            }
            BadgeCommand::SetAttention { value } => {
                self.state.state.attention = value;
                result_payload("setAttention", &self.state)
            }
            BadgeCommand::ShowPanel => result_payload("showPanel", &self.state),
            BadgeCommand::HidePanel => result_payload("hidePanel", &self.state),
            BadgeCommand::Reset => {
                self.state = default_capabilities(self.state.platform);
                result_payload("reset", &self.state)
            }
        };

        Ok(vec![ExtensionEnvelope {
            scope: opentray_spec::ExtensionScope {
                app_id: "badge".to_string(),
                tray_id: Some(tray_id.to_string()),
                ext: "badge".to_string(),
            },
            data: payload,
        }])
    }
}

fn default_capabilities(platform: BadgePlatform) -> BadgeCapabilities {
    BadgeCapabilities {
        platform,
        mode: "reduced".to_string(),
        capabilities: BadgeCapabilityFamily {
            badge_text: "reduced".to_string(),
            progress: "unsupported".to_string(),
            overlay_icon: "reduced".to_string(),
            attention: "reduced".to_string(),
        },
        state: BadgeState {
            badge_text: "12".to_string(),
            badge_count: Some(12),
            progress_value: 0,
            progress_max: 100,
            progress_state: "none".to_string(),
            overlay_icon: "dot".to_string(),
            attention: false,
        },
        reason: Some("badge projection is currently reduced to a local proof surface".to_string()),
    }
}

fn platform_from_env() -> BadgePlatform {
    if cfg!(target_os = "windows") {
        BadgePlatform::Win32
    } else if cfg!(target_os = "linux") {
        BadgePlatform::Linux
    } else {
        BadgePlatform::Darwin
    }
}

fn result_payload(op: &str, snapshot: &BadgeCapabilities) -> serde_json::Value {
    serde_json::json!({
        "type": "result",
        "op": op,
        "ok": true,
        "snapshot": snapshot,
    })
}

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

fn write_owned_json(out: *mut ExtOwnedBytes, json: &str) -> ExtResultCode {
    if out.is_null() {
        return record_error(
            EXT_ERR_REJECTED,
            "invalid_output_buffer",
            "badge output buffer pointer is null",
        );
    }
    let Ok(value) = CString::new(json) else {
        return record_error(
            EXT_ERR_INTERNAL,
            "serialization_failed",
            "badge output JSON contains a nul byte",
        );
    };
    let len = value.as_bytes().len();
    unsafe {
        *out = ExtOwnedBytes {
            ptr: value.into_raw().cast::<c_char>(),
            len,
        };
    }
    EXT_OK
}

fn write_owned_events(out: *mut ExtOwnedBytes, events: &[ExtensionEnvelope]) -> ExtResultCode {
    let json = match serde_json::to_string(events) {
        Ok(json) => json,
        Err(error) => {
            return record_error(
                EXT_ERR_INTERNAL,
                "serialization_failed",
                format!("badge events could not be serialized: {error}"),
            )
        }
    };
    write_owned_json(out, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;

    #[test]
    fn exports_embedded_artifact_identity() {
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe { abi_support::opentray_ext_manifest(&mut output) };

        assert_eq!(result, EXT_OK);
        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let manifest = serde_json::from_slice::<opentray_spec::EmbeddedExtensionManifest>(bytes)
            .expect("manifest JSON");
        assert_eq!(manifest.extension_name, "badge");
        assert_eq!(manifest.artifact_set_version, "0.14.4");
        assert_eq!(
            manifest.contract_fingerprint,
            "opentray-ext-badge-contract-1"
        );
        assert!(!manifest.build_identity.is_empty());
        unsafe { opentray_ext_free_string(output.ptr, output.len) };
    }

    #[test]
    fn command_rejection_exposes_structured_native_detail() {
        let context = ExtContext {
            api_version: 1,
            app_id: ExtBytes {
                ptr: c"app-1".as_ptr(),
                len: "app-1".len(),
            },
        };
        let mut instance = ptr::null_mut();
        assert_eq!(
            unsafe { opentray_ext_init(&context, &mut instance) },
            EXT_OK
        );
        let envelope = CString::new(
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "badge" },
                "data": { "type": "setProgress", "value": 50, "max": 100 }
            })
            .to_string(),
        )
        .unwrap();
        let mut events = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };

        let result = unsafe {
            opentray_ext_command(
                instance,
                ptr::null(),
                ExtBytes {
                    ptr: envelope.as_ptr(),
                    len: envelope.as_bytes().len(),
                },
                &mut events,
            )
        };
        assert_eq!(result, EXT_ERR_UNSUPPORTED);

        let mut error_output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        assert_eq!(
            unsafe { abi_support::opentray_ext_take_error(&mut error_output) },
            EXT_OK
        );
        let bytes =
            unsafe { std::slice::from_raw_parts(error_output.ptr.cast::<u8>(), error_output.len) };
        let detail = serde_json::from_slice::<opentray_spec::ExtensionErrorDetail>(bytes)
            .expect("error JSON");
        assert_eq!(detail.category, "unsupported");
        assert!(detail.message.contains("progress is unsupported"));
        unsafe {
            opentray_ext_free_string(error_output.ptr, error_output.len);
            opentray_ext_deinit(instance);
        }
    }

    #[test]
    fn default_capabilities_are_reduced_and_truthful_for_windows() {
        let capabilities = default_capabilities(BadgePlatform::Win32);

        assert_eq!(capabilities.platform, BadgePlatform::Win32);
        assert_eq!(capabilities.mode, "reduced");
        assert_eq!(capabilities.capabilities.badge_text, "reduced");
        assert_eq!(capabilities.capabilities.progress, "unsupported");
        assert_eq!(capabilities.capabilities.overlay_icon, "reduced");
        assert_eq!(capabilities.capabilities.attention, "reduced");
        assert!(capabilities.reason.is_some());
    }

    #[test]
    fn progress_commands_reject_instead_of_persisting_fake_projection() {
        let mut extension = BadgeExtension {
            state: default_capabilities(BadgePlatform::Win32),
        };

        let error = extension
            .handle(
                "tray-1",
                BadgeCommand::SetProgress {
                    value: 50,
                    max: Some(100),
                },
            )
            .unwrap_err();

        assert_eq!(error.code(), EXT_ERR_UNSUPPORTED);
        assert!(error.to_string().contains("progress is unsupported"));
        assert_eq!(extension.state.state.progress_value, 0);
        assert_eq!(extension.state.state.progress_max, 100);
        assert_eq!(extension.state.state.progress_state, "none");
    }

    #[test]
    fn badge_commands_update_source_state_and_emit_result_events() {
        let mut extension = BadgeExtension {
            state: default_capabilities(BadgePlatform::Win32),
        };

        let events = extension
            .handle(
                "tray-1",
                BadgeCommand::SetBadge {
                    value: " 42 ".to_string(),
                },
            )
            .expect("badge command should succeed");

        assert_eq!(extension.state.state.badge_text, "42");
        assert_eq!(extension.state.state.badge_count, Some(42));
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].scope.tray_id.as_deref(), Some("tray-1"));
        assert_eq!(events[0].scope.ext, "badge");
        assert_eq!(events[0].data["type"], "result");
        assert_eq!(events[0].data["op"], "setBadge");
        assert_eq!(events[0].data["ok"], true);
    }
}
