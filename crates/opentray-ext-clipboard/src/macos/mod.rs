//! macOS clipboard surface (add-ext-clipboard task 3.1).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: OS
//! clipboard text atoms with an owner-thread NSPasteboard projection whose
//! three paths are unit-testable without touching the real board):
//! 1. write = `clearContents()` + `setString(forType: .string)` — TWO
//!    operations; an empty-string write still delivers bytes through
//!    setString and is never coerced into the clear path (design section 1
//!    frozen distinction).
//! 2. read = `string(forType: .string)` with nil -> null (no ambiguous
//!    path; null is the first-class empty state).
//! 3. clear = `clearContents()` alone.
//!
//! Compromise: NSPasteboard is not MainThreadOnly-typed in objc2-app-kit
//! 0.3, but the owner-thread family law (design section 4) still gates
//! every dispatch through `require_main_thread` before the board is
//! touched; the pasteboard surface is seam-ized (`PasteboardSurface`) so
//! the three flows run in unit tests against a spy board.

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::NSString;

use opentray_spec::TypedExtensionError;

use crate::options;

/// Pasteboard surface seam: the three frozen operations (write composes
/// clearContents + setString; the flows below are the frozen projections).
pub(crate) trait PasteboardSurface {
    fn clear_contents(&mut self) -> Result<(), TypedExtensionError>;
    fn set_string(&mut self, text: &str) -> Result<(), TypedExtensionError>;
    fn string(&mut self) -> Result<Option<String>, TypedExtensionError>;
}

/// Write flow (design sections 1/2): clearContents + setString. The
/// empty-string write still calls set_string with "" — ownership-semantics
/// difference from clear, never merged.
pub(crate) fn flow_write_text(
    surface: &mut dyn PasteboardSurface,
    text: &str,
) -> Result<(), TypedExtensionError> {
    surface.clear_contents()?;
    surface.set_string(text)
}

/// Read flow (design section 2): nil -> None (null), never an error.
pub(crate) fn flow_read_text(
    surface: &mut dyn PasteboardSurface,
) -> Result<Option<String>, TypedExtensionError> {
    surface.string()
}

/// Clear flow (design section 2): clearContents alone — distinct from the
/// empty-string write.
pub(crate) fn flow_clear(surface: &mut dyn PasteboardSurface) -> Result<(), TypedExtensionError> {
    surface.clear_contents()
}

/// Clipboard dispatch requires the broker's GUI owner (main) thread — the
/// MainThreadOnly family discipline (design section 4). This is a
/// host-contract violation category, not one of the five frozen clipboard
/// failure codes.
fn require_main_thread() -> Result<MainThreadMarker, TypedExtensionError> {
    MainThreadMarker::new().ok_or_else(|| {
        options::typed_error(
            options::transport_code::INVALID_DISPATCH_THREAD,
            "clipboard dispatch requires the broker main (owner-loop) thread",
        )
    })
}

/// The real general pasteboard. `NSPasteboard::generalPasteboard()` itself
/// is not MainThreadOnly-typed in objc2-app-kit 0.3, so the owner-thread
/// gate lives in the command entries below (the design's family law).
struct GeneralPasteboard(Retained<NSPasteboard>);

impl PasteboardSurface for GeneralPasteboard {
    fn clear_contents(&mut self) -> Result<(), TypedExtensionError> {
        // clearContents returns the new change count and does not fail in
        // any documented way; the call is the whole clear projection.
        self.0.clearContents();
        Ok(())
    }

    fn set_string(&mut self, text: &str) -> Result<(), TypedExtensionError> {
        let value = NSString::from_str(text);
        // SAFETY: NSPasteboardTypeString is an immutable AppKit global.
        if self
            .0
            .setString_forType(&value, unsafe { NSPasteboardTypeString })
        {
            Ok(())
        } else {
            // darwin surfaces no OS error code on a bool miss: 0 keeps the
            // frozen details shape honest (design section 3).
            Err(options::unavailable_error(
                0,
                "NSPasteboard setString:forType: returned false",
            ))
        }
    }

    fn string(&mut self) -> Result<Option<String>, TypedExtensionError> {
        // SAFETY: NSPasteboardTypeString is an immutable AppKit global.
        let value = self.0.stringForType(unsafe { NSPasteboardTypeString });
        Ok(value.map(|text| text.to_string()))
    }
}

/// `writeText` (design sections 1/2): owner thread + native UTF-16 gate
/// (defense in depth) + the frozen write flow.
pub(crate) fn write_text(text: &str) -> Result<(), TypedExtensionError> {
    let _owner_thread = require_main_thread()?;
    options::validate_write_text(text)?;
    let mut board = GeneralPasteboard(NSPasteboard::generalPasteboard());
    flow_write_text(&mut board, text)
}

/// `readText` (design section 2): owner thread + the frozen read flow.
pub(crate) fn read_text() -> Result<Option<String>, TypedExtensionError> {
    let _owner_thread = require_main_thread()?;
    let mut board = GeneralPasteboard(NSPasteboard::generalPasteboard());
    flow_read_text(&mut board)
}

/// `clear` (design section 2): owner thread + the frozen clear flow.
pub(crate) fn clear() -> Result<(), TypedExtensionError> {
    let _owner_thread = require_main_thread()?;
    let mut board = GeneralPasteboard(NSPasteboard::generalPasteboard());
    flow_clear(&mut board)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spy board recording the projection calls (task 3.1 evidence: the
    /// seam covers the write/read/clear three paths without touching the
    /// real system clipboard).
    struct SpyBoard {
        trace: Vec<String>,
        set_string_fails: bool,
        string_value: Option<String>,
    }

    impl SpyBoard {
        fn new() -> Self {
            Self {
                trace: Vec::new(),
                set_string_fails: false,
                string_value: None,
            }
        }
    }

    impl PasteboardSurface for SpyBoard {
        fn clear_contents(&mut self) -> Result<(), TypedExtensionError> {
            self.trace.push("clearContents".to_string());
            Ok(())
        }

        fn set_string(&mut self, text: &str) -> Result<(), TypedExtensionError> {
            self.trace.push(format!("setString({text:?})"));
            if self.set_string_fails {
                return Err(options::unavailable_error(
                    0,
                    "NSPasteboard setString:forType: returned false",
                ));
            }
            Ok(())
        }

        fn string(&mut self) -> Result<Option<String>, TypedExtensionError> {
            self.trace.push("string".to_string());
            Ok(self.string_value.clone())
        }
    }

    #[test]
    fn write_composes_clear_contents_then_set_string() {
        let mut board = SpyBoard::new();
        assert_eq!(flow_write_text(&mut board, "hello"), Ok(()));
        assert_eq!(board.trace, vec!["clearContents", "setString(\"hello\")"]);
    }

    /// The frozen distinctness law (design section 1): writeText("") is the
    /// set-string projection, NOT clearContents alone.
    #[test]
    fn empty_string_write_is_set_string_not_clear() {
        let mut board = SpyBoard::new();
        assert_eq!(flow_write_text(&mut board, ""), Ok(()));
        assert_eq!(board.trace, vec!["clearContents", "setString(\"\")"]);

        let mut clear_only = SpyBoard::new();
        assert_eq!(flow_clear(&mut clear_only), Ok(()));
        assert_eq!(clear_only.trace, vec!["clearContents"]);
    }

    #[test]
    fn read_returns_none_for_nil_and_the_string_value() {
        let mut board = SpyBoard::new();
        assert_eq!(flow_read_text(&mut board), Ok(None));
        assert_eq!(board.trace, vec!["string"]);

        let mut board = SpyBoard::new();
        board.string_value = Some("h\u{1F600}i".to_string());
        assert_eq!(
            flow_read_text(&mut board),
            Ok(Some("h\u{1F600}i".to_string()))
        );
    }

    #[test]
    fn set_string_failure_is_the_typed_unavailable_rejection() {
        let mut board = SpyBoard::new();
        board.set_string_fails = true;
        let error = flow_write_text(&mut board, "hello").unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 0 })
        );
        // clearContents ran first: the write projection reached the set
        // step before failing.
        assert_eq!(board.trace, vec!["clearContents", "setString(\"hello\")"]);
    }
}
