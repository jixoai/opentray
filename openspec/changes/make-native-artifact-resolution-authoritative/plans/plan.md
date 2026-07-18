# Intent Document

## Current Round

- Round: 1
- Status: All three artifact phases and consumer/repository verification pass; archive audit active
- Previous plan backup: none; this is the first current plan

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

> 但是 skill-creator-v2 可以我们协助，其它开发者总不能一个个来找我们协助吧。大家都认知就是 `pnpm install`，剩下就应该要能正确工作了。
>
> 我们opentray有什么改进的空间吗？

> create openspec change: `make-native-artifact-resolution-authoritative` ,then apply until archive the change.
>
> change goal: 按“精确解析 → extension manifest → broker identity”三个验收阶段推进。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `pnpm install` 后应直接正确工作，不能逐个协助消费者。 | zero-repair install contract 是产品完成边界。 |
| 2 | Agent diagnosis | 当前 broker 从 cwd/ancestor `node_modules` 选择第一个存在的 dylib，旧顶层平台包可遮蔽 pnpm virtual store 的正确包。 | 不能把搜索顺序或人工清理当作最终修复。 |
| 3 | User | 创建并执行本 change，按三个命名阶段推进直到 archive。 | 阶段、验收边界与工作流终点均已明确，无需额外确认。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-bin/src/dynamic_extension.rs` | discovery 先加入 cwd/ancestor `node_modules`，并加载第一个存在文件。 | Rust 正在重建包管理器拓扑，且没有兼容性选择。 |
| `packages/cli/src/client.ts` | `TrayExtension` / `load-ext` 只有 `name`, `path`, `mountId`。 | facade 无法表达解析起点、精确 artifact 或期望身份。 |
| `crates/opentray-spec/src/ext.rs` | ABI 只要求版本、init、command、session cleanup、deinit、free。 | ABI 兼容不能证明 extension 命令契约或构建身份兼容。 |
| `packages/cli/src/daemon/lifecycle.ts` | 活 PID 直接产生 `already-running`。 | 同 endpoint 的旧 broker 不会因 artifact 改变而替换。 |
| `openspec/specs/extension-host/spec.md` | discovery 必须 explicit/auditable，broker 必须保持 generic。 | 新设计必须强化通用 loader，不能加入 WebView 特判。 |
| `openspec/specs/packaging-plugin/spec.md` | manifest 是 staged artifact 定位权威。 | runtime 安装图也应由显式 artifact identity 驱动。 |
| `openspec/specs/kernel-runtime/spec.md` | endpoint 当前由 caller package/protocol identity 派生。 | 需要升级 reuse law，但不把 extension identity塞进 endpoint。 |
| `skill-creator-v2` live diagnosis | broker 为当前版本，实际 dylib 是遗留旧版本；显式当前 dylib 后 hide/show 恢复。 | 精确 artifact 是已验证因果变量。 |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | pending |
| Normal archive | Commit containing `openspec archive <change>` result | pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | not expected |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/extension-host/spec.md` | Generic C ABI, auditable discovery, official runtime ownership inside dylib. | Extend discovery into authoritative resolution and compatible selection. |
| `openspec/specs/client-sdk/spec.md` | SDK auto-starts caller-scoped broker and hides daemon operations from normal use. | Extend normal-use guarantee to artifact resolution/replacement. |
| `openspec/specs/broker-daemon/spec.md` | caller/version-scoped state, single writer, idempotent start. | Extend idempotence from PID liveness to artifact identity. |
| `openspec/specs/kernel-runtime/spec.md` | protocol/package endpoint identity and init gate. | Extend ready/init evidence with broker artifact identity. |
| `openspec/specs/release-pipeline/spec.md` | CI builds and stages real native artifacts into package atoms. | Extend packed-artifact verification with embedded identity equality. |
| archived `ship-native-binaries-and-webview-platform-packages` | Rust discovery added package-root scanning for pnpm layouts. | Replace package topology reconstruction; retain platform atoms. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `pnpm install`，剩下就应该正确工作 | zero-repair install contract | 正常安装就是完整产品路径。 |
| 其它开发者总不能一个个找我们 | consumer-independent operability | 不依赖项目作者介入或本机知识。 |
| 精确解析 | package-manager-authoritative artifact resolution | Node 从 facade 真实依赖闭包解析精确平台包。 |
| extension manifest | embedded extension artifact identity | dylib 自证名称、ABI、契约、目标与构建。 |
| broker identity | broker artifact identity | SDK 能判断当前 PID 是否就是本次安装解析出的 broker。 |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| change-local install fixtures, created during apply | 遗留顶层包能否再遮蔽 facade-relative 当前包？ | migrate into permanent tests; no throwaway demo retained |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| 是否保留旧 `TrayExtension.path` / ABI 的兼容分支？ | 双轨会继续允许 identity-free 加载。 | 不保留；用户与项目均要求破坏性收敛。 |
| mismatch 是失败还是继续找候选？ | 只失败仍会让 orphan 文件阻断正常安装。 | 对显式精确路径立即失败；对诊断候选记录拒绝并继续，最终聚合错误。 |
| extension identity 是否进入 endpoint？ | extension 是 session 后加载的多个 atom。 | 不进入；broker identity 负责进程复用，extension manifest 负责逐次加载。 |

## Intent

### Surface Intent

OpenTray 的消费者完成正常包管理器安装后，tray 与 native extension 必须直接工作；消费者不需要理解 broker、dylib、pnpm virtual store、环境变量覆盖或重启顺序。

### Underlying Drive

把运行时正确性从“路径碰巧命中”升级为“每个 artifact 都有可验证身份”。OpenTray 应承担跨包管理器解析、native contract 校验和旧 broker 替换的全部复杂度，让 `createTray()` / `tray.extend(...)` 继续保持小 interface。

### Final Visible Effect

```text
developer
   |
   +-- package manager install
   `-- pnpm dev / node app.js
               |
               v
         tray + native extension work

No cache cleanup. No manual broker restart. No OPENTRAY_EXT_PATH.
```

发生损坏或恶意替换时，开发者看到一个可执行的结构化错误，明确列出 expected/actual identity 与被拒绝路径，而不是 `returned code 1`。

## Platform Diagnosis

- Current platform laws: tray-first; caller-owned App; session authority; generic extension ABI; extension-owned native runtime; per-platform distribution atoms.
- Does this fit as a regular atom: implementation stays in generic SDK resolver, generic ABI/loader, daemon lifecycle, and package verification atoms.
- Does this require law upgrade: yes. “auditable discovery” upgrades为“package-manager-authoritative resolution + embedded identity verification”。
- Breaking update stance: replace identity-free `path` and ABI surface directly; no aliases or old-symbol fallback.
- User confirmations still required: none. The user named all three acceptance stages and the archive endpoint.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
facade descriptor
      |
      v
Node resolve relative to facade package
      |
      v
exact library path + expected identity
      |
      v
broker reads embedded identity -- mismatch --> structured reject
      |
    match
      v
init + commands

existing broker PID
      |
      v
ready artifact identity == resolved broker identity ? reuse : bounded replace
```

### Interface Shape

- `TrayExtension` declares a platform-neutral native artifact descriptor, not a bare package path.
- The Node SDK resolves one exact platform package relative to the declaring facade and sends an exact library path plus expected identity through `load-ext`.
- The dynamic ABI exposes a required generic manifest symbol and a structured error payload contract.
- daemon start accepts an expected broker artifact identity and returns `already-running` only when ready metadata matches it.

### Data Shape

```text
ExpectedExtensionArtifact
|-- extensionName
|-- artifactSetVersion
|-- contractFingerprint
|-- target { os, arch }
`-- resolvedLibraryPath

EmbeddedExtensionManifest
|-- extensionName
|-- abiVersion
|-- artifactSetVersion
|-- contractFingerprint
|-- target { os, arch }
`-- buildIdentity

BrokerArtifactIdentity
|-- packageVersion
|-- target { os, arch }
|-- executableHash
`-- buildIdentity
```

Artifact-set identity proves a coordinated npm closure. Contract fingerprint proves the facade/native command contract. Build identity diagnoses same-version staging mistakes. Hash proves the executable selected for this start.

### Architecture Shape

- `packages/cli`: deep Node artifact resolver and broker lifecycle identity validation.
- `packages/spec` / `crates/opentray-spec`: generic wire/ABI identity types only.
- `crates/opentray-bin`: exact-path loading, embedded identity validation, structured generic diagnostics.
- `crates/opentray-ext-*`: own extension-specific fingerprint value and export generic manifest/error symbols.
- release tooling: inject/verify artifact-set/build identity and inspect packed tarballs.
- forbidden: extension command parsing in broker, WebView branches in core, Rust package-manager directory reconstruction on the normal path, consumer cleanup instructions as product flow.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| None | User explicitly requested destructive end-to-end apply through archive. | Continue through all three phases and archive only after proof. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement Phase 1: exact artifact resolution.
- [x] 5. Implement Phase 2: embedded extension manifest and structured rejection.
- [x] 6. Implement Phase 3: broker artifact identity and automatic replacement.
- [x] 7. Prove package-manager install closures, native behavior, release artifacts, and full repo gates.
- [ ] 8. Self-review against intent, resolve every finding, archive, and validate the archived state.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| How should third-party extensions derive fingerprints? | Must be usable without OpenTray product-specific tooling. | Publish a generic helper/schema; descriptor supplies an opaque fingerprint. |
| Should explicit file overrides bypass identity? | Bypass would recreate undiagnosable skew. | No; override changes location only, never expected contract. |
| Should candidate fallback remain on normal package path? | Rust fallback weakens package-manager authority. | No; normal facade path is exact. Candidate lists remain only for explicit diagnostic/custom discovery. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Tell consumers to delete `node_modules` or clear pnpm store. | Violates zero-repair install contract. |
| Reorder Rust candidates so nested package wins. | Encodes another package-manager guess and remains vulnerable to other stale layouts. |
| Compare only adjacent `package.json` versions. | A correctly versioned npm shell can still contain a stale native binary. |
| Bump only global ABI version. | C calling compatibility is not an extension command-contract identity. |
| Put extension fingerprint in broker endpoint. | A broker can host multiple extension atoms loaded after connection. |
| Keep old `path` and new descriptor paths together. | Creates a permanent identity-free escape path and doubles testing. |

## Exit Conditions

- Default max review iterations: 3
- Issue recurrence threshold: reopen any phase after one reproduced contract failure; stop archive after three review loops only if a human decision is required
- Custom exit condition from intent: archive only after all three named phases pass their BDD seams, a clean temporary consumer install works without override/cleanup, code review has no unresolved findings, and the full vision-driven check passes
