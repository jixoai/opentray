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

> 关于 ：beginWindowMoveTracking(...) / endWindowMoveTracking(...), 我建议改成 startAppRegionDrag/stopAppRegionDrag 。语义上会更加明确、更窄。就是不知道能不能实现？
>
> 同意，请你开两个 change，然后分别实现它们。我来做最终的统一验收：
> 最终的效果是：
> 1. 提供一个自定义的titlebar，并且overlay，能正确避开原生窗口控制器 来显示title
> 2. 拖拽这个自定义titlebar和原生的窗口拖拽效果一致
> 4. 关闭窗口边框。原生窗口控制器消失，背景变透明。自定义titlebar显示自己的窗口控制器，也能正常工作
> 5. 打开背景高斯模糊，能实施模糊原生窗口的后面
> 6. 能支持自定义调整窗口的圆角，特别是无边框模式下。（我记得win11是提供了几个枚举来自定义圆角大小，macOS我就不清楚了）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `beginWindowMoveTracking(...) / endWindowMoveTracking(...)` should be renamed to `startAppRegionDrag/stopAppRegionDrag` because the semantics are narrower and clearer. | This establishes the drag API naming law for the change. |
| 2 | User | The final visible effect must include a custom titlebar overlay that avoids native window controls, native-like dragging, borderless/transparent mode, background blur, and adjustable rounded corners. | This defines the change boundary and the visual acceptance surface. |
| 3 | User | The work should be split into two changes and implemented separately. | This change focuses on overlay, titlebar geometry, drag tracking, and window-state controls. |
| 4 | User | `windowControlsOverlay` is the right mental model, but we cannot polyfill `env(titlebar-area-*)`; therefore the API should live on `navigator.opentrayWindow.overlay`. | This establishes a dedicated overlay capability object instead of a CSS polyfill. |
| 5 | User | A direct `moveto` fallback is not the right experience; the platform should start and stop drag tracking natively. | This rules out the fake-drag path and requires native tracking behavior. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/macos/style.rs` | The macOS runtime already owns `frameless`, `transparent`, `keep_on_top`, and `background_effect` projection on the existing `NSWindow + Wry` runtime. | Overlay and drag tracking can be added without introducing Tao or moving ownership into core. |
| `crates/opentray-ext-webview/src/macos/mod.rs` | The runtime is already split into internal modules for bootstrap, bridge, metadata, policy, screen, and style. | A new overlay/drag module fits the current capability-family split. |
| `objc2-app-kit` bindings | `NSWindow` exposes `standardWindowButton`, `contentLayoutRect`, `performWindowDragWithEvent`; `NSEvent` exposes local monitor APIs. | The overlay geometry and native drag tracking can be implemented with native AppKit primitives. |
| `packages/cli/examples/webview-control.html` | The repository already has a page-driven manual demo for window controls, title/icon/screen, and style toggles. | We can extend the existing demo into the manual acceptance surface for overlay and drag tracking. |
| `openspec/changes/enrich-webview-window-macos-capabilities/specs/webview-extension/spec.md` | The broader webview extension already owns `navigator.window`, title/icon/screen, declarative sync policy, and style gating. | This change should extend the window-control family, not reopen the whole webview protocol. |

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
| `openspec/changes/enrich-webview-window-macos-capabilities/specs/webview-extension/spec.md` | `navigator.window` already has a private bridge, capability gating, and style metadata. | Extend only. The overlay object should sit on the same extension-owned capability family. |
| `openspec/specs/webview-extension/spec.md` | Webview is an extension atom, and style / capability failures must be explicit. | Reuse directly. This change should not teach core about overlay or drag tracking. |
| `packages/ext-webview/README.md` | The facade already documents native window controls, title/icon, screen, and style. | Extend the public docs with overlay and drag tracking, rather than inventing a separate product surface. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `startAppRegionDrag/stopAppRegionDrag` | Native drag tracking for a custom titlebar region. | Start and stop a window drag session from page code. |
| `overlay 到边框` | A titlebar overlay safe area that avoids the native controls. | The page needs a safe region to draw custom title content. |
| `windowControlsOverlay` | The web-platform mental model for titlebar overlay geometry. | The API should feel standard-like even though it is extension-owned. |
| `getTitlebarAreaRect` | The geometry contract that the page actually needs. | Return the safe rect for titlebar content and controls. |
| `自定义titlebar` | The operator-facing UI band at the top of the page. | The demo should show a real custom chrome strip, not only a button test. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/webview-control.html` | Can a page drive overlay geometry, drag tracking, and window state from the browser side? | Keep and migrate into the final acceptance demo. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `getTitlebarAreaRect()` return viewport-relative coordinates, or raw native window coordinates? | The demo and page layout math depend on the coordinate space. | Use viewport-relative coordinates for the page-facing API, and convert internally from native geometry. |
| Should drag tracking accept pointer coordinates as an optional payload, or infer the position from the current mouse location? | The native implementation can be more precise if the page supplies event coordinates. | Start with a no-arg API and allow coordinates as an optional optimization payload. |

## Intent

### Surface Intent

Add a first-class overlay capability to the WebView window atom so a custom titlebar can live in page space, avoid the native window controls, and drive native-like drag behavior through `startAppRegionDrag` / `stopAppRegionDrag`.

### Underlying Drive

The user is not asking for a fake CSS trick. They want the extension-owned window runtime to expose a narrow, native-feeling titlebar overlay contract, so page code can render its own chrome and still behave like a real desktop window. The correct answer stays inside `ext-webview`; it does not move window ownership into Tao or daemon-side special cases.

### Final Visible Effect

The operator will see a custom titlebar that can place its title in a safe overlay region, drag the window naturally from that region, and keep the native titlebar controls out of the way when overlay mode is active. The page can also toggle maximize/minimize/restore without leaving the extension-owned window contract.

## Platform Diagnosis

- Current platform laws: `ext-webview` already owns the native window runtime and private bridge family.
- Does this fit as a regular atom: yes.
- Does this require law upgrade: yes, but only inside the extension atom, by adding an overlay geometry family and drag-tracking family.
- Breaking update stance: additive public API, no Tao refactor, no daemon special case.
- User confirmations still required: coordinate space for overlay rects, and whether the drag API should accept optional pointer coordinates.

## Reverse-Inferred Design

### Interaction / Visual Story

The page shows a custom titlebar band at the top. It asks the native runtime for the safe titlebar rect, keeps the title out of the native control cluster, and uses a native drag session instead of moving the window by hand. When the user clicks and drags the titlebar region, the window follows exactly like a native window.

### Interface Shape

- `show(...)` gains an explicit overlay enablement option for the titlebar-safe-area family.
- `navigator.opentrayWindow.overlay` exposes a standard-like geometry object.
- `overlay.getTitlebarAreaRect()` returns the safe area for the custom titlebar.
- `overlay.geometrychange` notifies the page when the safe area changes.
- `navigator.window.startAppRegionDrag(...)` and `navigator.window.stopAppRegionDrag()` control native drag tracking.
- `navigator.window.maximize()`, `minimize()`, and `restore()` belong to the same window-control family.

### Data Shape

- Overlay state: enabled or disabled, current safe rect, current visibility.
- Drag state: active or inactive, current mouse tracking, cleanup token for the native monitor.
- Window state: maximized, minimized, restored.

### Architecture Shape

- `packages/ext-webview` owns the typed show-command surface.
- `crates/opentray-ext-webview` owns the overlay geometry projection and native drag tracking.
- `opentray-core` and `opentray-bin` stay generic.
- `window-vibrancy` is not the answer for drag tracking; it stays a material helper only.
- Forbidden couplings: no core special case, no daemon-side fake drag, no CSS env polyfill claim.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Overlay rect coordinate space | The page layout math depends on it. | Return page-relative rects and convert internally from native geometry. |
| Optional drag payload | The native session is easier to start if the page supplies coordinates. | Accept optional coordinates, but do not require them. |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should overlay geometry be emitted as `geometrychange` on every resize and style toggle? | It determines how the demo stays in sync with the safe area. | Yes, on any resize or style mutation that changes the safe area. |
| Should maximize/minimize/restore live on the root window capability object or under the overlay object? | It affects the final page API shape. | Keep them on the root window capability object. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `moveto` as the drag implementation | It is not native drag semantics and will not feel like a real titlebar. |
| Tao as the new window foundation | The existing AppKit/Wry runtime already owns the window, so Tao would add a second runtime law. |
| CSS `env(titlebar-area-*)` polyfill claims | We cannot inject that standard environment cleanly in this runtime. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: the demo page can show a custom titlebar that drags natively, avoids the control cluster, and exposes a live overlay rect.
