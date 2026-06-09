# @opentray/ext-lynx

Official macOS-first Lynx window extension for OpenTray.

## Role

- Launch a real OpenTray-owned Lynx runtime host from the generic OpenTray extension host path.
- Expose native window controls through the Lynx host bridge when enabled.
- Keep Lynx bundle loading, runtime extraction, process lifecycle, and sizing policy inside the extension artifact.
- Treat `.lynx.bundle` files as client-owned payloads scoped to the owning `spaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle or daemon policy.

The facade stays platform-neutral. Native libraries are optional platform packages named `@opentray/ext-lynx-<os>-<arch>`, and the daemon resolves them through the dynamic extension discovery law when `load-ext` requests `@opentray/ext-lynx`.

The macOS native dylib owns the Lynx command protocol and the runtime sidecar contract. `opentray` forwards scoped extension traffic to it, but does not keep a daemon-side Lynx parser or a daemon-owned Lynx runtime.

## Command Surface

Public commands:

- `show({ bundlePath, width?, height?, minWidth?, minHeight?, maxWidth?, maxHeight?, nativeWindowApi?, bindWindowGlobals?, nativeScreenApi?, bindScreenGlobals?, title?, icon?, style? })`
- `hide()`

Runtime events:

- `shown`
- `hidden`

`show` expects a real `.lynx.bundle` file path. On macOS, the native extension extracts `OpenTrayLynxRuntime.app.zip`, stages the external bundle into the runtime resources, and launches:

```text
file://lynx?local://opentray-external/main.lynx.bundle
```

## Window Bridge

When `nativeWindowApi: true` is enabled on `show`, the page receives:

- `navigator.window`
- `navigator.opentrayWindow`
- `getTitle()` / `setTitle(title)`
- `getIcon()` / `setIcon(icon)`
- optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when `bindWindowGlobals` is `true`

When `nativeScreenApi: true` is enabled on `show`, the page also receives:

- `navigator.screen`
- `navigator.opentrayScreen`
- optional `window.getScreenDetails()` override when `bindScreenGlobals` is `true`

The injected capability follows the same public vocabulary as `@opentray/ext-webview`:

- `await navigator.window.invoke("getCapabilities")`
- `await navigator.window.listen("resized", handler)`
- `await navigator.window.resizeTo(520, 320)`
- `await navigator.window.setTitle("OpenTray Lynx")`
- `await navigator.window.setIcon({ type: "rgba", width: 16, height: 16, data: [...] })`
- `await navigator.window.setStyle({ frameless: true })`
- `await navigator.screen.getScreenDetails()`

OpenTray keeps the public surface aligned, but the transport is Lynx-native: Native Modules, runtime-attached bootstrap, and `GlobalEventEmitter`. The daemon does not keep a Lynx-specific controller.

Unlike `ext-webview`, the dedicated Lynx runtime is its own macOS app process. That means `title` and `icon` updates may safely project to both the window and the runtime app identity inside that process.

## Launch Controls

OpenTray now treats Lynx startup behavior as an explicit host-feature set rather than an implicit profile.

At the extension protocol layer:

- `nativeWindowApi`
- `bindWindowGlobals`
- `nativeScreenApi`
- `bindScreenGlobals`
- `style: { frameless: true }`

`style.frameless` currently means "remove native window chrome". It does not turn the whole page into a draggable background region, because that would swallow Lynx pointer/input behavior. If you need drag affordances, build them explicitly on top of `navigator.window.moveTo()` / `resizeTo()` or wait for a future drag-region capability.

Window size is fixed or explicit:

- default smoke shell: `720x420`
- explicit `width` / `height` override the fallback shell
- `minWidth` / `minHeight` / `maxWidth` / `maxHeight` clamp the native frame

## Example

Run the facade-only protocol example:

```bash
pnpm --filter @opentray/ext-lynx example:lynx
```

Use the source-tree daemon Lynx example when you want a real native window:

```bash
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle --features "nativeWindowApi,bindWindowGlobals"
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle --features "*,!frameless"
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle --features "*,!nativeScreenApi"
```

The published `opentray` CLI intentionally stays limited to daemon lifecycle and health. Lynx visual acceptance belongs to source-tree examples or the OpenTray skill workflow. Pass `--bundle <path-to-main.lynx.bundle>` when you want to replace the workspace review bundle with your own payload.

The example starts with a fixed host shell, sets an initial title/icon, applies an explicit host-feature expression, and exposes tray items for:

- `Show Window`
- `Hide Window`
- `Quit Smoke`

Inside the Lynx window, use the rendered buttons to verify `getCapabilities`, `getStyle`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `navigator.screen.getScreenDetails()`, `resizeTo`, `moveTo`, `setStyle({ frameless })`, `window.resizeTo()`, `window.getScreenDetails()`, and close behavior visually.

## Runtime Sidecar

The darwin platform package ships two artifacts:

- `lib/libopentray_ext_lynx.dylib`
- `runtime/OpenTrayLynxRuntime.app.zip`

The native extension resolves the runtime zip next to the loaded dylib by default. For local debugging, you may override the sidecar path with `OPENTRAY_LYNX_RUNTIME_ZIP=/absolute/path/to/OpenTrayLynxRuntime.app.zip`.

For macOS-side runtime diagnostics, keep the default quiet behavior for normal users and opt in only while debugging:

```bash
OPENTRAY_LYNX_RUNTIME_STDIO=inherit \
OPENTRAY_LYNX_DEBUG=host-events,engine-tap \
OPENTRAY_LYNX_DEBUG_LOG_PATH=/private/tmp/opentray-lynx-runtime.log \
  pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle \
  2>&1 | tee /private/tmp/opentray-lynx-smoke.log
```

Accepted `OPENTRAY_LYNX_RUNTIME_STDIO` values:

- `inherit`: forward `OpenTrayLynxRuntime` stdout/stderr into the parent terminal
- `quiet` / `null` / unset: keep the runtime silent

Accepted `OPENTRAY_LYNX_DEBUG` modes:

- `host-events`: trace AppKit `NSWindow` input events before they enter Lynx
- `host-title`: project the last traced host event into the window title for visual confirmation; keep this off unless you specifically want a visual probe
- `engine-tap`: trace the patched Lynx desktop tap pipeline
- `all`: enable every available runtime diagnostic mode

`OPENTRAY_LYNX_DEBUG_LOG_PATH` writes runtime diagnostics straight to a file from inside the macOS host process. Use it when terminal inheritance alone is not trustworthy enough.

`OPENTRAY_LYNX_HOST_FEATURES` selects which host behaviors OpenTray layers onto the same `OpenTrayLynxRuntime.app` carrier:

- empty / unset: baseline carrier behavior only
- `full` or `*`: enable every startup feature
- comma-separated tokens such as `nativeWindowApi,bindWindowGlobals,nativeScreenApi,bindScreenGlobals,frameless`
- explicit disable tokens such as `*,!nativeScreenApi`

If you are debugging pointer/input regressions, try `*,!frameless` first. That keeps the window and screen bridge enabled while removing the borderless shell from the equation.

Recommended acceptance order:

1. Run baseline first with no host-feature expression until the macOS window behaves like a normal app again.
2. Then run explicit feature sets on the same carrier artifact and verify OpenTray-only capabilities on top of that recovered baseline.

Interpretation:

- host logs present, engine logs absent: repair the Lynx macOS input bridge or pointer translation before gesture/tap dispatch
- engine `page-dispatch` / `isolated-tap-up` logs present, but no `touch-enter` / `bubble-enter`: repair gesture routing or target dispatch inside Lynx
- `touch-enter` / `bubble-enter` logs present, but the page still does not react: repair the JS binding/runtime adapter layer

`OPENTRAY_LYNX_RUNTIME_STDIO` is only a transport-level debug switch. It does not change tray, window, or extension behavior.

Current first-stage native support:

- macOS arm64 and x64: real runtime extraction and external bundle launch
- macOS arm64 and x64: `navigator.window` / `navigator.opentrayWindow`
- macOS arm64 and x64: `navigator.screen` / `navigator.opentrayScreen`
- macOS arm64 and x64: `close`, `moveTo`, `resizeTo`, `getCapabilities`, `getStyle`, `setStyle({ frameless })`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `getScreenDetails`
- macOS arm64 and x64: dedicated runtime bundle icon plus dynamic Dock/window icon projection
- macOS arm64 and x64: `transparent` and `backgroundEffect` reject with typed unsupported errors for now
- Linux / Windows: not published yet; OpenTray should fail explicitly instead of pretending support exists
