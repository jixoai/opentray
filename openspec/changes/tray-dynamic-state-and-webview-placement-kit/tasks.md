## 1. OpenSpec

- [x] 1.1 Create intent document for tray dynamic state, eventful handles, WebView placement kit, and skill scenario guidance.
- [x] 1.2 Add client SDK requirements for tray setters, title mutation, trusted event handles, and tray identity in click events.
- [x] 1.3 Add WebView extension requirements for host geometry commands and placement kit.
- [x] 1.4 Add consumer skill requirements for scenario composition and no hidden DOM/CSS mutation.

## 2. Protocol and Kernel

- [x] 2.1 Add `set-tray-title` to TypeScript and Rust protocol models.
- [x] 2.2 Add `trayId` to `trayClick` and `trayDoubleClick` in TypeScript and Rust models.
- [x] 2.3 Implement Rust kernel/broker title mutation and projection tests.
- [x] 2.4 Update backend event routing tests for tray-scoped click events.

## 3. TypeScript SDK

- [x] 3.1 Add tray state setters to `TrayHandle`.
- [x] 3.2 Add eventful connection typing and tray-scoped `listen` / convenience helpers.
- [x] 3.3 Update SDK tests to verify setters, event filtering, and request/event separation.
- [x] 3.4 Migrate examples away from raw event filtering where practical.

## 4. WebView Extension

- [x] 4.1 Add host-side `moveTo` and `resizeTo` commands to `WebviewWindowHandle`.
- [x] 4.2 Add `WebviewPlacementKit` with tray/cursor/screen placements and `placementMargin`.
- [x] 4.3 Add placement tests using injected authorities.
- [x] 4.4 Keep the kit inside `@opentray/ext-webview` and platform-neutral.
- [x] 4.5 Add a source-tree placement demo that composes dynamic tray state, tray-scoped events, continuous WebView placement, and page-owned drag behavior.
- [x] 4.6 Add page-side `navigator.opentrayWindow.show()` / `hide()` on macOS and Windows.
- [x] 4.7 Make placement continuous by default with `watch()` / `unwatch()` plus explicit `applyOnce()` / `once()`.
- [x] 4.8 Add edge placement variants and keep the algorithm framed as `anchorBound + windowBound + viewport` with a future `positionTry` TODO.
- [x] 4.9 Refresh the Windows host composition surface after explicit resize commands.
- [x] 4.10 Add host `getBounds()` plus native minimum/maximum size constraint verbs for WebView windows.
- [x] 4.11 Add backend-only `styleKit` and `mediaQueryKit` helpers for responsive panel composition.
- [x] 4.12 Add a shared `windowGeometryKit` facade so placement and responsive helpers consume one logical desktop pixel coordinate law.

## 5. Skills and Docs

- [x] 5.1 Update `skills/opentray` routing to point to scenario guidance.
- [x] 5.2 Add scenario cards covering the common OpenTray consumer flows.
- [x] 5.3 Update WebView skill guidance to avoid hidden HTML/CSS mutation and explain overlay/drag/material/icon decisions.
- [x] 5.4 Update contributor skill references if needed so future agents preserve the same laws.
- [x] 5.5 Document the placement demo in README, source example guide, and visual acceptance skill guidance.
- [x] 5.6 Update the placement demo to demonstrate blur-active native styling and responsive size behavior.

## 6. Verification

- [x] 6.1 Run targeted spec, CLI SDK, and WebView facade tests.
- [x] 6.2 Run targeted Rust tests for protocol/kernel/broker changes.
- [x] 6.3 Run OpenSpec validation for this change.
- [x] 6.4 Run `git diff --check`.
- [x] 6.5 Run the placement source-tree demo smoke.
