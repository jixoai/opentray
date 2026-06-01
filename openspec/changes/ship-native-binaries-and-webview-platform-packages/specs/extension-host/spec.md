## ADDED Requirements

### Requirement: Daemon SHALL load dynamic extensions through a generic host boundary

The daemon composition layer SHALL provide a generic dynamic extension loader that implements the existing extension host law. The loader SHALL resolve candidate libraries from package-adjacent platform artifacts, user config directories, and `OPENTRAY_EXT_PATH`. It SHALL validate required ABI symbols before registering the extension instance.

The loader SHALL be generic. It SHALL NOT branch on WebView product behavior in `opentray-core`, and it SHALL NOT grant native extensions direct access to kernel registries.

#### Scenario: Dynamic extension library is validated before registration

- **GIVEN** a client requests `load-ext` for an extension
- **WHEN** the daemon resolves a candidate dynamic library
- **THEN** it validates ABI version and required init, command, and deinit symbols
- **AND** it returns a structured error if validation fails
- **AND** it registers the extension only after validation succeeds.

### Requirement: Dynamic extension ABI SHALL use JSON payloads across C-compatible calls

The dynamic extension ABI SHALL keep Rust-specific types inside process boundaries. Commands sent to a dynamic extension SHALL cross the ABI as JSON bytes plus C-compatible metadata for scope and request context. Events returned by an extension SHALL cross back as JSON bytes and SHALL be re-scoped by the host before being emitted to clients.

#### Scenario: Rust types do not cross ABI

- **GIVEN** a dynamic extension command is dispatched
- **WHEN** the daemon calls the extension ABI
- **THEN** the call uses C-compatible structures and byte buffers
- **AND** `Surface`, `Tray`, `Lease`, or kernel Rust structs are not passed across the library boundary.

### Requirement: Extension discovery SHALL be auditable

The daemon SHALL expose enough structured diagnostics to prove which extension candidate was selected or why no candidate was loaded. Diagnostics SHALL include the extension name, candidate search locations, selected path when successful, and typed failure category when unsuccessful. Diagnostics SHALL avoid leaking unrelated filesystem details.

#### Scenario: Missing extension reports candidate search

- **GIVEN** no dynamic library exists for a requested extension
- **WHEN** the daemon attempts to load the extension
- **THEN** it returns a structured `extension-not-found` style error
- **AND** the error includes the relevant package/user/env search categories.
