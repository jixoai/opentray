## ADDED Requirements

### Requirement: Extension host SHALL be a kernel law

The kernel SHALL provide an extension host contract that loads, registers, commands, and unloads extension instances scoped to a surface and optionally a tray. Extension instances SHALL communicate with the kernel only through host callbacks and extension command/event payloads.

#### Scenario: Extension cannot mutate unrelated tray state

- **GIVEN** a webview extension instance is attached to `(surfaceA, trayA)`
- **WHEN** it emits a command or event
- **THEN** the host scopes that message to `(surfaceA, trayA, extName)`
- **AND** the extension cannot mutate `(surfaceA, trayB)` or `(surfaceB, trayA)` without an explicit host-authorized command.

### Requirement: Dynamic extension ABI SHALL be stable and C-compatible

The extension ABI SHALL use `extern "C"` functions and C-compatible structures for dynamic libraries. Rust-specific types SHALL NOT cross the dynamic library boundary. JSON command payloads MAY be used inside ABI functions to keep the binary ABI stable while TypeScript/Rust schemas evolve.

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
