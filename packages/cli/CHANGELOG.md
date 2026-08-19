# opentray

## 0.21.1

### Patch Changes

- @opentray/spec@0.21.1
- @opentray/packaging@0.21.1

## 0.21.0

### Patch Changes

- @opentray/spec@0.21.0
- @opentray/packaging@0.21.0

## 0.20.0

### Patch Changes

- @opentray/spec@0.20.0
- @opentray/packaging@0.20.0

## 0.19.1

### Patch Changes

- @opentray/spec@0.19.1
- @opentray/packaging@0.19.1

## 0.19.0

### Patch Changes

- @opentray/spec@0.19.0
- @opentray/packaging@0.19.0

## 0.18.0

### Minor Changes

- f3ddf42: Add a stable Darwin app launch command that remembers the latest caller invocation or executes an explicit shell-free command vector when the app bundle is reopened. Live Dock activation now restores and focuses the most recently active retained app-mode WebView without executing the cold launch command. Persist carrier and broker diagnostics for failed relaunches, converge stale same-app bundles, and recover daemon startup automatically when an interrupted caller leaves a stale broker lock.

### Patch Changes

- Updated dependencies [f3ddf42]
  - @opentray/packaging@0.18.0
  - @opentray/spec@0.18.0

## 0.17.0

### Minor Changes

- 9d45ae4: Materialize stable caller-owned Darwin app bundles with package-derived identity, strict native app-icon variants, and shared build-plugin adapters. Consumers can use a normal install or a prebuilt bundle without relying on a compressed carrier or manually copied runtime files.

### Patch Changes

- Updated dependencies [9d45ae4]
  - @opentray/spec@0.17.0
  - @opentray/packaging@0.17.0

## 0.16.0

### Minor Changes

- f543322: Add the common `style.appMode` shell intent, Core App identity mutation APIs, and Darwin runtime carrier ownership for application-mode WebViews. Consumers can provide `appIcon` at runtime and no longer need the removed Windows-specific switcher field or a keep-on-top workaround for application discoverability.

### Patch Changes

- Updated dependencies [f543322]
  - @opentray/spec@0.16.0

## 0.15.0

### Minor Changes

- fc72702: Resolve native extensions from the facade dependency closure, validate embedded artifact identity before init, preserve structured native errors, and reject stale broker or extension artifacts without consumer cleanup steps.

### Patch Changes

- Updated dependencies [fc72702]
  - @opentray/spec@0.15.0

## 0.14.4

### Patch Changes

- 25233c5: Use a stable, user-writable WebView2 profile path so temporary package runners such as pnpx do not fail during WebView startup.
  - @opentray/spec@0.14.4

## 0.14.3

### Patch Changes

- 55fe7a5: Add common native tray-window auto-hide with keep-on-top and explicit opt-out semantics, keep comparator windows out of Windows task switchers by default, and expose the lifecycle policy through typed styles and capabilities.
  - @opentray/spec@0.14.3

## 0.14.2

### Patch Changes

- b439f36: Restore the Windows 11 frameless WebView top edge while preserving comparator native resize insets, eliminating the retained caption-height gap without regressing native edge and corner resizing.
  - @opentray/spec@0.14.2

## 0.14.1

### Patch Changes

- ec23573: Stabilize Windows material WebView hosting by completing the native parent before WebView2, initializing AppWindow overlay after WebView attachment, stopping window-event polling after transport failure, and aligning the Windows control and residue examples with the accepted native comparator topology and retained tray lifecycle.
  - @opentray/spec@0.14.1

## 0.14.0

### Minor Changes

- 0a0d21e: Add common `style.resizable` support for WebView windows. Framed windows remain user-resizable by default, while frameless windows default to fixed size and opt into native edge and corner resizing with `resizable: true`.

  ## Breaking on Windows

  - Frameless WebViews no longer retain the native resize frame. Set `style.resizable: true` when user-driven frameless resizing is required.

  Windows frameless WebViews now remove legacy title and border rendering, support HWND-owned soft resizing without page resize loops, and exit dedicated GUI brokers after an initialized caller closes.

### Patch Changes

- @opentray/spec@0.14.0

## 0.13.0

### Minor Changes

- 1a3b2a3: Repair the Windows tray-owned WebView shell and notification icon path.

  ## Breaking on Windows

  - WebViews no longer enter the taskbar or Alt+Tab by default. Normal application windows must opt in with `style.appMode: true`.
  - `getBounds`, `moveTo`, and `resizeTo` now use the DWM visible frame rather than the raw Win32 frame with invisible resize borders. Coordinate results can shift by the border delta.

  - Discover a CBS-installed Windows App Runtime bootstrapper, then resolve runtime DLLs from the package graph selected by `MddBootstrapInitialize` so `FrameworkUdk` and `Windowing.Core` cannot be mixed across builds.
  - Initialize WinRT on the HWND-owning thread and complete `AppWindowTitleBar.ExtendsContentIntoTitleBar` before the first visible show.
  - Add common `style.appMode`, defaulting to `false`, so tray utility windows stay out of the taskbar and Alt+Tab unless explicitly opted in.
  - Use DWM visible-frame bounds for the public Windows window geometry contract and compensate invisible resize borders in `moveTo` and `resizeTo`.
  - Keep frameless and overlay WebViews full-client through `WM_NCCALCSIZE`.
  - Preserve the tray icon's native `(HWND, uID)` identity for registration and bounds queries, and fix the vendored Windows RGBA mask so anti-aliased pixels remain visible.

### Patch Changes

- @opentray/spec@0.13.0

## 0.12.0

### Minor Changes

- 4353688: Add instance-scoped WebView devtools commands for host code and injected page code.

  Windows and macOS release builds now compile the native devtools API while preserving the per-window `devtools: true` capability gate. The source examples also support `--release` / `-r` and keep their own WebView instances devtools-enabled so release binaries remain debuggable through explicit APIs.

### Patch Changes

- @opentray/spec@0.12.0

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
  - @opentray/spec@0.11.2

## 0.11.1

### Patch Changes

- 4282a1c: Fix broker binary resolution so installed platform packages are checked before
  workspace fallback. This prevents npm consumers from failing to start the
  runtime when the matching `@opentray/<platform>` package is installed, and it
  updates source-checkout examples to stage the packaged runtime artifact
  explicitly for default-runtime smoke paths.
  - @opentray/spec@0.11.1

## 0.11.0

### Patch Changes

- 1b28aa8: Add app-facing ergonomic menu input for top-level `createTray` and `setMenu`, including string items, hyphen separators, tuple submenus, auto ids, and item-local `onMenuClick` callbacks while preserving pure protocol menu frames.
- b92e8e9: Add OS-scoped tray icon candidates for Darwin, Win32, and Linux. Darwin candidates can carry `isTemplate`, which the tray-icon backend now applies through native template rendering when the Darwin candidate is selected.

  The tray-icon backend now also projects `appName` as final visible tray text when no configured icon/text produces visible pixels, preventing invisible click targets when an app omits an icon or accidentally supplies a transparent image. The `opentray` entrypoint re-exports common app-facing tray types such as `CreateTrayOptions`, `TrayIcon`, and `TrayMenu` so consumers do not need `typeof` inference or direct `@opentray/spec` imports for ordinary app code.

- cd4d563: Update native tray-icon projections in place when `setIcon` and related tray state change, avoiding temporary status-item removal during ordinary tray updates. WebView tray placement now rejects transient invalid tray bounds and reuses the last valid tray anchor before falling back to portable placement. macOS primary tray activation now routes left-click to the primary menu item while preserving the native menu on right-click.
- Updated dependencies [b92e8e9]
  - @opentray/spec@0.11.0

## 0.10.3

### Patch Changes

- beebbcf: Add app/tray identity to extension contexts, expose a gated WebView `opentrayPermissions` management bridge backed by the app-scoped permission store, and release the shared Darwin carrier path used by the badge helper.

  Native browser-engine grants still return typed unsupported results where Wry does not expose an OpenTray-owned permission callback.

  - @opentray/spec@0.10.3

## 0.10.2

### Patch Changes

- 9e5a35d: Cut the current fixed public release line.
- Updated dependencies [9e5a35d]
  - @opentray/spec@0.10.2

## 0.10.1

### Patch Changes

- Cut the current fixed public release line.
- Updated dependencies
  - @opentray/spec@0.10.1

## 0.10.0

### Minor Changes

- b6daba2: Align OpenTray on a single 0.10.0 package line.

  This release adds the `runTrayApp()` onboarding path, simplifies official
  examples around tray-first usage, makes the WebView extension path progressive
  through `tray.extend(WebviewExt)`, refreshes the OpenTray skill tutorial and
  versioning guidance, and moves all public packages into one fixed release group
  so installs resolve a coherent package set.

### Patch Changes

- Updated dependencies [b6daba2]
  - @opentray/spec@0.10.0

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

### Patch Changes

- Updated dependencies [c1ff923]
  - @opentray/spec@0.7.0

## 0.8.1

### Patch Changes

- 9f63f71: Ship the core OpenTray runtime as host-loadable Node binding artifacts staged at `runtime/opentray_runtime.node`, expose Node-side runtime binding resolution diagnostics, and add an explicit headless binding transport for protocol/session runtime checks.

  Remove public daemon lifecycle commands from the `opentray` CLI and stop exporting the transitional local broker transport from `opentray/node`. Source-tree visible diagnostics now use debug-runtime examples while the default visible runtime awaits an explicit host-main-loop binding contract.

  Rename the health response protocol frame from `daemon-health` to `runtime-host-health` and expose the shared health model as `RuntimeHostHealth`.

  Add explicit app identity metadata to runtime host health. Runtime hosts now retain app identity as `appId` / `appName` and keep `callerLabel` as the sanitized runtime routing slug.

  Add the visible Node runtime binding host for macOS and Windows. The default `createTray()` path now targets the in-process visible binding, while `runVisibleRuntimeHost()` in `opentray/node` owns the native host main loop and routes menu/tray events back only to the live caller session. The headless binding and source-tree local broker remain explicit diagnostic modes.

## 0.8.0

### Minor Changes

- 4251cd2: Pin each host application's broker to a caller identity so the process is
  identifiable in the task manager, and retire the shared-surface multi-session
  aggregation model. Also fix createTray() hanging forever when the tray icon is
  omitted (fixes #3) by making icon optional end-to-end and correlating broker
  frame-parse errors to the originating request.

### Patch Changes

- Updated dependencies [4251cd2]
  - @opentray/spec@0.6.0

## 0.7.0

### Minor Changes

- 26024c7: Add broker-backed tray state setters and tray-scoped event helpers to the SDK, including `setTitle`, `setMenu`, `setTooltip`, `setIcon`, and tray-owned click/menu listeners.

  Add protocol 1.1 support for tray title mutation and tray identity on click events.

  Add WebView host geometry commands and the `WebviewPlacementKit` for tray, cursor, and screen-aware panel placement.

### Patch Changes

- Updated dependencies [26024c7]
  - @opentray/spec@0.5.0

## 0.6.0

### Minor Changes

- 5b8c5d7: Stop publishing official Linux native packages for `@opentray/ext-webview`.
  OpenTray core still supports Linux, while the WebView extension now publishes
  native runtime atoms only for macOS and Windows until a real visible Linux
  runtime is available.

  Promote the Windows WebView2 runtime to the stable WebView support matrix and
  remove the public `opentray smoke` subcommands so the CLI remains focused on
  daemon lifecycle and health. Visual smoke orchestration now lives in OpenTray
  skills and source-tree examples.

## 0.5.2

### Patch Changes

- Updated dependencies [e0d6274]
  - @opentray/spec@0.4.1

## 0.5.1

### Patch Changes

- cce4e9b: Replace the borrowed `LynxExplorer.app` carrier with the OpenTray-owned `OpenTrayLynxRuntime.app.zip` host path for macOS Lynx releases.

  The published `opentray` CLI now carries a package-owned Lynx review bundle, so `opentray smoke daemon-lynx` can serve as the final human audit command after installing from npm without requiring a workspace checkout path.

- 6f8b688: Fix the Lynx window bridge resolver for runtimes that expose `NativeModules` as a lexical global, and refresh the packaged Lynx review bundle.

## 0.5.0

### Minor Changes

- 87e3d17: Refresh the WebView window contract so common shell traits stay separate from platform-specific
  style families, make tray bounds provenance-bearing instead of collapsing to `Rect | null`, and
  restore the official source-tree WebView example smoke paths.

  The published guidance now teaches `style.platform.macos.*` and `trayBounds.rect`, and the macOS
  runtime rejects real cross-platform style mismatches without falsely rejecting placeholder platform
  families during startup.

### Patch Changes

- d411fe7: Clarify the current WebView platform maturity story across the published README surfaces and repo skills, distinguishing:

  - macOS as the current stable human-visible runtime path
  - Windows and Linux as alpha runtime territory even when platform packages exist
  - typed `unsupported` results that are deliberate substrate truth
  - `unavailable` results that only mean the current session lacks authoritative context

  Add an alpha-channel publish path based on changesets snapshot versioning so prerelease testing can use `npm i opentray@alpha` without consuming the later stable version numbers.

  <!-- opentray-preview {"alias":"webview-preview-20260605-1"} -->

- 94fe5fc: Expand the WebView extension window capability surface with macOS title/icon/screen/style controls, overlay titlebar geometry, app-region drag, borderless glass styling, window state queries/events, and screen-aware development recipes.

  Add an opentray webview-control example and smoke coverage for exercising the richer WebView window contract locally.

- Updated dependencies [87e3d17]
  - @opentray/spec@0.4.0

## 0.4.0

### Minor Changes

- f56f3ab: Add the official macOS-first Lynx extension, including the public `opentray smoke daemon-lynx` flow, darwin runtime sidecar packages, and release staging for `LynxExplorer.app.zip`.

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
