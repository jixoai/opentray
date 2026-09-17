//! macOS sound surface (add-ext-sound task 3.1).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: OS
//! standard sound feedback atoms without a completion event, and session
//! close stopping exactly the session's own playback):
//! 1. `beep` projects every `BeepKind` to `NSBeep()` — the documented
//!    degradation (design section 1.1 table); accepted by definition.
//! 2. `playSystemSound` resolves through `NSSound(named:)`; accepted =
//!    catalog hit AND `play()` acceptance (design section 1.2). A miss or
//!    a play rejection is the typed `sound_not_found` with the full
//!    resolution trace — never a silent fallback.
//! 3. `playSound` plays `NSSound(contentsOfFile:)`; the instance is
//!    retained in a SESSION-OWNED set until playback completes
//!    (design section 1.3): the `sound:didFinishPlaying:` delegate
//!    recycles it primarily, a bounded self-terminating fallback probe
//!    (1s hops on the main queue, alive only while any file sound is
//!    live) recycles instances whose delegate never fired. Dropping or
//!    stopping an `NSSound` stops its audio, so `isPlaying() == false`
//!    is the safe recycle guard (no audible interruption).
//! 4. Session close stops and drops exactly its own session's set;
//!    deinit stops all sets of this instance (design section 1.4).
//!
//! Compromise: the fallback probe reaches live instances through a
//! main-thread registry of state handles because GCD closures must be
//! `Send` while `NSSound` and `Rc` state are not; the probe closure
//! captures nothing and discovers everything through the registry on the
//! main thread. Every AppKit call is a typed objc2-app-kit binding (no
//! raw `msg_send!` except the canonical declared-class `super init`).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::Path;
use std::rc::{Rc, Weak};
use std::time::Duration;

use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker};
use objc2_app_kit::{NSBeep, NSSound, NSSoundDelegate};
use objc2_foundation::NSString;

use opentray_spec::TypedExtensionError;

use crate::options::{
    file_unreadable_error, not_found_error, transport_code, typed_error, SystemSoundResolution,
};
use crate::state::probe_readable;

/// Fallback probe cadence (design section 1.3 "兜底定时探测"): bounded,
/// self-terminating 1-second hops on the main queue while any live sound
/// exists. This is NOT the retired 60Hz drain family: no events, no
/// native commands, and the chain dies when the last sound finishes.
const PROBE_INTERVAL: Duration = Duration::from_millis(1000);

thread_local! {
    /// Main-thread registry of live instance states: the fallback probe
    /// reaches every live session set without capturing non-Send state
    /// in the GCD closure. Registration happens lazily on the first
    /// darwin command (the owner thread), never at init (which may run
    /// elsewhere).
    static LIVE_STATES: RefCell<Vec<Rc<RefCell<DarwinSoundState>>>> = const { RefCell::new(Vec::new()) };

    /// True while one probe hop is scheduled.
    static PROBE_ARMED: Cell<bool> = const { Cell::new(false) };
}

/// Per-instance darwin state: the session-owned live sound sets plus the
/// shared finish delegate. Main-thread only once registered.
pub(crate) struct DarwinSoundState {
    sessions: HashMap<String, Vec<Retained<NSSound>>>,
    /// One shared finish delegate for every sound this instance plays
    /// (sounds hold it weakly; the state keeps it alive).
    delegate: Option<Retained<SoundFinishDelegate>>,
}

impl DarwinSoundState {
    pub(crate) fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            delegate: None,
        }
    }
}

impl Default for DarwinSoundState {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct SoundFinishDelegateIvars {
    state: Weak<RefCell<DarwinSoundState>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[ivars = SoundFinishDelegateIvars]
    pub(crate) struct SoundFinishDelegate;

    unsafe impl NSObjectProtocol for SoundFinishDelegate {}

    unsafe impl NSSoundDelegate for SoundFinishDelegate {
        /// The primary recycle path (design section 1.3): the sound
        /// finished naturally, so it leaves its session set now.
        #[unsafe(method(sound:didFinishPlaying:))]
        fn sound_did_finish_playing(&self, sound: &NSSound, _flag: bool) {
            if let Some(state) = self.ivars().state.upgrade() {
                remove_sound(&state, sound);
            }
        }
    }
);

impl SoundFinishDelegate {
    fn new(state: Weak<RefCell<DarwinSoundState>>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm
            .alloc::<Self>()
            .set_ivars(SoundFinishDelegateIvars { state });
        // Canonical declared-class construction (the one msg_send in this
        // crate): NSObject's init after the ivars are placed.
        unsafe { msg_send![super(this), init] }
    }
}

/// Sound dispatch requires the broker's GUI owner (main) thread: AppKit
/// objects and the MainThreadOnly delegate protocol must not cross
/// threads. This is a host-contract violation category, not one of the
/// four frozen sound failure codes.
fn require_main_thread() -> Result<MainThreadMarker, TypedExtensionError> {
    MainThreadMarker::new().ok_or_else(|| {
        typed_error(
            transport_code::INVALID_DISPATCH_THREAD,
            "sound dispatch requires the broker main (owner-loop) thread",
        )
    })
}

/// `beep` (design section 1.1): every kind degrades to `NSBeep()` —
/// darwin has no graded alert tone family; the void return accepts by
/// definition once the dispatch thread contract holds.
pub(crate) fn beep() -> Result<(), TypedExtensionError> {
    require_main_thread()?;
    NSBeep();
    Ok(())
}

/// Resolution trace for typed `sound_not_found` details: every stage the
/// lookup actually attempted, in order.
fn resolution_trace(resolution: &SystemSoundResolution) -> Vec<String> {
    match resolution {
        SystemSoundResolution::Common { requested, projected } => vec![
            format!("common-table:{requested}->{projected}"),
            format!("nssound-named:{projected}"),
        ],
        SystemSoundResolution::Native { name } => vec![format!("nssound-named:{name}")],
    }
}

/// `playSystemSound` (design sections 1.2/1.4): catalog hit AND play
/// acceptance resolve the command; anything else is the typed miss with
/// the full trace. The accepted sound joins the session-owned set so the
/// instance outlives playback and session close can stop it.
pub(crate) fn play_system_sound(
    state: &Rc<RefCell<DarwinSoundState>>,
    session_id: &str,
    resolution: &SystemSoundResolution,
) -> Result<(), TypedExtensionError> {
    let mtm = require_main_thread()?;
    ensure_registered(state, mtm);

    let native_name = resolution.native_name();
    let requested = resolution.requested();
    let name = NSString::from_str(native_name);
    let Some(sound) = NSSound::soundNamed(&name) else {
        let attempted = resolution_trace(resolution);
        eprintln!(
            "opentray-ext-sound playSystemSound miss: requested={requested} \
             native={native_name} attempted={attempted:?}"
        );
        return Err(not_found_error(requested, "darwin", attempted));
    };
    attach_delegate(state, &sound);
    if !sound.play() {
        // `soundNamed` returns a SHARED cached instance (probe evidence
        // 2026-09-17: two lookups of the same name are `===`), and
        // `play()` on an instance that is already playing returns false
        // without stopping it. The requested system sound is audibly
        // underway — the accepted state — so this coalesce is an
        // acceptance, never a miss. A play rejection with the instance
        // NOT playing is the honest typed miss below.
        if sound.isPlaying() {
            insert_sound(state, session_id, sound);
            arm_fallback_probe();
            return Ok(());
        }
        let mut attempted = resolution_trace(resolution);
        attempted.push("nssound-play".to_string());
        eprintln!(
            "opentray-ext-sound playSystemSound play rejected: \
             requested={requested} native={native_name}"
        );
        return Err(not_found_error(requested, "darwin", attempted));
    }
    insert_sound(state, session_id, sound);
    arm_fallback_probe();
    Ok(())
}

/// `playSound` (design sections 1.3/1.4): `NSSound(contentsOfFile:)`.
/// An init miss or a play rejection is the typed `sound_file_unreadable`
/// (the file could not be read as a playable sound); the accepted sound
/// joins the session-owned set with delegate recycling and the fallback
/// probe.
pub(crate) fn play_file(
    state: &Rc<RefCell<DarwinSoundState>>,
    session_id: &str,
    path: &Path,
) -> Result<(), TypedExtensionError> {
    let mtm = require_main_thread()?;
    ensure_registered(state, mtm);

    let display = path.display().to_string();
    if let Err(note) = probe_readable(path) {
        eprintln!("opentray-ext-sound playSound unreadable: {display} ({note})");
        return Err(file_unreadable_error(
            &display,
            "darwin",
            vec![format!("fs-metadata:{note}")],
        ));
    }
    let path_string = NSString::from_str(&display);
    // NSSound is AnyThread with a safe designated initializer: allocate
    // and initialize on this thread, consuming the allocation inline.
    let allocated = NSSound::alloc();
    let Some(sound) =
        NSSound::initWithContentsOfFile_byReference(allocated, &path_string, false)
    else {
        eprintln!(
            "opentray-ext-sound playSound init rejected: {display} \
             (NSSound could not initialize from the file)"
        );
        return Err(file_unreadable_error(
            &display,
            "darwin",
            vec![format!("nssound-file:{display}")],
        ));
    };
    attach_delegate(state, &sound);
    if !sound.play() {
        eprintln!("opentray-ext-sound playSound play rejected: {display}");
        return Err(file_unreadable_error(
            &display,
            "darwin",
            vec![format!("nssound-file:{display}"), "nssound-play".to_string()],
        ));
    }
    insert_sound(state, session_id, sound);
    arm_fallback_probe();
    Ok(())
}

/// Session close (design section 1.4): stops and drops exactly this
/// session's set. `NSSound.stop()` is an AnyThread typed binding; the
/// broker delivers close on the owner thread.
pub(crate) fn close_session(state: &Rc<RefCell<DarwinSoundState>>, session_id: &str) {
    let Some(sounds) = state.borrow_mut().sessions.remove(session_id) else {
        return;
    };
    for sound in sounds {
        let _ = sound.stop();
    }
}

/// Deinit teardown: unregister from the probe registry and stop every
/// set this instance owns (design section 1.4 darwin mirror of the
/// arbiter's unregister).
pub(crate) fn instance_dropped(state: &Rc<RefCell<DarwinSoundState>>) {
    LIVE_STATES.with(|live| {
        live.borrow_mut()
            .retain(|candidate| !Rc::ptr_eq(candidate, state));
    });
    let mut borrowed = state.borrow_mut();
    for (_, sounds) in borrowed.sessions.drain() {
        for sound in sounds {
            let _ = sound.stop();
        }
    }
}

/// Removes one finished sound from every session set holding it (pointer
/// identity). `soundNamed` returns SHARED instances, so the same
/// `Retained<NSSound>` can sit in several session sets; the delegate
/// finishing it finishes it everywhere. Called on the main thread.
fn remove_sound(state: &Rc<RefCell<DarwinSoundState>>, finished: &NSSound) {
    let finished_ptr = finished as *const NSSound;
    let mut borrowed = state.borrow_mut();
    let mut empty_keys = Vec::new();
    for (session_id, sounds) in borrowed.sessions.iter_mut() {
        let before = sounds.len();
        sounds.retain(|sound| Retained::as_ptr(sound) != finished_ptr);
        if sounds.len() != before && sounds.is_empty() {
            empty_keys.push(session_id.clone());
        }
    }
    for key in empty_keys {
        borrowed.sessions.remove(&key);
    }
}

fn attach_delegate(state: &Rc<RefCell<DarwinSoundState>>, sound: &NSSound) {
    let delegate = state.borrow().delegate.clone();
    if let Some(delegate) = delegate {
        let protocol_object = ProtocolObject::from_ref(&*delegate);
        sound.setDelegate(Some(protocol_object));
    }
}

fn insert_sound(state: &Rc<RefCell<DarwinSoundState>>, session_id: &str, sound: Retained<NSSound>) {
    let mut borrowed = state.borrow_mut();
    borrowed
        .sessions
        .entry(session_id.to_string())
        .or_default()
        .push(sound);
}

/// Lazily completes main-thread registration: creates the shared
/// delegate (with a weak back-reference to this state) and adds the
/// state handle to the probe registry. Idempotent.
fn ensure_registered(state: &Rc<RefCell<DarwinSoundState>>, mtm: MainThreadMarker) {
    if state.borrow().delegate.is_none() {
        let delegate = SoundFinishDelegate::new(Rc::downgrade(state), mtm);
        state.borrow_mut().delegate = Some(delegate);
    }
    let registered =
        LIVE_STATES.with(|live| live.borrow().iter().any(|s| Rc::ptr_eq(s, state)));
    if !registered {
        LIVE_STATES.with(|live| live.borrow_mut().push(state.clone()));
    }
}

// ---------------------------------------------------------------------------
// Fallback probe (design section 1.3): bounded self-terminating 1s hops
// on the main queue; alive only while any live sound exists.
// ---------------------------------------------------------------------------

fn arm_fallback_probe() {
    if PROBE_ARMED.with(Cell::get) {
        return;
    }
    PROBE_ARMED.with(|armed| armed.set(true));
    schedule_probe();
}

fn schedule_probe() {
    let when = DispatchTime::try_from(PROBE_INTERVAL).expect("1s fits dispatch time");
    if let Err(error) = DispatchQueue::main().after(when, probe_step) {
        // Without the chain the delegate stays the only recycler; sounds
        // still release at session close/deinit — degrade loudly.
        PROBE_ARMED.with(|armed| armed.set(false));
        eprintln!(
            "opentray-ext-sound fallback probe could not be scheduled: {error:?}"
        );
    }
}

/// One probe hop: recycles every finished sound (isPlaying == false is
/// the no-audible-interruption guard), then re-arms only while live
/// sounds remain. Runs on the main thread (main queue); captures
/// nothing.
fn probe_step() {
    let mut live = 0usize;
    LIVE_STATES.with(|states| {
        for state in states.borrow().iter() {
            live += recycle_finished_sounds(state);
        }
    });
    if live > 0 {
        schedule_probe();
    } else {
        PROBE_ARMED.with(|armed| armed.set(false));
    }
}

/// Recycles one state's finished sounds; returns its live count.
fn recycle_finished_sounds(state: &Rc<RefCell<DarwinSoundState>>) -> usize {
    let mut borrowed = state.borrow_mut();
    let mut empty_keys = Vec::new();
    let mut live = 0usize;
    for (session_id, sounds) in borrowed.sessions.iter_mut() {
        let before = sounds.len();
        sounds.retain(|sound| sound.isPlaying());
        live += sounds.len();
        if sounds.len() != before && sounds.is_empty() {
            empty_keys.push(session_id.clone());
        }
    }
    for key in empty_keys {
        borrowed.sessions.remove(&key);
    }
    live
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pure resolution trace builder follows the frozen stages.
    #[test]
    fn resolution_trace_names_every_attempted_stage() {
        assert_eq!(
            resolution_trace(&SystemSoundResolution::Common {
                requested: "notification".to_string(),
                projected: "Glass",
            }),
            vec!["common-table:notification->Glass", "nssound-named:Glass"]
        );
        assert_eq!(
            resolution_trace(&SystemSoundResolution::Native {
                name: "Funk".to_string()
            }),
            vec!["nssound-named:Funk"]
        );
    }
}
