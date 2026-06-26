# kernel-runtime Specification Delta

## MODIFIED Requirements

### Requirement: Kernel SHALL own App Tray Session laws

The Rust kernel SHALL implement `App`, `Tray`, and `Session` as the public domain law for OpenTray runtime ownership. An `App` SHALL represent one broker-owned desktop status runtime scoped to exactly one caller session and identified by stable app identity plus human-readable app name. A `Tray` SHALL represent one client-owned status contribution mounted onto exactly one app runtime. A `Session` SHALL represent the single accepted caller connection for a broker and SHALL be the only public lifecycle authority that can create, mutate, or destroy trays owned by that connection.

A broker SHALL accept exactly one caller session over its lifetime for normal operation. The kernel SHALL NOT aggregate trays from multiple sessions onto a shared runtime; cross-session projection is not a kernel responsibility.

The v0.9 kernel and protocol SHALL NOT preserve public compatibility aliases for `Space`, `Surface`, or `Lease`. Any remaining internal authority type MUST be private implementation detail only and MUST NOT parse, emit, export, or document the removed public vocabulary.

#### Scenario: Client disconnect releases owned trays

- **GIVEN** the single client session has mounted one or more trays
- **WHEN** the client transport disconnects or the session is explicitly closed
- **THEN** the kernel removes every tray owned by that session
- **AND** the broker has no other session trays to preserve.

#### Scenario: Tray ids are scoped by app session

- **GIVEN** a client uses a requested tray `id`
- **WHEN** it mounts trays onto a broker
- **THEN** the kernel stores ownership keyed by the single caller session
- **AND** menu or tray events route to that session.

## ADDED Requirements

### Requirement: Kernel SHALL expose typed protocol frames with App Tray Session vocabulary

The kernel SHALL define newline-delimited JSON protocol frames in `opentray-spec` and SHALL share equivalent TypeScript types through `@opentray/spec`. Protocol models SHALL include tray creation, tray mutation, tray destruction, app identity metadata, backend-originated events, extension loading, extension commands, extension events, structured errors, protocol handshake, protocol version metadata, accepted session metadata, runtime host health, and request-correlated command responses. Handshake frames SHALL use `protocolVersion` rather than ambiguous `version` naming.

New public examples and public APIs SHALL use `app`, `tray`, and `session` frame/data names. `Space`, `surface`, and `spaceId` SHALL not appear as new public contract names.

#### Scenario: Protocol parse failure does not crash mixed output

- **GIVEN** a process transport receives malformed input
- **WHEN** the kernel fails to parse one frame
- **THEN** it emits a structured protocol error frame
- **AND** debug logs remain on stderr rather than stdout protocol output.

#### Scenario: Protocol handshake names protocol version explicitly

- **GIVEN** a client opens a runtime host transport
- **WHEN** it sends the first `init` frame
- **THEN** the frame includes `protocolVersion`
- **AND** it includes app identity or caller metadata separately from `protocolVersion`.

### Requirement: Kernel SHALL route tray commands without a shared app projection step

The kernel SHALL translate accepted client command frames into `opentray-core::Kernel` operations without deriving a multi-session projection. Tray creation, tray mutation, tray destruction, lease cleanup, extension commands, and backend-originated events SHALL use kernel ownership checks keyed by session authority and tray identity rather than reimplementing policy in the transport layer.

#### Scenario: Create tray dispatches without shared projection

- **GIVEN** an accepted client session sends `create-tray`
- **WHEN** the kernel processes the request
- **THEN** it creates the tray under the caller's app runtime
- **AND** the request does not need a shared space projection.

#### Scenario: Tray bounds stay tray-scoped

- **GIVEN** a client asks for tray geometry
- **WHEN** the kernel evaluates the request
- **THEN** the lookup is authorized by the same session authority that owns the tray
- **AND** the kernel does not synthesize a fake shared runtime rect.
