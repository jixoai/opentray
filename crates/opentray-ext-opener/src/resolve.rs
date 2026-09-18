//! The frozen opener resolution core (add-ext-opener design section 2).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: open
//! a URL / absolute file path with the user's default application, or
//! reveal it in the file manager — as a host-side atom):
//! 1. `classify_target` is the frozen open() preflight matrix: POSIX `/`
//!    paths, win32 drive paths (`C:\x` absolute, `C:x` drive-relative
//!    rejected), UNC (`\\server\share\…`) and `\\?\` literal forms
//!    (passed through with NO normalization — normalization is the
//!    caller's responsibility), and URL targets whose scheme must pass
//!    the frozen allowlist (http/https/file/mailto, case-insensitive).
//!    `file:` URLs stay URLs — never normalized to paths.
//! 2. `prepare_reveal` is the frozen revealInFolder law: absolute-only,
//!    the frozen rejection set (a quote or any C0 control character
//!    rejects — reject-not-escape, because an escaping matrix is a
//!    persistent attack surface), and the trailing-separator trim law
//!    with the root boundary (trim exactly one separator only when the
//!    trimmed result is still a legal absolute path; roots `C:\`, `/`,
//!    `\\server\share\`, and `\\?\`-literal roots are never trimmed and
//!    carry open-the-root semantics).
//! 3. The win32 argument construction seams (`build_select_parameters`,
//!    `build_open_root_parameters`, `shell_execute_reason`) are pure and
//!    host-runnable so the parameter-construction spy tests and the SE
//!    result mapping table test run on every host (CI matrix law); only
//!    the `ShellExecuteW` FFI itself lives in `windows/mod.rs`.
//!
//! Compromise: the URL branch scans the scheme lexically (WHATWG scheme
//! grammar) after trimming the C0/space margins, mirroring the facade's
//! `new URL()` parse (which the WHATWG algorithm performs before
//! classification); the dispatched target is always the ORIGINAL string —
//! trimming is classification-only, never a rewrite. The facade owns the
//! same matrix pre-transport; this module is the defense-in-depth native
//! re-check so a malformed frame can never reach a native open call.

use opentray_spec::TypedExtensionError;

use crate::options::{scheme_blocked_error, target_invalid_error, ALLOWED_SCHEMES};

/// The rejection-set reasons (frozen order: quote first, then any C0).
pub(crate) const REASON_RELATIVE: &str = "relative";
pub(crate) const REASON_DRIVE_RELATIVE: &str = "drive-relative";
pub(crate) const REASON_PATH_QUOTE: &str = "path-quote";
pub(crate) const REASON_PATH_CONTROL_CHAR: &str = "path-control-char";

/// The frozen open() classification (design section 2, edge matrix).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TargetKind {
    /// POSIX absolute path (starts with `/`).
    PosixPath,
    /// win32 absolute drive path (`[A-Za-z]:[\\/]…`).
    DrivePath,
    /// UNC (`\\server\share\…`) or `\\?\` literal absolute path — passed
    /// to native exactly as received, never normalized.
    UncPath,
    /// URL whose scheme scanned lexically; the scheme keeps its original
    /// case (matching is case-insensitive).
    Url { scheme: String },
    /// win32 drive-relative form (`C:x` — drive letter without separator).
    DriveRelative,
    /// Everything else: relative path or protocol-less string.
    Relative,
}

/// True for `[A-Za-z]` (scheme grammar first character and drive letters).
fn is_ascii_alpha(byte: u8) -> bool {
    byte.is_ascii_alphabetic()
}

/// True for the scheme continuation grammar `[A-Za-z0-9+.-]`.
// The lexical scheme scanner, its grammar helper, and the WHATWG margin
// trim were removed with the parser-driven classification (implementation
// review I2b): the url crate performs the identical pre-parse margin strip
// plus the tab/newline removal anywhere in the input, so a separate
// scanner could only diverge from the facade's `new URL()`.

/// The frozen open() classification matrix. Pure; no platform awareness
/// required (the facade platform always equals the native platform, and
/// the matrix itself is platform-neutral about which FORM is absolute).
/// URL detection is parser-driven (implementation review I2b): the full
/// WHATWG parse decides URL-ness exactly like the facade's `new URL()` —
/// including the pre-parse C0/space margin strip and the tab/newline
/// removal ANYWHERE in the input (`"ht\ntps://x"` is an https URL). A
/// lexical scheme scan is not equivalent and was removed.
pub(crate) fn classify_target(target: &str) -> TargetKind {
    let bytes = target.as_bytes();
    if bytes.is_empty() {
        return TargetKind::Relative;
    }
    if bytes[0] == b'/' {
        return TargetKind::PosixPath;
    }
    if bytes[0] == b'\\' && bytes.len() >= 2 && bytes[1] == b'\\' {
        return TargetKind::UncPath;
    }
    if bytes.len() >= 2 && bytes[1] == b':' && is_ascii_alpha(bytes[0]) {
        if bytes.len() >= 3 && (bytes[2] == b'\\' || bytes[2] == b'/') {
            return TargetKind::DrivePath;
        }
        // `C:x` / `C:` — drive letter without a separator. The frozen
        // matrix treats the single-letter-colon form as drive-relative
        // BEFORE any URL interpretation (the allowlist has no
        // single-letter schemes, so no legal target is lost).
        return TargetKind::DriveRelative;
    }
    if let Ok(parsed) = url::Url::parse(target) {
        // `parsed.scheme()` is the canonical lowercase form — the same
        // string the facade's `url.protocol` produces.
        return TargetKind::Url {
            scheme: parsed.scheme().to_string(),
        };
    }
    TargetKind::Relative
}

/// Applies the frozen scheme allowlist gate to a classified URL:
/// case-insensitive membership in http/https/file/mailto.
pub(crate) fn scheme_allowed(scheme: &str) -> bool {
    let lowercase = scheme.to_ascii_lowercase();
    ALLOWED_SCHEMES.contains(&lowercase.as_str())
}

/// Validates one open() target into a dispatchable native target, or the
/// typed rejection. The returned string is always the ORIGINAL target —
/// this function never rewrites (paths and `\\?\` forms pass literally;
/// URLs pass as-is).
pub(crate) fn validate_open_target(target: &str) -> Result<&str, TypedExtensionError> {
    match classify_target(target) {
        TargetKind::PosixPath
        | TargetKind::DrivePath
        | TargetKind::UncPath => Ok(target),
        // The classification's WHATWG parse already IS the validity gate
        // (implementation review I2/I2b): a scheme-like prefix that does
        // not parse classifies Relative and takes the same typed
        // rejection the facade's `new URL()` catch produces. The scheme
        // here is the canonical lowercase parse result — the same string
        // the facade's `url.protocol` produces.
        TargetKind::Url { scheme } => {
            if scheme_allowed(&scheme) {
                Ok(target)
            } else {
                Err(scheme_blocked_error(&scheme, target))
            }
        }
        TargetKind::DriveRelative => {
            Err(target_invalid_error(REASON_DRIVE_RELATIVE, target))
        }
        TargetKind::Relative => Err(target_invalid_error(REASON_RELATIVE, target)),
    }
}

// ---------------------------------------------------------------------------
// revealInFolder (design section 2, frozen law)
// ---------------------------------------------------------------------------

/// The frozen reveal dispatch plan after the rejection set, the absolute
/// gate, and the trim law.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RevealPlan {
    /// Non-root absolute path (exactly one trailing separator trimmed when
    /// the trimmed result was still a legal absolute path).
    Select { path: String },
    /// Root path — never trimmed; carries open-the-root semantics
    /// (win32: `explorer <root>` without `/select`; darwin: Finder root
    /// semantics through `activateFileViewerSelectingURLs`).
    OpenRoot { root: String },
}

/// The frozen rejection set (reject-not-escape): a quote character or any
/// C0 control character (0x00–0x1F) rejects. Quote is checked first (the
/// frozen design order).
pub(crate) fn reveal_rejection(path: &str) -> Option<&'static str> {
    if path.contains('"') {
        return Some(REASON_PATH_QUOTE);
    }
    if path.bytes().any(|byte| byte <= 0x1F) {
        return Some(REASON_PATH_CONTROL_CHAR);
    }
    None
}

/// True for a win32 drive-root form: `[A-Za-z]:[\\/]` with nothing after.
fn is_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 3 && is_ascii_alpha(bytes[0]) && bytes[1] == b':' && is_win32_separator(bytes[2])
}

/// True for `\` or `/` (both are win32 separators).
fn is_win32_separator(byte: u8) -> bool {
    byte == b'\\' || byte == b'/'
}

/// Splits the tail after the `\\?\` (or `\\?\UNC\`) literal prefix.
fn literal_prefix_tail(path: &str) -> Option<&str> {
    path.strip_prefix("\\\\?\\")
}

/// True when the path is a root that must never be trimmed (frozen
/// boundary): POSIX `/`, win32 drive roots `C:\`/`C:/`, the UNC root
/// `\\server\share\`, and the `\\?\`-literal drive/UNC roots.
pub(crate) fn is_reveal_root(path: &str) -> bool {
    if path == "/" {
        return true;
    }
    if is_drive_root(path) {
        return true;
    }
    if let Some(tail) = literal_prefix_tail(path) {
        // `\\?\C:\` / `\\?\C:/` and `\\?\UNC\server\share\` roots.
        if is_drive_root(tail) {
            return true;
        }
        if let Some(unc_tail) = tail.strip_prefix("UNC\\") {
            return is_unc_root_body(unc_tail);
        }
        return false;
    }
    if let Some(body) = path.strip_prefix("\\\\") {
        return is_unc_root_body(body);
    }
    false
}

/// True for `server\share\` (or `server/share/`) with nothing after —
/// the UNC root body after stripping the two leading separators.
fn is_unc_root_body(body: &str) -> bool {
    if !body.ends_with('\\') && !body.ends_with('/') {
        return false;
    }
    let trimmed = &body[..body.len() - 1];
    // Exactly one inner separator between server and share.
    let separator_count = trimmed
        .bytes()
        .filter(|byte| is_win32_separator(*byte))
        .count();
    separator_count == 1 && !trimmed.is_empty()
}

/// True when the string still satisfies the frozen absolute forms
/// (POSIX `/…`, win32 drive `[A-Za-z]:[\\/]…`, UNC `\\…`). Used as the
/// trim-law guard: a trimmed result that drifts into a drive-relative
/// (`C:`) or empty form is NOT legal.
pub(crate) fn is_legal_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if bytes[0] == b'/' {
        return true;
    }
    if bytes[0] == b'\\' && bytes.len() >= 2 && bytes[1] == b'\\' {
        return true;
    }
    bytes.len() >= 3
        && bytes[1] == b':'
        && is_ascii_alpha(bytes[0])
        && is_win32_separator(bytes[2])
}

/// Trims exactly one trailing separator when the trimmed result is still
/// a legal absolute path (frozen law). Roots never reach this function
/// (they are detected first and carry open-the-root semantics). POSIX
/// trims only `/` (a backslash is a legal filename character there);
/// win32 trims `\` or `/`.
fn trim_one_trailing_separator(path: &str, posix: bool) -> String {
    let trimmed = if posix {
        path.strip_suffix('/')
    } else {
        path.strip_suffix('\\').or_else(|| path.strip_suffix('/'))
    };
    match trimmed {
        Some(without_last) if is_legal_absolute(without_last) => without_last.to_string(),
        _ => path.to_string(),
    }
}

/// The frozen revealInFolder preflight: rejection set, absolute gate
/// (relative and drive-relative reject typed), root boundary, trim law.
/// `posix` selects POSIX vs win32 forms (the facade platform equals the
/// native platform; the seam keeps the law host-testable on both).
pub(crate) fn prepare_reveal(raw: &str, posix: bool) -> Result<RevealPlan, TypedExtensionError> {
    if let Some(reason) = reveal_rejection(raw) {
        return Err(target_invalid_error(reason, raw));
    }
    let absolute = if posix {
        raw.starts_with('/')
    } else {
        matches!(
            classify_target(raw),
            TargetKind::DrivePath | TargetKind::UncPath
        )
    };
    if !absolute {
        return Err(target_invalid_error(
            if matches!(classify_target(raw), TargetKind::DriveRelative) {
                REASON_DRIVE_RELATIVE
            } else {
                REASON_RELATIVE
            },
            raw,
        ));
    }
    if is_reveal_root(raw) {
        return Ok(RevealPlan::OpenRoot {
            root: raw.to_string(),
        });
    }
    let trimmed = trim_one_trailing_separator(raw, posix);
    // A trim that lands ON a root (POSIX `//` -> `/`) keeps open-the-root
    // semantics — selecting the root would drift back into the boundary
    // the frozen law protects.
    if is_reveal_root(&trimmed) {
        return Ok(RevealPlan::OpenRoot { root: trimmed });
    }
    Ok(RevealPlan::Select { path: trimmed })
}

// ---------------------------------------------------------------------------
// win32 argument construction seams (host-runnable; the ShellExecuteW FFI
// itself lives in windows/mod.rs)
// ---------------------------------------------------------------------------

// The win32 construction/mapping seams below compile for the windows
// target and for the host-runnable test matrix on every other host
// (CI matrix law — the same gating pattern as ext-sound's arbiter).
#[cfg(any(target_os = "windows", test))]
mod win_args {
    /// The explorer carrier every reveal dispatch targets.
    pub(crate) const EXPLORER_FILE: &str = "explorer.exe";

    /// Builds the frozen single-parameter `/select` form:
    /// `/select,"<path>"` — the path rides in one quoted argument with no
    /// user-controllable gap between the `/select,` prefix and the path
    /// (the frozen rejection set already guarantees no quote character
    /// can be present, so the quoting cannot be escaped).
    pub(crate) fn build_select_parameters(path: &str) -> String {
        format!("/select,\"{path}\"")
    }

    /// Builds the open-the-root parameter form: the root itself in one
    /// quoted argument (no `/select` prefix — root reveal opens the
    /// root).
    pub(crate) fn build_open_root_parameters(root: &str) -> String {
        format!("\"{root}\"")
    }

    /// The frozen ShellExecuteW acceptance threshold (design section 2):
    /// a result strictly greater than 32 is acceptance; anything at or
    /// below 32 is a failure code.
    pub(crate) const SHELL_EXECUTE_ACCEPT_THRESHOLD: i64 = 32;

    /// The frozen `SE_ERR_*` table (public, stable ShellExecuteW values):
    /// maps a result <= 32 to the lowercase reason string carried in the
    /// typed `opener_failed` details (`noassoc`/`filenotfound`/
    /// `accessdenied`/…). Unknown values carry no reason — the integer
    /// `shellExecuteResult` is always present.
    pub(crate) fn shell_execute_reason(result: i64) -> Option<&'static str> {
        match result {
            0 => Some("outofmemory"), // "out of memory or resources" (documented value 0)
            2 => Some("filenotfound"),  // SE_ERR_FNF
            3 => Some("pathnotfound"),  // SE_ERR_PNF
            5 => Some("accessdenied"),  // SE_ERR_ACCESSDENIED
            8 => Some("outofmemory"),   // SE_ERR_OOM
            26 => Some("share"),        // SE_ERR_SHARE
            27 => Some("associncomplete"), // SE_ERR_ASSOCINCOMPLETE
            28 => Some("ddetimeout"),   // SE_ERR_DDETIMEOUT
            29 => Some("ddefail"),      // SE_ERR_DDEFAIL
            30 => Some("ddebusy"),      // SE_ERR_DDEBUSY
            31 => Some("noassoc"),      // SE_ERR_NOASSOC
            32 => Some("dllnotfound"),  // SE_ERR_DLLNOTFOUND
            _ => None,
        }
    }
}

#[cfg(any(target_os = "windows", test))]
pub(crate) use win_args::{
    build_open_root_parameters, build_select_parameters, shell_execute_reason, EXPLORER_FILE,
    SHELL_EXECUTE_ACCEPT_THRESHOLD,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::options::error_code;

    fn classify(target: &str) -> TargetKind {
        classify_target(target)
    }

    // -----------------------------------------------------------------------
    // open() matrix (design section 2, frozen edge matrix)
    // -----------------------------------------------------------------------

    #[test]
    fn absolute_path_forms_classify_as_paths() {
        assert_eq!(classify("/tmp/report.txt"), TargetKind::PosixPath);
        assert_eq!(classify("/"), TargetKind::PosixPath);
        assert_eq!(classify("C:\\Users\\a\\b.txt"), TargetKind::DrivePath);
        assert_eq!(classify("C:/Users/a/b.txt"), TargetKind::DrivePath);
        assert_eq!(classify("z:\\lower-drive.txt"), TargetKind::DrivePath);
        assert_eq!(
            classify("\\\\server\\share\\file.txt"),
            TargetKind::UncPath
        );
        assert_eq!(classify("\\\\server\\share\\"), TargetKind::UncPath);
        // \\?\ literal forms stay UNC-classified and pass through verbatim.
        assert_eq!(
            classify("\\\\?\\C:\\temp\\file.txt"),
            TargetKind::UncPath
        );
        assert_eq!(
            classify("\\\\?\\UNC\\server\\share\\file.txt"),
            TargetKind::UncPath
        );
    }

    #[test]
    fn drive_relative_forms_reject_before_url_interpretation() {
        assert_eq!(classify("C:file.txt"), TargetKind::DriveRelative);
        assert_eq!(classify("C:"), TargetKind::DriveRelative);
        // A multi-letter prefix IS a scheme to both the lexical scanner and
        // `new URL()` (`ab:x` parses with scheme "ab") — facade and native
        // agree it is a blocked-scheme URL, not a relative string.
        assert_eq!(
            classify("ab:x"),
            TargetKind::Url {
                scheme: "ab".to_string()
            }
        );
        let error = validate_open_target("ab:x").unwrap_err();
        assert_eq!(error.code, error_code::SCHEME_BLOCKED);
        let error = validate_open_target("C:file.txt").unwrap_err();
        assert_eq!(error.code, error_code::TARGET_INVALID);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "drive-relative" })
        );
    }

    #[test]
    fn malformed_url_prefixes_take_the_facade_relative_rejection() {
        // Implementation review I2 P1: the lexical scheme scan alone let
        // these prefixes through to ShellExecuteW/NSWorkspace while the
        // facade's `new URL()` rejected them. The WHATWG parse gate
        // restores the isomorphism — a scheme-like prefix that does not
        // parse is the same `relative` typed rejection the facade's catch
        // fallthrough produces. Corpus verified against `new URL()` on
        // Node (the facade oracle) — the url crate implements the same
        // WHATWG URL Standard, so both sides must agree on every row.
        for target in [
            "http:",
            "http://",
            "http://[invalid",
            "https://exa mple.com",
        ] {
            let error = validate_open_target(target).unwrap_err();
            assert_eq!(error.code, error_code::TARGET_INVALID, "target: {target:?}");
            assert_eq!(
                error.details.as_ref().unwrap(),
                &serde_json::json!({ "reason": "relative" }),
                "target: {target:?}"
            );
        }
        // The gate is exactly as permissive as `new URL()` — no stricter:
        // bare non-special schemes and opaque paths parse and dispatch.
        // Tab/newline removal ANYWHERE and the C0 margin strip are
        // parser-owned (implementation review I2b corpus rows).
        for target in [
            "https://example.com",
            "http://example.com/a?b=c",
            "file:///tmp/report.txt",
            "mailto:user@example.com",
            "mailto:",
            "file:",
            "file:x",
            "  https://example.com  ",
            "HTTP://EXAMPLE.COM",
            "ht\ntps://example.com",
            "https://exa\nmple.com",
            "\u{0}https://example.com",
        ] {
            assert!(
                validate_open_target(target).is_ok(),
                "must dispatch verbatim: {target:?}"
            );
        }
        // Valid URL with a non-allowlisted scheme stays the frozen
        // scheme-blocked rejection with the canonical lowercase scheme.
        for (target, scheme) in [
            ("https+x://h", "https+x"),
            ("ab:x", "ab"),
            ("ab\n:x", "ab"),
        ] {
            let error = validate_open_target(target).unwrap_err();
            assert_eq!(error.code, error_code::SCHEME_BLOCKED, "target: {target:?}");
            assert_eq!(error.details.as_ref().unwrap()["scheme"], scheme);
        }
    }

    #[test]
    fn url_classification_is_parser_driven_with_the_canonical_scheme() {
        // The scheme in the classification is the WHATWG parse result —
        // canonical lowercase, exactly the facade's `url.protocol`.
        for (target, scheme) in [
            ("https://example.com", "https"),
            ("HTTPS://example.com", "https"),
            ("http://example.com/a?b=c", "http"),
            ("file:///tmp/report.txt", "file"),
            ("mailto:user@example.com", "mailto"),
            ("MailTo:user@example.com", "mailto"),
            // WHATWG pre-parse margin trim (mirrors new URL() on the
            // facade); the dispatched target stays the original string.
            ("  https://example.com  ", "https"),
            ("\thttps://example.com\n", "https"),
            // WHATWG removes tabs/newlines ANYWHERE in the input
            // (implementation review I2b): `ht\ntps://x` is an https URL,
            // never a relative string.
            ("ht\ntps://example.com", "https"),
            ("https://exa\nmple.com", "https"),
            ("ab\n:x", "ab"),
        ] {
            assert_eq!(
                classify(target),
                TargetKind::Url {
                    scheme: scheme.to_string()
                },
                "target: {target:?}"
            );
        }
        // Non-URL forms: embedded SPACES are not stripped (unlike
        // tab/newline), a digit-first prefix has no scheme, and a bare
        // word without a colon is not a URL.
        assert_eq!(
            classify("1https://x"),
            TargetKind::Relative,
            "scheme cannot start with a digit"
        );
        assert_eq!(classify("ht tps://x"), TargetKind::Relative);
        assert_eq!(classify("https"), TargetKind::Relative, "no colon, no scheme");
        // '+' is a legal scheme-continuation character (WHATWG grammar and
        // `new URL()` agree: `https+x:` is a scheme, not a broken https).
        assert_eq!(
            classify("https+x://h"),
            TargetKind::Url {
                scheme: "https+x".to_string()
            }
        );
    }

    #[test]
    fn scheme_allowlist_matches_case_insensitively_and_blocks_the_rest() {
        for scheme in ["http", "https", "file", "mailto"] {
            assert!(scheme_allowed(scheme));
            assert!(scheme_allowed(&scheme.to_uppercase()));
            assert!(scheme_allowed(&format!(
                "{}{}",
                scheme[0..1].to_uppercase(),
                &scheme[1..]
            )));
        }
        for scheme in ["ssh", "chrome", "ftp", "tel", "ws", "javascript", ""] {
            assert!(!scheme_allowed(scheme), "must block: {scheme}");
        }
        let error = validate_open_target("ssh://host.example").unwrap_err();
        assert_eq!(error.code, error_code::SCHEME_BLOCKED);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "scheme": "ssh" })
        );
        // The blocked-scheme detail carries the canonical lowercase form
        // (isomorphic with the facade's lowercased `url.protocol`).
        let error = validate_open_target("CHROME://settings").unwrap_err();
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "scheme": "chrome" })
        );
    }

    #[test]
    fn validate_open_target_passes_legal_targets_through_verbatim() {
        for target in [
            "/tmp/report.txt",
            "C:\\temp\\file.txt",
            "\\\\?\\C:\\temp\\file.txt",
            "\\\\server\\share\\file.txt",
            "https://example.com",
            "HTTPS://example.com",
            "file:///tmp/report.txt",
            "mailto:user@example.com",
        ] {
            let validated = validate_open_target(target).expect(target);
            assert_eq!(validated, target, "targets pass through verbatim");
        }
    }

    #[test]
    fn relative_and_protocol_less_strings_reject_typed() {
        for target in ["relative/file.txt", "file.txt", "", "  ", "a b c"] {
            let error = validate_open_target(target).unwrap_err();
            assert_eq!(error.code, error_code::TARGET_INVALID, "{target:?}");
            assert_eq!(
                error.details.as_ref().unwrap(),
                &serde_json::json!({ "reason": "relative" })
            );
        }
    }

    // -----------------------------------------------------------------------
    // revealInFolder (design section 2, frozen rejection set + trim law)
    // -----------------------------------------------------------------------

    #[test]
    fn reveal_rejection_set_rejects_quotes_and_c0_controls() {
        assert_eq!(reveal_rejection("C:\\a\\b.txt"), None);
        assert_eq!(reveal_rejection("/tmp/a b.txt"), None);
        assert_eq!(reveal_rejection("C:\\a\"b"), Some(REASON_PATH_QUOTE));
        // Quote wins in the frozen order even when a control char is present.
        assert_eq!(reveal_rejection("C:\u{1f}\"b"), Some(REASON_PATH_QUOTE));
        for control in ["\u{0}", "\u{1}", "\u{8}", "\t", "\n", "\r", "\u{1f}"] {
            assert_eq!(
                reveal_rejection(&format!("C:\\a{control}b")),
                Some(REASON_PATH_CONTROL_CHAR),
                "control byte {control:?}"
            );
        }
        // DEL (0x7F) is NOT a C0 control — outside the frozen set.
        assert_eq!(reveal_rejection("C:\\a\u{7f}b"), None);
        let error = prepare_reveal("C:\\a\"b", false).unwrap_err();
        assert_eq!(error.code, error_code::TARGET_INVALID);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "path-quote" })
        );
        let error = prepare_reveal("/tmp/a\u{1}b", true).unwrap_err();
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "path-control-char" })
        );
    }

    #[test]
    fn reveal_requires_absolute_paths_on_both_platforms() {
        for (path, posix, reason) in [
            ("notes/todo.txt", true, REASON_RELATIVE),
            ("file.txt", true, REASON_RELATIVE),
            ("C:file.txt", false, REASON_DRIVE_RELATIVE),
            ("C:", false, REASON_DRIVE_RELATIVE),
            ("notes\\todo.txt", false, REASON_RELATIVE),
        ] {
            let error = prepare_reveal(path, posix).unwrap_err();
            assert_eq!(error.code, error_code::TARGET_INVALID, "{path:?}");
            assert_eq!(
                error.details.as_ref().unwrap(),
                &serde_json::json!({ "reason": reason }),
                "path: {path:?}"
            );
        }
    }

    #[test]
    fn reveal_trims_exactly_one_trailing_separator_for_non_root_paths() {
        assert_eq!(
            prepare_reveal("/foo/", true).unwrap(),
            RevealPlan::Select {
                path: "/foo".to_string()
            }
        );
        assert_eq!(
            prepare_reveal("C:\\foo\\", false).unwrap(),
            RevealPlan::Select {
                path: "C:\\foo".to_string()
            }
        );
        assert_eq!(
            prepare_reveal("C:\\foo/", false).unwrap(),
            RevealPlan::Select {
                path: "C:\\foo".to_string()
            },
            "either separator trims"
        );
        assert_eq!(
            prepare_reveal("\\\\server\\share\\file.txt\\", false).unwrap(),
            RevealPlan::Select {
                path: "\\\\server\\share\\file.txt".to_string()
            }
        );
        assert_eq!(
            prepare_reveal("\\\\?\\C:\\temp\\file.txt\\", false).unwrap(),
            RevealPlan::Select {
                path: "\\\\?\\C:\\temp\\file.txt".to_string()
            },
            "\\\\?\\ literal paths follow the same trim law"
        );
        // Exactly ONE separator: doubles keep their remainder.
        assert_eq!(
            prepare_reveal("/foo//", true).unwrap(),
            RevealPlan::Select {
                path: "/foo/".to_string()
            }
        );
        // A backslash is a legal filename character on POSIX — only '/'
        // trims there.
        assert_eq!(
            prepare_reveal("/foo\\", true).unwrap(),
            RevealPlan::Select {
                path: "/foo\\".to_string()
            }
        );
        // No trailing separator: nothing to trim, no rewrite.
        assert_eq!(
            prepare_reveal("/foo", true).unwrap(),
            RevealPlan::Select {
                path: "/foo".to_string()
            }
        );
    }

    #[test]
    fn reveal_roots_are_never_trimmed_and_carry_open_the_root() {
        for (root, posix) in [
            ("/", true),
            ("C:\\", false),
            ("C:/", false),
            ("\\\\server\\share\\", false),
            ("\\\\?\\C:\\", false),
            ("\\\\?\\C:/", false),
            ("\\\\?\\UNC\\server\\share\\", false),
        ] {
            let plan = prepare_reveal(root, posix)
                .unwrap_or_else(|error| panic!("root {root:?} must classify: {error:?}"));
            assert_eq!(
                plan,
                RevealPlan::OpenRoot {
                    root: root.to_string()
                },
                "root: {root:?}"
            );
        }
        // The POSIX double-slash edge trims one separator down to the
        // legal root "/" — still open-the-root semantics.
        assert_eq!(prepare_reveal("//", true).unwrap(), RevealPlan::OpenRoot {
            root: "/".to_string()
        });
        // A bare share without a trailing separator is NOT the frozen root
        // form; it selects (no separator to trim).
        assert_eq!(
            prepare_reveal("\\\\server\\share", false).unwrap(),
            RevealPlan::Select {
                path: "\\\\server\\share".to_string()
            }
        );
        // Deeper UNC paths with a trailing separator trim to the file.
        assert_eq!(
            prepare_reveal("\\\\server\\share\\dir\\", false).unwrap(),
            RevealPlan::Select {
                path: "\\\\server\\share\\dir".to_string()
            }
        );
    }

    // -----------------------------------------------------------------------
    // win32 argument construction + SE mapping seams
    // -----------------------------------------------------------------------

    #[test]
    fn select_parameters_carry_one_quoted_argument_with_no_gap() {
        assert_eq!(
            build_select_parameters("C:\\foo\\bar.txt"),
            "/select,\"C:\\foo\\bar.txt\""
        );
        assert_eq!(
            build_select_parameters("\\\\server\\share\\file.txt"),
            "/select,\"\\\\server\\share\\file.txt\""
        );
        // The frozen construction has no gap between prefix and quote, and
        // the rejection set guarantees no quote can appear inside the path.
        for path in ["C:\\a b\\c.txt", "C:\\quote-less'path.txt"] {
            let parameters = build_select_parameters(path);
            assert!(parameters.starts_with("/select,\""));
            assert!(parameters.ends_with('"'));
            assert!(!parameters["/select,\"".len()..parameters.len() - 1].contains('"'));
        }
        assert_eq!(build_open_root_parameters("C:\\"), "\"C:\\\"");
        assert_eq!(
            build_open_root_parameters("\\\\server\\share\\"),
            "\"\\\\server\\share\\\""
        );
        assert_eq!(EXPLORER_FILE, "explorer.exe");
    }

    #[test]
    fn shell_execute_acceptance_threshold_is_frozen_at_32() {
        assert_eq!(SHELL_EXECUTE_ACCEPT_THRESHOLD, 32);
        // > 32 is acceptance; <= 32 is failure — the boundary values.
        assert!(33 > SHELL_EXECUTE_ACCEPT_THRESHOLD);
        assert!(32 <= SHELL_EXECUTE_ACCEPT_THRESHOLD);
    }

    /// The complete frozen SE_ERR_* table: every documented member maps to
    /// its reason string; unmapped values carry none; the integer result
    /// always travels in `opener_failed` details (options.rs tests).
    #[test]
    fn shell_execute_reason_table_is_frozen() {
        let table: &[(i64, &str)] = &[
            (0, "outofmemory"),
            (2, "filenotfound"),
            (3, "pathnotfound"),
            (5, "accessdenied"),
            (8, "outofmemory"),
            (26, "share"),
            (27, "associncomplete"),
            (28, "ddetimeout"),
            (29, "ddefail"),
            (30, "ddebusy"),
            (31, "noassoc"),
            (32, "dllnotfound"),
        ];
        for (result, reason) in table {
            assert_eq!(&shell_execute_reason(*result).unwrap(), reason);
        }
        for unmapped in [1i64, 4, 6, 7, 9, 10, 25, 11, -1] {
            assert_eq!(
                shell_execute_reason(unmapped),
                None,
                "value {unmapped} must carry no reason"
            );
        }
        // Acceptance values never consult the table.
        for accepted in [33i64, 42, 0x0026_0000] {
            assert!(accepted > SHELL_EXECUTE_ACCEPT_THRESHOLD);
        }
    }
}
