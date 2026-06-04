## MODIFIED Requirements

### Requirement: Kernel SHALL aggregate tray contributions through space projections

The kernel SHALL keep physical desktop aggregation state separate from client tray declarations. A space projection SHALL be derived from currently mounted trays and SHALL be the only data shape sent to a backend adapter. Non-owner trays SHALL remain isolated in their own top-level submenu unless an explicit space-owner policy grants a custom region.

During alpha migration, backend implementation types MAY keep `SurfaceProjection` names only as deprecated internal aliases. New public protocol, docs, and SDK APIs SHALL use `Space` terminology.

Tray geometry SHALL still remain tray-owned even when backend synchronization is space-projection-based. When a caller asks for bounds of a tray contribution, the kernel SHALL route that lookup by the durable tray identity `(spaceId, trayId)` and SHALL NOT collapse multiple trays on one space into a single ambiguous rect.

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

#### Scenario: Tray bounds stay tray-scoped inside a shared space

- **GIVEN** a space has two trays with different tray ids
- **WHEN** the kernel routes a tray-bounds lookup
- **THEN** it validates the named tray exists
- **AND** it asks the backend for bounds of that tray identity rather than returning one shared surface rect.

## ADDED Requirements

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
