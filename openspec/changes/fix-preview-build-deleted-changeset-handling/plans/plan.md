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

> 这个构建技术很重要，请优先完成，因为我们的目前主要的工作是测试 ext-webview，不能被lynx的构建影响
>
> 集中所有注意力，先把这个构建的问题按照我们的设计完整地解决(不要偷懒）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 先把构建问题完整解决，不要留下偷懒的边角。 | 已落地的 build law 还要做收尾级健壮性审视。 |
| 2 | Assistant review | 当前 preview workflow 在 push 包含 deleted `.changeset/*.md` 时，planner 会尝试读取已删除文件并失败。 | 需要补一条删除容忍 law，避免 changeset 生命周期噪音把 workflow 打穿。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `.github/workflows/preview-native.yml` | 当前 planner 输入来自 push diff 的 `.changeset/*.md` 路径列表。 | deleted 文件同样会进入这份列表。 |
| `scripts/binaries/preview-plan.ts` | planner 直接 `readFile` 每个 changed changeset。 | deleted 文件会导致 `ENOENT`，让 preview build 异常失败。 |
| `openspec/specs/build-pipeline/spec.md` | 已定义 changeset-gated preview build law，但还没有覆盖 deleted changeset 容忍。 | 这是 build law 的一个真实缺口，不只是实现细节。 |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/build-pipeline/spec.md` | Preview builds are triggered by changed changeset files and gated by explicit build markers. | Extend with deleted-file tolerance. |
| `openspec/changes/archive/2026-06-05-plan-changeset-gated-family-builds/specs/build-pipeline/spec.md` | The planner is the single law surface for family inference and job normalization. | Reuse directly; do not scatter this fix into workflow-only conditionals. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “完整地解决(不要偷懒）” | 不能只满足 happy path；要处理真实维护动作下的 failure mode。 | Finish the law, not just the demo path. |
| “测试 ext-webview，不能被 lynx 的构建影响” | preview build 需要稳定、可控、低噪音。 | WebView iteration must stay fast and deterministic. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | 这是 workflow/planner 健壮性修正，不需要单独 demo。 | none |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none | 当前修正不改变用户心智模型，只补稳定性。 | 直接实施。 |

## Intent

### Surface Intent

把已经落地的 changeset-gated family build 再补齐一个真实维护场景：push 中如果包含 deleted `.changeset/*.md`，preview workflow 不应该误把它当成可读输入，更不应该因此失败。

### Underlying Drive

用户要的是“可长期使用的构建法则”，而不是“一次成功的 preview 演示”。changeset 既是构建意图面，也是版本治理面，所以它天然会经历 rename、cleanup、delete。只要 preview planner 不能容忍这些生命周期动作，这套 law 仍然是脆的。

### Final Visible Effect

当这个修正完成后，操作者会看到：

- push 里即便包含 deleted changeset，preview workflow 也不会因为 `ENOENT` 失败。
- 如果还有一个 live changeset 携带 preview marker，planner 仍会正常解析并构建。
- 如果本次 push 只是在清理 changeset，workflow 会快速 no-op，而不是浪费 CI 或报错。

## Platform Diagnosis

- Current platform laws: preview build 由 changed changeset 驱动，planner 负责 family 解析与 job 归一化。
- Does this fit as a regular atom: Yes. 这是现有 build law 的常规健壮性补强。
- Does this require law upgrade: Small law extension only.
- Breaking update stance: No public API break; internal planner behavior becomes more tolerant.
- User confirmations still required: none.

## Reverse-Inferred Design

### Interaction / Visual Story

理想流是：

1. 维护者删除或整理一个 changeset 文件。
2. GitHub 因为 `.changeset/*.md` 路径变化而启动 preview workflow。
3. planner 看到 deleted path，会忽略不可读项。
4. 若没有 live marker，workflow no-op；若有 live marker，workflow 继续正常 family build。

### Interface Shape

- workflow changed-file collector 只传入仍有意义的 changeset 变更类型。
- planner 把“缺失文件”视为 non-authoritative input，而不是 hard failure。

### Data Shape

- `changedFiles`: push diff 中的 `.changeset/*.md` 路径列表。
- `live changeset`: 当前 checkout 中仍可读取的 changeset 文件。
- `deleted changeset`: 本次 push 中被删除、在当前 checkout 中已不存在的路径。

### Architecture Shape

- workflow 入口先过滤 deleted path，减少噪音。
- planner 仍负责最终容错，避免未来输入源变化时重现 `ENOENT` failure。
- 测试覆盖 workflow 入口和 planner 双层保护，防止只靠某一层偶然成立。

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | 当前变更只补健壮性。 | n/a |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| none | 当前范围封闭。 | n/a |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 只在 workflow 入口过滤 deleted file | 输入源一旦变化，planner 仍会再次脆断。 |
| 让 planner 对所有读文件错误都 no-op | 会吞掉真实损坏或权限问题，隐藏故障。 |

## Exit Conditions

- Default max review iterations: 1
- Issue recurrence threshold: 3
- Custom exit condition from intent: deleted changeset push no longer causes planner failure, and live marked changesets still resolve normally.
