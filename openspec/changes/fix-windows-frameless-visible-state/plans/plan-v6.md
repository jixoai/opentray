# Intent Document

## Current Round

- Round: 6
- Status: source-backed composition report is ready; no further cleanup-timing change is authorized before the A/B plan is reviewed.
- Previous plan backup: `plans/plan-v5.md`

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> ## opentray 的bug：
> 1. frameless 的底层仍然有渲染残留。之前的渲染残留是，在原生窗口层存在titlebar和frame。现在native-frame没有了，但是还有native-titlebar。你之前的修复方法是： 无边框移除 `WS_THICKFRAME` 并关闭 DWM non-client 渲染。但是这个 native-titlbar 确可以用resize清理渲染残留的方式清理掉。
> 2. frameless 模式下进行 resizable 存在异常，每次只能拉动1px然后马上就无法继续resize，同时窗口进行了剧烈的闪烁。我怀疑是清理渲染残留的的逻辑导致窗口原本的resize handler被释放了？
> 3. frameless 无法 最小化，最小化后，会有一个 native-titlebar 的残留
>
> ## opentray 新功能 建议：
> 1. 新增 opentrayWindow. isClosed():Promise<boolean> | isVisible():Promise<boolean> | addEventListener('visibleChange') | toVisible():void （底层SDK也有配套新增）
> 2. visible 的作用，是混合判断 isClosed+isMinimized 。所以它只有 toVisible 方法而不是 setVisible，toVisible 的作用是基于 isClosed+isMinimized 做对应的show+restore
> 3. 如果你同意 visible 这套提案，那么是实现后， pnpm-pub 这里需要适配：托盘这里在判断 Show window|hide Window，底层全部改成 visible 系列的能力：show window 就是调用 toVisible， hide window和原来一样，调用close
> 4. 如果不同意或者觉得有歧义，请先进行讨论

> resize正常了，但是仍然有native-titlebar

> 1. 改进一下这些 example 的 primaryEvent，参考pnpm-pub，提供 `show|hide Example`，并将这种作为 ext-webview 的普遍最佳实践
> 2. frameless之后，或者frameless模式下resize完成之后，记得做 渲染残影的清理

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 2026-07-15 | User | Frameless must not leave a native titlebar after style, resize, or minimize transitions. | Full-client non-client projection must apply for every `WM_NCCALCSIZE` form. |
| 2026-07-15 | User | Frameless `resizable: true` must resize continuously without flicker. | Soft-resize may not invoke shell-state white-block clearing. |
| 2026-07-15 | User | `visible` is the product state formed from closed plus minimized, with `toVisible()` rather than a general setter. | Add typed host/page visibility queries and a transition-only command. |
| 2026-07-15 | User | pnpm-pub tray Show/Hide must use the new visibility model. | Consumer adaptation is a required follow-up after OpenTray publishes the public API. |
| 2026-07-15 | User | Frameless soft resize is now normal, but native titlebar residue remains. | Reopen the non-client projection task without changing the accepted soft-resize path. |
| 2026-07-15 | User | WebView examples must expose a primary `Show Example` / `Hide Example` action like pnpm-pub. | Make operational visibility, `toVisible()`, `close()`, and `visibleChange` the executable tray-primary recipe. |
| 2026-07-15 | User | Frameless entry and completed frameless resize must clean rendering residue. | Run Windows shell-state artifact repair only after a frameless window is visible or soft-resize capture has ended. |
| 2026-07-15 | User | Minimizing still leaves the example primary item on `Hide Example`; revealing the minimized frameless material window leaves residue until a later resize. | Treat Win32 minimize completion as a visibility projection source and defer reveal cleanup until a later HWND message turn. |
| 2026-07-15 | User | Residue cleanup causes frequent refreshes, especially during resize; investigate whether this is OpenTray, Windows/WebView2, or Rust, compare the official Mica experience, and preserve a formal report before choosing a debounce. | Freeze cleanup policy changes until the host/composition stack and current clear cadence are measured and classified. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Frameless windows return full client area only when `WM_NCCALCSIZE.wParam != 0`. | The `wParam == 0` path can retain native non-client/titlebar geometry. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Soft resize starts `WindowProcSizeMoveInteraction`; its `WM_SIZE` cleanup runs `SW_SHOWMINNOACTIVE -> SW_RESTORE`. | That shell transition can revoke mouse capture and restore a minimized frameless window. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | `apply_native_window_style` applies `SWP_FRAMECHANGED` before DWM non-client policy and DWM client attributes. | The compositor can retain prior native titlebar pixels until a later native resize causes another redraw. |
| Windows user acceptance | Continuous frameless resize now works; residual native titlebar remains. | The diagnosis is narrowed to initial/state-change non-client projection, not soft-resize capture. |
| `packages/cli/examples/*.ts` | Several WebView examples only show a panel or keep a local visibility boolean; others have no primary item. | Examples do not yet teach one retained-session Show/Hide pattern. |
| `pnpm-pub/src/daemon/tray-host.ts` | Its primary menu item relabels to the action it will perform. | Reuse the operator-facing menu rule, but project visibility through the public WebView APIs. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Automatic artifact clear is background-gated and soft resize deliberately skips it while capture is active. | Generalize the post-completion predicate so frameless opaque windows clean after entry/resize without regressing capture. |
| Windows source smoke | A `WebviewWindowHandle.listen(...)` call before first `show()` is rejected because no native session exists; leaving a listener active after runtime shutdown writes to a closed broker connection. | Register native window listeners after first show, stop them before teardown, then destroy the native session before closing the runtime. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | The existing state snapshot exposes raw native visibility, while minimization is separate. | Public `visible` needs a deliberate semantic projection instead of raw `IsWindowVisible`. |
| Windows user acceptance | The page minimize control reaches `ShowWindow(SW_MINIMIZE)`, but the host primary item can retain `Hide Example`. | The command-side state query is not a sufficient transition boundary; synchronize the same projection from native `WM_SIZE` completion. |
| Windows user acceptance | `show_bridge_window` clears artifacts in the same call stack as `ShowWindow`. | Queue one post-reveal HWND message and re-evaluate the clear predicate after Windows/WebView composition advances. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Ordinary native resize may invoke the shell-state repair from `WM_SIZE` every 120ms; the repair itself is `SW_SHOWMINNOACTIVE -> SW_RESTORE`. | The immediate refresh problem is directly attributable to OpenTray's recovery cadence, independently of the original residue trigger. |
| Wry `0.55.1` local source | The Windows backend constructs `ICoreWebView2Controller` through `CreateCoreWebView2Controller[WithOptions]`, not a composition controller; it does set initial background through `ICoreWebView2ControllerOptions3`. | The host uses the simpler HWND mode while already adopting the current first-load background API; the remaining artifact cannot be blamed on missing that initialization API alone. |
| Microsoft WebView2 hosting and background documentation | Windowed, Window-to-Visual, and Visual hosting have materially different composition/input ownership; WebView2 explicitly documents white-flash and background-color behavior. | A composition-hosting spike is a legitimate candidate, but it is not a one-line library switch and a timer cannot prove it unnecessary. |
| `crates/opentray-ext-webview/src/bootstrap.rs` and `packages/ext-webview/src/index.ts` | Page and host APIs are separately typed and command-backed; event subscriptions already exist. | Visibility remains an extension-owned, cross-platform facade contract. |
| `openspec/changes/archive/2026-06-20-tray-dynamic-state-and-webview-placement-kit` | WebView show/hide and resize cleanup are existing extension laws. | Extend the same atom; do not introduce a core/runtime special case. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec rework artifacts before reapply | Commit containing the reopened `plans/plan.md`, specs, and `tasks.md` before correcting native projection | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output before archive | pending |
| Normal archive | Commit containing archived OpenSpec result | pending after acceptance |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `2026-06-20-tray-dynamic-state-and-webview-placement-kit` | Host/page WebView commands stay in `@opentray/ext-webview`; `show` and `hide` reuse one session. | Extend. |
| WebView window patterns skill | Frameless soft resizing owns a six-CSS-pixel edge detector and must coexist with normal scrollbars. | Preserve and repair. |
| Windows tray WebView laws | White-block shell reset is only valid after resize on translucent backgrounds. | Narrow: prohibit it during application-level soft resize. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `native-titlebar 残留` | Win32/DWM non-client pixels survive although frameless is requested. | Residual native chrome. |
| `每次只能拉动1px` | The drag begins but its mouse capture/interaction is immediately lost. | Broken continuous soft resize. |
| `visible 是混合判断` | A window is visible to the operator only when it is neither closed/hidden nor minimized. | Operational visibility. |
| `toVisible` | Restore the existing session to an operable visible state; do not create a generic state setter. | Idempotent reveal. |
| `show|hide Example` | The tray's primary label states the action the next click will perform. | Dynamic operational visibility action. |
| `渲染残影的清理` | Clear compositor residue after a safe terminal transition, not during pointer capture. | Post-completion artifact repair. |
| `频繁的刷新` | The recovery itself becomes visible and harms interaction quality. | Recovery churn. |
| `官方的应用很少出现类似的问题` | Compare our host/composition topology with the native Mica baseline, not only API names. | Composition parity. |
| `难道是 rust 的问题` | Separate language bindings from the native hosting architecture and runtime behavior. | Ownership diagnosis. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/webview-control.ts` | Windows frameless, minimize, restore, and soft-resize acceptance. | Keep as the source-tree visual proof. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| None | The user supplied complete semantics and asks implementation unless ambiguity remains. | `toVisible()` is asynchronous in TypeScript because the native bridge is asynchronous, returning `Promise<void>`. |

## Intent

### Surface Intent

Repair the Windows frameless shell so it is genuinely frameless, continuously resizable when explicitly requested, and minimizable. Add one operational visibility model that lets tray applications restore either hidden or minimized windows without inspecting two native flags themselves.

### Underlying Drive

The native layer must stop using a compositor workaround as a general window-state mechanism. Frameless behavior is currently correct only until a message path falls back to native chrome or a cleanup changes shell state. The public API also needs to express what tray products actually mean by "shown": an existing window that users can see and interact with.

### Final Visible Effect

On Windows, a frameless WebView remains free of native titlebar/frame pixels after resize, minimize, restore, hide, and show. Dragging any supported soft-resize edge continuously tracks the pointer without flicker. A tray host can ask one `isVisible()` question, render Show or Hide accurately, call `toVisible()` to reveal a hidden/minimized window, and receive `visibleChange` only when that operational state changes.

Every runnable source WebView example exposes that same operation through its primary tray item: `Show Example` when the retained session is not operationally visible, `Hide Example` when it is. On Windows, a frameless window clears rendering residue after it becomes visible and after a successful soft-resize interaction releases capture.

Examples create native window event listeners only after first show and tear down in this order: unlisten, destroy the retained native session, then close the runtime and Vite server. No example leaves a broker poller or HWND behind after automatic smoke exit.

## Platform Diagnosis

- Current platform laws: WebView owns native window protocol and platform projection; core remains extension-agnostic; white-block repair is a low-level Windows concern.
- Does this fit as a regular atom: yes, entirely within the WebView extension and its facade.
- Does this require law upgrade: yes, define operational visibility separately from raw native visibility and prohibit shell-state cleanup during application-level soft resize.
- Breaking update stance: additive API. Existing `show`, `hide`, `getWindowState`, and raw state fields remain available.
- User confirmations still required: none before implementation. Release and pnpm-pub publication remain after visual acceptance.

### Composition Investigation Boundary

- Confirmed: the current live resize path invokes an invasive `ShowWindow` minimize/restore repair on a 120ms throttle. It is an OpenTray policy choice and is sufficient to explain visible churn.
- Confirmed: WebView2 and its official release notes document white flash, transparent-background defects, and separate Windowed/Visual hosting modes. The platform has real composition edge cases.
- Inference: OpenTray's custom frameless DWM host plus Wry's HWND controller has a more difficult composition boundary than a native WinUI/Mica surface. This is not evidence that the Rust language or the `windows` projection is at fault.
- Decision pending evidence: do not add a continuously reset 100ms debounce. The existing 120ms behavior is a throttle, not a trailing debounce; the platform already supplies `WM_EXITSIZEMOVE` as a terminal interaction boundary.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
frameless + resizable:true
        |
pointer reaches edge band
        |
capture + SetWindowPos only
        |
WM_SIZE -> sync WebView + repaint
        |
pointer release -> emit geometry

No ShowWindow state change occurs during this interaction.
```

```text
SetWindowLongPtr(style/ex-style)
        |
        v
apply DWM non-client policy + DWM host attributes
        |
        v
SetWindowPos(SWP_FRAMECHANGED, no move, no size, no shell state change)
        |
        v
WM_NCCALCSIZE returns full client area for frameless
```

```text
primary click
     |
     v
isVisible() ----- true -----> close() -------> menu: Show Example
     |
   false
     |
     v
first use: show() / retained session: toVisible()
     |
     v
visibleChange -------------------------------> menu: Hide Example
```

```text
frameless projection / soft resize
        |
        v
visible window / capture released
        |
        v
artifact-clear predicate
        |
        v
shell-state rendering repair (never during capture)
```

```text
closed/hidden ----- toVisible() -----> shown
minimized --------- toVisible() -----> restored
shown ------------- toVisible() -----> unchanged

visible = !closed && !minimized
```

```text
ShowWindow(SW_MINIMIZE / SW_RESTORE)
        |
        v
WM_SIZE completes native state
        |
        v
shared visible projection -> visibleChange -> tray primary label

ShowWindow(SW_SHOW / SW_RESTORE)
        |
        v
queue one private HWND message
        |
        v
next message turn: re-check frameless + visible + normal + no soft capture
        |
        v
artifact clear
```

### Interface Shape

- Page `navigator.opentrayWindow` and optional `navigator.window` gain `isClosed(): Promise<boolean>`, `isVisible(): Promise<boolean>`, `toVisible(): Promise<void>`, and typed `visibleChange` listeners.
- Host `WebviewWindowHandle` gains the same state queries and `toVisible()` so tray hosts need not inject page code.
- `visibleChange` carries `{ visible: boolean }`; `WebviewWindowState.visible` adopts the same operational meaning.

### Data Shape

- `closed`: native window session is currently hidden/not projected.
- `minimized`: native window is iconic/miniaturized.
- `visible`: product projection `!closed && !minimized`, never raw `IsWindowVisible`/`NSWindow.isVisible` alone.
- `windowstatechange`: full state snapshot; `visibleChange`: narrow transition event.

### Architecture Shape

```text
@opentray/ext-webview facade
  | host command / page bridge
  v
opentray-ext-webview native extension
  | Windows: Win32 + DWM + WebView2
  | macOS: AppKit + WKWebView
  v
platform-owned native window state
```

No `opentray-core` branch, broker special case, or consumer-specific behavior is permitted.

## Intent-Driven Plan

- [x] 1. Research existing Windows chrome, soft resize, state, facade, and prior OpenSpec laws.
- [ ] 2. Specify frameless non-client projection, soft-resize cleanup exclusion, and visibility contracts.
- [ ] 3. Write BDD tasks for native behavior, facade typing, docs/skill guidance, consumer adaptation, and proof.
- [ ] 4. Commit OpenSpec artifacts before product code.
- [ ] 5. Implement Windows repair and cross-platform visibility contract.
- [ ] 6. Adapt pnpm-pub after the OpenTray package is published.
- [ ] 7. Verify, self-review, and obtain human Windows acceptance before release/archive.
- [ ] 8. Reapply DWM non-client policy and related DWM attributes before one final non-shell frame recalculation, then obtain renewed Windows visual acceptance.
- [ ] 9. Turn operational visibility into the canonical WebView tray-primary example pattern and clear frameless rendering residue only at safe post-transition boundaries.
- [ ] 10. Synchronize `visibleChange` after native minimization and defer frameless reveal artifact cleanup until post-reveal composition completes.
- [x] 11. Write and commit a source-backed Windows WebView2/DWM composition investigation before changing cleanup timing again.
- [ ] 12. Instrument clear reasons/counts and run a terminal-only versus live-clear A/B matrix; treat a trailing 100ms delay as one experiment, not the default diagnosis.
- [ ] 13. Decide between terminal-only recovery, startup/background changes, and a Window-to-Visual/composition-hosting spike from evidence; request user approval before an architectural host change.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should `toVisible()` request foreground activation? | Visibility and activation are distinct native states. | Preserve existing non-forcing `show()` behavior; `toVisible()` guarantees reveal/restore only. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep shell-state white-block clear in soft resize with stronger capture recovery | The workaround changes the very native state the resize interaction depends on and causes flicker. |
| Clear the residual titlebar before frameless projection completes or while soft-resize owns capture | The shell-state repair is valid only as a post-transition cleanup; doing it earlier regresses the style path or revokes capture. |
| Use local example booleans as the source of truth for Show/Hide labels | They diverge when page/native commands hide, close, minimize, or restore the retained session. |
| Clear frameless rendering residue during soft-resize pointer capture | The shell-state repair revokes the capture required for continuous resize. |
| Make `visible` a mutable boolean setter | It conflates hidden/closed and minimized states and cannot define a correct inverse transition. |
| Move visibility into `opentray-core` | Visibility belongs to the WebView native-window capability, not generic tray state. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: any observed titlebar residue, capture loss, or minimize failure reopens the Windows task; this round was reopened by residual native titlebar after soft-resize acceptance.
- Custom exit condition from intent: user visually verifies `example:webview-control` frameless resize/minimize/restore and then authorizes release/pnpm-pub adaptation.
