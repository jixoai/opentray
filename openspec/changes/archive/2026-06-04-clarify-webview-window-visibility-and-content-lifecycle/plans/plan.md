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

> 还有一个技术细节，我发现每次我打开窗口，都是一个全新的webview对象，你并没有复用。
>
> 很好，使用openspec vision 推进修复这个问题

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | “每次我打开窗口，都是一个全新的 webview 对象，你并没有复用。” | 这不是单纯视觉 bug，而是窗口复用心智和页面 runtime 心智已经错位。 |
| 2 | User | “使用 openspec vision 推进修复这个问题。” | 需要把这次修复提升为正式平台法则，而不是只在 demo 上打补丁。 |
| 3 | Assistant | 已确认 native slot 会复用，但 demo 每次 reopen 都重新传 `html`，导致 page runtime 被 `load_html(...)` 重建。 | 需要区分“复用原生窗口”和“复用页面会话”两个层次。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/macos/mod.rs` | `Show` 会进入 `ensure_slot(...)`；只要 `tray_id` 与 `show_settings` 相同，就不会新建 `NSWindow` / `WebView` slot。 | 证明用户看到的“像全新对象”并不总是 native slot 重建。 |
| `crates/opentray-ext-webview/src/macos/mod.rs` | 在复用 slot 的分支里，只要 `show(...)` 再次携带 `url` 或 `html`，runtime 就会执行 `load_url(...)` 或 `load_html(...)`。 | 这会直接重建页面 JS/DOM 上下文，因此从页面视角看就是“新的 webview 对象”。 |
| `packages/cli/examples/tray-panel.ts` | demo 通过 `panelContentLoaded` 避免第二次 `show(...)` 继续传 `html`，从而复用同一页面 runtime。 | 证明问题可被暂时绕过，但 public contract 仍然含混。 |
| `packages/ext-webview/src/index.ts` | 公开 facade 只有 `show / hide / navigate / evaluate / postMessage`，没有显式的 “destroy session” 或 “replace content” 命令。 | 当前 API 把可见性、会话销毁、内容替换三种动作混在了 `show(...)` 里。 |
| `openspec/specs/webview-extension/spec.md` | 主 spec 只规定 WebView 生命周期归 tray/lease 管理，但没有定义“再次 show 同一 tray 时是复用页面，还是替换页面”。 | OpenSpec 目前没有这条关键法则，所以用户和实现容易各自推断。 |
| `openspec/specs/lynx-extension/spec.md` | Lynx 明确规定“同 tray 再 show 会替换旧 process”。 | 这说明不同 extension 可以有不同生命周期 law，WebView 不必强行沿用 Lynx 模型。 |
| `packages/ext-webview/README.md` | 文档展示了 `show(...)` 如何声明初始内容与能力，但没有说明重复 `show(...)` 对现有页面 runtime 的影响。 | 文档层也在放大心智歧义。 |

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
| `openspec/specs/webview-extension/spec.md` | WebView 是 extension-owned atom，`show / hide / navigate / evaluate / postMessage` 是当前公开命令面。 | Extend. 需要把 window session law 补进这个 spec。 |
| `openspec/changes/enrich-webview-window-macos-capabilities/specs/webview-extension/spec.md` | 最近新增了 title/icon/screen/style/policy 等 window capability，但没有处理 session lifecycle 歧义。 | Keep separate. 不把 lifecycle 问题继续塞回 capability change。 |
| `openspec/specs/lynx-extension/spec.md` | Lynx 是短生命周期 process runtime，“re-show replaces previous process” 被明确写死。 | Contrast only. WebView 应明确走不同法则。 |
| `openspec/specs/client-sdk/spec.md` | 人类示例要能直观体现公开 contract。 | Reuse. 需要给 demo/README 一个不再误导开发者的行为模型。 |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “全新的 webview 对象” | 用户不是在抱怨 `NSWindow` 指针，而是在抱怨页面 JS/DOM 状态每次都被重置。 | The page runtime feels recreated on each open. |
| “你并没有复用” | 用户要的不是实现细节解释，而是稳定会话心智。 | Reopening should preserve the existing page session unless explicitly replaced. |
| “使用 openspec vision 推进修复” | 这个问题需要先固化成平台法则，再做代码。 | This needs a spec-driven lifecycle fix, not another demo workaround. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/tray-panel.ts` | 证明如果不重复传 `html`，现有 runtime 可以复用同一页面上下文。 | Keep, but move from workaround mindset to canonical example after lifecycle law lands. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| WebView 是否应该默认保留页面会话，而不是在重复 `show(...)` 时重置内容？ | 这是决定 `show` 是 visibility verb 还是 content verb 的核心。 | 是。用户要的是复用心智。 |
| 当开发者明确想替换 host HTML 时，是否接受新增一个显式 content-replacement 命令，而不是继续重载 `show(...)`？ | 如果不拆命令面，就会继续混淆“显示窗口”和“替换页面”。 | 接受。显式命令比隐式重载更符合平台法则。 |

## Intent

### Surface Intent

修复 `ext-webview` 的窗口复用心智，让开发者在重复打开同一 tray 窗口时，不再感觉“每次都是一个全新的 webview 对象”。

### Underlying Drive

用户真正指出的是一个平台法则缺口：`show(...)` 现在同时承担“创建或复用窗口”“让窗口可见”“替换页面内容”三件事，所以开发者无法判断自己是在操作一个持续存在的 window session，还是在无意中重建整个 page runtime。这个问题如果不拆开，后面的 tray panel、custom titlebar、glass window、screen-aware overlay 都会继续建立在错误心智上。

### Final Visible Effect

开发者最终会看到并信任下面这条行为：

- 同一个 tray 的 WebView 窗口第一次 `show(...)` 会创建 session。
- `hide()` 之后再次 `show(...)`，窗口重新出现，但页面 JS/DOM 状态保持原样。
- 如果开发者想替换 URL 或 host HTML，必须显式调用专门的内容替换命令，而不是靠“再次 show”偷偷触发 reload。
- 如果开发者试图在一个已存在 session 上用 `show(...)` 改变 bootstrap 级能力设置，系统会给出明确错误或要求显式销毁会话，而不是悄悄丢掉页面状态。

## Platform Diagnosis

- Current platform laws: WebView runtime 是 extension-owned atom；slot 归 `(surfaceId, trayId)` 范围；lease cleanup 可以销毁 slot；但 `show(...)` 还没有被分解成清晰的会话语义。
- Does this fit as a regular atom: Yes. 这是 WebView extension 自己的 session law 补完，不需要污染 core 或 daemon。
- Does this require law upgrade: Yes. 需要把 `show / hide / destroy / replace-content` 从隐式混合状态升级成显式生命周期 contract。
- Breaking update stance: Prefer breaking cleanup now. 在 alpha 阶段，宁可让旧的“重复 show 即 reload”心智失效，也不要继续靠隐式副作用维持兼容。
- User confirmations still required: 如果要把 `show(...)` 的重复内容输入从“允许 reload”改为“拒绝并要求显式命令”，这属于可感知行为变化，需要在最终汇报里明确指出。

## Reverse-Inferred Design

### Interaction / Visual Story

理想操作流应该是：

1. 开发者第一次点击 tray，调用 `show(...)`，窗口和页面 session 被创建。
2. 页面内部有自己的状态，比如筛选器、滚动位置、临时输入、拖拽中的 UI。
3. 开发者把窗口 `hide()` 掉，再次点击 tray，只是把原窗口重新显示出来；这些页面状态都还在。
4. 如果开发者要把这个窗口从“本地 HTML 面板”切到另一个 URL，或者想灌一份新的 HTML 内容，这应该是显式的“替换内容”动作。
5. 如果开发者要换掉 bootstrap 级能力边界，例如重绑 `navigator.screen` / `window.close` / remote policy，这应该是显式的“销毁旧 session，再创建新 session”动作。

### Interface Shape

- `show(...)`：负责“ensure session exists + update mutable shell state + make visible”。
- `hide()`：负责“make invisible but keep session alive”。
- `destroy()`：负责“destroy native slot and page runtime for this tray scope”。
- `setContent(...)`：负责显式替换页面内容；统一承载 `html` 或 `url` 输入。
- `navigate(url)`：保留为 URL-only 的便捷别名，语义上等价于 `setContent({ url })`。

在存在活动 session 时：

- 再次 `show(...)` 不得隐式 reload 页面。
- `show(...)` 若带入与当前 session 不同的内容描述或 bootstrap-immutable 配置，应显式报错并指向 `setContent(...)` 或 `destroy()`。
- 宽高、位置、标题、图标、style 这类 live shell state 可以在复用 session 时更新。

### Data Shape

需要把当前混在一起的数据域拆开：

- `WindowSessionIdentity`
  - tray scope
  - bootstrap-immutable capability settings
  - current content descriptor
- `WindowShellState`
  - visible / hidden
  - size / position
  - title / icon
  - style / keepOnTop / material / corner
- `PageRuntimeState`
  - JS heap
  - DOM tree
  - scroll/input/transient UI state

关键法则：

- `hide()` 只改变 shell visibility，不改变 `PageRuntimeState`。
- `setContent(...)` 会重建 `PageRuntimeState`，但尽量保留 native slot。
- `destroy()` 同时销毁 shell 与 page runtime。

### Architecture Shape

- `packages/ext-webview`
  - 扩展公开 facade，给出明确的生命周期命令面和类型。
- `crates/opentray-ext-webview`
  - 维护 session state、内容描述、bootstrap compatibility 检查、显式 destroy/setContent 语义。
- `opentray-core` / `opentray-bin`
  - 不知道 WebView session law 的细节，只继续转发通用 extension traffic。

Forbidden couplings:

- 不允许把“重复 show 时要不要 reload”这种行为判断塞进 core。
- 不允许继续让 README/demo 用 workaround 掩盖 public contract 的歧义。
- 不允许把 Lynx 的“re-show replaces runtime”直接借用到 WebView 上。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| 是否接受 `show(...)` 在已有 session 上不再承担内容替换 | 这是最直接的可见行为变化。 | 接受，按显式 `setContent(...)` 方向推进。 |
| 是否公开 host-side `destroy()` 命令 | 如果没有显式 destroy，bootstrap 级配置变化就只能继续靠隐式重建。 | 默认公开。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| 现有 page-side `window.close()` 是否继续只做 hide，而不是 destroy？ | 这决定 page 和 host 两侧的 lifecycle 词义是否完全一致。 | 当前先不改 page-side 语义，只先修 host-side contract。 |
| `setContent({ html })` 是否应该尽量保留已有 window shell，而不是 destroy/recreate slot？ | 这影响 content replacement 的体验和实现复杂度。 | 默认保留原生 slot，仅替换页面内容。 |
| bootstrap-immutable 字段的最小集合是什么？ | 需要明确哪些字段变化会破坏现有 page bridge。 | 默认把 navigator injection / global binding / policy / sync 视为 immutable。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 继续只在 demo 里通过“不再传 html”来规避问题 | 这无法修复 public contract，未来任何调用者都还会踩中同样歧义。 |
| 维持 `show(...)` 既是 visibility verb 又是 content verb | 这正是当前问题的根源，会持续污染开发者心智。 |
| 套用 Lynx 的“re-show replaces runtime”法则 | WebView 承载持续 JS/DOM 状态，和 Lynx process runtime 不是同一类宿主。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 同一歧义在 demo、README、spec 中再次出现 2 次即视为未完成
- Custom exit condition from intent: `show / hide / destroy / setContent` 四种动作在 spec、facade、runtime、README、demo 中具有一致且可验证的语义
