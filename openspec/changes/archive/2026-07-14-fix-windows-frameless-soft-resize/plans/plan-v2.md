# Intent Document

## Current Round

- Round: 1
- Status: approved for implementation
- Previous plan backup: none

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 就是frameless的背景并不是透明的，背景有旧版Windows窗口标题和边框。同样的问题在opentray项目中是同样存在的。
>
> 然后我发现frameless模式无法resize了，这个是原生Windows的限制。这个默认行为我们不打破，但是我们需要支持强行适配，如果用户显示声明了 resizable:true (是的，我们需要加新功能，这应该是style的一个子属性吧），那么我们需要在原生窗口层面模拟系统frame支持（Application-level Soft-Resizing）：通过监听鼠标位置来激活可拖拽模式，然后在拖拽区域来调用窗口的 resize 方法。
>
> `resizable` 应作为公共 `style` 属性；本轮先完成 OpenTray、example 和 Windows 可视验收，验收后再发布并让 pnpm-pub 升级使用 `resizable: true`。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Windows frameless still exposes legacy title and border. | Frameless must remove non-client shell residue, not only expand the WebView client area. |
| 2 | User | Frameless must remain non-resizable unless `resizable: true` is explicit. | Omitted `resizable` derives from the current chrome mode. |
| 3 | User | Soft resize is application-level and mouse-position driven. | The extension owns edge detection and native resize tracking; applications do not reimplement drag loops. |
| 4 | User | `resizable` belongs in common style; release waits for visual acceptance. | The API is cross-platform, while Windows owns the soft-resize substrate. |
| 5 | User | The automatic example exit retained a launcher and broker process. | Source examples must close the runtime session before Vite, which may wait for a live WebView HTTP connection. |
| 6 | User | Frameless right-edge resize must not silently compete with a native scrollbar. | Keep the native scrollbar hit region authoritative and document page-owned alternatives. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Frameless currently uses `WS_POPUP | WS_THICKFRAME`; full-client `WM_NCCALCSIZE` is already enabled. | `WS_THICKFRAME` preserves DWM frame behavior while removing its normal hit region. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Page drag already bridges one pointerdown into native `WM_NCLBUTTONDOWN`; WebView2 owns normal pointer delivery. | Soft resize needs an injected edge detector plus HWND-owned tracking, not browser-side repeated public IPC. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Window size constraints and resize-only white-block repair already live in the HWND state machine. | Soft resize must reuse these authorities. |
| `packages/ext-webview/src/index.ts` | Common style currently holds chrome and shell traits; `resize` capability only means programmatic resizing. | Add `resizable` without redefining `resizeTo()`. |
| `crates/opentray-ext-webview/src/macos/style.rs` | macOS style masks can add or omit `NSWindowStyleMask::Resizable`. | The public style can have truthful cross-platform behavior. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/webview-extension/spec.md` | Common style is limited to stable cross-platform shell traits. | Extend with user-resizable shell intent. |
| `2026-07-14-fix-windows-tray-webview-shell` | Frameless and overlay use full-client geometry; resize artifact repair is interaction-scoped. | Preserve and extend the Windows shell law. |
| `packages/cli/examples/webview-control.ts` | Source-visible acceptance surface for overlay and frameless behavior. | Extend with `resizable` launch and runtime probes. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| old Windows title and border | Legacy non-client chrome residue | The native shell still paints or reserves frame behavior. |
| default behavior not broken | Frameless remains fixed-size unless explicitly opted in | Omitted `resizable` must not silently activate soft resizing. |
| Application-level Soft-Resizing | Extension-owned custom edge resize behavior | The app declares intent; the native host handles tracking and geometry. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `resizable` be common or Windows-only? | It defines whether a cross-platform shell contract exists. | Common style trait. Confirmed. |
| Should release wait for visual acceptance? | Publishing a native shell regression without visible proof is unacceptable. | Wait for acceptance. Confirmed. |

## Intent

### Surface Intent

Windows frameless windows show no legacy titlebar or border. A frameless window becomes user-resizable only after `style.resizable: true`; its page does not need to create its own resize loop.

The native right scrollbar remains usable. Apps that need right-edge resize while a scrollbar is present must own the layout gutter or scrollbar rendering.

### Underlying Drive

`frameless` must be a coherent shell choice. It cannot simultaneously retain a DWM resize frame for behavior and claim page-owned chrome for visuals. Resizability is an independent user interaction intent, not a side effect of retaining native decoration bits.

### Final Visible Effect

An operator opens the WebView example in Windows frameless mode and sees only the page shell. With no `resizable` declaration, all edges are inert. With `resizable: true`, hovering any edge or corner changes the cursor and dragging resizes the true native window while respecting constraints, refitting WebView content, and avoiding move-triggered white-block repair.

## Platform Diagnosis

- Current platform laws: WebView owns window contracts; Windows retains HWND-thread affinity and interaction-scoped white-block repair.
- Does this fit as a regular atom: yes, `@opentray/ext-webview` owns the protocol, injection, native projection, and visual example.
- Does this require law upgrade: yes, add true frameless and explicit soft-resize laws to the Windows WebView contract.
- Breaking update stance: public output style gains a required `resizable` field; existing structural fixtures must update. Input remains additive.
- User confirmations still required: Windows visual acceptance before release and pnpm-pub consumption.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
framed + omitted      -> native frame resize
frameless + omitted   -> true borderless fixed-size shell
frameless + true      -> page edge cursor -> HWND soft resize -> constrained native bounds
```

### Interface Shape

- `style.resizable?: boolean` is the sole public opt-in.
- `getStyle().resizable` and `stylechange.resizable` report effective state.
- `getCapabilities().resizable` means the platform supports the style intent.
- Programmatic `resizeTo()` remains available independently of user resizing.

### Data Shape

- Public state: effective `frameless` and `resizable` booleans.
- Internal state: optional explicit resizable override, soft-resize edge, initial physical cursor point, initial raw HWND rectangle, and existing size/move interaction state.
- Constraints remain logical public pixels and convert at the HWND authority before `SetWindowPos`.

### Architecture Shape

- TypeScript facade and Rust protocol parse the common style field.
- Windows removes `WS_THICKFRAME` and DWM non-client rendering for frameless windows.
- An internal initialization script detects trusted mouse edge gestures even when page native APIs are not exposed.
- The HWND owns capture, movement, constraint enforcement, redraw, resize events, and cleanup.
- macOS maps the same intent to `NSWindowStyleMask::Resizable`; no Windows soft-resize code leaks into shared layers.
- Native Chromium scrollbars retain their own hit regions. Applications that need a simultaneous right resize gutter must reserve it in page layout or own their scrollbar implementation.

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| None | User confirmed API ownership and release gate. | Eight mouse edge/corner zones with a 6 CSS-pixel hit band. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Retain `WS_THICKFRAME` in frameless mode | Keeps legacy DWM frame behavior and cannot deliver a true borderless shell. |
| Ask every page to call `resizeTo()` on pointermove | Async public IPC produces lag and duplicates host behavior in every application. |
| Expose public `startResize()` commands | The product request is declarative `style.resizable`, not a second page-managed interaction API. |
| Make `frameless` imply transparent background | Chrome and background material are orthogonal style atoms. |
| Steal the native scrollbar hit region for right resize | It breaks ordinary scrolling; content layout or a custom scrollbar must own that tradeoff. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: Windows example visibly proves true frameless, default fixed-size behavior, opt-in eight-zone resizing, constraints, no move-only white-block reset, and automatic exit without a retained launcher or broker.
