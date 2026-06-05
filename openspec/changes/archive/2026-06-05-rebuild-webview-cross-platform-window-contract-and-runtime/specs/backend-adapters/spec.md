## MODIFIED Requirements

### Requirement: Backend adapters SHALL implement a shared SurfaceBackend contract

The system SHALL define a platform-agnostic `SurfaceBackend` contract for physical tray operations. The contract SHALL cover creation, icon updates, title/tooltip updates, menu projection updates, visibility, menu display where supported, backend-originated events, and tray placement retrieval where supported. Tray placement SHALL be keyed by the durable tray identity tuple `(spaceId, trayId)`, not by surface id alone.

Unsupported tray placement SHALL remain explicit as capability absence or an unavailable result path. The contract MUST NOT fabricate a tray rectangle for an unrelated tray contribution.

#### Scenario: Capability absence is visible

- **GIVEN** a backend cannot return a usable tray placement for a named tray
- **WHEN** the kernel or extension asks for that tray's placement
- **THEN** the backend reports that the capability is unavailable
- **AND** the broker projection preserves that absence through an unavailable tray result instead of fake certainty.

#### Scenario: Tray placement is resolved per tray identity

- **GIVEN** one space contains more than one tray contribution
- **WHEN** the backend is asked for placement of one named tray
- **THEN** it resolves placement for that `(spaceId, trayId)` pair
- **AND** it does not return an ambiguous surface-wide rect.

### Requirement: tray-icon backend SHALL expose tray-scoped native bounds honestly

The `tray-icon` backend SHALL resolve tray geometry from the native tray handle that corresponds to the projected `(spaceId, trayId)` pair. On platforms where the native runtime offers a truthful tray-rect API, the backend SHALL return that rect as a truthful result. On platforms where the runtime does not offer a truthful tray-rect API, the backend SHALL preserve explicit capability absence instead of synthesizing a fake authoritative rect.

#### Scenario: macOS or Windows backend returns truthful tray bounds

- **GIVEN** the native tray backend has a live tray handle for `(spaceId, trayId)`
- **AND** the current platform exposes truthful tray bounds for that handle
- **WHEN** the backend resolves tray geometry
- **THEN** it returns a truthful rect for that tray contribution
- **AND** the rect is associated with the same tray identity used by menu and primary-event routing.
