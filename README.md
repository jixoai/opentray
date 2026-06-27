# OpenTray

OpenTray is a desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems.

The current platform model is tray-first:

- `App`: caller-owned runtime identity and isolation boundary.
- `Tray`: one desktop status atom owned by that app/runtime.
- `Session`: the live source of authority for tray events and mutations.
- `Extension`: optional native capability atom scoped to app and tray.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Application code calls `createTray()` directly and owns foreground/background lifetime itself.

For the first app, call `createTray()` directly. The default runtime starts the local broker automatically:

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.first-app",
  icon: { "text-only": "OT" },
  menu: { items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }] },
}, {
  appId: "com.example.first-app",
  appName: "First App",
});

tray.onMenuClick(({ itemId }) => void (itemId === 1 && tray.destroy()));
```

## Workspace

| Directory                | npm package               | Purpose                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `packages/cli`           | `opentray`                | Developer-facing tray-first SDK and CLI package.         |
| `packages/spec`          | `@opentray/spec`          | TypeScript protocol and shared contract package.         |
| `packages/packaging`     | `@opentray/packaging`     | Bundler-neutral runtime artifact staging contract.       |
| `packages/vite-plugin`   | `@opentray/vite-plugin`   | First Vite adapter over the packaging contract.          |
| `packages/ext-lynx`      | `@opentray/ext-lynx`      | Lynx window extension facade.                            |
| `packages/ext-lynx-*`    | `@opentray/ext-lynx-*`    | macOS Lynx dynamic library and runtime sidecar packages. |
| `packages/ext-webview`   | `@opentray/ext-webview`   | Rich popup extension facade.                             |
| `packages/ext-webview-*` | `@opentray/ext-webview-*` | Platform WebView dynamic library packages.               |
| `packages/ext-badge`     | `@opentray/ext-badge`     | Platform badge/progress/overlay API extension.           |
| `packages/ext-island`    | `@opentray/ext-island`    | Roadmap dynamic island / live activity extension.        |
| `packages/<os>-<arch>`   | `@opentray/<os>-<arch>`   | Platform runtime artifact packages.                      |

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
    items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }],
  },
});
```

Visible tray text is part of icon projection (`icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`), not a top-level tray `title`.
Runtime identity is separate from tray projection. When a host needs explicit
diagnostic identity, pass it through runtime options:

```ts
await createTray(options, {
  appId: "com.example.build",
  appName: "Build",
});
```

If you already own the host process, `createTray()` remains the lower-level tray API.

## Packaging

`@opentray/packaging` stages runtime binding artifacts, native sidecars, and
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
        source:
          "node_modules/@opentray/darwin-arm64/runtime/opentray_runtime.node",
      },
    }),
  ],
};
```

Platform runtime packages such as `@opentray/darwin-arm64` carry
`runtime/opentray_runtime.node`. Packaging remains a build-layer concern. It stages artifacts and emits manifest
truth; it does not own tray lifecycle, session authority, backend selection, or
extension dispatch.

The default `createTray()` transport targets the local broker and starts it on
first use when needed. `runVisibleRuntimeHost()` remains available from
`opentray/node` as an explicit diagnostic path for the visible-binding smoke
mode. That diagnostic path still carries the host-main-thread law on macOS and
the app-owned event-loop law on Windows; ordinary app code does not need to
split its business logic into a worker to use the default tray API.

The explicit headless runtime path remains available for protocol/session
diagnostics:

```ts
await createTray(options, { runtime: "headless-binding" });
```

Source-tree debug examples may still opt into `{ runtime: "visible-binding" }`
or `{ runtime: "headless-binding" }`. Those paths are contributor diagnostics,
not the default package runtime.

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
