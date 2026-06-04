## ADDED Requirements

### Requirement: Webview window overlay SHALL be extension-owned and standard-like

The WebView extension SHALL expose a titlebar overlay capability through `navigator.opentrayWindow.overlay` when native window API and overlay support are enabled for the shown page. The overlay surface SHALL use the `windowControlsOverlay` mental model, but it SHALL NOT claim to polyfill CSS `env(titlebar-area-*)` values unless the runtime can actually provide those environment variables.

The overlay capability SHALL expose `visible`, `getTitlebarAreaRect()`, and event subscription for geometry changes. The returned rect SHALL be page-viewport-relative, so page code can position custom titlebar content without native coordinate conversion.

#### Scenario: Page reads titlebar overlay geometry

- **GIVEN** a WebView is shown with native window API and overlay enabled
- **WHEN** page code calls `await navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **THEN** the extension resolves a viewport-relative rect for custom titlebar content
- **AND** the rect avoids the native window control cluster when native controls are visible.

#### Scenario: Overlay does not claim CSS env support

- **GIVEN** a WebView page uses the OpenTray overlay API
- **WHEN** the runtime cannot inject `env(titlebar-area-*)`
- **THEN** the public contract remains `navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **AND** the extension does not document or expose a fake CSS environment variable polyfill.

### Requirement: Webview custom app region drag SHALL use native tracking

The WebView extension SHALL expose `startAppRegionDrag(...)` and `stopAppRegionDrag()` on the navigator window capability object. These methods SHALL represent the narrow app-region drag action, not generic window movement. Implementations MUST use native drag tracking when available and MUST reject with a typed unsupported error rather than silently falling back to repeated `moveTo` calls.

The native runtime SHALL automatically stop drag tracking when the mouse button is released, the tracking monitor is removed, or the owning WebView slot is closed.

#### Scenario: Custom titlebar starts native drag tracking

- **GIVEN** a page renders a custom titlebar over the WebView
- **WHEN** a pointer-down handler calls `await navigator.opentrayWindow.startAppRegionDrag()`
- **THEN** the native runtime starts platform drag tracking for the window
- **AND** the window follows the pointer with native titlebar-like behavior.

#### Scenario: Drag tracking stops automatically

- **GIVEN** app-region drag tracking is active
- **WHEN** the user releases the mouse button or the page calls `stopAppRegionDrag()`
- **THEN** the extension stops native tracking
- **AND** later mouse movement no longer moves the window.

### Requirement: Webview window state controls SHALL include commands and state query

The WebView extension SHALL expose `minimize()`, `maximize()`, and `restore()` as high-level asynchronous methods on the navigator window capability object. These methods SHALL delegate to the same scoped private invoke path as existing window controls and SHALL stay outside the overlay object.

The same capability object SHALL expose `getWindowState()`, `isMaximized()`, and `isMinimized()` so custom chrome can render stable button state without guessing from the last command it sent. `minimize()`, `maximize()`, `restore()`, and `windowstatechange` SHALL use the same window-state payload shape as `getWindowState()`.

#### Scenario: Page controls native window state

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `navigator.opentrayWindow.minimize()`, `maximize()`, or `restore()`
- **THEN** the native runtime applies the requested window state
- **AND** the request travels through the extension-owned `opentray.window` channel.

#### Scenario: Page reads native window state

- **GIVEN** a WebView is shown with native window API enabled
- **WHEN** the page calls `await navigator.opentrayWindow.getWindowState()`
- **THEN** the result states whether the window is `normal`, `minimized`, or `maximized`
- **AND** `isMaximized()` and `isMinimized()` resolve booleans from the same native state.

### Requirement: Overlay and drag capability SHALL stay inside ext-webview

The overlay geometry, custom app-region drag, and window-state controls SHALL be parsed and handled inside `crates/opentray-ext-webview`. `opentray-core`, `opentray-bin`, and the generic extension host SHALL NOT grow WebView-specific branches for these capabilities.

#### Scenario: Core remains unaware of overlay and drag

- **GIVEN** the page uses overlay and drag capabilities
- **WHEN** native requests are inspected
- **THEN** `crates/opentray-ext-webview` handles the request
- **AND** the core broker remains a generic extension-command forwarder.

## MODIFIED Requirements

### Requirement: Webview window operations SHALL be capability-gated and asynchronous

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported transparency, blur, move, resize, app-region drag tracking, overlay geometry, or override behavior SHALL reject with a typed unsupported error instead of faking success.

Style state SHALL include the frameless and visual-effect concepts needed for future platform work, including transparency and background effect support. Blur, acrylic, vibrancy, and Windows transparency behavior SHALL remain best-effort capabilities and MUST NOT be forced when the platform implementation would be slow or unstable.

Capability metadata SHALL state whether overlay geometry, app-region drag tracking, minimize, maximize, restore, and window-state query are supported so the page can decide whether to render custom chrome.

#### Scenario: Unsupported visual effect is explicit

- **GIVEN** a page calls `navigator.window.setStyle({ backgroundEffect: "blur" })`
- **AND** the current platform does not support blur cleanly
- **WHEN** the extension handles the request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the native runtime does not enable a slow fake blur path.

#### Scenario: Capability metadata describes available operations

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states whether close, move, resize, transparency, background effects, global overrides, overlay, app-region drag, minimize, maximize, restore, and window-state query are supported
- **AND** the page can decide whether to render frameless custom chrome.
