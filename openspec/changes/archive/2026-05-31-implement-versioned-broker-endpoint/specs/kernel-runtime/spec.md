## MODIFIED Requirements

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

## ADDED Requirements

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
