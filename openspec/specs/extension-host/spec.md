# extension-host Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Kernel SHALL provide an extension host contract scoped to a tray and app runtime

The kernel SHALL provide an extension host contract that loads, registers, commands, and unloads extension instances scoped to a tray and the owning app runtime. Extension instances SHALL communicate with the kernel only through host callbacks and extension command/event payloads keyed by app runtime identity and tray identity. `Space`, `surface`, and `Lease` SHALL not cross the public extension boundary as new concepts.

Dynamic extension cleanup SHALL use session vocabulary at the host contract and ABI symbol boundary. Official extensions SHALL export `opentray_ext_session_closed`, not a lease-named cleanup symbol.

#### Scenario: Extension message stays tray scoped

- **GIVEN** an extension instance is attached to a tray
- **WHEN** it sends a message
- **THEN** the host scopes that message to the owning app runtime and tray
- **AND** the extension cannot mutate a sibling tray without an explicit host-authorized command.

#### Scenario: Extension boundary stays free of space terms

- **GIVEN** a developer inspects the public extension host API
- **WHEN** they read the type surface
- **THEN** they see tray and app runtime concepts
- **AND** they do not need to reason about `Surface` or `Space` to understand scope.

### Requirement: Dynamic extension ABI SHALL be stable and C-compatible

The extension ABI SHALL use `extern "C"` functions and C-compatible structures for dynamic libraries. Rust-specific types SHALL NOT cross the dynamic library boundary. JSON command payloads MAY be used inside ABI functions to keep the binary ABI stable while TypeScript/Rust schemas evolve.

Every dynamic extension SHALL export a required manifest symbol before init. The symbol SHALL return extension-owned JSON describing `extensionName`, `abiVersion`, `artifactSetVersion`, `contractFingerprint`, target operating system/architecture, and `buildIdentity`. The broker SHALL validate and free this manifest through generic ABI operations before calling init.

The ABI SHALL provide structured extension-owned error JSON when init, command, or session cleanup returns a non-success result. The error SHALL preserve a stable category and actionable message; a numeric result code alone is insufficient.

The ABI SHALL be strong enough for an official extension to own its entire native runtime internally. The daemon SHALL NOT pass Rust event-loop, window, backend, WebView, or official-extension-specific parser objects across the ABI boundary in order to make a released extension function.

#### Scenario: Dynamic library exports required symbols

- **GIVEN** an extension shared library is loaded
- **WHEN** the extension host validates it
- **THEN** it requires manifest, init, command, session cleanup, deinit, and free symbols
- **AND** it rejects the library with a structured error if any required symbol is missing.

#### Scenario: Manifest is read before init

- **GIVEN** a dynamic library exists at the exact requested path
- **WHEN** its embedded identity does not equal the expected extension identity
- **THEN** the broker rejects it before init
- **AND** no native extension state is created.

#### Scenario: Extension rejection preserves native detail

- **GIVEN** an extension rejects a validly transported command with a native reason
- **WHEN** the broker returns the failure to the SDK
- **THEN** the error includes the extension category and message
- **AND** it does not collapse the failure to `returned code 1`.

### Requirement: Internal extension adapter MAY bootstrap P0 only if it uses the same host contract

The implementation MAY start with an internal Rust extension adapter for local development, but only if that adapter exercises the same `ExtensionHost` command/event contract as dynamic libraries. P0 code SHALL keep the dynamic ABI spec present and tested at the host boundary.

#### Scenario: Internal adapter does not get core privileges

- **GIVEN** a P0 internal webview adapter is registered without dynamic loading
- **WHEN** it sends events or receives commands
- **THEN** it still goes through the extension registry and host callbacks
- **AND** it does not import or mutate kernel registries directly.

### Requirement: Extension discovery SHALL be explicit and auditable

The normal package-facade path SHALL arrive at the daemon as one exact native library path resolved by the TypeScript SDK plus an expected embedded identity. The daemon SHALL validate that path and SHALL NOT scan package-manager directories for a replacement.

Explicit diagnostic candidates from `OPENTRAY_EXT_PATH`, source-development configuration, or user extension directories MAY be evaluated in documented order. Each candidate SHALL be classified as missing, unreadable, ABI-incompatible, identity-incompatible, or loadable. Identity-incompatible candidates SHALL never be initialized. When a diagnostic candidate set permits fallback, the loader SHALL continue after a mismatch and select only a compatible artifact.

#### Scenario: Extension path resolution is deterministic

- **GIVEN** the SDK resolved an official platform package from the facade dependency closure
- **WHEN** the broker receives `load-ext`
- **THEN** it evaluates only the exact library path for the normal package path
- **AND** reports that selected path and verified identity.

#### Scenario: Diagnostic candidates retain rejection evidence

- **GIVEN** an explicit diagnostic candidate list contains an old artifact followed by a compatible artifact
- **WHEN** the broker resolves the extension
- **THEN** it records the old artifact's identity mismatch without initializing it
- **AND** loads the later compatible artifact.

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

The dynamic extension ABI SHALL keep Rust-specific types inside process boundaries. Commands sent to a dynamic extension SHALL cross the ABI as JSON bytes plus C-compatible metadata for scope and request context. Events, manifest identity, and structured errors returned by an extension SHALL cross back as extension-owned JSON byte buffers.

Returned buffers SHALL have explicit ownership. The dynamic extension SHALL export a host-callable free function used for event, manifest, and error buffers. Session cleanup SHALL cross the same C-compatible boundary so extension state does not survive client disconnects.

#### Scenario: Rust types do not cross ABI

- **GIVEN** a dynamic extension command is dispatched
- **WHEN** the daemon calls the extension ABI
- **THEN** the call uses C-compatible structures and byte buffers
- **AND** kernel Rust structs are not passed across the library boundary.

#### Scenario: Dynamic extension owns and releases response buffers

- **GIVEN** an extension returns manifest, event, or error JSON
- **WHEN** the daemon consumes the bytes
- **THEN** the daemon calls the extension-provided free function
- **AND** buffer ownership is not inferred from Rust allocator internals.

#### Scenario: Lease cleanup crosses the extension ABI

- **GIVEN** session cleanup fails inside an extension
- **WHEN** the host receives the non-success result
- **THEN** it reads and frees the structured extension error
- **AND** reports its category and message through the generic kernel error path.

### Requirement: Extension discovery SHALL be auditable

The daemon SHALL expose enough structured diagnostics to prove which extension candidate was selected or why no candidate was loaded. Diagnostics SHALL include the extension name, candidate search locations, selected path when successful, and typed failure category when unsuccessful. Diagnostics SHALL avoid leaking unrelated filesystem details.

#### Scenario: Missing extension reports candidate search

- **GIVEN** no dynamic library exists for a requested extension
- **WHEN** the daemon attempts to load the extension
- **THEN** it returns a structured `extension-not-found` style error
- **AND** the error includes the relevant package/user/env search categories.

### Requirement: Extension host SHALL separate extension identity from mount identity

The generic `load-ext` request SHALL support an optional `mountId`. The extension `name` and `path` SHALL continue to identify the package/native library to resolve. The `mountId`, when present, SHALL identify the registered command endpoint for that loaded instance.

The extension host registry SHALL dispatch `ext-command.ext` to the mounted instance id. If `mountId` is absent, the host SHALL preserve the previous behavior and register the instance under `name`.

#### Scenario: Same extension package mounts twice inside one space

- **GIVEN** a client loads `name: "webview"` with `mountId: "webview.tray-a"`
- **AND** the same client loads `name: "webview"` with `mountId: "webview.tray-b"`
- **WHEN** commands are sent to each mount id
- **THEN** they dispatch to separate extension instances
- **AND** dynamic library discovery still uses `name: "webview"` rather than either mount id.

#### Scenario: Legacy load without mount id keeps old command endpoint

- **GIVEN** a client sends `load-ext` with `name: "webview"` and no `mountId`
- **WHEN** it sends `ext-command` with `ext: "webview"`
- **THEN** the command dispatches to the loaded instance under the legacy endpoint.

### Requirement: Extensions SHALL bind through the runtime host rather than a public daemon API

The extension host contract SHALL assume a runtime-host-bound app context. It SHALL not require a public daemon object or broker concept to exist in the developer API. The runtime host MAY still load native extension artifacts internally, but that is an implementation detail behind the tray/app runtime boundary.

#### Scenario: Extension loading does not expose daemon ownership

- **GIVEN** an application loads an extension
- **WHEN** the extension is mounted on a tray
- **THEN** the extension sees the tray/app runtime boundary
- **AND** it does not require a public daemon object to describe the host.

### Requirement: Daemon SHALL validate exact dynamic extensions through a generic host boundary

The daemon composition layer SHALL provide a generic dynamic extension loader that implements the existing extension host law. For normal facade loading, the loader SHALL accept an exact library path and expected generic identity from `load-ext`. For explicit diagnostic/custom discovery, it MAY evaluate configured candidate paths. It SHALL validate the embedded manifest, ABI version, required symbols, target, and expected contract before registering the extension instance.

The loader SHALL be generic. It SHALL NOT branch on WebView, Badge, Lynx, or other product command behavior in `opentray-core` or the broker, and it SHALL NOT grant native extensions direct access to kernel registries.

#### Scenario: Dynamic extension library is validated before registration

- **GIVEN** a client requests `load-ext` with an exact artifact and expected identity
- **WHEN** the daemon opens the dynamic library
- **THEN** it validates required symbols and the full embedded identity before init
- **AND** it returns a structured error if validation fails
- **AND** it registers the extension only after validation and init succeed.

#### Scenario: Broker remains extension agnostic

- **GIVEN** WebView, Badge, and Lynx publish different contract fingerprints
- **WHEN** the broker validates their manifests
- **THEN** it compares the same generic identity fields for each
- **AND** it never parses their product command schemas.
