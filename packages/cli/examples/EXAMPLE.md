# OpenTray WebView Example Manual Test Guide

This guide is for manual source-tree verification of the official WebView examples in `packages/cli/examples`.

## Scope

Use these examples to verify the delivered window contract in this branch:

- common shell traits: `frameless`, `background`, `keepOnTop`
- background modes: `opaque`, `transparent`, semantic `blur`, and platform material names
- platform corner family: `style.platform.macos.cornerRadius` and `style.platform.windows.cornerPreference`
- title/icon sync
- overlay geometry and native drag
- window-state controls
- tray-owned placement projection through `tray.getBounds()` and `navigator.opentray.tray.getBounds()`
- source-tree auto-discovery of the local `opentray-ext-webview` native library
- WebView examples mount `WebviewExt` on a tray and rely on automatic extension loading, not a hand-authored `load-ext` request
- tray icon smoke helpers stay internal; ordinary tray code can supply file-backed or encoded PNG icon sources and let the backend normalize them to RGBA

Current maturity truth for these examples:

- macOS source-tree smoke is the stable human-visible proof path
- Windows source-tree smoke exercises the alpha WebView2-backed visible runtime and common bridge/window controls
- Linux platform packages remain alpha runtime territory until a visible native runtime lands
- typed unsupported errors are acceptable evidence for not-yet-landed platform runtimes
- tray bounds with no injected anchor should show `kind: "unavailable"` rather than pretending the capability is absent everywhere

This guide does **not** prove future bootstrap families such as managed `window.open()`, localhost asset origin hosting, profile/partition control, or host/page devtools APIs.

## Preflight

Run from the repo root:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray typecheck
```

Optional debugging knobs:

```bash
export OPENTRAY_EXT_BUILD_LOGS=1
export OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0
export OPENTRAY_DAEMON_STDIO=inherit
export OPENTRAY_WEBVIEW_DEBUG=1
```

Useful smoke env vars:

```bash
export OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500
export OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1
export OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1
```

## Example 1: Control Surface

Command:

```bash
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:webview-control -- --overlay
pnpm --filter opentray example:webview-control -- --no-overlay
```

Expected checks:

1. A normal opaque WebView window opens immediately without requiring tray interaction.
2. The capability panel shows nested platform data under the active `platformCapabilities.*` family.
3. `Toggle Frameless`, `Apply Background`, and `Toggle Topmost` update `getStyle()` and emit `stylechange`.
4. `Apply Background` updates the single `style.background` mode. Platform material names are accepted only on the matching substrate, while semantic `blur` maps to the runtime's platform material.
5. `Apply Corner` updates only the active platform corner API, while `System Corner` clears that platform corner setting.
6. `Minimize`, `Maximize`, and `Restore` update `windowstatechange`.
7. By default, the custom titlebar and overlay drag test area can drag the native window through `startAppRegionDrag()`.
8. `navigator.screen.getScreenDetails()` returns the current screen snapshot.
9. Title/icon controls update both the page state and native state.
10. By default, `getTitlebarAreaRect()` refreshes overlay geometry, and the explicit `Listen geometrychange` button controls whether `overlay.geometrychange` appears in the event log. With `--no-overlay`, the overlay panel should show the launch switch unchecked and report that `windowControlsOverlay` is disabled for this run.

Overlay is a show-time capability gate, not a runtime style. The control demo enables it by default because this is the overlay acceptance surface. You can force it on with `OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY=1` or force it off with `--no-overlay` / `OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY=0`.

On Windows alpha, macOS corner controls remain unsupported, while `style.platform.windows.cornerPreference` is the native DWM corner family. Windows DWM material choice now lives in `style.background`.

## Example 2: Tray Panel

Command:

```bash
pnpm --filter opentray example:tray-panel
```

Expected checks:

1. The example auto-discovers the local `libopentray_ext_webview` / `.dll` / `.so` when `OPENTRAY_EXT_PATH` is unset.
2. The tray exposes exactly one `primaryEvent` item; on macOS, clicking the tray icon direct-triggers the panel instead of opening a native menu.
3. The panel uses:
   - `frameless: true`
   - `keepOnTop: true`
   - `background: { kind: "platformMaterial", material: "hudWindow", state: "active" }` and `cornerRadius: 22` on macOS
   - `background: "mica"` and `cornerPreference: "round"` on Windows
4. `html` and `body` stay reset and transparent; padding belongs to inner content only.
5. The panel positions from `fallbackRect: trayBounds.rect ?? ...`.
6. The in-page tray API returns a provenance-bearing object:

```json
{
  "kind": "native | inferred | unavailable",
  "source": "...",
  "rect": { "x": 0, "y": 0, "width": 0, "height": 0 }
}
```

7. The page status surface shows the same tray result shape instead of assuming `Rect | null`.

## Example 3: Daemon Tray

Command:

```bash
pnpm --filter opentray example:daemon-tray
```

Expected checks:

1. The tray exposes a single `primaryEvent` launcher item.
2. The broker logs show `menuClick` when the primary action is triggered.
3. The opened WebView uses `tray.getBounds().rect` for `fallbackRect`.
4. The page projection `navigator.opentray.tray.getBounds()` returns the same provenance-bearing result family.

## Non-Interactive Smoke Paths

These are useful for quick regression passes:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show pnpm --filter opentray example:tray-panel
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --overlay
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay
OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2500 pnpm --filter opentray example:webview-control
```

## Failure Hints

- If an example cannot find the native library, confirm `cargo build -p opentray-ext-webview` succeeded and `target/debug` contains the platform artifact.
- If the broker returns a generic `unsupported` or `internal` error, rerun with:

```bash
export OPENTRAY_DAEMON_STDIO=inherit
export OPENTRAY_WEBVIEW_DEBUG=1
```

  This lets the background broker print the native ext-webview error message directly into the example terminal.
- If tray behavior looks stale, restart the daemon with the freshly built broker:

```bash
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray cli -- daemon restart
```

- If glass looks opaque, inspect both native style and page content:
  - `style.background` must be `transparent`, `semantic: blur`, or `platformMaterial`
  - the page must leave transparent regions
  - the page must not draw the outer shell with CSS blur or root border radius
