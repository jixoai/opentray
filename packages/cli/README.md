# opentray

Developer-facing OpenTray package.

This is the package users install directly:

```bash
pnpm add opentray
```

## Role

- Resolve or auto-start the OpenTray broker.
- Expose `createSpace()`, default space resolution, and `createTray()`.
- Route extension packages through public OpenTray contracts.
- Resolve per-platform optional binary packages.

`packages/cli` is the only unscoped npm package in this monorepo.

## Example

Run a protocol-only example that creates a space, creates a tray, dispatches an extension command, and prints each client frame:

```bash
pnpm --filter opentray example:basic
```

The top-level SDK now exposes the mainline broker-backed path directly:

```ts
import { createSpace, createTray, resolveDefaultSpace } from "opentray";

const space = await createSpace({ id: "com.example.status", default: true });
await space.createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
});

const defaultSpace = await resolveDefaultSpace();
await createTray(
  {
    trayId: "secondary",
    title: "Secondary",
    icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
  },
  { space: defaultSpace.space }
);
```

`createTray()` resolves the broker default space when no explicit target is provided. If you already know the target, pass `space: defaultSpace.space` in the second argument instead of relying on default-space lookup.

Run the human-visible daemon tray example:

```bash
pnpm --filter opentray example:daemon-tray
```

After installing from npm, use the published CLI smoke path instead of workspace scripts:

```bash
opentray smoke daemon-tray
opentray smoke daemon-lynx
```

`opentray smoke daemon-lynx` now uses the package-owned review bundle by default so a fresh npm install can perform the final visual audit without a workspace checkout. Keep `--bundle <path-to-main.lynx.bundle>` only when you want to override that official audit asset with a custom bundle.

This example starts or reuses the same-version daemon automatically, creates a real tray through the public SDK, and prints broker-routed menu events. Use manual lifecycle commands only for operator/debug control:

```bash
pnpm --filter opentray cli -- daemon start
pnpm --filter opentray cli -- daemon stop
pnpm --filter opentray cli -- daemon restart
```

The menu includes `WebView Commands` entries that call the `@opentray/ext-webview` facade. On macOS, `Show HTML` loads the platform WebView dynamic library and opens a real native WebView window owned by that library; `Navigate`, `Post Message`, `Evaluate JS`, and `Hide` operate on that window.

The `Show HTML` demo also enables the injected page bridge so the rendered page can call `navigator.window` / `navigator.opentrayWindow` and, for the demo only, opt into `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides. Use the in-page buttons to verify `getCapabilities`, `getStyle`, `setStyle({ frameless })`, move, resize, and close behavior visually instead of relying only on terminal logs.

The Lynx smoke path uses the same generic extension loader but launches a real `OpenTrayLynxRuntime.app.zip` sidecar from `@opentray/ext-lynx-darwin-*`. It starts the requested `.lynx.bundle` immediately in fit-content mode, sets an initial title and icon, enables `navigator.window`, enables `navigator.screen`, enables global overrides for validation, and exposes `Show Fit Window`, `Show Fixed Window`, `Hide Window`, and `Quit Smoke` through tray-routed events. Inside the Lynx window, use the rendered controls to verify `getCapabilities`, `getStyle`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `navigator.screen.getScreenDetails()`, `resizeTo`, `moveTo`, frameless toggling, `window.resizeTo()`, `window.getScreenDetails()`, and close behavior visually. On macOS, the runtime Dock icon should no longer appear blank.

First-stage platform packages are published for macOS, Linux, and Windows. macOS is the current human-visual acceptance path. Linux and Windows artifacts are present for package topology validation, but unsupported broker/WebView capability must fail explicitly rather than pretending a visible UI exists. Lynx is intentionally macOS-first for now and should fail honestly on other platforms instead of pretending the runtime exists.

For local native smoke before npm publish, stage the current platform artifacts first:

```bash
cargo build -p opentray-bin -p opentray-ext-webview -p opentray-ext-lynx
bun run scripts/binaries/stage-local.ts --kind daemon --source target/debug/opentray
bun run scripts/binaries/stage-local.ts --kind webview --source target/debug/libopentray_ext_webview.dylib
bun run scripts/binaries/stage-local.ts --kind lynx --source target/debug/libopentray_ext_lynx.dylib
bash scripts/release/build-lynx-runtime.sh /tmp/OpenTrayLynxRuntime.app.zip
bun run scripts/binaries/stage-local.ts --kind lynx-runtime --source /tmp/OpenTrayLynxRuntime.app.zip
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray cli -- smoke daemon-tray
pnpm --filter opentray cli -- smoke daemon-lynx
```

The daemon exits automatically after 30 seconds with no connected clients. Set `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0` to keep it alive during debugging, or provide another millisecond value for a custom idle release window.

`OPENTRAY_HOME` should point at a home root, not the `.opentray` state directory itself. OpenTray always stores versioned state under `"$OPENTRAY_HOME/.opentray/<package-version>"`.

To confirm the native runtime split on macOS after a release build:

```bash
cargo build -p opentray-bin -p opentray-ext-webview -p opentray-ext-lynx --release
wc -c target/release/opentray target/release/libopentray_ext_webview.dylib target/release/libopentray_ext_lynx.dylib
otool -L target/release/opentray
otool -L target/release/libopentray_ext_webview.dylib
otool -L target/release/libopentray_ext_lynx.dylib
```

Current native icon support is `rgba`. `encoded` and `file` are typed protocol shapes, but the native `tray-icon` backend reports them as unsupported until decoding and file loading policy are implemented.
