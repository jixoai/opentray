# Tray Primary Event Patterns

Use this reference when a tray/status icon should have one fast primary action while still preserving normal menu semantics.

## Reading Map

Use this chapter map when the user starts from tray behavior instead of window behavior:

- If the question is "menu first or direct action first?", compare [Menu-First Status Tray](#scenario-card-menu-first-status-tray), [Primary Launcher With Menu Fallback](#scenario-card-primary-launcher-with-menu-fallback), and [macOS Single-Primary Direct Launcher](#scenario-card-macos-single-primary-direct-launcher).
- If the question is "what does the direct action open?", pair this document with [WebView Window Patterns](../../develop-opentray-ext/references/webview-window-patterns.md), especially [Tray-Launched WebView Surface](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-launched-webview-surface), [Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel), and [WebView-Owned Custom Menu](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-webview-owned-custom-menu).
- If the question is "should the native tray menu disappear on macOS?", start at [macOS Single-Primary Direct Launcher](#scenario-card-macos-single-primary-direct-launcher), then jump to [WebView-Owned Custom Menu](#scenario-card-webview-owned-custom-menu).

## Platform Law

`primaryEvent` is an additive role on a plain menu item:

```ts
{ type: "item", id: 1, title: "Open", primaryEvent: true }
```

It is not a new public event family. The owning client still receives the normal `menuClick` frame with the same `itemId`.

`opentray-core` must stay generic: it preserves menu data and routes backend-originated `MenuClick` events by `(session authority, spaceId, trayId, itemId)`. It must not contain Windows/macOS/Linux gesture policy and must not know that the primary action opens WebView.

Native tray backends own platform gesture projection:

- macOS with multiple click-capable menu items: keep the native menu; the primary item remains a normal menu entry.
- macOS with exactly one enabled `primaryEvent` item: do not attach an `NSMenu` to the `NSStatusItem`; route the status-item click directly to the primary `menuClick`.
- Windows: left click may direct-trigger the primary item; right click can keep the native context menu.
- Linux: keep normal menu behavior until a concrete backend proves reliable tray icon click support.

## How To Reason

Start from the user-visible tray interaction:

- Should left click activate something immediately, or always open a menu?
- Is there still a useful native menu with multiple commands?
- Is the app trying to open a normal window, a WebView custom menu, or a single-app surface?
- Should macOS behave like a menu bar app with no menu popover when only one action exists?
- Is Linux support required now, or should unsupported primary activation remain absent instead of faked?

## Scenario Card: Menu-First Status Tray

Effect: clicking the tray/status icon shows a normal native menu; the user chooses actions from it.

Atoms composed: `Surface`, `Tray`, normal `MenuItem`, native tray backend, `menuClick`.

Why this design: most status tools should use platform menu conventions. There is no need for a primary role when discovery of multiple actions matters more than speed.

Benefit: no platform-specific gesture ambiguity, and no app code needs to distinguish tray-icon click from menu selection.

Ask the user: "Do you want users to see a menu first because there are multiple important actions?"

Minimal shape:

```ts
await space.createTray({
  trayId: "build",
  title: "Build",
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

Benefit: Windows-style left-click launch can coexist with right-click context menus and macOS multi-item native menus.

Ask the user: "Should the first click open the main surface, while a context/menu gesture still exposes secondary commands?"

See also:

- [Menu-First Status Tray](#scenario-card-menu-first-status-tray) when speed matters less than discoverability
- [WebView Window Patterns: Tray-Launched WebView Surface](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-launched-webview-surface) when the primary action opens a WebView surface

Minimal shape:

```ts
await space.createTray({
  trayId: "app",
  title: "App",
  menu: {
    items: [
      { type: "item", id: 1, title: "Open Window", primaryEvent: true },
      { type: "item", id: 2, title: "Settings" },
      { type: "item", id: 3, title: "Quit" },
    ],
  },
});

client.onFrame((frame) => {
  if (frame.type !== "event" || frame.event.type !== "menuClick") return;
  if (frame.event.itemId === 1) openWindow();
});
```

## Scenario Card: macOS Single-Primary Direct Launcher

Effect: the macOS menu bar item behaves like a one-action launcher. Clicking it does not show a menu; it direct-triggers the single primary item.

Atoms composed: one enabled plain menu item with `primaryEvent: true`, macOS native backend direct primary policy, no attached `NSMenu`, existing `menuClick` route.

Why this design: attaching an `NSMenu` to `NSStatusItem` makes AppKit show menu chrome. Single-primary mode must avoid attaching the native menu so the click can become the action.

Benefit: OpenTray can support WeChat-like menu bar launchers and one-window tools without turning every tray into a custom WebView app.

Ask the user: "Should macOS clicking the status item do the action immediately when there is only one declared action?"

Minimal shape:

```ts
await space.createTray({
  trayId: "launcher",
  title: "Launcher",
  menu: {
    items: [{ type: "item", id: 1, title: "Open WebView", primaryEvent: true }],
  },
});
```

The handler still watches normal `menuClick`:

```ts
client.onFrame((frame) => {
  if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 1) {
    openWebView();
  }
});
```

See also:

- [Primary Launcher With Menu Fallback](#scenario-card-primary-launcher-with-menu-fallback) for the multi-item cross-platform variant
- [WebView-Owned Custom Menu](#scenario-card-webview-owned-custom-menu) when the one-shot launcher opens a custom WebView menu surface
- [WebView Window Patterns: Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel) when the direct launcher must also respect tray geometry

## Scenario Card: WebView-Owned Custom Menu

Effect: the native tray/status item launches a WebView surface that acts as the app's menu or main panel.

Atoms composed: macOS single-primary direct launcher, `@opentray/ext-webview`, borderless or overlay WebView window style, page-owned menu UI.

Why this design: tray primary activation remains a tray/menu role, and WebView remains an extension-owned surface. Neither `opentray-core` nor the tray backend learns WebView-specific commands.

Benefit: developers can build a rich custom menu with HTML/CSS while keeping a native menu fallback path available for other platforms or future multi-command designs.

Ask the user: "Do you want the WebView to replace the native tray menu visually, or only open a normal window?"

See also:

- [macOS Single-Primary Direct Launcher](#scenario-card-macos-single-primary-direct-launcher) for the no-`NSMenu` launcher law
- [WebView Window Patterns: WebView-Owned Custom Menu](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-webview-owned-custom-menu) for the window-shell side of the same pattern
- [WebView Window Patterns: Tray-Anchored Custom Panel](../../develop-opentray-ext/references/webview-window-patterns.md#scenario-card-tray-anchored-custom-panel) when the custom menu should physically anchor to the tray slot

Minimal handler:

```ts
if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 1) {
  await webview.show({
    type: "show",
    html: menuHtml,
    width: 360,
    height: 420,
    nativeWindowApi: true,
    windowControlsOverlay: true,
    style: {
      frameless: true,
      transparent: true,
      backgroundEffect: "hudWindow",
      cornerRadius: 18,
    },
  });
}
```

## Common Mistakes

- Do not add `trayPrimaryClick` unless a future product story proves a distinct event contract is necessary.
- Do not put `if platform == "macos"` or `if ext == "webview"` into `opentray-core`.
- Do not make every single-item menu direct-trigger by default. Direct behavior is opt-in through `primaryEvent`.
- Do not allow disabled primary items to become direct activation targets.
- Do not fake Linux primary activation without backend evidence.
- Do not attach `NSMenu` in macOS single-primary mode; that makes AppKit show the menu instead of direct-triggering.

## Local Verification Notes

When testing primary behavior from source, stale staged daemons can hide native changes. Build and point the CLI at the fresh broker, or stage the binary explicitly:

```bash
cargo build -p opentray-bin
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray cli -- daemon restart
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray cli -- smoke daemon-tray
```

For the pure macOS manual path, the demo tray should declare exactly one menu item:

```ts
{ type: "item", id: 1, title: "Open WebView", primaryEvent: true }
```
