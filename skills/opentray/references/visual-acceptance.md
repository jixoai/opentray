# Visual Acceptance

Use this reference when the user asks to smoke-test OpenTray or prove a real native tray/window path.

## Rule

`opentray` CLI stays pure: it owns daemon lifecycle and health only. Do not tell users to run `opentray smoke ...`.

Smoke is an agent/workflow activity. Before running it, explain that it can start or reuse the daemon, write versioned runtime state under `$OPENTRAY_HOME/.opentray/<package-version>/runtime` or the user's home directory, create visible tray/window UI, load native extensions, and require `opentray daemon stop` for immediate cleanup.

## Consumer Smoke Shape

For a package-user smoke, create a temporary project, install the needed packages, and run a short SDK script that creates a real tray and, when needed, attaches `@opentray/ext-webview`.

Minimum install:

```bash
pnpm add opentray @opentray/ext-webview
```

Useful checks:

- `opentray daemon health` before and after the script
- SDK auto-starts or reuses the same-version daemon
- a visible tray appears
- WebView loads from `@opentray/ext-webview`
- normal exit closes the broker connection and lease-owned tray contribution

## Source Checkout Smoke

When the user is inside the OpenTray repo, prefer workspace examples:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:tray-panel
```

Use `example:placement` when reviewing tray-anchored, screen-aware, and edge-aware placement. It focuses on `WebviewPlacementKit.watch()`, `applyOnce()`, result provenance, and page-owned frameless drag behavior.

Use `example:mediaQuery` when reviewing responsive native-window behavior. It focuses on `styleKit.apply(...)`, `mediaQueryKit.match(...)`, size constraints, and user resize/move quiescence.

For Lynx contributor acceptance:

```bash
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

Use `OPENTRAY_EXAMPLE_EXIT_AFTER_MS=<ms>` only for examples that support timed exit.
