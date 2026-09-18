//! macOS opener surface (add-ext-opener task 3.1).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: open
//! a URL / absolute file path with the default application, or reveal it in
//! Finder — as a host-side atom with resolve-on-acceptance semantics):
//! 1. `open_url` projects `NSWorkspace.open(url)`; the boolean return IS
//!    the acceptance oracle (darwin osError semantics, design section 3)
//!    — `false` rejects typed `opener_failed` with `{osError: true}`.
//! 2. `open_path` projects `NSWorkspace.open(URL(fileURLWithPath:))` from
//!    the raw string — no normalization, no existence probe (existence is
//!    not an acceptance precondition; a native rejection is the typed
//!    failure).
//! 3. `reveal` applies the frozen reveal law (rejection set, root
//!    boundary, trim — `resolve::prepare_reveal` with `posix = true`) and
//!    projects `NSWorkspace.activateFileViewerSelectingURLs([url])`. The
//!    binding returns void — accepted by definition; there is no
//!    parameter injection surface on this path.
//! 4. Every dispatch is owner-thread-bound (design section 4: NSWorkspace
//!    runs on the broker's GUI owner thread); an off-thread dispatch is
//!    the honest typed host-contract rejection before any native call.
//!
//! Compromise: NSURL construction happens on the dispatch thread (NSURL
//! is Send and not MainThreadOnly); only the NSWorkspace calls sit behind
//! the owner-thread gate.

use objc2::MainThreadMarker;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSArray, NSString, NSURL};

use opentray_spec::TypedExtensionError;

use crate::options::{os_error_failed_error, transport_code, typed_error};
use crate::resolve::{prepare_reveal, RevealPlan};

/// Opener dispatch requires the broker's GUI owner (main) thread: the
/// NSWorkspace surface stays on the owner loop (design section 4). This is
/// a host-contract violation category, not one of the four frozen opener
/// failure codes.
fn require_main_thread() -> Result<(), TypedExtensionError> {
    MainThreadMarker::new().ok_or_else(|| {
        typed_error(
            transport_code::INVALID_DISPATCH_THREAD,
            "opener dispatch requires the broker main (owner-loop) thread",
        )
    })?;
    Ok(())
}

/// `open` — URL form (design section 2.2): `NSWorkspace.open(url)`; the
/// boolean return is the acceptance oracle. A URL that `NSURL` cannot
/// construct (facade-side `new URL()` already parsed it) is the native
/// rejection with the darwin osError shape.
pub(crate) fn open_url(target: &str) -> Result<(), TypedExtensionError> {
    require_main_thread()?;
    let string = NSString::from_str(target);
    let Some(url) = NSURL::URLWithString(&string) else {
        return Err(os_error_failed_error(target));
    };
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err(os_error_failed_error(target))
    }
}

/// `open` — absolute path form (design section 2.1):
/// `NSWorkspace.open(URL(fileURLWithPath:))` from the raw string, no
/// normalization and no existence probe.
pub(crate) fn open_path(path: &str) -> Result<(), TypedExtensionError> {
    require_main_thread()?;
    let string = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&string);
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err(os_error_failed_error(path))
    }
}

/// `revealInFolder` (design section 2, frozen law):
/// `NSWorkspace.activateFileViewerSelectingURLs([url])`. The frozen
/// rejection set and the root boundary/trim law are applied by
/// `prepare_reveal` first (defense in depth — the facade owns the same
/// preflight); roots reveal through Finder's native root semantics.
pub(crate) fn reveal(raw: &str) -> Result<(), TypedExtensionError> {
    let plan = prepare_reveal(raw, true)?;
    require_main_thread()?;
    let path = match &plan {
        RevealPlan::Select { path } => path.as_str(),
        RevealPlan::OpenRoot { root } => root.as_str(),
    };
    let string = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&string);
    let urls = NSArray::from_retained_slice(&[url]);
    NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&urls);
    Ok(())
}
