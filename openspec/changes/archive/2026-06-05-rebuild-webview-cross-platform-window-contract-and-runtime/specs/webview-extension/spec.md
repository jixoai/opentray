## ADDED Requirements

### Requirement: Webview cross-platform window contract SHALL separate common and platform-specific capability families

The WebView extension SHALL keep the common page/window contract limited to capabilities with stable cross-platform meaning: lifecycle, title/icon metadata, frameless shell intent, transparent shell intent, keep-on-top intent, overlay, drag, geometry, window-state controls, screen details, tray placement access, and capability-policy gating.

Platform-native appearance substrate and desktop-standard-specific behavior SHALL live under explicit platform families instead of the common `style` bag. The durable family names for this change SHALL be `platform.macos`, `platform.windows`, and `platform.linux`, nested under the owning host option group and the owning page capability object.

Capability metadata SHALL describe both the common contract and the current platform family surface so callers can reason about truthful support without guessing from the OS name alone.

#### Scenario: Common and platform APIs stop collapsing into one style bag

- **GIVEN** a developer configures a WebView window for a specific desktop platform
- **WHEN** they inspect the host options or page capability object
- **THEN** common shell traits live in the common contract
- **AND** macOS-, Windows-, and Linux-specific material or corner controls live under the matching `platform.<family>` namespace
- **AND** the extension does not present platform-private nouns as universal style fields.

### Requirement: Webview official guidance SHALL teach the nested platform-family contract truthfully

The official `@opentray/ext-webview` README, CLI example docs, and repo skills SHALL teach material, corner, and tray-placement usage through the same nested platform-family contract that the public TypeScript surface exports.

The examples SHALL show provenance-bearing tray placement results and SHALL avoid reviving retired flat fields such as a top-level `backgroundEffect` or `cornerRadius` on the common style object.

#### Scenario: Docs and examples use the same contract the runtime exports

- **GIVEN** a developer follows the official docs or examples
- **WHEN** they configure a glass tray panel or read tray placement
- **THEN** they use `style.platform.macos.*` for macOS substrate controls
- **AND** they use `trayBounds.rect` from the provenance-bearing result when a fallback rect is required
- **AND** the docs do not teach the retired flat style shape.

## MODIFIED Requirements

### Requirement: Webview window operations SHALL be capability-gated and asynchronous

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported move, resize, shell, material, corner, or override behavior SHALL reject with a typed unsupported error instead of faking success.

The common window shell state for this change SHALL be limited to traits with stable cross-platform meaning, including frameless intent, transparent intent, and keep-on-top intent. Platform-specific material families, backdrop families, and detailed corner families SHALL be expressed through the platform-specific capability namespaces rather than the common `style` bag.

#### Scenario: Unsupported platform-specific appearance remains explicit

- **GIVEN** a page or host requests a platform-specific appearance family for a substrate the current runtime does not support
- **WHEN** the extension validates that request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the runtime does not silently ignore the platform-specific style family.

#### Scenario: Capability metadata distinguishes common shell support from platform substrate support

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states which common shell traits are supported
- **AND** it separately states which platform-specific appearance families are available for the current runtime
- **AND** the page can choose a portable or substrate-specific path intentionally.

### Requirement: Webview SHALL project tray bounds into navigator.opentray.tray

The WebView extension SHALL expose tray placement to page JavaScript through `navigator.opentray.tray`, still as the page projection of the tray-owned capability family. The page API SHALL remain tray-scoped rather than host- or space-scoped, because the measured anchor is the current tray contribution.

This change SHALL allow the tray placement result to carry provenance instead of collapsing everything to `Rect | null`. The resolved result SHALL expose at least `kind`, `source`, and `rect`.

#### Scenario: Page sees provenance-bearing tray placement

- **GIVEN** a WebView page calls the tray placement API
- **WHEN** the extension resolves a result
- **THEN** the result says whether placement is authoritative or unavailable through `kind`
- **AND** it exposes the source explanation
- **AND** page code reads the rectangle through `result.rect` instead of assuming the entire result is a bare `Rect`.

#### Scenario: Tray capability stays under the tray namespace

- **GIVEN** the page bridge exposes tray placement
- **WHEN** a developer inspects the navigator surface
- **THEN** the capability lives under `navigator.opentray.tray`
- **AND** the extension does not rename the measured atom as `host` or `space`.
