# @opentray/packaging

## 0.32.0

### Patch Changes

- @opentray/spec@0.32.0

## 0.31.3

### Patch Changes

- @opentray/spec@0.31.3

## 0.31.2

### Patch Changes

- @opentray/spec@0.31.2

## 0.31.1

### Patch Changes

- @opentray/spec@0.31.1

## 0.31.0

### Patch Changes

- @opentray/spec@0.31.0

## 0.30.2

### Patch Changes

- @opentray/spec@0.30.2

## 0.30.1

### Patch Changes

- @opentray/spec@0.30.1

## 0.30.0

### Patch Changes

- @opentray/spec@0.30.0

## 0.29.0

### Patch Changes

- @opentray/spec@0.29.0

## 0.28.0

### Patch Changes

- @opentray/spec@0.28.0

## 0.27.7

### Patch Changes

- @opentray/spec@0.27.7

## 0.27.6

### Patch Changes

- @opentray/spec@0.27.6

## 0.27.5

### Patch Changes

- 456b8e4: Fix the lifecycle-ownership failure family behind dead toolbar apps: owner-stamped self-healing bundle/launch locks (kill -9 never wedges a start again), owner-tuple-validated session destroy (a late cleanup can never destroy a newer same-tray session), connection-death terminates every SDK await and listener with a documented terminal surface (no zombie entries; generated apps exit non-zero instead of serving a dead shell), appId-derived broker endpoints (one endpoint per app across every launch method; display names never become path segments), and structured bootstrap milestone logging in app.log.
  - @opentray/spec@0.27.5

## 0.27.4

### Patch Changes

- @opentray/spec@0.27.4

## 0.27.3

### Patch Changes

- Updated dependencies [b9ebc3c]
  - @opentray/spec@0.27.3

## 0.27.2

### Patch Changes

- @opentray/spec@0.27.2

## 0.27.1

### Patch Changes

- @opentray/spec@0.27.1

## 0.27.0

### Patch Changes

- @opentray/spec@0.27.0

## 0.26.0

### Patch Changes

- @opentray/spec@0.26.0

## 0.25.0

### Patch Changes

- @opentray/spec@0.25.0

## 0.24.0

### Patch Changes

- @opentray/spec@0.24.0

## 0.23.0

### Patch Changes

- @opentray/spec@0.23.0

## 0.22.0

### Minor Changes

- 255d312: Shared icon kernel and synthesized default app icons.

  - New `@opentray/icon`: one app-icon generation kernel (glyph defaults, composition, squircle tiling, ICNS/ICO/Linux PNG encoding) on a WebAssembly image stack (jsquash + resvg). No sharp/libvips anywhere.
  - The runtime now synthesizes a first-letter glyph default icon into the Darwin bundle when `appIcon` is omitted, cached under the runtime directory, with `appBundle.defaultAppIcon: false` as the explicit opt-out. Core declared-catalog semantics are unchanged.
  - `@opentray/vite-plugin` and create-opentray now consume the shared kernel; the Vite plugin keeps its public API and drops sharp.

### Patch Changes

- @opentray/spec@0.22.0

## 0.21.1

### Patch Changes

- @opentray/spec@0.21.1

## 0.21.0

### Patch Changes

- @opentray/spec@0.21.0

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
