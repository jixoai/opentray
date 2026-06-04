## MODIFIED Requirements

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
