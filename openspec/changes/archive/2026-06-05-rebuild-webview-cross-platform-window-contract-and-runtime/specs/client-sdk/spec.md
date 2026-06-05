## ADDED Requirements

### Requirement: Tray placement result SHALL carry provenance in the public SDK

The public TypeScript SDK SHALL expose tray placement through a durable result shape that can represent authoritative native bounds, future inferred placement, and unavailable placement. This result shape SHALL be tray-owned and SHALL be reusable by both trusted host code and page projections.

The result SHALL carry at least the resolved rectangle when available, a provenance kind, and a source identifier or equivalent explanation of how the result was obtained.

#### Scenario: Trusted host code can tell whether tray placement is authoritative

- **GIVEN** a developer has a `TrayHandle` for an existing tray contribution
- **WHEN** they call the tray placement API
- **THEN** the result tells them whether the returned rectangle is authoritative or unavailable through `kind`
- **AND** host code does not have to infer that distinction from `null` versus non-`null` alone.

## MODIFIED Requirements

### Requirement: Tray handles SHALL expose tray-bounds capability

The public TypeScript SDK SHALL expose tray placement as a tray-owned capability on `TrayHandle`. The promoted backend API SHALL remain `await tray.getBounds()` for this change, but the returned value SHALL be a richer tray-placement result rather than bare `Rect | null`.

This capability SHALL remain tray-owned rather than WebView-owned. The SDK SHALL NOT require developers to go through `commandExtension("webview", ...)` or another extension-specific facade to query tray placement for a tray they already own.

#### Scenario: Trusted backend code reads tray placement with provenance

- **GIVEN** a developer has a `TrayHandle` for an existing tray contribution
- **WHEN** they call `await tray.getBounds()`
- **THEN** the SDK sends a broker-backed tray placement request for that tray identity
- **AND** it resolves to a result that states placement provenance through `kind` and `source`
- **AND** the result includes the resolved rectangle when one exists.

#### Scenario: Tray placement API remains tray-owned

- **GIVEN** a developer inspects the public SDK surface
- **WHEN** they look for tray geometry
- **THEN** the capability exists on `TrayHandle`
- **AND** it is not modeled as `webview.tray.getBounds()` or another extension-owned API.
