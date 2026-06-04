## MODIFIED Requirements

### Requirement: Backend adapters SHALL implement a shared SurfaceBackend contract

The system SHALL define a platform-agnostic `SurfaceBackend` contract for physical tray operations. The contract SHALL cover creation, icon updates, title/tooltip updates, menu projection updates, visibility, menu display where supported, backend-originated events, and physical tray-bounds retrieval where supported. Tray bounds SHALL be keyed by the durable tray identity tuple `(spaceId, trayId)`, not by surface id alone. Unsupported operations SHALL be expressed as capability absence or typed errors, not fake success.

If a backend can host multiple trays on one space, it SHALL be able to report bounds for the specific tray contribution that the caller names. Backends MAY keep deprecated internal surface-rect helpers during migration, but the durable capability contract SHALL be tray-scoped bounds.

#### Scenario: Capability absence is visible

- **GIVEN** a backend cannot return truthful bounds for a named tray
- **WHEN** the kernel or extension asks for that tray's bounds
- **THEN** the backend reports that the capability is unavailable or returns no bounds
- **AND** the caller can choose a documented fallback without assuming a fake rect.

#### Scenario: Tray bounds are resolved per tray identity

- **GIVEN** one space contains more than one tray contribution
- **WHEN** the backend is asked for bounds of one named tray
- **THEN** it resolves bounds for that `(spaceId, trayId)` pair
- **AND** it does not return an ambiguous surface-wide rect.

## ADDED Requirements

### Requirement: tray-icon backend SHALL expose tray-scoped native bounds honestly

The `tray-icon` backend SHALL resolve tray bounds from the native tray handle that corresponds to the projected `(spaceId, trayId)` pair. On platforms where the native runtime offers a truthful tray-rect API, the backend SHALL return that rect in the shared `Rect` shape. On platforms where the runtime does not offer a truthful tray-rect API, the backend SHALL return no bounds or a typed unsupported result rather than synthesizing geometry from cursor position, panel placement, or guessed defaults.

macOS and Windows tray-bounds behavior MAY use different native substrates, but the backend SHALL preserve one common tray-bounds contract. Linux SHALL keep explicit absence until a concrete backend proves a truthful tray-bounds path.

#### Scenario: macOS or Windows backend returns tray bounds

- **GIVEN** the native tray backend has a live tray handle for `(spaceId, trayId)`
- **AND** the current platform exposes truthful tray bounds for that handle
- **WHEN** the backend resolves tray bounds
- **THEN** it returns a `Rect` for that tray contribution
- **AND** the rect is associated with the same tray identity used by menu and primary-event routing.

#### Scenario: Unsupported tray bounds are not faked

- **GIVEN** the current platform or backend path cannot produce truthful tray bounds
- **WHEN** tray bounds are requested
- **THEN** the backend reports no bounds or typed unsupported capability
- **AND** it does not fabricate bounds from unrelated geometry.
