//! Clipboard command/option/result DTOs (add-ext-clipboard design
//! reference sections 1-3).
//!
//! Shared, platform-neutral wire shapes. The facade (`@opentray/ext-clipboard`)
//! owns preflight validation (the frozen UTF-16 unit cap and the
//! lone-surrogate rejection); the native side re-validates structurally with
//! the same frozen rules (defense in depth) so a malformed frame can never
//! reach a native clipboard call. Struct variants use
//! `deny_unknown_fields`: an unknown field is a rejection, never a silent
//! ignore. (serde's internally-tagged representation cannot enforce this on
//! unit variants — readText/clear/getBackend tolerate extra fields next to
//! the tag; the facade builds every command frame type-safely and never
//! forwards caller JSON.)
//!
//! Error-code law (design section 3): the typed catalog is EXACTLY the five
//! `clipboard_*` codes below. Malformed frames and host-contract violations
//! are transport categories (never clipboard-prefixed), so the
//! facade-matchable catalog stays frozen.

use serde::{Deserialize, Serialize};

use opentray_spec::TypedExtensionError;

/// Typed error codes of the clipboard contract (design section 3, frozen
/// catalog of five): platform rejection, the win32 lock-contention
/// terminal, native API failures, and the two frozen payload gates.
#[allow(dead_code)]
pub(crate) mod error_code {
    pub const PLATFORM_UNSUPPORTED: &str = "clipboard_platform_unsupported";
    pub const LOCKED: &str = "clipboard_locked";
    pub const UNAVAILABLE: &str = "clipboard_unavailable";
    pub const PAYLOAD_TOO_LARGE: &str = "clipboard_payload_too_large";
    pub const PAYLOAD_INVALID: &str = "clipboard_payload_invalid";
}

/// Transport categories that are NOT part of the typed five-code catalog:
/// they name host-contract violations and malformed frames, which the
/// facade never matches as clipboard failure families. (The
/// dispatch-thread category is emitted by the darwin owner-thread gate
/// only.)
#[allow(dead_code)]
pub(crate) mod transport_code {
    /// A dispatch arrived off the broker's GUI owner (main) thread.
    pub const INVALID_DISPATCH_THREAD: &str = "invalid_dispatch_thread";
    /// A command frame is structurally invalid (unknown type/field or a
    /// missing required field).
    pub const INVALID_CLIPBOARD_COMMAND: &str = "invalid_clipboard_command";
}

/// Frozen write bound (design section 1): 1 MiB = 1,048,576 UTF-16 code
/// units — the same unit win32 `CF_UNICODETEXT` and the JS `String.length`
/// use. Shared by the facade preflight (primary gate), this native
/// re-validation, and the `maxWriteUtf16` DTO field.
pub(crate) const MAX_WRITE_UTF16: usize = 1_048_576;

/// The full native command surface (design section 1). Every command is
/// Immediate: clipboard operations resolve when the native call completes
/// inside the command — no DeferredOperation, no poll owner, no
/// completion event (design reference shares the add-ext-sound
/// Immediate-only family law; the deferred-completion-port symbol is
/// deliberately absent).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ClipboardCommand {
    ReadText,
    WriteText { text: String },
    Clear,
    GetBackend,
}

/// `ClipboardBackendCapabilities` (design section 3): one frozen DTO schema
/// shared by both platforms; the exhaustive fixture freezes every field per
/// platform so adding a field without updating both projections is red.
/// Serialize-only by design: the DTO is a one-way native -> facade snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardBackendCapabilities {
    pub platform: &'static str,
    /// v1 constant `true`: the format catalog is a v2 extension slot.
    pub text_only: bool,
    /// Frozen platform-independent write bound (UTF-16 code units).
    pub max_write_utf16: usize,
    /// win32 = true (frozen bounded open-retry law); darwin = false
    /// (AppKit serializes pasteboard access).
    pub bounded_open_retry: bool,
}

impl ClipboardBackendCapabilities {
    /// The frozen darwin projection (design section 3 table).
    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    pub(crate) fn darwin() -> Self {
        Self {
            platform: "darwin",
            text_only: true,
            max_write_utf16: MAX_WRITE_UTF16,
            bounded_open_retry: false,
        }
    }

    /// The frozen win32 projection (design section 3 table).
    #[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
    pub(crate) fn win32() -> Self {
        Self {
            platform: "win32",
            text_only: true,
            max_write_utf16: MAX_WRITE_UTF16,
            bounded_open_retry: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Result event shapes (frozen wire JSON; the facade contract consumes the
// exact same shapes — see the ABI-shaped fixtures in the facade tests).
// ---------------------------------------------------------------------------

/// The `readText` result event: `{ "type": "text", "text": <string|null> }`.
/// `null` is the first-class empty state (no text on the board), never an
/// error and never an empty string.
pub(crate) fn text_result_event(text: Option<&str>) -> serde_json::Value {
    serde_json::json!({ "type": "text", "text": text })
}

/// The void-operation result event (`writeText`/`clear`): the dialog/sound
/// family `{ "type": "result", "op": ... }` shape.
pub(crate) fn op_result_event(op: &str) -> serde_json::Value {
    serde_json::json!({ "type": "result", "op": op })
}

/// The `getBackend` result event: `{ "type": "backend", "backend": ... }`
/// (the shared ABI shape law of the archived dialog/sound extension specs).
pub(crate) fn backend_result_event(backend: &ClipboardBackendCapabilities) -> serde_json::Value {
    serde_json::json!({ "type": "backend", "backend": backend })
}

// ---------------------------------------------------------------------------
// Typed error builders (details are always JSON objects per the frozen
// envelope shape; never null, never a scalar).
// ---------------------------------------------------------------------------

pub(crate) fn typed_error(code: &str, message: impl Into<String>) -> TypedExtensionError {
    TypedExtensionError {
        code: code.to_string(),
        message: message.into(),
        details: None,
    }
}

/// `clipboard_locked` (design section 2, frozen retry terminal): the win32
/// clipboard stayed locked for the whole bounded-open budget. Details carry
/// `attempts` (counting the first attempt) and `elapsedMs` (including
/// native call time, up to typed-error construction).
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub(crate) fn locked_error(attempts: u32, elapsed_ms: u128) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::LOCKED.to_string(),
        message: format!(
            "the win32 clipboard stayed locked by another process for the whole \
             open budget ({attempts} attempts, {elapsed_ms} ms elapsed)"
        ),
        details: Some(serde_json::json!({
            "attempts": attempts,
            "elapsedMs": elapsed_ms,
        })),
    }
}

/// `clipboard_unavailable` (design section 3): a native API failure. The
/// frozen details carry the OS error code — the win32 `GetLastError()`
/// value; darwin bool-false surfaces pass 0 (no OS error code exists on
/// that path).
pub(crate) fn unavailable_error(os_error_code: u32, context: &str) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::UNAVAILABLE.to_string(),
        message: format!("native clipboard API failure ({context})"),
        details: Some(serde_json::json!({ "osErrorCode": os_error_code })),
    }
}

/// `clipboard_payload_too_large` (design section 1, frozen): the write
/// payload exceeds 1 MiB measured in UTF-16 code units. Details carry
/// `lengthUtf16` and `limit`.
pub(crate) fn payload_too_large_error(length_utf16: usize) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::PAYLOAD_TOO_LARGE.to_string(),
        message: format!(
            "writeText payload is {length_utf16} UTF-16 code units; \
             the frozen write cap is {MAX_WRITE_UTF16}"
        ),
        details: Some(serde_json::json!({
            "lengthUtf16": length_utf16,
            "limit": MAX_WRITE_UTF16,
        })),
    }
}

/// `clipboard_payload_invalid` (design section 1, frozen): an input
/// containing a lone surrogate — rejected, never silently replaced (a
/// replacement write would break read-back round-trip fidelity). Details
/// carry `reason: "lone-surrogate"` and the offending UTF-16 code-unit
/// index.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub(crate) fn payload_invalid_lone_surrogate(index: usize) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::PAYLOAD_INVALID.to_string(),
        message: format!(
            "payload contains a lone surrogate at UTF-16 index {index}; \
             replacement writes are forbidden"
        ),
        details: Some(serde_json::json!({
            "reason": "lone-surrogate",
            "index": index,
        })),
    }
}

/// `clipboard_platform_unsupported` (design section 3): platforms without a
/// native clipboard surface in v1 (Linux). The facade rejects before any
/// dispatch; this builder is the native mirror for mainstream targets that
/// never compile a platform seam.
#[allow(dead_code)]
pub(crate) fn platform_unsupported_error() -> TypedExtensionError {
    typed_error(
        error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native clipboard surface",
    )
}

// ---------------------------------------------------------------------------
// UTF-16 encoding helpers (design section 1, frozen measurement unit)
// ---------------------------------------------------------------------------

/// UTF-16 code-unit count of `text` (the frozen measurement unit — the
/// same unit `CF_UNICODETEXT` and JS `String.length` use).
pub(crate) fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Native write re-validation (defense in depth; the facade preflight owns
/// the primary gate). Enforces the frozen 1 MiB UTF-16-unit cap. Lone
/// surrogates cannot reach this point through the JSON transport:
/// serde_json rejects unpaired `\uXXXX` escapes at parse time and a Rust
/// `str` cannot hold one — the facade owns the typed lone-surrogate gate.
pub(crate) fn validate_write_text(text: &str) -> Result<(), TypedExtensionError> {
    let length = utf16_length(text);
    if length > MAX_WRITE_UTF16 {
        return Err(payload_too_large_error(length));
    }
    Ok(())
}

/// Finds the UTF-16 code-unit index of the first unpaired surrogate in a
/// copied unit buffer (read-path decode and the win32 HGLOBAL decode
/// boundary). A paired high+low unit advances past both; any low unit
/// reached standalone is unpaired by construction.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub(crate) fn find_lone_surrogate(units: &[u16]) -> Option<usize> {
    let mut index = 0usize;
    let mut rest = units.iter().copied();
    while let Some(unit) = rest.next() {
        let current = index;
        index += 1;
        match unit {
            0xD800..=0xDBFF => match rest.next() {
                Some(0xDC00..=0xDFFF) => index += 1,
                _ => return Some(current),
            },
            0xDC00..=0xDFFF => return Some(current),
            _ => {}
        }
    }
    None
}

/// Decodes a deep-copied board buffer into the readText value (design
/// section 1): defensive truncation at the first zero terminator (a
/// non-terminated CF_UNICODETEXT buffer is theoretically impossible; if it
/// happens anyway the copy truncates and returns, never errors), then
/// strict UTF-16 decode — a lone surrogate in foreign board bytes is the
/// typed `clipboard_payload_invalid` rejection, never a silent
/// replacement.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub(crate) fn decode_board_units(units: &[u16]) -> Result<String, TypedExtensionError> {
    let terminated = units.split(|&unit| unit == 0).next().unwrap_or(&[]);
    if let Some(index) = find_lone_surrogate(terminated) {
        return Err(payload_invalid_lone_surrogate(index));
    }
    String::from_utf16(terminated).map_err(|_| {
        // Unreachable after the lone-surrogate scan above; keep the typed
        // shape honest if the standard library ever disagrees.
        payload_invalid_lone_surrogate(0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_tags_parse_in_camel_case_and_reject_everything_else() {
        let parsed: ClipboardCommand =
            serde_json::from_value(serde_json::json!({ "type": "readText" })).unwrap();
        assert_eq!(parsed, ClipboardCommand::ReadText);
        let parsed: ClipboardCommand =
            serde_json::from_value(serde_json::json!({ "type": "writeText", "text": "hello" }))
                .unwrap();
        assert_eq!(
            parsed,
            ClipboardCommand::WriteText {
                text: "hello".to_string()
            }
        );
        let parsed: ClipboardCommand =
            serde_json::from_value(serde_json::json!({ "type": "clear" })).unwrap();
        assert_eq!(parsed, ClipboardCommand::Clear);
        let parsed: ClipboardCommand =
            serde_json::from_value(serde_json::json!({ "type": "getBackend" })).unwrap();
        assert_eq!(parsed, ClipboardCommand::GetBackend);

        // Unknown types, snake_case tags, and missing fields never parse.
        for raw in [
            serde_json::json!({ "type": "read_text" }),
            serde_json::json!({ "type": "noSuchCommand" }),
            serde_json::json!({ "type": "writeText" }),
            serde_json::json!({ "type": "writeText", "text": 7 }),
        ] {
            assert!(
                serde_json::from_value::<ClipboardCommand>(raw.clone()).is_err(),
                "must reject: {raw}"
            );
        }
    }

    #[test]
    fn unknown_fields_reject_instead_of_silently_ignoring() {
        // Struct variants enforce deny_unknown_fields.
        let error = serde_json::from_value::<ClipboardCommand>(
            serde_json::json!({ "type": "writeText", "text": "x", "mystery": 1 }),
        )
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));

        // serde's internally-tagged representation cannot enforce
        // deny_unknown_fields on UNIT variants (readText/clear/getBackend):
        // extra fields next to the tag are ignored there. The facade owns
        // that gate — its command surface is type-built (never
        // caller-JSON), and writeText (the only variant carrying caller
        // data) stays strict here.
        let parsed: ClipboardCommand =
            serde_json::from_value(serde_json::json!({ "type": "readText", "reason": "peek" }))
                .unwrap();
        assert_eq!(parsed, ClipboardCommand::ReadText);
    }

    /// The backend DTO fixture is frozen per platform and exhaustive over
    /// the wire keys (design section 3, task 3.3): both constructors are
    /// compared against the same complete fixture on every platform, and a
    /// new field without a fixture update turns the key set red.
    #[test]
    fn backend_capabilities_fixtures_are_frozen_and_exhaustive() {
        assert_eq!(
            serde_json::to_value(ClipboardBackendCapabilities::darwin()).unwrap(),
            serde_json::json!({
                "platform": "darwin",
                "textOnly": true,
                "maxWriteUtf16": MAX_WRITE_UTF16,
                "boundedOpenRetry": false,
            })
        );
        assert_eq!(
            serde_json::to_value(ClipboardBackendCapabilities::win32()).unwrap(),
            serde_json::json!({
                "platform": "win32",
                "textOnly": true,
                "maxWriteUtf16": MAX_WRITE_UTF16,
                "boundedOpenRetry": true,
            })
        );
        for backend in [
            ClipboardBackendCapabilities::darwin(),
            ClipboardBackendCapabilities::win32(),
        ] {
            assert_eq!(backend.max_write_utf16, 1_048_576);
            assert!(backend.text_only);
            let wire = serde_json::to_value(&backend).unwrap();
            let object = wire.as_object().expect("backend DTO object");
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort_unstable();
            assert_eq!(
                keys,
                vec!["boundedOpenRetry", "maxWriteUtf16", "platform", "textOnly"]
            );
        }
        // The retry flag is the one platform-varying fact.
        assert_ne!(
            ClipboardBackendCapabilities::darwin().bounded_open_retry,
            ClipboardBackendCapabilities::win32().bounded_open_retry,
        );
    }

    /// The result event shapes are frozen wire JSON (the facade consumes
    /// the exact same shapes through its ABI-shaped fixtures).
    #[test]
    fn result_event_shapes_are_frozen() {
        assert_eq!(
            text_result_event(Some("hello")),
            serde_json::json!({ "type": "text", "text": "hello" })
        );
        assert_eq!(
            text_result_event(None),
            serde_json::json!({ "type": "text", "text": null })
        );
        assert_eq!(
            op_result_event("writeText"),
            serde_json::json!({ "type": "result", "op": "writeText" })
        );
        assert_eq!(
            backend_result_event(&ClipboardBackendCapabilities::win32()),
            serde_json::json!({
                "type": "backend",
                "backend": {
                    "platform": "win32",
                    "textOnly": true,
                    "maxWriteUtf16": MAX_WRITE_UTF16,
                    "boundedOpenRetry": true,
                }
            })
        );
    }

    #[test]
    fn typed_error_details_payloads_match_the_frozen_shapes() {
        let locked = locked_error(15, 2000);
        assert_eq!(locked.code, error_code::LOCKED);
        assert_eq!(
            locked.details.as_ref().unwrap(),
            &serde_json::json!({ "attempts": 15, "elapsedMs": 2000 })
        );

        let unavailable = unavailable_error(6, "GetClipboardData");
        assert_eq!(unavailable.code, error_code::UNAVAILABLE);
        assert_eq!(
            unavailable.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 6 })
        );

        let too_large = payload_too_large_error(1_048_577);
        assert_eq!(too_large.code, error_code::PAYLOAD_TOO_LARGE);
        assert_eq!(
            too_large.details.as_ref().unwrap(),
            &serde_json::json!({ "lengthUtf16": 1_048_577, "limit": 1_048_576 })
        );

        let invalid = payload_invalid_lone_surrogate(3);
        assert_eq!(invalid.code, error_code::PAYLOAD_INVALID);
        assert_eq!(
            invalid.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "lone-surrogate", "index": 3 })
        );

        // Every builder round-trips through the frozen envelope (details
        // must stay an object, never null/scalar).
        for error in [&locked, &unavailable, &too_large, &invalid] {
            let wire = serde_json::to_value(error).unwrap();
            let parsed: TypedExtensionError = serde_json::from_value(wire).unwrap();
            assert_eq!(parsed, *error);
        }
    }

    #[test]
    fn utf16_length_counts_code_units_not_scalars() {
        assert_eq!(utf16_length(""), 0);
        assert_eq!(utf16_length("hello"), 5);
        // Emoji is one scalar but two UTF-16 units (the CF_UNICODETEXT unit).
        assert_eq!(utf16_length("\u{1F600}"), 2);
        assert_eq!(utf16_length("a\u{1F600}b"), 4);
    }

    #[test]
    fn write_validation_enforces_the_frozen_cap_boundaries() {
        // Exactly at the cap passes; one unit over rejects typed.
        let at_cap = "x".repeat(MAX_WRITE_UTF16);
        assert_eq!(validate_write_text(&at_cap), Ok(()));
        let over_cap = "x".repeat(MAX_WRITE_UTF16 + 1);
        let error = validate_write_text(&over_cap).unwrap_err();
        assert_eq!(error.code, error_code::PAYLOAD_TOO_LARGE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "lengthUtf16": MAX_WRITE_UTF16 + 1, "limit": MAX_WRITE_UTF16 })
        );
        // Emoji counts by units: a 524_288-emoji string hits exactly the cap.
        let emoji_at_cap = "\u{1F600}".repeat(MAX_WRITE_UTF16 / 2);
        assert_eq!(validate_write_text(&emoji_at_cap), Ok(()));
        let emoji_over = "\u{1F600}".repeat(MAX_WRITE_UTF16 / 2 + 1);
        assert_eq!(
            validate_write_text(&emoji_over).unwrap_err().code,
            error_code::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn lone_surrogate_detection_reports_the_first_unpaired_unit_index() {
        // Paired surrogates and plain BMP units never trigger.
        assert_eq!(find_lone_surrogate(&[]), None);
        assert_eq!(find_lone_surrogate(&[0x0041, 0x0042]), None);
        assert_eq!(
            find_lone_surrogate(&[0xD83D, 0xDE00, 0x0021]), // 😀!
            None
        );
        // Lone high surrogate (start, after a pair, and at the end).
        assert_eq!(find_lone_surrogate(&[0xD83D]), Some(0));
        assert_eq!(find_lone_surrogate(&[0xD83D, 0xDE00, 0xD83D]), Some(2));
        assert_eq!(
            find_lone_surrogate(&[0x0061, 0xD83D, 0xDE00, 0xD83D]),
            Some(3)
        );
        // Lone low surrogate (start, and after a pair whose high was consumed).
        assert_eq!(find_lone_surrogate(&[0xDE00]), Some(0));
        assert_eq!(find_lone_surrogate(&[0xD83D, 0xDE00, 0xDE00]), Some(2));
        // A high surrogate followed by a non-surrogate unit is unpaired and
        // the following unit is inspected on the next iteration.
        assert_eq!(find_lone_surrogate(&[0xD83D, 0x0041]), Some(0));
    }

    #[test]
    fn board_decode_truncates_at_the_first_terminator_and_rejects_lone_surrogates() {
        // Plain decode.
        assert_eq!(decode_board_units(&[0x0068, 0x0069, 0]).unwrap(), "hi");
        // Emoji decode.
        assert_eq!(
            decode_board_units(&[0xD83D, 0xDE00, 0]).unwrap(),
            "\u{1F600}"
        );
        // Defensive truncation: bytes after the first terminator (GlobalSize
        // over-copy, stale tail) are dropped, never errors.
        assert_eq!(
            decode_board_units(&[0x0041, 0x0042, 0, 0x0043, 0]).unwrap(),
            "AB"
        );
        // No terminator at all (theoretically impossible): the full copy
        // returns as the defensive body.
        assert_eq!(decode_board_units(&[0x0041, 0x0042]).unwrap(), "AB");
        // Lone surrogate in foreign board bytes: typed rejection with the
        // offending index, never a replacement decode.
        let error = decode_board_units(&[0x0061, 0xD83D, 0xDE00, 0xD83D, 0]).unwrap_err();
        assert_eq!(error.code, error_code::PAYLOAD_INVALID);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "lone-surrogate", "index": 3 })
        );
    }
}
