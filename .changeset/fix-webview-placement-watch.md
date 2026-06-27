---
"@opentray/ext-webview": patch
---

Fix WebView placement so screen and edge top/bottom anchors respect native screen coordinate origins, including macOS bottom-left screen coordinates.

Make `WebviewPlacementKit.watch()` keep reacting to native placement invalidations instead of behaving like a one-shot placement, and pause/resume placement while native window interaction owns live bounds.
