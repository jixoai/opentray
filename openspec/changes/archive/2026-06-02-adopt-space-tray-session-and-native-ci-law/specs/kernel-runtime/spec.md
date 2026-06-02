## MODIFIED Requirements

### Requirement: Kernel SHALL own Space Tray Session laws

The Rust kernel SHALL implement `Space`, `Tray`, and `Session` as the public domain law for OpenTray runtime ownership. A `Space` SHALL represent one broker-owned desktop aggregation boundary. A `Tray` SHALL represent one client-owned status contribution mounted onto exactly one space. A `Session` SHALL represent one accepted client connection and SHALL be the only public lifecycle authority that can create, mutate, or destroy trays owned by that connection.

The kernel MAY keep an internal `Lease` authority type during alpha migration, but that name SHALL NOT be introduced as a new public TypeScript API, daemon-health vocabulary, or user documentation concept. If an internal lease remains, it SHALL map one-to-one to a public session and SHALL preserve the same cleanup semantics.

#### Scenario: Client disconnect releases owned trays

- **GIVEN** a client session has mounted one or more trays
- **WHEN** the client transport disconnects or the session is explicitly closed
- **THEN** the kernel removes every tray owned by that session
- **AND** it does not remove trays owned by other sessions on the same space.

#### Scenario: Tray ids are scoped by space and session

- **GIVEN** two clients use the same requested `trayId`
- **WHEN** they mount trays onto the same broker
- **THEN** the kernel stores ownership as `(session authority, spaceId, trayId)`
- **AND** menu or tray events are routed only to the session that owns the matching tuple.

#### Scenario: Internal lease does not leak as public law

- **GIVEN** the Rust implementation keeps an internal lease identifier for ownership checks
- **WHEN** public TypeScript types, examples, daemon health output, or docs are generated
- **THEN** they use session vocabulary
- **AND** they do not teach `Lease` as a public OpenTray concept.

### Requirement: Kernel SHALL aggregate tray contributions through space projections

The kernel SHALL keep physical desktop aggregation state separate from client tray declarations. A space projection SHALL be derived from currently mounted trays and SHALL be the only data shape sent to a backend adapter. Non-owner trays SHALL remain isolated in their own top-level submenu unless an explicit space-owner policy grants a custom region.

During alpha migration, backend implementation types MAY keep `SurfaceProjection` names only as deprecated internal aliases. New public protocol, docs, and SDK APIs SHALL use `Space` terminology.

#### Scenario: Non-owner tray is isolated by default

- **GIVEN** a space already exists for `id` `com.example.host`
- **AND** a second client mounts a tray with `id` `com.example.plugin`
- **WHEN** the kernel rebuilds the space projection
- **THEN** the second tray appears as an isolated contribution
- **AND** it cannot mutate the host top-level layout without an explicit grant.

#### Scenario: Backend receives one projection law

- **GIVEN** the kernel has trays from multiple sessions mounted onto one space
- **WHEN** backend synchronization runs
- **THEN** the backend receives one kernel-derived projection for that space
- **AND** the backend does not receive per-client private tray state that would bypass session ownership checks.

### Requirement: Kernel SHALL expose typed protocol frames with Space Tray Session vocabulary

The kernel SHALL define newline-delimited JSON protocol frames in `opentray-spec` and SHALL share equivalent TypeScript types through `@opentray/spec`. Protocol models SHALL include space creation, default space resolution, tray creation/destruction, dynamic tray updates, backend-originated events, extension loading, extension commands, extension events, structured errors, protocol handshake, protocol version metadata, accepted session metadata, daemon health, and request-correlated command responses. Handshake frames SHALL use `protocolVersion` rather than ambiguous `version` naming.

Existing alpha `surface` and `lease` frame names MAY be retained only as explicitly deprecated compatibility aliases. New examples and new public APIs SHALL use `space` and `session` frame/data names.

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

#### Scenario: Broker rejects incompatible protocol before session creation

- **GIVEN** a client sends an `init` frame with a protocol version that the broker does not support
- **WHEN** the broker evaluates the handshake
- **THEN** it rejects the connection with a structured protocol error
- **AND** it does not create a session for that connection.

#### Scenario: Command response carries request identity

- **GIVEN** a client sends a command frame with `requestId`
- **WHEN** the broker completes or rejects that command
- **THEN** the returned success frame or error frame includes the same `requestId`.

## RENAMED Requirements

FROM: `Kernel SHALL own Surface Tray Lease laws`
TO: `Kernel SHALL own Space Tray Session laws`

FROM: `Kernel SHALL aggregate tray contributions through surface projections`
TO: `Kernel SHALL aggregate tray contributions through space projections`
