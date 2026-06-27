# API Patterns

Use this reference when the user asks how to write code with OpenTray.

## Main Public Pieces

- `createTray(options, runtimeOptions?)`: top-level entrypoint that resolves a runtime connection (default visible runtime binding, or an explicit runtime mode) and creates one tray.
- `TrayHandle.setId` does not exist; the tray `id` is set at creation time and is immutable.
- `TrayHandle.setMenu()`, `setTooltip()`, `setIcon()`: mutate one tray contribution. There is no `setTitle()` — visible text is part of icon projection.
- `TrayHandle.extend(extension)`: mount an official extension onto the tray (e.g. `tray.extend(WebviewExt)`).
- `TrayHandle.loadExtension(...)`, `commandExtension(...)`, `requestExtension(...)`: lower-level extension control.
- `TrayHandle.getBounds()`: read tray geometry authority.
- `EventfulTrayHandle.onMenuClick()` / `onTrayClick()` / `onTrayDoubleClick()` / `listen(...)`: consume tray-scoped events.
- `createClient(...)`: lower-level transport API for custom connections and protocol-only work.

OpenTray no longer exposes `createSpace`, `resolveDefaultSpace`, or `createApp`. Application identity (`appId` / `appName`) is passed through `runtimeOptions`, not a separate creation step.

## Typical Shape

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.status",
  tooltip: { title: "OpenTray", description: "Status" },
  icon: { type: "file", path: "./tray.png" },
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});

await tray.setIcon({ type: "file", path: "./tray-on.png", text: "Ready" });
await tray.setMenu({
  items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }],
});
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // Open the app surface or run the primary action.
  }
});
```

To supply explicit diagnostic identity for the owning runtime:

```ts
await createTray(options, { appId: "com.example.status", appName: "Status" });
```

## Lower-Level Shape

Use `createClient(connection)` only when the user explicitly needs custom transport ownership or protocol inspection. Request-only transports can create request handles, but tray event helpers require a real connection with an event stream.

## Extension Shape

Official extensions attach through the tray handle, not by reaching into private broker details. `@opentray/ext-webview` is the current reference example (see `references/ext-webview.md`).
