# @opentray/ext-webview

Official rich popup extension for OpenTray.

## Role

- Provide borderless tray-adjacent popup spaces.
- Use platform WebView engines through the native extension layer.
- Route WebView messages through the owning `spaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle.

The facade stays platform-neutral. Native libraries are optional platform packages named `@opentray/ext-webview-<os>-<arch>`, and the daemon resolves them through the dynamic extension discovery law when a mounted WebView capability loads `@opentray/ext-webview`.

The platform dylib owns the full WebView protocol and native runtime. `opentray` forwards scoped extension traffic to it, but does not keep a daemon-side WebView parser or native WebView builder.

## Maturity Truth

Read the current platform story as four different truths, not one vague support flag:

- `stable`: current human-visible acceptance path
- `alpha`: published contract or package path that is still pre-stable for real user-facing runtime behavior
- `unsupported by design`: the runtime deliberately rejects a request because it does not truthfully map to the current substrate
- `unavailable by context`: the capability exists, but the current WebView session does not have authoritative data for that specific request

Current WebView maturity:

- macOS: `stable` for the window capability surface documented below
- Windows: `alpha` for the first visible WebView2-backed runtime, common window bridge, and lifecycle behavior
- Linux: `alpha` for the package and contract surface; visible native runtime behavior is still explicitly unsupported
- requesting `platform.windows.*` from the macOS runtime, or unknown macOS material/material-state values: `unsupported by design`
- tray bounds with no authoritative tray anchor in the current session: `unavailable by context`

## Window Capability

`@opentray/ext-webview` owns its native window capability surface inside the extension atom. The broker only forwards extension traffic.

macOS support includes:

- frameless windows through native `NSWindow` style projection
- transparent WebView/window background through Wry + AppKit
- material backgrounds through `window-vibrancy`
- keep-on-top window level on macOS
- titlebar overlay geometry through `navigator.opentrayWindow.overlay`
- native app-region dragging through `startAppRegionDrag()`
- minimize, maximize, and restore window-state controls
- adjustable content corner radius through `style.platform.macos.cornerRadius`
- native title and icon state
- declarative `document.title` / native-title synchronization
- declarative favicon / native-icon synchronization, with best-effort native projection
- screen details through `navigator.screen` / `navigator.opentrayScreen`
- tray bounds through `navigator.opentray.tray.getBounds()`
- source-scoped native capability policy with local-only defaults for remote safety

Windows alpha support includes:

- visible WebView2-backed windows through Wry
- `show`, `hide`, `destroy`, `setContent`, `navigate`, `evaluate`, and `postMessage`
- `navigator.window` / `navigator.opentrayWindow` bridge injection with source-scoped `nativeApiPolicy`
- `close`, `moveTo`, `resizeTo`, `minimize`, `maximize`, `restore`, `getWindowState`, `isMaximized`, and `isMinimized`
- `getStyle` / `setStyle` for common `frameless`, `background`, and `keepOnTop`
- `windowControlsOverlay` geometry, `startAppRegionDrag()`, and subscription-driven bridge events
- title sync and native window/taskbar icon projection for RGBA icons, local icon files, and PNG data URLs
- Windows DWM background materials through `style.background`: `auto`, `mica`, `acrylic`, and `tabbed`
- Windows 11 corner preference through `style.platform.windows.cornerPreference`: `default`, `doNotRound`, `round`, and `roundSmall`
- current-monitor screen snapshot through `navigator.screen` / `navigator.opentrayScreen`
- tray bounds projection through `navigator.opentray.tray.getBounds()`

Full Windows multi-monitor enumeration remains an alpha follow-up; the current screen API is a current-monitor snapshot.

Visual effects stay capability-gated. Unsupported or platform-fragile effects must reject with typed unsupported errors rather than faking success.

For glass or blur-style surfaces, two things must line up at once:

- native background must be one mutually exclusive mode: `transparent`, `semantic: blur`, or `platformMaterial`
- the page must leave some regions genuinely transparent instead of covering the whole window with opaque HTML or CSS blur overlays

Treat `style.background` as the single source of truth for native backing and material composition:

- `{ kind: "opaque" }` means an opaque native/WebView backing
- `{ kind: "transparent" }` means a clear native/WebView backing with no material
- `{ kind: "semantic", token: "blur" }` means the runtime should choose the platform blur material, currently Windows Acrylic and macOS `hudWindow`
- `{ kind: "platformMaterial", material: "..." }` means a substrate-specific material name, such as Windows `mica` or macOS `hudWindow`
- material modes clear the native/WebView backing as part of the same transaction; callers must not combine a separate transparent flag with material fields

Material selection has a second axis: background state. Use `background.state` to choose whether the system material follows the window focus state or stays forced active/inactive:

- `followsWindowActiveState` keeps the platform default behavior
- `active` requests the vivid active appearance, which is often the right choice for tray panels and accessory-app utility surfaces
- `inactive` requests the subdued inactive material appearance

macOS maps the state to `NSVisualEffectState`. The current Windows DWM backdrop path exposes only `followsWindowActiveState`; requests for forced `active` or `inactive` return a typed unsupported error until the runtime grows a composition-controller path that can truthfully force input-active state.

If the page paints every pixel itself, the native material is still present, but users will not see it.

For tray panels or other glass-like borderless surfaces, keep these as hard rules:

- reset `html, body` margin and padding to `0`
- keep the native window background transparent
- do not draw the outer shell in HTML with `box-shadow`, root-level `border-radius`, or fake blur
- use native window style for outer corners and background material
- treat the page as content inside the native box, not as the box itself

## Example

Mount WebView on a tray, then create a tray-scoped window. The first window command loads the native extension automatically:

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const tray = (await createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "file", path: "./tray-icon.png" },
})).extend(WebviewExt);

const webview = tray.createWebviewWindow({
  html: "<main><h1>OpenTray</h1></main>",
  width: 420,
  height: 260,
});

await webview.show();
```

Use `attachWebview(tray)` only as a compatibility adapter for older code. New code should prefer `tray.extend(WebviewExt)` so multiple trays can mount isolated WebView instances.

Run a broker-free example that sends WebView `show`, `navigate`, `postMessage`, and `hide` commands through the normal OpenTray extension command path:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

Inside this repo, `pnpm --filter opentray example:webview-control` is the API exercise demo, while `pnpm --filter opentray example:tray-panel` is the canonical tray-anchored glass recipe.
The manual walkthrough for all three CLI examples lives in [../cli/examples/EXAMPLE.md](../cli/examples/EXAMPLE.md).

To expose the injected page API, enable it on the window options or a later `show(...)` patch:

```ts
const webview = tray.createWebviewWindow({
  html: "<main><h1>OpenTray</h1></main>",
  width: 420,
  height: 260,
  title: "OpenTray WebView",
  style: {
    frameless: true,
    keepOnTop: true,
    background: {
      kind: "platformMaterial",
      material: "hudWindow",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: 18,
      },
    },
  },
  windowControlsOverlay: true,
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeScreenApi: true,
  bindScreenGlobals: true,
  nativeTrayApi: true,
  titleSync: {
    documentToWindow: true,
    windowToDocument: true,
  },
  iconSync: {
    faviconToWindow: true,
    windowToFavicon: true,
  },
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
    window: ["https://example.com"],
    screen: ["https://example.com"],
    tray: ["https://example.com"],
    titleSync: ["https://example.com"],
    iconSync: ["https://example.com"],
  },
});

await webview.show();
```

Window session law:

- the first `show(...)` for a tray creates the native window session
- `hide()` only hides that session; it does not destroy the page runtime
- a repeated compatible `show(...)` reuses the existing page runtime, even if the caller repeats the same `html` or `url`
- explicit content replacement belongs to `setContent({ type: "setContent", html | url })` or `navigate(url)`
- explicit session teardown belongs to `destroy()`

This is intentional. `show(...)` is the visibility/bootstrap verb, not the implicit reload verb.

Without `nativeApiPolicy`, page-exposed native capability is local-only by default. Remote URLs do not receive `navigator.window`, `navigator.screen`, global bindings, or page-native sync unless their source is explicitly allowed.

When enabled, the page receives:

- `navigator.window`
- `navigator.opentrayWindow`
- `navigator.screen`
- `navigator.opentrayScreen`
- `navigator.opentray.tray`
- optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when `bindWindowGlobals` is `true`
- optional `window.getScreenDetails()` override when `bindScreenGlobals` is `true`
- `navigator.opentrayWindow.overlay` when `windowControlsOverlay` is `true`

The injected capability follows a typed facade, with a raw `invoke(cmd, payload)` escape hatch for parity with the private bridge:

- `await navigator.window.getCapabilities()`
- `await navigator.window.listen("resized", handler)`
- `await navigator.window.resizeTo(520, 320)`
- `await navigator.window.minimize()`, `maximize()`, and `restore()`
- `await navigator.window.getWindowState()`, `isMaximized()`, and `isMinimized()`
- `await navigator.window.setStyle({ frameless: true, platform: { macos: { cornerRadius: 18 } } })`
- `await navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- `await navigator.opentrayWindow.startAppRegionDrag()`
- `await navigator.window.setTitle("OpenTray Status")`
- `await navigator.window.setIcon({ type: "href", href: "/favicon.ico" })`
- `await navigator.window.setIcon(null)` to clear the logical native icon
- `await navigator.screen.getScreenDetails()`
- `await navigator.opentray.tray.getBounds()`
- `await navigator.window.invoke("getCapabilities")` when a page intentionally wants raw command parity

From the host side, keep the lifecycle verbs explicit:

- `await webview.show({ ... })` to create-or-show the tray session
- `await webview.hide()` to hide without destroying the page runtime
- `await webview.setContent({ type: "setContent", html })` to replace local HTML content explicitly
- `await webview.navigate("https://example.com/status")` as the URL-focused content replacement alias
- `await webview.destroy()` to destroy the tray-scoped session

Current native support:

- macOS: `close`, `moveTo`, `resizeTo`, `getCapabilities`, `getStyle`, `setStyle`
- macOS: `minimize`, `maximize`, `restore`, `getWindowState`, `isMaximized`, `isMinimized`, and native app-region drag
- macOS: `keepOnTop` through `setStyle({ keepOnTop: true })`
- macOS: `style.platform.macos.cornerRadius` through layer-backed content clipping
- macOS: `getTitle`, `setTitle`, `getIcon`, `setIcon`
- macOS: titlebar overlay geometry through `windowControlsOverlay`
- macOS: `navigator.screen.getScreenDetails`
- macOS: tray bounds projection through `navigator.opentray.tray.getBounds()`
- macOS: transparent background and material effects through `style.background`, including `hudWindow`, `sidebar`, `windowBackground`, `contentBackground`, and `underWindowBackground`
- macOS: global override binding through `bindWindowGlobals` and `bindScreenGlobals`
- Windows alpha: visible WebView2-backed windows, lifecycle verbs, content replacement/navigation, `evaluate`, `postMessage`, common window bridge commands, title/icon sync, current-monitor screen snapshot, tray bounds projection, and global override binding through `bindWindowGlobals` / `bindScreenGlobals`
- Windows alpha: `frameless`, `background`, `keepOnTop`, and `style.platform.windows.cornerPreference`
- Linux: the native runtime package is currently an alpha distribution atom; unsupported runtime paths must fail explicitly until a visible platform implementation lands

Keep the unsupported taxonomy explicit:

- runtime absent: `webview runtime is not implemented for this platform`
- platform-family mismatch: a Windows/Linux style family is requested on the macOS runtime, macOS material/corner style is requested on Windows, or a platform-specific family is otherwise requested on the wrong substrate
- declarative gate: the runtime could provide a capability, but the current WebView session did not enable it, such as overlay geometry without `windowControlsOverlay`
- context unavailable: the capability exists, but the current session has no authoritative data, such as tray bounds when no tray anchor was injected

## Authority Model

Keep the capability ownership lines explicit:

- Trusted backend tray geometry is the core-routed capability: `await tray.getBounds()`
- Page tray geometry is the WebView projection of that same tray capability: `await navigator.opentray.tray.getBounds()`
- The page tray API is intentionally a projection, not a second authority. Today it is injected from show-time tray context so the page can anchor layout without keeping a long-lived broker callback alive inside the WebView runtime.
- `navigator.opentrayWindow` and `navigator.opentrayScreen` are extension-owned page APIs. They are not broker-wide contracts in `opentray-core`.
- `screen` stays in `@opentray/ext-webview` for now because its event model, coordinate-space law, and cross-platform substrate differences are not yet proven shared enough for core.
- The package also exports page-side global typings for `navigator.window`, `navigator.opentrayWindow`, `navigator.opentrayScreen`, `navigator.opentray`, and `window.getScreenDetails()` so TypeScript page code matches the injected runtime shape.

The page bridge does not currently expose maturity labels through `getCapabilities()`. For now, treat README, skills, and the release channel as the authoritative maturity surface.

## Events

Native events are subscription-driven. The extension only pushes page callbacks for events with active listeners; it does not poll or broadcast window state to pages that did not subscribe.

Common event names:

- `stylechange`: emitted after `setStyle(...)` changes the native style state
- `titlechange`: emitted after `setTitle(...)` or enabled document-title sync changes native title state
- `iconchange`: emitted after `setIcon(...)` or enabled favicon sync changes native icon state
- `windowstatechange`: emitted after `minimize()`, `maximize()`, or `restore()`
- `moved` / `resized`: emitted after extension-owned move or resize requests
- `overlay.geometrychange`: emitted through `navigator.opentrayWindow.overlay.listen("geometrychange", ...)`

For favicon-to-native-icon projection, prefer a materialized PNG data URL such as a `canvas.toDataURL("image/png")` result. URL-backed or SVG favicons may remain logical icon state when the platform cannot convert them into a native image handle.

## Window Recipes

Native framed window:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  title: "Status",
  nativeWindowApi: true,
});
```

Overlay titlebar:

```ts
await webview.show({
  type: "show",
  html,
  width: 680,
  height: 420,
  nativeWindowApi: true,
  windowControlsOverlay: true,
  style: {
    background: { kind: "semantic", token: "blur" },
  },
});
```

In the page, use overlay geometry to avoid native window controls and start native dragging from your custom titlebar:

```ts
const pageWindow = navigator.opentrayWindow;
const rect = await pageWindow.overlay?.getTitlebarAreaRect();
customTitlebar.style.paddingLeft = `${rect?.x ?? 0}px`;
customTitlebar.addEventListener("pointerdown", () => {
  void pageWindow.startAppRegionDrag();
});
```

Borderless glass shell:

```ts
await webview.show({
  type: "show",
  html,
  width: 760,
  height: 520,
  nativeWindowApi: true,
  windowControlsOverlay: true,
  style: {
    frameless: true,
    background: {
      kind: "platformMaterial",
      material: "hudWindow",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: 18,
      },
    },
  },
});
```

In borderless mode, render your own controls and keep them synchronized with native state:

```ts
const pageWindow = navigator.opentrayWindow;
await pageWindow.listen("windowstatechange", ({ payload }) => {
  maximizeButton.toggleAttribute("data-active", payload.maximized);
});

minimizeButton.onclick = () => void pageWindow.minimize();
maximizeButton.onclick = () => void pageWindow.maximize();
restoreButton.onclick = () => void pageWindow.restore();
```

## Screen-Aware Recipes

Screen details follow the `window.getScreenDetails()` mental model:

```ts
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];
```

Pin a small widget to a visible screen corner:

```ts
const margin = 16;
await navigator.opentrayWindow.setStyle({
  frameless: true,
  keepOnTop: true,
  background: {
    kind: "platformMaterial",
    material: "hudWindow",
    state: "active",
  },
  platform: {
    macos: {
      cornerRadius: 18,
    },
  },
});
await navigator.opentrayWindow.resizeTo(320, 180);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + screen.visibleFrame.width - 320 - margin,
  screen.visibleFrame.y + margin,
);
```

Desktop pets and small companion widgets usually use the same corner-pinned shell, but update their page animation independently from native window movement. Island-like live information streams usually start at the top-center of `visibleFrame`, stay `keepOnTop`, and listen for `resized` / `windowstatechange` only when they need to recompute layout.

## Tray-Anchored Panel Recipe

Use tray bounds when a tray click should open a WebView-owned custom panel instead of a guessed popup:

```ts
const bounds = await tray.getBounds();
await webview.show({
  type: "show",
  html,
  width: 360,
  height: 240,
  fallbackRect: bounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
  nativeWindowApi: true,
  nativeTrayApi: true,
  style: {
    frameless: true,
    background: {
      kind: "platformMaterial",
      material: "hudWindow",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: 18,
      },
    },
  },
});
```

Inside the page, use the same tray capability family when the HTML layout needs to align an arrow, animation origin, or edge treatment with the tray anchor:

```ts
const trayBounds = await navigator.opentray.tray.getBounds();
if (trayBounds.rect) {
  panel.dataset.anchorX = String(trayBounds.rect.x + trayBounds.rect.width / 2);
}
```

For a full runnable example that also folds in `primaryEvent`, `navigator.opentrayScreen.getScreenDetails()`, `frameless`, material background, and `keepOnTop`, run:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray example:tray-panel
```

Inside the repo, that example automatically points the daemon at the freshly built local WebView dylib when `OPENTRAY_EXT_PATH` is not already set, so manual tray-panel iteration does not depend on staging platform packages first.
