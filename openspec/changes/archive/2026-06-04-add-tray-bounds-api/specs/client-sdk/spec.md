## ADDED Requirements

### Requirement: Tray handles SHALL expose tray-bounds capability

The public TypeScript SDK SHALL expose tray bounds as a tray-owned capability on `TrayHandle`. The promoted backend API SHALL be `await tray.getBounds()`. The returned value SHALL be `Rect | null` in the public SDK mental model: a `Rect` when truthful tray bounds are available for the current tray, and `null` when the tray exists but no truthful bounds are available on the current backend path.

This capability SHALL remain tray-owned rather than WebView-owned. The SDK SHALL NOT require developers to go through `commandExtension("webview", ...)` or another extension-specific facade to query tray bounds for a tray they already own.

#### Scenario: Trusted backend code reads tray bounds

- **GIVEN** a developer has a `TrayHandle` for an existing tray contribution
- **WHEN** they call `await tray.getBounds()`
- **THEN** the SDK sends a broker-backed tray-bounds request for that tray identity
- **AND** it resolves to `Rect` when truthful bounds are available
- **AND** it resolves to `null` when the backend cannot provide truthful bounds.

#### Scenario: Tray-bounds API remains tray-owned

- **GIVEN** a developer inspects the public SDK surface
- **WHEN** they look for tray geometry
- **THEN** the capability exists on `TrayHandle`
- **AND** it is not modeled as `webview.tray.getBounds()` or another extension-owned API.

## MODIFIED Requirements

### Requirement: TypeScript SDK SHALL expose Space Tray Session public vocabulary

The `opentray` TypeScript package SHALL expose user-facing APIs in `Space / Tray / Session` vocabulary. The primary creation API SHALL be `createSpace`. The primary handle types SHALL be `SpaceHandle` and `TrayHandle`. Public daemon lifecycle and health APIs SHALL describe accepted client connections as sessions.

The same vocabulary rule SHALL apply to tray-owned capability helpers. Geometry, menu display, and other tray-scoped trusted operations SHALL live on `TrayHandle` rather than on `SpaceHandle` or extension-specific facades unless a later product story proves otherwise.

The SDK MAY keep alpha compatibility aliases such as `createSurface` and `SurfaceHandle`, but aliases SHALL be documented as deprecated and SHALL delegate to the new space API without creating a second concept.

#### Scenario: Developer creates a space through the primary API

- **GIVEN** a developer imports the public SDK from `opentray`
- **WHEN** they create a desktop aggregation boundary
- **THEN** the documented API is `createSpace`
- **AND** the returned handle is a `SpaceHandle`
- **AND** example code does not use `createSurface`.

#### Scenario: Tray-owned helper stays on TrayHandle

- **GIVEN** a developer needs the physical anchor of a tray contribution
- **WHEN** they inspect the typed SDK handles
- **THEN** the tray-bounds capability is exposed on `TrayHandle`
- **AND** it is not promoted to `SpaceHandle` where multiple trays would make the geometry ambiguous.

#### Scenario: Deprecated surface alias is not a parallel law

- **GIVEN** alpha compatibility keeps `createSurface`
- **WHEN** a developer calls the alias
- **THEN** it delegates to the same broker request path as `createSpace`
- **AND** docs mark the alias as deprecated
- **AND** no example teaches both names as equivalent first-class concepts.
