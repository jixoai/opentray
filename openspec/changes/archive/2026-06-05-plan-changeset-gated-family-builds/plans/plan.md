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

> 准确来说，任何 ext-  的编译都应该隔离，我们需要有一种能独立编译 ext 动态链接库 和 核心binary的构建方案。
>
> 需要讨论一下，你觉得如何管理这些构建呢?
>
> 我能想到的一种不是非常可靠的方法是，基于 changeset 来做触发检测，你觉得呢? 比如我的changeset中带有明确的标记，那么就触发某种任务的构建。这样我在子分支做开发，只需要commit某个changeset，那么对应的构建就能开始。我希望最终的效果是，能快速迭代某个ext，避免不必要的构建工作。
>
> 你的可靠性建议挺好，唯一不同的观点就是，我觉得还是应该基于 changeset的文件提交来触发构建，而不能因为它在这个分支所以就触发构建。这样做的目的是能控制资源的使用。
> 比如我做了5次提交，确定要构建了，然后只需要在changeset(可能已经存在）的基础上稍微改一下，比如加一个字段，用来定义这次构建的alias，可能只是一个时间。然后发现有这个changeset的文件，然后就触发构建。
>
> 这个构建技术很重要，请优先完成，因为我们的目前主要的工作是测试 ext-webview，不能被lynx的构建影响
>
> 集中所有注意力，先把这个构建的问题按照我们的设计完整地解决(不要偷懒）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 任何 `ext-*` 的编译都应该隔离，ext 动态链接库和核心 binary 要有可独立编译的方案。 | 不能继续把平台矩阵当成唯一构建单位。 |
| 2 | User | 希望通过 changeset 来做构建触发检测，用于子分支快速迭代某个 ext。 | 需要一个 changeset-driven preview build law。 |
| 3 | Assistant analysis | 仅靠“分支上存在 changeset”会误触发；要把 changeset 当作 selector，而不是分支状态。 | 触发条件必须绑定到 changeset 文件更新。 |
| 4 | User | 构建应该因为 changeset 文件本次提交被修改而触发，而不是因为这个分支本来就有 changeset。 | GitHub workflow 触发面必须收窄到 changeset 文件更新。 |
| 5 | User | 可以在 changeset 里加一个 alias 字段，改动它就能显式请求一次构建。 | changeset 需要一个轻量、机器可读的 build marker。 |
| 6 | User | 当前主要目标是测试 `ext-webview`，不能被 Lynx 构建影响。 | 第一个 family build 必须先把 `ext-webview` 和 Lynx 解耦。 |
| 7 | User | 先把构建问题完整解决，不要偷懒。 | 不能只加 workflow 条件判断，必须把底层 build law 立住。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `.github/workflows/release.yml` | 当前 native artifacts job 以平台为矩阵单位；`darwin-*` 任务会同时编 `opentray-bin`、`opentray-ext-webview`、`opentray-ext-lynx`，并且构建 Lynx runtime sidecar。 | 这正是 `ext-webview` 预览构建被 Lynx 拖慢的直接原因。 |
| `scripts/binaries/artifacts.ts` | 现有 staging 已经暴露出 `daemon`、`webview`、`lynx`、`lynx-runtime` 这些 artifact family 轮廓。 | 代码里已经有 family 雏形，只是 workflow law 还没跟上。 |
| `scripts/binaries/stage-local.ts` | `--kind` 已经区分 `daemon` / `webview` / `lynx` / `lynx-runtime`。 | 本 change 可以复用现有 artifact taxonomy，不用再发明一套。 |
| `packages/ext-lynx-darwin-arm64/package.json` | Lynx 平台包仍然同时发布 `lib` 和 `runtime`。 | 当前 family law 仍不纯，至少 preview build 不能再被这个耦合拖住。 |
| `openspec/specs/release-pipeline/spec.md` | 仓库当前只定义了 release 工作流和 changeset 发布 law，没有 branch preview build law。 | 这次要补的是 release 之外的构建法则。 |
| `openspec/changes/plan-webview-cross-platform-runtime-and-capability-matrix/plans/plan.md` | alpha release closure 已经被 Lynx runtime sidecar 卡住，用户明确要求先解决构建隔离。 | 当前优先级已经从 alpha 收口切到 build law。 |

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
| `openspec/specs/release-pipeline/spec.md` | 现有规范定义了 changesets、trusted publish、native artifact release staging。 | Reuse release truth, but extend with a separate preview build law instead of stuffing branch iteration into release. |
| `openspec/changes/archive/2026-06-02-ship-native-binaries-and-webview-platform-packages/specs/release-pipeline/spec.md` | native artifacts 以 package-owned atoms 发布，source tree 保持 binary-free。 | Reuse directly. Preview build 只能产出 artifact，不能污染 source control。 |
| `openspec/changes/archive/2026-06-02-adopt-space-tray-session-and-native-ci-law/plans/plan.md` | CI build 与发布应由 durable workflow law 驱动，而不是靠本地构建路径。 | Reuse. Preview build 也应该是 CI-owned。 |
| `openspec/changes/archive/2026-05-31-fix-changeset-peer-release-bumps/plans/plan.md` | `changeset status` 是可信的 release truth source。 | Reuse changesets as intent source, but not as the only build graph. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “任何 ext- 的编译都应该隔离” | 构建单位要按扩展 family 拆开。 | Each extension family must be independently buildable. |
| “基于 changeset 的文件提交来触发构建” | 只有 changeset 文件本次被改动，才应该启动 branch build。 | Build trigger is a file-change event, not branch state. |
| “加一个字段，用来定义这次构建的 alias” | changeset 要承载一次显式构建请求。 | The changeset needs a machine-readable build marker. |
| “测试 ext-webview，不能被 lynx 的构建影响” | `ext-webview` preview workflow 必须完全绕开 Lynx dylib/runtime。 | WebView preview builds must not depend on Lynx jobs. |
| “不要偷懒” | 不能只做一步 workaround，要把 law 和实现都补齐。 | Do the full architecture change, not a step-level hack. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | 这次不是 UI demo，而是 workflow/planner law。 | None |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Preview build 默认目标平台是不是只做 `darwin-arm64`？ | 决定默认资源消耗。 | 先按 `darwin-arm64` 作为默认 preview target，因为当前主要是本机测试 `ext-webview`。 |
| 一个 push 同时改动多个带 marker 的 changeset 时，是报错还是合并？ | 决定资源控制是否绝对显式。 | 先按“报错更诚实”，避免一次 push 意外触发多个 family build。 |

## Intent

### Surface Intent

把 OpenTray 的 branch build 从“平台矩阵耦合构建”升级成“changeset 文件更新驱动的 family build”。开发者在子分支里持续写代码时，不应该因为分支上已经有 changeset 就持续消耗资源；只有当开发者明确更新某个 changeset，并附带一个构建 alias，请求才成立。构建一旦成立，`ext-webview` 必须能独立预览构建，不再被 Lynx dylib / runtime sidecar 拖住。

### Underlying Drive

用户真正要建立的，不是一个新的 GitHub Actions 小技巧，而是一条更底层的构建法则：

- 构建触发权在开发者手里，而不是在分支状态手里。
- 构建单位应该是 artifact family，而不是 workflow 里碰巧存在的平台矩阵。
- workflow 只是执行器；changeset 是意图输入；planner 才是把意图翻译成构建图的 law。

如果现在只是给 `release.yml` 再加几层 `if: !contains(...)`，系统会继续维持“平台矩阵是第一真相”的错误结构。下一次再加 `ext-badge`、`ext-island`、Linux tray geometry fallback，复杂度会继续网状增长。

### Final Visible Effect

当这个 change 正确时，操作者会看到：

- 在任何开发分支里，只有 `.changeset/*.md` 文件本次被更新时，preview build workflow 才会被触发。
- 只有当被改动的 changeset 含有 OpenTray 的 build marker 时，planner 才会真正启用构建；否则 workflow 迅速 no-op。
- 开发者只需要改一下 changeset 里的 alias，就能显式请求一次新的 preview build。
- 如果请求的是 `ext-webview` family，CI 只会编译 `opentray-bin` 和 `opentray-ext-webview` 所需闭包，不会再顺带跑 Lynx runtime sidecar。
- uploaded artifact、测试日志、workflow 名称都会明确显示当前构建 alias、family、target，开发者一眼就知道这次构建的意图和范围。

## Platform Diagnosis

- Current platform laws: extension runtime 通过 package atoms 发布；release workflow 负责 stable/alpha publish；当前 branch preview build law 缺失。
- Does this fit as a regular atom: No. 这不是给某个 ext 加一个普通 feature，而是 build orchestrator 的 law upgrade。
- Does this require law upgrade: Yes. 必须把“构建触发”和“构建单位”从 workflow 细节提升成 durable platform law。
- Breaking update stance: Break now. 当前还没有成熟的 branch preview build contract，直接重做比兼容错误抽象更正确。
- User confirmations still required: none for first implementation pass; 当前用户已经明确要求优先、完整解决。

## Reverse-Inferred Design

### Interaction / Visual Story

理想操作流：

1. 开发者在分支里连续提交 5 次代码修改，不触发任何 heavy build。
2. 开发者确认现在值得消耗资源，于是去改一个已有 changeset，在其中更新 build alias。
3. push 后，GitHub 只因为这次 changeset 文件更新而启动 preview build workflow。
4. planner 读取这个 changeset 的 build marker，并从 changeset frontmatter 推导 family；如果 family 是 `ext-webview-native`，就只安排 WebView family 构建。
5. workflow 在目标 runner 上编译 WebView 所需闭包，上传 `opentray` + `ext-webview` 对应 artifact，不再跑 Lynx runtime。

### Interface Shape

- Changeset 继续是 changesets 标准 markdown 文件。
- 在 markdown 正文里增加一个 machine-readable build marker，至少包含：
  - `alias`
  - optional `families`
  - optional `targets`
  - optional `smokes`
- planner 读取 changeset build marker，并输出标准化 build plan：
  - `enabled`
  - `alias`
  - `families`
  - `targets`
  - `jobs`
  - `smokes`

### Data Shape

- `trigger event`: GitHub push 上本次被更新的 `.changeset/*.md` 文件列表。
- `build marker`: changeset 中的显式构建请求。
- `family graph`: `core-broker`、`ext-webview-native`、`ext-lynx-native`、`ext-lynx-runtime` 及其依赖闭包。
- `job matrix`: planner 计算后的真正构建单位，而不是硬编码平台矩阵。

### Architecture Shape

- Workflow 负责收集 push 上改动的 changeset 文件，并调用 planner。
- Planner 负责：
  - 检查 changeset 文件是否真的在本次 push 被改动
  - 解析 build marker
  - 从 changeset release package 推导默认 family
  - 生成 family-target matrix
- Family metadata 负责定义每个 family 需要的 cargo package、native artifact、默认 target、允许的 smoke。
- Build job 只执行 planner 输出的 matrix，不再自己理解 ext/webview/lynx 语义。

Forbidden couplings:

- 不能因为 `release.yml` 里已经有 Lynx 逻辑，就把 Lynx 偷带进 `ext-webview` preview build。
- 不能把“分支上存在 changeset”当作 build intent。
- 不能把 family 语义散落在 workflow 的 `if` 分支里。
- 不能让 preview build 修改 source-controlled package contents；artifact 只能进入 Actions artifact 或临时 staging。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Preview 默认 target 范围 | 影响资源消耗和等待时间。 | 默认只做 `darwin-arm64`。 |
| 多个 marked changeset 同次 push 的处理方式 | 影响构建资源是否完全可预期。 | 默认报错，不自动合并。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Preview build 是否需要覆盖 `darwin-x64` 作为第二默认目标？ | 影响 macOS Intel 机器的等待时间和资源使用。 | 第一版只做 `darwin-arm64`；Intel 通过 explicit `targets` 才进入。 |
| `ext-lynx-native` 和 `ext-lynx-runtime` 是否现在就完全拆开支持？ | 影响 family graph 复杂度。 | 第一版先把 graph 建好，并至少保证 `ext-webview-native` 不再依赖 Lynx。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 继续复用 `release.yml`，只在 step 上加条件判断 | 这还是“平台矩阵是第一真相”的错误结构。 |
| 看到分支上有 `.changeset/*.md` 就自动构建 | 无法控制资源使用，不符合用户明确要求。 |
| 手写 ext-webview 专属 workflow，不抽 planner/family law | 只会把问题从 `release.yml` 复制到另一个 workflow。 |
| 让 changeset 直接硬编码 cargo 命令 | 这会把 workflow 语义泄露进 changeset 文件，破坏扩展性。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: OpenSpec 明确规定 changeset-file-triggered family build law；CI 可在不构建 Lynx 的情况下完成一次 `ext-webview` preview build；测试和文档证明 trigger、planner、family isolation 都成立。
