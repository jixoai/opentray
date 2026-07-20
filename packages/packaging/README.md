# @opentray/packaging

Bundler-neutral packaging contract for app-owned OpenTray runtime hosts.

The package stages declared runtime artifacts into output paths derived from
`app.id`, then writes a manifest that runtime diagnostics and adapters can read
without guessing workspace layout.

```ts
import { stageOpenTrayPackage } from "@opentray/packaging";

await stageOpenTrayPackage({
  app: { id: "com.example.build", name: "Build" },
  outDir: "dist",
  entry: "src/main.ts",
  adapter: { name: "custom", mode: "production" },
  runtimeHost: { source: "target/release/build-tray-host" },
  nativeArtifacts: {
    "darwin-arm64": { source: "target/release/libbuild_tray.dylib" },
  },
});
```

Runtime discovery reads the emitted manifest instead of guessing file names:

```ts
import { resolveOpenTrayPackage } from "@opentray/packaging";

const packaged = await resolveOpenTrayPackage(
  "dist/com-example-build-cdd5538b13/opentray-app-manifest.json",
);

console.log(packaged.runtimeHostPath);
```

If the manifest is written outside the default app artifact directory, pass
`artifactRoot` so runtime discovery resolves staged paths from the distributable
root instead of the manifest directory.

`app.id` is the artifact address source. `app.name` is the human label. Missing
or empty identity fails packaging instead of inventing a generic `opentray`
artifact name.

## Darwin App Bundles

`buildDarwinAppBundle()` is the one bundle generator used by the Vite, esbuild,
webpack, and tsdown adapters. It copies the selected broker into
`Contents/MacOS/opentray`, projects the caller identity into `Info.plist`,
writes the default ICNS into `Contents/Resources`, and commits
`opentray-app-bundle.json` last. Runtime managed mode and plugin prebuilds
therefore produce the same manifest and layout.

`ensureDarwinAppBundle({ reinitialize: false })` validates the immutable bundle
assets without writing them. It rejects target, identity, broker, template, or
icon drift with `DarwinAppBundleError`.

The mutable last invocation is stored separately at
`Contents/Resources/opentray-launch.json`. `updateDarwinAppLaunchDescriptor()`
uses the same stable-bundle lock and atomic sibling replacement as managed
generation. The strict schema contains only `schemaVersion`, `command`, `args`,
and `cwd`; it never contains a shell string or environment map. The `opentray`
SDK commits this state after a successful local broker handshake, including for
validated prebuilt bundles.
