//! Per-mount sound instance state (add-ext-sound design section 1.4).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests:
//! session close stops exactly the playback that session owns, on both
//! platforms, without a completion event):
//! 1. win32: the process-wide PlaybackArbiter owns the token ledger; the
//!    instance holds only its stable arbiter key (allocated at init,
//!    unregistered at deinit).
//! 2. darwin: the instance owns the session-keyed live `NSSound` sets —
//!    close stops only its own session's set — shared through
//!    `Rc<RefCell>` with the didFinishPlaying delegate and the fallback
//!    probe, which recycle finished instances on the main thread.
//! 3. Neither bookkeeping surface is Node-facing: the token and the sets
//!    are internal ownership mechanisms that never change the
//!    fire-and-forget semantics.
//!
//! Compromise: the win32 key map and the darwin sound sets live in the
//! same per-instance struct because both are mutated only from the
//! broker's owner thread (commands, session close, deinit); the darwin
//! delegate/probe reach the same state single-threaded on the main
//! thread, so no locking is added inside the instance.

use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
use std::rc::Rc;

#[cfg(target_os = "macos")]
use crate::macos;
#[cfg(target_os = "windows")]
use crate::windows;

/// Per-mount instance created by `opentray_ext_init`.
pub(crate) struct SoundInstance {
    /// Stable identity inside the process-wide PlaybackArbiter.
    #[cfg(target_os = "windows")]
    pub(crate) arbiter_key: u64,
    /// Session-owned live sound sets (main-thread only).
    #[cfg(target_os = "macos")]
    pub(crate) darwin: Rc<std::cell::RefCell<macos::DarwinSoundState>>,
}

impl SoundInstance {
    pub(crate) fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            arbiter_key: windows::next_instance_key(),
            #[cfg(target_os = "macos")]
            darwin: Rc::new(std::cell::RefCell::new(macos::DarwinSoundState::new())),
        }
    }
}

impl Default for SoundInstance {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SoundInstance {
    fn drop(&mut self) {
        // Deinit teardown: stop this instance's own sounds. The arbiter
        // purges only when this instance owns the channel; the darwin
        // state stops and drops exactly its own session sets.
        #[cfg(target_os = "windows")]
        windows::unregister_instance(self.arbiter_key);
        #[cfg(target_os = "macos")]
        macos::instance_dropped(&self.darwin);
    }
}

// ---------------------------------------------------------------------------
// Native-side path resolution (design section 1.3): `~` expansion then
// lexical absolutization against the process cwd. The facade owns the
// caller-cwd canonicalization and the win32 RIFF content preflight; this
// is the defense-in-depth native re-check so a relative or home-relative
// path can never silently resolve against an unrelated native base.
// ---------------------------------------------------------------------------

/// Resolves the home directory without a platform crate: `USERPROFILE` on
/// Windows, `HOME` elsewhere.
fn home_dir_path() -> Option<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key).map(PathBuf::from)
}

/// Pure `~` expansion core (`~` alone and `~`-prefixed segments).
fn expand_home_with(raw: &str, home: Option<&Path>) -> PathBuf {
    let Some(home) = home else {
        // No home resolvable: keep the literal path; the native oracle
        // (NSSound init / winmm false) produces the typed rejection.
        return PathBuf::from(raw);
    };
    if raw == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    PathBuf::from(raw)
}

/// Pure resolution core: `~` expansion, then lexical absolutization
/// against the given cwd (absolute paths pass through unchanged). An
/// unresolvable `~` reference stays literal — it is never silently
/// resolved against the cwd; the native oracle produces the typed
/// rejection.
fn resolve_audio_path_with(raw: &str, home: Option<&Path>, cwd: &Path) -> PathBuf {
    if raw.starts_with('~') && home.is_none() {
        return PathBuf::from(raw);
    }
    let expanded = expand_home_with(raw, home);
    if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    }
}

/// Native-side path resolution with the process home and cwd.
pub(crate) fn resolve_audio_path(raw: &str) -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_default();
    resolve_audio_path_with(raw, home_dir_path().as_deref(), &cwd)
}

/// Filesystem-level readability probe (defense in depth; the content
/// format check — including the win32 RIFF rules — is facade-owned
/// preflight and deliberately NOT repeated here). Err carries the
/// diagnostic note used inside the typed error's `attempted` trace.
pub(crate) fn probe_readable(path: &Path) -> Result<(), String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(format!("{} is not a regular file", path.display())),
        Err(error) => Err(format!("metadata failed: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/homes/tester")
    }

    fn cwd() -> PathBuf {
        PathBuf::from("/work/project")
    }

    fn resolve(raw: &str) -> PathBuf {
        resolve_audio_path_with(raw, Some(home()).as_deref(), &cwd())
    }

    #[test]
    fn home_expansion_covers_tilde_and_tilde_prefix() {
        assert_eq!(resolve("~"), home());
        assert_eq!(resolve("~/Music/ding.wav"), home().join("Music/ding.wav"));
        // A tilde inside the path is NOT a home reference.
        assert_eq!(
            resolve("/tmp/a~b.wav"),
            PathBuf::from("/tmp/a~b.wav")
        );
        assert_eq!(resolve("late~night.wav"), cwd().join("late~night.wav"));
    }

    #[test]
    fn relative_paths_join_the_process_cwd_and_absolutes_pass_through() {
        assert_eq!(resolve("ding.wav"), cwd().join("ding.wav"));
        assert_eq!(resolve("./sub/ding.wav"), cwd().join("./sub/ding.wav"));
        assert_eq!(
            resolve("/abs/path/ding.wav"),
            PathBuf::from("/abs/path/ding.wav")
        );
    }

    #[test]
    fn missing_home_keeps_the_literal_path_for_the_native_oracle() {
        assert_eq!(
            resolve_audio_path_with("~/x.wav", None, &cwd()),
            PathBuf::from("~/x.wav")
        );
    }

    #[test]
    fn readability_probe_reports_missing_and_non_file_paths() {
        let missing = PathBuf::from("/definitely/not/here/51317.wav");
        assert!(probe_readable(&missing).is_err());

        let directory = std::env::temp_dir();
        let error = probe_readable(&directory).unwrap_err();
        assert!(error.contains("not a regular file"), "{error}");

        let file = temp_file();
        std::fs::write(&file, b"RIFF----").expect("write probe file");
        assert_eq!(probe_readable(&file), Ok(()));
        let _ = std::fs::remove_file(&file);
    }

    fn temp_file() -> PathBuf {
        let unique = std::process::id() as u128
            * 1_000_003
            + std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as u128)
                .unwrap_or(0);
        std::env::temp_dir().join(format!("opentray-ext-sound-{unique}.wav"))
    }
}
