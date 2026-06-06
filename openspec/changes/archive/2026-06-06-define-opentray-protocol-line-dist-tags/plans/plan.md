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
> continue，撰写 change ，包含开发、测试、skills（面向内部开发者和外部使用者都需要）的更新。
>
> 如果没有问题就直接开始 apply

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 用 npm tag 表达协议版本，依赖可以选择 `latest`，也可以锁定某个协议版本 tag。 | 需要把 package semver 和 install-time protocol selector 分离。 |
| 2 | User | 需要给协议标准定一个名字和版本，类似 `http 1.0` -> `http-1-1`。 | 需要 OpenTray-wide protocol family/name/version，而不是只保留数字 `PROTOCOL_VERSION`。 |
| 3 | User | 可以有 `stable-1-0` / `alpha-1-0`。 | npm dist-tag 格式应先支持 channel + protocol version。 |
| 4 | User | 质疑 `stable-webview-1-0` / `alpha-lynx-1-0`，因为这暗示 core 耦合 webview/lynx。 | 禁止把 official extension 名称写进 core protocol-line tag。 |
| 5 | User | change 要包含开发、测试、skills，面向内部开发者和外部使用者。 | 不能只写 spec；要落到 `@opentray/spec`、release tooling、BDD tests、skills/docs。 |
| 6 | User | 如果没有问题就直接开始 apply。 | 当前架构方向已被用户接受，不需要再暂停提问。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/spec/src/index.ts` | 已有 `PROTOCOL_VERSION = 1`、`BrokerEndpointIdentity.packageVersion/protocolVersion`、endpoint/state root 按 package version + protocol version 隔离。 | Runtime isolation 已经存在；这次补的是 install-time selection law。 |
| `packages/spec/src/index.test.ts` | 已测试 protocol compatibility、endpoint identity、daemon health protocol metadata。 | 新协议线 helper 应直接放在同一个 public spec 包并补 BDD。 |
| `packages/cli/src/local-broker.ts` and `crates/opentray-bin/src/main.rs` | TS client 和 Rust daemon 都会传递/校验 numeric protocol version。 | Runtime handshake 仍然是最终权威，不应被 npm tag 替代。 |
| `openspec/specs/release-pipeline/spec.md` | 现有 release law 已要求 trusted publishing、changesets、alpha channel、native CI build、package bootstrap。 | 协议线 dist-tag 属于 release-pipeline law。 |
| `openspec/specs/extension-host/spec.md` | extension host law 明确 daemon/core 只知道 generic extension ABI 和 scoped dispatch。 | dist-tag 命名不能把 webview/lynx 产品语义引入 core。 |
| `.github/workflows/release.yml` | 当前 stable publish 使用 `changeset publish`，alpha publish 使用 `changeset publish --tag alpha --no-git-tag`。 | npm protocol line tags 需要在现有 channel law 上扩展，不能破坏 trusted publishing。 |
| npm Trusted Publishers docs | OIDC trusted publishing supports `npm publish` and `npm stage publish`; other commands such as `view` or `access` require traditional auth. | CI 不能假装无 token OIDC 可以自动 mutate `npm dist-tag add`。 |
| npm dist-tag docs | `npm dist-tag add <package>@<version> <tag>` is the registry operation for adding tags; publishing without `--tag` updates `latest`, publishing with `--tag` changes the initial tag. | `latest` convenience and `stable-1-0` protocol tag are two separate registry labels. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Skipped in this apply loop because user explicitly requested direct apply in one turn; artifacts remain in working tree for review. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending user acceptance |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/release-pipeline/spec.md` | changesets and trusted publishing own publish automation; alpha uses dist-tag `alpha`. | Extend with OpenTray protocol-line dist-tags and an explicit OIDC limitation. |
| `openspec/specs/broker-daemon/spec.md` | daemon is version-scoped by package version and protocol version. | Reuse; npm tag is not runtime state isolation. |
| `openspec/specs/client-sdk/spec.md` | TS SDK connects to same-version daemon and rejects unsupported protocol. | Reuse; SDK may expose protocol metadata helpers through `@opentray/spec`, but runtime handshake remains numeric. |
| `openspec/specs/extension-host/spec.md` | official extensions are runtime atoms behind generic ABI/host contracts. | Reuse; protocol-line naming must remain extension-agnostic. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “npm-tag 用来作为 protocolVersion” | 用 npm dist-tag 作为安装期兼容选择器。 | Install all OpenTray packages from the same protocol-line tag. |
| “protocol 标准定一个名字和版本” | 协议族和版本要成为公开法则。 | Name the OpenTray protocol line, not each extension. |
| “stable-1-0 / alpha-1-0” | channel + protocol version 的 dist-tag 格式。 | Stable/alpha are release maturity channels over the same protocol line. |
| “难道 core 耦合 webview/lynx?” | 扩展名进入 core 协议名就是架构污染。 | Core must not know extension protocol details. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | This change is a release/protocol law with pure helpers and CLI proof, not a visual runtime. | none |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| CI 是否允许使用 npm write token 仅做 `dist-tag add`？ | npm OIDC trusted publishing does not cover `dist-tag add`, so full automation requires a token or future npm feature. | Do not add a long-lived token to CI now; provide audited script and document operator-auth path. |
| `stable-1-0` 是否应更新所有 public packages, including platform atoms? | A protocol line must install a compatible closure, not just facade packages. | Apply tag to every public workspace package at its current compatible version. |

## Intent

### Surface Intent

把 OpenTray 的 npm 安装方式从“靠 semver 范围碰运气”升级为“可以选择同一条 OpenTray 协议线”。用户可以继续用 `latest` 追最新，也可以用 `stable-1-0` / `alpha-1-0` 把 `opentray`、官方扩展 facade、平台 binary atoms 锁在同一个协议兼容集合。

### Underlying Drive

分包分发带来一个物理问题：core、extension facade、platform dynamic library package 都可能独立发布。semver 只能表达某个包自己的实现版本，不能自然表达“这些包实现同一条 OpenTray 协议线”。协议线 dist-tag 是安装期的低心智选择器；runtime handshake 仍然是最终安全闸门。

### Final Visible Effect

当这个 change 正确时：

- 维护者能在代码里看到 OpenTray 协议族名、协议版本和 dist-tag 格式是公开常量，不是散落在 README 的字符串。
- 维护者能运行脚本生成或应用 `stable-1-0` / `alpha-1-0` 的 `npm dist-tag add` 计划。
- 外部用户文档会明确：`latest` 是便利入口，`stable-1-0` / `alpha-1-0` 是协议线锁定入口。
- 官方扩展文档会明确：extension package 必须跟 core 使用同一条 OpenTray 协议线 tag，但 tag 里不出现 `webview` / `lynx`。
- 如果安装期 tag 选错，runtime handshake 仍然 fail fast，而不是让不同 daemon/extension 状态混跑。

## Platform Diagnosis

- Current platform laws: daemon endpoint/state already isolate package version + numeric protocol; extension host is generic; release pipeline uses trusted publishing and changesets.
- Does this fit as a regular atom: partly. `@opentray/spec` helper is a regular atom, but release law needs an additive platform rule.
- Does this require law upgrade: yes, installation compatibility must become a named protocol-line law.
- Breaking update stance: no destructive runtime migration. This is additive during alpha.
- User confirmations still required: only if we later decide to put long-lived npm write token into CI for automatic post-publish dist-tag mutation.

## Reverse-Inferred Design

### Interaction / Visual Story

Install newest:

```bash
pnpm add opentray@latest @opentray/ext-webview@latest
```

Lock a protocol line:

```bash
pnpm add opentray@stable-1-0 @opentray/ext-webview@stable-1-0
```

Try alpha on the same OpenTray protocol line:

```bash
pnpm add opentray@alpha-1-0 @opentray/ext-lynx@alpha-1-0
```

### Interface Shape

- Runtime protocol remains `PROTOCOL_VERSION = 1`.
- Public protocol line is `opentray-protocol/1.0`.
- Npm dist-tag shape is `<channel>-<major>-<minor>`, currently `stable-1-0` and `alpha-1-0`.
- `latest` remains a registry convenience tag, not a protocol contract.
- Helpers live in `@opentray/spec` so core, CLI, release tooling, and extension packages can use one source of truth.

### Data Shape

- `packageVersion`: implementation version for daemon state isolation.
- `protocolVersion`: runtime handshake integer.
- `protocol line`: install-time compatibility family/version.
- `release channel`: maturity of published package set, e.g. stable or alpha.
- `dist-tag`: npm selector derived from release channel + protocol line.

These facts must not be collapsed into one semver range.

### Architecture Shape

- `@opentray/spec` owns protocol-line constants and tag parser/formatter.
- `scripts/npm/protocol-dist-tags.ts` owns workspace package tag planning and optional registry mutation.
- Release workflow may prove the tag plan, but must not rely on OIDC for `dist-tag add` because npm documents OIDC support for publish/stage publish only.
- Extension docs and skills consume the protocol-line law; extension names never appear in core protocol-line tags.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Add npm write token to CI for dist-tag mutation | This weakens the current no-long-lived-write-token release law. | Do not add it. |
| Rename protocol family from `opentray-protocol` | Public naming is sticky once published. | Use `opentray-protocol`. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement protocol-line helpers and npm tag planner.
- [ ] 5. Update internal and external skills.
- [ ] 6. Validate targeted tests and OpenSpec.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should CI mutate protocol-line tags automatically with a token? | Trusted publishing does not authorize `dist-tag add`; adding a token changes security posture. | No. Keep operator-auth script. |
| Should future minor protocol releases share daemon state? | This changes runtime endpoint/state isolation law. | No for current alpha; runtime still isolates by package version + numeric protocol. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `stable-webview-1-0` / `alpha-lynx-1-0` | It makes core/release law appear to know extension product protocols. |
| `peerDependencies` compatibility enforcement | User rejected it as extra cognitive load; runtime handshake is the true enforcement point. |
| Semver range as protocol selector | Semver belongs to implementation package versions, not cross-package protocol compatibility. |
| CI `npm dist-tag add` under OIDC-only trusted publishing | npm currently documents OIDC support for `publish` / `stage publish`, not arbitrary registry mutations. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: code exposes protocol-line constants/helpers; npm tag planner is tested; OpenSpec documents install-time vs runtime compatibility; skills teach both internal release rules and external install rules.
