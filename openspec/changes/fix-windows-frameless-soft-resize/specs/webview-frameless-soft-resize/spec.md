## ADDED Requirements

### Requirement: Frameless resize ownership

The WebView extension SHALL own user-resizable window behavior as a common shell-style capability. Application code SHALL declare the intent through `style.resizable`; it SHALL NOT need to implement pointer-move resize loops or invoke a public resize-drag command. `opentray-core` and the broker SHALL remain unaware of WebView window style parsing and pointer interaction.

#### Scenario: Frameless resize remains an extension atom

- **GIVEN** an application creates a WebView window with `style.frameless` and `style.resizable`
- **WHEN** the extension projects that window onto a platform host
- **THEN** the extension owns protocol parsing, page-edge detection, native tracking, and geometry mutation
- **AND** no WebView-specific branch is added to `opentray-core` or the broker

### Requirement: Common resizable style contract

The WebView window style SHALL expose `resizable` as a common style field. `WebviewWindowStyle` SHALL report an effective boolean, `WebviewWindowStylePatch` and show options SHALL accept an optional boolean, `stylechange` SHALL report the effective style, and window capabilities SHALL declare whether the platform supports this user-resize intent. Programmatic `resizeTo()` and size-constraint APIs SHALL remain independent from `resizable`.

When `resizable` is omitted, a framed window SHALL be user-resizable and a frameless window SHALL not be user-resizable. Until an application explicitly sets `resizable`, changing `frameless` SHALL recompute that default. After an explicit `resizable` patch, later `frameless` patches SHALL preserve the explicit user-resize choice.

#### Scenario: Frameless remains fixed-size by default

- **GIVEN** an application creates or changes a WebView window to `style.frameless: true`
- **AND** it has not explicitly set `style.resizable`
- **WHEN** the effective style is queried
- **THEN** `resizable` is `false`
- **AND** programmatic `resizeTo()` remains available

#### Scenario: Explicit resizable intent survives chrome changes

- **GIVEN** an application explicitly sets `style.resizable: true`
- **WHEN** it later toggles `style.frameless`
- **THEN** `getStyle().resizable` remains `true`
- **AND** the platform projects the matching user-resize behavior for the current chrome mode

### Requirement: Windows true frameless shell

On Windows, a frameless WebView window SHALL remove legacy non-client titlebar and resize-frame rendering. Its native style SHALL not retain `WS_THICKFRAME`, and its DWM non-client policy SHALL not reintroduce legacy caption or border rendering. It SHALL continue to use full-client geometry so the WebView reaches the host edges. Framed and overlay windows SHALL retain their existing native frame and caption-control behavior.

`style.frameless` SHALL remain independent from `style.background`: changing chrome SHALL not silently change opaque, transparent, semantic, or material background selection.

#### Scenario: Windows frameless window has no legacy frame residue

- **GIVEN** a Windows WebView window is shown with `style.frameless: true`
- **WHEN** its native style and DWM policy are applied
- **THEN** it has no legacy titlebar or resize-border residue
- **AND** the WebView fills the full client area
- **AND** its configured background family remains unchanged

### Requirement: Windows application-level soft resizing

When a Windows WebView window is both frameless and effectively resizable, the extension SHALL provide application-level soft resizing for the four edges and four corners. The injected runtime SHALL recognize trusted primary-mouse gestures inside a six CSS-pixel edge band and reserve those gestures from page content. The HWND owner SHALL capture the pointer and track the interaction natively from the initial cursor position and raw window rectangle.

The native tracker SHALL preserve the opposite edge, honor existing minimum and maximum size constraints in the HWND coordinate system, refresh WebView client bounds during the interaction, and terminate on mouse release, capture loss, cancellation, hide, minimize, or maximize. A maximized window SHALL not begin soft resizing. The tracker SHALL reuse the existing resize interaction state so resize-only artifact repair remains forbidden for pure move interactions.

#### Scenario: Dragging a frameless edge resizes the native window

- **GIVEN** a visible, non-maximized Windows WebView window with `style.frameless: true` and `style.resizable: true`
- **WHEN** the operator presses and drags a pointer from any edge or corner hit band
- **THEN** the host resizes the native HWND in the requested direction
- **AND** the WebView continues to fill the resized client area
- **AND** configured size constraints are enforced
- **AND** the page does not need to issue repeated `resizeTo()` calls

#### Scenario: Soft resize reports real interaction outcomes

- **GIVEN** a soft resize interaction changes the window position or size
- **WHEN** the interaction ends
- **THEN** the extension emits `windowinteractionchange` for interaction start and finish
- **AND** it emits `moved` and/or `resized` only for geometry that actually changed

### Requirement: macOS resizable style projection

On macOS, the common `resizable` style intent SHALL map to `NSWindowStyleMask::Resizable` independently of whether the window is framed or borderless. Omitted style SHALL retain the common default: framed windows resizable and frameless windows fixed-size. macOS SHALL not emulate the Windows soft-resize implementation.

#### Scenario: macOS borderless resize is explicit

- **GIVEN** a macOS WebView window is frameless
- **WHEN** `style.resizable` is omitted
- **THEN** its native style mask excludes `Resizable`
- **WHEN** the application explicitly sets `style.resizable: true`
- **THEN** its native style mask includes `Resizable`
