---
"@opentray/ext-webview": patch
---

win32 overlay: titlebar band input reaches web content again

`ExtendsContentIntoTitlebar` claims the whole titlebar band (minus the system caption buttons) as the default native drag region, so every mouse press in the band was treated as non-client caption: interactive controls a page placed in its custom titlebar were unclickable on Windows. The overlay apply path now replaces that default with a degenerate drag rectangle, which returns the band to normal client input. Dragging stays the documented page-initiated `startAppRegionDrag()` contract — the same one the macOS overlay path already uses — and native double-click-to-zoom on a custom band is page work (pair two pointerdown presses and call `maximize()` / `restore()`).
