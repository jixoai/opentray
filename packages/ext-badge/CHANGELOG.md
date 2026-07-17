# @opentray/ext-badge

## 0.14.1

## 0.14.0

## 0.13.0

## 0.12.0

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

## 0.1.0

### Minor Changes

- f04f50d: Add the honest capability-gated badge status facade plus macOS and Windows package atoms.

  Add a repo-local WebView IPC badge debug panel and native release staging for the Dock helper bundle and Windows DLL packages.
