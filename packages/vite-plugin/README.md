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

## Application Icon

Use `openTrayAppIconPlugin` in a consumer's Vite config to generate one strict
cross-platform `AppIcon` asset set from the consumer's brand source. The plugin
runs in both `vite dev` and `vite build`; generated files are written under the
Vite root's `static/icons` directory so the same paths are available to the dev
daemon and the packaged build.

```ts
import { fileURLToPath } from "node:url";
import { openTrayAppIconPlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayAppIconPlugin({
      sourcePath: fileURLToPath(
        new URL("../resources/color-symbol.png", import.meta.url)
      ),
    }),
  ],
};
```

The cache identity includes the source image, the plugin implementation, the
rendering recipe, and the `sharp`, `@shockpkg/icon-encoder`, and
`figma-squircle` versions. ICNS output uses explicit macOS @1x/@2x tags rather
than copying one PNG into incompatible representation slots. In a linked
checkout the cache also hashes `packages/vite-plugin/src/app-icon.ts`, so editing
the generator source invalidates the cache even when the bundle hash is
unchanged. A linked consumer should rebuild this package before starting Vite.

The output contains:

```text
static/icons/
|- app-icon.icns                 Darwin application asset
|- app-icon.ico                  Windows application asset
|- app-icon.json                 portable AppIcon manifest
|- app-icon.png                  1024px rendered preview
`- linux/<size>x<size>/app-icon.png
```

`generateOpenTrayAppIcon()` returns an `appIcon` array whose file paths are
absolute and can be passed directly to `createTray(..., { appIcon })`. Paths in
`app-icon.json` are relative to the manifest so packaged outputs remain
relocatable. The application contract accepts only `darwin/icns`,
`windows/ico`, and `linux/png|svg` assets; it does not accept tray templates,
raw RGBA, text, or page favicons.

## Darwin App Bundle

Use `openTrayAppBundlePlugin()` to prebuild the same stable bundle consumed by
runtime `appBundle.reinitialize: false`. The plugin delegates all file layout,
hashes, and manifest rules to `@opentray/packaging` and defaults to
`<vite outDir>/<appName>.app`.
