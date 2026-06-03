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

- `show({ bundlePath, fitContentSize?, width?, height?, minWidth?, minHeight?, maxWidth?, maxHeight?, nativeWindowApi?, bindWindowGlobals?, nativeScreenApi?, bindScreenGlobals?, title?, icon?, style? })`
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

## Fit-Content Policy

Lynx supports host-owned fit-content sizing, but that is a host policy, not a DOM/body trick.

OpenTray applies this product default for standalone Lynx windows:

- `fitContentSize` defaults to `true`
- `fitContentSize: false` opts out
- explicit `width` / `height` win on the corresponding axis
- `minWidth` / `minHeight` / `maxWidth` / `maxHeight` clamp the final frame

This default-on behavior is an OpenTray product decision for popup-style usage. It is not a claim that Lynx Explorer itself defaults to fit-content in every host.

## Example

Run the facade-only protocol example:

```bash
pnpm --filter @opentray/ext-lynx example:lynx
```

Use the installed CLI smoke when you want a real native window:

```bash
pnpm --filter opentray cli -- smoke daemon-lynx
```

The published `opentray` CLI carries an official Lynx review bundle for final human acceptance. Pass `--bundle <path-to-main.lynx.bundle>` only when you want to override that package-owned audit asset with your own bundle.

The smoke command now starts in fit-content mode, sets an initial title/icon, enables `navigator.window`, enables `navigator.screen`, enables global overrides for validation, and exposes tray items for:

- `Show Fit Window`
- `Show Fixed Window`
- `Hide Window`
- `Quit Smoke`

Inside the Lynx window, use the rendered buttons to verify `getCapabilities`, `getStyle`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `navigator.screen.getScreenDetails()`, `resizeTo`, `moveTo`, `setStyle({ frameless })`, `window.resizeTo()`, `window.getScreenDetails()`, and close behavior visually.

## Runtime Sidecar

The darwin platform package ships two artifacts:

- `lib/libopentray_ext_lynx.dylib`
- `runtime/OpenTrayLynxRuntime.app.zip`

The native extension resolves the runtime zip next to the loaded dylib by default. For local debugging, you may override the sidecar path with `OPENTRAY_LYNX_RUNTIME_ZIP=/absolute/path/to/OpenTrayLynxRuntime.app.zip`.

Current first-stage native support:

- macOS arm64 and x64: real runtime extraction and external bundle launch
- macOS arm64 and x64: `navigator.window` / `navigator.opentrayWindow`
- macOS arm64 and x64: `navigator.screen` / `navigator.opentrayScreen`
- macOS arm64 and x64: `close`, `moveTo`, `resizeTo`, `getCapabilities`, `getStyle`, `setStyle({ frameless })`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `getScreenDetails`
- macOS arm64 and x64: default-on fit-content with explicit fixed-size opt-out
- macOS arm64 and x64: dedicated runtime bundle icon plus dynamic Dock/window icon projection
- macOS arm64 and x64: `transparent` and `backgroundEffect` reject with typed unsupported errors for now
- Linux / Windows: not published yet; OpenTray should fail explicitly instead of pretending support exists
