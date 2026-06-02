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

> 完成 OpenTray 第二阶段对外收口：补齐 webview navigator window API 的剩余验证与文档，跑通仓库级 build/verify，完成活跃 OpenSpec change 的 self-review/archive 收尾，并以真实 npm 安装与文档流程验证社区用户可安装、可运行、可理解。
>
> 使用openspec vision进行推进

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 完成第二阶段对外收口，并以真实 npm 安装与文档流程验收。 | 真实 registry 安装结果高于仓库内自测结果。 |
| 2 | Agent | Fresh npm 安装 `opentray@0.3.0` 后，公开导出列表不包含 `createSpace` / `createTray`，与 README / OpenSpec 不一致。 | 当前 goal 仍未收口，必须修复已发布 SDK 的公开 API。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/cli/README.md` | README 明写“Expose `createSpace()`, default space resolution, and `createTray()`.” | 对外文档已经把顶层 API 当成承诺。 |
| `openspec/specs/client-sdk/spec.md` | Public SDK requirement 说明主 API SHALL be `createSpace`. | 这是现有 law，不是新需求。 |
| `packages/cli/src/index.ts` | 当前只导出 `createClient`, `createSpaceHandle`, `createSurfaceHandle`, `createTrayHandle`。 | 源码本身没有把高层 API 暴露出去。 |
| Fresh npm install of `opentray@0.3.0` | 真实导出列表缺失 `createSpace` / `createTray`；CLI smoke 已经使用新 Space 词汇并可运行。 | 说明这不是“README 没发出去”，而是已发布包的公开入口缺口。 |
| `packages/cli/src/client.ts` | `OpenTrayClient` 内部已经有 `createSpace()` / `createSurface()`，只是未做顶层便捷暴露。 | 修复是 regular atom，不需要推翻平台 law。 |
| `packages/cli/src/local-broker.ts` | 已经有 same-version daemon auto-start、version-scoped endpoint、event routing。 | 顶层 API 可以复用现有连接 law，而不是另起一套 transport。 |

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
| `openspec/specs/client-sdk/spec.md` | Public SDK must expose `Space / Tray / Session` vocabulary and same-version daemon auto-start. | Reuse and tighten. |
| `packages/cli/src/client.ts` | Low-level request-correlated client already creates space/tray handles. | Reuse. |
| `packages/cli/src/local-broker.ts` | Local broker connection already owns same-version daemon lifecycle and ready/session handshake. | Reuse. |
| `packages/cli/src/local-broker.test.ts` | Existing tests prove auto-start law without booting the real daemon. | Reuse test pattern. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “对外收口” | 面向社区用户的最终公开表面必须统一。 | Published package, docs, and real install behavior must match. |
| “真实 npm 安装与文档流程验收” | 不能只看仓库源码；必须看 registry 最新包。 | Fresh install from npm is the acceptance authority. |
| “可安装、可运行、可理解” | 安装成功只是第一步，公开 API 也不能让人困惑。 | CLI and SDK ergonomics both matter. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | 现有 fresh npm 安装命令已经足够暴露问题。 | none |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none for first fix pass | 这是已发布 bug，与现有 spec/README 冲突，不需要额外产品裁决。 | 直接修复并发布 patch。 |

## Intent

### Surface Intent

把已经发布到 npm 的 `opentray` 包补成 README 和 OpenSpec 承诺的样子：开发者直接从 `opentray` 导入时，就能看到 `createSpace()` 作为主入口，并能通过顶层 API 自动连上同版本 daemon。

### Underlying Drive

第二阶段的真实验收把一个结构性缺口暴露出来了：CLI smoke 已经成立，但 SDK 顶层入口仍停留在内部原子层，导致“能跑 demo”和“能让社区正确使用 SDK”是两套表面。这个 change 的目标是把这两套表面统一。

### Final Visible Effect

开发者 fresh install `opentray@next-patch` 后，`import { createSpace, createTray } from "opentray"` 与 README 一致；`createSpace()` 直接可用，`createTray()` 能走默认 space 解析；不再需要先理解 `createClient()` / `createSpaceHandle()` 才能进入主路径。

## Platform Diagnosis

- Current platform laws: `connectLocalBroker` 负责 same-version daemon lifecycle；`createClient` 负责 request-correlated protocol；`SpaceHandle` / `TrayHandle` 负责 session-owned mutations。
- Does this fit as a regular atom: Yes.
- Does this require law upgrade: No paradigm shift, but client-sdk spec should become more explicit about top-level exported convenience APIs.
- Breaking update stance: Prefer non-breaking addition; keep `createClient` and handle constructors.
- User confirmations still required: none for the first repair loop.

## Reverse-Inferred Design

### Interaction / Visual Story

用户在空目录执行 `pnpm add opentray` 后，打开 README，照着 `import { createSpace } from "opentray"` 写代码就能成功；如果他只想往默认 space 挂一个 tray，也能直接用顶层 `createTray()`，不必先理解 broker transport 内部形状。

### Interface Shape

- `createSpace(options, brokerOptions?)`：顶层主入口，自动连接同版本本地 broker。
- `createSurface(...)`：保留 deprecated alias，继续委托到 `createSpace`.
- `resolveDefaultSpace(brokerOptions?)`：显式公开默认 space 解析，而不是只把这个能力藏在协议里。
- `createTray(options, brokerOptions?)`：当未显式提供目标 space 时，使用默认 space 解析。

### Data Shape

- 公开返回值仍然是现有 `SpaceHandle` / `TrayHandle`。
- broker 连接继续由 handle 闭包持有，不引入新的全局 singleton。
- 默认 space 解析继续复用现有 `resolve-default-space` 协议帧。

### Architecture Shape

- 顶层 SDK 只是组合现有两个 atom：`connectLocalBroker` + `createClient`.
- 不把 daemon lifecycle 再抄一份到新模块。
- 不把 `webview` 或任何 ext 逻辑耦合进这次修复。
- 不把 `opentray-core` / Rust 内核为这个 JS 导出问题做任何特判。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | 当前 change 是现有承诺与已发布包的对齐修复。 | 直接推进。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| `createTray()` 第二参数是否需要继续支持历史上的 `surface` 位置参数 | 影响 API 形状与迁移成本。 | 先使用 object-based broker options，并支持 `space` 字段。 |
| 是否同时公开 `resolveDefaultSpace()` | README 已经承诺 default space resolution，但还没指定函数名。 | 公开它，避免把 default resolution 只做成隐式行为。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 只改 README，不改 SDK | 会继续让真实 npm 安装与文档不一致。 |
| 只把 `createSpace` 作为 `createClient().createSpace` 的文档示例 | 违背现有 spec 中“import public SDK from opentray”的主入口承诺。 |
| 为了这个 bug 改 Rust broker / protocol | 问题在 TypeScript facade，不在 runtime law。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: fresh npm install of the patched `opentray` line exports `createSpace` / `createTray`, README example matches the actual package surface, and smoke / daemon health continue to pass.
