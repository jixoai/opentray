<!--
Orthogonal intents (maintained 2026-07-21; original user request: keep the root README
brief while making the existence of appMode discoverable and routing detailed consumer
decisions to the public skills/opentray guide):
1. Introduce the tray-first public model and shortest working API path.
2. Make major public capabilities discoverable without duplicating decision tutorials.
3. Record repository/package ownership and contributor verification entrypoints.
-->

# OpenTray

<p align="center"><img src="./docs/opentray-logo.png" alt="OpenTray logo" width="180"></p>

English | [简体中文](README-zh.md)

OpenTray is a desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems.

The current platform model is tray-first:

- `App`: caller-owned runtime identity and isolation boundary.
- `Tray`: one desktop status atom owned by that app/runtime.
- `Session`: the live source of authority for tray events and mutations.
- `Extension`: optional native capability atom scoped to app and tray.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Application code calls `createTray()` directly and owns foreground/background lifetime itself.

Already have a command that serves HTTP locally? `npx create-opentray` wraps it
into an OpenTray-hosted app — interactively through the browser wizard
(`create-opentray web`), fully non-interactively
(`create-opentray create --app-id … --app-name … --exec …`), or read the
built-in AI skill (`npx create-opentray skill`). See the
[create-app guide](./skills/opentray/references/create-app.md).

For the first app, call `createTray()` directly. The default runtime starts the local broker automatically:

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

## Workspace

| Directory                | npm package               | Purpose                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `packages/cli`           | `opentray`                | Developer-facing tray-first SDK and CLI package.         |
| `packages/spec`          | `@opentray/spec`          | TypeScript protocol and shared contract package.         |
| `packages/packaging`     | `@opentray/packaging`     | Bundler-neutral runtime artifact staging contract.       |
| `packages/vite-plugin`   | `@opentray/vite-plugin`   | First Vite adapter over the packaging contract.          |
| `packages/ext-webview`   | `@opentray/ext-webview`   | Rich popup extension facade.                             |
| `packages/ext-webview-*` | `@opentray/ext-webview-*` | Platform WebView dynamic library packages.               |
| `packages/ext-badge`     | `@opentray/ext-badge`     | Platform badge/progress/overlay API extension.           |
| `packages/ext-island`    | `@opentray/ext-island`    | Roadmap dynamic island / live activity extension.        |
| `packages/<os>-<arch>`   | `@opentray/<os>-<arch>`   | Platform runtime artifact packages.                      |

The Lynx extension is maintained in the independent
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) repository.
OpenTray core does not build, stage, or publish Lynx artifacts.

## API

Use `latest` for the newest published package. When an app uses official extensions, lock the same OpenTray protocol-line tag across the package set:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

Use `alpha-A-B` for alpha packages on the same protocol line. Replace `A-B` with the protocol-line tag published by `@opentray/spec`; do not mix `latest` and protocol-line tags unless you are debugging package drift.

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.build",
  icon: {
    type: "file",
    path: "./build.png",
    text: "Build",
    "text-only": "Build",
  },
  tooltip: {
    title: "Build",
    description: "Build monitor",
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

Visible tray text is part of icon projection (`icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`), not a top-level tray `title`. If no visible icon/text survives projection, native tray backends fall back to the runtime `appName` so the tray does not become an invisible click target.
Runtime identity is separate from tray projection. When a host needs explicit
diagnostic identity, pass it through runtime options:

```ts
await createTray(options, {
  appId: "com.example.build",
  appName: "Build",
});
```

`primaryEvent` is a role on a normal menu item and emits the usual `menuClick`.
Use `tray.onTrayClick(...)` when you want to listen to raw tray-icon clicks
without making a menu item the primary route.

The `opentray` package re-exports application-facing types such as
`CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, and
`TrayBoundsResult`. Application code should not need `Parameters<typeof createTray>`
or a direct `@opentray/spec` import for ordinary tray work.

Top-level `createTray(...)` and its returned `setMenu(...)` accept app-facing
menu shorthand. Lower-level `createClient(...)` remains protocol-only for tools
that need exact wire shapes.

If you already own the host process, `createTray()` remains the lower-level tray API.

## Application-Mode Windows

`@opentray/ext-webview` windows are tray-owned utilities by default. Set
`style.appMode: true` when a WebView should behave as an ordinary desktop
application window: it participates in the Windows taskbar and Alt+Tab, or the
macOS Dock and Command-Tab.

```ts
import { WebviewExt } from "@opentray/ext-webview";

const window = tray.extend(WebviewExt).createWebviewWindow({
  url,
  width: 960,
  height: 720,
  style: { appMode: true, autoHide: false },
});
```

`appMode` does not imply `keepOnTop`, frameless chrome, auto-hide, material, or
visibility behavior. Read the public
[application-mode decision guide](skills/opentray/references/app-mode.md) for
normal apps, tray utilities, mixed-window products, Dock reopen, cold
`appLaunch`, development supervisors, and diagnostics.

## Packaging

`@opentray/packaging` stages runtime executable artifacts, native sidecars, and
companion assets into app-id-derived output paths and writes an
`opentray-app-manifest.json` manifest. Adapters ship for the common bundlers:
`@opentray/vite-plugin`, `@opentray/tsdown-plugin`, `@opentray/esbuild-plugin`,
and `@opentray/webpack-plugin`. All four write the same manifest shape; pick by
your existing toolchain.

```ts
import { openTrayVitePlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: {
        source: "node_modules/@opentray/darwin-arm64/bin/opentray",
      },
    }),
  ],
};
```

Platform runtime packages such as `@opentray/darwin-arm64` carry
`bin/opentray` or `bin/opentray.exe`. Packaging remains a build-layer concern. It stages artifacts and emits manifest
truth; it does not own tray lifecycle, session authority, backend selection, or
extension dispatch.

The default `createTray()` transport targets the local runtime host and starts
it on first use when needed. Ordinary app code talks to the packaged
`opentray` executable through the public tray/session protocol; it does not
load a Node addon and does not need to split its business logic into a worker
to create a tray.

## Development Checks

Use focused checks first, then broader gates:

```bash
pnpm --filter @opentray/spec test
pnpm --filter opentray test
cargo test -p opentray-spec --lib
cargo test -p opentray-core --lib
cargo test -p opentray-backend-tray-icon --lib
bun run openspec:vision -- validate opentray-v0-9
git diff --check
```

Human-visible examples live under `packages/cli/examples` and backend crate examples. They should prove real tray/window behavior without importing native GUI or extension-specific logic into `opentray-core`.
