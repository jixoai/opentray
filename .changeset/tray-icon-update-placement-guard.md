---
"opentray": patch
"@opentray/ext-webview": patch
---

Update native tray-icon projections in place when `setIcon` and related tray state change, avoiding temporary status-item removal during ordinary tray updates. WebView tray placement now rejects transient invalid tray bounds and reuses the last valid tray anchor before falling back to portable placement. macOS primary tray activation now routes left-click to the primary menu item while preserving the native menu on right-click.
