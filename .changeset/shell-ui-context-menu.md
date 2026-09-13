---
"@opentray/spec": patch
"@opentray/ext-webview": patch
---

Trusted shell UI no longer shows the engine's native context menu (contract-5).

- New per-webview `browser.contextMenu` option on `createWebview` / `createWebviewWindow({ webviews })`. Default keys off the bridge surface: a child with any bridge capability (e.g. a toolbar page) is trusted shell UI and hides the engine right-click menu (Reload/Inspect never leak onto shell chrome); a bridgeless content child keeps the ordinary browser-tab menu. Explicit values win either way.
- macOS implements suppression through AppKit's `willOpenMenu:withEvent:` hook applied per built webview (empty menu presents nothing); Windows maps to `AreDefaultContextMenusEnabled` through wry. Contract fingerprint bumped to `opentray-ext-webview-contract-5` (embedded manifest tracks the facade contract file; native binaries rebuild on release).
