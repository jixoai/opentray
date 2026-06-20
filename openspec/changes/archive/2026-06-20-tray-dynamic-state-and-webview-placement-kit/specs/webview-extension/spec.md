## ADDED Requirements

### Requirement: Webview host window handles SHALL expose geometry commands

`@opentray/ext-webview` host-side `WebviewWindowHandle` SHALL expose `moveTo(x, y)` and `resizeTo(width, height)`. These methods SHALL use the same extension command path as other WebView window verbs and SHALL remain owned by the WebView extension atom.

#### Scenario: Host code moves a WebView window

- **GIVEN** host code owns a `WebviewWindowHandle`
- **WHEN** it calls `moveTo` or `resizeTo`
- **THEN** the facade sends the corresponding WebView command through `TrayHandle.commandExtension`
- **AND** `opentray-core` does not parse WebView-specific geometry commands.

#### Scenario: Host code reads truthy bounds and constrains size

- **GIVEN** host code owns a `WebviewWindowHandle`
- **WHEN** it calls `getBounds()`, `setMinimumSize(...)`, or `setMaximumSize(...)`
- **THEN** the extension returns the native window bounds or applies native size constraints
- **AND** omitted size fields remain unchanged while `null` clears that constraint.

### Requirement: Webview page navigator SHALL expose reversible visibility commands

`navigator.opentrayWindow` and the optional `navigator.window` binding SHALL expose `show()` and `hide()` as reversible visibility controls on macOS and Windows. These commands SHALL NOT be aliases for content replacement or permanent close/destroy.

#### Scenario: Page hides and shows the same native window session

- **GIVEN** a page has the native window API enabled
- **WHEN** it calls `hide()` and later `show()`
- **THEN** the runtime updates native visibility for the same window session
- **AND** the command returns the current window state.

### Requirement: Webview extension SHALL provide a composable placement kit

`@opentray/ext-webview` SHALL export a placement utility class that can resolve and continuously apply common desktop placements without becoming a special tray-panel API. The utility SHALL accept injected authorities such as tray bounds, screen details, and cursor position.

Supported placements SHALL include `tray`, `cursor`, `screen-center`, `screen-top`, `screen-right`, `screen-bottom`, `screen-left`, `screen-top-left`, `screen-top-right`, `screen-bottom-left`, `screen-bottom-right`, `edge`, `edge-x`, `edge-y`, `edge-top`, `edge-right`, `edge-bottom`, and `edge-left`, plus `placementMargin`.

The extension SHALL expose a shared host-side geometry helper that treats public window, screen, and tray rectangles as desktop logical pixels. Placement and responsive helpers SHALL use this helper for normalization, screen selection, clamping, comparison, and native window application instead of applying browser DPR or platform-specific scaling in TypeScript helper code.

#### Scenario: Developer places a lightweight panel from tray geometry

- **GIVEN** a developer has a tray handle and a WebView window handle
- **WHEN** they call `watch()` with `placement: "tray"`
- **THEN** it resolves the tray bounds through the injected tray authority
- **AND** it applies the computed size and position with WebView geometry commands
- **AND** it recomputes when subscribed placement dependencies or target bounds invalidate.

#### Scenario: One-shot placement remains explicit

- **GIVEN** a developer intentionally wants a single placement calculation
- **WHEN** they call `applyOnce()` or `once()`
- **THEN** it performs one calculation and does not keep a watch alive
- **AND** it rejects when a watch is already active for that target.

#### Scenario: Edge placement snaps from window bounds to a viewport edge

- **GIVEN** a target window has current bounds and screen details are available
- **WHEN** the developer watches `edge`, `edge-x`, or `edge-y`
- **THEN** the algorithm selects the nearest eligible viewport edge before resolving the final anchor.

#### Scenario: High-DPI placement uses one logical coordinate system

- **GIVEN** screen details include a high-DPI `scaleFactor`
- **AND** the target window bounds are already public OpenTray `Rect` values
- **WHEN** the placement kit resolves a screen-relative placement
- **THEN** the algorithm uses the logical `width`, `height`, `x`, and `y` values directly
- **AND** it does not multiply or divide by `devicePixelRatio` or the screen `scaleFactor`.

#### Scenario: Portable placement falls back with provenance

- **GIVEN** a portable placement source is unavailable
- **WHEN** the placement kit resolves a position
- **THEN** it returns a documented fallback/provenance value instead of pretending the missing authority was native data.

### Requirement: Windows explicit resize SHALL refresh the host composition surface

The Windows WebView runtime SHALL refresh the native host surface after explicit resize commands using the same host-surface cleanup path that prevents transparent white-block artifacts. It SHALL NOT hide/show, maximize, or rebuild the WebView to clear resize residue.

#### Scenario: Page or host code resizes a Windows WebView window

- **GIVEN** a Windows WebView window is active
- **WHEN** host code or page code calls `resizeTo`
- **THEN** the runtime synchronously reapplies WebView client bounds
- **AND** it refreshes the attached host surface in place.

### Requirement: Webview extension SHALL expose responsive window helpers

`@opentray/ext-webview` SHALL export backend-only `styleKit` and `mediaQueryKit` helpers for responsive native window composition. `styleKit` SHALL compose initial size constraints, background material selection, and platform style patches. `mediaQueryKit` SHALL watch native window bounds and run callbacks on media-query state changes without mutating user HTML.

#### Scenario: A lightweight panel grows after crossing a width threshold

- **GIVEN** host code applies a compact panel recipe with `styleKit`
- **WHEN** the window width crosses a configured media-query threshold
- **THEN** `mediaQueryKit` can raise the minimum height or otherwise adjust native window style
- **AND** the page content remains owned by the app, not by injected DOM/CSS.

## MODIFIED Requirements

### Requirement: Webview facade SHALL be typed and platform-neutral

The facade SHALL remain platform-neutral while also exporting host-side placement helpers. These helpers SHALL depend only on public `opentray` and `@opentray/spec` contracts plus WebView facade types.

#### Scenario: Placement helper stays outside the core

- **GIVEN** a developer imports `WebviewPlacementKit`
- **WHEN** the package is evaluated
- **THEN** it does not import native platform packages
- **AND** it does not add WebView placement logic to `opentray-core`.
