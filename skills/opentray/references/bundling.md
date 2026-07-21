<!--
Orthogonal intents (maintained 2026-07-21; original user request: public bundling guidance
must serve installed-package consumers and contain no OpenTray workspace test commands):
1. Explain the shared packaging manifest contract.
2. Select and configure the consumer's existing bundler adapter.
3. Validate emitted consumer artifacts through the consumer build.
-->

# Bundling

Use this reference when the user wants to package OpenTray runtime artifacts through a bundler (Vite, esbuild, tsdown, webpack) or design a custom adapter over the packaging contract.

## Contract Model

OpenTray packaging is a bundler-neutral three-stage contract in `@opentray/packaging`:

1. **Stage** — `stageOpenTrayPackage(options)` copies declared runtime artifacts into app-id-derived output paths under `outDir`, then writes `opentray-app-manifest.json`.
2. **Manifest** — the manifest records `app`, `entry`, `adapter`, and every staged artifact with a relative `path`. It is the single source of truth for what was packaged.
3. **Resolve** — `resolveOpenTrayPackage(manifestPath)` reads the manifest back and returns absolute paths to the runtime host, native sidecars, and companion assets.

Every bundler adapter is a thin wrapper that resolves three values from its host and forwards them to `stageOpenTrayPackage`:

- `outDir` — absolute path to the build output directory.
- `entry` — the source entry identity (inferred from the bundle when possible).
- `adapter` — `{ name, mode }`, e.g. `{ name: "vite", mode: "production" }`.

The adapter never owns tray lifecycle, session authority, backend selection, or extension dispatch. It stages artifacts and writes manifest truth.

## Choosing An Adapter

| Adapter | Package | Staging hook | `outDir` source | Best for |
|---|---|---|---|---|
| Vite | `@opentray/vite-plugin` | `writeBundle` | `resolve(root, build.outDir)` | App builds, HTML/asset pipelines |
| tsdown | `@opentray/tsdown-plugin` | `writeBundle` | `options.dir` (Rolldown output) | Library builds, ESM-first output |
| esbuild | `@opentray/esbuild-plugin` | `onEnd` | `outdir` / `outfile` | Raw fast transforms, single-file builds |
| webpack | `@opentray/webpack-plugin` | `afterEmit` | `output.path` | Existing webpack pipelines |

All adapters write the **same manifest shape**. Pick by your existing toolchain — do not switch bundlers just for OpenTray. Each adapter makes the host bundler an optional peer dependency, so the package imports cleanly even when the host is absent.

## Configuration Examples

Every adapter requires `app` and `runtimeHost`, and accepts optional
`nativeArtifacts`, `companionAssets`, `entry`, and `manifestPath`. The tsdown
adapter additionally exposes `outDir` and `mode` overrides because its output
hook can run without fully resolved host configuration.

The adapters require an absolute `runtimeHost.source`. Resolve it from the
installed `opentray` dependency closure instead of assuming that an optional
platform package was hoisted into the application's top-level `node_modules`.
For a build that runs on its target platform, keep this consumer-owned helper in
the build configuration:

```ts
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const resolveInstalledOpenTrayRuntime = (): string => {
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin" || process.platform === "linux"
        ? process.platform
        : undefined;
  if (
    platform === undefined ||
    (process.arch !== "arm64" && process.arch !== "x64")
  ) {
    throw new Error(
      `OpenTray has no runtime package for ${process.platform}-${process.arch}`,
    );
  }

  const requireFromOpenTray = createRequire(
    require.resolve("opentray/package.json"),
  );
  const runtimePackageJson = requireFromOpenTray.resolve(
    `@opentray/${platform}-${process.arch}/package.json`,
  );
  return join(
    dirname(runtimePackageJson),
    "bin",
    process.platform === "win32" ? "opentray.exe" : "opentray",
  );
};
```

This resolves through the package that declares the optional platform runtime,
so it works with strict pnpm layouts. Build each distributable on a matching
target runner; a normal install intentionally omits packages for other operating
systems and CPU architectures.

### Vite

```ts
import { openTrayVitePlugin } from "@opentray/vite-plugin";
import { resolveInstalledOpenTrayRuntime } from "./build/opentray-runtime";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: resolveInstalledOpenTrayRuntime() },
    }),
  ],
};
```

### tsdown

```ts
import { defineConfig } from "tsdown";
import { openTrayTsdownPlugin } from "@opentray/tsdown-plugin";
import { resolveInstalledOpenTrayRuntime } from "./build/opentray-runtime";

export default defineConfig({
  entry: ["src/main.ts"],
  plugins: [
    openTrayTsdownPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: resolveInstalledOpenTrayRuntime() },
    }),
  ],
});
```

### esbuild

```ts
import { build } from "esbuild";
import { openTrayEsbuildPlugin } from "@opentray/esbuild-plugin";
import { resolveInstalledOpenTrayRuntime } from "./build/opentray-runtime";

await build({
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  plugins: [
    openTrayEsbuildPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: resolveInstalledOpenTrayRuntime() },
    }),
  ],
});
```

### webpack

```js
import { openTrayWebpackPlugin } from "@opentray/webpack-plugin";
import { resolveInstalledOpenTrayRuntime } from "./build/opentray-runtime";

export default {
  entry: { main: "./src/main.ts" },
  output: { path: "dist" },
  plugins: [
    openTrayWebpackPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: resolveInstalledOpenTrayRuntime() },
    }),
  ],
};
```

## Best Practices

- **`app.id` is the artifact address source.** Staged paths are derived from `normalizeAppId(app.id)` plus a short hash; never hard-code output paths. Two ids that normalize identically are still disambiguated by the hash suffix.
- **Key native artifacts by platform triple.** Use `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-arm64`, etc. as `nativeArtifacts` keys. The key is normalized into the staged file name.
- **Stage in the post-write hook.** Every adapter stages after the bundler has written its own output, so staged artifacts land next to already-emitted files. Never stage from a pre-write hook.
- **Let the bundler own `outDir`.** Rely on the bundler's resolved outDir
  (Vite's `build.outDir`, webpack's `output.path`, etc.). Use tsdown's explicit
  `outDir` override only when its hook cannot supply the final output directory.
- **Discover runtime paths via `resolveOpenTrayPackage`.** Runtime consumers should read the manifest and resolve paths from it, never guess file names. The manifest can live outside the default app artifact directory — pass `artifactRoot` in that case.
- **`entry` is a recorded identity, not a build instruction.** The manifest stores `entry` for diagnostics. Pass it explicitly only when the bundle's entry chunk cannot be inferred; otherwise let the adapter infer it.
- **Missing identity fails explicitly.** An empty `app.id` or `app.name` rejects packaging with `missing_app_id` / `missing_app_name` rather than inventing a generic artifact name. Surface that error to the user — do not paper over it.

## Verification

Run the consumer's real production build, then assert that its output contains
`opentray-app-manifest.json` and every artifact named by that manifest. Call
`resolveOpenTrayPackage(manifestPath)` from a consumer-side packaging test to
prove the staged runtime host and sidecars resolve from the final output. A
successful TypeScript bundle without these emitted files is not a packaging
acceptance pass.

When designing a custom adapter, use the same consumer-level proof: run the
actual bundler, inspect the manifest on disk, and confirm
`resolveOpenTrayPackage` finds every staged artifact.

## Custom Adapters

To write an adapter for a bundler OpenTray does not yet ship, follow the same three-field contract: resolve `outDir` / `entry` / `adapter` from the host, then call `stageOpenTrayPackage` in the host's post-write hook. Do not import the host bundler as a hard dependency — declare it as an optional peer dependency and define local structural types (`*Like` interfaces) so the adapter type-checks without the host installed.
