# OpenTray

OpenTray is a desktop status runtime for Node/Deno/Bun CLI and AI-skill ecosystems.

The v0.9 platform model is tray-first:

- `App`: caller-owned runtime identity and isolation boundary.
- `Tray`: one desktop status atom owned by that app/runtime.
- `Session`: the live source of authority for tray events and mutations.
- `Extension`: optional native capability atom scoped to app and tray.

OpenTray no longer exposes `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()` as public ontology. Application code calls `createTray()` directly and owns foreground/background lifetime itself.

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

## Packaging

`@opentray/packaging` stages runtime host artifacts, native sidecars, and
companion assets into app-id-derived output paths and writes an
`opentray-app-manifest.json` manifest. `@opentray/vite-plugin` is the first
adapter over that shared contract.

```ts
import { openTrayVitePlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
    }),
  ],
};
```

Packaging remains a build-layer concern. It stages artifacts and emits manifest
truth; it does not own tray lifecycle, session authority, backend selection, or
extension dispatch.

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
