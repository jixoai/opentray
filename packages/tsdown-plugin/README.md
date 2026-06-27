# @opentray/tsdown-plugin

tsdown adapter for the OpenTray runtime artifact packaging contract.

```ts
import { defineConfig } from "tsdown";
import { openTrayTsdownPlugin } from "@opentray/tsdown-plugin";

export default defineConfig({
  entry: ["src/main.ts"],
  plugins: [
    openTrayTsdownPlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
      nativeArtifacts: {
        "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
      },
    }),
  ],
});
```

The adapter stages artifacts during the tsdown build output (`writeBundle`) and
writes the same manifest shape as `@opentray/packaging`. It does not own tray
lifecycle, sessions, backend selection, or extension dispatch.

`outDir` is resolved from the writeBundle output options (`options.dir`). `mode`
defaults to `production`. Pass `outDir` or `mode` in the plugin options to
override them when running outside a real tsdown build.
