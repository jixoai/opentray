# @opentray/webpack-plugin

webpack adapter for the OpenTray runtime artifact packaging contract.

```js
import { openTrayWebpackPlugin } from "@opentray/webpack-plugin";

export default {
  entry: { main: "./src/main.ts" },
  output: { path: "dist" },
  plugins: [
    openTrayWebpackPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
      nativeArtifacts: {
        "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
      },
    }),
  ],
};
```

The adapter stages artifacts in webpack's `afterEmit` hook (after output is
written) and writes the same manifest shape as `@opentray/packaging`. It does not
own tray lifecycle, sessions, backend selection, or extension dispatch.

`outDir` is resolved from `compiler.options.output.path`. `mode` is resolved from
`compiler.options.mode`. `entry` is inferred from the webpack entry config (string,
array, `{ main }`, or an entry map). Pass `outDir`, `mode`, or `entry` in the
plugin options to override them.

`openTrayAppBundlePlugin()` is the Darwin `afterEmit` adapter for the shared
bundle contract. It defaults to `<compiler.options.output.path>/<appName>.app`
and accepts the same broker, template, target, and optional `appIcon` inputs as
the bundler-neutral generator.
