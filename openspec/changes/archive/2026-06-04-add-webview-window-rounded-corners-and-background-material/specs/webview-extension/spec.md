## ADDED Requirements

### Requirement: Webview style SHALL support adjustable corner radius

The WebView extension SHALL include `cornerRadius` in the durable window style state. `cornerRadius` SHALL be a numeric logical radius measured in CSS-like pixels. Omitted or `null` radius SHALL preserve the platform's default shell behavior. A numeric radius SHALL be validated, clamped to a safe non-negative range, reported by `getStyle()`, and projected into native window/content clipping when the platform supports it.

On macOS, the runtime MAY implement rounded corners with a layer-backed content view and `CALayer` clipping. Unsupported platforms MUST reject or report lack of support explicitly rather than claiming a rounded shell that does not exist.

#### Scenario: Page sets rounded corners

- **GIVEN** a WebView window is shown with native window API enabled
- **WHEN** the page calls `navigator.window.setStyle({ cornerRadius: 18 })`
- **THEN** the native runtime clips the window content to the requested radius when supported
- **AND** `navigator.window.getStyle()` reports `cornerRadius: 18`.

#### Scenario: Unset corner radius preserves system behavior

- **GIVEN** a WebView window is shown without a corner-radius style
- **WHEN** the window is created
- **THEN** the extension preserves the platform default corner behavior
- **AND** it does not force a hard-coded radius.

### Requirement: Webview material background SHALL use real native visual effects

The WebView extension SHALL use native platform visual effects for background material or blur. On macOS, supported `backgroundEffect` values SHALL be implemented with the existing AppKit/Wry window plus `window-vibrancy` path. The runtime MUST NOT implement a fake page-level blur to claim that the native window background is blurred.

The material path SHALL keep the WebView and NSWindow backgrounds clear when a material is active, so the native visual effect can blur content behind the window.

#### Scenario: Material blur sees behind the window

- **GIVEN** a WebView window has a supported background material enabled
- **WHEN** the page content leaves a transparent area
- **THEN** the native material layer can blur content behind the native window
- **AND** the page is not merely rendering a CSS-only blur.

### Requirement: Borderless transparent shell SHALL remain a style projection

The WebView extension SHALL project borderless, transparent, material, and rounded-corner state through `getStyle()` / `setStyle()` and declarative `show(...).style`. These shell concerns SHALL remain inside the WebView extension atom and SHALL NOT add WebView-specific behavior to the core broker or daemon.

#### Scenario: Borderless shell is controlled by style state

- **GIVEN** a WebView window is shown with `style.frameless`, `style.transparent`, `style.backgroundEffect`, and `style.cornerRadius`
- **WHEN** the native macOS runtime creates the window
- **THEN** it applies those values as native window style projection
- **AND** the daemon does not parse or apply those WebView-specific fields.

## MODIFIED Requirements

### Requirement: Webview window operations SHALL be capability-gated and asynchronous

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported transparency, blur, move, resize, corner-radius projection, or override behavior SHALL reject with a typed unsupported error instead of faking success.

Style state SHALL include the frameless and visual-effect concepts needed for future platform work, including transparency, background effect support, and adjustable `cornerRadius`. Blur, acrylic, vibrancy, rounded-corner, and Windows transparency behavior SHALL remain best-effort capabilities and MUST NOT be forced when the platform implementation would be slow or unstable.

Capability metadata SHALL state whether corner-radius projection is supported so the page can decide whether to render borderless custom chrome.

#### Scenario: Unsupported visual effect is explicit

- **GIVEN** a page calls `navigator.window.setStyle({ backgroundEffect: "blur" })`
- **AND** the current platform does not support blur cleanly
- **WHEN** the extension handles the request
- **THEN** the returned promise rejects with a typed unsupported error
- **AND** the native runtime does not enable a slow fake blur path.

#### Scenario: Capability metadata describes shell operations

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds
- **THEN** the result states whether transparent backgrounds, native background effects, and corner-radius projection are supported
- **AND** the page can decide whether to render borderless custom chrome.
