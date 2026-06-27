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
- Windows source-tree smoke exercises the stable WebView2-backed visible runtime and common bridge/window controls
- Linux remains a core runtime/platform target, but `@opentray/ext-webview` does not publish Linux native WebView packages
- typed unsupported errors are acceptable evidence for not-yet-landed platform runtimes
- tray bounds with no injected anchor should show `kind: "unavailable"` rather than pretending the capability is absent everywhere
- the placement demo is the focused `WebviewPlacementKit` visual surface
- the media query demo is the focused `mediaQueryKit` + `styleKit` visual surface

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

## Example 0: First App

Command:

```bash
pnpm --filter opentray example:first-app
```

Expected checks:

1. A tray appears without the user having to manage a worker or start a host loop first.
2. The example stays under the quickstart path: one callback, one tray, one menu action.
3. The tray closes cleanly when `Quit` is clicked.

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

On Windows, macOS corner controls remain unsupported, while `style.platform.windows.cornerPreference` is the native DWM corner family. Windows DWM material choice lives in `style.background`.

## Example 2: Placement Kit

Command:

```bash
pnpm --filter opentray example:placement
```

Expected checks:

1. The terminal prints the placement trace: `WebviewPlacementKit watch/applyOnce with tray, screen, and edge anchors`.
2. The tray menu contains `Open Placement Kit` and `Quit Demo`.
3. Selecting `Open Placement Kit` opens a frameless, blur-active WebView panel.
4. `Watch` buttons switch continuous placement among tray, screen edge/corner, and edge-snap modes.
5. `Apply Once` buttons run one-shot placement and then stop the continuous watch.
6. Dragging the header moves the native window through `startAppRegionDrag()` and pauses the placement watch until the native move loop exits.
7. The result panel shows `placement`, `kind`, `source`, `anchorRect`, and `rect`.
8. The example does not demonstrate timer state, dynamic tray menus, or responsive style rules; those are covered by other examples.

For quick smoke:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:placement
```

## Example 3: Media Query Kit

Command:

```bash
pnpm --filter opentray example:mediaQuery
```

Expected checks:

1. The terminal prints the media query trace: `styleKit recipes + mediaQueryKit native-bounds callbacks`.
2. The tray menu contains `Open Media Query Kit` and `Quit Demo`.
3. Selecting `Open Media Query Kit` opens a frameless, blur-active WebView panel styled by `styleKit.apply(...)`.
4. Compact, Comfort, Wide, and Tall buttons call backend resize intents; `mediaQueryKit.match(...)` updates matched state from native bounds.
5. Manual native resize should update the same matched state after the native interaction ends.
6. The example demonstrates native size constraints and style recipes, not placement anchors.

For quick smoke:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:mediaQuery
```

## Example 4: Tray Panel

Command:

```bash
pnpm --filter opentray example:tray-panel
```

Expected checks:

1. On macOS and Windows, the example auto-discovers the local `libopentray_ext_webview` / `.dll` when `OPENTRAY_EXT_PATH` is unset.
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

## Example 5: Debug Runtime Tray

Command:

```bash
pnpm --filter opentray example:debug-runtime-tray
```

Expected checks:

1. The tray exposes a single `primaryEvent` launcher item.
2. The runtime logs show `menuClick` when the primary action is triggered.
3. The opened WebView uses `tray.getBounds().rect` for `fallbackRect`.
4. The page projection `navigator.opentray.tray.getBounds()` returns the same provenance-bearing result family.

## Non-Interactive Smoke Paths

Run the finite package matrix when checking the source-tree examples together:

```bash
pnpm --filter opentray example:matrix
pnpm --filter opentray example:matrix -- --row webview-control
```

The matrix does not depend on shell wildcard expansion. It stages the generated `runtime/opentray_runtime.node` artifact before the explicit diagnostic `visible-binding` row, warms the broker binary before `first-app`, labels WebView/Badge/Lynx rows as contributor-only `extension-debug-runtime` coverage, and prints explicit skip reasons for unsupported platforms or missing carrier artifacts.

These are useful for quick regression passes:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:mediaQuery
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:placement
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show pnpm --filter opentray example:tray-panel
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --overlay
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay
OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2500 pnpm --filter opentray example:webview-control
```

## Failure Hints

- If an example cannot find the native library, confirm `cargo build -p opentray-ext-webview` succeeded and `target/debug` contains the platform artifact.
- If the debug runtime returns a generic `unsupported` or `internal` error, rerun with:

```bash
export OPENTRAY_DAEMON_STDIO=inherit
export OPENTRAY_WEBVIEW_DEBUG=1
```

This lets the debug runtime print the native ext-webview error message directly into the example terminal.

- If tray behavior looks stale, point the source-tree transport at the freshly built debug runtime binary:

```bash
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray example:debug-runtime-tray
```

- If glass looks opaque, inspect both native style and page content:
  - `style.background` must be `transparent`, `semantic: blur`, or `platformMaterial`
  - the page must leave transparent regions
  - the page must not draw the outer shell with CSS blur or root border radius
