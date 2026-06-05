# Intent Document

## Current Round

- Round: 1
- Status: tasks
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

> ## 接下来，主要就是打磨跨平台的支持，特别是windows和Linux。
>
> 我们这个分支做了很多变更很多工作，更多是关于macOS的适配。之前我们也有打算补强Windows和Linux，但是一直被新发现的BUG打断。现在整体进入稳定，我们就要开始做适配。
>
> 请先列出本分支的各种变更。以及针对 windows/linux 要做的额外适配补强。如果某个点不需要额外适配，也说明一下。
>
> ---
>
> 在此基础上，我补充一下刚刚实现的高斯模糊背景的那种可访问性的适配问题。
> 在 windows 上，高斯模糊的最新标准是云母效果。这个效果我印象中，是和操作系统的暗色亮色有明确的关系的。所以我们首先需要获得操作系统目前的亮暗模式，然后再次基础上去做适配。
> 说到亮暗模式，好像一直没有把操作系统的亮暗模式适配到 WKWebView 的亮暗模式中。
> 所以在 windows/linux 上，如果适配了这个亮暗模式，那么 css 就可以利用 prefers-color-scheme 来做适配, 这点三个平台都一样。
>
> 或者使用 <system-color> CSS type，配合 color-mix 。
>
> 所以总的来说，可以分成三种解决方案，这三种方案可以混合使用：
> 1. 使用 prefers-color-scheme 来做适配
> 2. 使用 <system-color> CSS type，配合 color-mix 这种高级函数来做适配
> 3. 强制配合有色背景来拖衬文字颜色
>
> ---
>
> 我记得还有一个适配的终点，也是关于 window overlay control、圆角 等等 本分支新增的一些功能。
>
> 对此请你补全。特别是平台专属接口要补全、然后进一步适配我们的跨平台通用接口，这点 macOS 也是，我看好像你拉下了很多平台专属接口，反而是吧很多 macOS 的平台专属接口当做跨平台通用的标准来使用了，这点还需要打磨一下。
>
> ---
>
> wry webview 应该好多能力我可能都没考虑到的，你看看有没有值得做的，也列出来。也许也可以一起打磨
>
> C: 因为我们还没有正式发布，所以可以直接破坏性更新，重新设计，调整通用接口和专属接口的设计
> D: Linux 的桌面标准比较混乱，但也要尝试兼容，可以尝试多种方案，比如使用 gdbus 读取属性 IconGeometry；也可以直接基于当前鼠标点击到位置，结合 screen 信息，进行推理。方案可能会有多种，在通用接口上我们有一套 fallback 链路。同时我们可以把多种方案都放在专属平台接口上，让开发者自己搭配组合使用。
>
> wry能力补强，这里你提了很多，我只挑我觉得有必要做的：
>
> 1. new-window policy: 要做，默认行为就是打开一个新的窗口实例
>    > 这里有一个麻烦的点，就是 window.open 返回的是 jsWindow 实例，这里需要去做一些额外的适配。也就是需要使用 with_new_window_req_handler 委托函数来实现 new-window policy，但需要设计一个 Options，支持枚举，也支持自定义函数（同步函数）
> 2. custom protocol / local asset serving: 直接使用自定义的 `http://$appid.localhost` 作为 host + 启动本地服务 + 使用 with_custom_protocol 拦截请求转发到本地服务。
> 2. WebContext / profile / cookie / storage partition： 这些应该默认提供，但需要设计一个 Options，支持枚举
> 3. devtools toggle：提供 Options(boolean)，支持 API（参考 electron 的接口设计），支持 js-API（`navigator.opentrayWindow.devtools.*`）
> 4. load lifecycle events： 你是说 with_on_page_load_handler 吗？我不否认可以做这个功能，但是如果要实现这个功能，那么就需要配套实现三个功能：ipc-api，injectJs，injectCss。injectJs 又分两种：初始化注入和动态注入。
>    4.1 初始化注入是基础，它是我们进一步实现 ipc-api和 injectCss 的前提
>    4.2 初始化注入的配置在 with_new_window_req_handler 创建新窗口的时候，会默认同步带上这些配置。如果目标 url 和当前 url 同源，那么
> 5. permission handlers: 默认不做限制，能允许的尽量都允许（有适配的前提下）
> 6. persistent vs ephemeral session mode: 默认启用持久化会话，提供 Options 来进入临时会话/隐私模式
>
> 开始编写change，有什么问题就提出来。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 这个分支已经稳定，接下来重点转向 Windows / Linux 的跨平台打磨。 | 这次 change 不是再补一个 macOS patch，而是重建设计口径。 |
| 2 | User | 要先盘点本分支已经落地的能力，再逐项判断 Windows / Linux 是否需要补强。 | 计划和 spec 必须先有一份 branch inventory。 |
| 3 | User | 高斯模糊 / 材质不仅是视觉问题，还要补系统亮暗模式与 CSS 可访问性适配。 | appearance law 不能只停留在 `backgroundEffect` 这类 substrate 名词。 |
| 4 | User | 现有通用接口里混入了太多 macOS 专属能力，需要拆出平台专属接口，再回适配通用接口。 | common contract 和 platform-specific contract 必须重新分层。 |
| 5 | User | 因为尚未正式发布，可以接受 breaking redesign。 | 不需要为当前错误的 public shape 维持兼容包袱。 |
| 6 | User | Linux tray geometry 需要多方案：`gdbus IconGeometry`、点击位置 + screen 推理等；通用接口需要 fallback 链路，平台专属接口要暴露原始能力。 | tray geometry 需要“解析结果 + provenance + raw probes”三层结构。 |
| 7 | User | `new-window policy` 必做，默认打开新的窗口实例；Options 既支持枚举，也支持同步自定义函数。 | 子窗口不只是加载策略，还涉及 host-side synchronous policy boundary。 |
| 8 | User | `window.open()` 返回 JS window 对象的兼容性是麻烦点，但仍要基于 `with_new_window_req_handler` 推进。 | 需要在 spec 中把 `WindowProxy` 兼容范围与 truth boundary 写清楚。 |
| 9 | User | local asset serving 要走 `http://$appid.localhost` + 本地服务 + custom protocol 转发。 | 不能继续把本地资源简单理解成 `html` 字符串或 `file://`。 |
| 10 | User | profile / cookie / storage partition 默认要有，且要能切换 persistent / ephemeral。 | session / profile law 需要成为 show-time declarative contract。 |
| 11 | User | devtools 既要 boolean option，也要 host API 和 `navigator.opentrayWindow.devtools.*`。 | devtools 是 capability family，不是临时 debug 开关。 |
| 12 | User | load lifecycle 如果做，就必须连同 `ipc-api`、初始化注入、动态 `injectJs` / `injectCss` 一起做。 | load hooks、injection、IPC 需要被设计成同一个 bootstrap family。 |
| 13 | User | permission handlers 默认尽量放行，只在 substrate 真做不到时显式 unsupported。 | 权限法则默认是 allow-by-platform, not deny-by-fear。 |
| 14 | User | `with_new_window_req_handler` 创建的新窗口要默认继承初始化注入，同源子窗口应延续当前 bootstrap bundle。 | child-window inheritance law 需要写成显式 contract，而不是临时实现细节。 |
| 15 | User | `window.open()` 不用承诺完整 DOM 级仿真，只需要基础可用。 | child-window law 以 managed session + truthful limited return behavior 为准，不做完整 `WindowProxy` 仿真。 |
| 16 | User | 不发明显式 JS appearance API；有 IPC 后开发者可以自行扩展，我们只承诺最核心的接口和事件。 | appearance 先依赖标准 web signal 与 native engine 同步，不扩张自定义前端 API 面。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts` | 当前 TS API 已经公开 `backgroundEffect`、`backgroundEffectState`、`cornerRadius` 这类 macOS 化字段。 | 这正是本次要拆开的“假通用接口”。 |
| `packages/ext-webview/src/index.ts` | 当前 page API 已有 `navigator.window`、`navigator.screen`、`navigator.opentray.tray`、overlay、drag、title/icon、global binding 等形状。 | 下一步是重塑 contract，不是推翻整个 extension-owned bridge。 |
| `crates/opentray-ext-webview/src/lib.rs` | 当前 runtime 在非 macOS 平台直接走 `UnsupportedWebviewRuntime`。 | Windows / Linux 现在还没有 runtime truth，必须在 plan 里写清楚阶段性落差。 |
| `crates/opentray-ext-webview/src/lib.rs` | show-time parser 已经有 `nativeApiPolicy`、metadata sync、tray bounds 注入、style bootstrap。 | 新能力应该扩既有 declarative bootstrap，而不是新增另一条 parallel law。 |
| `packages/ext-webview/README.md` | 文档已经把 macOS window capability、透明背景、材质、title/icon sync、screen、tray bounds 作为 ext-webview atom 的职责。 | OpenSpec 需要把 README 里的经验升级成 durable contract。 |
| `openspec/specs/webview-extension/spec.md` | 当前 spec 已规定 navigator bridge 私有 channel、overlay、drag、window state、title/icon/screen/tray law。 | 本 change 主要是修改这些 requirement 的边界定义，不是另起炉灶。 |
| `openspec/specs/client-sdk/spec.md` | `TrayHandle.getBounds()` 目前规范为 `Rect | null`，强调 truthful-or-null。 | 这与用户要的 Linux fallback chain 有冲突，需要 redesign。 |
| `openspec/specs/backend-adapters/spec.md` | backend 目前要求 tray bounds truthful-or-unsupported，不允许猜测。 | 如果要支持 Linux inference，必须把 “truthful probe” 与 “resolved fallback result” 分开。 |
| `openspec/changes/archive/2026-06-04-enrich-webview-window-macos-capabilities/plans/plan.md` | 上一轮已经证明 ext-webview 可以自己拥有 window runtime，不需要把能力塞回 core/broker。 | 这次 cross-platform 重建仍应保持 extension atom 归属不变。 |
| `crates/opentray-ext-webview/src/macos/*.rs` | macOS runtime 已经按 overlay / style / screen / metadata / bridge 模块拆分。 | 后续 Windows / Linux runtime 也应沿 capability family 拆模块，而不是平台巨型文件。 |

### Branch Inventory

| Area | Landed in this branch | Windows / Linux adaptation need |
| ---- | --------------------- | -------------------------------- |
| Window chrome | frameless, overlay titlebar, app-region drag, minimize/maximize/restore | 需要跨平台 runtime 实现；overlay 保持 PWA mental model，drag 只在 substrate truth 存在时开放。 |
| Window style | transparent, keepOnTop, native material, system corner projection | 需要把 macOS nouns 从 common API 拆出去；Windows 走 DWM/WebView2 truth，Linux 只开放 truthful 或 inferred-with-provenance。 |
| Metadata | title/icon get/set，document.title 与 favicon sync | 需要评估 Windows / Linux native title/icon substrate；通用 sync law 继续复用。 |
| Page bridge | `navigator.window` / `navigator.screen` / `navigator.opentray.tray` / global bindings | 需要继续作为 extension-owned law；不需要 core 额外适配。 |
| Tray geometry | macOS / Windows truthful bounds，page projection | Linux 需要多 probe + fallback chain；host/page result shape 要升级。 |
| Session law | hide/show reuse, destroy, explicit content replacement | 这条 law 已经平台无关，不需要额外改 core，只需 child-window / profile / partition 补充。 |
| Demo / docs / skills | glass panel、overlay、borderless recipes | Windows / Linux 需要补新的 recipe，尤其是 material + accessibility + tray panel anchoring。 |

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
| `openspec/specs/webview-extension/spec.md` | WebView bridge、overlay、drag、window state、material、tray bounds、session reuse 目前都归 ext-webview。 | Extend, then break the wrong common shape where needed. |
| `openspec/specs/client-sdk/spec.md` | `TrayHandle.getBounds()` 是 core public SDK 的 tray-owned helper。 | Extend, with breaking return-shape redesign. |
| `openspec/specs/backend-adapters/spec.md` | backend tray geometry 目前坚持 truthful-or-null。 | Break and replace with truthful probe + resolved fallback law. |
| `openspec/changes/archive/2026-06-04-add-tray-bounds-api` | tray bounds 已经在 host/page 两侧打通。 | Reuse the ownership line, not the old narrow result shape. |
| `openspec/changes/archive/2026-06-04-add-tray-primary-event` | tray primary activation 已经是 tray-owned backend law。 | Reuse directly. 不需要为了 webview panel 改 core ownership。 |
| `openspec/changes/archive/2026-06-04-clarify-webview-window-visibility-and-content-lifecycle` | `show/hide/destroy/setContent` 已经明确区分。 | Reuse directly; child window and partition should layer on top. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “打磨跨平台支持” | 不只是把代码编过，而是把能力矩阵、truth boundary、接口层次打顺。 | Finish the capability law, not just add more `cfg` blocks. |
| “平台专属接口要补全，然后进一步适配通用接口” | 先诚实建模 substrate truth，再做 cross-platform projection。 | Platform-specific APIs come first; common APIs are derived from them. |
| “高斯模糊背景的可访问性适配” | material 必须和 OS appearance、CSS system color、文本可读性一起考虑。 | Material is part of appearance/accessibility, not just decoration. |
| “fallback 链路” | 通用接口可以给出 best available result，但必须带 provenance。 | Do not fake certainty; return how the geometry was obtained. |
| “支持枚举，也支持自定义函数（同步函数）” | host-side policy object 既要 declarative，又要保留 synchronous native hook 出口。 | Policy cannot be page-side async because the native hook is synchronous. |
| “http://$appid.localhost” | 本地资源需要像真正网站一样有 origin、cookie、storage、service routing。 | Local content should behave like a first-class origin. |
| “能允许的尽量都允许” | 权限默认不要过度保守，但 unsupported 要诚实。 | Prefer truthful allow-by-capability over generic deny. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | 这次需求已经具体到足以直接写 plan/spec；后续实现阶段再补 Windows / Linux tray panel demo。 | Create later during apply if runtime behavior needs visual collapse. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none | 当前设计 scope 的两个关键 gate 已经由用户明确拍板。 | `window.open()` 只做基础可用；不新增显式 JS appearance API。 |

## Intent

### Surface Intent

把这个已经在 macOS 上站住脚的 `ext-webview` window atom，重构成一套对 Windows / Linux 也说得通的跨平台 contract：通用接口只保留真正跨平台的 window / screen / tray / lifecycle truth，所有材质、圆角、OS 特性、Linux 几何探测都下沉到 platform-specific family，再由通用接口做可追溯的 projection 和 fallback。

### Underlying Drive

用户真正担心的不是“能不能再多做几个按钮”，而是我们已经把一批 macOS substrate 名词误当成了通用标准。如果继续这样扩 Windows / Linux，只会在 `style` 和 `capabilities` 里堆越来越多伪通用字段，最后 common API 会失真，platform API 也无处安放。这个 change 的目标是纠正法则：common API 只承诺稳定语义，platform-specific API 负责真实 substrate，通用 fallback 只输出可解释的 best available result。

### Final Visible Effect

当这个 change 正确时，操作者会看到：

- `@opentray/ext-webview` 的 host API 不再把 macOS `backgroundEffect` / `cornerRadius` 之类字段伪装成“所有平台都一样”的 style。
- Windows / Linux 的未来实现可以直接挂到 `platform.windows.*` / `platform.linux.*`，而不是被迫塞进错误的 common shape。
- 页面端依旧使用 `navigator.window`、`navigator.screen`、`navigator.opentray.tray` 这些稳定入口，但能拿到带 provenance 的结果与 platform family。
- tray panel 这种场景在 Linux 上即使只能推理位置，也会明确说明“这是 inferred”，不会假装拿到了 truthful native bounds。
- material / blur / mica 一类效果会和系统亮暗模式、`prefers-color-scheme`、`<system-color>` 的标准 web 适配走到一起。
- `window.open()`、local asset origin、partition/profile、devtools、注入/IPC/load lifecycle 都回到 ext-webview 自己的 bootstrap law 中，不污染 core/broker。

## Platform Diagnosis

- Current platform laws: WebView runtime、page bridge、window session、tray projection 都归 ext-webview；core/broker 只 forward generic extension traffic。
- Does this fit as a regular atom: Partly. “把 Windows / Linux runtime 接上来”是 regular atom work；“把 macOS-shape common API 拆掉”是这个 atom 内部的 law correction。
- Does this require law upgrade: Yes. 需要升级 ext-webview 的 common-vs-platform contract，以及 tray geometry result law。
- Breaking update stance: Break now. 还未正式发布，不为错误 public shape 保兼容。
- User confirmations still required: none for the current design scope.

## Reverse-Inferred Design

### Interaction / Visual Story

开发者在 `show(...)` 时声明的不再是一坨扁平 window flags，而是几组能力：

1. 这个窗口的跨平台通用壳能力是什么：frameless、transparent、keepOnTop、overlay、window state、title/icon。
2. 这个平台的原生样式细节是什么：macOS material / corner radius，Windows backdrop / corner preference，Linux geometry probes 等。
3. 这个页面的 origin / profile / permission / injection / IPC / child-window 策略是什么。
4. 这个页面能看见哪些 navigator bridge：window、screen、tray、global binding、devtools。

页面运行时，用户仍然围绕 `navigator.window` / `navigator.screen` / `navigator.opentray.tray` 思考；但一旦需要 substrate 细节，就进入同一 capability family 下的 `platform.<family>` 子对象。开发者不需要猜某个结果是否可信，因为返回值会明确告诉他是 truthful、inferred 还是 unavailable。

### Interface Shape

- Common window contract:
  - lifecycle: `show` / `hide` / `destroy` / `setContent` / `navigate`
  - metadata: title / icon / sync policy
  - shell: frameless / transparent / keepOnTop
  - state: close / minimize / maximize / restore / geometry / overlay / drag
  - page bridge gating: navigator families + global bindings + devtools
- Platform-specific window contract:
  - `platform.macos`: material family, material state, numeric corner radius, titlebar/control specifics
  - `platform.windows`: backdrop family, corner preference, Windows-only chrome / appearance tuning
  - `platform.linux`: platform-specific geometry probes and future desktop-standard-specific knobs
- Page capability families:
  - `navigator.window`
  - `navigator.screen`
  - `navigator.opentray.tray`
  - nested `platform` family under the owning capability object
- Runtime/bootstrap families:
  - `newWindow`
  - `localAssetHost`
  - `profile`
  - `permissions`
  - `loadLifecycle`
  - `inject`
  - `ipc`
  - `devtools`

### Data Shape

- Distinguish three geometry concepts:
  - truthful native tray bounds
  - inferred tray placement
  - no usable placement
- Distinguish three appearance concepts:
  - cross-platform shell state
  - platform-specific material / corner substrate
  - page-side web appearance driven by native engine + CSS standard signals
- Distinguish three runtime scopes:
  - tray-scoped window session
  - profile / storage partition
  - child-window session spawned by new-window policy
- Distinguish three policy sources:
  - declarative option enums
  - synchronous host callback where native hook requires it
  - page-side bridge allow-list resolved from origin policy

### Architecture Shape

- `packages/ext-webview`
  - owns the typed host contract and public TS mental model
- `crates/opentray-ext-webview`
  - owns bootstrap parser, new-window policy, page bridge, local asset origin, devtools/injection/load lifecycle/ipc, and per-platform runtime families
- `packages/opentray` / `TrayHandle`
  - continue to own tray-scoped trusted host capability vocabulary
- `crates/opentray-backend-*`
  - own truthful tray geometry probes and raw platform data capture
- `opentray-core` / `opentray-bin`
  - stay generic; no ext-webview-specific branches

Forbidden couplings:

- no more flattening platform material / corner substrate into common `style`
- no Linux geometry guessing without provenance
- no daemon-side shadow implementation of child-window, profile, or injection law
- no pretending `window.open()` is fully standards-complete if the runtime can only provide a bounded subset
- no moving `screen` into core before its cross-platform event matrix is proven

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | 当前 scope 的关键 gate 已确认。 | 继续按已确认方案进入 apply。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Child window same-origin inheritance should include which bootstrap families? | 关系到 `window.open()` 后 IPC / inject / devtools / policy 是否自动复制。 | 默认继承 init scripts, CSS injection, IPC bootstrap, and profile when same-origin; cross-origin re-resolve capability policy. |
| Should `TrayHandle.getBounds()` become a richer `result` object instead of `Rect | null`? | Linux fallback chain 和 provenance 很难塞进旧返回形状。 | 默认升级成 richer result shape，并把 page-side tray bridge 与 host-side tray API 对齐。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Continue adding Windows / Linux fields into the current flat `WebviewWindowStyle` | 这会把 macOS-shaped API 继续扩成更大的假通用接口。 |
| Move cross-platform screen capability into core now | 事件矩阵、substrate truth、page bridge ownership都还没有稳定，过早上 core 会污染平台法则。 |
| Keep Linux tray geometry as `null` forever | 这会让 custom tray panel 的真实场景在 Linux 上永远无解，也浪费用户明确提供的多 probe 策略。 |
| Promise a fully standards-complete `window.open()` / `WindowProxy` emulation | 这会逼出大面积胶水桥接，当前第一性目标是 child-window law 正确。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: common-vs-platform contract is explicit, tray geometry provenance law is written, and the approved wry capability families are all represented in spec/tasks before product code starts.
