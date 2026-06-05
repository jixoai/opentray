# @opentray/ext-lynx

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
