---
"opentray": minor
"@opentray/spec": minor
"@opentray/darwin-arm64": minor
"@opentray/darwin-x64": minor
"@opentray/linux-arm64": minor
"@opentray/linux-x64": minor
"@opentray/windows-arm64": minor
"@opentray/windows-x64": minor
"@opentray/ext-webview": minor
"@opentray/ext-webview-darwin-arm64": minor
"@opentray/ext-webview-darwin-x64": minor
"@opentray/ext-webview-windows-arm64": minor
"@opentray/ext-webview-windows-x64": minor
"@opentray/ext-badge": minor
"@opentray/ext-badge-darwin-arm64": minor
"@opentray/ext-badge-darwin-x64": minor
"@opentray/ext-badge-windows-arm64": minor
"@opentray/ext-badge-windows-x64": minor
"@opentray/ext-lynx": minor
"@opentray/ext-lynx-darwin-arm64": minor
"@opentray/ext-lynx-darwin-x64": minor
"@opentray/ext-island": minor
"@opentray/packaging": minor
"@opentray/vite-plugin": minor
"@opentray/esbuild-plugin": minor
"@opentray/tsdown-plugin": minor
"@opentray/webpack-plugin": minor
---

Align OpenTray on a single 0.10.0 package line.

This release adds the `runTrayApp()` onboarding path, simplifies official
examples around tray-first usage, makes the WebView extension path progressive
through `tray.extend(WebviewExt)`, refreshes the OpenTray skill tutorial and
versioning guidance, and moves all public packages into one fixed release group
so installs resolve a coherent package set.
