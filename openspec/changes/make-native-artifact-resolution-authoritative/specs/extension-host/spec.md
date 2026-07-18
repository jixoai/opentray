## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Daemon SHALL load dynamic extensions through a generic host boundary

**Reason**: The old requirement made the broker reconstruct package-manager topology from request package roots, which allowed unmanaged artifacts to shadow the facade dependency closure.

**Migration**: The replacement exact-artifact requirement keeps the generic host boundary but makes the SDK-resolved path and embedded identity authoritative. Diagnostic paths remain explicit candidates only.
