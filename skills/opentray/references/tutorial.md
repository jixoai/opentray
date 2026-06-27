# Progressive Tutorial

Use this reference when the user wants the shortest path to a first OpenTray app, then a gradual path into lower-level control.

## Stage 1: First App

Use `runTrayApp()` from `opentray/node` when the user wants the smallest working app and does not want to think about main-thread vs worker setup.

```ts
import { runTrayApp } from "opentray/node";

await runTrayApp(async ({ createTray }) => {
  const tray = await createTray({
    id: "com.example.first-app",
    icon: { "text-only": "OT" },
    menu: { items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }] },
  });
  tray.onMenuClick(({ itemId }) => void (itemId === 1 && tray.destroy()));
}, { autoExitAfterMs: 1500 });
```

Rules for the first stage:

- Keep the callback self-contained.
- Use `createTray()` only inside the callback.
- Let the helper own the visible-runtime host loop.

## Stage 2: Direct Tray Control

Use `createTray()` directly when the user already owns the process shape and only needs tray behavior.

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.status",
  icon: { type: "file", path: "./tray.png", text: "Status" },
  tooltip: { title: "Status", description: "Background service is running" },
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});
```

## Stage 3: Events And Mutation

Add menu and tray events after the first tray is visible.

```ts
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // open the app surface or trigger the primary action
  }
});

await tray.setIcon({
  type: "file",
  path: "./tray-active.png",
  text: "Ready",
});
```

## Stage 4: Official Extensions

Mount official capability atoms through the tray handle.

```ts
const { WebviewExt } = await import("@opentray/ext-webview");
const webviewTray = tray.extend(WebviewExt);
const panel = webviewTray.createWebviewWindow({
  html: "<main>Hello</main>",
  width: 360,
  height: 220,
});

tray.onMenuClick(({ itemId }) => void (itemId === 1 && panel.show()));
```

## Stage 5: Low-Level Ownership

Use `runVisibleRuntimeHost()` only when the user needs to own the visible host loop directly.

That path is for advanced process choreography, diagnostics, or custom runtime ownership. It is not the first app path.
