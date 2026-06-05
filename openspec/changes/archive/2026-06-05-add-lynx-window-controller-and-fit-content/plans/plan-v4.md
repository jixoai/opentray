# Intent Document

## Current Round

- Round: 2
- Status: apply
- Previous plan backup: `plans/plan-v3.md`

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

> 我走了肉眼验收，有个问题，我发现这个demo有黑边（内容边缘到窗口边缘都是黑的），我觉得是窗口和内容尺寸没有做好自动适配导致的。ext-webview是有内置一套基础的窗口控制器的。你这个ext-lynx有吗？
>
> 1. 首先我怀疑Webview那边可能也没有做基于document.body来实现自动fit-window-size。但是这是Web的标准决定的。document.body和window本身就是可以不对齐的。
> 2. 而lynx这边，可能是因为我们的DEMO是固定布局和尺寸的缘故，所以导致这种黑边的问题。因此其实终点在于补全window控制器。至于fit-window-size，这个完全可以通过Options来实现：在完成窗口控制器能力的基础上，额外做的能力扩展和补强。
>
> 同意，不过我希望一次性把两层全部做完，并补强skills。
> 因为第二层的开发并不困难，而且按照lynx的开发特性，是不是应该默认启用 fitContentSize的特性，官方的开发方式是怎么说的？

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 肉眼验收发现 Lynx demo 有黑边，并明确对比 `ext-webview` 已有窗口控制器。 | 本 change 不能只修 demo 样式，必须补足 `ext-lynx` 的宿主窗口控制能力。 |
| 2 | User | `document.body` 与宿主窗口不天然对齐，WebView 不应拿 DOM 尺寸冒充原生窗口法则。 | `fitContentSize` 不能被错误地设计成 Web/DOM 驱动的默认魔法。 |
| 3 | User | Lynx 黑边问题的真正终点是补全 window controller，`fit-window-size` 应该是其上的扩展项。 | 第一层是 controller，第二层是 fit-content；两层都要做，但职责不能混淆。 |
| 4 | User | 希望这次一次性做完两层，并同步补强 skills。 | 本 change 需要同时覆盖实现、文档、skills，而不是只补 runtime。 |
| 5 | User | 询问是否应该默认启用 `fitContentSize`，并要求基于 Lynx 官方开发方式判断。 | 需要先锁定“官方法则”和“OpenTray 产品决策”的边界，再决定默认值。 |
| 6 | User | 明确要求废弃 `fitContentSize`，理论上 `screen + resize API` 就够了。 | sizing law 从默认 fit-content 收缩为固定壳 + 显式控制。 |
| 7 | User | 要求启动阶段控制变成独立开关，并支持 `*` / `!feature` 组合。 | smoke / runtime / docs 需要从 profile 模式切到 feature expression 模式。 |
| 8 | User | 肉眼验收确认 baseline 正常，但 `nativeWindowApi`、`nativeScreenApi`、`frameless` 任意单独开启都会异常，并提示核心问题可能不是某个 feature 本身。 | 问题收敛到非-baseline 共同触发的启动阶段宿主副作用；bridge feature 不应隐式触发 Cocoa window takeover。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-lynx/src/index.ts` | 当前 facade 只有 `show({ bundlePath })` 与 `hide()`。 | 现状并不存在 window controller，只能新增而不是修开关。 |
| `crates/opentray-ext-lynx/src/lib.rs` | 当前 native command 只有 `show` / `hide`。 | 现有 ABI 面太窄，必须扩展命令协议与事件协议。 |
| `crates/opentray-ext-lynx/src/macos.rs` | 当前 runtime 只负责解压 sidecar、stage bundle、spawn/kill LynxExplorer。 | 宿主窗口能力尚未下沉到 `ext-lynx` 原子内部。 |
| `native/lynx-runtime-macos/OpenTrayLynxRuntime/Info.plist` | `CFBundleIconFile` 目前为空字符串。 | macOS Dock 空白图标的根因在 runtime app bundle 本身，而不是页面 CSS 或 tray 图标。 |
| `research/lynx/app/src/App.css` | 当前 smoke bundle 自带深色根背景、外层 padding、居中卡片。 | 黑边现象部分来自 demo 视觉，不应误判成 controller 已存在但失效。 |
| `packages/ext-webview/README.md` | `ext-webview` 已公开 `navigator.window` / `navigator.opentrayWindow` 与 move/resize/style 能力。 | `ext-lynx` 需要对齐用户可理解的宿主窗口能力面。 |
| `.worktree/enrich-webview-window-macos-capabilities/*` | `ext-webview` 已有 `getTitle/setTitle/getIcon/setIcon` 与 `navigator.screen` / `window.getScreenDetails()` 的完整词汇。 | `ext-lynx` 的第二阶段要对齐这个公开词汇，但 transport 继续走 Lynx host bridge。 |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/LynxExplorer/module/LynxDemoModule.mm` | 上游 LynxExplorer 默认窗口是 `800x600`，只在 URL query 存在 `width` / `height` 时改初始窗口尺寸。 | 上游默认不是 content-fit，而是宿主给定固定初始窗口尺寸。 |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/LynxExplorer/ViewController.mm` | LynxView 由宿主显式 `SetScreenSize` 与 `SetFrame`，并在容器布局变化时更新。 | 官方宿主法则是“宿主给约束，页面响应约束”，不是“内容反推宿主默认尺寸”。 |
| `research/lynx/upstream/lynx/platform/embedder/public/lynx_view.h` | LynxView 提供 `SendGlobalEvent` 给前端，前端通过 `GlobalEventEmitter` 监听。 | `ext-lynx` 可用原生宿主桥做回包与事件，不必伪装成 WebView 注入脚本。 |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/LynxExplorer/AppDelegate.mm` | 上游运行时会注册 Native Module 与 Extension Module。 | `ext-lynx` 可以把 `navigator.window` 落在 Lynx 宿主桥上，而非 core 特判。 |
| Lynx official docs: `guide/embed-lynx-to-native.html` | 官方原生嵌入文档明确存在 `fitContentWidth` / `fitContentHeight` 与 `LynxViewSizeModeUndefined/Max` 之类的内容适配模式。 | `fitContentSize` 是 Lynx 官方支持的能力，但不是唯一默认形态。 |
| Lynx official docs: `guide/best-practices/cls.html` | 官方最佳实践强调 Lynx 初始渲染受尺寸约束影响，并推荐在原生侧用 match parent 或 wrap content/fit content 做约束选择。 | `fitContentSize` 应该被建模成宿主约束策略，而不是 DOM 黑魔法。 |
| Lynx official docs: `guide/use-native-modules.html` | 官方鼓励通过 Native Modules 将宿主能力暴露给 Lynx 页面。 | `ext-lynx` 的窗口控制器应走 Native Module / GlobalEventEmitter 这条官方桥。 |

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
| `openspec/specs/lynx-extension/spec.md` | Lynx is an official extension atom and currently owns bundle staging plus show/hide lifecycle. | Extend. Add host-window controller and sizing policy without breaking the atom boundary. |
| `openspec/specs/webview-extension/spec.md` | Official rich-window extension already exposes a typed `navigator.window` surface and style/control capabilities. | Reuse the capability vocabulary, not the WebView-specific transport. |
| `openspec/specs/extension-host/spec.md` | Core and daemon stay generic; extension artifacts own protocol and runtime semantics. | Reuse directly. |
| `openspec/changes/archive/2026-06-02-add-webview-navigator-window-api` | `navigator.window` / `navigator.opentrayWindow` already exists as the canonical OpenTray window capability story for WebView. | Reuse the public shape where possible so developers do not learn two unrelated window APIs. |
| `openspec/changes/archive/2026-06-03-implement-ext-lynx-macos-extension` | First-stage Lynx support intentionally stopped at `show/hide` and real runtime launch. | Extend with a second-stage capability change rather than mutating archived intent silently. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “黑边” | 内容边缘到原生窗口边缘存在明显未贴合区域，影响肉眼验收。 | A visible mismatch between content layout and the native window envelope. |
| “window controller” | 扩展内部拥有的一套原生窗口控制能力，不依赖 core 特判。 | An extension-owned host window control surface. |
| “fit-window-size” / `fitContentSize` | 让宿主窗口根据 Lynx 内容尺寸或约束策略自动调整。 | Host-side content-fitting policy, not DOM magic. |
| “按照 lynx 的开发特性” | 不是套 WebView 经验，而是尊重 Lynx 官方的宿主模型。 | The implementation must follow Lynx’s actual host architecture. |
| “一次性把两层全部做完” | 这次 change 同时完成 controller 与 fit-content，不留半截设计债。 | The change closes both layers together. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `research/lynx/app` | What a real external `.lynx.bundle` looks like for visible acceptance. | Keep as the smoke bundle source; may refine visuals for clearer acceptance. |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/LynxExplorer/*` | Which host primitives LynxExplorer already uses for window creation, Native Modules, runtime injection, and event flow. | Keep as upstream evidence; selectively adapt its host patterns into the sidecar build path. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none for the implementation start | 用户已经同意一次性做完两层，并要求参考官方方式。 | 直接实施，但要在最终收口时把“官方默认”和“OpenTray 默认”区分清楚。 |

## Intent

### Surface Intent

把 `ext-lynx` 做成和 `ext-webview` 同等级的可控窗口扩展：不仅能打开真实 Lynx 窗口，还要有内置 window controller，并把启动阶段行为收敛为显式 feature set，让肉眼验收不再依赖隐式 profile 或 fit-content 魔法。

### Underlying Drive

用户要验证的是 OpenTray 的“扩展原子 law”是否足够强，而不是单点修一个 demo。`ext-lynx` 如果只能 `show/hide`，那它只是个 sidecar launcher；只有当它也能拥有自己的宿主窗口控制与 sizing policy，才说明 OpenTray 的扩展体系不依赖 WebView 特权，也不把原生能力偷偷塞回 core。

### Final Visible Effect

操作者最终看到的是：

- `opentray` 加载 `@opentray/ext-lynx` 后，真实 Lynx 窗口能被显示、关闭、移动、调整大小、切换样式。
- 页面里可通过 `navigator.window` / `navigator.opentrayWindow` 调用这些能力，并能读写 `title` / `icon`，且不会污染标准 `window.postMessage`。
- 页面里可通过 `navigator.screen` / `navigator.opentrayScreen` 读取当前屏幕与屏幕集合信息，并在显式开启时通过 `window.getScreenDetails()` 做全局兼容覆盖。
- 默认情况下，Lynx 窗口使用固定壳体；需要的宿主能力通过启动阶段显式 feature set 打开，而不是靠默认 fit-content 魔法。
- macOS Dock 不再出现空白 runtime 图标；窗口图标、Dock 图标与窗口标题都能被 dedicated runtime 在同一进程内安全更新。
- 如果开发者想验证不同宿主能力组合，可以在启动阶段用独立开关打开或关闭它们。
- skills 和 README 会把这条 law 讲清楚，后续做其它 native extension 不会再走弯路。

## Platform Diagnosis

- Current platform laws: core only owns generic extension dispatch; official extensions own protocol, runtime, and host capability bridges.
- Does this fit as a regular atom: Yes. This is a regular `ext-lynx` capability stage, not a law-breaking entity.
- Does this require law upgrade: Yes, but only inside the official-extension law. `lynx-extension` spec must grow from launcher-only to host-window capability owner.
- Breaking update stance: Prefer additive on public API; existing `show({ bundlePath })` keeps working while new options and commands extend the protocol.
- User confirmations still required: none before implementation; final acceptance should explicitly confirm the default sizing feel is visually correct.

## Reverse-Inferred Design

### Interaction / Visual Story

开发者启动一个 Lynx tray demo。默认情况下，窗口使用固定 host shell。页面可以通过 `navigator.window` 查询能力、监听尺寸变化、主动关闭窗口、请求移动/缩放；操作者也可以在启动阶段用独立 feature tokens 决定是否注入 `navigator.window`、是否绑定全局 override、是否启用 `navigator.screen`、以及是否以 frameless 启动。整个流程里，用户看到的是“Lynx 是一个完整窗口扩展”，而不是“某个 shell 把 bundle 丢给外部 App”。

### Interface Shape

- Public facade extends from launcher-only to host-window-aware:
  - `show({ bundlePath, width?, height?, minWidth?, minHeight?, maxWidth?, maxHeight?, nativeWindowApi?, bindWindowGlobals?, nativeScreenApi?, bindScreenGlobals?, title?, icon?, style? })`
  - `hide()`
  - host-window commands mirroring the current OpenTray window vocabulary:
    - `close`
    - `moveTo`
    - `resizeTo`
    - `getStyle`
    - `setStyle`
    - `getCapabilities`
    - `getTitle`
    - `setTitle`
    - `getIcon`
    - `setIcon`
    - `listen` / event subscription
- Public screen API:
  - `navigator.screen`
  - `navigator.opentrayScreen`
  - optional `window.getScreenDetails()` override only when explicitly enabled
- Public page API:
  - `navigator.window`
  - `navigator.opentrayWindow`
  - optional global overrides only when explicitly enabled
- Startup feature policy:
  - baseline: no startup host features
  - explicit startup tokens: `nativeWindowApi`, `bindWindowGlobals`, `nativeScreenApi`, `bindScreenGlobals`, `frameless`
  - wildcard/disable expression support for smoke acceptance: `*`, `!feature`
  - bridge features only enable Lynx Native Module/bootstrap exposure; they must not mutate the carrier `NSWindow` at startup
  - native chrome mutation is scoped to chrome features such as `frameless`; size, title, icon, center, and activation remain command-driven or carrier-owned unless explicitly separated later

### Data Shape

- Durable host facts:
  - current window frame
  - current style state
  - capability set
  - explicit startup feature set and bounds
- Page-facing bridge facts:
  - command name
  - command payload
  - callback or event channel identifiers
- Extension-scoped runtime facts:
  - per `(surfaceId, trayId)` window slot
  - active child process
  - staged bundle path
  - sidecar launch root

### Architecture Shape

- `packages/ext-lynx`
  - owns typed public API and README law
- `crates/opentray-ext-lynx`
  - owns command parsing, event shape, startup feature policy, metadata shape, screen shape, and the native bridge contract
- Lynx sidecar runtime
  - owns Native Module registration, runtime attach injection, GlobalEventEmitter forwarding, Dock/app/window metadata projection, and screen snapshots
- `opentray-core` / daemon
  - remain generic and unaware of Lynx-specific window semantics

Forbidden couplings:

- no `if ext == "lynx"` in core or broker
- no reuse of Wry/WebView IPC internals inside `ext-lynx`
- no DOM/body-driven default sizing law
- no fake Dock/app icon parity from tray metadata alone; runtime app bundle metadata and runtime projection must be real
- no fake cross-platform claims before a real Lynx host runtime exists there

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Final visual default | The user cares about the visual feel of the default size policy, not only protocol correctness. | Ship with a fixed host shell plus explicit startup features, then validate visually. |
| macOS runtime identity | The user explicitly cares that the Dock no longer shows a blank icon and that title/name feels real. | On the dedicated Lynx runtime, project icon to both `NSWindow` and `NSApplication`, and project title to `NSWindow` plus best-effort process-name refresh. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [x] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should `bindWindowGlobals` land for Lynx in the same change, or only `navigator.window` / `navigator.opentrayWindow`? | Affects how aggressive the host bridge is. | Provide `navigator.window` / `navigator.opentrayWindow` first-class; keep global overrides opt-in only. |
| Should title changes also attempt to refresh the runtime app name in Dock/app UI, or stop at window title only? | Dedicated-process Lynx can safely mutate app-level identity, but the visible payoff depends on Cocoa behavior. | Treat app-name refresh as best-effort on macOS in the same dedicated runtime, while keeping `window.title` as the primary durable contract. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Only tweak the demo CSS and call the black edge fixed | That hides the real missing capability and fails the architecture proof. |
| Copy WebView’s Wry script injection model verbatim | Lynx has a different official host bridge model; forcing Wry assumptions into it is the wrong law. |
| Make `fitContentSize` a DOM/body-derived feature | The user already identified this as the wrong mental model, and Lynx official host sizing does not depend on DOM body semantics. |
| Keep fixed `800x600` as the only default forever | That matches upstream Explorer demo behavior, but it is a poor default for OpenTray popup-style usage and fails visible acceptance. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: `ext-lynx` exposes a real host-window control surface plus explicit startup feature controls, window metadata and screen parity exist, the macOS Dock no longer shows a blank runtime icon, the default visible behavior is visually acceptable without hidden sizing magic, the public docs and skills explain the law clearly, and the change is ready for focused human acceptance.
