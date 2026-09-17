//! win32 sound surface (add-ext-sound task 3.2).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: OS
//! standard sound feedback atoms and a purge that stops exactly the
//! playback its session owns on the process-wide single-channel device):
//! 1. `beep` projects the five frozen kinds onto `MessageBeep`
//!    (MB_OK/ICONASTERISK/ICONEXCLAMATION/ICONHAND/ICONQUESTION) —
//!    user32, never through the arbiter (`MessageBeep` does not touch the
//!    `PlaySound` single channel).
//! 2. `playSystemSound` plays the registry sound-scheme alias through
//!    the process-wide PlaybackArbiter with the FROZEN flag triple
//!    `SND_ALIAS | SND_ASYNC | SND_NODEFAULT` (design section 1.2, R2
//!    P0-4): ASYNC never blocks the owner loop, NODEFAULT forbids the
//!    silent default-sound fallback so a native `true` always means "the
//!    requested name was accepted".
//! 3. `playSound` plays the path with `SND_FILENAME | SND_ASYNC` through
//!    the same arbiter; the native BOOL false is the readability oracle
//!    (`sound_file_unreadable`). The RIFF content check is facade-owned
//!    preflight and is deliberately NOT repeated natively.
//! 4. Every `PlaySound` path (alias and filename) linearizes through the
//!    arbiter's single critical section — see `arbiter.rs` for the law.
//!
//! Compromise: winmm PlaySound and user32 MessageBeep are static imports
//! (the design's link decision); no WinRT and no comctl surface.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use opentray_spec::TypedExtensionError;
use windows_sys::Win32::Foundation::HMODULE;
use windows_sys::Win32::Media::Audio::{
    PlaySoundW, SND_ALIAS, SND_ASYNC, SND_FILENAME, SND_NODEFAULT, SND_PURGE,
};
use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MB_ICONASTERISK, MB_ICONEXCLAMATION, MB_ICONHAND, MB_ICONQUESTION, MB_OK, MESSAGEBOX_STYLE,
};

use crate::arbiter::{PlayMode, PlayRequest, PlaybackArbiter, PlayOutcome, SoundChannel};
use crate::options::{not_found_error, file_unreadable_error, BeepKind, SystemSoundResolution};
use crate::state::probe_readable;

/// The frozen alias flag triple (design section 1.2 / task 3.2).
pub(crate) const ALIAS_FLAGS: u32 = SND_ALIAS | SND_ASYNC | SND_NODEFAULT;
/// The file playback flags (design section 1.3).
pub(crate) const FILE_FLAGS: u32 = SND_FILENAME | SND_ASYNC;

static ARBITER: OnceLock<PlaybackArbiter> = OnceLock::new();
static NEXT_INSTANCE_KEY: AtomicU64 = AtomicU64::new(1);

/// The process-wide arbiter with the real winmm channel.
pub(crate) fn arbiter() -> &'static PlaybackArbiter {
    ARBITER.get_or_init(|| PlaybackArbiter::new(Arc::new(WinmmChannel)))
}

pub(crate) fn next_instance_key() -> u64 {
    NEXT_INSTANCE_KEY.fetch_add(1, Ordering::Relaxed)
}

/// The production native channel: static winmm imports. `hmod` is only
/// meaningful with `SND_RESOURCE`; null on both live paths.
struct WinmmChannel;

impl SoundChannel for WinmmChannel {
    fn play(&self, request: &PlayRequest) -> bool {
        let flags = match request.mode {
            PlayMode::Alias => ALIAS_FLAGS,
            PlayMode::File => FILE_FLAGS,
        };
        let wide = wide_null_terminated(&request.sound);
        // SAFETY: `wide` is a valid null-terminated wide string for the
        // duration of the call; winmm copies what it needs before
        // returning (SND_ASYNC).
        unsafe { PlaySoundW(wide.as_ptr(), null_hmodule(), flags) != 0 }
    }

    fn purge(&self) {
        // SAFETY: the documented stop form: a null sound with SND_PURGE
        // stops every sound started by this task on the single channel.
        unsafe { PlaySoundW(std::ptr::null(), null_hmodule(), SND_PURGE) };
    }
}

fn null_hmodule() -> HMODULE {
    std::ptr::null_mut()
}

fn wide_null_terminated(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// `beep` (design section 1.1): the five-level MessageBeep projection.
/// Returns the native acceptance (false is surfaced by the caller as the
/// typed not-found rejection with the beep trace — the resolve-on-
/// acceptance law has no silent path).
pub(crate) fn beep(kind: BeepKind) -> bool {
    let style: MESSAGEBOX_STYLE = match kind {
        BeepKind::Default => MB_OK,
        BeepKind::Info => MB_ICONASTERISK,
        BeepKind::Warning => MB_ICONEXCLAMATION,
        BeepKind::Error => MB_ICONHAND,
        BeepKind::Question => MB_ICONQUESTION,
    };
    // SAFETY: MessageBeep takes a plain enum value and returns a BOOL;
    // no handles, no buffers.
    unsafe { MessageBeep(style) != 0 }
}

/// The beep trace fragment for typed error details.
pub(crate) fn beep_trace(kind: BeepKind) -> Vec<String> {
    let label = match kind {
        BeepKind::Default => "MB_OK",
        BeepKind::Info => "MB_ICONASTERISK",
        BeepKind::Warning => "MB_ICONEXCLAMATION",
        BeepKind::Error => "MB_ICONHAND",
        BeepKind::Question => "MB_ICONQUESTION",
    };
    vec![format!("messagebeep:{label}")]
}

/// Resolution trace for `playSystemSound` miss details: the common-table
/// projection stage (when it applied), the registry sound-scheme catalog
/// check, and the winmm alias attempt.
fn resolution_trace(resolution: &SystemSoundResolution) -> Vec<String> {
    match resolution {
        SystemSoundResolution::Common { requested, projected } => vec![
            format!("common-table:{requested}->{projected}"),
            format!("registry-scheme:{projected}"),
            format!("winmm-alias:{projected}"),
            "flags:ALIAS|ASYNC|NODEFAULT".to_string(),
        ],
        SystemSoundResolution::Native { name } => vec![
            format!("registry-scheme:{name}"),
            format!("winmm-alias:{name}"),
            "flags:ALIAS|ASYNC|NODEFAULT".to_string(),
        ],
    }
}

/// The registry sound-scheme catalog oracle (design section 1.2 stage 2).
///
/// Real-machine evidence (2026-09-17, task 6.1): winmm `PlaySoundW` with
/// `SND_ALIAS | SND_ASYNC | SND_NODEFAULT` returns nonzero even for an
/// alias that does not exist — NODEFAULT suppresses the default sound but
/// the BOOL still reports success, so the native return alone is NOT a
/// miss oracle for aliases. `PlaySound` resolves aliases against
/// `HKCU\AppEvents\Schemes\Apps\.Default\<name>`; a missing key is the
/// authoritative catalog miss and rejects with ZERO native call (the
/// design's spy-law: the rejection path never touches PlaySound).
fn registry_scheme_alias_exists(alias: &str) -> bool {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
    };
    let subkey = format!("AppEvents\\Schemes\\Apps\\.Default\\{alias}");
    let wide = wide_null_terminated(&subkey);
    let mut hkey: HKEY = std::ptr::null_mut();
    // SAFETY: `wide` is null-terminated for the duration of the call and
    // `hkey` is a valid out-pointer; the handle is closed on success.
    let status = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, wide.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey)
    };
    if status == 0 {
        // SAFETY: `hkey` was just opened successfully.
        unsafe { RegCloseKey(hkey) };
        true
    } else {
        false
    }
}

/// `playSystemSound` (design sections 1.2/1.4): alias playback through
/// the arbiter; native false is the typed miss — NODEFAULT guarantees it
/// means "the requested name was not accepted".
pub(crate) fn play_system_sound(
    instance_key: u64,
    session_id: &str,
    instance_generation: u64,
    resolution: &SystemSoundResolution,
) -> Result<(), TypedExtensionError> {
    let alias = resolution.native_name().to_string();
    // Catalog pre-check: the registry sound-scheme is the authoritative
    // alias oracle (see `registry_scheme_alias_exists`); a missing key is
    // the typed miss with zero native call — the winmm BOOL is not a
    // reliable miss oracle for aliases.
    if !registry_scheme_alias_exists(&alias) {
        let attempted = resolution_trace(resolution);
        eprintln!(
            "opentray-ext-sound playSystemSound miss (registry scheme absent, \
             zero native call): requested={} alias={alias} attempted={attempted:?}",
            resolution.requested()
        );
        return Err(not_found_error(resolution.requested(), "win32", attempted));
    }
    let request = PlayRequest {
        mode: PlayMode::Alias,
        sound: alias.clone(),
    };
    match arbiter().play(instance_key, session_id, instance_generation, &request) {
        PlayOutcome::Accepted { .. } => Ok(()),
        PlayOutcome::NativeRejected { .. } => {
            let attempted = resolution_trace(resolution);
            eprintln!(
                "opentray-ext-sound playSystemSound miss (NODEFAULT, no fallback): \
                 requested={} alias={alias} attempted={attempted:?}",
                resolution.requested()
            );
            Err(not_found_error(resolution.requested(), "win32", attempted))
        }
    }
}

/// `playSound` (design sections 1.3/1.4): file playback through the
/// arbiter; the fs probe gives the honest unreadable message, the native
/// BOOL false is the remaining oracle.
pub(crate) fn play_file(
    instance_key: u64,
    session_id: &str,
    instance_generation: u64,
    path: &Path,
) -> Result<(), TypedExtensionError> {
    let display = path.display().to_string();
    if let Err(note) = probe_readable(path) {
        eprintln!("opentray-ext-sound playSound unreadable: {display} ({note})");
        return Err(file_unreadable_error(
            &display,
            "win32",
            vec![format!("fs-metadata:{note}")],
        ));
    }
    let request = PlayRequest {
        mode: PlayMode::File,
        sound: display.clone(),
    };
    match arbiter().play(instance_key, session_id, instance_generation, &request) {
        PlayOutcome::Accepted { .. } => Ok(()),
        PlayOutcome::NativeRejected { .. } => {
            eprintln!(
                "opentray-ext-sound playSound native false: {display} \
                 (winmm could not read the file)"
            );
            Err(file_unreadable_error(
                &display,
                "win32",
                vec![format!("winmm-filename:{display}")],
            ))
        }
    }
}

/// Session close: the arbiter's full-token gate.
pub(crate) fn close_session(instance_key: u64, session_id: &str) {
    arbiter().close_session(instance_key, session_id);
}

/// Deinit teardown: unregister this instance from the arbiter (purging
/// only when this instance owns the channel).
pub(crate) fn unregister_instance(instance_key: u64) {
    arbiter().unregister_instance(instance_key);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frozen flag triples: byte-exact winmm flag values.
    #[test]
    fn playback_flags_are_frozen() {
        assert_eq!(SND_ALIAS, 0x1_0000);
        assert_eq!(SND_ASYNC, 0x1);
        assert_eq!(SND_NODEFAULT, 0x2);
        assert_eq!(SND_FILENAME, 0x2_0000);
        assert_eq!(SND_PURGE, 0x40);
        assert_eq!(ALIAS_FLAGS, SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
        assert_eq!(FILE_FLAGS, SND_FILENAME | SND_ASYNC);
        // NODEFAULT is present in every alias playback: no silent
        // default-sound fallback can ever be composed from the triple.
        assert_ne!(ALIAS_FLAGS & SND_NODEFAULT, 0);
    }

    #[test]
    fn wide_strings_are_null_terminated() {
        assert_eq!(wide_null_terminated("SystemHand"), {
            let mut v: Vec<u16> = "SystemHand".encode_utf16().collect();
            v.push(0);
            v
        });
        assert_eq!(wide_null_terminated(""), vec![0]);
    }

    /// The resolution trace mirrors the darwin shape with the win32
    /// stages.
    #[test]
    fn resolution_trace_names_every_attempted_stage() {
        assert_eq!(
            resolution_trace(&SystemSoundResolution::Common {
                requested: "notification".to_string(),
                projected: "SystemAsterisk",
            }),
            vec![
                "common-table:notification->SystemAsterisk",
                "registry-scheme:SystemAsterisk",
                "winmm-alias:SystemAsterisk",
                "flags:ALIAS|ASYNC|NODEFAULT",
            ]
        );
        assert_eq!(
            resolution_trace(&SystemSoundResolution::Native {
                name: "SystemHand".to_string()
            }),
            vec![
                "registry-scheme:SystemHand",
                "winmm-alias:SystemHand",
                "flags:ALIAS|ASYNC|NODEFAULT",
            ]
        );
    }
}
