## MODIFIED Requirements

### Requirement: Common resizable style contract

The WebView window style SHALL expose `resizable` as a common style field. `WebviewWindowStyle` SHALL report an effective boolean, `WebviewWindowStylePatch` and show options SHALL accept an optional boolean, `stylechange` SHALL report the effective style, and window capabilities SHALL declare whether the platform supports this user-resize intent. Every supported native platform SHALL serialize the same common `resizable` capability field in its native `WindowCapabilities` DTO. Programmatic `resizeTo()` and size-constraint APIs SHALL remain independent from `resizable`.

When `resizable` is omitted, a framed window SHALL be user-resizable and a frameless window SHALL not be user-resizable. Until an application explicitly sets `resizable`, changing `frameless` SHALL recompute that default. After an explicit `resizable` patch, later `frameless` patches SHALL preserve the explicit user-resize choice.

#### Scenario: macOS capability output declares resizable support

- **GIVEN** a macOS WebView page calls `navigator.window.getCapabilities()`
- **WHEN** the native extension serializes its common capability DTO
- **THEN** the payload contains `resizable: true`
- **AND** its field shape matches the common TypeScript capability contract.
