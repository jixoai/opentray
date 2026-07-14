# @opentray/darwin-arm64

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.2

## 0.11.1

## 0.11.0

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

## 0.9.0

### Minor Changes

- c1ff923: Publish the tray-first protocol

  @opentray/spec is behind npm: the published 0.6.0 still carries the old
  Space/Surface protocol, while the source has been reset to the tray-first app
  protocol (App/Session/Tray, Icon projection refactor, runtime app identity in
  health). opentray and the platform runtime packages already depend on the new
  spec and ship the createTray SDK surface, so they move together.

  Build-layer packages (@opentray/packaging, the vite/esbuild/tsdown/webpack
  adapters) are versioned independently and are not part of this release.

## 0.8.1

### Patch Changes

- 9f63f71: Ship the core OpenTray runtime as host-loadable Node binding artifacts staged at `runtime/opentray_runtime.node`, expose Node-side runtime binding resolution diagnostics, and add an explicit headless binding transport for protocol/session runtime checks.

  Remove public daemon lifecycle commands from the `opentray` CLI and stop exporting the transitional local broker transport from `opentray/node`. Source-tree visible diagnostics now use debug-runtime examples while the default visible runtime awaits an explicit host-main-loop binding contract.

  Rename the health response protocol frame from `daemon-health` to `runtime-host-health` and expose the shared health model as `RuntimeHostHealth`.

  Add explicit app identity metadata to runtime host health. Runtime hosts now retain app identity as `appId` / `appName` and keep `callerLabel` as the sanitized runtime routing slug.

  Add the visible Node runtime binding host for macOS and Windows. The default `createTray()` path now targets the in-process visible binding, while `runVisibleRuntimeHost()` in `opentray/node` owns the native host main loop and routes menu/tray events back only to the live caller session. The headless binding and source-tree local broker remain explicit diagnostic modes.

## 0.8.0

## 0.7.0

## 0.6.0

## 0.5.2

## 0.5.1

## 0.5.0

## 0.4.0

## 0.3.1

## 0.3.0

## 0.1.1

### Patch Changes

- fb75cf5: Publish daemon platform artifacts that include the macOS WebView hide crash fix.

## 0.1.0

### Minor Changes

- 4f707b3: Ship platform-specific daemon binary packages, WebView dynamic-library packages, dynamic extension ABI/discovery, and the npm-installable `opentray smoke daemon-tray` verification command.
