# opentray

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
