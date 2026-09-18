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

### Requirement: writeText payloads SHALL follow the frozen UTF-16 encoding and bound contract

Payload measurement SHALL count UTF-16 code units (the JS/TS string unit, the same unit win32 `CF_UNICODETEXT` uses). `writeText` SHALL enforce a frozen capacity of 1 MiB = 1,048,576 UTF-16 code units in the facade preflight; exceeding it SHALL reject with typed `clipboard_payload_too_large` (details: `lengthUtf16`, `limit`). `readText` SHALL impose no cap on returned content — the local clipboard is trusted input, deep-copied and returned. An input containing a lone surrogate (an unpaired high or low surrogate, e.g. `"\uD83D"`) SHALL reject with typed `clipboard_payload_invalid` (details: `reason: "lone-surrogate"`, `index`) — never a silent replacement write, which would break read-back round-trip fidelity. On win32 `IsClipboardFormatAvailable(CF_UNICODETEXT)` SHALL be the sole authority for "no text on the board": a FALSE result SHALL read as `null` without consulting the last error, and a `GetClipboardData(CF_UNICODETEXT)` result of `NULL` with the format available SHALL reject with typed `clipboard_unavailable` whose details carry the OS error code. The last error after a NULL `GetClipboardData` is not a contract (real-machine amendment 2026-09-18: an emptied board reports `ERROR_NOT_FOUND`, not `ERROR_SUCCESS`); darwin `string(forType:)` returning `nil` SHALL read as `null` with no ambiguous path.

#### Scenario: The 1 MiB UTF-16 write cap is a typed rejection

- **GIVEN** an attached clipboard capability
- **WHEN** `writeText` is called with a payload over 1,048,576 UTF-16 code units
- **THEN** the call SHALL reject with typed `clipboard_payload_too_large` carrying the measured length and the limit, with no broker/native dispatch

#### Scenario: A lone surrogate is typed-rejected, never replaced

- **GIVEN** an attached clipboard capability
- **WHEN** `writeText('\uD83D')` is called with an unpaired surrogate
- **THEN** the call SHALL reject with typed `clipboard_payload_invalid` with `reason: "lone-surrogate"` and the offending index, and no replacement-character write SHALL occur

#### Scenario: win32 format-unavailable reads as null regardless of the last error

- **GIVEN** the facade running on win32 with the clipboard open and `IsClipboardFormatAvailable(CF_UNICODETEXT)` returning FALSE (e.g. an emptied board whose last error is `ERROR_NOT_FOUND`/`ERROR_SUCCESS`/stale)
- **WHEN** `readText()` is awaited
- **THEN** the promise SHALL resolve `null` (no text), not an error, and `GetClipboardData` SHALL not be consulted

#### Scenario: win32 NULL with the format available is typed-unavailable

- **GIVEN** the facade running on win32 with `IsClipboardFormatAvailable(CF_UNICODETEXT)` returning TRUE and `GetClipboardData(CF_UNICODETEXT)` returning `NULL` (the last error reporting e.g. `ERROR_INVALID_HANDLE`)
- **WHEN** `readText()` is awaited
- **THEN** the call SHALL reject with typed `clipboard_unavailable` whose details carry the OS error code

### Requirement: win32 clipboard lock contention SHALL follow the frozen bounded-retry discipline

On win32, `OpenClipboard` may fail with `ACCESS_DENIED` while another process holds the clipboard. Every clipboard command SHALL apply the frozen executable retry discipline: a monotonic deadline (Instant-based) with a total budget of 2000 ms measured from command dispatch; a retry SHALL occur only when `OpenClipboard` fails with `GetLastError() == ERROR_ACCESS_DENIED` — any other error SHALL reject immediately with typed `clipboard_unavailable` carrying the OS error code; the backoff ladder SHALL be 10ms→20ms→40ms→80ms→160ms→200ms capped, constant 200 ms afterwards; every sleep SHALL be trimmed to the remaining budget (never sleeping past the deadline); budget exhaustion, or a next retry with no executable room left, SHALL reject with typed `clipboard_locked` whose details carry `attempts` (counting the first attempt) and `elapsedMs` (including native call time, up to typed-error construction). Acquisition within the budget resolves normally. Reads SHALL deep-copy `GetClipboardData(CF_UNICODETEXT)` (HGLOBAL global memory, UTF-16 zero-terminated) and close the clipboard immediately after copying; writes SHALL `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)` then close; clears SHALL `EmptyClipboard` then close. darwin SHALL project through `NSPasteboard.generalPasteboard` (`clearContents()` + `setString(forType:)` write; `string(forType:)` read with `nil` → `null`; `clearContents()` clear) on the owner thread (MainThreadOnly family discipline).

#### Scenario: Contention then success within budget resolves normally

- **GIVEN** a win32 clipboard briefly held by another process
- **WHEN** a clipboard command retries `OpenClipboard` and acquires within the 2000 ms monotonic deadline
- **THEN** the call SHALL resolve normally with its retry trajectory inside the frozen backoff ladder, each sleep trimmed to the remaining budget

#### Scenario: Persistent lock exhausts into a typed rejection

- **GIVEN** a win32 clipboard held by another process for longer than the budget
- **WHEN** `readText()` exhausts the retry discipline
- **THEN** the call SHALL reject with typed `clipboard_locked` whose details report the actual `attempts` (including the first attempt) and `elapsedMs` (including native call time)

#### Scenario: A non-ACCESS_DENIED open failure never retries

- **GIVEN** a win32 `OpenClipboard` failing with an error other than `ERROR_ACCESS_DENIED`
- **WHEN** any clipboard command is dispatched
- **THEN** the call SHALL reject immediately with typed `clipboard_unavailable` carrying the OS error code, with zero retries

### Requirement: win32 SHALL observe the frozen HGLOBAL ownership law

The win32 write path SHALL allocate with `GlobalAlloc(GMEM_MOVEABLE)`, copy the UTF-16 zero-terminated bytes, and hand the HGLOBAL to `SetClipboardData`. On `SetClipboardData` success the system owns the handle and the extension SHALL never `GlobalFree` it (a double-free-class error); on failure the extension SHALL `GlobalFree` the not-yet-handed-off handle itself, including the `EmptyClipboard` failure path — any failure across `OpenClipboard → (EmptyClipboard → SetClipboardData) → CloseClipboard` SHALL reclaim every allocated-but-unhanded HGLOBAL before surfacing the typed rejection. The read path SHALL treat the `GetClipboardData` HGLOBAL as clipboard-owned: the extension SHALL `GlobalLock`-copy the complete content and `GlobalUnlock` before `CloseClipboard`, SHALL never `GlobalFree` the handle, and SHALL never touch it after `CloseClipboard`; the deep-copy buffer SHALL be `readText`'s only holding.

#### Scenario: SetClipboardData success hands ownership to the system

- **GIVEN** a win32 `writeText` that allocated a `GMEM_MOVEABLE` HGLOBAL and copied the payload
- **WHEN** `SetClipboardData(CF_UNICODETEXT)` succeeds
- **THEN** the extension SHALL NOT `GlobalFree` the handle (the system owns it) and the write SHALL resolve normally

#### Scenario: Failure paths reclaim the un-handed-off handle

- **GIVEN** a win32 write whose HGLOBAL is allocated but not yet accepted by `SetClipboardData`
- **WHEN** `SetClipboardData`, `EmptyClipboard`, or any surrounding open/close step fails
- **THEN** the extension SHALL `GlobalFree` the un-handed-off HGLOBAL before surfacing the typed rejection

#### Scenario: Reads copy through GlobalLock and never free board-owned memory

- **GIVEN** a win32 `readText` holding the `GetClipboardData(CF_UNICODETEXT)` HGLOBAL
- **WHEN** the content is copied out
- **THEN** the extension SHALL `GlobalLock`-copy and `GlobalUnlock` before `CloseClipboard`, SHALL never `GlobalFree` the handle nor touch it after close, and the deep copy SHALL be the only retained memory

### Requirement: Every platform build SHALL serialize the ClipboardBackendCapabilities DTO

The native extension SHALL embed and report a `ClipboardBackendCapabilities` DTO exposed through the asynchronous `getBackend()` (immutable snapshot; the shared `{type:"backend"}` ABI shape round-trip fixture law). The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete fixture across both platform constructors — no single-target cross-compilation causality is claimed. The DTO SHALL report this platform's frozen v1 projection facts — `platform`; `textOnly: true` (v1 constant; the format catalog is a v2 extension slot); `maxWriteUtf16: 1_048_576` (platform-independent contract constant, the same source as the write cap); and `boundedOpenRetry` (`true` on win32 under the lock-contention retry law; `false` on darwin under AppKit serialization) — not an open-ended runtime probe.

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
