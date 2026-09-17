//! Sound command/option/result DTOs (add-ext-sound design sections 1-3).
//!
//! Shared, platform-neutral wire shapes. The facade (`@opentray/ext-sound`)
//! owns preflight validation (including the win32 RIFF content check);
//! the native side re-validates structurally with the same frozen rules
//! (defense in depth) so a malformed frame can never reach a native sound
//! call. All command structs use `deny_unknown_fields`: an unknown field
//! is a rejection, never a silent ignore — `PlaySoundOptions` stays a
//! reserved empty object on the facade side and never appears here in v1.
//!
//! Error-code law (design section 3): the typed catalog is EXACTLY the
//! four `sound_*` codes below. Malformed frames and host-contract
//! violations are transport categories (never sound-prefixed), so the
//! facade-matchable catalog stays frozen.

use serde::{Deserialize, Serialize};

use opentray_spec::TypedExtensionError;

/// Typed error codes of the sound contract (design section 3, frozen
/// catalog of four). `sound_not_found` carries the resolution-details
/// payload; the file codes share the same three-field details shape.
#[allow(dead_code)]
pub(crate) mod error_code {
    pub const PLATFORM_UNSUPPORTED: &str = "sound_platform_unsupported";
    pub const NOT_FOUND: &str = "sound_not_found";
    pub const FORMAT_UNSUPPORTED: &str = "sound_format_unsupported";
    pub const FILE_UNREADABLE: &str = "sound_file_unreadable";
}

/// Transport categories that are NOT part of the typed four-code catalog:
/// they name host-contract violations and malformed frames, which the
/// facade never matches as sound failure families. (The dispatch-thread
/// category is emitted by the darwin owner-thread gate only.)
#[allow(dead_code)]
pub(crate) mod transport_code {
    /// A dispatch arrived off the broker's GUI owner (main) thread.
    pub const INVALID_DISPATCH_THREAD: &str = "invalid_dispatch_thread";
    /// A command frame is structurally invalid (unknown type/field,
    /// missing field, or a missing host-injected commandScope).
    pub const INVALID_SOUND_COMMAND: &str = "invalid_sound_command";
}

/// `BeepKind` (design section 1.1): the five-level alert grading. win32
/// projects it to `MessageBeep`; darwin documents the degradation to
/// `NSBeep()` for every kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BeepKind {
    Default,
    Info,
    Warning,
    Error,
    Question,
}

impl Default for BeepKind {
    fn default() -> Self {
        Self::Default
    }
}

impl BeepKind {
    /// The frozen catalog label used in typed error details (win32 beep
    /// rejection trace; exercised by the fixture tests on every host).
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
            Self::Question => "question",
        }
    }
}

/// One frozen common system-sound name (design section 1.2, R1 §4.1
/// frozen — no additions, no removals) with its per-platform projection.
pub(crate) struct CommonSystemSound {
    pub name: &'static str,
    pub darwin: &'static str,
    pub win32: &'static str,
}

/// The complete frozen common-name table: `notification`/`warning`/`error`
/// only. `default`/`info`/`question` belong to `beep(BeepKind)` and never
/// enter this catalog — alert grading and named system sounds are two
/// semantic layers that do not mix.
pub(crate) const COMMON_SYSTEM_SOUNDS: &[CommonSystemSound] = &[
    CommonSystemSound {
        name: "notification",
        darwin: "Glass",
        win32: "SystemAsterisk",
    },
    CommonSystemSound {
        name: "warning",
        darwin: "Sosumi",
        win32: "SystemExclamation",
    },
    CommonSystemSound {
        name: "error",
        darwin: "Basso",
        win32: "SystemHand",
    },
];

pub(crate) fn lookup_common_system_sound(name: &str) -> Option<&'static CommonSystemSound> {
    COMMON_SYSTEM_SOUNDS.iter().find(|entry| entry.name == name)
}

/// `playSystemSound` resolution order (design section 1.2 law): a common
/// table hit projects to the platform sound name first; a miss passes the
/// string through as a platform-native sound name (darwin `NSSound(named:)`
/// catalog entry or a win32 registry sound-scheme alias).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SystemSoundResolution {
    Common {
        requested: String,
        projected: &'static str,
    },
    Native {
        name: String,
    },
}

impl SystemSoundResolution {
    /// The string the native catalog lookup receives after resolution.
    pub(crate) fn native_name(&self) -> &str {
        match self {
            Self::Common { projected, .. } => projected,
            Self::Native { name } => name,
        }
    }

    /// The name the caller originally requested (details payload field).
    pub(crate) fn requested(&self) -> &str {
        match self {
            Self::Common { requested, .. } => requested,
            Self::Native { name } => name,
        }
    }
}

/// Applies the resolution law. Platform projection happens natively
/// (`darwin`/`win32` flag), keeping this function platform-neutral.
pub(crate) fn resolve_system_sound(requested: &str, darwin: bool) -> SystemSoundResolution {
    match lookup_common_system_sound(requested) {
        Some(entry) => SystemSoundResolution::Common {
            requested: requested.to_string(),
            projected: if darwin { entry.darwin } else { entry.win32 },
        },
        None => SystemSoundResolution::Native {
            name: requested.to_string(),
        },
    }
}

/// The full native command surface (design section 1). Every command is
/// Immediate: sound playback is fire-and-forget and resolves at native
/// acceptance — no DeferredOperation, no poll owner, no completion event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum SoundCommand {
    Beep {
        #[serde(default)]
        kind: BeepKind,
    },
    PlaySystemSound {
        name: String,
    },
    PlaySound {
        path: String,
    },
    GetBackend,
}

/// `SoundBackendCapabilities` (design section 2): one frozen DTO schema
/// shared by both platforms; the exhaustive fixture freezes every field
/// per platform so adding a field without updating both projections is
/// red. `fileFormats` is the v1 promise set (a bounded canonical set,
/// never the OS/codec-dependent open set). Serialize-only by design: the
/// DTO is a one-way native -> facade snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SoundBackendCapabilities {
    pub platform: &'static str,
    pub system_sound_catalog: bool,
    pub play_file: bool,
    pub file_formats: &'static [&'static str],
}

impl SoundBackendCapabilities {
    /// The frozen darwin projection: NSSound catalog resolution plus the
    /// v1 format promise set wav/aiff/mp3/m4a.
    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    pub(crate) fn darwin() -> Self {
        Self {
            platform: "darwin",
            system_sound_catalog: true,
            play_file: true,
            file_formats: &["wav", "aiff", "mp3", "m4a"],
        }
    }

    /// The frozen win32 projection: registry alias resolution (NODEFAULT,
    /// no silent default-sound fallback) plus the WAV-only format promise.
    #[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
    pub(crate) fn win32() -> Self {
        Self {
            platform: "win32",
            system_sound_catalog: true,
            play_file: true,
            file_formats: &["wav"],
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

fn details_payload(requested: &str, platform: &str, attempted: Vec<String>) -> serde_json::Value {
    serde_json::json!({
        "requested": requested,
        "platform": platform,
        "attempted": attempted,
    })
}

/// `sound_not_found` (design section 1.2): a catalog miss or a native
/// non-acceptance; the details carry the requested name, the platform,
/// and every resolution stage that was attempted. Never a silent
/// fallback, never an error-free miss.
pub(crate) fn not_found_error(
    requested: &str,
    platform: &str,
    attempted: Vec<String>,
) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::NOT_FOUND.to_string(),
        message: format!(
            "no system sound matched {requested:?} on {platform} \
             (attempted: {})",
            attempted.join(", ")
        ),
        details: Some(details_payload(requested, platform, attempted)),
    }
}

/// `sound_file_unreadable` (design section 1.3): the path could not be
/// read as a playable sound natively. The details mirror the not-found
/// three-field shape with the requested path.
pub(crate) fn file_unreadable_error(
    requested: &str,
    platform: &str,
    attempted: Vec<String>,
) -> TypedExtensionError {
    TypedExtensionError {
        code: error_code::FILE_UNREADABLE.to_string(),
        message: format!(
            "sound file {requested:?} could not be read on {platform} \
             (attempted: {})",
            attempted.join(", ")
        ),
        details: Some(details_payload(requested, platform, attempted)),
    }
}

/// `sound_platform_unsupported` (design section 0/3): platforms without a
/// native sound surface in v1 (Linux). Emitted only by the non-darwin/
/// non-win32 platform seams, which the mainstream targets never compile.
#[allow(dead_code)]
pub(crate) fn platform_unsupported_error() -> TypedExtensionError {
    typed_error(
        error_code::PLATFORM_UNSUPPORTED,
        "this platform has no native sound surface",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_tags_parse_in_camel_case_and_reject_everything_else() {
        let parsed: SoundCommand =
            serde_json::from_value(serde_json::json!({ "type": "beep" })).unwrap();
        assert_eq!(
            parsed,
            SoundCommand::Beep {
                kind: BeepKind::Default
            }
        );
        let parsed: SoundCommand = serde_json::from_value(
            serde_json::json!({ "type": "beep", "kind": "warning" }),
        )
        .unwrap();
        assert_eq!(
            parsed,
            SoundCommand::Beep {
                kind: BeepKind::Warning
            }
        );
        let parsed: SoundCommand = serde_json::from_value(
            serde_json::json!({ "type": "playSystemSound", "name": "Glass" }),
        )
        .unwrap();
        assert_eq!(
            parsed,
            SoundCommand::PlaySystemSound {
                name: "Glass".to_string()
            }
        );
        let parsed: SoundCommand =
            serde_json::from_value(serde_json::json!({ "type": "playSound", "path": "/a.wav" }))
                .unwrap();
        assert_eq!(
            parsed,
            SoundCommand::PlaySound {
                path: "/a.wav".to_string()
            }
        );
        let parsed: SoundCommand =
            serde_json::from_value(serde_json::json!({ "type": "getBackend" })).unwrap();
        assert_eq!(parsed, SoundCommand::GetBackend);

        // Unknown types, snake_case tags, and facade sugar never parse.
        for raw in [
            serde_json::json!({ "type": "play_system_sound", "name": "x" }),
            serde_json::json!({ "type": "noSuchCommand" }),
            serde_json::json!({ "type": "beep", "kind": "nonsense" }),
        ] {
            assert!(
                serde_json::from_value::<SoundCommand>(raw.clone()).is_err(),
                "must reject: {raw}"
            );
        }
    }

    #[test]
    fn unknown_fields_reject_instead_of_silently_ignoring() {
        // v1 has no PlaySoundOptions: any extra field is a rejection (the
        // reserved empty object lives on the facade side only).
        for raw in [
            serde_json::json!({ "type": "playSound", "path": "/a.wav", "options": { "volume": 0.5 } }),
            serde_json::json!({ "type": "playSound", "path": "/a.wav", "volume": 0.5 }),
            serde_json::json!({ "type": "beep", "kind": "info", "mystery": true }),
            serde_json::json!({ "type": "playSystemSound", "name": "x", "mystery": 1 }),
        ] {
            let error = serde_json::from_value::<SoundCommand>(raw.clone()).unwrap_err();
            assert!(
                error.to_string().contains("unknown field"),
                "must reject unknown field: {raw}"
            );
        }
        // Required fields stay required.
        assert!(serde_json::from_value::<SoundCommand>(
            serde_json::json!({ "type": "playSystemSound" })
        )
        .is_err());
        assert!(
            serde_json::from_value::<SoundCommand>(serde_json::json!({ "type": "playSound" }))
                .is_err()
        );
    }

    /// The frozen common-name table (design section 1.2 / R1 §4.1): exactly
    /// three entries with the exact per-platform projections; the beep-only
    /// grades never appear.
    #[test]
    fn common_system_sound_table_is_frozen() {
        let mut names: Vec<&str> = COMMON_SYSTEM_SOUNDS.iter().map(|e| e.name).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["error", "notification", "warning"]);
        for entry in COMMON_SYSTEM_SOUNDS {
            let darwin = lookup_common_system_sound(entry.name).unwrap().darwin;
            let win32 = lookup_common_system_sound(entry.name).unwrap().win32;
            assert_eq!(darwin, entry.darwin);
            assert_eq!(win32, entry.win32);
        }
        assert_eq!(lookup_common_system_sound("notification").unwrap().darwin, "Glass");
        assert_eq!(
            lookup_common_system_sound("notification")
                .unwrap()
                .win32,
            "SystemAsterisk"
        );
        assert_eq!(lookup_common_system_sound("warning").unwrap().darwin, "Sosumi");
        assert_eq!(
            lookup_common_system_sound("warning").unwrap().win32,
            "SystemExclamation"
        );
        assert_eq!(lookup_common_system_sound("error").unwrap().darwin, "Basso");
        assert_eq!(lookup_common_system_sound("error").unwrap().win32, "SystemHand");
        // Beep-only grades and arbitrary strings never hit the table.
        for name in ["default", "info", "question", "Basso", "", "SystemHand"] {
            assert!(
                lookup_common_system_sound(name).is_none(),
                "must not be a common name: {name}"
            );
        }
    }

    /// The resolution law: common hit projects per platform, miss passes
    /// the raw string through as a platform-native name.
    #[test]
    fn system_sound_resolution_projects_common_names_first() {
        assert_eq!(
            resolve_system_sound("notification", true),
            SystemSoundResolution::Common {
                requested: "notification".to_string(),
                projected: "Glass",
            }
        );
        assert_eq!(
            resolve_system_sound("notification", false),
            SystemSoundResolution::Common {
                requested: "notification".to_string(),
                projected: "SystemAsterisk",
            }
        );
        assert_eq!(
            resolve_system_sound("Sosumi", true),
            SystemSoundResolution::Native {
                name: "Sosumi".to_string()
            }
        );
        assert_eq!(
            resolve_system_sound("SystemHand", false),
            SystemSoundResolution::Native {
                name: "SystemHand".to_string()
            }
        );
        // The native-name accessor carries the post-resolution string and
        // the requested accessor the original name.
        let resolution = resolve_system_sound("warning", false);
        assert_eq!(resolution.native_name(), "SystemExclamation");
        assert_eq!(resolution.requested(), "warning");
    }

    /// The backend DTO fixture is frozen per platform and exhaustive over
    /// the wire keys (design section 2, task 3.3): both constructors are
    /// compared against the same complete fixture on every platform, and
    /// a new field without a fixture update turns the key set red.
    #[test]
    fn backend_capabilities_fixtures_are_frozen_and_exhaustive() {
        assert_eq!(
            serde_json::to_value(SoundBackendCapabilities::darwin()).unwrap(),
            serde_json::json!({
                "platform": "darwin",
                "systemSoundCatalog": true,
                "playFile": true,
                "fileFormats": ["wav", "aiff", "mp3", "m4a"],
            })
        );
        assert_eq!(
            serde_json::to_value(SoundBackendCapabilities::win32()).unwrap(),
            serde_json::json!({
                "platform": "win32",
                "systemSoundCatalog": true,
                "playFile": true,
                "fileFormats": ["wav"],
            })
        );
        for backend in [
            SoundBackendCapabilities::darwin(),
            SoundBackendCapabilities::win32(),
        ] {
            let wire = serde_json::to_value(&backend).unwrap();
            let object = wire.as_object().expect("backend DTO object");
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort_unstable();
            assert_eq!(
                keys,
                vec!["fileFormats", "platform", "playFile", "systemSoundCatalog"]
            );
        }
    }

    /// The not-found details payload is a JSON object with the frozen
    /// three fields; the file-unreadable error shares the shape.
    #[test]
    fn typed_error_details_payloads_match_the_frozen_shape() {
        let error = not_found_error("Funk", "darwin", vec![
            "nssound-named:Funk".to_string(),
        ]);
        assert_eq!(error.code, error_code::NOT_FOUND);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({
                "requested": "Funk",
                "platform": "darwin",
                "attempted": ["nssound-named:Funk"],
            })
        );
        // Round-trips through the frozen envelope (details must stay an
        // object, never null/scalar).
        let wire = serde_json::to_value(&error).unwrap();
        let parsed: TypedExtensionError = serde_json::from_value(wire).unwrap();
        assert_eq!(parsed, error);

        let error = file_unreadable_error("/tmp/x.wav", "win32", vec![
            "winmm-filename:/tmp/x.wav".to_string(),
        ]);
        assert_eq!(error.code, error_code::FILE_UNREADABLE);
        assert_eq!(error.details.as_ref().unwrap()["requested"], "/tmp/x.wav");
    }

    #[test]
    fn beep_kinds_cover_the_five_frozen_levels() {
        for (raw, expected) in [
            ("default", BeepKind::Default),
            ("info", BeepKind::Info),
            ("warning", BeepKind::Warning),
            ("error", BeepKind::Error),
            ("question", BeepKind::Question),
        ] {
            let parsed: BeepKind = serde_json::from_value(serde_json::json!(raw)).unwrap();
            assert_eq!(parsed, expected);
            assert_eq!(parsed.label(), raw);
        }
    }
}
