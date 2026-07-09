---
"@opentray/ext-webview": minor
"opentray": minor
---

Add instance-scoped WebView devtools commands for host code and injected page code.

Windows and macOS release builds now compile the native devtools API while preserving the per-window `devtools: true` capability gate. The source examples also support `--release` / `-r` and keep their own WebView instances devtools-enabled so release binaries remain debuggable through explicit APIs.
