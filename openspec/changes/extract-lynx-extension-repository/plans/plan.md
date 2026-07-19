# Intent Document

## Current Round

- Round: 1
- Status: research-plan ready; implementation is blocked until this artifact is committed.
- Previous plan backup: none; this is a new change.

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

> 主仓库移除 Lynx的构建，改成 jixoai/opentray-ext-lynx 新的子仓库来独立作业。
>
> 使用 terra 模型跑subagent 完成所有的迁移工作。开始之前你需要先做好代码提交。
>
> 子仓库迁移好后，我会来配置trusted publishing。所以你就按照最佳实践去规范化 opentray-ext-lynx 仓库即可。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Lynx construction must leave the main repository and operate in `jixoai/opentray-ext-lynx`. | Treat the split as an ownership boundary, not a conditional build toggle. |
| 2 | User | A Terra subagent must perform the migration, and work starts from a committed baseline. | Commit this plan before deleting or moving product code; delegate the migration as one bounded execution. |
| 3 | User | Trusted Publishing will be configured later by the user. | Prepare normalized package metadata, changesets, workflow permissions, and release dry-run surfaces without mutating npm publisher configuration. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `crates/opentray-ext-lynx`, `packages/ext-lynx`, `packages/ext-lynx-darwin-*` | Lynx facade, native ABI, and macOS distribution atoms are currently in the workspace. | These atoms move together to preserve the extension contract. |
| `native/lynx-runtime-macos`, `native/lynx-patches`, `scripts/release/build-lynx-runtime.sh` | The runtime carrier and upstream patch/build graph are Lynx-specific. | They belong to the new repository and must not remain in the core release graph. |
| `scripts/binaries/*`, `.github/workflows/{release,preview-native,verify-native-artifacts}.yml` | Release planning, native staging, and CI explicitly enumerate Lynx atoms. | Main-repository planner and workflow must become Lynx-free. |
| `openspec/specs/lynx-extension/spec.md`, archived Lynx changes | Existing behavior and ABI contracts are documented already. | Reuse the behavior contract in the new repo while replacing workspace ownership. |
| `Cargo.toml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.changeset/config.json` | Workspace membership, path aliases, dependency graph, and fixed release groups include or imply Lynx. | The split is incomplete unless all graph projections are cleaned. |
| `git ls-remote https://github.com/jixoai/opentray-ext-lynx.git` | Target GitHub repository does not exist yet. | The migration must create and initialize the repository before pushing its history. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing this `plans/plan.md` before product-code work starts | Pending this commit |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not started |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not started |
| Normal archive | Commit containing `openspec archive extract-lynx-extension-repository` result | Not started |
| Abnormal handoff | Commit containing handoff evidence before returning to user discussion | Not expected |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/lynx-extension/spec.md` | Lynx owns parser, runtime lifecycle, macOS carrier, and explicit unsupported paths. | Reuse in the new repository. |
| `openspec/specs/release-pipeline/spec.md` | Native atoms are planned from package truth and Lynx runtime is Darwin-scoped. | Break the main-repo ownership; preserve the rule inside the new repo. |
| `openspec/specs/monorepo-workspace/spec.md` | Direct `packages/*` names map to public package names. | Reuse for the new extension monorepo. |
| `.agents/skills/develop-opentray-ext/references/{boundaries,platform-packages,verification}.md` | Facade, platform package, native crate, and artifact verification are separate concerns. | Reuse as the normalization standard. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “主仓库移除 Lynx的构建” | The core repository must not compile, stage, package, or publish Lynx. | Remove Lynx from the core build and release graph. |
| “新的子仓库来独立作业” | Lynx has an independent source, CI, package, and release lifecycle. | The extension repository owns all Lynx-specific work. |
| “规范化” | Use standard OpenTray extension atoms and release practices. | Make metadata, scripts, tests, CI, and package boundaries boring and repeatable. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/examples/debug-runtime-lynx.ts` | Does the consumer-facing Lynx smoke path still launch a published extension? | Migrate the relevant consumer recipe to the new repo or a documented external fixture; remove from core. |
| `scripts/binaries/launch-lynx-smoke.ts` | Can the source-tree Lynx carrier be exercised? | Migrate with the extension repository's acceptance tooling. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should the new repository be public and use `main` as its default branch? | Repository visibility and branch shape affect the initial push and release workflow. | Public `jixoai/opentray-ext-lynx`, default `main`, because the user supplied a GitHub organization/repository target and will configure publishing. |
| Should the new repository pin `opentray-spec` by Git revision or publish it as a crate? | A copied protocol type would permit silent ABI drift. | Pin a known OpenTray Git revision first; do not duplicate protocol definitions. |

## Intent

### Surface Intent

Move all Lynx-specific construction and publication out of OpenTray core into `jixoai/opentray-ext-lynx`, while leaving generic extension ABI, loader, runtime, WebView, Badge, and core package atoms in the main repository.

### Underlying Drive

Lynx has a costly and platform-specific carrier build. Keeping it in the core workspace couples every OpenTray release and preview to a separate runtime product. The desired product boundary is an independently releasable official extension whose package closure remains compatible with the generic OpenTray protocol.

### Final Visible Effect

An OpenTray core checkout installs, builds, verifies, and releases without downloading or compiling Lynx. A separate extension checkout contains one obvious command path for facade tests, macOS native artifacts, carrier construction, packed-consumer validation, and future trusted publishing configuration. Operators can tell which repository owns a failure and no longer wait for unrelated Lynx jobs during core releases.

## Platform Diagnosis

- Current platform laws: generic extension dispatch is already capability-neutral; official native extensions use facade/platform/native atoms; native CI artifacts are staged at publish time.
- Does this fit as a regular atom: yes, as an official extension repository split. No kernel paradigm shift is required.
- Does this require law upgrade: repository/release ownership must be explicit, and the shared `opentray-spec` dependency must have a non-copying boundary.
- Breaking update stance: remove Lynx workspace membership and core examples/scripts; do not leave compatibility shims or dormant Lynx build switches.
- User confirmations still required: none to begin; repository visibility/branch and spec dependency are recorded as defaults.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
Core release request
        |
        v
generic OpenTray packages only ----> no Lynx build jobs

Lynx release request
        |
        v
opentray-ext-lynx checkout
  facade + native dylib + carrier zip
        |
        v
packed consumer / macOS smoke / future trusted publish
```

### Interface Shape

The public facade remains `@opentray/ext-lynx`; platform atoms remain `@opentray/ext-lynx-darwin-arm64` and `@opentray/ext-lynx-darwin-x64`. The native crate continues to load through OpenTray's generic extension ABI. No Lynx-specific API is added to `opentray`.

### Data Shape

The new repository owns package manifests, contract fingerprint, native library, runtime carrier zip, Lynx bundle assets, and release metadata. The OpenTray core repository owns only the generic protocol and the published dependency that the facade peers against. Build outputs remain generated and are never committed.

### Architecture Shape

```text
opentray (core)                         opentray-ext-lynx
  @opentray/spec  <--------------------  git/tag dependency
  generic loader                         @opentray/ext-lynx
  generic TrayHandle.extend              @opentray/ext-lynx-darwin-*
  WebView / Badge                        opentray-ext-lynx crate
  core release CI                        Lynx carrier + Lynx CI/release
```

The new repository must not import private core packages. The core repository must not retain Lynx-specific parser, runtime, staging, smoke, release-plan, workflow, or workspace entries.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Trusted Publishing setup | It changes external npm/GitHub publisher state. | Prepare workflow and dry-run checks only; user configures it later. |
| First npm publish | It creates public registry state. | Do not publish from this migration. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks in the new repository and clean the core repository.
- [ ] 5. Self-review against intent, verify both repositories, and archive the change.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| How should `opentray-spec` be consumed from the independent Rust workspace? | It controls protocol drift and publishability. | Pin the source Git revision and document the upgrade procedure. |
| Which Lynx smoke fixture is the canonical consumer path after extraction? | The old CLI example cannot remain in core. | Keep an extension-repo smoke command and a minimal consumer recipe in its README. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep Lynx in the core workspace behind a release flag | It still couples dependency installation, lockfiles, CI, and release planning to Lynx. |
| Copy `opentray-spec` into the extension repository | Duplicate protocol definitions can silently diverge from the core ABI. |
| Leave compatibility placeholder packages/scripts in core | The requested boundary is destructive and explicit; dormant aliases preserve the coupling. |
| Publish from the migration agent | Trusted Publishing and public registry mutation are explicitly deferred to the user. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2 consecutive reviews for the same unresolved boundary issue
- Custom exit condition from intent: core `pnpm run build`/`verify` and strict OpenSpec checks pass with no Lynx build/package/release references; the new repository has a clean package graph, independent native/CI/release surfaces, and a documented trusted-publishing handoff.
