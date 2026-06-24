# kernel-runtime Specification Delta

## REMOVED Requirements

### Requirement: Kernel SHALL aggregate tray contributions through space projections

The kernel SHALL keep physical desktop aggregation state separate from client tray declarations. A space projection SHALL be derived from currently mounted trays and SHALL be the only data shape sent to a backend adapter. Non-owner trays SHALL remain isolated in their own top-level submenu unless an explicit space-owner policy grants a custom region.

During alpha migration, backend implementation types MAY keep `SurfaceProjection` names only as deprecated internal aliases. New public protocol, docs, and SDK APIs SHALL use `Space` terminology.

Primary menu item roles SHALL remain menu declaration data inside the projection. The kernel SHALL NOT interpret platform primary-click behavior, SHALL NOT choose Windows or macOS click gestures, and SHALL NOT emit a separate primary event type. If a backend activates a primary menu item, the kernel SHALL route it as the existing `menuClick` event for the owning session.

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

#### Scenario: Primary role does not create a kernel event family

- **GIVEN** a tray menu contains a primary item
- **WHEN** the kernel projects that tray to a backend
- **THEN** the primary role remains part of the menu projection
- **AND** backend-originated activation of that item routes as `menuClick`
- **AND** the kernel does not expose a new `trayPrimaryClick` event.

## MODIFIED Requirements

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

## ADDED Requirements

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
