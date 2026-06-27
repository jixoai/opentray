# Visual Acceptance

Use this reference when the user asks to smoke-test OpenTray or prove a real native tray/window path.

## Rule

The public `opentray` CLI binary does not expose daemon lifecycle or smoke subcommands. Do not tell users to run `opentray daemon ...` or `opentray smoke ...`.

Smoke is a workflow over the source-tree example scripts. Before running one, explain that it can start a real native tray/window, write versioned runtime state under `$OPENTRAY_HOME/.opentray/<package-version>/runtime` or the user's home directory, create visible tray/window UI, and load native extensions. The owning process controls cleanup; normal exit removes its tray contribution.

## Consumer Smoke Shape

For a package-user smoke, create a temporary project, install the needed packages, and run a short SDK script that calls `createTray()` and, when needed, attaches `@opentray/ext-webview`.

Minimum install:

```bash
pnpm add opentray @opentray/ext-webview
```

Useful checks:

- the SDK script runs against the in-process visible runtime binding by default
- a visible tray appears
- WebView loads from `@opentray/ext-webview`
- normal exit (or `tray.destroy()` / closing the connection) removes the tray contribution
- the first-app helper can be used for the same fast path, while direct `createTray()` remains the lower-level route

## Source Checkout Smoke

When the user is inside the OpenTray repo, prefer workspace examples. These are the real script names (from `packages/cli/package.json`):

```bash
pnpm --filter opentray example:first-app
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:placement
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:badge
```

Notes on what each proves:

- `example:debug-runtime-tray` — real native tray + WebView, single primary action (set `OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1` to auto-show the window).
- `example:placement` — `WebviewPlacementKit.watch()`, tray/screen/edge placement, page-owned frameless drag.
- `example:tray-panel` — glass tray-anchored panel with a transparent root (preferred over `webview-control` for glass-window guidance).
- `example:webview-control` — capability exerciser; starts opaque and enables overlay probes by default (use `-- --no-overlay` to test the disabled branch).
- `example:mediaQuery` — responsive native-window behavior through `styleKit.apply(...)`, `mediaQueryKit.match(...)`, and size constraints.
- `example:badge` — `@opentray/ext-badge` WebView IPC debug panel.

For Lynx contributor acceptance:

```bash
pnpm --filter opentray example:debug-runtime-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

Use `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=<ms>` only for examples that support timed exit.

For the pure Node visible-binding host loop (host main thread + worker), use:

```bash
pnpm --filter opentray example:visible-binding
```
