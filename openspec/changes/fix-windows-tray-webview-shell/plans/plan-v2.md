<!--
Orthogonal intents (2026-07-14, original user input):
1. Review and replace the current Windows fixes.
2. Hide tray-owned WebViews from task switchers by default.
3. Restore native overlay and measurable full-client geometry.
4. Restore tray-authoritative placement and visible tray icons.
5. Prove the composed behavior in pnpm-pub.
-->

# Intent Document

## Current Round

- Round: 2
- Status: Implementation and Windows acceptance complete; repository gates and self-review remain.
- Previous plan backup: `plans/plan-v1.md`

## Original User Input

> 1. overlay-window-controls 这个需要修复。因为我确定之前是可以工作的，并且我都已经调整修复好了。现在却不行了。你可以找找之前针对 Windows 的一些开发和修复，调查为什么无效了。
> 2. 在 Windows 平台下，默认不应该有窗口图标（macOS 已经默认不显示窗口图标了），这需要统一默认行为。
> 3. tray-icon 没有正确渲染出来。
> 4. frameless 有 BUG，frameless 模式下 webview 没有完全铺满高度。验证方法：`await navigator.opentrayWindow.getBounds()` 与 `window.outerWidth`、`window.outerHeight` 应该只差 2~4px。
> 5. 正确应用 overlay-window-controls 后，可以使用类似 frameless 的方法验证。
>
> 如果要在 pnpm-pub 中验证 opentray，可能要进行 link。

> 从 pnpm-pub 角度最明显的问题：
> 1. 启动后任务栏出现窗口图标。
> 2. 窗口没有正确应用 overlay-window-controls 样式。
> 3. placement 没有正确寻址到 tray，始终锁定在屏幕正中心。

## Intent

Repair the Windows tray-owned WebView shell so a consumer such as pnpm-pub behaves as a tray utility:

```text
actual tray item
      |
      v
+-----------------------+      taskbar / Alt+Tab
| page titlebar       _[]X|            absent
| WebView full client   |
+-----------------------+
```

- Default Windows WebViews stay out of normal task switchers.
- Native caption controls are composited before first visible show.
- Frameless and overlay geometry are measurable against browser outer dimensions.
- Tray registration and bounds queries use one shell identity.
- Placement uses native tray provenance rather than screen-center fallback.

## Diagnosis

### Proven Root Causes

| Surface | Root cause | Correct authority |
| --- | --- | --- |
| Startup / overlay crash | CBS `FrameworkUdk` build `10.0.27108.1029` was loaded beside package-graph `Windowing.Core` build `10.0.27108.1050`. | CBS may locate the bootstrapper; `MddBootstrapInitialize` selects runtime DLL identity. |
| Overlay worker | An MTA worker cannot resolve an AppWindow for an HWND owned by another thread (`0x80070580`). | Run AppWindow mutation synchronously on the HWND-owning thread after `RoInitialize(STA)`. |
| Taskbar entry | `WM_GETICON` changes icon lookup, not taskbar or Alt+Tab membership. | `WS_EX_TOOLWINDOW` by default; `WS_EX_APPWINDOW` only when opted in. |
| Placement center fallback | Vendored registration used `NIF_GUID`, while bounds query still used `(HWND, uID)`. | Use `(HWND, uID)` consistently until durable app/tray GUID identity crosses the dependency boundary. |
| Tray icon blank edges | The monochrome AND mask marked every non-255 alpha pixel transparent. | Mask only alpha `0`; preserve anti-aliased pixels for color alpha blending. |
| Bounds gap | `GetWindowRect` includes invisible DWM resize borders. | Public bounds use `DWMWA_EXTENDED_FRAME_BOUNDS`; setters compensate raw-frame deltas. |
| Caption/client gap | `WS_THICKFRAME` retained non-client geometry. | `WM_NCCALCSIZE` exposes full client for frameless and overlay windows. |

### Rejected Explanations

```text
hand-written ABI mismatch      -> generated binding showed the same ABI
blocked DispatchMessage stack  -> original user_event path passes after DLL identity is fixed
MTA fire-and-forget worker     -> wrong HWND apartment and no completion truth
CBS absolute runtime DLL       -> mixes builds selected from different runtime channels
WM_GETICON default suppression -> does not control switcher membership
numeric tray GUID              -> not durable and breaks current bounds identity
```

## Design

### Runtime Loading

```text
find bootstrapper
  env override
  runtime-dir override
  CBS SystemApps
  bare filename
        |
        v
MddBootstrapInitialize
        |
        v
LoadLibrary("Microsoft.Internal.FrameworkUdk.dll")
        |
        +-- package graph selects matching runtime build
```

`OPENTRAY_WINDOWS_APP_RUNTIME_DIR` remains the only explicit complete-runtime override. A bootstrapper path does not imply that sibling DLLs belong to the selected runtime package.

### Overlay Ordering

```text
create hidden HWND
  -> attach bridge state
  -> apply ex-style and full-client policy
  -> enter HWND-owner STA
  -> AppWindowTitleBar.ExtendsContentIntoTitleBar = true
  -> fit WebView2 to client rect
  -> show / focus
```

Overlay metrics use DWM caption-button bounds. No AppWindow object crosses apartments.

### Window Geometry

```text
raw GetWindowRect
  - invisible DWM border
  = public visible frame

public move/resize target
  + current invisible border delta
  = SetWindowPos raw target
```

This keeps `getBounds`, `moveTo`, `resizeTo`, responsive sizing, and placement in one logical desktop-pixel contract.

### Switcher and Tray Identity

```text
showInSwitchers=false -> WS_EX_TOOLWINDOW, !WS_EX_APPWINDOW
showInSwitchers=true  -> !WS_EX_TOOLWINDOW, WS_EX_APPWINDOW

NIM_ADD / MODIFY / DELETE / GetRect
             |
             +-- same (HWND, uID)
```

## Public Surface

- Add `style.platform.windows.showInSwitchers?: boolean`, default `false`.
- Keep `windowControlsOverlay`, `TrayHandle.getBounds()`, and `WebviewPlacementKit` public shapes unchanged.
- Normal app-style examples explicitly opt into switchers.

## Verification Evidence

| Check | Evidence |
| --- | --- |
| Overlay smoke | `gap=2x1`, titlebar safe area `769x27`. |
| Frameless smoke | `gap=0x0`, overlay disabled. |
| Placement smoke | tray and result source are `backend.nativeTrayBounds`. |
| pnpm-pub switcher | `WS_EX_TOOLWINDOW=true`, `WS_EX_APPWINDOW=false`. |
| pnpm-pub overlay | Native minimize/maximize/close controls visible above page content; no default title icon. |
| pnpm-pub placement | Window clamped to the work-area edge adjacent to the real notification-area button, not screen center. |
| pnpm-pub tray icon | UI Automation found `pnpm-pub: pnpm publish companion`; captured pixels show the rendered npm icon. |
| Rust tests | ext-webview `60`, tray backend `26`, vendored tray-icon `2` plus `5` doc tests. |

## Residual Risks

| Risk | Decision |
| --- | --- |
| Vendored dependency patch | Keep minimal alpha-mask delta; upstream separately. |
| `showInSwitchers` is a breaking Windows default | Intentional tray-utility default; explicit opt-in exists. |
| macOS runtime/visual acceptance | Not claimed from this Windows session. |
| Example auto-exit process lingers under Bun | Outside this native repair; smoke assertions completed before forced teardown. |

## Exit Conditions

- Focused Rust/TypeScript gates pass.
- OpenSpec validates.
- pnpm-pub acceptance evidence remains recorded.
- Self-review lists any remaining workflow-only items.
- Archive waits for user acceptance and separate archive evidence.
