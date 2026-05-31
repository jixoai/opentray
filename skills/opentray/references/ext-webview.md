# ext-webview

Use this reference when changing `packages/ext-webview`, native WebView examples, or WebView extension host behavior.

## Extension Law

WebView is an extension atom, not a core feature. It must route `show`, `hide`, `navigate`, `evaluate`, and `postMessage` commands through normal `ext-command` traffic with `ext: "webview"`.

## Current State

- TypeScript facade: `packages/ext-webview/src/index.ts`.
- Broker-free facade example: `packages/ext-webview/examples/webview-command.ts`.
- Human-visible native smoke example: `crates/opentray-backend-tray-icon/examples/visual_webview.rs`.
- `visual_webview` uses `tao + wry` only inside the example/runtime boundary. It must not leak into `opentray-core`.

## Positioning Rule

WebView positioning depends on backend capabilities. If the backend cannot provide a physical tray rect, the extension must choose an explicit fallback such as cursor or platform default positioning and expose that fallback in logs, metadata, or events.

## Lifecycle Rule

WebView instances are scoped to `(surfaceId, trayId, leaseId)`. Lease cleanup must hide or destroy only the calling lease's WebView state.

## Verification

```bash
pnpm --filter @opentray/ext-webview test
pnpm --filter @opentray/ext-webview example:webview
OPENTRAY_EXAMPLE_EXIT_AFTER_MS=1500 cargo run --example visual_webview
```

For human acceptance, run `cargo run --example visual_webview` without auto-exit and confirm a real native window is visible.
