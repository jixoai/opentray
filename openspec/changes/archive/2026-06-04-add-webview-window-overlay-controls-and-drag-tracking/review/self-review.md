# Self Review

## Decision Check

- `ext-webview` stays on the existing `NSWindow + wry` runtime and does not introduce Tao.
- Titlebar overlay geometry remains an extension-owned capability family on `navigator.opentrayWindow.overlay`.
- Native drag tracking uses AppKit drag/session primitives instead of a synthetic `moveTo(...)` loop.
- Window state queries and actions stay on the same private window bridge family as other native window controls.

## Contract Check

- `windowControlsOverlay` opt-in enables a titlebar-safe overlay object with `getTitlebarAreaRect()`.
- Overlay geometry changes emit a dedicated `geometrychange` signal through `navigator.opentrayWindow.overlay`.
- `startAppRegionDrag()` and `stopAppRegionDrag()` expose explicit native drag control for custom titlebars.
- `minimize()`, `maximize()`, `restore()`, `getWindowState()`, `isMaximized()`, and `isMinimized()` are available through the same extension-owned window control surface.
- `windowstatechange` payloads stay aligned with `getWindowState()` instead of inventing a second state model.

## Boundary Check

- No WebView-specific overlay, drag, or window-state parser was added to `opentray-core` or `opentray-bin`.
- Overlay geometry and drag cleanup stay inside the macOS WebView runtime modules.
- The page contract uses a standard-like mental model without claiming unsupported CSS environment polyfills.

## Verification Evidence

- `pnpm --filter @opentray/ext-webview test`
- `cargo test -p opentray-ext-webview`
- `bun run openspec:vision -- validate add-webview-window-overlay-controls-and-drag-tracking`
- Focused grep checks proving `opentray-core` and `opentray-bin` do not parse WebView overlay/drag commands
- Manual `pnpm --filter opentray example:webview-control` acceptance:
  - overlay available
  - drag available
  - minimize / maximize / restore available
  - custom titlebar can avoid native controls and drive native window actions
- `git diff --check`

## Residual Risk

- Overlay safe-area geometry is currently macOS-specific and intentionally modeled as an extension capability, not a cross-platform core law.
- The next real platform-law decision point is Windows/Linux overlay and drag parity, where capability names may stay shared while effect families diverge by substrate.
