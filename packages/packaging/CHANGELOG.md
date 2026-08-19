# @opentray/packaging

## 0.20.0

### Patch Changes

- @opentray/spec@0.20.0

## 0.19.1

### Patch Changes

- @opentray/spec@0.19.1

## 0.19.0

### Patch Changes

- @opentray/spec@0.19.0

## 0.18.0

### Minor Changes

- f3ddf42: Add a stable Darwin app launch command that remembers the latest caller invocation or executes an explicit shell-free command vector when the app bundle is reopened. Live Dock activation now restores and focuses the most recently active retained app-mode WebView without executing the cold launch command. Persist carrier and broker diagnostics for failed relaunches, converge stale same-app bundles, and recover daemon startup automatically when an interrupted caller leaves a stale broker lock.

### Patch Changes

- @opentray/spec@0.18.0

## 0.17.0

### Minor Changes

- 9d45ae4: Materialize stable caller-owned Darwin app bundles with package-derived identity, strict native app-icon variants, and shared build-plugin adapters. Consumers can use a normal install or a prebuilt bundle without relying on a compressed carrier or manually copied runtime files.

### Patch Changes

- Updated dependencies [9d45ae4]
  - @opentray/spec@0.17.0

## 0.16.0

## 0.15.0

## 0.14.4

## 0.14.3

## 0.14.2

## 0.14.1

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
