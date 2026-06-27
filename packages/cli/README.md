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

Node platform packages carry the host-loadable runtime artifact at `runtime/opentray_runtime.node`. `opentray/node` exposes `runVisibleRuntimeHost()`, `loadOpenTrayRuntimeBinding()`, and `resolveInstalledRuntimeBindingPath()` for Node-specific host-loop ownership, runtime diagnostics, and packaging checks.

By default, `createTray()` routes through the visible Node runtime binding. The host main thread must run `runVisibleRuntimeHost()` while app logic runs in a worker or another app-owned execution source. This is a platform law, not a convenience wrapper: on macOS native tray creation must happen on the application main thread, and all native menu/tray events route back only to the live session that owns the tray.

For protocol/session diagnostics, `createTray(options, { runtime: "headless-binding" })` routes through the Node binding without visible native state. Source-tree diagnostics may use `{ runtime: "local-broker" }`, but that transport is not the default package runtime.

Runtime options may also carry app identity facts:

```ts
await createTray(options, {
  appId: "com.example.status",
  appName: "Status",
});
```

The runtime host reports those facts as `appId` and `appName` in `runtime-host-health`; tray icon text, menu labels, and tooltip text remain projection data.

The `opentray/node` subpath exposes binding-resolution, visible host-loop, and binding-transport helpers. Source-tree diagnostics may still use the internal local broker transport, but that transport is not exported as a package contract.

## Examples

Run a protocol-only example that creates a tray, dispatches an extension command, and prints each client frame:

```bash
pnpm --filter opentray example:basic
```

Run the finite source-tree smoke matrix instead of relying on shell expansion for `example:*`:

```bash
pnpm --filter opentray example:matrix
pnpm --filter opentray example:matrix -- --row visible-binding
```

Run human-visible tray and extension examples from a source checkout:

```bash
cargo build -p opentray-runtime-node
pnpm --filter opentray build
bun run scripts/binaries/stage-local.ts --kind runtime --source target/debug/libopentray_runtime_node.dylib
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:visible-binding

pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:debug-runtime-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

The example matrix stages the generated Node runtime artifact before `visible-binding`, skips unsupported or missing native extension carrier artifacts with an explicit reason, and labels contributor-only extension rows as `extension-debug-runtime` coverage. The visible-binding example exercises the default package runtime on macOS and Windows. The debug-runtime examples exercise the contributor-only source-tree transport for extension and panel iteration. The public API they demonstrate is tray-first: application code creates trays directly and treats background/service lifecycle as application-owned.
