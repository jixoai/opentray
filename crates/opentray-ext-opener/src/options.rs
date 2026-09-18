//! Opener command/option/result DTOs (add-ext-opener design sections 1-3).
//!
//! Shared, platform-neutral wire shapes. The facade (`@opentray/ext-opener`)
//! owns the frozen preflight matrix (path/URL classification, the scheme
//! allowlist gate, the reveal rejection set, and the trailing-separator
//! trim law); the native side re-validates structurally with the same
//! frozen rules (defense in depth, see `resolve.rs`) so a malformed frame
//! can never reach a native open call. All command structs use
//! `deny_unknown_fields`: an unknown field is a rejection, never a silent
//! ignore — v1 carries no options objects at all.
//!
//! Error-code law (design section 3): the typed catalog is EXACTLY the
//! four `opener_*` codes below. Malformed frames and host-contract
//! violations are transport categories (never opener-prefixed), so the
//! facade-matchable catalog stays frozen.

use serde::{Deserialize, Serialize};

use opentray_spec::TypedExtensionError;

/// Typed error codes of the opener contract (design section 3, frozen
/// catalog of four). `opener_target_invalid` carries `{reason}`; the
/// others carry their own frozen details shapes.
#[allow(dead_code)]
pub(crate) mod error_code {
    pub const PLATFORM_UNSUPPORTED: &str = "opener_platform_unsupported";
    pub const TARGET_INVALID: &str = "opener_target_invalid";
    pub const SCHEME_BLOCKED: &str = "opener_scheme_blocked";
    pub const FAILED: &str = "opener_failed";
}

/// Transport categories that are NOT part of the typed four-code catalog:
/// they name host-contract violations and malformed frames, which the
/// facade never matches as opener failure families. (The dispatch-thread
/// category is emitted by the darwin owner-thread gate only.)
#[allow(dead_code)]
pub(crate) mod transport_code {
    /// A dispatch arrived off the broker's GUI owner (main) thread.
    pub const INVALID_DISPATCH_THREAD: &str = "invalid_dispatch_thread";
    /// A command frame is structurally invalid (unknown type/field,
    /// missing field, or a missing host-injected commandScope).
    pub const INVALID_OPENER_COMMAND: &str = "invalid_opener_command";
}

/// The frozen v1 scheme allowlist (design section 2, Codex R1 ruling):
/// lowercase canonical, matched case-insensitively. Relaxation is a future
/// additive compatibility increment through an explicit spec change —
/// never a runtime silent widening.
pub(crate) const ALLOWED_SCHEMES: &[&str] = &["http", "https", "file", "mailto"];

/// The full native command surface (design section 1). Every command is
/// Immediate: opening/revealing is resolve-on-acceptance (the family law)
/// — no DeferredOperation, no poll owner, no completion event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum OpenerCommand {
    Open {
        /// URL or absolute file path, exactly as the facade preflight
        /// accepted it (paths pass through literally; `file:` URLs are
        /// never normalized to paths).
        target: String,
    },
    RevealInFolder {
        path: String,
    },
    GetBackend,
}

/// `OpenerBackendCapabilities` (design section 3, frozen schema —
/// isomorphic with `@opentray/spec`): one frozen DTO shared by both
/// platforms; the exhaustive fixture freezes every field per platform so
/// adding a field without updating both projections is red. Serialize-only
/// by design: the DTO is a one-way native -> facade snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenerBackendCapabilities {
    pub platform: &'static str,
    pub allowed_schemes: &'static [&'static str],
    pub supports_reveal_in_folder: bool,
}

impl OpenerBackendCapabilities {
    /// The frozen darwin projection: NSWorkspace open/reveal with the
    /// shared v1 allowlist.
    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    pub(crate) fn darwin() -> Self {
        Self {
            platform: "darwin",
            allowed_schemes: ALLOWED_SCHEMES,
            supports_reveal_in_folder: true,
        }
    }

    /// The frozen win32 projection: ShellExecuteW open/explorer /select
    /// with the same shared v1 allowlist.
    #[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
    pub(crate) fn win32() -> Self {
        Self {
            platform: "win32",
            allowed_schemes: ALLOWED_SCHEMES,
            supports_reveal_in_folder: true,
        }
    }
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

/// `opener_platform_unsupported` (design section 0/3): platforms without a
/// native opener surface in v1 (Linux). Emitted by the facade before any
/// broker frame; the non-darwin/non-win32 native seams mirror it.
#[allow(dead_code)]
pub(crate) fn platform_unsupported_error() -> TypedExtensionError {
    typed_error(
        error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native opener surface",
    )
}

/// `opener_target_invalid` with the frozen `{reason}` details (reasons:
/// "relative", "drive-relative", "path-quote", "path-control-char").
pub(crate) fn target_invalid_error(
    reason: &str,
    target: &str,
) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::TARGET_INVALID.to_string(),
        message: format!("opener target is invalid ({reason}): {target}"),
        details: Some(serde_json::json!({ "reason": reason })),
    }
}

/// `opener_scheme_blocked` with the blocked scheme in details (design
/// section 2: the details carry the scheme, lowercased never — exactly as
/// scanned from the target).
pub(crate) fn scheme_blocked_error(scheme: &str, target: &str) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::SCHEME_BLOCKED.to_string(),
        message: format!("opener scheme {scheme:?} is not in the v1 allowlist: {target}"),
        details: Some(serde_json::json!({ "scheme": scheme })),
    }
}

/// `opener_failed` — win32 shape (design section 2 frozen acceptance
/// law): `ShellExecuteW` returned a value <= 32; the details carry the
/// integer `shellExecuteResult` plus the mapped system `SE_ERR_*` reason
/// string when the value is a known table member. (win32 target and the
/// host-runnable test matrix — the same gating as the resolve.rs seams.)
#[cfg(any(target_os = "windows", test))]
pub(crate) fn shell_execute_failed_error(
    shell_execute_result: i64,
    reason: Option<&str>,
    target: &str,
) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::FAILED.to_string(),
        message: match reason {
            Some(reason) => format!(
                "ShellExecuteW rejected the opener target ({reason}, result \
                 {shell_execute_result}): {target}"
            ),
            None => format!(
                "ShellExecuteW rejected the opener target (result \
                 {shell_execute_result}): {target}"
            ),
        },
        details: Some(match reason {
            Some(reason) => serde_json::json!({
                "shellExecuteResult": shell_execute_result,
                "reason": reason,
            }),
            None => serde_json::json!({ "shellExecuteResult": shell_execute_result }),
        }),
    }
}

/// `opener_failed` — darwin shape: the boolean acceptance oracle of
/// `NSWorkspace.openURL` (design section 3: "darwin 为 osError 布尔受理
/// 语义"). (darwin target and the host-runnable test matrix.)
#[cfg(any(target_os = "macos", test))]
pub(crate) fn os_error_failed_error(target: &str) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::FAILED.to_string(),
        message: format!("the native open call rejected the target: {target}"),
        details: Some(serde_json::json!({ "osError": true })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_tags_parse_in_camel_case_and_reject_everything_else() {
        let parsed: OpenerCommand =
            serde_json::from_value(serde_json::json!({ "type": "open", "target": "/tmp/a.txt" }))
                .unwrap();
        assert_eq!(
            parsed,
            OpenerCommand::Open {
                target: "/tmp/a.txt".to_string()
            }
        );
        let parsed: OpenerCommand = serde_json::from_value(
            serde_json::json!({ "type": "revealInFolder", "path": "/tmp/a.txt" }),
        )
        .unwrap();
        assert_eq!(
            parsed,
            OpenerCommand::RevealInFolder {
                path: "/tmp/a.txt".to_string()
            }
        );
        let parsed: OpenerCommand =
            serde_json::from_value(serde_json::json!({ "type": "getBackend" })).unwrap();
        assert_eq!(parsed, OpenerCommand::GetBackend);

        // Unknown types, snake_case tags, and missing fields never parse.
        for raw in [
            serde_json::json!({ "type": "open_target", "target": "x" }),
            serde_json::json!({ "type": "noSuchCommand" }),
            serde_json::json!({ "type": "open" }),
            serde_json::json!({ "type": "revealInFolder" }),
        ] {
            assert!(
                serde_json::from_value::<OpenerCommand>(raw.clone()).is_err(),
                "must reject: {raw}"
            );
        }
    }

    #[test]
    fn unknown_fields_reject_instead_of_silently_ignoring() {
        // v1 has no options objects: any extra field is a rejection.
        for raw in [
            serde_json::json!({ "type": "open", "target": "/a", "options": { "app": "x" } }),
            serde_json::json!({ "type": "open", "target": "/a", "mystery": 1 }),
            serde_json::json!({ "type": "revealInFolder", "path": "/a", "mystery": true }),
        ] {
            let error = serde_json::from_value::<OpenerCommand>(raw.clone()).unwrap_err();
            assert!(
                error.to_string().contains("unknown field")
                    || error.to_string().contains("missing field"),
                "must reject: {raw} ({error})"
            );
        }
    }

    /// The backend DTO fixture is frozen per platform and exhaustive over
    /// the wire keys (design section 3, task 3.3): both constructors are
    /// compared against the same complete fixture on every platform, and
    /// a new field without a fixture update turns the key set red.
    #[test]
    fn backend_capabilities_fixtures_are_frozen_and_exhaustive() {
        let expected_schemes: serde_json::Value =
            serde_json::json!(["http", "https", "file", "mailto"]);
        assert_eq!(
            serde_json::to_value(OpenerBackendCapabilities::darwin()).unwrap(),
            serde_json::json!({
                "platform": "darwin",
                "allowedSchemes": expected_schemes,
                "supportsRevealInFolder": true,
            })
        );
        assert_eq!(
            serde_json::to_value(OpenerBackendCapabilities::win32()).unwrap(),
            serde_json::json!({
                "platform": "win32",
                "allowedSchemes": expected_schemes,
                "supportsRevealInFolder": true,
            })
        );
        for backend in [
            OpenerBackendCapabilities::darwin(),
            OpenerBackendCapabilities::win32(),
        ] {
            let wire = serde_json::to_value(&backend).unwrap();
            let object = wire.as_object().expect("backend DTO object");
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort_unstable();
            assert_eq!(
                keys,
                vec!["allowedSchemes", "platform", "supportsRevealInFolder"]
            );
        }
    }

    /// The typed error details payloads match the frozen shapes (plain
    /// `{reason}` / `{scheme}` / `{shellExecuteResult[, reason]}` /
    /// `{osError}`) and round-trip through the frozen envelope.
    #[test]
    fn typed_error_details_payloads_match_the_frozen_shapes() {
        let error = target_invalid_error("path-quote", "C:\\a\"b");
        assert_eq!(error.code, error_code::TARGET_INVALID);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "path-quote" })
        );

        let error = scheme_blocked_error("ssh", "ssh://host");
        assert_eq!(error.code, error_code::SCHEME_BLOCKED);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "scheme": "ssh" })
        );

        let error = shell_execute_failed_error(31, Some("noassoc"), "C:\\x.xyz");
        assert_eq!(error.code, error_code::FAILED);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 31, "reason": "noassoc" })
        );

        let error = shell_execute_failed_error(11, None, "C:\\x");
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "shellExecuteResult": 11 })
        );

        let error = os_error_failed_error("/tmp/x");
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osError": true })
        );

        // Round-trip: details must stay an object, never null/scalar.
        for error in [
            target_invalid_error("relative", "a/b"),
            scheme_blocked_error("chrome", "chrome://x"),
            shell_execute_failed_error(2, Some("filenotfound"), "C:\\x"),
            os_error_failed_error("/tmp/x"),
        ] {
            let wire = serde_json::to_value(&error).unwrap();
            let parsed: TypedExtensionError = serde_json::from_value(wire).unwrap();
            assert_eq!(parsed, error);
        }
    }
}
