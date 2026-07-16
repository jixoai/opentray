# OpenTray WebView Example Manual Test Guide

This guide is for manual source-tree verification of the official WebView examples in `packages/cli/examples`.

## Scope

Use these examples to verify the delivered window contract in this branch:

- common shell traits: `frameless`, `background`, `keepOnTop`, `opacity`
- HTML-standard download semantics through the native runtime download handlers
- background modes: `opaque`, `transparent`, semantic `blur`, and platform material names
- platform corner family: `style.platform.macos.cornerRadius` and `style.platform.windows.cornerPreference`
- title/icon sync
- overlay geometry and native drag
- window-state controls
- host/page devtools commands gated by `devtools: true`
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

This guide does **not** prove future bootstrap families such as managed `window.open()`, localhost asset origin hosting, or profile/partition control.

## Unified SvelteKit App

Every WebView example is a route in a single private SvelteKit SPA at `packages/cli/examples/app`. Routes are mutually isolated — each owns its full window surface and shares only the component library (`src/lib/components/ui`) and build pipeline. The root layout renders no chrome; the index page at `/` is the sole cross-example navigation surface.

Pages are pure CSR (SSR and prerendering are off because they read `navigator.opentrayWindow`). The dev server binds to loopback only, so the native runtime classifies the page origin as `Local` and the default `nativeApiPolicy.defaultSrc: ["'local'"]` admits every capability — no per-route policy override is needed.

Every runnable WebView example has one dynamic `primaryEvent` item. It reads `Show Example` while its retained window is hidden/minimized and `Hide Example` while visible. First use calls `show()`, later reveal calls `toVisible()`, hiding calls `close()`, and `visibleChange` refreshes the label. Native window listeners are installed only after first show and are removed before the example destroys its window and closes the runtime.

Each example launcher (`*-panel.ts`) spawns the shared dev server via `_support/dev-server.ts`, parses the assigned port, and loads its own route through `createWebviewWindow({ url })`. Routes:

| Route                 | Example launcher             |
| --------------------- | ---------------------------- |
| `/download`           | `example:download`           |
| `/webview-control`    | `example:webview-control`    |
| `/win32-bug`          | `example:win32-bug`          |
| `/tray-panel`         | `example:tray-panel`         |
| `/placement`          | `example:placement`          |
| `/media-query`        | `example:mediaQuery`         |
| `/badge`              | `example:badge`              |
| `/debug-runtime-tray` | `example:debug-runtime-tray` |

First-time setup (one-off, shared by all WebView examples):

```bash
cd packages/cli/examples/app && bun install
```

The three non-WebView examples (`basic-tray`, `first-app`, `debug-runtime-lynx`) remain standalone scripts with no page.

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

Every example entrypoint accepts `--release` / `-r` to use source-tree release
artifacts instead of debug artifacts:

```bash
pnpm --filter opentray example:webview-control -r
pnpm --filter opentray example:matrix -r -- --row webview-control
```

Debug remains the default. `-r` builds the relevant native packages with
`cargo build --release`, points the local broker at `target/release/opentray`,
and resolves extension libraries from `target/release`. Release mode still
keeps the explicit devtools API available; our WebView examples always opt the
instance in with `devtools: true` so downstream developers can debug through
`navigator.opentrayWindow.devtools.open()`.

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
3. `Toggle Frameless`, `Apply Background`, `Toggle Topmost`, and opacity changes update `getStyle()` and emit `stylechange`.
4. `Apply Background` updates the single `style.background` mode. Platform material names are accepted only on the matching substrate, while semantic `blur` maps to the runtime's platform material. `style.opacity` is separate whole-window alpha and does not choose or mutate the background mode.
5. `Apply Corner` updates only the active platform corner API, while `System Corner` clears that platform corner setting.
6. `Minimize`, `Maximize`, and `Restore` update `windowstatechange`; minimizing makes operational `visible` false until restore.
7. With `frameless: true, resizable: true`, drag every edge and corner continuously, then minimize and restore. No native titlebar/frame pixels or minimize/restore flicker may appear.
8. By default, the custom titlebar and overlay drag test area can drag the native window through `startAppRegionDrag()`.
9. `navigator.screen.getScreenDetails()` returns the current screen snapshot.
10. Title/icon controls update both the page state and native state.
11. The Devtools section opens the native inspector through `navigator.opentrayWindow.devtools.open()`. On macOS, close/state buttons are enabled when supported in both debug and release mode; on Windows, close/state stay disabled because the runtime exposes only honest open support.
12. By default, `getTitlebarAreaRect()` refreshes overlay geometry, and the explicit `Listen geometrychange` button controls whether `overlay.geometrychange` appears in the event log. With `--no-overlay`, the overlay panel should show the launch switch unchecked and report that `windowControlsOverlay` is disabled for this run.

Overlay is a show-time capability gate, not a runtime style. The control demo enables it by default because this is the overlay acceptance surface. You can force it on with `OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY=1` or force it off with `--no-overlay` / `OPENTRAY_EXAMPLE_WEBVIEW_OVERLAY=0`.

On Windows, macOS corner controls remain unsupported, while `style.platform.windows.cornerPreference` is the native DWM corner family. Windows DWM material choice lives in `style.background`.
Whole-window opacity lives in `style.opacity` on both supported WebView runtimes and composes with the current background mode.
Devtools are creation-time gated in examples through `devtools: true`. Release native artifacts still compile the inspector API, but ordinary app windows that omit `devtools: true` keep devtools unavailable by default.

## Example 1A: Windows Composition Diagnostic

Windows only:

```bash
pnpm --filter opentray example:win32-bug
```

This is the real OpenTray HWND + windowed WebView2 + DWM host used to reproduce retained pixels. It is not a rendering repair or a replacement acceptance path. The page reuses every control in the Control Surface Window card, then adds a focused `Residue Probe` card.

Run the same retained session through this matrix and record the visible result outside the terminal log:

| Background | Trigger | Control | Record |
| ---------- | ------- | ------- | ------ |
| opaque | `Toggle frameless` | `clearWhiteBlock`, then `Pulse width +1px` | residue, flash, focus/input |
| mica | `Hide Example` then `Show Example`; `Toggle frameless` | `clearWhiteBlock`, then `Pulse width +1px` | residue, flash, focus/input |
| acrylic | `Hide Example` then `Show Example`; `Toggle frameless` | `clearWhiteBlock`, then `Pulse width +1px` | residue, flash, focus/input |

`clearWhiteBlock` is the current shell-state baseline. `Pulse width +1px` reads trusted native bounds, resizes by one logical pixel, then restores the original width. The pulse is deliberately a comparison control because the user has observed that a real resize can clear pixels that shell recovery does not.

The example enables `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1` and forces `OPENTRAY_WINDOWS_AUTO_CLEAR_WHITE_BLOCK=0`. Native records report requested background/backing policy, HWND styles/state/bounds, operation reason, and shell-clear timing. They do not establish that the visible artifact cleared; only the human matrix can establish that result. Do not test a new non-shell recovery candidate until this baseline matrix is recorded.

When `Toggle frameless` is active, the diagnostic page renders a transparent top titlebar. Drag its unoccupied region to move the native window. The `Frameless chrome` control in `Residue Probe` shows or hides self-drawn icon controls for minimize, maximize or restore, and close. Returning to framed mode removes the page controls so the native caption controls remain the only authority.

For an automated source-host lifecycle smoke, which cannot judge pixels:

```bash
OPENTRAY_EXAMPLE_WIN32_BUG_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=6000 pnpm --filter opentray example:win32-bug
```

## Example 2: Download

Command:

```bash
pnpm --filter opentray example:download
```

The download example is hosted by the **unified SvelteKit app** under `packages/cli/examples/app`. Every WebView example is one route in that single SvelteKit + Tailwind v4 + shadcn-style SPA; the launcher spawns the app's loopback dev server and loads the `/download` route via `url:`. The dev server binds to loopback only, so the native runtime classifies the page origin as `Local` and the default `nativeApiPolicy.defaultSrc: ["'local'"]` admits every capability — no policy override is needed.

First-time setup (one-off, shared by all WebView examples):

```bash
cd packages/cli/examples/app && bun install
```

Then run the example from the repo root. The launcher spawns the SvelteKit dev server on a loopback port, waits for `/download` to respond, loads it via `url:`, and opens the native window:

Expected checks:

1. The terminal prints `download panel: http://127.0.0.1:<port>/download` and `panel url: ...` before the window appears.
2. The window opens with a three-section control panel: trigger controls, active downloads, and the live event stream.
3. The header shows a green `bridge ready` badge and the page origin (loopback).
4. `Download report` triggers a real blob download and writes a JSON file into the operating system Downloads directory; the page updates through `downloadstarted`, `downloadprogress`, and `downloadcompleted`.
5. `Fixed-name download (collision)` always uses `report.json`. Click it twice in a row: the second `filename` becomes `report (1).json` while `suggestedFilename` stays `report.json` — the exact contract of the `add-webview-download-suggested-filename` change.
6. `Fire concurrent` triggers N parallel downloads with distinct filenames; each row in the active-downloads panel tracks its own progress and event correlation.
7. The event stream shows every download lifecycle payload (including the `suggestedFilename` field) and can be filtered by event type.

For quick smoke (drives the collision path and asserts `suggestedFilename` survives dedupe):

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:download
```

## Example 3: Placement Kit

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

## Example 4: Media Query Kit

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

## Example 5: Tray Panel

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
6. Repeated tray clicks toggle the same WebView handle with `toVisible()` / `close()` after the first `show()`, and the item relabels between `Show Example` and `Hide Example`. Because this example uses `keepOnTop`, native `blur` is logged but does not auto-hide.
7. The in-page tray API returns a provenance-bearing object:

```json
{
  "kind": "native | inferred | unavailable",
  "source": "...",
  "rect": { "x": 0, "y": 0, "width": 0, "height": 0 }
}
```

8. The page status surface shows the same tray result shape instead of assuming `Rect | null`.

## Example 6: Debug Runtime Tray

Command:

```bash
pnpm --filter opentray example:debug-runtime-tray
```

Expected checks:

1. The tray exposes a single `primaryEvent` item that relabels between `Show Example` and `Hide Example`.
2. The runtime logs show `menuClick` when the primary action is triggered.
3. The opened WebView uses `tray.getBounds().rect` for `fallbackRect`.
4. The page projection `navigator.opentray.tray.getBounds()` returns the same provenance-bearing result family.

## Non-Interactive Smoke Paths

Run the finite package matrix when checking the source-tree examples together:

```bash
pnpm --filter opentray example:matrix
pnpm --filter opentray example:matrix -- --row webview-control
```

The matrix does not depend on shell wildcard expansion. It stages the packaged runtime executable before `first-app`, labels WebView/Badge/Lynx rows as contributor-only `extension-runtime` coverage, and prints explicit skip reasons for unsupported platforms or missing carrier artifacts. Pass `-r` to make the whole matrix use release-mode native artifacts.

These are useful for quick regression passes:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:download
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:mediaQuery
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:placement
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=show pnpm --filter opentray example:tray-panel
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --overlay
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 pnpm --filter opentray example:webview-control -- --no-overlay
OPENTRAY_EXAMPLE_WEBVIEW_BRIDGE_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=2500 pnpm --filter opentray example:webview-control
OPENTRAY_EXAMPLE_WIN32_BUG_SMOKE=1 OPENTRAY_EXAMPLE_EXIT_AFTER_MS=6000 pnpm --filter opentray example:win32-bug
```

## Failure Hints

- If an example cannot find the native library, confirm `cargo build -p opentray-ext-webview` succeeded and `target/debug` contains the platform artifact. For `-r`, confirm `cargo build --release -p opentray-ext-webview` succeeded and `target/release` contains it.
- If the debug runtime returns a generic `unsupported` or `internal` error, rerun with:

```bash
export OPENTRAY_DAEMON_STDIO=inherit
export OPENTRAY_WEBVIEW_DEBUG=1
```

This lets the debug runtime print the native ext-webview error message directly into the example terminal.

- If tray behavior looks stale, point the source-tree transport at the freshly built debug runtime binary:

```bash
OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" pnpm --filter opentray example:debug-runtime-tray
OPENTRAY_BROKER_BIN="$PWD/target/release/opentray" pnpm --filter opentray example:debug-runtime-tray -r
```

- If glass looks opaque, inspect both native style and page content:
  - `style.background` must be `transparent`, `semantic: blur`, or `platformMaterial`
  - the page must leave transparent regions
  - the page must not draw the outer shell with CSS blur or root border radius
