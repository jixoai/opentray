# kernel-runtime Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Kernel SHALL own Surface Tray Lease laws

The Rust kernel SHALL implement `Surface`, `Tray`, and `Lease` as first-class domain entities. A `Surface` SHALL represent one broker-owned physical desktop entry. A `Tray` SHALL represent one client-owned contribution mounted onto exactly one surface. A `Lease` SHALL represent one client connection and SHALL be the only authority that can create, mutate, or destroy trays owned by that connection.

#### Scenario: Client disconnect releases owned trays

- **GIVEN** a client lease has mounted one or more trays
- **WHEN** the client transport disconnects or the lease is explicitly closed
- **THEN** the kernel removes every tray owned by that lease
- **AND** it does not remove trays owned by other leases on the same surface.

#### Scenario: Tray ids are scoped by surface and lease

- **GIVEN** two clients use the same requested `trayId`
- **WHEN** they mount trays onto the same broker
- **THEN** the kernel stores ownership as `(leaseId, surfaceId, trayId)`
- **AND** menu or tray events are routed only to the lease that owns the matching tuple.

### Requirement: Kernel SHALL aggregate tray contributions through surface projections

The kernel SHALL keep physical surface state separate from client tray declarations. A surface projection SHALL be derived from currently mounted trays and SHALL be the only data shape sent to a backend adapter. Non-owner trays SHALL remain isolated in their own top-level submenu unless an explicit surface-owner policy grants a custom region.

#### Scenario: Non-owner tray is isolated by default

- **GIVEN** a surface already exists for `appId` `com.example.host`
- **AND** a second client mounts a tray with `appId` `com.example.plugin`
- **WHEN** the kernel rebuilds the surface projection
- **THEN** the second tray appears as an isolated contribution
- **AND** it cannot mutate the host top-level layout without an explicit grant.

### Requirement: Kernel SHALL expose typed protocol frames

The kernel SHALL define newline-delimited JSON protocol frames in `opentray-spec` and SHALL share equivalent TypeScript types through `@opentray/spec`. Protocol models SHALL include surface creation, default surface resolution, tray creation/destruction, dynamic tray updates, backend-originated events, extension loading, extension commands, extension events, structured errors, protocol handshake, and protocol version metadata. Handshake frames SHALL use `protocolVersion` rather than ambiguous `version` naming.

#### Scenario: Protocol parse failure does not crash mixed output

- **GIVEN** a process transport receives malformed input
- **WHEN** the kernel fails to parse one frame
- **THEN** it emits a structured protocol error frame
- **AND** debug logs remain on stderr rather than stdout protocol output.

#### Scenario: Protocol handshake names protocol version explicitly

- **GIVEN** a client opens a broker transport
- **WHEN** it sends the first `init` frame
- **THEN** the frame includes `protocolVersion`
- **AND** it includes the client package or binary version separately from `protocolVersion`.

#### Scenario: Broker rejects incompatible protocol before lease creation

- **GIVEN** a client sends an `init` frame with a protocol version that the broker does not support
- **WHEN** the broker evaluates the handshake
- **THEN** it rejects the connection with a structured protocol error
- **AND** it does not create a lease for that connection.

### Requirement: Kernel SHALL stay independent from concrete backends and extensions

The kernel crate SHALL depend only on stable domain contracts and host traits. It MUST NOT import concrete backend crates, webview extension crates, npm package names, or platform binary package names. Concrete backends and extensions SHALL register through trait objects or explicit factories chosen by `opentray-bin`.

#### Scenario: Webview dispatch has no core special case

- **GIVEN** the kernel receives an `ext-command` frame with `ext` set to `webview`
- **WHEN** the extension is registered for the target surface or tray
- **THEN** the kernel dispatches through the extension registry
- **AND** no core handler branches on `ext == "webview"`.

### Requirement: Broker endpoint identity SHALL include package and protocol versions

The system SHALL derive local broker endpoint names from both the current package or binary version and the protocol version. Current-stage broker state SHALL be stored under `~/.opentray/<packageVersion>/`, and pipe or socket names SHALL carry the protocol version. Windows named pipes SHALL include both package version and protocol version in the named pipe string because named pipes do not live under the filesystem state root.

#### Scenario: Unix socket identity is version-scoped

- **GIVEN** the package version is `0.1.0`
- **AND** the protocol version is `1`
- **WHEN** the SDK or binary resolves the Unix socket path
- **THEN** the state root is `~/.opentray/0.1.0/`
- **AND** the socket file name includes protocol version `p1`.

#### Scenario: Windows pipe identity is version-scoped

- **GIVEN** the package version is `0.1.0`
- **AND** the protocol version is `1`
- **WHEN** the SDK or binary resolves the Windows named pipe
- **THEN** the pipe name includes package version `0.1.0`
- **AND** it includes protocol version `p1`.

#### Scenario: No cross-version endpoint reuse in current stage

- **GIVEN** `opentray@0.1.0` and `opentray@0.2.0` are installed in different projects
- **WHEN** each SDK resolves its broker endpoint
- **THEN** they produce different endpoint names
- **AND** neither SDK scans or reuses the other package version's broker state.

