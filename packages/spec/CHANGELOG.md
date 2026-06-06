# @opentray/spec

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
