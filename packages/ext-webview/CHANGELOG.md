# @opentray/ext-webview

## 0.11.2

### Patch Changes

- 4657007: Fix native package publish correctness for the current OpenTray release line.

  - broker runtime resolution now prefers installed `@opentray/<platform>` packages
    before workspace fallback
  - POSIX runtime packages preserve executable permissions through `pnpm publish`
  - fixed-line native release planning now stages and validates runtime,
    `@opentray/ext-webview`, and `@opentray/ext-badge` platform packages together
  - native package validation now inspects the real `pnpm pack` tarball payload so
    empty platform packages fail before publish

## 0.11.1

## 0.11.0

### Minor Changes

- ebed69b: Add native WebView download handling across supported platforms, including explicit download events, save-path control, multiple-download policy defaults, and preservation of the browser-provided `suggestedFilename` through the download lifecycle.
- a2c9541: Add whole-window opacity to the WebView window style contract. `style.opacity` is a common shell-alpha field that composes with, but does not replace or imply, `style.background` material, blur, or transparent backing modes.

### Patch Changes

- 1eb8b13: Rewrite the `@opentray/ext-webview` "First Panel" example to the current executable-host model. The previous example imported `runTrayApp` from the `opentray/node` subpath, but both were removed in the v0.10 `drop Node runtime binding and ship the executable host` refactor: `opentray/node` no longer exists in the package `exports`, and the runtime ships as a packaged executable (`bin/opentray`) that `createTray()` spawns on demand. The README now teaches the supported path — `createTray()` from the `opentray` root entry, with runtime identity passed through the second argument — and documents that application code does not host a native main loop or worker.
- cd4d563: Update native tray-icon projections in place when `setIcon` and related tray state change, avoiding temporary status-item removal during ordinary tray updates. WebView tray placement now rejects transient invalid tray bounds and reuses the last valid tray anchor before falling back to portable placement. macOS primary tray activation now routes left-click to the primary menu item while preserving the native menu on right-click.

## 0.10.3

### Patch Changes

- beebbcf: Add app/tray identity to extension contexts, expose a gated WebView `opentrayPermissions` management bridge backed by the app-scoped permission store, and release the shared Darwin carrier path used by the badge helper.

  Native browser-engine grants still return typed unsupported results where Wry does not expose an OpenTray-owned permission callback.

## 0.10.2

### Patch Changes

- 9e5a35d: Cut the current fixed public release line.

## 0.10.1

### Patch Changes

- Cut the current fixed public release line.

## 0.10.0

### Minor Changes

- b6daba2: Align OpenTray on a single 0.10.0 package line.

  This release adds the `runTrayApp()` onboarding path, simplifies official
  examples around tray-first usage, makes the WebView extension path progressive
  through `tray.extend(WebviewExt)`, refreshes the OpenTray skill tutorial and
  versioning guidance, and moves all public packages into one fixed release group
  so installs resolve a coherent package set.

## 0.7.1

### Patch Changes

- a5b26b9: Fix WebView placement so screen and edge top/bottom anchors respect native screen coordinate origins, including macOS bottom-left screen coordinates.

  Make `WebviewPlacementKit.watch()` keep reacting to native placement invalidations instead of behaving like a one-shot placement, and pause/resume placement while native window interaction owns live bounds.

## 0.7.0

### Minor Changes

- 26024c7: Add broker-backed tray state setters and tray-scoped event helpers to the SDK, including `setTitle`, `setMenu`, `setTooltip`, `setIcon`, and tray-owned click/menu listeners.

  Add protocol 1.1 support for tray title mutation and tray identity on click events.

  Add WebView host geometry commands and the `WebviewPlacementKit` for tray, cursor, and screen-aware panel placement.

## 0.6.0

### Minor Changes

- 5b8c5d7: Stop publishing official Linux native packages for `@opentray/ext-webview`.
  OpenTray core still supports Linux, while the WebView extension now publishes
  native runtime atoms only for macOS and Windows until a real visible Linux
  runtime is available.

  Promote the Windows WebView2 runtime to the stable WebView support matrix and
  remove the public `opentray smoke` subcommands so the CLI remains focused on
  daemon lifecycle and health. Visual smoke orchestration now lives in OpenTray
  skills and source-tree examples.

## 0.5.0

### Minor Changes

- cd108fd: Add the Windows WebView2 runtime path with native background materials, overlay titlebar geometry, window control bridge support, and Windows native icon/style projection.

## 0.4.0

### Minor Changes

- 87e3d17: Refresh the WebView window contract so common shell traits stay separate from platform-specific
  style families, make tray bounds provenance-bearing instead of collapsing to `Rect | null`, and
  restore the official source-tree WebView example smoke paths.

  The published guidance now teaches `style.platform.macos.*` and `trayBounds.rect`, and the macOS
  runtime rejects real cross-platform style mismatches without falsely rejecting placeholder platform
  families during startup.

- 94fe5fc: Expand the WebView extension window capability surface with macOS title/icon/screen/style controls, overlay titlebar geometry, app-region drag, borderless glass styling, window state queries/events, and screen-aware development recipes.

  Add an opentray webview-control example and smoke coverage for exercising the richer WebView window contract locally.

### Patch Changes

- d411fe7: Clarify the current WebView platform maturity story across the published README surfaces and repo skills, distinguishing:

  - macOS as the current stable human-visible runtime path
  - Windows and Linux as alpha runtime territory even when platform packages exist
  - typed `unsupported` results that are deliberate substrate truth
  - `unavailable` results that only mean the current session lacks authoritative context

  Add an alpha-channel publish path based on changesets snapshot versioning so prerelease testing can use `npm i opentray@alpha` without consuming the later stable version numbers.

  <!-- opentray-preview {"alias":"webview-preview-20260605-1"} -->

## 0.3.0

### Minor Changes

- 3ff6285: Adopt the public Space/Tray/Session vocabulary for protocol and SDK APIs, keep deprecated Surface aliases for alpha migration, and publish the WebView extension runtime/docs update with platform package versioning.

## 0.2.0

### Minor Changes

- 4f707b3: Ship platform-specific daemon binary packages, WebView dynamic-library packages, dynamic extension ABI/discovery, and the npm-installable `opentray smoke daemon-tray` verification command.

## 0.1.0

### Minor Changes

- 25ffaf9: Ship the first-stage OpenTray kernel and WebView foundation.

  This release adds typed protocol contracts, the broker-free TypeScript client surface, the platform-neutral WebView extension facade, and runnable examples for validating the first-stage API flow.
