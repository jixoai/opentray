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

> 我后面考虑到一个问题，因为我们采用这种分包的模式去分发二进制（核心+扩展），那么就会有一个问题，开发者可能用旧版的core去搭配新版的ext，或者用新版的core去搭配旧版的ext。
>
> 但是确实，很多时候，ext和core是独立编译分发的，这点你有什么建议吗？未来随着能力的稳定，这种问题可能就比较少出现了。但是我想知道，比如Linux的开源软件社区也经常遇到这种问题吧？最先进的管理理念是什么？
>
> 你的想法是好的，但是你的落地方案有很大局限性，peerDependencies 的引入只会增加心智负担。
>
> 我在想，如果我们把 npm-tag 用来作为 protocolVersion 呢？
> 这样意味着，我的依赖要么就是：
>
> ```
> opentray: "latest"
> opentray-ext-webview: "latest"
> ```
>
> 就是始终锁定某个 protocolVersion：
>
>   ```
>   opentray: "xxx-1-1"  // 而不是 "^0.2.4"
>   opentray-ext-webview: "xxx-1-1"
>   ```
>
> 比如 `http 1.0` 这种协议标准就可以翻译成 `http-1-1`
> 所以我们也得给我们的协议标准定一个名字和版本。未来可能会混入多种协议标准，不同的ext采用不同的协议标准
>
> 或者我们可以把 alpha作为一种稳定版本的扩展协议标准，"stable-1-0" / "alpha-1-0"
>
> ---
>
> 我的观念可能存在混乱和错误，但思路差不多表达到位了，你来融合总结，结合实际情况
>
> “stable-webview-1-0、alpha-lynx-1-0”？什么意思? 难道我们的core其实有耦合 webview/lynx的技术细节？或者说是协议细节？
>
> 我大概能理解，但是我困惑的是，为什么会出现这种选择题？
>
> 我想要的就是我跟 AI 说：发个版本，然后 AI 就基于当前代码的协议版本号，然后打包发布。使用者用 stable-1-0 就可以安装到最新的。
> 我跟 AI 说：发个 alpha 版本，AI 就基于当前代码的协议版本号，然后打包发布。使用者用 alpha-1-0 就可以安装到最新的。
> 我跟 AI 说：我们的协议版本要升级了，然后 AI 就基于升级协议版本号、更新 skills（使用者的 AI 才能知道要改 package.json 了）。然后 AI 后续会把相关的包都给升级了。
> 我们的协议版本有两个标识 stable-A-B，其中 stable-A-B 兼容 stable-A-(B-)，也就是说，core 如果是  stable-1-2，它是兼容 stable-1-1|0 的。
> 所以这也是 alpha 的意义，现在 alpha 上打磨协议和功能，稳定了在挪到 stable。
> 如果不得已要破坏性更新，我会发布 stable-2|3...

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | core 和 ext 可能独立发布，旧 core / 新 ext 或新 core / 旧 ext 需要有明确管理方式。 | 需要把兼容性规则从包版本猜测提升为显式协议线法则。 |
| 2 | User | `peerDependencies` 会增加心智负担，不是合适的主机制。 | 不能把跨包兼容性设计成 peerDependency 规约。 |
| 3 | User | 想用 npm tag 表达 protocolVersion，并且让 AI 基于当前代码的协议版本号打包发布。 | 需要把 install-time selector 设计成可由 source-of-truth 自动派生。 |
| 4 | User | 协议标准需要名字和版本，类似 `http 1.0 -> http-1-1`。 | 需要公开的 protocol family / line 语义，而不是只留数字版本。 |
| 5 | User | 想用 `stable-1-0` / `alpha-1-0` 作为协议线标签。 | 需要 channel + major + minor 的 dist-tag 语义。 |
| 6 | User | 质疑 `stable-webview-1-0` / `alpha-lynx-1-0`。 | 协议线必须保持 extension-agnostic。 |
| 7 | User | 想让 AI 在协议版本升级后更新 `skills`，从而知道要改 `package.json`。 | 需要把“线升级”写进 docs/skills 的发布规则。 |
| 8 | User | `stable-A-B` 兼容 `stable-A-(B-)`，例如 `stable-1-2` 兼容 `stable-1-1|0`。 | 需要明确 minor 递增的兼容窗规则。 |
| 9 | User | alpha 的意义是先打磨协议和功能，稳定后再移到 stable。 | alpha 和 stable 是同一协议线上的成熟度通道，不是不同产品协议。 |
| 10 | User | 如果必须破坏性更新，就发布 `stable-2|3...`。 | major bump 是破坏性边界，需作为显式线升级处理。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/spec/src/index.ts` | 目前已有 `OPENTRAY_PROTOCOL_FAMILY = "opentray-protocol"`，并且 `OPENTRAY_PROTOCOL_LINE_MAJOR/MINOR` 仍固定为 `1.0`，tag formatter/parser 只支持当前线。 | 说明 install-time protocol line 已存在，但还没有显式的 minor 演进语义。 |
| `packages/spec/src/index.test.ts` | 当前测试只证明 `stable-1-0` / `alpha-1-0` 和 extension-agnostic 拒绝逻辑。 | 新 change 需要把“兼容窗”从固定值升级为可演进规则。 |
| `scripts/npm/protocol-dist-tags.ts` | 计划器会为每个 public workspace package 生成同一个 tag，但 tag 来源是固定协议线常量。 | 需要把 tag source-of-truth 和 line bump 规则说清楚。 |
| `openspec/specs/release-pipeline/spec.md` | 现有 release law 已把 protocol-line tags 视为 install-time selectors，并且保留 OIDC 只负责 publish/stage publish 的边界。 | 这次变更只能扩展兼容语义，不能把 CI auth 假设改成能直接 mutate 任意 dist-tag。 |
| `openspec/specs/kernel-runtime/spec.md` | runtime handshake、endpoint identity、session isolation 仍然是 numeric protocol + package version law。 | 说明 this change 不应混淆 runtime 权威和 install-time selector。 |
| `openspec/specs/client-sdk/spec.md` | SDK 仍通过 same-version daemon 和 `protocolVersion` 进行 runtime gate。 | 需要保留“安装线”和“运行线”分离。 |
| `skills/opentray/references/getting-started.md` | 外部文档目前只教 `stable-1-0` / `alpha-1-0`。 | 需要把用户/AI 能理解的 line bump 规则补进去。 |
| `.agents/skills/develop-opentray/references/release.md` | 内部 release skill 已把 protocol-line tags 写成 current line law，但还只停在 `1-0` 例子。 | 这次要让内部开发者知道 protocol line 会升级，何时改 tag。 |
| `openspec/changes/define-opentray-protocol-line-dist-tags/**` | 上一个 change 已经把 tag 命名和 release/auth boundary 固化为 extension-agnostic law。 | 这次是对该 law 的演进，不是重开 extension-specific 命名争论。 |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending. This round is still research-plan only. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Pending user acceptance. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed right now. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/changes/define-opentray-protocol-line-dist-tags` | Current protocol-line law is extension-agnostic and uses `stable-1-0` / `alpha-1-0`. | Extend with major/minor evolution and compatibility windows. |
| `openspec/specs/release-pipeline/spec.md` | Release pipeline already separates trusted publishing from registry mutation. | Extend with line bump semantics, keep auth boundary unchanged. |
| `openspec/specs/kernel-runtime/spec.md` | Runtime protocol and daemon identity are already version-scoped. | Reuse; runtime authority stays numeric and separate. |
| `openspec/specs/client-sdk/spec.md` | SDK already auto-starts same-version daemon and exposes public consumer vocabulary. | Extend docs/skills to tell AI when install-time selectors need to change. |
| `.agents/skills/develop-opentray/references/release.md` | Internal release skill already teaches protocol-line tags and operator-auth tag mutation. | Extend with line evolution and bump rules. |
| `skills/opentray/references/getting-started.md` | External docs already present protocol-line install guidance. | Extend to explain `stable-A-B` / `alpha-A-B` progression. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “旧版 core 搭新版 ext / 新版 core 搭旧版 ext” | 跨包独立发布会产生兼容窗口。 | Core and ext must have a named compatibility line, not just semver coincidence. |
| “peerDependencies 的引入只会增加心智负担” | 不要把兼容性设计成 npm peer 负担。 | Do not make users solve compatibility through peerDependency bookkeeping. |
| “npm-tag 用来作为 protocolVersion” | 安装期选择器要来自协议线。 | Use dist-tags as compatibility selectors, not runtime authority. |
| “stable-1-0 / alpha-1-0” | channel + line version 的 tag 语义。 | Stable and alpha are maturity channels over one protocol line. |
| “stable-A-B 兼容 stable-A-(B-)” | 同一 major 内，minor 递增保持 backward-compatible line 语义。 | Newer minor lines stay compatible with earlier minors in the same major. |
| “AI 基于当前代码的协议版本号，然后打包发布” | 发布动作应由源码中的协议线 SSOT 驱动。 | The release bot should derive tags from source-of-truth line constants. |
| “更新 skills（使用者的 AI 才能知道要改 package.json 了）” | 文档/skills 必须告诉 AI 何时重写依赖选择器。 | Skills must teach when the install selector should move to a new line. |
| “stable-webview-1-0、alpha-lynx-1-0？” | 反对把扩展名写进 core 协议线。 | The line must stay extension-agnostic. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | This change is a law-and-doc evolution, not a runtime visual spike. | none |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should every minor line bump force an AI-visible `package.json` selector rewrite for affected packages, even if runtime handshake stays compatible? | This defines whether line bumps are release-facing only or also automation-facing. | Yes: the AI should rewrite selectors when the protocol line advances, so humans do not guess which closure to install. |
| Should `alpha-A-B` follow the same minor-compatibility rule as `stable-A-B`, or is alpha allowed to break more aggressively inside the same major? | This decides whether alpha is just a maturity channel or a separate compatibility regime. | Same rule: alpha is the same line with a less mature release channel. |
| Should the docs keep teaching `latest` as the default convenience path after this change, or should protocol-line tags become the default consumer recommendation? | This affects how strongly we steer consumers away from casual installs. | Keep `latest` as convenience, but make protocol-line tags the explicit compatibility path. |

## Intent

### Surface Intent

把 OpenTray 的安装期兼容性从“固定 `stable-1-0` / `alpha-1-0`”推进成“可演进的 `stable-A-B` / `alpha-A-B` 协议线”。用户和 AI 都能明确知道：现在装哪条线、什么时候升 minor、什么时候必须升 major。

### Underlying Drive

Core、official extension facade、platform binary atoms 都会独立发布。仅靠 semver 不能表达“它们实现同一条 OpenTray 协议线”，也不能表达“同一 major 内 minor 递增仍兼容”。这次 change 要把 install-time compatibility 变成一条可升级的公开法则，同时保留 runtime handshake、endpoint identity、dynamic ABI 作为最终权威。

### Final Visible Effect

当这个 change 正确时：

- 维护者能一眼看到当前协议线的 `major/minor`、channel 和安装标签是从同一组 source-of-truth 派生的。
- AI 在发版时知道该把公共包闭包标成哪条 `stable-A-B` / `alpha-A-B`，并知道什么时候该改 `package.json`。
- 使用者知道 `latest` 只是便利入口，而协议线标签才是“我要装一组彼此兼容的 OpenTray 包”的明确选项。
- 破坏性协议更新会显式升 major，而不是伪装成普通 patch 或 peerDependency 规则。

## Platform Diagnosis

- Current platform laws: runtime handshake is numeric and still owns authority; release pipeline uses trusted publishing plus operator-authenticated dist-tag mutation; existing protocol-line tags are extension-agnostic.
- Does this fit as a regular atom: partly. `@opentray/spec` helpers are regular atoms, but the line evolution rule is a platform-law upgrade.
- Does this require law upgrade: yes, the protocol line must now describe compatibility windows across minor versions.
- Breaking update stance: additive for the current `1.x` line; runtime protocol version stays separate until a later major break.
- User confirmations still required: none for the current intent round; only future decisions about CI-authenticated dist-tag mutation or protocol family renaming would need re-approval.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator or AI asks: “Ship the next OpenTray release.”

The visible result should be:

```bash
pnpm add opentray@stable-1-2 @opentray/ext-webview@stable-1-2
```

or:

```bash
pnpm add opentray@alpha-1-2 @opentray/ext-lynx@alpha-1-2
```

The selector itself tells the consumer that they are installing a whole compatible closure on a named protocol line, not a random semver guess.

### Interface Shape

- `@opentray/spec` continues to own the protocol family and line metadata.
- The protocol line must expose the current `major` and `minor`, plus helpers that can format, parse, and compare line tags.
- Release tooling must derive its `npm dist-tag add` plan from that single source of truth.
- Docs/skills must explain the difference between runtime protocol authority and install-time protocol-line selection.

### Data Shape

- `protocol family`: `opentray-protocol`
- `protocol line`: `major.minor`
- `release channel`: `stable` or `alpha`
- `dist-tag`: `<channel>-<major>-<minor>`
- `package version`: implementation and packaging version, still separate from protocol line
- `runtime protocol version`: wire/handshake authority, still separate from install-time line
- `compatibility window`: same major, newer minor lines remain backward-compatible with earlier minors

These facts must not be collapsed into one semver range or one runtime integer.

### Architecture Shape

- `opentray-core` and the daemon stay on runtime authority and session isolation.
- `@opentray/spec` should expose the protocol-line SSOT, not product-specific branches.
- Release tooling should plan tags, not invent compatibility logic locally.
- Internal skills should tell maintainers when a line bump means updating install selectors.
- External skills should tell consumers how to choose `latest` versus a pinned protocol line.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Move protocol-line tag mutation into CI-authenticated automation | This would change the current operator-authenticated registry mutation boundary. | Do not do it. |
| Rename the protocol family away from `opentray-protocol` | Public compatibility naming is sticky once released. | Keep `opentray-protocol`. |

## Intent-Driven Plan

- [ ] 1. Research the current line law and confirm the minor-compatibility boundary.
- [ ] 2. Write/update specs for `stable-A-B` / `alpha-A-B` line evolution and the same-major compatibility rule.
- [ ] 3. Add or adjust `@opentray/spec` helpers/tests so the current line can be formatted, parsed, and compared from one source of truth.
- [ ] 4. Update release tooling so tag planning follows the current line and clearly exposes when a line bump is required.
- [ ] 5. Update internal and external skills/docs so humans and AI know when a protocol line bump means rewriting `package.json` selectors.
- [ ] 6. Validate the change with targeted tests and OpenSpec checks, then self-review against the intent.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should older minor lines remain documented install targets after a newer minor line ships? | This affects how much historical compatibility the docs should encourage. | Yes, but the latest minor line should be the default recommendation. |
| Should the release helper surface an explicit “line bump” output in addition to the current tag plan? | This affects whether the AI gets a stronger cue for package.json rewrites. | Yes, if it can be done without inventing another release path. |
| Do we need a new public term for the line compatibility window, or is `protocol line` enough? | This affects how much terminology we introduce into skills and docs. | `protocol line` is enough for now. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `peerDependencies` as the compatibility mechanism | User explicitly rejected the mental model overhead. |
| Extension-specific protocol-line tags such as `stable-webview-1-0` | That leaks product names into the core release law. |
| Semver ranges as the cross-package compatibility contract | Semver describes implementation versions, not a named OpenTray protocol line. |
| Collapsing runtime handshake and install-time selection into one field | Runtime authority and install-time compatibility are different laws. |
| CI `npm dist-tag add` through trusted publishing OIDC alone | npm OIDC is not a general registry-mutation authority. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: the change must explain how a new `stable-A-B` / `alpha-A-B` line is derived, how older minors remain compatible within the same major, and how skills/docs tell humans and AI when to rewrite package selectors.
