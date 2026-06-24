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

## Caller identity and per-caller isolation

Each host application gets its own broker process. OpenTray does not aggregate
multiple callers onto one shared tray; a broker is pinned to exactly one caller
session so its process is identifiable in the task manager and killing it only
affects that one application.

The SDK derives a caller label with this precedence:

1. An explicit label: `connectLocalBroker({ callerLabel: "myapp" })`.
2. `npm_package_name` when present.
3. The basename of the running script.
4. The neutral fallback `opentray` when nothing usable is available.

The label is sanitized to a filesystem- and process-safe component and scopes
the broker endpoint, runtime directory, ready file, and the process name, so two
host applications using the same OpenTray version resolve distinct brokers and
endpoints. A broker rejects a second incoming connection with a typed
`OPENTRAY_BROKER_SINGLE_SESSION` error rather than silently sharing state.


## Example

Run a protocol-only example that creates a space, creates a tray, dispatches an extension command, and prints each client frame:

```bash
pnpm --filter opentray example:basic
```

The top-level SDK now exposes the mainline broker-backed path directly:

```ts
import { createSpace, createTray, resolveDefaultSpace } from "opentray";

const space = await createSpace({ id: "com.example.status", default: true });
const tray = await space.createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "file", path: "./assets/tray-icon.png" },
  menu: { items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }] },
});

await tray.setTitle("Status: ready");
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // Open a native menu action or a WebView surface.
  }
});

const defaultSpace = await resolveDefaultSpace();
await createTray(
  {
    trayId: "secondary",
    title: "Secondary",
    icon: { type: "file", path: "./assets/tray-icon.png" },
  },
  { space: defaultSpace.space }
);
```

`createTray()` resolves the broker default space when no explicit target is provided. If you already know the target, pass `space: defaultSpace.space` in the second argument instead of relying on default-space lookup.

Run the human-visible daemon tray example:

```bash
pnpm --filter opentray example:daemon-tray
```

Run the direct webview control demo:

```bash
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:webview-control -- --overlay
pnpm --filter opentray example:webview-control -- --no-overlay
```

That demo opens a native WebView window immediately and puts the controls inside the page itself, so you can exercise frameless, background modes, keep-on-top, title, icon, screen, overlay, and navigation behavior without going through the tray menu first. The control demo enables the show-time `windowControlsOverlay` capability by default; use `-- --no-overlay` when you want to test the disabled path.
Treat `example:webview-control` as the API exercise surface. It is useful for probing capabilities and events, but it is not the canonical recipe for a tray-anchored glass shell.

Application code mounts WebView as a tray capability. The first WebView command loads the native extension automatically; ordinary code does not need to send `load-ext` manually:

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const tray = (await createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "file", path: "./tray-icon.png" },
})).extend(WebviewExt);

const panel = tray.createWebviewWindow({
  html: "<main>Status</main>",
  width: 360,
  height: 240,
});

await panel.show();
```

For tray-anchored or screen-aware surfaces, use `WebviewPlacementKit` from `@opentray/ext-webview` instead of hand-authoring raw broker frames or creating a one-off panel abstraction.

Run the placement demo when you want to review tray, screen, and edge-aware placement:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray example:placement
```

This demo follows the `skills/opentray` placement law: extension-owned WebView mounting, continuous `WebviewPlacementKit.watch()`, `applyOnce()`, tray/screen/edge anchors, and a page-owned frameless drag region.

Run the media query demo when you want to review responsive native window style and constraints:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray example:mediaQuery
```

This demo focuses on `styleKit.apply(...)` and `mediaQueryKit.match(...)`. Keep it separate from placement debugging so size/style callbacks do not obscure placement behavior.

Run the dedicated tray-panel demo:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray example:tray-panel
```

This demo is the canonical custom TrayPanel case: one `primaryEvent` tray item, backend `tray.getBounds()`, page `navigator.opentray.tray.getBounds()`, screen-aware repositioning, and a frameless glass panel with `keepOnTop`.
It also follows the native-glass rule strictly: material background through `style.background`, no root HTML shell styling, and content padding only inside the page.
On macOS it requests `{ kind: "platformMaterial", material: "hudWindow", state: "active" }` so the tray-launched material surface does not immediately fall back to the inactive grey AppKit appearance. On Windows it uses `background: "mica"` and `cornerPreference: "round"` instead of sending macOS-only style.
For a step-by-step walkthrough of the examples and expected behavior, read [examples/EXAMPLE.md](./examples/EXAMPLE.md).

## Release Channels And Maturity

OpenTray uses release channels and capability maturity together. Do not read a published platform package as proof that every visible runtime path is already stable.

- `latest`: the stable package line
- `alpha`: the prerelease/testing package line, installed as `npm i opentray@alpha`

Current WebView truth:

- macOS is the current `stable` human-visible acceptance path
- Windows is the current `stable` WebView2-backed human-visible acceptance path for common bridge/window controls, background material/corner preferences, and native icon projection
- Linux remains supported by the OpenTray core daemon/packages, but `@opentray/ext-webview` does not publish Linux native WebView packages
- some requests are `unsupported by design`, such as asking the macOS runtime to apply a Windows-only style family
- some results are `unavailable by context`, such as tray-bounds projection when the current session has no authoritative tray anchor

When run from the repo worktree, the example automatically discovers `target/debug` or `target/release` `libopentray_ext_webview` and wires it through `OPENTRAY_EXT_PATH` before starting the daemon. The WebView mount still exercises the real generic extension loader, but example users do not author a manual `load-ext` request.

The published CLI is intentionally small and only owns daemon lifecycle and health:

```bash
opentray daemon health
opentray daemon start
opentray daemon stop
opentray daemon restart
```

Visual smoke is a real runtime activity, not a daemon CLI subcommand. It may auto-start or reuse the same-version daemon, write runtime coordination files under `$OPENTRAY_HOME/.opentray/<package-version>/runtime` or the user's home directory when `OPENTRAY_HOME` is unset, create a visible tray item, load native extension packages, and open real WebView/Lynx windows. Use the `opentray` skill or source-tree examples to orchestrate those checks, and run `opentray daemon stop` if you want immediate daemon cleanup or if a smoke process was interrupted.

This example starts or reuses the same-version daemon automatically, creates a real tray through the public SDK, and prints broker-routed menu events. Use manual lifecycle commands only for operator/debug control:

```bash
pnpm --filter opentray cli -- daemon start
pnpm --filter opentray cli -- daemon stop
pnpm --filter opentray cli -- daemon restart
```

The menu intentionally declares only one plain item: `Open WebView` with `primaryEvent: true`. On macOS, that single primary item lets clicking the status item direct-trigger the normal `menuClick` event without opening a menu, so the example can behave like a one-action launcher for a WebView-built surface.

On platforms that expose a direct tray activation gesture, the same item opens the WebView immediately while still remaining a normal native menu item on platforms or gestures that show a menu.

The host side of that example can call `await tray.getBounds()` to read the current tray geometry before opening the window. The rendered page can also opt into `navigator.opentray.tray.getBounds()` when it needs the same tray anchor for layout.

The opened WebView also enables the injected page bridge so the rendered page can call `navigator.window` / `navigator.opentrayWindow` and, for the demo only, opt into `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides. Use the in-page buttons to verify `getCapabilities`, `getStyle`, `setStyle({ frameless })`, move, resize, close, and tray-bounds behavior visually instead of relying only on terminal logs.

The Lynx example path uses the same generic extension loader but launches a real `OpenTrayLynxRuntime.app.zip` sidecar from `@opentray/ext-lynx-darwin-*`. It starts the requested `.lynx.bundle` in a fixed host shell, sets an initial title and icon, applies an explicit startup feature expression, and exposes `Show Window`, `Hide Window`, and `Quit Smoke` through tray-routed events. Inside the Lynx window, use the rendered controls to verify `getCapabilities`, `getStyle`, `getTitle`, `setTitle`, `getIcon`, `setIcon`, `navigator.screen.getScreenDetails()`, `resizeTo`, `moveTo`, frameless toggling, `window.resizeTo()`, `window.getScreenDetails()`, and close behavior visually. On macOS, the runtime Dock icon should no longer appear blank.

For Lynx, `frameless` currently means borderless only. It does not imply a full-window drag region, because that would steal clicks from the page content. When isolating host-feature regressions, `--features "*,!frameless"` is the fastest way to keep the bridge on while removing the borderless shell from the test.

When you need to validate a GitHub-built macOS artifact before publish, use the workspace launcher instead of hand-written `/tmp` scripts:

```bash
pnpm run smoke:lynx -- --run <github-actions-run-id> --bundle packages/cli/assets/lynx-review/main.lynx.bundle
pnpm run smoke:lynx -- --run <github-actions-run-id> --bundle packages/cli/assets/lynx-review/main.lynx.bundle --features "nativeWindowApi,bindWindowGlobals,nativeScreenApi,bindScreenGlobals"
pnpm run smoke:lynx -- --run <github-actions-run-id> --bundle packages/cli/assets/lynx-review/main.lynx.bundle --features "*,!nativeScreenApi"
```

The workspace review bundle is the full human acceptance surface. The separate `input-probe.lynx.bundle` is only a low-level diagnostic asset for isolating raw click/scroll/input delivery. The empty feature set is the baseline carrier check. Use it to validate the physical window baseline: click, scroll, input, red/yellow/green controls, and resize/move. Only after that baseline is healthy should you validate explicit startup feature sets on top of the same carrier.

First-stage core daemon platform packages are published for macOS, Linux, and Windows. macOS and Windows are stable WebView human-visual acceptance paths for common window and bridge commands plus native material projection. Linux is not an official `@opentray/ext-webview` runtime target. Lynx is intentionally macOS-first for now and should fail honestly on other platforms instead of pretending the runtime exists.

If you are validating the current prerelease branch before stable publication, install from the alpha channel and treat that as alpha evidence rather than stable evidence:

```bash
npm i opentray@alpha
```

For local native smoke before npm publish, stage the current platform artifacts first and run source-tree examples:

```bash
cargo build -p opentray-bin -p opentray-ext-webview -p opentray-ext-lynx
bun run scripts/binaries/stage-local.ts --kind daemon --source target/debug/opentray
bun run scripts/binaries/stage-local.ts --kind webview --source target/debug/libopentray_ext_webview.dylib
bun run scripts/binaries/stage-local.ts --kind lynx --source target/debug/libopentray_ext_lynx.dylib
bash scripts/release/build-lynx-runtime.sh /tmp/OpenTrayLynxRuntime.app.zip
bun run scripts/binaries/stage-local.ts --kind lynx-runtime --source /tmp/OpenTrayLynxRuntime.app.zip
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

During source-level daemon work, restart the daemon with the freshly built broker binary before testing tray behavior. Otherwise the CLI may reuse the already staged same-version daemon:

```bash
cargo build -p opentray-bin
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray cli -- daemon restart
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
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

The native `tray-icon` backend now normalizes `encoded` and `file` icon inputs into RGBA before native tray materialization. `rgba` still works when you already have pixel data, but ordinary app code can point at a PNG file instead of hand-building pixels.
