# opentray

Developer-facing OpenTray package.

Install it directly in the application or service that owns the tray lifetime:

```bash
pnpm add opentray
```

Use `latest` for the newest published package. When installing official extensions, use one protocol-line tag across the package set:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

Use `alpha-A-B` for alpha packages on the same protocol line. Replace `A-B` with the current OpenTray protocol-line tag from `@opentray/spec`; do not mix `latest` and protocol-line tags unless you are debugging install drift.

## Role

- Expose `createTray()` as the public creation entrypoint.
- Bind tray handles to the current runtime host context.
- Route official extension packages through public OpenTray contracts.
- Resolve platform runtime artifacts without exposing `Space`, `Surface`, or a public broker object.

`packages/cli` is the only unscoped npm package in this monorepo.

## Tray-First API

For the first app, call `createTray()` directly. The quickstart stays in one file and does not ask the user to wire a worker or a host loop first:

```ts
import {
  createTray,
  type CreateTrayHandle,
  type CreateTrayOptions,
  type TrayIcon,
} from "opentray";

const icon: TrayIcon = { "text-only": "OT" };
let tray: CreateTrayHandle;
const options: CreateTrayOptions = {
  id: "com.example.first-app",
  icon,
  menu: {
    items: [
      {
        title: "Quit",
        primaryEvent: true,
        onMenuClick: () => void tray.destroy(),
      },
    ],
  },
};

tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
});
```

`createTray()` remains the direct tray API when the caller already owns the runtime process shape.

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
    items: [
      {
        title: "Open",
        primaryEvent: true,
        onMenuClick: () => {
          // Open an app-owned window, command, or extension surface.
        },
      },
      "-",
      ["More", ["Settings", "Quit"]],
    ],
  },
});
```

Visible tray text belongs to `icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. If no visible icon/text survives projection, native tray backends fall back to the runtime `appName`. The current tray-first API does not export `createSpace()`, `createSurface()`, `resolveDefaultSpace()`, or `TrayHandle.setTitle()`.

The package re-exports common application-facing types including `CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, and `TrayBoundsResult`. Use those public names instead of deriving SDK shapes with `typeof` in application code.

Top-level `createTray(...)` and its returned `setMenu(...)` accept app-facing
menu shorthand. Lower-level `createClient(...)` remains protocol-only for tools
that need exact wire shapes.

`primaryEvent` is a role on a normal menu item and emits the usual `menuClick`.
Use `tray.onTrayClick(...)` when you want to listen to raw tray-icon clicks
without making a menu item the primary route.

## Runtime Ownership

OpenTray does not ask developers to create a public broker object. The application process or an application-owned background service imports `opentray`, calls `createTray()`, owns event handlers, and releases the tray when that process exits.

Platform runtime packages carry the packaged runtime executable at `bin/opentray` or `bin/opentray.exe`.

When a local consumer links this workspace, refresh native package artifacts explicitly instead of relying on `pnpm run build` alone:

```bash
pnpm run npm:cp-bin:runtime
pnpm run npm:cp-bin:webview
```

Use `pnpm run npm:cp-bin` to refresh both the packaged runtime executable and the current platform WebView native library. Without `--target`, it compares existing `target/debug` and `target/release` artifacts and copies the newest binary for each kind. Pass `--target debug`, `-t debug`, or `--target release` to build and copy a specific target into the package projection:

```bash
pnpm run npm:cp-bin
pnpm run npm:cp-bin -- --target debug
pnpm run npm:cp-bin:webview -- -t debug
```

By default, `createTray()` routes through the local runtime host and starts it on first use when needed. The executable host remains the source of truth for tray lifecycle, session cleanup, and native event routing on supported platforms.

Runtime options may also carry app identity facts:

```ts
await createTray(options, {
  appId: "com.example.status",
  appName: "Status",
});
```

The runtime host reports those facts as `appId` and `appName` in `runtime-host-health`; tray icon text, menu labels, and tooltip text remain projection data.

## Examples

Run the quickstart example and the protocol-only example:

```bash
pnpm --filter opentray example:first-app
pnpm --filter opentray example:basic
```

Run the finite source-tree smoke matrix instead of relying on shell expansion for `example:*`:

```bash
pnpm --filter opentray example:matrix
pnpm --filter opentray example:matrix -- --row webview-control
```

Run human-visible tray and extension examples from a source checkout:

```bash
cargo build -p opentray-bin
pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:debug-runtime-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

The example matrix warms the runtime executable before `first-app`, skips unsupported or missing native extension carrier artifacts with an explicit reason, and labels contributor-only extension rows as `extension-debug-runtime` coverage. The first-app example exercises the default package runtime. The debug-runtime examples exercise the contributor-only source-tree transport for extension and panel iteration. The public API they demonstrate is tray-first: application code creates trays directly and treats background/service lifecycle as application-owned.
