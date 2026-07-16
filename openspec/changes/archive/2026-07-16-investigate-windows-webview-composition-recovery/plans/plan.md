# Intent Document

## Current Round

- Round: 12
- Status: user visually accepted the production material-host fix; legacy recovery code is being removed and the change is converging for archive.
- Previous plan backup: `plans/plan-v13.md`

## Workflow Command Surface

- Strict validation: `bun run openspec:vision -- validate investigate-windows-webview-composition-recovery`
- Self review: `bun run openspec:vision -- instructions self-review investigate-windows-webview-composition-recovery`
- Final proof: `bun run openspec:vision -- check investigate-windows-webview-composition-recovery`

## Original User Input

> 我这边看到的残影，并不是webview的渲染残影，相反，是原生窗口的残影。
>
> 我以前把webview的尺寸限制在窗口的1/3的尺寸，也就是说，其它8/9的区域都是直接显示窗口的亚克力材质。在这种情况下，这8/9的区域仍然有残影。
>
> 我看到效果了，你的这套版本确实比目前opentray的实现更加优秀。
>
> 我看了效果，非常棒。我觉得我们可以收敛这个BUG了，把你的经验和方案写到代码注释中、写到openspec change中。然后可以清理旧版的代码。

## Objective Record

### Requirement-Bearing Q&A

| Date | User evidence / decision | Intent consequence |
| ---- | ------------------------ | ------------------ |
| 2026-07-16 | `clearWhiteBlock` shell churn did not clear the residue; a real resize changed the result. | Treat the old shell reset as evidence only, not a repair primitive. |
| 2026-07-16 | Framed and frameless behaved the same. | Chrome mode is not the ownership boundary. |
| 2026-07-16 | A WebView occupying only one ninth of the client still left residue in the uncovered native region. | The top-level HWND/DWM redirection surface owns the stale pixels. |
| 2026-07-16 | No-host-paint gray retained residue and resize produced staircase retention; Acrylic stayed visible and clean over the black host mode. | Promote persistent complete native client painting for material hosts. |
| 2026-07-16 | The production OpenTray build was visually accepted as `非常棒`. | Freeze the parent-surface law, remove diagnostic switches and legacy recovery code, and keep a regression surface. |

### Evidence Read

| Source | Fact | Decision |
| ------ | ---- | -------- |
| User visual matrix | Residue persists outside WebView child coverage. | Do not repair through DOM/WebView repaint. |
| Win32 `WS_CLIPCHILDREN` contract | Parent drawing excludes child-covered regions when clipping is present. | Material hosts remove parent `WS_CLIPCHILDREN` so the full client can be painted. |
| Win32 `BeginPaint` contract | Painting is constrained by the update and visible regions. | Parent paint policy must exist before style/size APIs can synchronously paint. |
| Source-host logs | `WM_ERASEBKGND` / `WM_PAINT` and `WM_SIZE -> SetBounds` reached the intended order. | Keep parent-before-child ordering as a production invariant. |
| User final visual acceptance | Mica/Acrylic remained visible without residue under the black material base. | Black is the DWM composition base, not a visible overlay. |

### Historical Research

`plans/plan-v4.md` through `plans/plan-v13.md` preserve the diagnostic decomposition, shell/width candidate, runtime logging, and user experiment sequence. Those plans are historical evidence only. The current SSOT intentionally excludes their obsolete runtime protocol.

## User Language System

| User phrase | Canonical term | Meaning |
| ----------- | -------------- | ------- |
| 原生窗口残影 | native host/DWM material residue | Stale top-level HWND redirection content, not DOM pixels. |
| 只修改原生窗口 | native host surface recommit | Repaint/re-present only the parent host substrate. |
| 原生宿主完整刷黑 | material host black base | A complete black client base below DWM Mica/Acrylic/Tabbed composition. |
| WebView 只占 1/3，其它区域仍有残影 | parent-surface ownership evidence | Child coverage cannot explain the residue boundary. |
| 先把原生窗口渲染完，再渲染 WebView2 | parent-before-child commit order | Host paint precedes WebView2 controller and WRY child geometry. |

## Intent

### Surface Intent

Converge the accepted Windows residue fix, record the root-cause model and implementation law in code/OpenSpec, remove obsolete recovery and diagnostic code, and retain a focused production regression example.

### Final Visible Effect

A retained OpenTray WebView window can use Mica or Acrylic, switch framed/frameless, resize, hide/show, and manually recommit its host surface without exposing gray/staircase native residue. Material remains visible, page input remains intact, and no shell flash or one-pixel geometry pulse occurs.

## Platform Diagnosis

- Regular atom: yes, Windows WebView host-surface ownership inside `@opentray/ext-webview`.
- Law upgrade: material windows own a persistent native black composition base.
- Public API change: none; existing `clearWhiteBlock` aliases remain compatible.
- Breaking internal cleanup: yes; diagnostic commands, auto-cleanup flags, timers, private messages, shell resets, width pulses, and runtime composition logs are removed.

## Reverse-Inferred Procedural Design

### Background Family Selection

```text
style.background
      |
      +-- opaque / plain transparent
      |       -> WS_EX_NOREDIRECTIONBITMAP
      |       -> Softbuffer owns native base
      |
      +-- Mica / Acrylic / Tabbed / semantic blur
              -> DWM redirection surface
              -> parent WS_CLIPCHILDREN removed
              -> HWND owns complete BLACK_BRUSH client base
```

### Style Transaction

```text
publish target host-paint policy
              |
suppress synchronous child commits
              |
project Win32 + DWM + AppWindow style
              |
commit complete parent host surface
              |
commit WebView2 background
              |
controller bounds -> WRY child bounds -> parent notification
```

### Resize Transaction

```text
WM_WINDOWPOSCHANGED
  DefWindowProc -> parent-position notification only

WM_SIZE
  DefWindowProc
      -> native host paint
      -> WebView2 controller bounds
      -> WRY child bounds
      -> parent-position notification
```

### Manual Compatibility Command

```text
clearWhiteBlock
      |
      +-- material -> RedrawWindow(parent only, synchronous)
      |
      +-- plain host -> present configured Softbuffer base
```

Forbidden side effects: `ShowWindow` transitions, focus/activation mutation, HWND geometry pulses, WebView2 bounds, WRY child bounds, parent notification, timers, or private recovery messages.

## Regression Surface

`pnpm --filter opentray example:win32-bug` SHALL run production behavior only. It keeps the normal Window control panel plus:

- host-surface recommit;
- non-mutating surface snapshot;
- frameless transparent titlebar and optional self-drawn controls.

It SHALL NOT expose legacy atomic composition commands, automatic-cleanup switches, or a material-host-paint disable switch.

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Shell minimize/restore | Visible churn, changes window state, and did not own the stale pixels. |
| Native width pulse | Geometry mutation hides the missing parent-paint invariant and can jitter content. |
| WebView background/frameless toggles as repair | User evidence showed neither is the ownership boundary. |
| Controller/child bounds, parent notification, DWM flush | Atomic tests did not clear the native residue. |
| Queued timer/message cleanup | The correct parent surface must be valid continuously, not repaired later. |
| Disabling production host paint in the regression example | Preserves a second runtime protocol after the production law is accepted. |

## Exit Conditions

- Production and tests contain no legacy diagnostic/recovery symbols.
- Rust, TypeScript, Svelte, OpenSpec, and source-host smoke pass.
- Current project guidance describes only the accepted production law.
- Historical experiments remain available in backed-up plans, not executable product code.
