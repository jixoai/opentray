# @opentray/esbuild-plugin

esbuild adapter for the OpenTray runtime artifact packaging contract.

```ts
import { build } from "esbuild";
import { openTrayEsbuildPlugin } from "@opentray/esbuild-plugin";

await build({
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  plugins: [
    openTrayEsbuildPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
      nativeArtifacts: {
        "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
      },
    }),
  ],
});
```

The adapter stages artifacts in esbuild's `onEnd` hook (after output is written)
and writes the same manifest shape as `@opentray/packaging`. It does not own tray
lifecycle, sessions, backend selection, or extension dispatch.

`outDir` is resolved from the esbuild `outdir`/`outfile` option, relative to the
esbuild `absWorkingDir`. Pass `outDir` or `mode` in the plugin options to override
them. `entry` is inferred from `entryPoints` unless given explicitly.

`openTrayAppBundlePlugin()` is the Darwin `onEnd` adapter for prebuilding a
validated app bundle. Pass `packageName`, `appId`, `appName`, `target`,
`brokerPath`, `templatePath`, and optional `appIcon`; output defaults to
`<outdir>/<appName>.app`.
