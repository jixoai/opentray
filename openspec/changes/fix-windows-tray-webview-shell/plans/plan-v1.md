<!--
Orthogonal intents (2026-07-14, user input):
1. Review and replace the current Windows fixes.
2. Hide tray-owned WebViews from task switchers by default.
3. Complete native overlay before first visible paint.
4. Restore tray-authoritative placement.
5. Preserve startup recovery and prove pnpm-pub on Windows.
-->

# Intent Document

## Current Round

- Round: 1
- Status: Intent locked from user evidence and repository/runtime inspection.
- Previous plan backup: None.

## Workflow Command Surface

- Create: `bun run openspec:vision -- new <change>`
- Status: `bun run openspec:vision -- status <change>`
- Instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Validate: `bun run openspec:vision -- validate <change>`
- Commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Backup: `bun run openspec:vision -- backup-plan <change>`
- Final gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 1. overlay-window-controls 这个需要修复。因为我确定之前是可以工作的，并且我都已经调整修复好了。现在确不行了。你可以找找之前针对Windows的一些开发和修复，调查为什么无效了
> 2. 在window平台下，默认不应该有窗口图标（macOS已经默认不显示窗口图标了），这需要统一默认行为。
> 3. tray-icon没有正确渲染出来
> 4. frameless有BUG，frameless模式下，webview没有完全铺满高度，验证方法：`await navigator.opentrayWindow.getBounds()`这里得出来的尺寸，与 window.outerWidth、window.outerHeight应该只差个2~4px
> 5. 同上，如果正确overlay-window-controls的情况下，可以使用类似frameless的方法进行验证。
>
> PS 如果要在pnpm-pub中验证opentray，你可能要进行link

> 目前最明显的问题（我从pnpm-pub这个项目的角度出发）：
> 1. 启动后，任务栏出现窗口图标
> 2. 窗口没有正确应用overlay-window-controls样式
> 3. placement存在问题，没有正确寻址到tray的位置，现在始终锁定在窗口正中心

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | pnpm-pub is the real acceptance surface. | Finish with a linked/local-runtime Windows smoke. |
| 1 | User | Overlay previously worked and must be restored. | Keep native controls; do not fake geometry. |
| 1 | User | Windows defaults should match macOS no-window-icon behavior. | Default out of taskbar/Alt+Tab; preserve explicit opt-in. |
| 1 | User | Placement must resolve from the tray. | Native tray bounds remain authoritative. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `windows.HANDOFF.md` | Windows visible runtime work requires a new change and visible proof. | Current untracked patch is insufficient. |
| Commits `0e57508`, `9c7f2f5`, `bf1f1b1`, `b59a7db` | Overlay uses `AppWindowTitleBar`; later work normalized real insets for CSS geometry. | Preserve the substrate and completion order. |
| Current `appwindow.rs` | Overlay mutation is fire-and-forget; metrics still call WinRT synchronously on the event-loop thread. | First show races native state and geometry retains the deadlock class. |
| Current `WM_GETICON` | Returning zero does not remove an unowned top-level HWND from taskbar/Alt+Tab. | It fixes the wrong projection. |
| Current vendored `tray-icon` | Registration uses `NIF_GUID`; bounds query still uses `(hwnd, uID)`; GUID uses only a process-local integer. | Bounds become unavailable and placement falls back to center. |
| Live pnpm-pub HWND | `WM_GETICON` returns zero, but no owner/`WS_EX_TOOLWINDOW` exists and taskbar entry remains. | Direct evidence against the current fix. |
| Focused tests | 54 Rust and 36 facade tests pass. | Existing tests miss native lifecycle/identity failures. |

### Git Evidence

| Checkpoint | Expected evidence | Status |
| ---------- | ----------------- | ------ |
| OpenSpec before apply | Plan, delta specs, tasks | Pending; user did not request commits. |
| Task progress | Code plus matching BDD/task updates | Pending. |
| Self-review | Review artifact and reopened tasks | Pending. |
| Archive | Separate archive evidence | Out of scope until acceptance. |

### Existing OpenSpec Survey

| File / change | Existing law | Action |
| ------------- | ------------ | ------ |
| `openspec/specs/webview-extension/spec.md` | Overlay is extension-owned and standard-like. | Add completion-before-show and switcher defaults. |
| `openspec/specs/webview-extension/spec.md` | Placement rejects unusable tray bounds and falls back honestly. | Preserve; repair source identity. |
| `openspec/specs/backend-adapters/spec.md` | Placement is keyed by durable app/tray identity. | Add registration/query consistency. |
| Archived tray-first change | App/tray/session remain caller-owned. | Reuse; no ontology change. |

### User Language System

| User phrase | Working meaning | Translation |
| ----------- | --------------- | ----------- |
| `overlay-window-controls` | Native-controls overlay. | Page owns titlebar content; OS owns controls. |
| `默认不应该有窗口图标` | No normal app switcher presence by default. | Tray utility window policy. |
| `寻址到tray的位置` | Use the actual tray item as anchor. | Tray bounds authority. |
| `始终锁定在窗口正中心` | Tray authority was lost. | Screen-center fallback. |

### Demo / Spike Code

| Path | Question | Disposition |
| ---- | -------- | ----------- |
| `packages/cli/examples/webview-control.ts` | Is overlay complete and measurable? | Keep. |
| `packages/cli/examples/placement-panel.ts` | Is tray placement native? | Keep. |
| `E:\dev\github\pnpm-pub` | Do all effects compose? | Final external proof. |

### Questions To Confirm With User

| Question | Why it matters | Current inference |
| -------- | -------------- | ----------------- |
| Does “no window icon” mean no taskbar/Alt+Tab entry rather than only a blank glyph? | Native policies differ. | Yes; preserve explicit Windows opt-in for normal app windows. |

## Intent

### Surface Intent

Repair the Windows tray-owned WebView so pnpm-pub starts as a tray utility: no default taskbar entry, correct native caption overlay, and placement beside the real tray item.

### Underlying Drive

The current patch confuses projections with authorities: icon lookup is treated as taskbar policy, scheduled work as completed overlay state, and a process-local number as durable tray identity.

### Final Visible Effect

```text
tray click
   |
   v
+----------------------+       taskbar / Alt+Tab
| pnpm-pub WebView     |       (no default entry)
| page titlebar ----_[]X|             X
+----------------------+
          ^
          +----------------[actual tray item]
```

- Overlay is applied before show resolves and its geometry does not hang.
- Native controls remain visible/clickable over page content.
- Placement reports native provenance and is tray-relative, not screen-center fallback.
- Frameless remains full-client with only the expected resize-border delta.

## Platform Diagnosis

- Current laws: tray identity/bounds belong to the backend; WebView chrome belongs to the extension.
- Regular atom: Yes; this repairs existing Windows projections.
- Law upgrade: Add explicit Windows switcher visibility, defaulting to tray-utility behavior.
- Breaking stance: Default hidden from switchers; normal app windows opt in.
- Blocking confirmation: None.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
create hidden HWND
  -> apply switcher/frame style
  -> complete AppWindow overlay on MTA
  -> fit WebView child
  -> show
  -> query tray with registration identity
  -> place/watch from tray bounds
```

### Interface Shape

- Add `style.platform.windows.showInSwitchers`, default `false`.
- Keep overlay a show-time capability gate.
- Keep `TrayHandle.getBounds()` and `WebviewPlacementKit` unchanged publicly.

### Data Shape

```text
showInSwitchers  -> taskbar + Alt+Tab projection
overlay enabled  -> AppWindow state + page geometry
(appId, trayId)  -> tray registration + bounds-query identity
```

### Architecture Shape

- Windows WebView code owns switcher and overlay projection.
- Tray-icon backend owns tray geometry.
- Vendored `tray-icon` contains only the minimal bitmap-alpha correction; it must not invent OpenTray app identity.
- Core/broker remain generic.

### User Confirmation Gates

| Gate | Reason | Default |
| ---- | ------ | ------- |
| None | User supplied concrete visible acceptance and asked us to take over. | Implement and verify. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why | Default |
| -------- | --- | ------- |
| Should normal Windows app windows appear in switchers? | Keep native framed-window use case. | Explicit opt-in. |
| Keep tray GUID persistence? | It needs durable identity and consistent query semantics. | Reject for this repair. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `WM_GETICON => 0` | Does not control taskbar/Alt+Tab membership. |
| Fire-and-forget overlay | Exposes success before native state/client geometry completes. |
| Numeric tray GUID | Collides across apps and breaks current bounds query. |
| Screen-center patch | Hides loss of tray authority. |
| Raw `WM_NCCALCSIZE` overlay | Cannot keep native controls above WebView2 reliably. |

## Exit Conditions

- Default max review iterations: 3.
- Recurrence threshold: Any one pnpm-pub visible failure reopens implementation.
- Completion: focused tests/build plus Windows pnpm-pub proof for switcher absence, overlay geometry/control visibility, tray-relative placement, and frameless geometry. No macOS acceptance claim from Windows.
