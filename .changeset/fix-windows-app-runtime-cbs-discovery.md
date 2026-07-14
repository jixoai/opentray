---
"@opentray/ext-webview": minor
"opentray": minor
---

Repair the Windows tray-owned WebView shell and notification icon path.

## Breaking on Windows

- WebViews no longer enter the taskbar or Alt+Tab by default. Normal application windows must opt in with `style.platform.windows.showInSwitchers: true`.
- `getBounds`, `moveTo`, and `resizeTo` now use the DWM visible frame rather than the raw Win32 frame with invisible resize borders. Coordinate results can shift by the border delta.

- Discover a CBS-installed Windows App Runtime bootstrapper, then resolve runtime DLLs from the package graph selected by `MddBootstrapInitialize` so `FrameworkUdk` and `Windowing.Core` cannot be mixed across builds.
- Initialize WinRT on the HWND-owning thread and complete `AppWindowTitleBar.ExtendsContentIntoTitleBar` before the first visible show.
- Add `style.platform.windows.showInSwitchers`, defaulting to `false`, so tray utility windows stay out of the taskbar and Alt+Tab unless explicitly opted in.
- Use DWM visible-frame bounds for the public Windows window geometry contract and compensate invisible resize borders in `moveTo` and `resizeTo`.
- Keep frameless and overlay WebViews full-client through `WM_NCCALCSIZE`.
- Preserve the tray icon's native `(HWND, uID)` identity for registration and bounds queries, and fix the vendored Windows RGBA mask so anti-aliased pixels remain visible.
