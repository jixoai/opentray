---
"@opentray/ext-webview": minor
opentray: minor
---

Add common `style.resizable` support for WebView windows. Framed windows remain user-resizable by default, while frameless windows default to fixed size and opt into native edge and corner resizing with `resizable: true`.

## Breaking on Windows

- Frameless WebViews no longer retain the native resize frame. Set `style.resizable: true` when user-driven frameless resizing is required.

Windows frameless WebViews now remove legacy title and border rendering, support HWND-owned soft resizing without page resize loops, and exit dedicated GUI brokers after an initialized caller closes.
