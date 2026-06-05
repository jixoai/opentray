# Intent Document

## Current Round

- Round: 2
- Status: tasks
- Previous plan backup: `plans/plan-v1.md`

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
| 1 | User | 现有通用接口混入了太多 macOS substrate 名词，要做 breaking redesign。 | 当前 change 必须优先修正 contract 口径。 |
| 2 | User | Linux tray geometry 最终需要 fallback 链路与 provenance。 | tray result shape 需要先升级，即使 fallback probe 还未实装。 |
| 3 | User | `window.open()` 只要求基础可用，不要求完整 DOM 级 `WindowProxy` 仿真。 | 子窗口能力可以拆成后续 bootstrap family 变化，而不是塞进本 change。 |
| 4 | User | 不发明显式 JS appearance API；优先标准 web signal。 | 当前 change 不需要自定义前端 appearance bridge。 |
| 5 | Self-review loop | 原始 plan 把 contract/provenance、Windows/Linux runtime、以及 bootstrap families 合并成一个 change，已经超出一个可归档原子单元。 | 本轮将当前 change 收束到 contract/provenance/docs/example，剩余家族显式延后而不是假装完成。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts` | 公共 API 已经开始转向 `style.platform.*` 和 `platformCapabilities`。 | 当前 change 的主轴就是把这个 split 固化下来。 |
| `crates/opentray-ext-webview/src/lib.rs` | Rust parser 之前只真正承接了 `platform.macos`。 | 需要修正 facade 和 runtime parser 的 contract 漂移。 |
| `crates/opentray-ext-webview/src/macos/style.rs` | macOS validator 之前不会显式拒绝 Windows/Linux style family。 | 需要改成 typed unsupported。 |
| `crates/opentray-core/src/broker.rs` | tray bounds broker projection 已经能生成 `kind/source/rect` 结果。 | provenance result law 已经具备可归档的基础实现。 |
| `packages/cli/examples/*` | example 仍有旧接口口径和重复的本地 dylib 发现逻辑。 | 当前 change 需要补齐 docs/example/test surface 才算真正落地。 |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Not yet committed |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not yet committed |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not yet committed |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` evidence before returning to user discussion | Not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/webview-extension/spec.md` | ext-webview owns page bridge, overlay, drag, title/icon, and tray projection. | Reuse ownership line; break the old flat style shape. |
| `openspec/specs/client-sdk/spec.md` | `TrayHandle.getBounds()` is tray-owned public SDK surface. | Extend result shape without moving ownership. |
| `openspec/changes/archive/2026-06-04-clarify-webview-window-visibility-and-content-lifecycle` | `show/hide/destroy/setContent` law is already explicit. | Reuse as-is; do not reopen lifecycle semantics here. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “平台专属接口要补全，然后进一步适配通用接口” | 先诚实建模 substrate truth，再做 common projection。 | Stable common APIs are derived from platform truth, not the other way around. |
| “fallback 链路” | 返回 best available result 时必须带 provenance。 | Never fake certainty. |
| “直接破坏性更新” | 可以现在修正 public shape，不必背兼容包袱。 | Fix the law while the repo is still pre-release. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/EXAMPLE.md` | 当前维护的 example 如何手动走查，以及各自证明哪一层 contract | Keep |
| `packages/cli/examples/_support/webview-example-support.ts` | 如何稳定复用 source-tree 本地 WebView dylib 发现与构建逻辑 | Keep |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none | 当前 change 的收束不需要新的产品决策，只需要诚实记录 deferred families。 | 继续推进归档。 |

## Intent

### Surface Intent

把 `ext-webview` 的 window contract 从一套 macOS-shaped 的扁平 style，收束成“公共 shell traits + 平台 family”的 durable shape；同时把 tray placement 从裸 `Rect | null` 升级成 provenance-bearing result，并把 docs/skills/examples/test surface 全部校正到这套新法则。

### Underlying Drive

用户最在意的是“法则正确”，不是“字段更多”。如果 contract 已经错了，再叠 Windows/Linux 或更多 wry 能力，只会把错误扩大。当前 change 的真正职责是把错的公共接口拆开、把真实 ownership 写清楚、把 example/skills 教成同一套 truth。

### Final Visible Effect

当这个 change 正确时，操作者会看到：

- `@opentray/ext-webview` 的公共 style 不再伪装 macOS substrate 为跨平台标准。
- Rust parser、macOS validator、TS facade、README、skills、examples 都说同一种 API 语言。
- `tray.getBounds()` 和 `navigator.opentray.tray.getBounds()` 返回同一类 provenance-bearing result，而不是裸 `Rect | null`。
- tray-panel 这类 canonical example 会直接展示 `kind/source/rect`，并用 `result.rect` 做定位。

## Platform Diagnosis

- Current platform laws: ext-webview owns window protocol, page bridge, and native runtime; core/broker stay generic.
- Does this fit as a regular atom: Yes. 这是 ext-webview atom 内部的 contract/law correction，再加上官方 guidance 的同步落地。
- Does this require law upgrade: Yes, but only inside the ext-webview/public-sdk contract boundary.
- Breaking update stance: Break now.
- User confirmations still required: none.

## Reverse-Inferred Design

### Interaction / Visual Story

开发者在 `show(...)` 里先表达公共窗口意图：`frameless`、`transparent`、`keepOnTop`。当他们需要 substrate 细节时，再进入 `style.platform.<family>`。tray panel 这类场景在 host 和 page 两侧都读取 provenance-bearing tray result，然后只在 `rect` 存在时做定位。

### Interface Shape

- Common shell traits stay at the top level of `style`.
- macOS substrate controls move under `style.platform.macos`.
- Windows/Linux family placeholders exist in the public contract even if their runtimes are not yet landed.
- `getCapabilities()` reports common shell support plus `platformCapabilities`.
- `tray.getBounds()` and `navigator.opentray.tray.getBounds()` both return `{ kind, source, rect }`.

### Data Shape

- `style` is split into common shell state and platform family state.
- tray placement is a structured result, not a nullable rect.
- docs/examples are part of the proof surface: if they teach the wrong shape, the law is still wrong.

### Architecture Shape

- `packages/ext-webview` owns public TS mental model.
- `crates/opentray-ext-webview` owns parser/runtime validation truth.
- `packages/cli/examples` owns human-visible proof for the official examples.
- `opentray-core` and backend crates stay generic and tray-owned.

Forbidden couplings:

- no more top-level `backgroundEffect` / `backgroundEffectState` / `cornerRadius` on the common style object
- no silent swallowing of `platform.windows` or `platform.linux` in the macOS runtime path
- no example that still teaches `TrayHandle.getBounds()` as `Rect | null`

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | 当前收束是实现与文档边界的整理，不涉及新的 destructive runtime migration。 | continue |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Rewrite specs around the contract/provenance/docs/example atom.
- [x] 3. Rewrite BDD tasks for the narrowed atom.
- [ ] 4. Finish implementation, verification, archive, and commit.
- [ ] 5. Self-review the narrowed atom and record deferred families honestly.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| How should the deferred bootstrap families be tracked after this archive? | They remain part of the user's broader product intent, but not this archive unit. | Report them explicitly as deferred follow-up work in the final summary. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep the original mega-change scope and pretend bootstrap families are “almost done” | That would block truthful archive and mix unrelated atoms into one unstable change. |
| Restore flat `backgroundEffect` compatibility in docs/examples for convenience | That would re-teach the wrong law immediately after fixing it in code. |
| Leave example support duplicated across three files | That weakens the manual smoke surface and makes docs drift more likely. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: the code, docs, skills, examples, and manual test guide all speak the same nested platform-family contract and provenance-bearing tray result law.
