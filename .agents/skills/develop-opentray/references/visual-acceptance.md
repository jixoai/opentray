<!--
Orthogonal intents (maintained 2026-07-21; original user request: OpenTray workspace,
source-link, and native smoke commands belong to the internal development Skill):
1. Stage one coherent source artifact graph for linked consumers.
2. Route contributors to current TypeScript and native source examples.
3. Preserve the human-visible acceptance boundary.
-->

# Visual Acceptance

Use this reference when the user needs human-visible verification or when a change touches native tray/WebView behavior.

## Linked Consumer Preparation

Before starting a consumer linked to this checkout, build the public facades and
stage the current debug broker/carrier/native-extension graph:

```bash
pnpm run prepare:linked-consumer
```

This command is an OpenTray contributor workflow. Never copy it into
`skills/opentray` or require it from registry consumers.

## Workspace Examples

Use the current scripts from `packages/cli/package.json`:

```bash
pnpm --filter opentray example:first-app
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:placement
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:badge
```

- `example:debug-runtime-tray` proves one real tray plus retained WebView.
- `example:placement` proves tray/screen/edge placement.
- `example:tray-panel` is the canonical tray-anchored glass recipe.
- `example:webview-control` exercises native window capabilities.
- `example:mediaQuery` exercises responsive native-window styles and size constraints.
- `example:badge` exercises badge IPC and native projection.

## Native Backend Examples

Visible tray icon:

```bash
cargo run --example native_tray
```

Visible WebView window:

```bash
cargo run --example visual_webview
```

Protocol-only TypeScript examples:

```bash
pnpm --filter opentray example:basic
pnpm --filter @opentray/ext-webview example:webview
pnpm --filter @opentray/spec example:parse
```

## Automated Smoke Mode

Use auto-exit for CI or quick local smoke checks:

```bash
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 cargo run --example native_tray
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 cargo run --example visual_webview
```

## Acceptance Rules

- Human-visible work requires a real visible tray icon, window, or panel.
- Test commands are not a substitute for human acceptance examples.
- Keep native GUI dependencies inside backend/example/runtime atoms.
- If an example is platform-limited, say so explicitly. `visual_webview` is currently enabled for macOS and Windows.

## Known Stable Path

The WebView visual example uses `tao + wry`. Earlier `wry + winit` shutdown behavior was unstable on macOS, so do not reintroduce that path without a fresh visual smoke pass.
