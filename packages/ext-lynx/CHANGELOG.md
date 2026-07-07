# @opentray/ext-lynx

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

## 0.1.3

### Patch Changes

- fe3a3ce: Replace outdated public `opentray smoke daemon-lynx` README guidance with source-tree example and skill-owned visual acceptance guidance.

## 0.1.2

### Patch Changes

- 710a86e: Republish the Lynx extension package group after the window-controller merge so npm receives the updated bridge and OpenTray-owned runtime host assets.

## 0.1.1

### Patch Changes

- cce4e9b: Replace the borrowed `LynxExplorer.app` carrier with the OpenTray-owned `OpenTrayLynxRuntime.app.zip` host path for macOS Lynx releases.

  The published `opentray` CLI now carries a package-owned Lynx review bundle, so `opentray smoke daemon-lynx` can serve as the final human audit command after installing from npm without requiring a workspace checkout path.

- 6f8b688: Fix the Lynx window bridge resolver for runtimes that expose `NativeModules` as a lexical global, and refresh the packaged Lynx review bundle.

## 0.1.0

### Minor Changes

- f56f3ab: Add the official macOS-first Lynx extension, including the public `opentray smoke daemon-lynx` flow, darwin runtime sidecar packages, and release staging for `LynxExplorer.app.zip`.

## 0.0.0

- Initial workspace package for the Lynx extension facade.
