# Visual Acceptance

Use this reference when the user needs human-visible verification or when a change touches native tray/WebView behavior.

## Human Commands

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
