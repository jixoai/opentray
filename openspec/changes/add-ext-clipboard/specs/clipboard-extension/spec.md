## ADDED Requirements

### Requirement: The clipboard extension SHALL expose a session-scoped clipboard text capability

`@opentray/ext-clipboard` SHALL attach through the tray/session contract as `attachClipboard(tray, options?)`, returning a capability with `readText()`, `writeText(text)`, `clear()`, and an asynchronous `getBackend(): Promise<ClipboardBackendCapabilities>` (lazy-load then query, immutable snapshot; no synchronous truth property — the shared `{type:"backend"}` ABI shape law of the archived dialog/sound extension specs). This contract version SHALL cover UTF-8 text only: non-text formats, change monitoring, and format conversion are out of scope (future typed format catalogs or EventPort producers require their own change). Native API failures SHALL reject with typed `clipboard_unavailable` whose details carry the OS error code. win32 clipboard operations SHALL close within a single command — `OpenClipboard → operation → CloseClipboard` — and SHALL never hold the clipboard handle across commands. Linux targets SHALL be rejected by the facade with typed `clipboard_platform_unsupported` before any broker connection.

#### Scenario: A write-then-read round trip crosses the OS clipboard

- **GIVEN** an attached clipboard capability on a supported platform
- **WHEN** `writeText('hello')` resolves and `readText()` is awaited
- **THEN** `readText()` SHALL resolve `'hello'` observed from the OS clipboard

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `clipboard_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: An empty or textless clipboard SHALL read as null, never an error

`readText()` SHALL resolve `null` when the clipboard is empty or holds no text — the empty state is a first-class value (the same law as picker cancellation `null`), not a typed error and not an empty string.

#### Scenario: No text resolves null

- **GIVEN** a system clipboard holding no text content
- **WHEN** `readText()` is awaited
- **THEN** the promise SHALL resolve `null` without rejecting

### Requirement: An empty-string write SHALL stay distinct from clear

`writeText('')` SHALL be a legal call that writes empty text through the platform's set-string operation — on darwin `setString("")` — and SHALL NOT be coerced into the clear operation (darwin `clearContents()`; win32 `EmptyClipboard`); the ownership-semantics difference between delivering bytes and clearing ownership SHALL be preserved as two operations, never merged.

#### Scenario: Empty-string write dispatches set-string, not clear

- **GIVEN** an attached clipboard capability on darwin
- **WHEN** `writeText('')` is dispatched
- **THEN** the native projection SHALL be the pasteboard set-string operation and SHALL NOT be `clearContents()`

### Requirement: win32 clipboard lock contention SHALL follow the frozen bounded-retry discipline

On win32, `OpenClipboard` may fail with `ACCESS_DENIED` while another process holds the clipboard. Every clipboard command SHALL apply the frozen retry discipline: a total budget of at most 2 s with escalating backoff from 10 ms doubling to a 200 ms cap (10ms→20ms→…→200ms); acquisition within the budget resolves normally; budget exhaustion SHALL reject with typed `clipboard_locked` whose details carry `attempts` and `elapsedMs`. Reads SHALL deep-copy `GetClipboardData(CF_UNICODETEXT)` (HGLOBAL global memory, UTF-16 zero-terminated) and close the clipboard immediately after copying; writes SHALL `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)` then close; clears SHALL `EmptyClipboard` then close. darwin SHALL project through `NSPasteboard.generalPasteboard` (`clearContents()` + `setString(forType:)` write; `string(forType:)` read with `nil` → `null`; `clearContents()` clear) on the owner thread (MainThreadOnly family discipline).

#### Scenario: Contention then success within budget resolves normally

- **GIVEN** a win32 clipboard briefly held by another process
- **WHEN** a clipboard command retries `OpenClipboard` and acquires within the 2 s budget
- **THEN** the call SHALL resolve normally with its retry trajectory inside the frozen backoff ladder

#### Scenario: Persistent lock exhausts into a typed rejection

- **GIVEN** a win32 clipboard held by another process for longer than the budget
- **WHEN** `readText()` exhausts the retry discipline
- **THEN** the call SHALL reject with typed `clipboard_locked` whose details report the actual `attempts` and `elapsedMs`

### Requirement: Every platform build SHALL serialize the ClipboardBackendCapabilities DTO

The native extension SHALL embed and report a `ClipboardBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's v1 text-only clipboard projection facts (win32 bounded-retry discipline; darwin pasteboard projection), not an open-ended runtime probe.

#### Scenario: The platform projection is runtime truth

- **GIVEN** an attached clipboard capability on either supported platform
- **WHEN** the facade awaits `getBackend()`
- **THEN** the returned snapshot SHALL report exactly that platform's v1 text projection facts frozen in the shared fixture

### Requirement: The facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-clipboard` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` (`libopentray_ext_clipboard.dylib` for darwin targets; `opentray_ext_clipboard.dll` for win32 targets) through the same SDK `kind: "embedded"` artifact and workspace pack-size audit delivered by the archived `add-ext-dialog` change and generalized by `add-ext-sound` (identity from facade version plus `contract.json` = `{"extensionName":"clipboard","contractFingerprint":"opentray-ext-clipboard-contract-1"}`; accessibility and missing-target failures typed identically). The shared infrastructure SHALL NOT be duplicated in this change.

#### Scenario: Embedded artifact resolves through shared infrastructure

- **GIVEN** the installed `@opentray/ext-clipboard` facade on `darwin-arm64`
- **WHEN** the SDK resolves the clipboard extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_clipboard.dylib` with expected identity `{ extensionName: "clipboard", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-clipboard-contract-1", sha256: <manifest hash for the target>, buildIdentity: <manifest build identity> }` using the same embedded-artifact resolver and `LoadExt` identity fields introduced for dialogs
