# WebView Window Patterns

Use this reference when extending or documenting `@opentray/ext-webview` window behavior. Prefer effect-driven scenario cards over abstract API inventories: OpenTray capabilities are orthogonal, so future agents should learn how to compose atoms for a visible product effect and then ask the user which effect they want.

## Reading Map

Use this chapter map instead of reading linearly when the user starts from an effect:

- If the question is "who owns the chrome?", jump between [Native Framed Window](#scenario-card-native-framed-window), [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls), and [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell).
- If the question is "how does the tray click open it?", pair [Tray-Launched WebView Surface](#scenario-card-tray-launched-webview-surface) and [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) with [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md).
- If the question is "how should translucent content be styled?", start in [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) and reuse the `hudWindow` content law in [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell), [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget), and [Island-Like Live Stream](#scenario-card-island-like-live-stream).
- If the question is "how does screen awareness change the layout?", read [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget), then [Island-Like Live Stream](#scenario-card-island-like-live-stream), then come back to [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) for tray-constrained placement.

## Platform Law

The WebView extension owns window protocol, native projection, page injection, and event payloads. `opentray`, `opentray-core`, and `crates/opentray-bin` stay generic and must not parse WebView window commands.

Events are subscription-driven. Do not add polling loops or unconditional page pushes for window state. If a native observer becomes necessary, install it only when a relevant listener exists and tear it down when the last listener is removed.

Native APIs exposed to a page are a security boundary. Keep the CSP-like `nativeApiPolicy` model: grant each capability family explicitly, keep local-only defaults for remote content, and avoid hidden broad grants.

## Authority Map

Keep the ownership split explicit when describing or extending the API:

- `TrayHandle.getBounds()` is the trusted backend authority for tray geometry. It is broker-routed and tray-owned.
- `navigator.opentray.tray.getBounds()` is the page projection of that same tray capability. Treat it as injected page context, not as a second system authority.
- `attachWebview(tray)` is the trusted host-side extension facade for `show`, `hide`, `navigate`, `evaluate`, and `postMessage`.
- `navigator.opentrayWindow` and `navigator.opentrayScreen` are extension-owned page APIs. They are not generic `opentray-core` contracts today.
- The facade package should export browser-global typings that match the injected page surface (`navigator.window`, `navigator.opentrayWindow`, `navigator.opentrayScreen`, `navigator.opentray`, and `window.getScreenDetails()`). Do not document runtime properties that the public TypeScript surface cannot express.
- If we later add a host-side `webview.window` controller, keep it inside the ext package boundary. Do not move WebView window verbs into `opentray-core`.
- `screen` stays in `@opentray/ext-webview` until a second non-WebView consumer proves a shared backend law for topology snapshots, coordinate space, permission gating, and listener-driven events.

## How To Reason

Start with the visible interaction, not the Rust or TypeScript field:

- Does the user want the operating system to own the titlebar, only the controls, or none of the chrome?
- Should the surface feel like a normal window, a translucent utility panel, a desktop widget, or a tray-launched custom menu?
- Should tray icon click open a native menu, direct-trigger a primary item, or open a WebView-owned menu surface?
- Is the content local and trusted, or remote and capability-scoped?
- Does the window need screen-aware placement, or only a fixed default size?
- Does the user need live monitor topology events? If yes, call out that this is the next platform-law modeling point, not a simple boolean.

## Platform Capability Matrix Radar

The current macOS window work is still a regular extension atom because one runtime owns one platform substrate: AppKit `NSWindow` + Wry `WKWebView` + `window-vibrancy`. Keep future platform rows explicit instead of flattening them into vague `blur` or `corner` booleans.

The next real platform-law shift should happen when Windows/Linux material, corner, and screen-event behavior must be modeled together:

| Capability family | macOS current substrate | Windows likely substrate | Linux likely substrate | Modeling rule |
| --- | --- | --- | --- | --- |
| Material/background | `NSVisualEffectView` via `window-vibrancy`; future macOS liquid-glass naming may diverge. | DWM/Mica/Acrylic/Tabbed/host-backdrop families vary by Windows version. | GTK/libadwaita/compositor-specific transparency and blur vary by desktop. | Keep common `backgroundEffect` as a negotiated effect, and add substrate-specific metadata only when a second platform proves the split. |
| Corners | Layer-backed content clipping can project numeric radius; system shell corners remain platform-owned when unset. | Windows 11 exposes rounded-corner preferences, while older versions differ or lack system corners. | Window manager/compositor decides; app-side clipping may not equal native shell corners. | Treat `cornerRadius` as logical requested state plus capability metadata, not proof that every substrate used the same primitive. |
| Screen details/events | `NSScreen` and `NSWindow.screen()` provide current snapshots; event observers should be listener-driven. | Win32 display topology and DPI events have their own coordinate and scale rules. | X11/Wayland/GTK monitor events and permissions vary by stack. | Keep `getScreenDetails()` standard-like, but model event source, coordinate space, and permission/capability per substrate before broadening. |

Do not pre-build `navigator.opentrayWindow.macos26|win11|gtk.*` namespaces only from speculation. First expose stable common capability state. Introduce substrate namespaces only when a concrete backend has behavior that cannot be truthfully represented by the common contract plus capability metadata.

## Scenario Card: Native Framed Window

Effect: a normal desktop window with OS titlebar, border, resizing, title, and optional icon.

Atoms composed: tray-owned extension command, WebView show command, native title/icon projection, optional local page bridge.

Why this design: the platform already has the correct affordances for a plain utility window. Keeping `frameless` off avoids forcing page code to reimplement close, drag, resize, accessibility, or platform conventions.

Benefit: the user gets the most predictable behavior, and the app can still opt into title/icon sync or native APIs later without changing the tray or broker law.

Ask the user: "Should this behave like a normal app window with OS chrome, or do you need custom titlebar/body chrome?"

Minimal shape:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  title: "Status",
  icon: { type: "href", href: "/favicon.ico" },
  nativeWindowApi: true,
  titleSync: { documentToWindow: true, windowToDocument: true },
});
```

## Scenario Card: Overlay Titlebar With Native Controls

Effect: a custom titlebar/content row is drawn by the page, but native window controls remain visible and own close/minimize/fullscreen behavior.

Atoms composed: `windowControlsOverlay`, `overlay.getTitlebarAreaRect()`, `overlay.geometrychange`, transparent/material style, `startAppRegionDrag()`.

Why this design: overlay keeps the control cluster native while giving the page layout ownership over the title/content area. The page reads geometry instead of guessing traffic-light/button positions, and drag uses native tracking instead of repeated `moveTo(...)` calls.

Benefit: product teams can build branded titlebars without losing platform controls or creating laggy drag behavior.

Ask the user: "Do you want native controls to remain visible, with only the titlebar content customized?"

Implementation note: native material is not the same thing as CSS blur. To get a real glass surface, the extension must enable `transparent: true` plus `backgroundEffect`, and the page must leave at least some regions transparent. If the HTML paints a fully opaque layer over the whole window, the native material is technically active but visually hidden.

Implementation nuance: `transparent` and `backgroundEffect` are separate requested controls. On macOS, any active material still needs a clear non-opaque backing layer under the hood, so the runtime must clear the native backing whenever `backgroundEffect` is enabled even if the requested `transparent` flag is `false`. That is a substrate requirement, not proof that the two API fields are the same concept.

Second nuance: material kind and material state are different axes. `backgroundEffect: "hudWindow"` only chooses the AppKit material family. `backgroundEffectState` chooses whether that material follows window activation or stays forced active/inactive. Tray-launched panels in an accessory app often need `backgroundEffectState: "active"` because the window may not remain the frontmost regular app surface even though the developer still wants the vivid material appearance.

Hard rule for glass windows: reset `html, body` margin/padding to `0`, keep the native window background transparent, and do not draw the outer shell in HTML with root-level `box-shadow`, fake blur, or root-level `border-radius`. The page renders content inside the native box; the native layer owns the box itself.

`hudWindow` content law on macOS:

- If the surface stays genuinely transparent, prefer AppKit semantic colors instead of hard-coded RGB text. The useful first set is:
  - primary text: `color: -apple-system-label`
  - secondary/supporting text: `color: -apple-system-secondary-label`
  - placeholder/disabled text: `color: -apple-system-placeholder-text`
  - selected-text background accent: `color: -apple-system-selected-text-background`
- If the content uses custom text colors such as `color: #...`, do not leave the content floating on a fully transparent root. Pair those colors with a matching translucent fill behind the content, for example a subtle `rgba(...)` panel or chip background.
- The practical product question is simple: "Am I letting the native material be the only contrast layer, or am I adding my own semi-transparent content surfaces?" If the answer is the first, use `-apple-system-*` semantic colors. If the answer is the second, custom colors become much safer.

This is not cosmetic trivia. `hudWindow` is highly translucent, so text contrast and perceived polish depend on whether the content relies on native semantic contrast or introduces its own translucent backing layer.

See also:

- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when native controls should disappear entirely
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the same glass/content rules must also respect tray geometry
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) when overlay content is opened from a direct tray primary action

Minimal show shape:

```ts
await webview.show({
  type: "show",
  html,
  width: 680,
  height: 420,
  nativeWindowApi: true,
  windowControlsOverlay: true,
  style: {
    transparent: true,
    backgroundEffect: "hudWindow",
    backgroundEffectState: "followsWindowActiveState",
  },
});
```

Minimal page shape:

```ts
const pageWindow = navigator.opentrayWindow;
const overlay = pageWindow.overlay;

async function layoutTitlebar() {
  const rect = await overlay?.getTitlebarAreaRect();
  if (!rect) return;
  titlebar.style.height = `${rect.height}px`;
  titlebar.style.left = `${rect.x}px`;
  titlebar.style.width = `${rect.width}px`;
}

await layoutTitlebar();
await overlay?.listen("geometrychange", () => void layoutTitlebar());

titlebar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  void pageWindow.startAppRegionDrag({ pointerId: event.pointerId });
});
```

## Scenario Card: Borderless Glass App Shell

Effect: the page owns the full window chrome. Native controls disappear, the background can be transparent/material-backed, and the page renders its own control buttons.

Atoms composed: `frameless`, `transparent`, `backgroundEffect`, `cornerRadius`, `windowControlsOverlay`, custom page controls, `minimize()`, `maximize()`, `restore()`, `close()`, `getWindowState()`, and `windowstatechange`.

Why this design: borderless is an intentional escalation from overlay. Once native controls disappear, page code must own window controls and state synchronization explicitly. The native layer still owns real minimize/maximize/drag operations.

Benefit: enables app-like shells, compact launchers, and glass panels without polluting `opentray-core` with WebView UI concepts.

Ask the user: "Do you want to replace the native titlebar entirely, and are you prepared to render and wire your own window controls?"

Implementation note: a borderless glass shell usually needs one more step after `show()`: fit the native window to the actual page content. Keep `html, body` fully reset and transparent, place any spacing on an inner content wrapper, and use `resizeTo()` after first render so the native window matches that wrapper instead of showing scrollbars.

See also:

- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the shared `hudWindow` content law and material-state discussion
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the borderless shell is tray-launched instead of free-floating
- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) when the same shell becomes a persistent utility surface rather than a main window

Minimal show shape:

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
    transparent: true,
    backgroundEffect: "hudWindow",
    backgroundEffectState: "active",
    cornerRadius: 18,
  },
});
```

Minimal page shape:

```ts
const pageWindow = navigator.opentrayWindow;

await pageWindow.listen("windowstatechange", ({ payload }) => {
  maximizeButton.toggleAttribute("data-active", payload.maximized);
  restoreButton.toggleAttribute("hidden", !payload.maximized);
});

minimizeButton.onclick = () => void pageWindow.minimize();
maximizeButton.onclick = async () => {
  const maximized = await pageWindow.isMaximized();
  void (maximized ? pageWindow.restore() : pageWindow.maximize());
};
closeButton.onclick = () => void pageWindow.close();
```

## Scenario Card: Screen-Aware Corner Widget

Effect: a small frameless/translucent widget is pinned to a screen corner and stays above normal windows.

Atoms composed: `navigator.opentrayScreen.getScreenDetails()`, `visibleFrame`, `keepOnTop`, `frameless`, `transparent`, `backgroundEffect`, `cornerRadius`, `resizeTo()`, and `moveTo()`.

Why this design: screen placement is a window capability, not a new extension. The page can own widget content and animation while the WebView atom owns native placement.

Benefit: desktop widgets, small status panels, and companion surfaces can be built without creating a separate extension or hardcoding monitor geometry.

Ask the user: "Which screen edge or corner should own the widget, and should it stay above other windows?"

See also:

- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for the shared frameless/material/window-control baseline
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for `hudWindow` text and backing-layer rules on highly translucent surfaces
- [Island-Like Live Stream](#scenario-card-island-like-live-stream) when the same substrate moves from a corner utility to a top-center activity strip

Minimal page shape:

```ts
const margin = 16;
const width = 320;
const height = 180;
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];

await navigator.opentrayWindow.setStyle({
  frameless: true,
  transparent: true,
  keepOnTop: true,
  backgroundEffect: "hudWindow",
  backgroundEffectState: "active",
  cornerRadius: 18,
});
await navigator.opentrayWindow.resizeTo(width, height);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + screen.visibleFrame.width - width - margin,
  screen.visibleFrame.y + margin,
);
```

## Scenario Card: Island-Like Live Stream

Effect: a compact live information surface floats near the top-center of the current screen, similar to a status island.

Atoms composed: the corner-widget shell, screen `visibleFrame`, page-owned live data rendering, optional `windowstatechange`/`resized` listeners, and `keepOnTop`.

Why this design: this is still WebView window composition, not `ext-island`. Use `ext-island` only when the product story needs a separate broker-level activity atom with its own lifecycle and aggregation law.

Benefit: developers can prototype live activities and stream surfaces with Web technologies while preserving future room for a dedicated `ext-island` atom.

Ask the user: "Is this just a WebView window effect, or do you need a reusable OpenTray island/activity primitive shared by multiple clients?"

See also:

- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) for the simpler corner-pinned version of the same screen-aware shell
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for custom window controls and frameless shell ownership
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the `hudWindow` content law if the island stays mostly transparent

Minimal placement:

```ts
const width = 440;
const height = 72;
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];

await navigator.opentrayWindow.setStyle({
  frameless: true,
  transparent: true,
  keepOnTop: true,
  backgroundEffect: "hudWindow",
  cornerRadius: 24,
});
await navigator.opentrayWindow.resizeTo(width, height);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + (screen.visibleFrame.width - width) / 2,
  screen.visibleFrame.y + 12,
);
```

## Scenario Card: Tray-Launched WebView Surface

Effect: clicking the tray/status icon opens the WebView surface directly where the platform supports a primary tray gesture.

Atoms composed: a normal tray menu item with `primaryEvent: true`, the existing `menuClick` event, and `@opentray/ext-webview` `show`.

Why this design: `primaryEvent` is a role on a plain menu item, not a new event family. App code handles the same `menuClick` path whether the user selected a native menu item or triggered the platform primary gesture.

Benefit: one handler can open the WebView across macOS and Windows without teaching the core about WebView or adding `trayPrimaryClick`.

Ask the user: "Should tray icon activation open a surface immediately, or should it always show a native menu first?"

See also:

- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-primary-launcher-with-menu-fallback) for platform gesture policy
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-macos-single-primary-direct-launcher) for macOS single-primary direct activation
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the opened surface must be positioned from tray geometry rather than just shown

Minimal shape:

```ts
const tray = await space.createTray({
  trayId: "status",
  title: "Status",
  menu: {
    items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }],
  },
});

client.onFrame((frame) => {
  if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 1) {
    void webview.show({ type: "show", html, width: 420, height: 260 });
  }
});
```

## Scenario Card: Tray-Anchored Custom Panel

Effect: the tray click opens a WebView-owned custom panel that anchors to the current tray item instead of a guessed screen point.

Atoms composed: `primaryEvent`, `TrayHandle.getBounds()`, `navigator.opentray.tray.getBounds()`, borderless or overlay window styling, and the normal WebView `show` command.

Why this design: tray geometry belongs to the tray atom, not to WebView. The backend uses the tray authority to place the window truthfully; the page reads the projected tray bounds only when it needs to align its own layout with that anchor.

Benefit: developers can build custom tray menus, launchers, and compact panels without inventing fake cursor-based placement or asking the core to understand WebView layout.

Ask the user: "Should the panel merely open from the tray, or should its HTML also react to the tray anchor for arrows, reveal animation, and edge alignment?"

See also:

- [Tray-Launched WebView Surface](#scenario-card-tray-launched-webview-surface) for the simpler no-anchor version
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the shared `hudWindow` content law and material-state rules
- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) for how screen constraints clamp tray-derived placement
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) for the tray-side primary gesture law that typically launches this pattern

Minimal trusted host shape:

```ts
const bounds = await tray.getBounds();

await webview.show({
  type: "show",
  html,
  width: 360,
  height: 240,
  fallbackRect: bounds ?? { x: 0, y: 0, width: 1, height: 1 },
  nativeWindowApi: true,
  nativeTrayApi: true,
  style: {
    frameless: true,
    transparent: true,
    backgroundEffect: "hudWindow",
    backgroundEffectState: "active",
    cornerRadius: 18,
  },
});
```

Minimal page shape:

```ts
const trayBounds = await navigator.opentray.tray.getBounds();

if (trayBounds) {
  panel.style.setProperty("--anchor-x", `${trayBounds.x + trayBounds.width / 2}px`);
  panel.dataset.anchorEdge = "tray";
}
```

Reference implementation in this repo: `pnpm --filter opentray example:tray-panel`

Use `pnpm --filter opentray example:webview-control` as the capability exerciser only. For glass-window guidance, prefer `example:tray-panel`, because it keeps the page root transparent and avoids teaching CSS shell decoration as a substitute for native material.

Repo-maintainer note: when this example is run from source, build `opentray` and `opentray-ext-webview` first. The example auto-discovers the local `target/debug|release` WebView dylib and injects it through `OPENTRAY_EXT_PATH`, so developers can stay on the real extension-loading path without manual staging during iteration.

Why this example matters for AI guidance:

- It demonstrates the full composition users actually ask for, not just one atom in isolation.
- It teaches that backend `tray.getBounds()` and page `navigator.opentray.tray.getBounds()` can coexist in one product flow without creating two authorities.
- It shows where `screen.getScreenDetails()` fits: not as a competing source of truth for the tray anchor, but as the constraint system for clamping the panel onto the visible monitor frame.
- It gives future agents a concrete prompt pattern: "Do you want a normal native menu, a tray-launched custom panel, or a fully WebView-owned tray menu surface?"

For tray-specific platform policy, read `../../develop-opentray/references/tray-primary-event-patterns.md`.

## Scenario Card: WebView-Owned Custom Menu

Effect: the native tray/status item acts as a launcher, but the visible menu surface is a WebView built by the app.

Atoms composed: a single `primaryEvent` menu item, macOS single-primary direct activation, WebView borderless/overlay shell, and page-owned menu interactions.

Why this design: macOS single-primary mode intentionally avoids attaching an `NSMenu`, so a click can route directly to `menuClick`. The WebView extension then owns the visible menu surface. This preserves tray menu atoms for fallback while allowing richer app-owned menus.

Benefit: single-window apps, custom menu bar experiences, and tray-first launchers can be built without forcing every OpenTray tray to abandon native menus.

Ask the user: "Do you want the native tray menu to disappear when there is only one primary action, so the WebView becomes the menu?"

See also:

- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the WebView menu should be positioned from tray bounds and screen constraints
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when the custom menu fully owns chrome and controls
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) for the tray-side launch law

Minimal menu declaration:

```ts
menu: {
  items: [{ type: "item", id: 1, title: "Open Menu", primaryEvent: true }],
}
```

Then show a borderless or overlay WebView from the normal `menuClick` handler.

## Events

Common window events:

- `stylechange` for `setStyle(...)`
- `titlechange` for native title changes and enabled document-title sync
- `iconchange` for native icon changes and enabled favicon sync
- `windowstatechange` for minimize, maximize, and restore
- `moved` and `resized` for extension-owned geometry commands
- `closed` for native close
- `overlay.geometrychange` under `navigator.opentrayWindow.overlay.listen("geometrychange", ...)`

Keep event payloads aligned with their query method where one exists. For example, `windowstatechange` should match `getWindowState()`, and `stylechange` should match `getStyle()`.

Every new `set*` mutation should either have a corresponding `*change` event or an explicit reason why the mutation is write-only. Do not push events when no page listener exists.

See also:

- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for `overlay.geometrychange`
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for `windowstatechange`
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when `stylechange` and tray geometry-driven layout interact

## Title And Icon Sync

Use native `title`/`icon` options when the app owns state outside the page. Use `titleSync` and `iconSync` when the page is the source of truth:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  titleSync: { documentToWindow: true, windowToDocument: true },
  iconSync: { faviconToWindow: true, windowToFavicon: true },
});
```

For favicon/native icon examples, prefer PNG data URLs generated by Web APIs such as `canvas.toDataURL("image/png")`. SVG or URL-backed favicons can remain logical state when macOS cannot convert them into a native image.

See also:

- [Native Framed Window](#scenario-card-native-framed-window) for the simplest title/icon-owned window
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when title/icon sync coexists with custom chrome

## Screen API Notes

Use `navigator.opentrayScreen.getScreenDetails()` or the opt-in `window.getScreenDetails()` binding for screen-aware layout. The payload follows the `window.getScreenDetails()` mental model: `currentScreen`, `screens`, and `isExtended`.

See also:

- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget)
- [Island-Like Live Stream](#scenario-card-island-like-live-stream)
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel)

Current screen support is snapshot-oriented. If a product requires monitor hot-plug, per-monitor DPI changes, or cross-platform screen topology events, treat that as the Windows/Linux/macOS screen-event matrix modeling point instead of adding a speculative one-off event.
