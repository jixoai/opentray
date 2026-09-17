use std::ffi::{c_char, c_void};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{AppId, Rect, SessionId, TrayId};

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
/// ABI-3 command entry (disposition-less, always Immediate). A library that
/// also exports [`EXT_SYMBOL_COMMAND_V2`] is dispatched through V2 only; a
/// library exporting neither command symbol is `abi_incompatible`.
pub const EXT_SYMBOL_COMMAND: &str = "opentray_ext_command";
/// DeferredOperation command entry (add-ext-dialog design section 5.1, R5/R6 frozen). The
/// extension receives the broker-issued operation handle through the
/// pre-seeded `ExtCommandDispositionV1` and answers with its disposition.
pub const EXT_SYMBOL_COMMAND_V2: &str = "opentray_ext_command_v2";
pub const EXT_SYMBOL_SESSION_CLOSED: &str = "opentray_ext_session_closed";
pub const EXT_SYMBOL_DEINIT: &str = "opentray_ext_deinit";
pub const EXT_SYMBOL_FREE_STRING: &str = "opentray_ext_free_string";
pub const EXT_SYMBOL_TAKE_ERROR: &str = "opentray_ext_take_error";

/// Unconditionally required ABI-3 symbols. The two command symbols are NOT
/// members: the loader's frozen four-cell matrix accepts a library with
/// `opentray_ext_command_v2` only (V2 set, legacy symbol no longer required),
/// with `opentray_ext_command` only (always Immediate, never called with the
/// V2 signature), or with both (V2 wins); both missing is `abi_incompatible`.
pub const REQUIRED_EXTENSION_SYMBOLS: &[&str] = &[
    EXT_SYMBOL_ABI_VERSION,
    EXT_SYMBOL_MANIFEST,
    EXT_SYMBOL_INIT,
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
    /// Optional embedded-artifact identity-chain inputs (add-ext-dialog
    /// design section 6.4): lowercase hex SHA-256 of the resolved library file, verified by
    /// the broker before `dlopen`. Absent means the caller supplied no byte
    /// hash (registry-era identity only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// Optional build identity carried by the embedded staging manifest; the
    /// broker compares it against the native manifest between
    /// `Library::new` and `init` when provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_identity: Option<String>,
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

/// Structured FFI error detail taken through `opentray_ext_take_error`.
/// The optional `details` field is a compatible wire extension (absent in
/// Deserializes the optional typed-error `details` field while enforcing the
/// frozen envelope shape: `details` is a JSON object when present. Nulls,
/// scalars, and arrays fail deserialization so the synchronous error frame
/// and deferred terminal payloads accept exactly the same language
/// (add-ext-dialog 7.5; impl review R2).
pub(crate) fn deserialize_details_object<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Deserialize the raw value (not Option<Value>, which folds an explicit
    // null into None and would silently accept it); a missing field never
    // reaches here because `#[serde(default)]` supplies None instead.
    let value = Value::deserialize(deserializer)?;
    match value {
        details @ Value::Object(_) => Ok(Some(details)),
        other => Err(serde::de::Error::custom(format!(
            "typed extension error details must be a JSON object when present, got {}",
            json_kind(&other)
        ))),
    }
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// ABI-3 payloads, ignored by old hosts): it carries the discriminated JSON
/// payload of the typed error envelope so the synchronous error path stays
/// isomorphic with deferred terminal errors (add-ext-dialog 7.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionErrorDetail {
    pub category: String,
    pub message: String,
    /// Optional discriminated JSON payload matching the typed error
    /// envelope's `details` shape. Absent for codes without structured
    /// detail.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_details_object"
    )]
    pub details: Option<Value>,
}

/// Typed extension error envelope (add-ext-dialog design section 7.5): `{ code, message,
/// details }` with a discriminated `details` JSON shape shared by the Rust
/// `ExtensionError::Detailed` projection, server error frames, and the Node
/// typed error factory. Consumers must match on `code`; parsing the human
/// `message` is forbidden by contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedExtensionError {
    pub code: String,
    pub message: String,
    /// Discriminated JSON payload whose shape each error code freezes in
    /// `@opentray/spec`. Absent for codes without structured detail.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_details_object"
    )]
    pub details: Option<Value>,
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
/// failed wake -- a submit is never accepted without an active delivery
/// path. No queue mutation and no payload bytes are read.
pub const EXT_ERR_PORT_CLOSED: ExtResultCode = 5; // frozen (D19 B'')

// ---------------------------------------------------------------------------
// DeferredOperation ABI (add-ext-dialog design section 5.1, R3-R6 frozen)
//
// Long-running extension commands answer through a tagged disposition
// instead of blocking the command call: Immediate keeps the exact V1
// semantics (result envelopes in `out_events`), Deferred registers a
// broker-owned operation whose single terminal frame arrives later through
// the optional DeferredPort (`submit` is the only terminal channel; poll
// never produces one). The disposition and port structs cross the FFI
// boundary by value with frozen `#[repr(C)]` layouts.
// ---------------------------------------------------------------------------

/// Nested DeferredPort capability version (frozen). Not an `EXT_ABI_VERSION`
/// bump; it cannot relax manifest identity checks.
pub const EXT_DEFERRED_PORT_ABI_V1: u32 = 1;

/// The single optional DeferredPort attach symbol (by-value port, EventPort
/// attach pattern). Absence means the instance cannot submit deferred
/// terminals.
pub const EXT_SYMBOL_ATTACH_DEFERRED_PORT_V1: &str = "opentray_ext_attach_deferred_completion_port_v1";

/// Shared ingress bound for one extension event/terminal record. The value
/// is the single source of truth for both the EventPort record bound and the
/// DeferredPort terminal payload bound; the broker's event hub and the TS
/// spec export the same number (Rust/TS fixture parity).
pub const EXTENSION_EVENT_RECORD_MAX_BYTES: usize = 64 * 1024;

/// `ExtCommandDispositionV1::tag` frozen value: the command completed inside
/// the call; result envelopes are in `out_events` and `value` must be
/// all-zero.
pub const EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE: u32 = 0;
/// `ExtCommandDispositionV1::tag` frozen value: the command is pending;
/// `out_events` must be empty and `value.operation_handle` carries the
/// broker-issued handle that was seeded into the struct before the call.
pub const EXT_COMMAND_DISPOSITION_TAG_DEFERRED: u32 = 1;

/// The `value` union of [`ExtCommandDispositionV1`]. `none` is the zero
/// representation; `operation_handle` aliases the same bytes as a `u64`, so
/// "value is all zero" is the Immediate-side invariant.
#[repr(C)]
#[derive(Clone, Copy)]
pub union ExtCommandDispositionValueV1 {
    pub none: (),
    pub operation_handle: u64,
}

/// Tagged command disposition (frozen layout). The host pre-seeds the struct
/// with `{ tag: Deferred, reserved: 0, value: { operation_handle } }` -- this
/// pre-seeding is the one-way, single-use delivery of the broker-issued
/// handle -- and the extension either leaves it untouched (defer) or rewrites
/// it to `{ tag: Immediate, reserved: 0, value: none }` with results in
/// `out_events`. Unknown tags and non-zero `reserved` are host-side typed
/// rejections; the host never guesses semantics.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ExtCommandDispositionV1 {
    pub tag: u32,
    pub reserved: u32,
    pub value: ExtCommandDispositionValueV1,
}

impl ExtCommandDispositionV1 {
    /// The all-zero Immediate disposition an extension writes when the
    /// command completed inside the call. The union word is zeroed through
    /// its `u64` arm -- assigning the ZST `none` arm writes no bytes.
    pub fn immediate() -> Self {
        Self {
            tag: EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE,
            reserved: 0,
            value: ExtCommandDispositionValueV1 { operation_handle: 0 },
        }
    }

    /// The host-seeded Deferred disposition carrying the freshly issued
    /// operation handle.
    pub fn deferred(operation_handle: u64) -> Self {
        Self {
            tag: EXT_COMMAND_DISPOSITION_TAG_DEFERRED,
            reserved: 0,
            value: ExtCommandDispositionValueV1 { operation_handle },
        }
    }

    /// True when the `value` union is all-zero (the Immediate invariant).
    pub fn value_is_zero(&self) -> bool {
        unsafe { self.value.operation_handle == 0 }
    }

    /// Reads the deferred operation handle (meaningful only when
    /// `tag == EXT_COMMAND_DISPOSITION_TAG_DEFERRED`).
    pub fn operation_handle(&self) -> u64 {
        unsafe { self.value.operation_handle }
    }
}

impl std::fmt::Debug for ExtCommandDispositionV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Safe projection: both union fields are plain integers (the unit
        // field contributes no bytes), so reporting the raw word cannot
        // betray an invalid enum.
        f.debug_struct("ExtCommandDispositionV1")
            .field("tag", &self.tag)
            .field("reserved", &self.reserved)
            .field("value", &self.operation_handle())
            .finish()
    }
}

/// DeferredPort terminal submit entry. Bounded-copy ingress: the host copies
/// at most [`EXTENSION_EVENT_RECORD_MAX_BYTES`] before returning
/// `EXT_ERR_OVERSIZED`, never blocks on UI/transport, and never calls back
/// into the extension.
pub type ExtDeferredPortSubmitV1 = unsafe extern "C" fn(
    port_data: *mut c_void,
    operation_handle: u64,
    payload_ptr: *const u8,
    payload_len: usize,
) -> ExtResultCode;

/// The immutable, process-lifetime, revocable terminal channel handed to the
/// extension through the optional attach symbol, BY VALUE (EventPort
/// pattern): the extension copies this small struct and may retain only
/// `port_data`; the host does not guarantee the struct address outlives the
/// attach call.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtDeferredPortV1 {
    pub abi_version: u32,
    pub struct_size: u32,
    /// Addresses host-owned port state; never an extension pointer.
    pub port_data: *mut c_void,
    pub submit: ExtDeferredPortSubmitV1,
}

/// Exported by DeferredPort-capable extensions (optional symbol). Invoked
/// once after `init` with a PENDING port; only a successful LoadExt ACK
/// opens the submit channel.
pub type ExtAttachDeferredPortV1Fn =
    unsafe extern "C" fn(instance: *mut c_void, port: ExtDeferredPortV1) -> ExtResultCode;

// Frozen DeferredPort result codes extending the ABI-3/EventPort space.
/// The submitted payload exceeds [`EXTENSION_EVENT_RECORD_MAX_BYTES`]. No
/// payload bytes were copied and no queue mutated.
pub const EXT_ERR_OVERSIZED: ExtResultCode = 6; // frozen (add-ext-dialog design section 5.1)
/// The submitted handle was never issued to this port owner (fabricated, or
/// replayed after its operation retired/was purged), or it belongs to a
/// foreign owner. No queue mutation and no terminal frame.
pub const EXT_ERR_INVALID_HANDLE: ExtResultCode = 7; // frozen (add-ext-dialog design section 5.1)

// ---------------------------------------------------------------------------
// Dialog poll-owner ABI (add-ext-dialog design sections 5.2/5.7 ruling 3,
// frozen batch B 2026-09-17).
//
// A dynamic extension may export ONE optional producer symbol the broker's
// owner loop uses to step native modal state without blocking: scheduling
// authority stays broker-owned (`ControlFlow::WaitUntil(min deadline)`), the
// extension holds no waker and never calls into the loop, and a poll NEVER
// carries a terminal — the deferred port stays the single terminal channel.
// ---------------------------------------------------------------------------

/// The optional poll-producer symbol (frozen name, design section 5.7
/// ruling 3). Absence is a legitimate matrix cell: the instance is never
/// scheduled.
pub const EXT_SYMBOL_POLL_OWNER_V1: &str = "opentray_ext_poll_owner_v1";

/// `ExtPollOutcomeV1::status`: the only frozen status — the operation is
/// pending and its terminal (if any) went through the deferred port.
pub const EXT_POLL_STATUS_PENDING: u32 = 0;

/// `ExtPollOutcomeV1::next_deadline_ms` sentinel: nothing scheduled; the
/// loop should not arm a timer for this owner.
pub const EXT_POLL_NO_DEADLINE_MS: u64 = u64::MAX;

/// `ExtPollOutcomeV1::wake_flags` bit: this poll completed a modal and
/// submitted its terminal through the deferred port (the port wake already
/// requested a drain; the flag is a diagnostic hint for the scheduler).
pub const EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED: u32 = 1 << 0;

/// Frozen poll outcome (design section 5.7 ruling 3): `status` and
/// `reserved` are leading u32s, `next_deadline_ms` is a RELATIVE millisecond
/// duration from the poll call (u64::MAX = none), and `wake_flags` carries
/// hint bits. Any drift is an ABI break requiring a new versioned struct.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct ExtPollOutcomeV1 {
    pub status: u32,
    pub reserved: u32,
    pub next_deadline_ms: u64,
    pub wake_flags: u32,
}

impl ExtPollOutcomeV1 {
    pub fn pending(next_deadline_ms: u64, wake_flags: u32) -> Self {
        Self {
            status: EXT_POLL_STATUS_PENDING,
            reserved: 0,
            next_deadline_ms,
            wake_flags,
        }
    }
}

/// Exported by poll-producer extensions (optional symbol): steps one
/// deferred operation's native owner once on the caller's (owner-loop)
/// thread.
pub type ExtPollOwnerV1Fn =
    unsafe extern "C" fn(instance: *mut c_void, operation_handle: u64) -> ExtPollOutcomeV1;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScope {
    #[serde(rename = "appId")]
    pub app_id: AppId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tray_id: Option<TrayId>,
    pub ext: String,
}

/// Broker-injected command ownership (add-ext-dialog design section 5.5): the host derives
/// `{ appId, trayId, sessionId, instanceGeneration }` for every command
/// dispatch and extensions must never self-report it. All busy/operation
/// registries key on this scope; the deferred operation binding is
/// `(sessionId, instanceGeneration, operationId)`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandScope {
    #[serde(rename = "appId")]
    pub app_id: AppId,
    #[serde(rename = "trayId")]
    pub tray_id: TrayId,
    #[serde(rename = "sessionId")]
    pub session_id: SessionId,
    #[serde(rename = "instanceGeneration")]
    pub instance_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEnvelope {
    pub scope: ExtensionScope,
    /// Present only on the command dispatch path: the broker-injected
    /// ownership scope for this invocation. Event envelopes never carry it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_scope: Option<CommandScope>,
    pub data: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    /// Freezes the dialog poll-owner C layout (add-ext-dialog design
    /// section 5.7 ruling 3): leading u32 pair, u64 relative deadline
    /// (u64::MAX = none), trailing wake-flags word, padded to the u64
    /// alignment. Any drift is an ABI break requiring a new versioned
    /// struct.
    #[test]
    fn poll_owner_v1_layout_is_frozen() {
        assert_eq!(EXT_SYMBOL_POLL_OWNER_V1, "opentray_ext_poll_owner_v1");
        assert_eq!(EXT_POLL_STATUS_PENDING, 0);
        assert_eq!(EXT_POLL_NO_DEADLINE_MS, u64::MAX);
        assert_eq!(EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED, 1);

        assert_eq!(
            size_of::<ExtPollOutcomeV1>(),
            3 * size_of::<u64>(),
            "status + reserved + deadline word + wake_flags, padded to the u64 alignment"
        );
        assert_eq!(offset_of!(ExtPollOutcomeV1, status), 0);
        assert_eq!(offset_of!(ExtPollOutcomeV1, reserved), size_of::<u32>());
        assert_eq!(
            offset_of!(ExtPollOutcomeV1, next_deadline_ms),
            size_of::<u64>()
        );
        assert_eq!(
            offset_of!(ExtPollOutcomeV1, wake_flags),
            2 * size_of::<u64>()
        );
        let pending = ExtPollOutcomeV1::pending(16, EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED);
        assert_eq!(pending.status, EXT_POLL_STATUS_PENDING);
        assert_eq!(pending.reserved, 0);
        assert_eq!(pending.next_deadline_ms, 16);
        assert_eq!(pending.wake_flags, EXT_POLL_OUTCOME_FLAG_TERMINAL_QUEUED);
    }

    /// The typed-error `details` field accepts exactly one language on both
    /// the synchronous error frame and deferred terminal payloads: absent or
    /// a JSON object (impl review R2 isomorphism gate).
    #[test]
    fn typed_error_details_must_be_a_json_object_when_present() {
        let valid: &[(&str, Option<Value>)] = &[
            (r#"{"code":"x","message":"m"}"#, None),
            (
                r#"{"code":"x","message":"m","details":{"variant":"a"}}"#,
                Some(serde_json::json!({"variant": "a"})),
            ),
        ];
        for (raw, expected) in valid {
            let parsed: TypedExtensionError = serde_json::from_str(raw).expect(raw);
            assert_eq!(parsed.details, *expected, "valid case: {raw}");
        }
        let invalid = [
            r#"{"code":"x","message":"m","details":null}"#,
            r#"{"code":"x","message":"m","details":1}"#,
            r#"{"code":"x","message":"m","details":"str"}"#,
            r#"{"code":"x","message":"m","details":[]}"#,
            r#"{"code":"x","message":"m","details":true}"#,
        ];
        for raw in invalid {
            assert!(
                serde_json::from_str::<TypedExtensionError>(raw).is_err(),
                "must reject non-object details: {raw}"
            );
            assert!(
                serde_json::from_str::<ExtensionErrorDetail>(raw).is_err(),
                "FFI detail must reject non-object details: {raw}"
            );
        }
    }

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

    /// Freezes the DeferredOperation command disposition C layout
    /// (add-ext-dialog design section 5.1): tag and reserved as leading u32s, the value
    /// union word-aligned after them. Any drift is an ABI break requiring a
    /// new versioned struct, not a silent edit.
    #[test]
    fn command_disposition_v1_layout_is_frozen() {
        assert_eq!(EXT_SYMBOL_COMMAND_V2, "opentray_ext_command_v2");
        assert_eq!(
            EXT_SYMBOL_ATTACH_DEFERRED_PORT_V1,
            "opentray_ext_attach_deferred_completion_port_v1"
        );
        assert_eq!(EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE, 0);
        assert_eq!(EXT_COMMAND_DISPOSITION_TAG_DEFERRED, 1);

        assert_eq!(
            size_of::<ExtCommandDispositionV1>(),
            offset_of!(ExtCommandDispositionV1, value) + size_of::<u64>(),
            "tag + reserved (+ padding to the union alignment) + value union word"
        );
        assert_eq!(offset_of!(ExtCommandDispositionV1, tag), 0);
        assert_eq!(offset_of!(ExtCommandDispositionV1, reserved), size_of::<u32>());
        assert_eq!(
            offset_of!(ExtCommandDispositionV1, value),
            size_of::<u64>()
        );
        assert_eq!(size_of::<ExtCommandDispositionValueV1>(), size_of::<u64>());

        let deferred = ExtCommandDispositionV1::deferred(7);
        assert_eq!(deferred.tag, EXT_COMMAND_DISPOSITION_TAG_DEFERRED);
        assert_eq!(deferred.reserved, 0);
        assert_eq!(deferred.operation_handle(), 7);
        assert!(!deferred.value_is_zero());

        let immediate = ExtCommandDispositionV1::immediate();
        assert_eq!(immediate.tag, EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE);
        assert_eq!(immediate.reserved, 0);
        assert_eq!(immediate.operation_handle(), 0);
        assert!(immediate.value_is_zero());
    }

    /// Freezes the DeferredPort v1 C layout (by-value attach, same family as
    /// `ExtEventPortV1`).
    #[test]
    fn deferred_port_v1_layout_is_frozen() {
        assert_eq!(EXT_DEFERRED_PORT_ABI_V1, 1);

        assert_eq!(
            size_of::<ExtDeferredPortV1>(),
            2 * size_of::<u32>()
                + { size_of::<usize>() - 2 * size_of::<u32>() }
                + 2 * size_of::<usize>(),
            "abi_version + struct_size (+ padding) + port_data + submit"
        );
        assert_eq!(offset_of!(ExtDeferredPortV1, abi_version), 0);
        assert_eq!(
            offset_of!(ExtDeferredPortV1, struct_size),
            size_of::<u32>()
        );
        assert_eq!(offset_of!(ExtDeferredPortV1, port_data), size_of::<usize>());
        assert_eq!(
            offset_of!(ExtDeferredPortV1, submit),
            2 * size_of::<usize>()
        );
    }

    /// The DeferredPort result codes extend the frozen ABI-3/EventPort
    /// space; existing codes stay unchanged.
    #[test]
    fn deferred_port_result_codes_are_frozen() {
        assert_eq!(EXT_ERR_OVERSIZED, 6);
        assert_eq!(EXT_ERR_INVALID_HANDLE, 7);
        assert_ne!(EXT_ERR_OVERSIZED, EXT_ERR_BACKPRESSURE);
        assert_ne!(EXT_ERR_INVALID_HANDLE, EXT_ERR_PORT_CLOSED);
    }

    /// The shared record bound is the single numeric truth for the EventPort
    /// record limit and the DeferredPort terminal payload limit.
    #[test]
    fn extension_event_record_max_bytes_is_frozen() {
        assert_eq!(EXTENSION_EVENT_RECORD_MAX_BYTES, 64 * 1024);
    }

    /// The command-scope and typed-error wire shapes are camelCase and the
    /// identity chain fields stay optional (registry-era frames deserialize
    /// unchanged).
    #[test]
    fn command_scope_and_typed_error_serialize_as_frozen_wire_shapes() {
        let scope = CommandScope {
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            session_id: "session-1".to_string(),
            instance_generation: 3,
        };
        assert_eq!(
            serde_json::to_value(&scope).unwrap(),
            serde_json::json!({
                "appId": "app-1",
                "trayId": "tray-1",
                "sessionId": "session-1",
                "instanceGeneration": 3
            })
        );

        let envelope = ExtensionEnvelope {
            scope: ExtensionScope {
                app_id: "app-1".to_string(),
                tray_id: Some("tray-1".to_string()),
                ext: "dialog".to_string(),
            },
            command_scope: Some(scope),
            data: serde_json::json!({ "type": "show" }),
        };
        assert_eq!(
            serde_json::to_value(&envelope).unwrap(),
            serde_json::json!({
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "dialog" },
                "commandScope": {
                    "appId": "app-1",
                    "trayId": "tray-1",
                    "sessionId": "session-1",
                    "instanceGeneration": 3
                },
                "data": { "type": "show" }
            })
        );
        // Event envelopes never carry a command scope; the field round-trips
        // as absent for legacy payloads.
        let legacy: ExtensionEnvelope = serde_json::from_value(serde_json::json!({
            "scope": { "appId": "app-1", "ext": "dialog" },
            "data": {}
        }))
        .expect("legacy envelope");
        assert_eq!(legacy.command_scope, None);

        let error = TypedExtensionError {
            code: "dialog_session_busy".to_string(),
            message: "owner already shows a dialog".to_string(),
            details: Some(serde_json::json!({ "kind": "owner", "trayId": "tray-1" })),
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({
                "code": "dialog_session_busy",
                "message": "owner already shows a dialog",
                "details": { "kind": "owner", "trayId": "tray-1" }
            })
        );
        let bare: TypedExtensionError = serde_json::from_value(serde_json::json!({
            "code": "dialog_platform_unsupported",
            "message": "linux has no native dialog surface"
        }))
        .expect("details-free typed error");
        assert_eq!(bare.details, None);
    }

    /// The embedded identity-chain inputs are optional both ways: old
    /// LoadExt frames without them deserialize, new frames round-trip them.
    #[test]
    fn expected_extension_identity_chain_fields_are_optional() {
        let legacy: ExpectedExtensionIdentity = serde_json::from_value(
            serde_json::json!({
                "extensionName": "dialog",
                "artifactSetVersion": "1.0.0",
                "contractFingerprint": "opentray-ext-dialog-contract-1",
                "target": { "os": "darwin", "arch": "arm64" }
            }),
        )
        .expect("registry-era identity deserializes");
        assert_eq!(legacy.sha256, None);
        assert_eq!(legacy.build_identity, None);
        assert_eq!(
            serde_json::to_value(&legacy).unwrap(),
            serde_json::json!({
                "extensionName": "dialog",
                "artifactSetVersion": "1.0.0",
                "contractFingerprint": "opentray-ext-dialog-contract-1",
                "target": { "os": "darwin", "arch": "arm64" }
            }),
            "absent chain fields stay absent on the wire"
        );

        let chained = ExpectedExtensionIdentity {
            sha256: Some("a".repeat(64)),
            build_identity: Some("build-123".to_string()),
            ..legacy.clone()
        };
        let wire = serde_json::to_value(&chained).unwrap();
        assert_eq!(wire["sha256"], serde_json::json!("a".repeat(64)));
        assert_eq!(wire["buildIdentity"], serde_json::json!("build-123"));
        let round: ExpectedExtensionIdentity =
            serde_json::from_value(wire).expect("chained identity round-trip");
        assert_eq!(round, chained);
    }
}
