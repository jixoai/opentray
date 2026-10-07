---
"@opentray/ext-webview": minor
---

Keyboard zoom shortcuts are now a native window-shell capability. `WebviewWindowStyle.zoomShortcuts` (default `true`) lets ⌘/Ctrl+Plus, ⌘/Ctrl+Minus, and ⌘/Ctrl+Zero adjust the page zoom of the focused webview: a geometric ±20% ladder clamped to [0.25, 5.0] with Zero resetting to 1.0. macOS routes a process-wide native keyDown monitor per window session (an empty routing table is a pure pass-through) and applies WKWebView `pageZoom` to the focused view; Windows projects onto WebView2 browser accelerator keys, where an explicit `zoomShortcuts: false` disables the accelerator-key family as documented platform truth. The gate is an initial-only style fact (the show that builds the window seeds it; retained set-style requests never reinterpret it), and both platforms' window capability DTOs serialize the session's current value. No page can raise its own window shell's shortcuts, so the native shell owns this capability.
