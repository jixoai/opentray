# Tray Primary Event Patterns

Use this reference when a tray/status icon should have one fast primary action while still preserving normal menu semantics.

## Reading Map

Use this chapter map when the user starts from tray behavior instead of window behavior:

- If the question is "menu first or direct action first?", compare [Menu-First Status Tray](#scenario-card-menu-first-status-tray), [Primary Launcher With Menu Fallback](#scenario-card-primary-launcher-with-menu-fallback), and [macOS Primary Launcher With Context Menu](#scenario-card-macos-primary-launcher-with-context-menu).
- If the question is "what does the direct action open?", pair this document with [WebView Window Patterns](../../develop-opentray-ext/references/webview-window-patterns.md), especially [Tray-Launched WebView Surface](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-launched-webview-surface), [Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel), and [WebView-Owned Custom Menu](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-webview-owned-custom-menu).
- If the question is "should the native tray menu disappear on macOS?", start at [macOS Primary Launcher With Context Menu](#scenario-card-macos-primary-launcher-with-context-menu). The current law keeps the native menu attached and reserves right-click for that menu.

## Platform Law

`primaryEvent` is an additive role on a plain menu item:

```ts
{ type: "item", id: 1, title: "Open", primaryEvent: true }
```

It is not a new public event family. The owning client still receives the normal `menuClick` frame with the same `itemId`.

`opentray-core` must stay generic: it preserves menu data and routes backend-originated `menuClick` events by `(session authority, appId, trayId, itemId)`. It must not contain Windows/macOS/Linux gesture policy and must not know that the primary action opens WebView.

Native tray backends own platform gesture projection:

- macOS with `tray-icon` left/right menu control: left click may direct-trigger the enabled primary item; right click keeps the attached native context menu.
- Windows: left click may direct-trigger the primary item; right click can keep the native context menu.
- Linux: keep normal menu behavior until a concrete backend proves reliable tray icon click support.

When a primary route consumes a left click, the app receives `menuClick` for the primary item. Non-consumed tray icon clicks remain observable through `trayClick`.

## How To Reason

Start from the user-visible tray interaction:

- Should left click activate something immediately, or always open a menu?
- Is there still a useful native menu with multiple commands on right click?
- Is the app trying to open a normal window, a WebView custom menu, or a single-app surface?
- Should macOS left click activate the primary item while right click preserves the native menu?
- Is Linux support required now, or should unsupported primary activation remain absent instead of faked?

## Scenario Card: Menu-First Status Tray

Effect: clicking the tray/status icon shows a normal native menu; the user chooses actions from it.

Atoms composed: `App`, `Tray`, normal `MenuItem`, native tray backend, `menuClick`.

Why this design: most status tools should use platform menu conventions. There is no need for a primary role when discovery of multiple actions matters more than speed.

Benefit: no platform-specific gesture ambiguity, and no app code needs to distinguish tray-icon click from menu selection.

Ask the user: "Do you want users to see a menu first because there are multiple important actions?"

Minimal shape:

```ts
await createTray({
  id: "com.example.build",
  menu: {
    items: [
      { type: "item", id: 1, title: "Open Dashboard" },
      { type: "item", id: 2, title: "Pause Watcher" },
    ],
  },
});
```

## Scenario Card: Primary Launcher With Menu Fallback

Effect: platforms with a primary tray gesture can open the main surface immediately, while menu-capable gestures still expose the native menu.

Atoms composed: one plain item marked `primaryEvent: true`, additional normal menu items, tray-icon backend primary route, existing `menuClick` event.

Why this design: primary activation is just a faster way to choose a menu item. It does not split application handlers or create a new lifecycle surface.

Benefit: left-click launch can coexist with right-click context menus on macOS and Windows.

Ask the user: "Should the first click open the main surface, while a context/menu gesture still exposes secondary commands?"

See also:

- [Menu-First Status Tray](#scenario-card-menu-first-status-tray) when speed matters less than discoverability
- [WebView Window Patterns: Tray-Launched WebView Surface](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-launched-webview-surface) when the primary action opens a WebView surface

Minimal shape:

```ts
const tray = await createTray({
  id: "com.example.app",
  menu: {
    items: [
      { type: "item", id: 1, title: "Open Window", primaryEvent: true },
      { type: "item", id: 2, title: "Settings" },
      { type: "item", id: 3, title: "Quit" },
    ],
  },
});

tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) openWindow();
});
```

## Scenario Card: macOS Primary Launcher With Context Menu

Effect: the macOS menu bar item behaves like a primary launcher on left click, while right click still opens the native menu.

Atoms composed: one enabled plain menu item with `primaryEvent: true`, macOS native backend direct primary policy, attached `NSMenu` for right click, existing `menuClick` route.

Why this design: `tray-icon` exposes independent macOS left/right menu toggles, so OpenTray can use left click as the fast path without removing the native menu.

Benefit: OpenTray can support menu bar launchers and one-window tools without hiding secondary native menu commands.

Ask the user: "Should macOS left click do the main action immediately while right click keeps Settings/Quit?"

Minimal shape:

```ts
await createTray({
  id: "com.example.launcher",
  menu: {
    items: [
      { type: "item", id: 1, title: "Open WebView", primaryEvent: true },
      { type: "separator" },
      { type: "item", id: 2, title: "Quit" },
    ],
  },
});
```

The handler still watches normal `menuClick`:

```ts
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    openWebView();
  }
});
```

See also:

- [Primary Launcher With Menu Fallback](#scenario-card-primary-launcher-with-menu-fallback) for the cross-platform variant
- [WebView-Owned Custom Menu](#scenario-card-webview-owned-custom-menu) when the one-shot launcher opens a custom WebView menu surface
- [WebView Window Patterns: Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel) when the direct launcher must also respect tray geometry

## Scenario Card: WebView-Owned Custom Menu

Effect: the native tray/status item launches a WebView surface that acts as the app's menu or main panel.

Atoms composed: macOS primary launcher with context menu, `@opentray/ext-webview`, borderless or overlay WebView window style, page-owned menu UI.

Why this design: tray primary activation remains a tray/menu role, and WebView remains an extension-owned surface. Neither `opentray-core` nor the tray backend learns WebView-specific commands.

Benefit: developers can build a rich custom menu with HTML/CSS while keeping a native menu fallback path available for other platforms or future multi-command designs.

Ask the user: "Do you want the WebView to replace the native tray menu visually, or only open a normal window?"

See also:

- [macOS Primary Launcher With Context Menu](#scenario-card-macos-primary-launcher-with-context-menu) for the left-click primary / right-click menu law
- [WebView Window Patterns: WebView-Owned Custom Menu](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-webview-owned-custom-menu) for the window-shell side of the same pattern
- [WebView Window Patterns: Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel) when the custom menu should physically anchor to the tray slot

Minimal handler:

```ts
let visible = false;

tray.onMenuClick(async ({ itemId }) => {
  if (itemId !== 1) return;
  if (visible) {
    visible = false;
    await window.hide();
  } else {
    visible = true;
    await window.show({
      html: menuHtml,
      width: 360,
      height: 420,
      nativeWindowApi: true,
      windowControlsOverlay: true,
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
    });
  }
});
```

Best-practice fork: a `keepOnTop` tray panel should toggle on repeated primary clicks; a non-pinned panel inherits `autoHide: true` and hides on native blur. Set `autoHide: false` only when the application deliberately owns a conditional or animated dismissal. Show-only handlers leave the user with no predictable dismissal law.

## Common Mistakes

- Do not add `trayPrimaryClick` unless a future product story proves a distinct event contract is necessary.
- Do not put `if platform == "macos"` or `if ext == "webview"` into `opentray-core`.
- Do not make every single-item menu direct-trigger by default. Direct behavior is opt-in through `primaryEvent`.
- Do not allow disabled primary items to become direct activation targets.
- Do not fake Linux primary activation without backend evidence.
- Do not remove the macOS `NSMenu` just to make primary activation work. The current tray-icon backend supports left-click primary routing while preserving right-click menu access.
- Do not expect `tray.onTrayClick(...)` for a left click consumed by `primaryEvent`; that click intentionally arrives as the primary item's normal `menuClick`.

## Local Verification Notes

When testing primary behavior from source, a stale staged runtime binding can hide native changes. Build the runtime binding and run the real example directly (the public CLI has no `daemon` subcommands):

```bash
cargo build -p opentray-bin
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
```

For the pure macOS manual path, the demo tray may declare a primary item plus secondary menu items. Left click should emit `menuClick` for the primary item; right click should show the native menu:

```ts
[
  { type: "item", id: 1, title: "Open WebView", primaryEvent: true },
  { type: "separator" },
  { type: "item", id: 2, title: "Quit" },
];
```
