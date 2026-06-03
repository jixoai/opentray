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

> 而且我纳闷的是，一定得用 LynxExplorer.app 作为载体吗？不能向 ext-webview-* 一样直接编译出单体二进制吗？
>
> 同意，使用openspec vision推进这个任务

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | 质疑 `LynxExplorer.app` 是否必须存在，要求判断是否可以像 `ext-webview` 一样做成单体扩展产物。 | 本 change 不能只修代码，要重新定义 Lynx runtime carrier law。 |
| 2 | Assistant | 结论是 `LynxExplorer.app` 不是法则，只是当前借用的上游载体；中期更合理的是 OpenTray 自有最小 host app。 | 进入“自有 host app 替换 Explorer”方向，而不是继续 patch Explorer。 |
| 3 | User | 同意该方向，并要求使用 OpenSpec Vision 推进。 | 直接产出新 change 的 intent/spec/task，而不是继续口头讨论。 |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `research/lynx/upstream/lynx/platform/darwin/macos/BUILD.gn` | 上游单独构建 `libLynx.dylib` 与 resource bundles，而不是只暴露 `LynxExplorer.app`。 | 说明 Explorer 不是唯一载体，Lynx runtime 与宿主 app 可以拆开思考。 |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/BUILD.gn` | `LynxExplorer.app` 本质上是把 `libLynx.dylib`、资源、宿主窗口代码、NativeModule 注册代码打成一个 macOS app bundle。 | 说明当前 sidecar 的“app 形态”有客观原因，但 app 名称和宿主实现不必绑定 Explorer。 |
| `openspec/specs/extension-host/spec.md` | 官方扩展 law 要求 runtime ownership 留在 extension artifact，不在 daemon/core。 | 新 runtime host 仍然必须是 extension-owned atom，而不是回流到 broker。 |
| `openspec/specs/lynx-extension/spec.md` | 当前规格仍把 runtime sidecar 表述为 Lynx Explorer。 | 需要更新规格，把“Explorer”改为“OpenTray-owned Lynx runtime host app”。 |
| `openspec/specs/release-pipeline/spec.md` | 当前 release law 仍要求构建和 stage `LynxExplorer.app.zip`。 | 需要把 release law 一并改成新的 runtime artifact 名称和来源。 |
| `scripts/release/build-lynx-runtime.sh` | 当前构建脚本通过 patch upstream Explorer 源码来产出 runtime zip。 | 现状过于依赖上游 app 壳，不利于长期维护和架构证明。 |

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
| `openspec/specs/extension-host/spec.md` | Extension runtime ownership belongs to the extension artifact, not the daemon. | Reuse directly. |
| `openspec/specs/lynx-extension/spec.md` | Lynx currently stages a runtime sidecar app and launches it with a Lynx-local URL. | Extend. Replace the carrier identity from Explorer to OpenTray-owned host app. |
| `openspec/specs/release-pipeline/spec.md` | Native release artifacts must come from GitHub CI and be staged into platform packages. | Extend. Rename and rebuild the Lynx runtime artifact under the new host law. |
| `openspec/changes/add-lynx-window-controller-and-fit-content/*` | Lynx window-controller work already assumes ext-owned host bridge and sizing policy. | Reuse. The new host app must preserve that public capability law. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `scripts/release/lynx-runtime-patches/ViewController.mm` | Which host responsibilities OpenTray currently injects into the borrowed Explorer shell. | Migrate the owned logic into OpenTray runtime-host sources; stop treating this patch file as the long-term source of truth. |
| `research/lynx/upstream/lynx/platform/darwin/macos/*` | Which reusable Lynx runtime artifacts exist below the Explorer app shell. | Keep as upstream dependency evidence. |
| `research/lynx/upstream/lynx/explorer/darwin/macos/lynx_explorer/*` | Which Explorer-only UI shell pieces we should stop depending on directly. | Use only as reference while replacing the host, not as the product carrier. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| none for planning start | 用户已经同意“自有最小 host app”方向。 | 直接按 OpenTray-owned host app 推进。 |

## Intent

### Surface Intent

把 `ext-lynx` 的 macOS runtime carrier 从“借用并 patch 上游 `LynxExplorer.app`”升级成“OpenTray 自有的最小 Lynx host app”，同时保持 extension ABI、tray-scoped lifecycle、window controller、fit-content、CI-built platform package 这些 law 不变。

### Underlying Drive

当前 `LynxExplorer.app` 路线证明了可行性，但没有证明 OpenTray 真正拥有自己的 Lynx runtime atom。只要宿主 app 仍然是 Explorer，架构上就还是“借来的壳”。要验证 OpenTray 扩展 law 是否足够稳，必须把“谁拥有宿主层”也收回来。

### Final Visible Effect

最终用户看到的是：

- `@opentray/ext-lynx-darwin-*` 仍然提供 dylib + runtime zip
- runtime zip 不再是 `LynxExplorer.app.zip`，而是 OpenTray 自有命名和源码维护的 host app
- `opentray smoke daemon-lynx` 的用户体验不倒退
- `navigator.window` / `navigator.opentrayWindow`、fit-content、frameless toggle 等已落地能力继续可见
- release CI 在 GitHub Actions 上构建并 stage 新 runtime host，而不是依赖本地或长期 patch Explorer

## Platform Diagnosis

- Current platform laws: extension ABI generic, runtime ownership extension-owned, native artifacts CI-built, visual acceptance mandatory.
- Does this fit as a regular atom: Yes. 这是 Lynx extension family 的 carrier refactor，不需要 core 范式转移。
- Does this require law upgrade: Yes, but only in the Lynx runtime-carrier law. “借用上游 app 壳”需要升级为“自有 host app 源码与产物”。
- Breaking update stance: Public package names may stay stable, but the runtime artifact identity and build path are intentionally breaking internal implementation details.
- User confirmations still required: none for planning start.

## Reverse-Inferred Design

### Interaction / Visual Story

开发者仍然安装 `opentray` 和 `@opentray/ext-lynx`，仍然传入 `.lynx.bundle`，仍然看到一个 Lynx 窗口出现。变化点不在外部交互，而在 carrier ownership：这个窗口不再来自一个长期 patch 的 `LynxExplorer.app`，而是来自 OpenTray 自己的最小 runtime host app。也就是说，用户看到的行为不退化，但系统底层 ownership 更干净。

### Interface Shape

- `@opentray/ext-lynx` facade 继续保持：
  - `show(...)`
  - `hide()`
- `navigator.window` / `navigator.opentrayWindow` 公共词汇继续保持。
- 平台包继续提供两个 artifact kinds：
  - `lib/libopentray_ext_lynx.dylib`
  - `runtime/<OpenTrayLynxRuntime>.app.zip`

### Data Shape

- Durable runtime artifact:
  - OpenTray-owned macOS app bundle zip
  - bundled `libLynx.dylib`
  - bundled Lynx resources / `icudtl.dat`
  - OpenTray-owned host bridge code
- Per launch:
  - staged app dir
  - staged external bundle path
  - launch URL
  - child process slot keyed by tray

### Architecture Shape

- `crates/opentray-ext-lynx`
  - still owns command parsing, staging, spawn/kill lifecycle, event shape
- new repo-owned host source root
  - recommended path: `native/lynx-runtime-macos/`
  - owns `AppDelegate`, `ViewController`, host-window bridge, app bundle metadata, and packaging inputs
- `scripts/release/build-lynx-runtime.sh`
  - still the canonical build entry
  - but its job changes from “patch Explorer and zip it” to “build OpenTray runtime host app and zip it”
- darwin platform packages
  - keep the same package topology
  - swap runtime zip payload and naming

Forbidden couplings:

- no Lynx-specific branch in `opentray-core`
- no direct dependency on Explorer app sources as the product carrier
- no in-process broker-owned Lynx runtime regression just to avoid a sidecar app
- no local build authority for release artifacts

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| none for planning | 用户已经同意该方向。 | 直接按 OpenTray-owned host app 推进。 |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| 新 host app 的最终文件名是否要直接用 `OpenTrayLynxRuntime.app` | 会影响 package artifact 名称、CI 命令、用户调试路径。 | 默认使用 `OpenTrayLynxRuntime.app`。 |
| 是否同时保留临时 Explorer compatibility build path | 影响迁移节奏和 CI 复杂度。 | 不保留双轨太久，优先切主路径。 |
| `native/` 是否应成为非 Rust 原生宿主源码的统一根目录 | 影响后续其它 runtime host 的归档位置。 | 默认建立 `native/` 作为此类源码根目录。 |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| 长期继续 patch `LynxExplorer.app` | ownership 不干净，维护面会持续绑定上游 app 壳。 |
| 把 Lynx runtime 塞回 daemon/broker 进程 | 违反 extension-owned runtime law，并削弱 crash/upgrade 隔离。 |
| 把 Lynx 强行做成 `ext-webview` 式的纯 dylib in-process runtime | 理论可行，但当前资源/宿主复杂度远高于 WebView，不值得作为现阶段主线。 |
| 只改文档名字，不改 carrier 源码归属 | 这只是命名漂白，不是架构收口。 |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: `ext-lynx` 的 runtime carrier 已从 borrowed Explorer shell 迁移为 OpenTray-owned host app，平台包和 release CI 使用新 artifact，用户可见 smoke 不退化，变更可归档。
