# @opentray/ext-webview

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
