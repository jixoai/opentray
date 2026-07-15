## ADDED Requirements

### Requirement: WebView visibility SHALL be an operational state projection

`@opentray/ext-webview` SHALL define `visible` as `!closed && !minimized` for an existing native WebView window session. `closed` SHALL mean that the session native window is hidden/not projected, not that `destroy()` has torn down the session. Raw platform visibility alone SHALL NOT be exposed as this public `visible` projection.

The host `WebviewWindowHandle` and the page `navigator.opentrayWindow` / enabled `navigator.window` facade SHALL expose `isClosed(): Promise<boolean>`, `isVisible(): Promise<boolean>`, and `toVisible(): Promise<void>`. `toVisible()` SHALL show a closed/hidden session, restore a minimized session, and be idempotent when the session is already visible. It SHALL NOT replace content, recreate the session, or act as a general boolean setter.

`WebviewWindowState.visible` SHALL use this same operational projection. The extension SHALL expose a typed `visibleChange` event with payload `{ visible: boolean }`; it SHALL emit only when that projection changes.

#### Scenario: A tray host restores a minimized window without branching on native state

- **GIVEN** a tray host owns an existing `WebviewWindowHandle`
- **AND** its native window is minimized
- **WHEN** the host calls `isVisible()` and then `toVisible()`
- **THEN** `isVisible()` resolves `false`
- **AND** the native session is restored without recreation
- **AND** a `visibleChange` event reports `{ visible: true }`.

#### Scenario: A page reveals a hidden window idempotently

- **GIVEN** a page has the native window API enabled
- **AND** its native window is hidden by `close()` or `hide()`
- **WHEN** it calls `toVisible()` twice
- **THEN** the first call shows the existing session
- **AND** the second call does not introduce another state transition
- **AND** exactly one `visibleChange` event reports `{ visible: true }`.

### Requirement: Visibility capability SHALL remain extension-owned and platform-aligned

Visibility commands, state projection, and page bridge injection SHALL remain inside the WebView extension atom. The Rust command parser, Windows projection, macOS projection, TypeScript facade, and browser-global typing SHALL accept the same `isClosed`, `isVisible`, and `toVisible` contract. `opentray-core` and the generic broker SHALL NOT branch on WebView visibility commands.

#### Scenario: Host and page use one extension contract

- **GIVEN** a consumer uses either `WebviewWindowHandle` or `navigator.opentrayWindow`
- **WHEN** it queries or restores operational visibility
- **THEN** each path reaches the same extension-owned command family
- **AND** no generic tray/runtime API is introduced for WebView window visibility.

### Requirement: Windows frameless projection SHALL own every non-client calculation

For a Windows WebView whose effective style is frameless, every `WM_NCCALCSIZE` path SHALL expose the full host rectangle as client area. The result SHALL NOT depend on the message `wParam` form. Frameless style projection SHALL continue to remove `WS_THICKFRAME` and disable DWM non-client rendering.

The host SHALL apply its DWM non-client policy and DWM client-surface attributes before its final `SetWindowPos(..., SWP_FRAMECHANGED, ...)` recalculation. That recalculation SHALL preserve z-order, position, size, and shell visibility state. The host SHALL NOT depend on a synthetic resize, minimize, restore, hide/show, or window rebuild to remove native titlebar pixels.

#### Scenario: A frameless window survives a non-client recalculation

- **GIVEN** a Windows WebView window has `style.frameless: true`
- **WHEN** Win32 recalculates non-client geometry during style, resize, minimize, or restore handling
- **THEN** the native titlebar/frame is not reintroduced into the client projection
- **AND** the page still reaches the host outer edges.

#### Scenario: A frameless style change repaints native chrome without a shell-state reset

- **GIVEN** a Windows WebView transitions to `style.frameless: true`
- **WHEN** the host applies the native window style
- **THEN** DWM non-client rendering is disabled before the final frame recalculation
- **AND** no minimize, restore, hide/show, synthetic resize, or host rebuild occurs
- **AND** residual native titlebar pixels are not visible after the transition.

### Requirement: Windows frameless soft resize SHALL not change shell state

For `style.frameless: true` with `style.resizable: true`, application-level soft resize SHALL retain pointer capture until the pointer interaction ends or is canceled. During that interaction, the runtime MAY synchronously apply WebView bounds and repaint host surfaces, but it SHALL NOT call `ShowWindow`, minimize, restore, hide/show, rebuild the host window, or invoke the shell-state transparent white-block clear path.

Transparent white-block cleanup remains available for ordinary native resize and explicit resize paths where it does not run inside the frameless soft-resize capture lifecycle.

#### Scenario: A continuous frameless resize does not flicker or terminate after one pixel

- **GIVEN** a Windows WebView has `frameless: true`, `resizable: true`, and a translucent background
- **WHEN** the operator drags a soft-resize edge across multiple pixels
- **THEN** the native window continuously follows the pointer until mouse release
- **AND** the resize interaction retains capture
- **AND** no minimize/restore shell transition occurs during the drag.

#### Scenario: Minimizing a frameless resizable window keeps it minimized

- **GIVEN** a Windows WebView has `frameless: true` and `resizable: true`
- **WHEN** the operator or page minimizes the window
- **THEN** it remains minimized until an explicit restore or `toVisible()`
- **AND** no native titlebar residue is projected.
