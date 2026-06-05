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

> 1. 我刚才不是问你有什么残留的任务吗？你说全做完 了？我的意思就是说，要把任务做到“可发布正式版本”为止
> 2. 可以考虑提供一个 alpha Channel的发布，使用的时候用 `npm i opentray@alpha`，但是我们的skills是直接基于仓库的，和npm没关系，所以我们的skills中还得把一些功能标记成alpha。
>
> 同意，不过到底有哪些 unsupported 还没适配。为什么当前不适配
>
> 使用openspec vision推进

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 归档完成不等于结束，目标是“可发布正式版本”。 | 这次 change 不能只写实现事实，还要写发布 truth。 |
| 2 | User | 可以考虑 `npm i opentray@alpha`，同时仓库内 skills 也要把能力标成 alpha。 | 发布渠道和 repo 内文档成熟度标签要一起设计。 |
| 3 | User | 需要明确“到底有哪些 unsupported 还没适配，为什么当前不适配”。 | 必须把 unsupported 分成“未实现”“刻意不支持”“上下文 unavailable”三类。 |
| 4 | Assistant analysis | 当前 worktree 里真正未实现的是 Windows / Linux 原生 WebView runtime；其它多数 unsupported 是 macOS runtime 的刻意边界保护。 | 本 change 应先把 truth 建模清楚，再决定后续 runtime atom 的拆分。 |
| 5 | User | 要使用 OpenSpec Vision 推进，而不是继续停留在口头讨论。 | 先形成新的 Intent Document SSOT，再继续 specs/tasks。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-webview/src/lib.rs` | 非 macOS 平台直接别名到 `UnsupportedWebviewRuntime`，返回 `webview runtime is not implemented for this platform`。 | 这是当前最核心的真实 unsupported。 |
| `crates/opentray-ext-webview/src/macos/style.rs` | macOS runtime 会显式拒绝 `platform.windows.*` 样式族，并拒绝未知 material / materialState。 | 这些 unsupported 是刻意 truth，不是漏做。 |
| `crates/opentray-ext-webview/src/macos/bridge.rs` | `getTitlebarAreaRect()` 在 overlay 未启用时返回 typed unsupported。 | 这是 capability gate，不是 runtime 缺失。 |
| `crates/opentray-ext-webview/src/macos/mod.rs` | WebView runtime 创建和 focus 都要求主线程。 | AppKit 主线程前提属于 substrate law，不应伪装成后续小修。 |
| `crates/opentray-ext-webview/src/macos/screen.rs` | `screen details require the main thread`。 | `screen` 也是 substrate-bound capability，而不是纯 JS facade。 |
| `packages/ext-webview/README.md` | 当前 README 已写明 macOS 是现有 native support，Linux / Windows runtime 还未落地。 | 文档 truth 已经开始成形，但还没有成熟度矩阵。 |
| `packages/cli/README.md` | CLI README 也写明 Linux / Windows 现阶段只是包拓扑验证，不应假装 visible UI 可用。 | 发布 truth 必须和用户实际体验一致。 |
| `.github/workflows/release.yml` | 当前 release workflow 只有常规 `main` / `workflow_dispatch` 发布，没有 alpha channel 分支。 | 如果要走 `@alpha`，需要单独设计 release law。 |
| `pnpm changeset status` | 当前分支上的变更会推动 `opentray`、`@opentray/ext-webview`、`@opentray/spec` 以及所有 WebView 平台包做 minor bump。 | 发布策略不能只看单个包，还要看整体传播面。 |

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
| `openspec/specs/webview-extension/spec.md` | ext-webview owns its native runtime, positioning fallback, page bridge, and typed unsupported semantics. | Reuse. This change should refine truth surfaces, not move ownership into core. |
| `openspec/changes/archive/2026-06-05-rebuild-webview-cross-platform-window-contract-and-runtime/plans/plan.md` | 上一轮已经把 common shell traits 和 `style.platform.*` family 分开，并明确不能伪造跨平台 truth。 | Reuse and extend into a publish/maturity matrix. |
| `openspec/specs/client-sdk/spec.md` | tray geometry remains tray-owned public SDK capability. | Reuse. This change should not move tray/screen ownership lines. |
| `openspec/specs/extension-host/spec.md` | core only forwards extension traffic; extension artifacts own runtime semantics. | Reuse directly. Windows/Linux runtime 也应在 ext-webview atom 内落地。 |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “可发布正式版本” | 不是“代码能跑”，而是“对外发布时不误导用户”。 | Publish-ready means honest product truth, not just local green tests. |
| “alpha Channel” | 发布能力与成熟度要对齐，不能混淆 `latest` 和实验态。 | Dist-tag and maturity labeling should tell the same story. |
| “unsupported 还没适配” | 要区分没做、故意不支持、当前上下文拿不到。 | Separate missing runtime from honest gates and unavailable context. |
| “使用openspec vision推进” | 先把意图、法则、范围写成 SSOT，再继续实现。 | Move from chat into a durable artifact before more code. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/EXAMPLE.md` | 当前官方 example 证明了哪些 macOS-visible flows，哪些平台还没有 human-visible acceptance。 | Keep |
| none yet under this change | 这个 change 先解决 truth surface，不急着再写新 demo。 | None |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Alpha channel 是临时全局发布策略，还是只针对 `ext-webview` / 平台包？ | 决定 release workflow 和 changeset 范围。 | 先按“整条 WebView 发布面走 alpha，更诚实”来规划。 |
| 能力成熟度标签要不要进入 runtime `getCapabilities()`，还是先只放在 specs / README / skills？ | 决定它是 product truth surface 还是 documentation truth surface。 | 先落在 docs/spec/skills，runtime API 是否承诺留到下一步确认。 |

## Intent

### Surface Intent

把 ext-webview 当前已经做实的 macOS 能力、仍未适配的 Windows / Linux runtime、以及各种 typed unsupported 的边界，正式整理成一套可发布的 truth：用户、README、skills、OpenSpec、release channel 说的是同一件事。

### Underlying Drive

用户真正要避免的是“contract 看起来跨平台，实际上只有 macOS 真能用”。如果现在继续发布 `latest` 而不把 unsupported matrix、alpha 边界、以及 deliberate unsupported 讲清楚，就会把错误 law 固化到对外认知里。下一轮的 Windows/Linux runtime 适配应该建立在诚实的 truth surface 之上，而不是在过度承诺的公共 API 上打补丁。

### Final Visible Effect

当这个 change 正确时，操作者会看到：

- 仓库里的 spec、README、skills 会明确区分：
  - `stable on macOS`
  - `alpha contract / package topology on Windows/Linux`
  - `unsupported by design`
  - `unavailable by context`
- 发布讨论不再含糊。团队可以直接判断当前更适合 `latest` 还是 `alpha`。
- 后续做 Windows / Linux runtime 时，开发者知道哪些是公共 shell law，哪些是 `platform.windows` / `platform.linux` substrate family。
- 用户不会再把 overlay gate、main-thread precondition、未知 material 名称，误解成“漏实现”的跨平台能力。

## Platform Diagnosis

- Current platform laws: ext-webview owns native runtime truth, page bridge truth, and platform-specific capability families; core only brokers extension traffic.
- Does this fit as a regular atom: Yes. 这是一个标准的 ext-webview truth-surface atom，不需要把 runtime ownership 搬出 ext-webview。
- Does this require law upgrade: Yes. 需要把“能力成熟度”和“unsupported 类型学”纳入 publish/documentation law，而不是继续隐含在代码里。
- Breaking update stance: Break now. 既然还未正式发布，就不该维持模糊的跨平台叙事。
- User confirmations still required: alpha release scope，以及成熟度标签是否进入 runtime API。

## Reverse-Inferred Design

### Interaction / Visual Story

开发者打开 README、skills 或 example，不会再看到一个看似完全对称的跨平台承诺，而是先看到一张诚实的能力图谱：macOS 这边哪些窗口能力已经过人眼验收，Windows / Linux 当前只是 contract 和 package topology，哪些接口如果现在调用会得到 typed unsupported，哪些情况下只是 `unavailable` 但不代表能力不存在。

### Interface Shape

- Common shell law 继续保持公共化：`frameless`、`transparent`、`keepOnTop`、overlay、window state、tray bounds、screen details。
- Platform substrate family 继续按 `style.platform.macos | windows | linux` 建模，不把某个平台名词偷渡成 common API。
- Unsupported semantics 需要明确分层：
  - `not implemented for this platform`
  - `unsupported by current platform family`
  - `capability not enabled`
  - `unavailable in current context`
- 发布接口层还需要一套成熟度 truth：
  - docs/skills/specs 至少能标 `stable` / `alpha`
  - runtime capability metadata 是否承诺这套标签，后续再定

### Data Shape

- Platform support is not a boolean. 至少要区分：
  - package exists
  - runtime exists
  - capability exists
  - capability enabled
  - context currently has data
- Unsupported matrix 需要能表达“同一个 API 名字，不同平台、不同上下文、不同 family 的不同 truth”。
- Release maturity 需要能表达“这个包能发，不代表这个能力对外应承诺为 stable”。

### Architecture Shape

- `openspec/specs/*` 负责 durable law。
- `packages/ext-webview/README.md` 和相关 skills 负责对外教学 truth。
- `.github/workflows/release.yml` 负责把 dist-tag truth 和 capability maturity truth 对齐。
- `crates/opentray-ext-webview/src/*` 继续只实现真实 substrate，不写伪造的 cross-platform glue。

Forbidden couplings:

- 不能因为有 Windows/Linux 平台包就假装 runtime 已可用。
- 不能把 macOS validator 的 deliberate unsupported 说成“后面补一补就行”的欠债。
- 不能把 `getCapabilities()` 当前返回的 feature booleans 直接等同于发布成熟度。
- 不能为了发布 `latest` 去弱化 README/skills 对 unsupported 的说明。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| `latest` vs `alpha` 发布面 | 这是产品承诺，不只是 CI 配置。 | 先按 `alpha` 设计更诚实。 |
| 成熟度标签是否进入 runtime API | 一旦进入 API，就成为长期 contract。 | 先只进入 spec/docs/skills。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should this change stop at truth-surface planning, or also include the first pass of alpha release workflow changes? | 影响当前 atom 是“纯 planning artifact”还是“planning + release mechanics”。 | 先把 spec/task scope 写成 truth + release path，可实现时再细分。 |
| Should Windows/Linux runtime landing be one combined change or split by substrate family? | Linux tray geometry, screen, material, and placement fallback laws will likely diverge from Windows. | Split by family after this planning change. |
| Should `screen` remain ext-webview-owned until a second extension needs the same law? | 决定是否提前把 `screen` 提到 core。 | Keep it in ext-webview for now. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 继续把当前状态直接视为 `latest` 可发布 | 这会让 package topology 冒充 runtime readiness。 |
| 用一个含糊的“Windows/Linux in progress”替代 unsupported matrix | 这无法指导开发者，也无法约束后续实现。 |
| 把 macOS 的 deliberate unsupported 都归类成“未来适配” | 这会污染 common law，误导未来的 Windows/Linux 设计。 |
| 现在就把 `screen`、material、corner、overlay 全部提升到 core | 这些 law 还没有跨扩展、跨平台证明，不适合提前平台化。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: the repo has a durable OpenSpec plan that truthfully explains current macOS stability, Windows/Linux runtime absence, the unsupported taxonomy, and the intended alpha/stable release boundary before further implementation work begins.
