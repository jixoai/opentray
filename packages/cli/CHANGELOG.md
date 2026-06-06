# opentray

## 0.5.2

### Patch Changes

- Updated dependencies [e0d6274]
  - @opentray/spec@0.4.1

## 0.5.1

### Patch Changes

- cce4e9b: Replace the borrowed `LynxExplorer.app` carrier with the OpenTray-owned `OpenTrayLynxRuntime.app.zip` host path for macOS Lynx releases.

  The published `opentray` CLI now carries a package-owned Lynx review bundle, so `opentray smoke daemon-lynx` can serve as the final human audit command after installing from npm without requiring a workspace checkout path.

- 6f8b688: Fix the Lynx window bridge resolver for runtimes that expose `NativeModules` as a lexical global, and refresh the packaged Lynx review bundle.

## 0.5.0

### Minor Changes

- 87e3d17: Refresh the WebView window contract so common shell traits stay separate from platform-specific
  style families, make tray bounds provenance-bearing instead of collapsing to `Rect | null`, and
  restore the official source-tree WebView example smoke paths.

  The published guidance now teaches `style.platform.macos.*` and `trayBounds.rect`, and the macOS
  runtime rejects real cross-platform style mismatches without falsely rejecting placeholder platform
  families during startup.

### Patch Changes

- d411fe7: Clarify the current WebView platform maturity story across the published README surfaces and repo skills, distinguishing:

  - macOS as the current stable human-visible runtime path
  - Windows and Linux as alpha runtime territory even when platform packages exist
  - typed `unsupported` results that are deliberate substrate truth
  - `unavailable` results that only mean the current session lacks authoritative context

  Add an alpha-channel publish path based on changesets snapshot versioning so prerelease testing can use `npm i opentray@alpha` without consuming the later stable version numbers.

  <!-- opentray-preview {"alias":"webview-preview-20260605-1"} -->

- 94fe5fc: Expand the WebView extension window capability surface with macOS title/icon/screen/style controls, overlay titlebar geometry, app-region drag, borderless glass styling, window state queries/events, and screen-aware development recipes.

  Add an opentray webview-control example and smoke coverage for exercising the richer WebView window contract locally.

- Updated dependencies [87e3d17]
  - @opentray/spec@0.4.0

## 0.4.0

### Minor Changes

- f56f3ab: Add the official macOS-first Lynx extension, including the public `opentray smoke daemon-lynx` flow, darwin runtime sidecar packages, and release staging for `LynxExplorer.app.zip`.

## 0.3.1

### Patch Changes

- 917f0b2: Export `createSpace`, `createTray`, and `resolveDefaultSpace` from the top-level `opentray` package so the published SDK matches the documented broker-backed entrypoints.

## 0.3.0

### Minor Changes

- 3ff6285: Adopt the public Space/Tray/Session vocabulary for protocol and SDK APIs, keep deprecated Surface aliases for alpha migration, and publish the WebView extension runtime/docs update with platform package versioning.

### Patch Changes

- Updated dependencies [3ff6285]
  - @opentray/spec@0.3.0

## 0.2.4

### Patch Changes

- fb75cf5: Publish daemon platform artifacts that include the macOS WebView hide crash fix.

## 0.2.3

### Patch Changes

- 27e9db0: Avoid macOS daemon crashes when WebView smoke hides a native WebView window.

## 0.2.2

### Patch Changes

- 5a1c644: Ensure installed broker binaries are executable before spawning the daemon.

## 0.2.1

### Patch Changes

- 8e15a22: Fix the published npm CLI entrypoint so `node_modules/.bin/opentray` runs through package-manager symlinks.

## 0.2.0

### Minor Changes

- 3da6e7c: Add the `opentray daemon start|stop|restart` CLI lifecycle command with version-scoped runtime state and endpoint binding.
- 4f707b3: Ship platform-specific daemon binary packages, WebView dynamic-library packages, dynamic extension ABI/discovery, and the npm-installable `opentray smoke daemon-tray` verification command.
- eeffa6f: Add protocol-versioned broker endpoint identity helpers and rename handshake metadata to explicit `protocolVersion` fields.

### Patch Changes

- Updated dependencies [eeffa6f]
  - @opentray/spec@0.2.0

## 0.1.0

### Minor Changes

- 25ffaf9: Ship the first-stage OpenTray kernel and WebView foundation.

  This release adds typed protocol contracts, the broker-free TypeScript client surface, the platform-neutral WebView extension facade, and runnable examples for validating the first-stage API flow.

### Patch Changes

- Updated dependencies [25ffaf9]
  - @opentray/spec@0.1.0
