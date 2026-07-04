## ADDED Requirements

### Requirement: Webview window style SHALL expose whole-window opacity as common shell state

The WebView extension SHALL include `opacity` in the common durable window style state. `opacity` SHALL represent whole native-window shell alpha, not page CSS opacity and not background backing or material choice. The value SHALL be a finite number from `0` through `1`, defaulting to `1`.

`opacity` SHALL be accepted in declarative `show(...).style`, live `setStyle(...)`, host-side `WebviewWindowHandle.setStyle(...)`, and page-side `navigator.window.setStyle(...)`. `getStyle()` and `stylechange` payloads SHALL report the normalized `opacity` value using the same shape as the host/page TypeScript facade.

The runtime SHALL keep `opacity` orthogonal to `style.background`: requesting opacity MUST NOT imply `background: "transparent"`, semantic blur, or any platform material; requesting a transparent/material background MUST NOT imply a non-opaque window alpha.

#### Scenario: Opacity composes with material background

- **GIVEN** a WebView window is shown with `style.opacity: 0.72`
- **AND** `style.background` requests a platform material or semantic blur
- **WHEN** the native runtime creates or updates the window
- **THEN** the native shell alpha is projected as `0.72`
- **AND** the requested background material remains the source of backing/material behavior.

#### Scenario: Opacity does not mutate background ontology

- **GIVEN** a WebView window is shown with `style.opacity: 0.5`
- **AND** no `style.background` is supplied
- **WHEN** page or host code reads `getStyle()`
- **THEN** the result reports `opacity: 0.5`
- **AND** the result still reports the default opaque background.

#### Scenario: Invalid opacity is rejected

- **GIVEN** page or host code calls `setStyle({ opacity: 1.5 })`
- **WHEN** the WebView extension validates the request
- **THEN** the request rejects with a typed rejected error
- **AND** the current native window style is not changed.

### Requirement: Webview opacity projection SHALL remain inside the WebView extension atom

The WebView extension native runtime SHALL own the parsing, validation, state storage, native projection, and event payload for `style.opacity`. `opentray-core` and the broker daemon SHALL continue to forward extension traffic generically and SHALL NOT parse, normalize, or apply WebView opacity fields.

The extension SHALL use platform-native whole-window alpha APIs for supported runtime families. It MUST NOT inject or mutate user HTML/CSS to fake whole-window opacity.

#### Scenario: Core stays generic

- **GIVEN** host code sends a WebView `setStyle` command with `opacity`
- **WHEN** the command crosses the OpenTray extension host boundary
- **THEN** core and broker code forward it as extension data
- **AND** only the WebView extension runtime validates and applies the opacity field.

## MODIFIED Requirements

### Requirement: Webview window operations SHALL be capability-gated and asynchronous

Window operations exposed through `navigator.window` SHALL return promises. The native extension SHALL validate every request, check platform support, and resolve or reject with typed results. Unsupported move, resize, shell, material, corner, opacity, or override behavior SHALL reject with a typed unsupported or rejected error instead of faking success.

The common window shell state SHALL be limited to traits with stable cross-platform meaning, including frameless intent, transparent backing intent through the background atom, keep-on-top intent, and whole-window opacity. Platform-specific material families, backdrop families, and detailed corner families SHALL be expressed through the platform-specific capability namespaces rather than the common `style` bag.

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

#### Scenario: Opacity capability is reported separately from background capability

- **GIVEN** a page calls `navigator.window.getCapabilities()`
- **WHEN** the extension responds from a runtime that supports whole-window alpha
- **THEN** the result reports opacity support as a common shell capability
- **AND** background/material support remains reported through the existing background and platform capability fields.
