# Intent Document

## Current Round

- Round: 1
- Status: research-plan
- Previous plan backup: none

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 同意，请你开两个 change，然后分别实现它们。我来做最终的统一验收：
> 最终的效果是：
> 4. 关闭窗口边框。原生窗口控制器消失，背景变透明。自定义titlebar显示自己的窗口控制器，也能正常工作
> 5. 打开背景高斯模糊，能实施模糊原生窗口的后面
> 6. 能支持自定义调整窗口的圆角，特别是无边框模式下。（我记得win11是提供了几个枚举来自定义圆角大小，macOS我就不清楚了）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | The final visible effect must include borderless mode, transparent background, background blur, and adjustable rounded corners. | This defines the material/chrome geometry change family. |
| 2 | User | Rounded corners matter especially in borderless mode, and macOS may require a different approach from Windows. | The implementation must stay platform-aware instead of assuming a Windows enum. |
| 3 | User | The change should be split from overlay and drag tracking. | This change owns the visual shell, material projection, and rounded-corner law only. |
| 4 | User | The blurred background should actually blur what is behind the native window. | This rules out fake blur and requires native material projection. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/macos/style.rs` | The macOS runtime already applies `window-vibrancy`, transparent background handling, and keep-on-top style state. | The material branch is already an extension-owned native atom that can be extended. |
| `objc2-app-kit` bindings | `NSWindow` and `NSView` expose titlebar transparency, opaque/background control, and the content layout surface. | Borderless, transparent, and titlebar styling can stay inside AppKit. |
| `objc2-quartz-core` bindings | `CALayer` exposes `cornerRadius` and `masksToBounds`. | Rounded corners can be implemented as a clipped layer-backed content surface without a separate GUI runtime. |
| `packages/cli/examples/webview-control.html` | The control demo already has buttons for frameless, transparent, and material state toggles. | We can extend the same demo into the visual proof surface for borderless, blur, and rounded corners. |
| `packages/ext-webview/README.md` | The public docs already describe macOS transparent background and material effects. | This change should deepen those behaviors rather than inventing a new product surface. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed yet |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/changes/enrich-webview-window-macos-capabilities/specs/webview-extension/spec.md` | Transparent background and material effects already exist as part of the broader webview window law. | Extend. This change should harden the borderless + material + rounded-corner branch. |
| `openspec/specs/webview-extension/spec.md` | Unsupported visual effects must reject explicitly; the extension owns its style surface. | Reuse directly. No fake blur or fake rounded corners. |
| `packages/ext-webview/README.md` | The documentation already orients the user toward native window style projection. | Extend with borderless shell and corner-radius control. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `关闭窗口边框` | Borderless native window shell. | Remove the standard native titlebar chrome. |
| `背景变透明` | Transparent compositing behind the webview. | Let the page and material layer show the native backdrop. |
| `背景高斯模糊` | Native blur / material effect. | Use the real platform visual effect, not a painted imitation. |
| `调整窗口的圆角` | Explicit corner-radius control for the window shell. | Let the user tune how rounded the clipped surface is. |
| `无边框模式` | The key case where corner clipping matters most. | Borderless windows need their own radius law, not just default system chrome. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/webview-control.html` | Can the demo make transparent blur and corner radius visible enough for a human to judge? | Keep and extend. |

### Questions To Confirm With User

| Question | Why it matters | Current inference before user answers |
| -------- | -------------- | ------------------------------------- |
| Should corner radius be numeric, or should it be a discrete enum that maps to platform presets later? | The API shape determines future cross-platform compatibility. | Use a numeric logical radius now; platform presets can map onto it later. |
| Should the default corner behavior follow system chrome when the user does not set a radius? | This decides whether the page has to opt in explicitly. | Preserve the system default unless the user sets `cornerRadius`. |

## Intent

### Surface Intent

Make the WebView window look and feel like a real desktop shell in macOS borderless mode: transparent where it should be transparent, blurred where it should be blurred, and clipped to a user-controlled rounded corner radius.

### Underlying Drive

The user wants the visual shell to be native, not simulated. The change must sit on the existing AppKit/Wry runtime and use the platform's real window/material primitives so the blur and rounding behave like the OS, not like a CSS approximation.

### Final Visible Effect

The operator will see a borderless or frameless window that still feels designed, with transparent compositing, a real material blur behind the content, and a corner radius that can be tuned from the demo. The content should clip cleanly at the chosen radius instead of leaving jagged native edges.

## Platform Diagnosis

- Current platform laws: the extension already owns the WebView native window runtime and style projection.
- Does this fit as a regular atom: yes.
- Does this require law upgrade: yes, but only within the extension atom, by hardening style/material/radius behavior.
- Breaking update stance: additive public style fields and explicit platform support checks.
- User confirmations still required: numeric radius vs enum and whether the default radius should remain system-defined.

## Reverse-Inferred Design

### Interaction / Visual Story

The user toggles borderless mode, then turns on transparency and blur. The content surface reveals the native backdrop through the material layer, while the outer frame clips to the selected corner radius. In borderless mode the corners are especially visible, so the radius should be obvious in the demo.

### Interface Shape

- `show(...)` should be able to declare the initial borderless / transparent / material state.
- `setStyle(...)` should be able to update the same shell after launch.
- `getStyle()` should report `frameless`, `transparent`, `backgroundEffect`, and `cornerRadius`.
- The demo should expose a slider or stepper for corner radius.

### Data Shape

- Window shell state: frameless or not, transparent or not, material effect, current corner radius.
- Layer state: whether the content view is layer-backed and clipped.
- Visual proof state: the control page must make the blur and radius visibly obvious.

### Architecture Shape

- `window-vibrancy` is the material helper, not the whole solution.
- `NSWindow` owns the borderless/transparent shell projection.
- `NSView` + `CALayer` own the clipped rounded-corner surface.
- `opentray-core` stays out of the style law.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Corner-radius shape | The API should be future-friendly across platforms. | Use a numeric logical radius. |
| Default radius behavior | Determines whether the shell needs an explicit opt-in. | Preserve system default until `cornerRadius` is set. |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should blur stay as a platform effect family, or should we introduce a separate material naming surface for future platform-specific styles? | It affects how Windows and future macOS releases map onto the contract. | Keep the current platform-agnostic `backgroundEffect` family for now. |
| Should the demo expose radius as a slider or as discrete presets? | It affects how easy it is to verify visually. | Use a slider so the effect is obvious. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Fake blur drawn in the page | It would not blur what is behind the native window. |
| Tao as the styling foundation | The existing AppKit/Wry runtime already has the window and material primitives needed here. |
| Hard-coding a single corner radius | The user asked for adjustable rounding, especially in borderless mode. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: the demo can visibly switch between normal, borderless, transparent, blurred, and rounded states without leaving the extension-owned style contract.
