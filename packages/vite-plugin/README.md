# @opentray/vite-plugin

Vite adapter for the OpenTray runtime artifact packaging contract.

```ts
import { openTrayVitePlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: { source: "target/release/build-tray-host" },
      nativeArtifacts: {
        "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
      },
    }),
  ],
};
```

The adapter stages artifacts during Vite build output and writes the same
manifest shape as `@opentray/packaging`. It does not own tray lifecycle,
sessions, backend selection, or extension dispatch.
