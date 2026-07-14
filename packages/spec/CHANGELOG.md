# @opentray/spec

## 0.13.0

## 0.12.0

## 0.11.2

## 0.11.1

## 0.11.0

### Patch Changes

- b92e8e9: Add OS-scoped tray icon candidates for Darwin, Win32, and Linux. Darwin candidates can carry `isTemplate`, which the tray-icon backend now applies through native template rendering when the Darwin candidate is selected.

  The tray-icon backend now also projects `appName` as final visible tray text when no configured icon/text produces visible pixels, preventing invisible click targets when an app omits an icon or accidentally supplies a transparent image. The `opentray` entrypoint re-exports common app-facing tray types such as `CreateTrayOptions`, `TrayIcon`, and `TrayMenu` so consumers do not need `typeof` inference or direct `@opentray/spec` imports for ordinary app code.

## 0.10.3

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

## 0.7.0

### Minor Changes

- c1ff923: Publish the tray-first protocol

  @opentray/spec is behind npm: the published 0.6.0 still carries the old
  Space/Surface protocol, while the source has been reset to the tray-first app
  protocol (App/Session/Tray, Icon projection refactor, runtime app identity in
  health). opentray and the platform runtime packages already depend on the new
  spec and ship the createTray SDK surface, so they move together.

  Build-layer packages (@opentray/packaging, the vite/esbuild/tsdown/webpack
  adapters) are versioned independently and are not part of this release.

## 0.6.0

### Minor Changes

- 4251cd2: Pin each host application's broker to a caller identity so the process is
  identifiable in the task manager, and retire the shared-surface multi-session
  aggregation model. Also fix createTray() hanging forever when the tray icon is
  omitted (fixes #3) by making icon optional end-to-end and correlating broker
  frame-parse errors to the originating request.

## 0.5.0

### Minor Changes

- 26024c7: Add broker-backed tray state setters and tray-scoped event helpers to the SDK, including `setTitle`, `setMenu`, `setTooltip`, `setIcon`, and tray-owned click/menu listeners.

  Add protocol 1.1 support for tray title mutation and tray identity on click events.

  Add WebView host geometry commands and the `WebviewPlacementKit` for tray, cursor, and screen-aware panel placement.

## 0.4.1

### Patch Changes

- e0d6274: Add OpenTray protocol-line metadata and npm dist-tag helpers for extension-agnostic compatible package installs.

## 0.4.0

### Minor Changes

- 87e3d17: Refresh the WebView window contract so common shell traits stay separate from platform-specific
  style families, make tray bounds provenance-bearing instead of collapsing to `Rect | null`, and
  restore the official source-tree WebView example smoke paths.

  The published guidance now teaches `style.platform.macos.*` and `trayBounds.rect`, and the macOS
  runtime rejects real cross-platform style mismatches without falsely rejecting placeholder platform
  families during startup.

## 0.3.0

### Minor Changes

- 3ff6285: Adopt the public Space/Tray/Session vocabulary for protocol and SDK APIs, keep deprecated Surface aliases for alpha migration, and publish the WebView extension runtime/docs update with platform package versioning.

## 0.2.0

### Minor Changes

- eeffa6f: Add protocol-versioned broker endpoint identity helpers and rename handshake metadata to explicit `protocolVersion` fields.

## 0.1.0

### Minor Changes

- 25ffaf9: Ship the first-stage OpenTray kernel and WebView foundation.

  This release adds typed protocol contracts, the broker-free TypeScript client surface, the platform-neutral WebView extension facade, and runnable examples for validating the first-stage API flow.
