## ADDED Requirements

### Requirement: The opener extension SHALL expose a session-scoped default-app opener capability

`@opentray/ext-opener` SHALL attach through the tray/session contract as `attachOpener(tray, options?)`, returning a capability with `open(target)`, `revealInFolder(path)`, and an asynchronous `getBackend(): Promise<OpenerBackendCapabilities>` (lazy-load then query, immutable snapshot; no synchronous truth property — the shared `{type:"backend"}` ABI shape law of the archived dialog/sound extension specs). `open` and `revealInFolder` SHALL resolve on acceptance (resolve-on-acceptance, the family law): when and whether the target application actually presents is not part of the acceptance semantics. Native rejections SHALL reject with typed `opener_failed` whose details carry the OS error string/code. Native dispatch SHALL stay on the owner thread (darwin `NSWorkspace`; win32 `ShellExecuteW` — if the measured environment requires COM initialization, the existing STA discipline applies). This contract version SHALL offer no application picker (OpenWithDialog), no default-application query or registration, no drag-and-drop, and no deep-link return values. Linux targets SHALL be rejected by the facade with typed `opener_platform_unsupported` before any broker connection.

#### Scenario: open resolves on native acceptance, not on presentation

- **GIVEN** an attached opener capability on a supported platform
- **WHEN** `open('https://example.com')` is accepted natively
- **THEN** the promise SHALL resolve once the native open call is accepted, without waiting for the target application to present anything

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `opener_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: open SHALL resolve targets through the frozen preflight matrix

`open(target)` SHALL classify its argument before dispatch: (1) an absolute file path dispatches the native open (darwin `NSWorkspace.open(URL(fileURLWithPath:))`; win32 `ShellExecuteW("open", path)`) — target existence is NOT an acceptance precondition (opening a path that may appear later is not this layer's error semantics), while an unreadable or unstat-able path argument SHALL still be forwarded to native, where a native rejection surfaces as typed `opener_failed`; (2) a string parseable by `new URL()` with a protocol dispatches the native URL open (darwin `NSWorkspace.open(url)`; win32 `ShellExecuteW("open", url)`); (3) anything else (relative path, protocol-less string) SHALL reject with typed `opener_target_invalid` whose details carry `{reason}`.

#### Scenario: A relative path is a typed rejection

- **GIVEN** an attached opener capability
- **WHEN** `open('relative/file.txt')` is called
- **THEN** the call SHALL reject with typed `opener_target_invalid` carrying the reason, and no native dispatch SHALL occur

#### Scenario: A not-yet-existing absolute path is still dispatched

- **GIVEN** the facade running on darwin
- **WHEN** `open('/tmp/report-later.txt')` is called for a path that does not exist yet
- **THEN** the call SHALL dispatch natively and resolve or reject per the native result — existence is not a preflight rejection, and a native rejection surfaces as typed `opener_failed`

### Requirement: URL schemes SHALL pass the frozen allowlist or be typed-blocked

URL targets SHALL be accepted only for the frozen v1 allowlist schemes `http`, `https`, `file`, and `mailto`, matched case-insensitively (`HTTPS://` passes); every other scheme (`ssh:`, `chrome://`, custom handlers) SHALL reject with typed `opener_scheme_blocked` whose details carry the scheme. Rationale (frozen): the host-side API has no page same-origin constraint and custom-scheme handler registration is abusable as a persistence vector — the allowlist is the minimal surprise surface. The strictness of this list is the open adjudication recorded in the plan; if adjudication relaxes it, the relaxation (reject executable-class schemes except `file`, pass the rest through) SHALL be written back into this requirement rather than silently widened at runtime.

#### Scenario: Scheme matching is case-insensitive within the allowlist

- **GIVEN** an attached opener capability
- **WHEN** `open('HTTPS://example.com')` is called
- **THEN** the call SHALL dispatch natively like its lowercase form, not reject

#### Scenario: A custom scheme is typed-blocked with its scheme in details

- **GIVEN** an attached opener capability
- **WHEN** `open('ssh://host.example')` is called
- **THEN** the call SHALL reject with typed `opener_scheme_blocked` whose details carry `ssh`, and no native dispatch SHALL occur

### Requirement: revealInFolder SHALL locate in the file manager under the path-quote rejection law

`revealInFolder(path)` SHALL require an absolute path; a relative path SHALL reject with typed `opener_target_invalid`. darwin SHALL project `NSWorkspace.activateFileViewerSelecting([url])`; win32 SHALL project `explorer.exe /select,<path>` through `ShellExecuteW("open", "explorer", params)` with the path passed as one quoted argument — no user-controllable gap between the `/select,` prefix and the path, no shell metacharacter concatenation. A path containing a quote character SHALL reject with typed `opener_target_invalid` with `reason: "path-quote"` — frozen as reject-not-escape, because an escaping matrix is a persistent attack surface.

#### Scenario: A quoted path is rejected, never escaped

- **GIVEN** the facade running on win32
- **WHEN** `revealInFolder('C:\\Users\\a\\"b\\c.txt')` is called with an embedded quote character
- **THEN** the call SHALL reject with typed `opener_target_invalid` (`reason: "path-quote"`) and no `ShellExecuteW` invocation SHALL occur

#### Scenario: A relative reveal target is a typed rejection

- **GIVEN** an attached opener capability
- **WHEN** `revealInFolder('notes/todo.txt')` is called
- **THEN** the call SHALL reject with typed `opener_target_invalid` carrying the reason

### Requirement: Every platform build SHALL serialize the OpenerBackendCapabilities DTO

The native extension SHALL embed and report an `OpenerBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's v1 opener projection facts frozen in the shared fixture, not an open-ended runtime probe.

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
