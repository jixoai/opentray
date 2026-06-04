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

> 那么你整理一下，准备开始第三阶段的任务：
> 接手 ext-lynx.HANDOFF.md ；
> 讨论 ext-badge 是否应该独立存在还是应该合并到内核？或者说换一个名字？
>
> 1. 使用openspec vision推进
> 2. ext-badge 我们明天再讨论，今天晚上，你先把 ext-lynx 完全实现。可行性我已经替你验证过了。初步落地方案也不用讨论，直接开发落地即可

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 接手 `ext-lynx.HANDOFF.md` 并直接推进第三阶段。 | 研究分支和 handoff 资产是当前实现的起点，而不是重新探索。 |
| 2 | User | `ext-badge` 今天不讨论，今晚先把 `ext-lynx` 完全实现。 | 当前 change 聚焦 Lynx；badge 讨论不应挤占实现范围。 |
| 3 | User | 可行性已经验证过，初步落地方案也不用讨论，直接开发。 | 直接实现，不再停在方案比较。 |
| 4 | User | 明天早上要查收 `ext-lynx`。 | 必须给出真实可见的验收表面和发布结果。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `ext-lynx.HANDOFF.md` | macOS 研究已经证明 Lynx Explorer 可通过 `file://lynx?local://opentray-external/main.lynx.bundle` 动态加载外部 `.lynx.bundle`。 | 第三阶段不需要再证明可行性，应该把研究资产收口成官方 extension。 |
| `.worktree/xcodebuilder/.github/workflows/lynx-xcodebuild.yml` | GitHub Actions 已经证明可以用 Xcode + upstream Lynx 构建 `LynxExplorer.app.zip` 并上传 runtime artifact。 | Release CI 可以复用研究脚本构建 Lynx runtime sidecar。 |
| `.worktree/xcodebuilder/crates/opentray-lynx-window-cli/src/main.rs` | 已有稳定的 runtime 提取、bundle staging、launch URL、稳定窗口验证逻辑。 | 这些逻辑应迁入 `opentray-ext-lynx` 的 macOS runtime，而不是重写猜测版。 |
| `crates/opentray-bin/src/dynamic_extension.rs` | 动态扩展加载边界已经 generic，不需要为 Lynx 加 product branch。 | `ext-lynx` 是 regular atom，不需要污染 `opentray-core` 或 broker。 |
| `packages/ext-webview`, `crates/opentray-ext-webview`, `packages/ext-webview-darwin-*` | 当前官方 native extension 的三原子拆分已经成立：TS facade + cdylib crate + per-platform package atoms。 | `ext-lynx` 应复用同样的 package/ABI law。 |
| `.github/workflows/release.yml` | 现有 release workflow 只会为 daemon 和 WebView stage native artifacts。 | 第三阶段必须把 Lynx dylib 与 runtime zip 纳入 release staging。 |
| `research/lynx/README.md`, `research/lynx/app/*` | 仓库里已经有可构建的 Lynx bundle source，用于本地 smoke 与明早验收。 | 用户可见 smoke path 不需要虚构 bundle 生成器。 |

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
| `openspec/specs/extension-host/spec.md` | Official dynamic extensions own protocol parsing and runtime behavior; daemon stays generic. | Reuse directly. |
| `openspec/specs/webview-extension/spec.md` | Official native extension split is facade + platform dylib packages + visible smoke proof. | Reuse pattern, not protocol. |
| `openspec/specs/release-pipeline/spec.md` | Native release artifacts must be built in GitHub CI/CD and staged into npm packages. | Extend for Lynx sidecar runtime zip. |
| `openspec/specs/monorepo-workspace/spec.md` | Workspace package topology is explicit and package naming follows directory naming. | Extend to add Lynx package atoms. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| “第三阶段” | 第二个 concrete official extension，要验证这套可扩展架构不是只适配 WebView。 | Phase 3 is the first serious architecture proof beyond WebView. |
| “完全实现” | 不是 research 资产堆在 worktree，而是 repo 主线、OpenSpec、CI、package、demo 都要收口。 | Complete means implementation, packaging, release, and visible acceptance. |
| “明天早上查收” | 必须有真实能看到的 Lynx 窗口和可发布 package，而不是只给 unit test。 | Human-visible proof is mandatory. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `.worktree/xcodebuilder/crates/opentray-lynx-window-cli/src/main.rs` | How to extract `LynxExplorer.app.zip`, stage an external bundle, and launch the correct Lynx URL. | Migrate the reusable runtime logic into `crates/opentray-ext-lynx`; CLI binary itself does not belong on mainline package surface. |
| `research/lynx/app` | How to produce a real `.lynx.bundle` for local/human smoke. | Keep as research/demo source outside workspace packages. |
| `.worktree/xcodebuilder/scripts/research/lynx-xcodebuild-gha.sh` | How to build upstream Lynx runtime on GitHub Actions. | Migrate or adapt into mainline CI/release scripts. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none for first implementation pass | 用户已经明确要求直接开发，不再停留在方案讨论。 | 直接按 macOS-first official extension 落地。 |

## Intent

### Surface Intent

把 Lynx 从 research 资产变成一个正式的 OpenTray 扩展：用户可以安装 `@opentray/ext-lynx`，通过通用 extension host 加载它，传入一个 `.lynx.bundle` 路径，然后在 macOS 上看到真实 Lynx 窗口打开；同时 release CI 能构建并发布它所需的 darwin 平台包和 runtime sidecar。

### Underlying Drive

WebView 已经证明 “动态库扩展” 这条路可行，但 Lynx 会把这个架构压到更真实的边界：它不是一个轻量 dylib，而是一个带 `LynxExplorer.app.zip` sidecar 的 runtime family。如果这也能在不污染 core 的前提下作为官方 extension 成立，OpenTray 的扩展 law 才真正经得起验证。

### Final Visible Effect

明天早上用户看到的应该是：

- 仓库主线有 `ext-lynx` 的正式代码，而不是只剩 handoff/worktree 研究
- `opentray` CLI 有 Lynx 的 smoke/demo 入口
- 在 macOS 上，用真实 `.lynx.bundle` 可以打开 Lynx 窗口并关闭
- npm 上能拿到 `@opentray/ext-lynx` 与 darwin 平台包
- release workflow 会从 GitHub CI 产出 Lynx dylib 和 runtime zip，而不是依赖本地机器

## Platform Diagnosis

- Current platform laws: generic extension host + dynamic ABI + package-adjacent platform atoms + GitHub-built native publish artifacts.
- Does this fit as a regular atom: Yes. Lynx 是官方 extension atom，不需要 core product branch。
- Does this require law upgrade: No paradigm shift in core, but release/package law must expand from “single dylib artifact” to “dylib plus runtime sidecar zip” for a supported extension family.
- Breaking update stance: Prefer additive. New packages, new CLI smoke, and release workflow extension should not break existing public SDK behavior.
- User confirmations still required: none for the first implementation pass.

## Reverse-Inferred Design

### Interaction / Visual Story

开发者先有一个可运行的 `.lynx.bundle`。他安装 `opentray` 和 `@opentray/ext-lynx`，OpenTray 自动连上同版本 daemon，并通过通用 `load-ext` 路径加载 Lynx extension。调用 `show({ bundlePath })` 后，extension 自己解决 runtime sidecar、bundle staging、launch URL 和 child process lifecycle，屏幕上出现真实 Lynx 窗口。调用 `hide()` 或客户端退出后，窗口关闭。

### Interface Shape

- `@opentray/ext-lynx` 公开一个 platform-neutral facade，例如 `attachLynx(tray)`
- 第一阶段 Lynx command surface 只做真实已验证的动作：
  - `show({ bundlePath })`
  - `hide()`
- 事件以运行时生命周期为主，而不是假装有 WebView 那样的 JS bridge：
  - `shown`
  - `hidden`
  - optional process/runtime metadata event when useful for smoke/debug
- `opentray` CLI 增加 `smoke daemon-lynx`，支持显式 bundle path 输入

### Data Shape

- Client-owned payload: `.lynx.bundle` path
- Platform package-owned runtime sidecar:
  - `lib/libopentray_ext_lynx.dylib`
  - `runtime/LynxExplorer.app.zip`
- Runtime launch facts:
  - staged app dir
  - staged external bundle path
  - resolved Lynx launch URL
  - child process handle per active tray slot

### Architecture Shape

- `packages/ext-lynx`: TypeScript facade and typed public API
- `packages/ext-lynx-darwin-arm64`, `packages/ext-lynx-darwin-x64`: distribution atoms containing dylib + runtime zip only
- `crates/opentray-ext-lynx`: native implementation crate; owns command parsing, bundle staging, runtime extraction, spawn/kill lifecycle, and returned event shape
- `research/lynx/app`: stays outside the workspace package graph as the current demo bundle source
- Release CI:
  - darwin jobs build `opentray-ext-lynx`
  - darwin jobs build `LynxExplorer.app.zip` from upstream Lynx
  - release job stages both into Lynx platform packages before npm publish

Forbidden couplings:

- no `if ext == "lynx"` branch in `opentray-core` or broker dispatch
- no daemon-side Lynx protocol parser
- no fake Linux/Windows Lynx runtime claims when only macOS is proven

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none | 用户已经要求直接实现并在明早查收。 | 直接按 macOS-first 发布面推进。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| 是否需要首发 Linux / Windows Lynx 平台包 | 影响 CI 与 release 拓扑复杂度。 | 先发 darwin-arm64 / darwin-x64，其他平台保持显式 unsupported。 |
| 是否要把研究 bundle 作为包内 sample asset 一起发布 | 影响 facade package 与 smoke UX。 | 今晚不把 sample bundle 当成 publish blocker；smoke 接收显式 bundle path。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 把 Lynx runtime 直接并回 daemon binary | 这会破坏 extension atom 边界，无法证明通用扩展 law。 |
| 为了省事把 Lynx 当成 WebView 子模式 | 这是 product coupling，不是正交扩展。 |
| 今晚强行承诺 Linux / Windows visible runtime | feasibility 证据只覆盖 macOS，会把发布面做成假支持。 |
| 继续把研究 worktree 当作“已经完成的实现” | 用户要查收的是主线可发布产物，不是研究残留。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: macOS-first `ext-lynx` is implemented on mainline, local human smoke can launch a real `.lynx.bundle` through the generic extension path, release CI stages dylib plus `LynxExplorer.app.zip` into darwin platform packages, npm packages are published, and the change is archived cleanly.
