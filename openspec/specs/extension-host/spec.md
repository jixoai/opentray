# extension-host Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Extension host SHALL be a kernel law

The kernel SHALL provide an extension host contract that loads, registers, commands, and unloads extension instances scoped to a surface and optionally a tray. Extension instances SHALL communicate with the kernel only through host callbacks and extension command/event payloads.

#### Scenario: Extension cannot mutate unrelated tray state

- **GIVEN** a webview extension instance is attached to `(surfaceA, trayA)`
- **WHEN** it emits a command or event
- **THEN** the host scopes that message to `(surfaceA, trayA, extName)`
- **AND** the extension cannot mutate `(surfaceA, trayB)` or `(surfaceB, trayA)` without an explicit host-authorized command.

### Requirement: Dynamic extension ABI SHALL be stable and C-compatible

The extension ABI SHALL use `extern "C"` functions and C-compatible structures for dynamic libraries. Rust-specific types SHALL NOT cross the dynamic library boundary. JSON command payloads MAY be used inside ABI functions to keep the binary ABI stable while TypeScript/Rust schemas evolve.

The ABI SHALL be strong enough for an official extension to own its entire native runtime internally. The daemon SHALL NOT pass Rust event-loop, window, backend, WebView, or official-extension-specific parser objects across the ABI boundary in order to make a released extension function.

#### Scenario: Dynamic library exports required symbols

- **GIVEN** an extension shared library is loaded
- **WHEN** the extension host validates it
- **THEN** it requires init, command, and deinit symbols
- **AND** it rejects the library with a structured error if any required symbol is missing.

### Requirement: Internal extension adapter MAY bootstrap P0 only if it uses the same host contract

The implementation MAY start with an internal Rust extension adapter for local development, but only if that adapter exercises the same `ExtensionHost` command/event contract as dynamic libraries. P0 code SHALL keep the dynamic ABI spec present and tested at the host boundary.

#### Scenario: Internal adapter does not get core privileges

- **GIVEN** a P0 internal webview adapter is registered without dynamic loading
- **WHEN** it sends events or receives commands
- **THEN** it still goes through the extension registry and host callbacks
- **AND** it does not import or mutate kernel registries directly.

### Requirement: Extension discovery SHALL be explicit and auditable

The system SHALL support extension discovery from package-adjacent platform artifacts, user config directories, and `OPENTRAY_EXT_PATH`. Discovery SHALL produce an auditable candidate path list and SHALL not silently load arbitrary libraries outside configured locations.

#### Scenario: Extension path resolution is deterministic

- **GIVEN** multiple extension search paths are configured
- **WHEN** the broker resolves `webview`
- **THEN** it evaluates paths in documented priority order
- **AND** logs or returns the selected path without leaking unrelated filesystem details.

### Requirement: Official extension runtime ownership SHALL stay inside the extension artifact

The daemon SHALL treat official dynamic extensions as self-contained runtime atoms. For an official extension, command payload parsing, native runtime setup, and returned event payload shape SHALL live inside the extension library artifact rather than the daemon binary.

`opentray-core` and `opentray-bin` SHALL know only the generic extension ABI and scoped dispatch law. They SHALL NOT keep official-extension-specific command parsers or native runtime builders.

#### Scenario: Daemon forwards WebView command bytes without product parsing

- **GIVEN** a client sends an `ext-command` for `ext: "webview"`
- **WHEN** the daemon dispatches that command through the dynamic extension ABI
- **THEN** it forwards the scoped envelope to the loaded library without parsing `show`, `hide`, `navigate`, `evaluate`, or `postMessage` fields itself
- **AND** the returned scoped events come from the extension library rather than a daemon-side WebView adapter.

### Requirement: Native runtime linkage SHALL belong to the owning extension artifact

When an official extension needs a platform-native runtime such as WebKit or `wry`, that dependency SHALL link into the extension artifact rather than the broker binary. The broker MAY retain generic host callbacks for future privileged facilities, but the regular WebView path SHALL NOT require an official-extension-specific daemon capability to create its runtime.

#### Scenario: macOS linkage shows WebKit on the extension dylib

- **GIVEN** macOS release artifacts are built for the daemon and the official WebView extension
- **WHEN** their linkage tables are inspected
- **THEN** the `opentray` binary does not link `WebKit.framework`
- **AND** `libopentray_ext_webview.dylib` does link `WebKit.framework`.

### Requirement: Daemon SHALL load dynamic extensions through a generic host boundary

The daemon composition layer SHALL provide a generic dynamic extension loader that implements the existing extension host law. The loader SHALL resolve candidate libraries from package-adjacent platform artifacts, request-package-adjacent platform artifacts, user config directories, and `OPENTRAY_EXT_PATH`. It SHALL validate required ABI symbols before registering the extension instance.

The loader SHALL be generic. It SHALL NOT branch on WebView product behavior in `opentray-core`, and it SHALL NOT grant native extensions direct access to kernel registries.

#### Scenario: Dynamic extension library is validated before registration

- **GIVEN** a client requests `load-ext` for an extension
- **WHEN** the daemon resolves a candidate dynamic library
- **THEN** it validates ABI version and required init, command, lease cleanup, deinit, and host-free symbols
- **AND** it returns a structured error if validation fails
- **AND** it registers the extension only after validation succeeds.

#### Scenario: Request package roots are searched for platform atoms

- **GIVEN** an extension is requested by npm facade package name such as `@opentray/ext-webview`
- **WHEN** the daemon builds dynamic library candidates
- **THEN** it searches platform packages adjacent to that requested package's dependency roots
- **AND** it can resolve layouts where package managers do not place extension platform packages next to the daemon binary package.

### Requirement: Dynamic extensions SHALL use host capabilities for daemon-owned UI authority

Dynamic extension libraries SHALL NOT receive Rust event-loop, window, backend, or kernel registry objects across the ABI. When an extension needs daemon-owned authority, such as creating a native UI window on the main event loop, it SHALL call a host capability through C-compatible callbacks and JSON payloads. The daemon composition layer SHALL implement the capability; the extension SHALL own command semantics and event payload shape.

The host capability boundary SHALL be generic. `opentray-core` SHALL only pass an `ExtensionHostContext`-style trait through dispatch. It SHALL NOT branch on WebView behavior. If a capability is unavailable, the host SHALL return typed unsupported/rejected status instead of fake success.

#### Scenario: WebView requests UI through host capability

- **GIVEN** a dynamic WebView extension receives a `show` command
- **WHEN** it needs a native WebView window
- **THEN** it invokes the `webview` host capability with JSON command data
- **AND** it does not receive `ActiveEventLoop`, `Window`, `WebView`, or backend concrete types across the ABI
- **AND** the daemon returns JSON result data that the extension wraps into scoped extension events.

#### Scenario: Missing host capability is explicit

- **GIVEN** a dynamic extension requests a host capability unavailable on the current daemon composition
- **WHEN** the host callback is invoked
- **THEN** the callback returns a typed unsupported status
- **AND** the extension command fails instead of reporting a fake successful native action.

### Requirement: Dynamic extension ABI SHALL use JSON payloads across C-compatible calls

The dynamic extension ABI SHALL keep Rust-specific types inside process boundaries. Commands sent to a dynamic extension SHALL cross the ABI as JSON bytes plus C-compatible metadata for scope and request context. Events returned by an extension SHALL cross back as JSON bytes and SHALL be re-scoped by the host before being emitted to clients.

Returned event buffers SHALL have explicit ownership. A dynamic extension that allocates a response buffer SHALL export a host-callable free function so the daemon can release extension-owned memory after parsing the JSON payload. Lease cleanup SHALL also cross the same C-compatible boundary so extension state does not survive client disconnects.

#### Scenario: Rust types do not cross ABI

- **GIVEN** a dynamic extension command is dispatched
- **WHEN** the daemon calls the extension ABI
- **THEN** the call uses C-compatible structures and byte buffers
- **AND** `Surface`, `Tray`, `Lease`, or kernel Rust structs are not passed across the library boundary.

#### Scenario: Dynamic extension owns and releases response buffers

- **GIVEN** a dynamic extension command returns event JSON
- **WHEN** the daemon parses the returned bytes
- **THEN** the daemon calls the extension-provided free function
- **AND** buffer ownership is not inferred from Rust allocator internals.

#### Scenario: Lease cleanup crosses the extension ABI

- **GIVEN** a lease owning extension state is closed
- **WHEN** the kernel dispatches lease cleanup
- **THEN** the daemon calls the extension lease cleanup symbol with C-compatible bytes
- **AND** any returned cleanup events use the same JSON event buffer contract.

### Requirement: Extension discovery SHALL be auditable

The daemon SHALL expose enough structured diagnostics to prove which extension candidate was selected or why no candidate was loaded. Diagnostics SHALL include the extension name, candidate search locations, selected path when successful, and typed failure category when unsuccessful. Diagnostics SHALL avoid leaking unrelated filesystem details.

#### Scenario: Missing extension reports candidate search

- **GIVEN** no dynamic library exists for a requested extension
- **WHEN** the daemon attempts to load the extension
- **THEN** it returns a structured `extension-not-found` style error
- **AND** the error includes the relevant package/user/env search categories.
