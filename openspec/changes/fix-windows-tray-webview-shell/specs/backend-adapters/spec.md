<!--
Orthogonal intents (2026-07-14, user input):
1. Render Windows tray RGBA icons visibly.
2. Keep registration and bounds-query identity consistent.
3. Preserve tray-authoritative placement provenance.
-->

## ADDED Requirements

### Requirement: Windows native tray registration and bounds query SHALL share one identity

The Windows tray adapter SHALL use the same notification-icon identity for add, modify, delete, event routing, and `Shell_NotifyIconGetRect`. A process-local numeric id SHALL NOT be promoted into a durable cross-application GUID. If GUID identity is introduced later, it SHALL derive from durable OpenTray `(appId, trayId)` identity and SHALL be supplied to every shell operation that addresses the icon.

#### Scenario: Registered tray icon returns native bounds

- **GIVEN** a Windows tray icon has been registered successfully
- **WHEN** its owning session calls `TrayHandle.getBounds()`
- **THEN** the adapter queries the same shell identity used at registration
- **AND** returns a non-zero native tray rectangle when Explorer exposes one.

#### Scenario: Different apps cannot collide through process-local ids

- **GIVEN** two OpenTray applications each create their first tray icon
- **WHEN** Windows shell identities are assigned
- **THEN** one application's add, update, delete, or bounds query cannot address the other application's icon.

### Requirement: Windows tray RGBA projection SHALL preserve visible alpha

The Windows tray icon conversion SHALL preserve fully and partially visible RGBA pixels when creating the native icon mask. Only pixels with zero alpha MAY be marked fully transparent by the monochrome mask; anti-aliased edge pixels SHALL remain available to the color bitmap alpha channel. This correction SHALL remain isolated to the native tray dependency boundary.

#### Scenario: Anti-aliased PNG renders in the notification area

- **GIVEN** a tray icon contains opaque center pixels and partially transparent anti-aliased edges
- **WHEN** the Windows native icon is created
- **THEN** the center and edges remain visible in the notification area or overflow panel
- **AND** fully transparent pixels remain transparent.

### Requirement: Tray placement SHALL not hide identity failure behind screen center

The backend SHALL return native tray bounds whenever the registered shell icon can be addressed. The WebView placement layer MAY retain its existing honest fallback behavior, but a registration/query identity mismatch SHALL be treated as a backend regression rather than a valid screen-center placement result.

#### Scenario: Tray placement uses native provenance after icon registration

- **GIVEN** a Windows tray icon is visible and exposes shell bounds
- **WHEN** `WebviewPlacementKit` resolves `placement: tray`
- **THEN** the result uses native tray provenance
- **AND** the target window is positioned relative to the tray rectangle rather than screen center.
