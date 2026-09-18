# opener-extension Specification

## Purpose
TBD - created by archiving change add-ext-opener. Update Purpose after archive.

## Requirements

### Requirement: The opener extension SHALL expose a session-scoped default-app opener capability

`@opentray/ext-opener` SHALL attach through the tray/session contract as `attachOpener(tray, options?)`, returning a capability with `open(target)`, `revealInFolder(path)`, and an asynchronous `getBackend(): Promise<OpenerBackendCapabilities>` (lazy-load then query, immutable snapshot; no synchronous truth property — the shared `{type:"backend"}` ABI shape law of the archived dialog/sound extension specs). `open` and `revealInFolder` SHALL resolve on acceptance (resolve-on-acceptance, the family law): when and whether the target application actually presents is not part of the acceptance semantics. Native rejections SHALL reject with typed `opener_failed` whose details carry `{shellExecuteResult?, osError?}` (darwin osError acceptance semantics; win32 SE result-code mapping). On win32 acceptance SHALL be frozen as `ShellExecuteW` returning a value greater than 32: a result ≤ 32 SHALL reject with typed `opener_failed` whose details carry the integer `shellExecuteResult` plus the mapped system `SE_ERR_*` reason string (e.g. `noassoc`/`filenotfound`/`accessdenied`). Native dispatch SHALL stay on the owner thread (darwin `NSWorkspace`; win32 `ShellExecuteW`) under the frozen process-level COM discipline: the owner thread's apartment initialization is already completed at broker startup by the existing owner-loop/event-pump initialization discipline, and extension command paths SHALL perform no `CoInitialize`/`CoUninitialize` compensation — any measured exception is an implementation-phase P0 write-back to the design contract, not in-situ compensation. This contract version SHALL offer no application picker (OpenWithDialog), no default-application query or registration, no drag-and-drop, and no deep-link return values. Linux targets SHALL be rejected by the facade with typed `opener_platform_unsupported` before any broker connection.

#### Scenario: open resolves on native acceptance, not on presentation

- **GIVEN** an attached opener capability on a supported platform
- **WHEN** `open('https://example.com')` is accepted natively
- **THEN** the promise SHALL resolve once the native open call is accepted, without waiting for the target application to present anything

#### Scenario: A ShellExecuteW result at or below 32 maps to typed failure with its SE_ERR reason

- **GIVEN** the facade running on win32
- **WHEN** `open` dispatches and `ShellExecuteW` returns a value ≤ 32 such as `SE_ERR_NOASSOC`
- **THEN** the call SHALL reject with typed `opener_failed` whose details carry the integer `shellExecuteResult` and the mapped `SE_ERR_*` reason string

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `opener_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: open SHALL resolve targets through the frozen preflight matrix

`open(target)` SHALL classify its argument before dispatch: (1) an absolute file path dispatches the native open (darwin `NSWorkspace.open(URL(fileURLWithPath:))`; win32 `ShellExecuteW("open", path)`) — target existence is NOT an acceptance precondition (opening a path that may appear later is not this layer's error semantics), while an unreadable or unstat-able path argument SHALL still be forwarded to native, where a native rejection surfaces as typed `opener_failed`; (2) a string parseable by `new URL()` with a protocol dispatches the native URL open (darwin `NSWorkspace.open(url)`; win32 `ShellExecuteW("open", url)`); (3) anything else (relative path, protocol-less string) SHALL reject with typed `opener_target_invalid` whose details carry `{reason}`. Absolute-path determination SHALL follow the frozen edge matrix: POSIX paths beginning `/` and win32 `[A-Za-z]:[\\/]` forms are absolute; a win32 `C:x` form (drive letter without separator) is a drive-relative relative path that SHALL reject with typed `opener_target_invalid` (reason: `"drive-relative"`); `\\server\share\...` UNC paths are valid absolute paths; a `\\?\` prefix SHALL be passed to native literally with no normalization (normalization is the caller's responsibility — this layer rejects semantically ambiguous input instead of normalizing it). A `file:` URL SHALL pass to native as-is (darwin `NSWorkspace.open(url)`; win32 `ShellExecuteW` accepts the scheme) with NO URL→path normalization — normalization introduces a decode/encode ambiguity surface, and callers wanting path semantics SHALL pass an absolute path directly.

#### Scenario: A relative path is a typed rejection

- **GIVEN** an attached opener capability
- **WHEN** `open('relative/file.txt')` is called
- **THEN** the call SHALL reject with typed `opener_target_invalid` carrying the reason, and no native dispatch SHALL occur

#### Scenario: A drive-relative path is a typed rejection

- **GIVEN** the facade running on win32
- **WHEN** `open('C:file.txt')` is called
- **THEN** the call SHALL reject with typed `opener_target_invalid` carrying reason `"drive-relative"` and no native dispatch SHALL occur

#### Scenario: A UNC path dispatches as a valid absolute path

- **GIVEN** the facade running on win32
- **WHEN** `open('\\\\server\\share\\file.txt')` is called
- **THEN** the call SHALL dispatch natively as a valid absolute path

#### Scenario: A \\?\-prefixed path passes through literally

- **GIVEN** the facade running on win32
- **WHEN** `open('\\\\?\\C:\\temp\\file.txt')` is called
- **THEN** the path SHALL be forwarded to native literally with no normalization applied by this layer

#### Scenario: A file: URL passes through without URL-to-path normalization

- **GIVEN** an attached opener capability
- **WHEN** `open('file:///tmp/report.txt')` is called
- **THEN** the URL SHALL dispatch to native as-is with no URL→path normalization — callers wanting path semantics pass an absolute path directly

#### Scenario: A not-yet-existing absolute path is still dispatched

- **GIVEN** the facade running on darwin
- **WHEN** `open('/tmp/report-later.txt')` is called for a path that does not exist yet
- **THEN** the call SHALL dispatch natively and resolve or reject per the native result — existence is not a preflight rejection, and a native rejection surfaces as typed `opener_failed`

### Requirement: URL schemes SHALL pass the frozen allowlist or be typed-blocked

URL targets SHALL be accepted only for the frozen v1 allowlist schemes `http`, `https`, `file`, and `mailto`, matched case-insensitively (`HTTPS://` passes); every other scheme (`ssh:`, `chrome://`, custom handlers) SHALL reject with typed `opener_scheme_blocked` whose details carry the scheme. Rationale (frozen, Codex R1): the host-side API has no page same-origin constraint — inputs may come from external data — and custom-scheme handler registration is abusable as a persistence vector with lasting side effects, so the strict list is the minimal surprise surface. The strict allowlist is frozen: relaxation is a future additive compatibility increment that SHALL arrive through an explicit change to this requirement rather than a runtime silent widening, and tightening would break existing callers, so v1 ships strict.

#### Scenario: Scheme matching is case-insensitive within the allowlist

- **GIVEN** an attached opener capability
- **WHEN** `open('HTTPS://example.com')` is called
- **THEN** the call SHALL dispatch natively like its lowercase form, not reject

#### Scenario: A custom scheme is typed-blocked with its scheme in details

- **GIVEN** an attached opener capability
- **WHEN** `open('ssh://host.example')` is called
- **THEN** the call SHALL reject with typed `opener_scheme_blocked` whose details carry `ssh`, and no native dispatch SHALL occur

### Requirement: revealInFolder SHALL locate in the file manager under the frozen rejection set and trim law

`revealInFolder(path)` SHALL require an absolute path; relative and drive-relative paths SHALL reject with typed `opener_target_invalid`. darwin SHALL project `NSWorkspace.activateFileViewerSelecting([url])`; win32 SHALL project `explorer.exe /select,<path>` through `ShellExecuteW("open", "explorer", params)` with the path passed as one quoted argument — no user-controllable gap between the `/select,` prefix and the path, no shell metacharacter concatenation. The frozen rejection set (reject-not-escape, because an escaping matrix is a persistent attack surface): a path containing a quote character `"` SHALL reject with typed `opener_target_invalid` with `reason: "path-quote"`; a path containing NUL or any C0 control character (0x00–0x1F) SHALL reject with `reason: "path-control-char"`. The trailing-separator trim law SHALL hold with the root-path boundary: exactly one trailing separator SHALL be trimmed only when the trimmed result is still a legal absolute path (`C:\foo\` → `C:\foo`; `/foo/` → `/foo`); root paths (`C:\`, `/`, and the UNC root `\\server\share\`) SHALL never be trimmed — trimming would drift into a drive-relative form (`C:`) or an empty string — and a root reveal SHALL carry open-the-root semantics: win32 dispatches `explorer <root>` without `/select`, and darwin projects `activateFileViewerSelecting([root URL])` under the platform's native root semantics. Non-root UNC paths SHALL be valid reveal targets (explorer supports them natively).

#### Scenario: A quoted path is rejected, never escaped

- **GIVEN** the facade running on win32
- **WHEN** `revealInFolder('C:\\Users\\a\\"b\\c.txt')` is called with an embedded quote character
- **THEN** the call SHALL reject with typed `opener_target_invalid` (`reason: "path-quote"`) and no `ShellExecuteW` invocation SHALL occur

#### Scenario: A C0 control character is rejected like a quote

- **GIVEN** an attached opener capability
- **WHEN** `revealInFolder` is called with a path containing NUL or any other C0 control character (0x00–0x1F)
- **THEN** the call SHALL reject with typed `opener_target_invalid` (`reason: "path-control-char"`) and no `ShellExecuteW` invocation SHALL occur

#### Scenario: A relative reveal target is a typed rejection

- **GIVEN** an attached opener capability
- **WHEN** `revealInFolder('notes/todo.txt')` is called
- **THEN** the call SHALL reject with typed `opener_target_invalid` carrying the reason

#### Scenario: A trailing separator is trimmed only for non-root paths

- **GIVEN** the facade running on win32
- **WHEN** `revealInFolder('C:\\foo\\')` is called
- **THEN** the dispatch SHALL trim exactly one trailing separator to `C:\foo`, still a legal absolute path, before building the `/select` argument

#### Scenario: Root paths are never trimmed and reveal as open-the-root

- **GIVEN** the facade running on win32
- **WHEN** `revealInFolder('C:\\')` is called
- **THEN** the root SHALL NOT be trimmed into a drive-relative form and the dispatch SHALL be `explorer C:\` without `/select` (open-the-root semantics)

### Requirement: Every platform build SHALL serialize the OpenerBackendCapabilities DTO

The native extension SHALL embed and report an `OpenerBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's frozen v1 projection facts — `platform`; `allowedSchemes` frozen as the readonly tuple `['http', 'https', 'file', 'mailto']` (the v1 frozen allowlist, lowercase canonical); and `supportsRevealInFolder: true` (v1 true on both platforms) — not an open-ended runtime probe.

#### Scenario: The projection facts are runtime truth

- **GIVEN** an attached opener capability on either supported platform
- **WHEN** the facade awaits `getBackend()`
- **THEN** the returned snapshot SHALL report exactly that platform's v1 opener projection facts frozen in the shared fixture

### Requirement: The facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-opener` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` (`libopentray_ext_opener.dylib` for darwin targets; `opentray_ext_opener.dll` for win32 targets) through the same SDK `kind: "embedded"` artifact and workspace pack-size audit delivered by the archived `add-ext-dialog` change and generalized by `add-ext-sound` (identity from facade version plus `contract.json` = `{"extensionName":"opener","contractFingerprint":"opentray-ext-opener-contract-1"}`; accessibility and missing-target failures typed identically). The shared infrastructure SHALL NOT be duplicated in this change.

#### Scenario: Embedded artifact resolves through shared infrastructure

- **GIVEN** the installed `@opentray/ext-opener` facade on `darwin-arm64`
- **WHEN** the SDK resolves the opener extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_opener.dylib` with expected identity `{ extensionName: "opener", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-opener-contract-1", sha256: <manifest hash for the target>, buildIdentity: <manifest build identity> }` using the same embedded-artifact resolver and `LoadExt` identity fields introduced for dialogs
