---
"opentray": patch
"@opentray/ext-webview": patch
"@opentray/ext-badge": patch
---

Add app/tray identity to extension contexts, expose a gated WebView `opentrayPermissions` management bridge backed by the app-scoped permission store, and release the shared Darwin carrier path used by the badge helper.

Native browser-engine grants still return typed unsupported results where Wry does not expose an OpenTray-owned permission callback.
