use std::ffi::{c_char, c_void};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{AppId, Rect, TrayId};

pub const EXT_API_VERSION: u32 = 1;
pub const EXT_ABI_VERSION: u32 = 3;

pub type ExtResultCode = i32;
pub const EXT_OK: ExtResultCode = 0;
pub const EXT_ERR_REJECTED: ExtResultCode = 1;
pub const EXT_ERR_UNSUPPORTED: ExtResultCode = 2;
pub const EXT_ERR_INTERNAL: ExtResultCode = 3;

pub const EXT_SYMBOL_ABI_VERSION: &str = "opentray_ext_abi_version";
pub const EXT_SYMBOL_MANIFEST: &str = "opentray_ext_manifest";
pub const EXT_SYMBOL_INIT: &str = "opentray_ext_init";
pub const EXT_SYMBOL_COMMAND: &str = "opentray_ext_command";
pub const EXT_SYMBOL_SESSION_CLOSED: &str = "opentray_ext_session_closed";
pub const EXT_SYMBOL_DEINIT: &str = "opentray_ext_deinit";
pub const EXT_SYMBOL_FREE_STRING: &str = "opentray_ext_free_string";
pub const EXT_SYMBOL_TAKE_ERROR: &str = "opentray_ext_take_error";

pub const REQUIRED_EXTENSION_SYMBOLS: &[&str] = &[
    EXT_SYMBOL_ABI_VERSION,
    EXT_SYMBOL_MANIFEST,
    EXT_SYMBOL_INIT,
    EXT_SYMBOL_COMMAND,
    EXT_SYMBOL_SESSION_CLOSED,
    EXT_SYMBOL_DEINIT,
    EXT_SYMBOL_FREE_STRING,
    EXT_SYMBOL_TAKE_ERROR,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionArtifactTarget {
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedExtensionIdentity {
    pub extension_name: String,
    pub artifact_set_version: String,
    pub contract_fingerprint: String,
    pub target: ExtensionArtifactTarget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedExtensionManifest {
    pub extension_name: String,
    pub abi_version: u32,
    pub artifact_set_version: String,
    pub contract_fingerprint: String,
    pub target: ExtensionArtifactTarget,
    pub build_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionErrorDetail {
    pub category: String,
    pub message: String,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtBytes {
    pub ptr: *const c_char,
    pub len: usize,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtOwnedBytes {
    pub ptr: *mut c_char,
    pub len: usize,
}

#[repr(C)]
pub struct ExtContext {
    pub api_version: u32,
    pub app_id: ExtBytes,
}

pub type ExtSendEventFn =
    extern "C" fn(host_data: *mut c_void, event_json: ExtBytes) -> ExtResultCode;
pub type ExtGetRectFn = extern "C" fn(host_data: *mut c_void, out: *mut Rect) -> ExtResultCode;
/// Generic host-owned capability call for dynamic extensions.
///
/// Extensions own their command protocol. This hook is reserved for future
/// privileged host facilities that must not cross the ABI as concrete types.
pub type ExtInvokeHostFn = extern "C" fn(
    host_data: *mut c_void,
    capability: ExtBytes,
    request_json: ExtBytes,
    out_response_json: *mut ExtOwnedBytes,
) -> ExtResultCode;
pub type ExtFreeHostStringFn = extern "C" fn(host_data: *mut c_void, bytes: ExtOwnedBytes);

#[repr(C)]
pub struct ExtHostContext {
    pub host_data: *mut c_void,
    pub send_event: ExtSendEventFn,
    pub get_rect: ExtGetRectFn,
    pub invoke_host: ExtInvokeHostFn,
    pub free_host_string: ExtFreeHostStringFn,
}

// ---------------------------------------------------------------------------
// Extension EventPort (phase 1)
//
// The EventPort is the generic asynchronous ext -> host ingress channel. It is
// a nested capability on top of ABI 3: required ABI-3 symbols, `ExtContext`,
// and `ExtHostContext` stay frozen, and one OPTIONAL attach symbol layers the
// versioned port on the same manifest-validated artifact. Phase 1 has no
// retain/release and no detach; the host-owned port state lives until broker
// process exit, so a stale producer thread always reaches live memory and
// receives `EXT_ERR_PORT_CLOSED`.
// ---------------------------------------------------------------------------

/// Nested EventPort capability version (frozen). This is not an
/// `EXT_ABI_VERSION` bump and cannot relax manifest identity checks.
pub const EXT_EVENT_PORT_ABI_V1: u32 = 1;

/// The single optional phase-1 EventPort symbol. Absence means legacy
/// response flushing; when present, the host validates the port and invokes
/// the symbol exactly once after `init`.
pub const EXT_SYMBOL_ATTACH_EVENT_PORT_V1: &str = "opentray_ext_attach_event_port_v1";

/// EventPort queue policy selected by the extension producer. Frozen values.
///
/// - `Edge` is never silently discarded; a full queue returns
///   `EXT_ERR_BACKPRESSURE` and the producer owns bounded retry.
/// - `Latest` replaces the one pending record with the same bounded
///   coalesce key; it is state truth with a contract-defined query/sequence
///   resync route.
/// - `BestEffort` may drop the newest record with a metric and still return
///   `EXT_OK`, so lossy telemetry cannot become a callback hot loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum ExtEventClassV1 {
    Edge = 1,
    Latest = 2,
    BestEffort = 3,
}

impl ExtEventClassV1 {
    /// Decodes a raw discriminant received over FFI. Unknown values are a
    /// rejected input, never a forged enum.
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            1 => Some(Self::Edge),
            2 => Some(Self::Latest),
            3 => Some(Self::BestEffort),
            _ => None,
        }
    }

    pub fn as_u32(self) -> u32 {
        self as u32
    }
}

/// Host-bound event route. Tray-scoped by design: the current `ext-event`
/// frame path drops tray-less envelopes, so an empty tray id is a rejected
/// input, not a hidden app-scoped broadcast.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtEventRouteV1 {
    /// Borrowed non-empty UTF-8 tray id for the duration of `try_submit`.
    pub tray_id: ExtBytes,
}

/// One submitted event record. All byte fields are borrowed only for the
/// duration of `try_submit`; the host copies bounded bytes before returning.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtEventInputV1 {
    pub route: ExtEventRouteV1,
    /// Borrowed JSON value bytes. Validated (UTF-8 + parseable JSON) and
    /// size-bounded at ingress.
    pub data_json: ExtBytes,
    /// Raw `ExtEventClassV1` discriminant. Typed as `u32` so an unknown
    /// discriminant from foreign code is a safely-readable rejected value.
    pub class: u32,
    /// Required only for `Latest`; ignored for the other classes. Opaque
    /// bounded comparison bytes.
    pub coalesce_key: ExtBytes,
}

/// The immutable, process-lifetime, revocable host capability handed to the
/// extension through the optional attach symbol. The extension may copy this
/// small value freely; `try_submit` points at broker code, so dropping the
/// extension library can never invalidate the function pointer.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtEventPortV1 {
    pub abi_version: u32,
    pub struct_size: u32,
    /// Addresses host-owned `EventPortState`; never an extension pointer.
    pub port_data: *mut c_void,
    /// Never blocks on UI/transport/core, never calls back into the
    /// extension, and never dereferences `input` after the bounded copy.
    pub try_submit: extern "C" fn(*mut c_void, ExtEventInputV1) -> ExtResultCode,
}

/// Exported by EventPort-capable extensions (optional symbol). Invoked once
/// after `init` with a PENDING port; only a successful LoadExt ACK opens the
/// source for delivery.
pub type ExtAttachEventPortV1Fn =
    unsafe extern "C" fn(instance: *mut c_void, port: ExtEventPortV1) -> ExtResultCode;

// Frozen additions to the ABI-3 result-code space for the EventPort
// capability only. Existing ABI-3 operations keep their current codes, and
// backpressure/closure are expected control results that do not mutate a
// global last-error slot.
/// Per-source or broker-global queue budget exhausted. The record was NOT
/// accepted (except BestEffort drop-newest, which returns `EXT_OK`).
pub const EXT_ERR_BACKPRESSURE: ExtResultCode = 4; // frozen (D19 B'')
/// The port's source is revoked (session close, reload, failed load, or
/// shutdown), or the hub's owner-loop delivery path is unavailable after a
/// failed wake — a submit is never accepted without an active delivery
/// path. No queue mutation and no payload bytes are read.
pub const EXT_ERR_PORT_CLOSED: ExtResultCode = 5; // frozen (D19 B'')

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScope {
    #[serde(rename = "appId")]
    pub app_id: AppId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_id: Option<TrayId>,
    pub ext: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEnvelope {
    pub scope: ExtensionScope,
    pub data: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    /// Freezes the phase-1 EventPort C layout. These structs cross the FFI
    /// boundary by value; any drift is an ABI break that requires a new
    /// nested version, not a silent edit.
    #[test]
    fn event_port_v1_layout_is_frozen() {
        assert_eq!(EXT_EVENT_PORT_ABI_V1, 1);
        assert_eq!(
            EXT_SYMBOL_ATTACH_EVENT_PORT_V1,
            "opentray_ext_attach_event_port_v1"
        );

        assert_eq!(size_of::<ExtEventRouteV1>(), size_of::<ExtBytes>());
        assert_eq!(offset_of!(ExtEventRouteV1, tray_id), 0);

        assert_eq!(size_of::<ExtBytes>(), 2 * size_of::<usize>());
        assert_eq!(
            size_of::<ExtEventInputV1>(),
            3 * size_of::<ExtBytes>() + size_of::<u32>() + {
                size_of::<usize>() - size_of::<u32>()
            },
            "route + data_json + class (u32 + padding) + coalesce_key"
        );
        assert_eq!(offset_of!(ExtEventInputV1, route), 0);
        assert_eq!(
            offset_of!(ExtEventInputV1, data_json),
            size_of::<ExtBytes>()
        );
        assert_eq!(
            offset_of!(ExtEventInputV1, class),
            2 * size_of::<ExtBytes>()
        );
        assert_eq!(
            offset_of!(ExtEventInputV1, coalesce_key),
            2 * size_of::<ExtBytes>() + size_of::<usize>()
        );

        assert_eq!(
            size_of::<ExtEventPortV1>(),
            2 * size_of::<u32>()
                + { size_of::<usize>() - 2 * size_of::<u32>() }
                + 2 * size_of::<usize>(),
            "abi_version + struct_size (+ padding) + port_data + try_submit"
        );
        assert_eq!(offset_of!(ExtEventPortV1, abi_version), 0);
        assert_eq!(offset_of!(ExtEventPortV1, struct_size), size_of::<u32>());
        assert_eq!(offset_of!(ExtEventPortV1, port_data), size_of::<usize>());
        assert_eq!(
            offset_of!(ExtEventPortV1, try_submit),
            2 * size_of::<usize>()
        );
    }

    /// The two EventPort result codes extend the ABI-3 space at frozen
    /// values; existing operations keep 0..=3 unchanged.
    #[test]
    fn event_port_result_codes_are_frozen() {
        assert_eq!(EXT_OK, 0);
        assert_eq!(EXT_ERR_REJECTED, 1);
        assert_eq!(EXT_ERR_UNSUPPORTED, 2);
        assert_eq!(EXT_ERR_INTERNAL, 3);
        assert_eq!(EXT_ERR_BACKPRESSURE, 4);
        assert_eq!(EXT_ERR_PORT_CLOSED, 5);
    }

    #[test]
    fn event_class_discriminants_decode_only_frozen_values() {
        assert_eq!(ExtEventClassV1::Edge.as_u32(), 1);
        assert_eq!(ExtEventClassV1::Latest.as_u32(), 2);
        assert_eq!(ExtEventClassV1::BestEffort.as_u32(), 3);

        for forged in [0u32, 4, 5, u32::MAX, u32::MIN] {
            assert_eq!(ExtEventClassV1::from_u32(forged), None);
        }
        for valid in [
            ExtEventClassV1::Edge,
            ExtEventClassV1::Latest,
            ExtEventClassV1::BestEffort,
        ] {
            assert_eq!(ExtEventClassV1::from_u32(valid.as_u32()), Some(valid));
        }
    }

    /// A struct-size field that always matches the real layout keeps hosts
    /// and extensions honest across compile units.
    #[test]
    fn event_port_struct_size_constant_matches_layout() {
        extern "C" fn closed_probe(_port: *mut c_void, _input: ExtEventInputV1) -> ExtResultCode {
            EXT_ERR_PORT_CLOSED
        }
        let probe = ExtEventPortV1 {
            abi_version: EXT_EVENT_PORT_ABI_V1,
            struct_size: size_of::<ExtEventPortV1>() as u32,
            port_data: std::ptr::null_mut(),
            try_submit: closed_probe,
        };
        assert_eq!(probe.struct_size as usize, size_of::<ExtEventPortV1>());
        assert_eq!(probe.abi_version, EXT_EVENT_PORT_ABI_V1);
    }
}
