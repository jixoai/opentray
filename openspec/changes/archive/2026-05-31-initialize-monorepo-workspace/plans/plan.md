# Intent Document

## Current Round

- Round: 1
- Status: Ready for initial monorepo setup
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

> 现在把项目使用monorepo结构来初始化好，使用packages/cli 来指向我们最终的 npm:opentray 这个包。
> 其它包直接用类似 packages/* -> npm:@opentray/* 这样的命名。把我们初步需要的包名全部初始化好，响应的package.json/README.md 都设计好
>
> 然后把AGETNS.md 编写好，它应该包含如何管理这个项目、这个项目的愿景 等等。
> 初始化完成后，做一次初始提交。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 在开始工作之前，把 `../agenter` 的 OpenSpec `vision-driven` workflow 复制到本项目使用。 | 先建立项目级 workflow，再开始初始化工作。 |
| 2 | User | 使用 monorepo 结构初始化项目；`packages/cli` 指向最终 npm `opentray` 包；其它 `packages/*` 使用 `@opentray/*` 命名；初步包名全部初始化好并设计 package.json/README.md；编写 AGENTS.md；完成后做初始提交。 | 交付范围包含 workspace、package manifests、README、AGENTS、OpenSpec evidence 和 git initial commit。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `SPEC.md` | 现有规格包含 Rust broker、Surface、Tray contribution、extensions、per-platform binary packages。 | 初始包名必须和平台法则一致，而不是只创建一个空 npm 包。 |
| `HANDOFF.md` | 项目定位为跨平台 Desktop Status Platform，不只是 tray library。 | AGENTS.md 和 README 需要表达愿景与边界。 |
| `openspec/schemas/vision-driven/` | 项目已安装 vision-driven schema。 | 本轮初始化应保留 plans/specs/tasks 的证据链。 |
| `/Users/kzf/.codex/git-committer.md` | OpenSpec work normally separates spec, implementation, archive commits. | 当前仓库还没有任何提交；本轮以用户要求的初始提交收束全部初始化。 |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Empty repository; initial commit will contain workflow artifacts and initialized project together. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Will be included in the initial commit because no baseline commit exists. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | To be produced before final commit if time permits. |
| Normal archive | Commit containing `openspec archive <change>` result | Not archiving during initial setup unless user requests. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/vision-driven-openspec-workflow/spec.md` | Intent document drives specs/tasks/review. | Reuse. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `npm:opentray` | The public package named `opentray`. | This must live at `packages/cli`. |
| `packages/* -> npm:@opentray/*` | Every non-cli package uses scoped npm naming. | Directory `packages/foo` maps to package name `@opentray/foo`. |
| `初步需要的包名全部初始化好` | Create the initial package surface before implementation. | Include core protocol, extensions, and platform binary package placeholders. |
| `AGETNS.md` | Project agent guide, likely `AGENTS.md`. | Create `AGENTS.md` at repo root. |
| `初始提交` | First git commit on `main`. | Commit all initialization artifacts once verification passes. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should roadmap extensions be initialized now? | `ext-island` is roadmap, not P0. | Initialize the package as a roadmap placeholder because user asked all initial package names. |
| Should root `HANDOFF.md` be tracked? | It is project context and currently untracked. | Include it in the initial commit unless user later says it is local-only. |

## Intent

### Surface Intent

Initialize OpenTray as a real monorepo with package names that already match the future npm distribution model.

### Underlying Drive

OpenTray is becoming a platform, not a single library. The repository must make package boundaries explicit from day one so future Rust broker work, TypeScript SDK work, native extension work, and per-platform binary distribution do not collapse into an ad-hoc package layout.

### Final Visible Effect

The operator can inspect the repository and immediately see:

- `packages/cli` publishes `opentray`.
- Every other workspace package publishes as `@opentray/<name>`.
- Package README files explain responsibility and boundaries.
- `AGENTS.md` records project vision, workflow, package laws, and verification expectations.
- The repo has a first commit containing the initialized platform skeleton.

## Platform Diagnosis

- Current platform laws: Surface-first Desktop Status Platform; broker-owned Surface entries; Tray contributions; extension-driven native capability atoms.
- Does this fit as a regular atom: Yes. This is a repository/package topology atom under the existing platform law.
- Does this require law upgrade: No runtime law change; it hardens the workspace law.
- Breaking update stance: Safe; repository has no baseline commit.
- User confirmations still required: None for package naming; user already provided the naming law.

## Reverse-Inferred Design

### Interface Shape

Root workspace uses pnpm workspace and Lerna metadata. Package manifests are intentionally publish-shaped but implementation-light.

### Data Shape

Package identity is durable:

- `packages/cli` -> `opentray`
- `packages/spec` -> `@opentray/spec`
- `packages/ext-webview` -> `@opentray/ext-webview`
- `packages/ext-badge` -> `@opentray/ext-badge`
- `packages/ext-island` -> `@opentray/ext-island`
- `packages/<platform>` -> `@opentray/<platform>`

### Architecture Shape

No package should depend on another package's internal file path. Public relationships are declared through package manifests and future exports.

## Intent-Driven Plan

- [x] 1. Research existing project files and copied vision-driven workflow.
- [x] 2. Write OpenSpec plan/spec/tasks for monorepo initialization.
- [ ] 3. Create root workspace files.
- [ ] 4. Create package manifests and README files.
- [ ] 5. Write AGENTS.md.
- [ ] 6. Validate workflow and workspace shape.
- [ ] 7. Create initial git commit.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should platform packages include empty `bin/` files now? | Empty binaries would be misleading. | Do not include fake binaries; README explains future binary ownership. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Put final npm package at `packages/opentray` | User explicitly required `packages/cli` -> npm `opentray`. |
| Delay AGENTS.md until implementation | User explicitly requested AGENTS.md now. |

## Exit Conditions

- Default max review iterations: 5
- Issue recurrence threshold: 2
- Custom exit condition from intent: initial commit exists and workspace skeleton is inspectable.
