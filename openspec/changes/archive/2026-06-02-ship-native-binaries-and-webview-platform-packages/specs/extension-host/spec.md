## ADDED Requirements

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
