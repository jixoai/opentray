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
> 看一下，目前好像就macOS有做lynx的编译，那么其它windows/linux的ext-webview 有编译吗，这才是我们的重点
>
> 集中所有注意力，先把这个构建的问题按照我们的设计完整地解决(不要偷懒）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 任何 `ext-*` 的编译都应该隔离，ext 动态链接库和核心 binary 要可以独立编译。 | 当前 release 矩阵如果仍把 daemon / webview / lynx 绑在一起，就违背了用户的底层法则。 |
| 2 | User | branch preview build 只能因为 changeset 文件本次被更新而触发，不能因为分支上“存在 changeset”而触发。 | 预览构建触发权已经收敛到 changeset 文件事件。 |
| 3 | User | changeset 里要能带一个 alias 字段，开发者改一下 alias 就能显式请求一次构建。 | 需要一个 machine-readable 的 build marker，而不是隐式分支状态。 |
| 4 | User | 当前主要目标是测试 `ext-webview`，不能被 Lynx 构建影响。 | 第一个被验证的家族隔离必须是 WebView，尤其是 release/alpha 路径。 |
| 5 | User | 不仅要看 macOS 的 Lynx，Windows/Linux 的 ext-webview 构建也要纳入法则。 | 不能做只解决 darwin preview 的局部补丁，必须覆盖 release 的全平台 WebView 包发布路径。 |
| 6 | User | 先把构建问题完整解决，不要偷懒。 | 不能停留在 preview workflow；release workflow 也必须升级到底层 family / component law。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `.github/workflows/preview-native.yml` | preview workflow 只在 `.changeset/*.md` 更新时触发，并通过 `scripts/binaries/preview-plan.ts` 规划 family build。 | branch preview 的第一阶段法则已经存在，可以复用，而不是重做。 |
| `.github/workflows/release.yml` | release workflow 的 `native-artifacts` 仍是硬编码平台矩阵；每个 darwin 目标都会同时构建 `opentray-bin`、`opentray-ext-webview`、`opentray-ext-lynx`，并跑 Lynx runtime sidecar。 | 这就是当前 alpha/release 仍被 Lynx 拖慢的直接原因。 |
| `scripts/binaries/preview-families.ts` | 代码里已经有 `core-broker`、`ext-webview-native`、`ext-lynx-native`、`ext-lynx-runtime` 等 preview family 定义。 | family 概念已经存在，但它只服务 preview，还没有上升成 release 通用 law。 |
| `scripts/binaries/stage-local.ts` | staging 已按 `daemon` / `webview` / `lynx` / `lynx-runtime` 这样的 artifact kind 区分。 | 更底层的“原子组件”其实已经浮现，可以成为 preview/release 共享构建图的基础。 |
| `packages/ext-lynx-darwin-arm64/package.json` | 单个 Lynx 平台包同时发布 `lib` 和 `runtime`。 | release 需要诚实地表达 ext-lynx 包发布时确实要带上 runtime；但 ext-webview release 不应该被它连坐。 |
| `openspec/specs/build-pipeline/spec.md` | 当前 build-pipeline spec 只定义了 preview build law，没有 release family planning law。 | 这次变更需要补规范，而不是只改 workflow。 |
| `openspec/specs/release-pipeline/spec.md` | 现有 release spec 仍强调“所有 first-stage 平台矩阵都要有 native artifact 路径”，但没有说要按 pending changesets 做家族裁剪。 | release law 需要从“覆盖所有平台路径”升级为“只为本次要发布的 package atoms 构建对应原子组件”。 |

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
| `openspec/specs/build-pipeline/spec.md` | preview build 由 changeset 文件更新触发，并用 planner + family graph 规划 job matrix。 | Reuse planner shape, extend from preview-only to shared native build graph. |
| `openspec/specs/release-pipeline/spec.md` | release 必须由 GitHub CI 构建 native artifacts，并在 npm publish 前 staging 到对应平台包。 | Reuse CI-owned artifact authority, extend with selective family planning from pending changesets. |
| `openspec/changes/archive/2026-06-05-plan-changeset-gated-family-builds/plans/plan.md` | previous change 已把“构建触发权在 changeset 文件更新”这个法则立住。 | Reuse the trigger law, break the preview-only implementation boundary. |
| `openspec/changes/plan-webview-cross-platform-runtime-and-capability-matrix/specs/release-pipeline/spec.md` | alpha publish 仍依赖当前 release workflow，因此会被 Lynx runtime sidecar 阻塞。 | Reuse as downstream acceptance pressure; this new change is a prerequisite law upgrade. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “任何 ext- 的编译都应该隔离” | 不同扩展的构建单元不能互相拖累。 | Each extension family must be independently buildable. |
| “独立编译 ext 动态链接库 和 核心binary” | daemon binary 和 ext dylib 是正交原子，不该默认绑在同一个 release 闭包里。 | The daemon and extension dylibs are independent build atoms. |
| “基于 changeset 的文件提交来触发构建” | 触发权来自这次 commit 的 changeset 文件更新事件。 | Build intent comes from this push, not long-lived branch state. |
| “不能被lynx的构建影响” | WebView 相关路径必须完全绕开 Lynx dylib/runtime，尤其是 alpha/release。 | WebView release and preview flows must avoid Lynx work entirely. |
| “不要偷懒” | 不能靠 workflow 里的 `if` 粘补，要把共享 family/component law 抽出来。 | Do the architecture change, not a shell-level patch. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | 这次是 workflow / planner law 变更，不需要独立 UI demo。 | None |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| 是否要在 release workflow 里保留“强制全量 matrix 重建”的手动逃生阀？ | 这关系到灾难恢复时是否允许绕过 pending changesets 选择器。 | 第一版默认不加；当前更重要的是把默认法则矫正，而不是先做运维逃生阀。 |

## Intent

### Surface Intent

把 OpenTray 的 native build 从“平台矩阵先行”升级成“原子组件先行”。无论是 preview 还是 release，只构建这次 changeset / publish 真正需要的 daemon、webview、lynx、lynx-runtime 组件组合，而不是把整个 darwin 家族一起端上来。

### Underlying Drive

用户不是在抱怨某个 workflow 太慢，而是在纠正一条更底层的系统法则：构建单位不应该被“平台”这个视角垄断，真正的第一真相应该是 package-owned native atoms。Preview change 已经把“触发权”从分支状态收回到 changeset 文件事件；现在还需要把“执行权”从平台矩阵收回到组件 / family graph。否则以后每新增一个 `ext-*`，release workflow 都会继续网状膨胀。

### Final Visible Effect

当这个 change 正确时，操作者会看到：

- 改一个 WebView-only changeset 并走 alpha/release 时，CI 不再编译 Lynx dylib，也不再构建 `LynxExplorer.app.zip`。
- 如果本次 pending changesets 只涉及 `@opentray/ext-webview`，release workflow 只会构建并 stage WebView 平台包所需的 native artifacts；不会顺带构建 daemon 包或 Lynx 包，除非 changesets 明确把这些 package 纳入发布集合。
- Windows/Linux 的 WebView 平台包仍会按现有 first-stage 目标构建，因为它们属于 WebView family 的发布闭包；但不会被 macOS-only Lynx sidecar 牵连。
- Preview 与 release 都引用同一套 family / component truth，后续再加 `ext-badge` 或 `ext-island` 时，不必复制一套新矩阵逻辑。

## Platform Diagnosis

- Current platform laws: preview 已经是 changeset-driven family build；release 仍是 platform-matrix-first native artifact build；artifact staging 只在最后一步按 kind 区分。
- Does this fit as a regular atom: No. 这是构建系统的底层法则修正，不是某个 ext 的普通 feature。
- Does this require law upgrade: Yes. 需要把 preview 专属 family graph 提升成 preview/release 共享的 native build graph。
- Breaking update stance: Break now. 这是 alpha 阶段的内部 CI contract，直接替换错误抽象比兼容两个平行法则更正确。
- User confirmations still required: none for the first implementation pass.

## Reverse-Inferred Design

### Interaction / Visual Story

理想流转是这样的：

1. 开发者只改 WebView 相关代码和 changeset。
2. preview workflow 因 changeset 文件更新而启动，只规划 WebView 相关预览 job。
3. later，alpha/release workflow 读取当前 pending changesets，发现这次只会发布 `@opentray/ext-webview` 家族。
4. native-artifacts 只构建 WebView family 覆盖的各平台原子组件；darwin 不再因为“顺手”去跑 Lynx runtime sidecar。
5. release job 只下载和 stage 本次真正要发的原子组件，验证对应平台包 tarball 即可。

### Interface Shape

- 一个共享的 native build graph，显式建模：
  - 原子组件：`daemon`、`webview`、`lynx`、`lynx-runtime`
  - preview family：`core-broker`、`ext-webview-native`、`ext-lynx-native`、`ext-lynx-runtime`
  - release package inference：从 pending changesets 的 release package 集合映射到需要的原子组件集合
- preview marker 继续作为 branch build 的显式意图面，不新增第二套标记语法。
- release workflow 不读取 preview marker；它读取 pending changesets 的 package truth，并交给共享 planner 推导构建闭包。

### Data Shape

- `build component`: 最底层可编译 / 可stage 的 native atom，拥有 cargo package、artifact kind、允许目标平台。
- `preview family`: 面向开发者的构建请求预设，是多个 component 的组合。
- `release selection`: pending changesets frontmatter 导出的 package 集合，再映射成 component 集合。
- `target matrix`: 最终执行单位，应该是“某个 target 上需要的组件并集”，而不是“这个平台永远构建一切”。

### Architecture Shape

- `scripts/binaries/*` 需要从 preview-only family metadata 重构成共享的 native build graph。
- preview planner 继续消费 changeset marker，但底层 job materialization 改为复用共享 graph。
- release planner 新增：读取 pending changesets，推导需要的组件、平台 targets、staging package dirs、artifact download pattern。
- release workflow 新增 planning job，并让 `native-artifacts` / `release` 两个 job 只跟随 planner 输出的 matrix 和 package set 行动。

Forbidden couplings:

- 不能再让 `release.yml` 用 `if [[ target == darwin-* ]]` 去隐式表达 “darwin 就要 Lynx”。
- 不能让 preview 和 release 各自维护一份 family truth。
- 不能把 `ext-webview` 的 release 构建闭包硬编码依赖 `opentray-ext-lynx` 或 Lynx runtime。
- 不能因为有 pending changesets 就默认构建所有平台包和所有 ext。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| release emergency full rebuild escape hatch | 这是运维策略，不是当前主路径需求。 | 先不做；只把默认法则修正完整。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| release planner 在无 pending changesets 时是否直接跳过整个 native build job | 影响 main 上的空转资源消耗。 | 默认跳过 native build，并让 release job显式 no-op。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 继续只维护 preview family graph，release workflow 里单独写一套 `if/for` 条件 | 这会把同一条法则拆成两套实现，之后每次加 ext 都要双份维护。 |
| 让 release workflow 永远全量构建 first-stage 平台矩阵 | 这正是当前 WebView alpha/release 仍被 Lynx sidecar 拖住的根因。 |
| 把 release 选择器也做成 preview marker | release 的发布真相应该来自 pending changesets package set，而不是正文里的临时 build 注释。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: preview 和 release 共享同一套 native build graph；WebView-only alpha/release 不再构建 Lynx dylib/runtime；BDD 测试和 workflow 文本都能证明选择性构建成立。
