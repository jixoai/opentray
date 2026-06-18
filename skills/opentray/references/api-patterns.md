# API Patterns

Use this reference when the user asks how to write code with OpenTray.

## Main Public Pieces

- `createSpace()`: top-level broker-backed entrypoint for creating a broker-owned space.
- `createTray()`: top-level convenience API that mounts a client-owned tray onto an explicit or default space.
- `resolveDefaultSpace()`: inspect or reuse the daemon's default space explicitly.
- `TrayHandle.setMenu()`, `setTooltip()`, `setIcon()`, and `setTitle()`: mutate one tray contribution through broker law.
- `TrayHandle.onMenuClick()` / `listen(...)`: consume tray-scoped events from handles created through a real broker connection.
- `TrayHandle.commandExtension()`: send extension traffic through the public contract.
- `createClient()`: lower-level transport API for custom broker connections and protocol-only work.

## Typical Shape

```ts
import { createSpace, createTray, resolveDefaultSpace } from "opentray";

const space = await createSpace({
  id: "com.example.app",
  title: "Example",
  default: true,
});

const tray = await space.createTray({
  trayId: "status",
  title: "OpenTray",
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});

await tray.setTitle("OpenTray: ready");
await tray.setMenu({ items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }] });
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // Open the app surface or run the primary action.
  }
});

const defaultSpace = await resolveDefaultSpace();
await createTray(
  {
    trayId: "secondary",
    title: "Secondary",
  },
  { space: defaultSpace.space },
);
```

If the caller omits `space` in `createTray(...)`, OpenTray resolves the broker default space automatically.

## Lower-Level Shape

Use `createClient()` only when the user explicitly needs custom transport ownership or protocol inspection. Request-only transports can create request handles, but tray event helpers require a real broker connection with an event stream.

## Extension Shape

Official extensions should attach through the tray handle, not by reaching into private broker details. `@opentray/ext-webview` is the current reference example.
