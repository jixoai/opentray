---
"opentray": minor
"@opentray/ext-webview": minor
"@opentray/spec": minor
---

Refresh the WebView window contract so common shell traits stay separate from platform-specific
style families, make tray bounds provenance-bearing instead of collapsing to `Rect | null`, and
restore the official source-tree WebView example smoke paths.

The published guidance now teaches `style.platform.macos.*` and `trayBounds.rect`, and the macOS
runtime rejects real cross-platform style mismatches without falsely rejecting placeholder platform
families during startup.
