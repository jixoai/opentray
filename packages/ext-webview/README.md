# @opentray/ext-webview

Official rich popup extension for OpenTray.

## Role

- Provide borderless tray-adjacent popup spaces.
- Use platform WebView engines through the native extension layer.
- Route WebView messages through the owning `spaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle.

The facade stays platform-neutral. Native libraries are optional platform packages named `@opentray/ext-webview-<os>-<arch>`, and the daemon resolves them through the dynamic extension discovery law when `load-ext` requests `@opentray/ext-webview`.

The platform dylib owns the full WebView protocol and native runtime. `opentray` forwards scoped extension traffic to it, but does not keep a daemon-side WebView parser or native WebView builder.

## Frameless Roadmap

TODOs for the next WebView capability stage:

- Implement frameless windows as an extension-owned capability, not as a daemon special case.
- Expose the native title-bar actions that frameless UI removes from the platform chrome, including `close`, `resize`, and `move`, through a WebView-to-extension JS bridge.
- Define the drag/resize hit-test contract before implementation so custom HTML chrome can remain type-safe and platform-specific behavior stays behind the native extension boundary.
- Add transparent background support where the platform WebView and window compositor can do it reliably.
- Treat Windows background transparency as a best-effort capability with explicit platform notes because Windows 7, Windows 10, and Windows 11 have different compositor behavior.
- Research background blur / acrylic / vibrancy as optional visual capabilities, but do not force support when it would make the WebView slow or visually unstable.
- Return typed unsupported/capability errors for transparency or blur features that a platform cannot provide cleanly.

## Example

Run a broker-free example that sends WebView `show`, `navigate`, `postMessage`, and `hide` commands through the normal OpenTray extension command path:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

To expose the injected page API, enable it on `show`:

```ts
await webview.show({
  type: "show",
  html: "<main><h1>OpenTray</h1></main>",
  width: 420,
  height: 260,
  nativeWindowApi: true,
  bindWindowGlobals: true,
});
```

When enabled, the page receives:

- `navigator.window`
- `navigator.opentrayWindow`
- optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when `bindWindowGlobals` is `true`

The injected capability follows a Tauri-style facade:

- `await navigator.window.invoke("getCapabilities")`
- `await navigator.window.listen("resized", handler)`
- `await navigator.window.resizeTo(520, 320)`
- `await navigator.window.setStyle({ frameless: true })`

Current first-stage native support:

- macOS: `close`, `moveTo`, `resizeTo`, `getCapabilities`, `getStyle`, `setStyle({ frameless })`
- macOS: global override binding through `bindWindowGlobals`
- macOS: `transparent` and `backgroundEffect` reject with typed unsupported errors for now
- Linux / Windows: the native runtime package may exist for packaging validation, but unsupported runtime paths must fail explicitly until the platform implementation lands
