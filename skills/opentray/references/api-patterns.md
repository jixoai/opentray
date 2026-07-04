# API Patterns

Use this reference when the user asks how to write code with OpenTray.

## Main Public Pieces

- `runTrayApp(main, options?)`: first-app helper that owns the visible-runtime host loop and exposes a self-contained `createTray` callback for quick starts.
- `createTray(options, runtimeOptions?)`: top-level entrypoint that resolves a runtime connection (default visible runtime binding, or an explicit runtime mode) and creates one tray.
- `TrayHandle.setId` does not exist; the tray `id` is set at creation time and is immutable.
- `TrayHandle.setMenu()`, `setTooltip()`, `setIcon()`: mutate one tray contribution. There is no `setTitle()` — visible text is part of icon projection.
- `TrayHandle.extend(extension)`: mount an official extension onto the tray (e.g. `tray.extend(WebviewExt)`).
- `TrayHandle.loadExtension(...)`, `commandExtension(...)`, `requestExtension(...)`: lower-level extension control.
- `TrayHandle.getBounds()`: read tray geometry authority.
- `EventfulTrayHandle.onMenuClick()` / `onTrayClick()` / `onTrayDoubleClick()` / `listen(...)`: consume tray-scoped events.
- `createClient(...)`: lower-level transport API for custom connections and protocol-only work.

OpenTray no longer exposes `createSpace`, `resolveDefaultSpace`, or `createApp`. Application identity (`appId` / `appName`) is passed through `runtimeOptions`, not a separate creation step.

The `opentray` package re-exports common application types: `CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, `TrayBoundsResult`, and the lower-level protocol frame types. Prefer these names over `Parameters<typeof createTray>` or direct `@opentray/spec` imports in ordinary application code.

`primaryEvent` is an additive role on a normal menu item. It still emits `menuClick`, so handle it through item-local `onMenuClick` for simple commands or `tray.onMenuClick(...)` for centralized routing. Use `tray.onTrayClick(...)` for independent raw tray-icon clicks. Do not create a separate `bindPrimaryEvent` API unless the event ontology changes.

Use `runTrayApp()` when the user wants the smallest first app and does not want to reason about host-thread choreography yet.

The `runTrayApp()` callback executes in the app worker. Keep it self-contained; import official extensions such as `@opentray/ext-webview` inside the callback when the first app needs them.

## Typical Shape

```ts
import { createTray, type CreateTrayOptions, type TrayIcon } from "opentray";

const icon: TrayIcon = { type: "file", path: "./tray.png" };
const options: CreateTrayOptions = {
  id: "com.example.status",
  tooltip: { title: "OpenTray", description: "Status" },
  icon,
  menu: {
    items: [
      {
        title: "Open",
        primaryEvent: true,
        onMenuClick: () => {
          // Simple local command.
        },
      },
      "-",
      ["More", [{ id: 20, title: "Settings" }, "Quit"]],
    ],
  },
};

const tray = await createTray(options);

tray.onMenuClick(({ itemId }) => {
  if (itemId === 20) {
    // Centralized routing for stable menu ids.
  }
});

tray.onTrayClick(({ button, x, y }) => {
  // Raw tray activation, independent from menu item primaryEvent.
});

await tray.setIcon({ type: "file", path: "./tray-on.png", text: "Ready" });
await tray.setMenu({
  items: [
    "Ready",
    "-",
    { title: "Quit", onMenuClick: () => void tray.destroy() },
  ],
});
```

Use item-local `onMenuClick` when the action belongs entirely to that menu declaration. Use `tray.onMenuClick(...)` when the app wants a single router, explicit item IDs, logging, permission checks, or shared command dispatch. These are sibling action sources over the same `menuClick` event, not competing ontologies.

To supply explicit diagnostic identity for the owning runtime:

```ts
await createTray(options, { appId: "com.example.status", appName: "Status" });
```

## Lower-Level Shape

Use `createClient(connection)` only when the user explicitly needs custom transport ownership or protocol inspection. Request-only transports can create request handles, but tray event helpers require a real connection with an event stream.

## Extension Shape

Official extensions attach through the tray handle, not by reaching into private broker details. `@opentray/ext-webview` is the current reference example (see `references/ext-webview.md`).
