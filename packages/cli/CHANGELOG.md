# opentray

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
