# kernel-runtime Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Kernel SHALL own Space Tray Session laws

The Rust kernel SHALL implement `Space`, `Tray`, and `Session` as the public domain law for OpenTray runtime ownership. A `Space` SHALL represent one broker-owned desktop boundary scoped to exactly one caller session. A `Tray` SHALL represent one client-owned status contribution mounted onto exactly one space. A `Session` SHALL represent the single accepted caller connection for a broker and SHALL be the only public lifecycle authority that can create, mutate, or destroy trays owned by that connection.

A broker SHALL accept exactly one caller session over its lifetime for normal operation. The kernel SHALL NOT aggregate trays from multiple sessions onto a shared space; cross-session projection is no longer a kernel responsibility.

The kernel MAY keep an internal `Lease` authority type during alpha migration, but that name SHALL NOT be introduced as a new public TypeScript API, daemon-health vocabulary, or user documentation concept. If an internal lease remains, it SHALL map one-to-one to a public session and SHALL preserve the same cleanup semantics.

#### Scenario: Client disconnect releases owned trays

- **GIVEN** the single client session has mounted one or more trays
- **WHEN** the client transport disconnects or the session is explicitly closed
- **THEN** the kernel removes every tray owned by that session
- **AND** the broker has no other session trays to preserve.

#### Scenario: Tray ids are scoped by session

- **GIVEN** a client uses a requested `trayId`
- **WHEN** it mounts trays onto a broker
- **THEN** the kernel stores ownership keyed by the single caller session
- **AND** menu or tray events route to that session.

#### Scenario: Second caller does not reuse a broker session

- **GIVEN** a broker is already serving one caller session
- **WHEN** a second caller attempts to connect to the same endpoint
- **THEN** the connection is rejected with a typed protocol error
- **AND** the second caller is directed to its own per-caller endpoint.

#### Scenario: Internal lease does not leak as public law

- **GIVEN** the Rust implementation keeps an internal lease identifier for ownership checks
- **WHEN** public TypeScript types, examples, daemon health output, or docs are generated
- **THEN** they use session vocabulary
- **AND** they do not teach `Lease` as a public OpenTray concept.

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

### Requirement: Broker sessions SHALL create leases only after compatible init

The broker runtime SHALL treat `init { protocolVersion, clientVersion }` as the session gate. A connection SHALL NOT receive a lease and SHALL NOT mutate kernel state until the broker has accepted a supported protocol version. The accepted session SHALL carry a broker-issued `leaseId` that is used for every command dispatched into the kernel.

#### Scenario: Compatible init creates lease

- **GIVEN** a client connects to the versioned broker endpoint
- **WHEN** it sends `init` with the supported `protocolVersion`
- **THEN** the broker accepts the session
- **AND** it returns the broker `protocolVersion`, broker package version, and a `leaseId`.

#### Scenario: Incompatible init has no lease side effect

- **GIVEN** a client connects to the versioned broker endpoint
- **WHEN** it sends `init` with an unsupported `protocolVersion`
- **THEN** the broker returns a structured protocol error
- **AND** it does not create a lease
- **AND** no kernel surface or tray state is mutated for that connection.

### Requirement: Broker sessions SHALL dispatch client commands through Kernel authority

The broker runtime SHALL translate accepted client command frames into `opentray-core::Kernel` operations. Surface creation, tray creation, tray mutation, tray destruction, lease cleanup, extension commands, and backend-originated events SHALL use kernel ownership checks rather than reimplementing policy in the transport layer.

#### Scenario: Create tray dispatches through kernel and backend projection

- **GIVEN** a client session has an accepted lease
- **AND** the session has created a surface
- **WHEN** the client sends `create-tray`
- **THEN** the broker calls the kernel with the session `leaseId`
- **AND** the kernel derives a `SurfaceProjection`
- **AND** the selected backend receives that projection.

#### Scenario: Command before init is rejected

- **GIVEN** a client connection has not completed compatible `init`
- **WHEN** it sends `create-surface`, `create-tray`, `set-tray-menu`, or `ext-command`
- **THEN** the broker returns a structured protocol error
- **AND** the kernel is not mutated.

### Requirement: Protocol responses SHALL be request-correlated

Client command frames that expect a broker response SHALL carry a `requestId`. The matching success response or structured error SHALL include the same `requestId`. Broker-originated event frames SHALL remain event frames and SHALL NOT be confused with command acknowledgements.

#### Scenario: Surface creation returns correlated broker identity

- **GIVEN** an accepted client session sends `create-surface` with `requestId` `req-1`
- **WHEN** the kernel creates the surface
- **THEN** the broker returns `surface-created` with `requestId` `req-1`
- **AND** the frame includes the broker-issued `SurfaceRef`.

#### Scenario: Native event does not consume a pending request

- **GIVEN** a client has a pending command request
- **WHEN** a native tray menu event arrives for a tray owned by the same lease
- **THEN** the broker sends an `event` frame
- **AND** it does not use the pending command `requestId`
- **AND** the pending command remains correlated only to its command response or error.

### Requirement: Kernel SHALL route tray-bounds lookups through tray authority

The kernel SHALL treat tray-bounds lookup as a trusted tray capability. A tray-bounds query SHALL be authorized by the same session authority that owns the tray and SHALL be routed by `(session authority, spaceId, trayId)`. The kernel SHALL reject queries for trays the caller does not own. The kernel SHALL NOT interpret tray bounds as a WebView-specific feature, and it SHALL NOT synthesize tray geometry on its own.

#### Scenario: Owner can query tray bounds

- **GIVEN** a client session owns tray `status` on space `space-1`
- **WHEN** that session asks for tray bounds of `space-1/status`
- **THEN** the kernel authorizes the request
- **AND** it routes the lookup to the selected backend for that tray identity.

#### Scenario: Non-owner cannot query tray bounds

- **GIVEN** tray `status` on `space-1` is owned by session `a`
- **WHEN** session `b` asks for bounds of `space-1/status`
- **THEN** the kernel rejects the request using the existing ownership law
- **AND** it does not leak tray geometry across sessions.

### Requirement: Kernel SHALL pass through a single session's trays to the backend

The kernel SHALL send backend adapters the trays of the single caller session directly, without a derived multi-session projection step. The backend SHALL receive per-tray declaration state owned by that session. The kernel SHALL NOT perform non-owner isolation, region grants, or projection rebuilding across sessions, because no second session exists within a broker.

#### Scenario: Backend receives the single session's trays

- **GIVEN** the single caller session has mounted trays
- **WHEN** backend synchronization runs
- **THEN** the backend receives exactly that session's tray declarations
- **AND** no cross-session aggregation or non-owner isolation logic runs.

#### Scenario: Primary role remains menu data

- **GIVEN** a tray menu contains a primary item
- **WHEN** the backend is driven
- **THEN** the primary role remains part of the menu declaration
- **AND** backend-originated activation routes as `menuClick`
- **AND** the kernel does not expose a new `trayPrimaryClick` event.

