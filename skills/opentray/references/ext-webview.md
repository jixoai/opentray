# ext-webview

Use this reference when the user asks how to use the official OpenTray WebView extension.

## Install

```bash
pnpm add opentray @opentray/ext-webview
```

The facade package stays platform-neutral. Official native WebView packages are published for macOS and Windows. Linux remains supported by OpenTray core, but `@opentray/ext-webview` does not publish a Linux native runtime package.

## Public Shape

Attach the facade to an existing tray handle:

```ts
import { attachWebview } from "@opentray/ext-webview";

const webview = attachWebview(tray);
await webview.show({
  type: "show",
  html: "<main>Hello</main>",
  width: 360,
  height: 220,
  fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
});
```

Supported host commands:

- `show`
- `hide`
- `navigate`
- `evaluate`
- `postMessage`
- `moveTo`
- `resizeTo`
- `getBounds`
- `getScreenDetails` on the backend WebView extension capability, not on `navigator.opentrayWindow`
- `drainIpcMessages` on `WebviewWindowHandle` for page-to-backend and native-to-backend intents
- `setStyle`
- `setBackground`
- `setMinimumSize` / `setMaximumSize`

Page-side `navigator.opentrayWindow.show()` and `hide()` are reversible visibility controls for an existing window session. They are not content replacement verbs; use `setContent`, `navigate`, or `destroy` when that is the actual product intent.

Host-side `createWebviewWindow(options)` is the bootstrap declaration for one tray-scoped session. Call it once, keep that `WebviewWindowHandle`, and call `show()` / `hide()` for repeated tray activations. After the first successful show, `show()` must restore visibility without replaying startup width, height, style, content, or native API flags. Use `resizeTo`, `moveTo`, `setStyle`, `setBackground`, `setMinimumSize`, `setMaximumSize`, `setContent`, or `navigate` when a real mutation is intended.

## Placement Kit

Use `WebviewPlacementKit` when host code needs to place a WebView surface relative to tray, cursor, or screen geometry. It is a composition helper, not a `createWebviewPanel` abstraction.

```ts
import { WebviewExt, WebviewPlacementKit } from "@opentray/ext-webview";

const tray = await createTray(options);
const webviewTray = tray.extend(WebviewExt);
const openPanelId = 1;
const panel = webviewTray.createWebviewWindow({
  html,
  width: 328,
  height: 244,
  nativeWindowApi: true,
});

await panel.show();
tray.onMenuClick(({ itemId }) => {
  if (itemId === openPanelId) void panel.show();
});
const placementWatch = await new WebviewPlacementKit({ tray, screen: webviewTray }).watch(panel, {
  placement: "tray",
  width: 328,
  height: 244,
  placementMargin: 8,
});
```

Supported placements include `tray`, `cursor`, `screen-center`, screen edges, screen corners, and edge-snapping modes. `watch()` is the default continuous placement shape; it should yield to live user drag/resize and only reapply after the bounds settle. A placement watch follows position by default; it must not keep resizing the window back to an old width/height after the user or backend changes size. Use `applyOnce()` only when a one-shot placement, including size application, is intentional. Treat the returned `source` and `kind` as provenance; tray placement can be unavailable by context even when WebView itself is supported.

Geometry law: `WebviewPlacementKit` consumes logical desktop pixels for the full `Rect`. Host code should normalize native screen, tray, and window bounds before they reach placement math; do not mix physical `x/y` with logical `width/height`.

For tray-anchored panels, prefer `getBounds()` as the source of truth after user drag/resize. Keep `WebviewPlacementKit`, `styleKit`, and `mediaQueryKit` in backend code. If page controls need to trigger backend behavior, send an intent through `navigator.opentray.ipc.postMessage(...)`, drain it with `WebviewWindowHandle.drainIpcMessages()`, then let the backend call the kit. Stop placement/media/message watches when the panel hides or closes so polling does not fight the window lifecycle.

## Overlay and Frameless Guidance

Do not auto-inject titlebars, drag strips, or CSS into the user's HTML. For overlay titlebars, explain that the page should deliberately read `navigator.opentrayWindow.overlay.getTitlebarAreaRect()` and bind native drag behavior with `startAppRegionDrag()` where the product wants drag. For borderless panels, remind the user that once native controls disappear, their app owns controls, focus states, and accessibility.

Lightweight tray panels usually behave like desktop cards. If the whole document develops root-level scrollbars, the experience often feels less native than choosing a better window size, responsive card layout, or an intentional internal scroll region. Explain that product tradeoff instead of prescribing a universal CSS block.

`example:placement` is the source-tree demo for `WebviewPlacementKit` tray, screen, and edge placement. `example:mediaQuery` is the source-tree demo for `mediaQueryKit` plus `styleKit` responsive native-window behavior.

## Examples

Protocol-only facade example:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

Real native smoke is a visual acceptance recipe, not an `opentray` CLI subcommand. In a source checkout, use:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
```

## Platform Truth

- macOS is the stable human-visible acceptance path.
- Windows is the stable WebView2-backed runtime path.
- Linux is unsupported for `@opentray/ext-webview`; do not tell package users to install `@opentray/ext-webview-linux-*`.
- If a platform cannot create a visible native WebView runtime, it should return explicit unsupported/capability failure rather than fake success.

## Geometry Law

Treat OpenTray window, screen, and tray rectangles as one logical desktop pixel system at the public API boundary. Do not mix browser CSS pixels, `devicePixelRatio`, or Win32 physical pixels into `WebviewPlacementKit`, `styleKit`, or `mediaQueryKit`.

Use physical pixels only inside the native substrate when calling Win32 APIs such as `CreateWindowExW`, `SetWindowPos`, `GetWindowRect`, or WebView controller bounds. Overlay titlebar geometry is the exception: it starts physical in the native payload and is converted to CSS pixels by the injected bootstrap script because browser zoom and viewport rules can shift the final page coordinate space.

DPI matters when:

- the code crosses a native boundary and must convert between Win32 and public `Rect`
- the code reads overlay titlebar geometry on Windows
- the code inspects monitor scale or native caption metrics

DPI does not belong in:

- placement math
- responsive native window recipes
- screen-relative window anchors
- page-facing `Rect` comparisons
