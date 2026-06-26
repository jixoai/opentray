# opentray

Developer-facing OpenTray package.

Install it directly in the application or service that owns the tray lifetime:

```bash
pnpm add opentray
```

## Role

- Expose `createTray()` as the public creation entrypoint.
- Bind tray handles to the current runtime host context.
- Route official extension packages through public OpenTray contracts.
- Resolve platform runtime artifacts without exposing `Space`, `Surface`, or a public broker object.

`packages/cli` is the only unscoped npm package in this monorepo.

## Tray-First API

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.status",
  icon: {
    type: "file",
    path: "./assets/tray-icon.png",
    text: "Status",
    "text-only": "Status",
  },
  tooltip: {
    title: "Status",
    description: "Background service is running",
  },
  menu: {
    items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }],
  },
});

tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // Open an app-owned window, command, or extension surface.
  }
});
```

Visible tray text belongs to `icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. The v0.9 API does not export `createSpace()`, `createSurface()`, `resolveDefaultSpace()`, or `TrayHandle.setTitle()`.

## Runtime Ownership

OpenTray does not ask developers to create a public broker object. The application process or an application-owned background service imports `opentray`, calls `createTray()`, owns event handlers, and releases the tray when that process exits.

Node platform packages carry the host-loadable runtime artifact at `runtime/opentray_runtime.node`. `opentray/node` exposes `loadOpenTrayRuntimeBinding()` and `resolveInstalledRuntimeBindingPath()` for Node-specific runtime diagnostics and packaging checks.

For protocol/session diagnostics, `createTray(options, { runtime: "headless-binding" })` routes through the Node binding without a local broker socket. This is not a visual tray acceptance path yet; it proves binding-owned kernel/session behavior while the native event-loop-backed runtime host is still under construction.

The `opentray/node` subpath exposes binding-resolution and binding-transport helpers only. Source-tree diagnostics may still use the internal local broker transport, but that transport is not exported as a package contract.

## Examples

Run a protocol-only example that creates a tray, dispatches an extension command, and prints each client frame:

```bash
pnpm --filter opentray example:basic
```

Run human-visible tray and extension examples from a source checkout:

```bash
pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:debug-runtime-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

The debug-runtime examples exercise the current source-tree visible transport while the default SDK path is being moved behind the Node runtime binding. The public API they demonstrate is tray-first: application code creates trays directly and treats background/service lifecycle as application-owned.
