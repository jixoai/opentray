# OpenTray ext-dialog / ext-sound 架构评审 R1

评审日期：2026-09-17  
评审范围：`93ce37c5`（`add-ext-dialog`）与 `d0e48d79`（`add-ext-sound`，当前 `HEAD`）  
评审性质：实现前架构裁决；不把 OpenSpec 文档通过等同于实现可行或原生验收通过。  
独立验证：`bun run openspec:vision -- validate add-ext-dialog` 通过；`bun run openspec:vision -- validate add-ext-sound` 通过；`git diff --check 93ce37c5^..d0e48d79` 通过。两个提交共新增 773 行文档/法则，未包含实现、构建图改动、原生二进制或体积证据。

## 1. 总评与结论

### 总结

两个 change 的能力边界和包命名基本符合 Owner 已裁决事项，且 `embedded` 的身份意图与现有动态扩展 ABI 方向一致。但目前仍是“设计意图已写出、协议和运行时闭环未落地”的状态，关键风险集中在：

1. dialog 的 deferred response 没有协议承载；现有 `ext-command` 是同步单响应模型。
2. Win32 模态 API 会阻塞负责处理 `EventLoopProxy` 传输事件的 Winit owner loop，现稿的“tray 继续派发”与现有线程拓扑冲突。
3. Win32 `PlaySound(NULL, SND_PURGE)` 是进程级停止，直接违反 sound 的跨 session 不误伤要求。
4. native build/release graph 仍只认识 runtime/webview/badge，没有四目标 embedded facade 的收齐矩阵、staging、manifest/hash 和 pack-size 证据链。
5. `libraryPath` 的包根 containment、typed artifact 错误分类、WAV 内容校验和 DTO 双平台编译门尚未形成可执行合同。

### 最终结论

| Change | 评分 | 结论 | 进入实现条件 |
|---|---:|---|---|
| `add-ext-dialog` | **4.0 / 10** | **NO-GO** | 先冻结 deferred-response 协议、Win32/macOS 模态调度方案、embedded staging/身份链和真机验收矩阵 |
| `add-ext-sound` | **5.5 / 10** | **NO-GO** | 先完成 dialog 批次 A 共享基建，再冻结 session-token 播放所有权、WAV 内容校验、sound catalog 和 release graph |

评分不是对文档质量的否定：sound 的 API 边界较小，所以高于 dialog；但两个 change 都不能以当前文档直接开始跨平台实现或归档。

## 2. P0 阻塞问题

### P0-1：dialog pending response 没有现有协议/transport seam

**证据与影响**

- `openspec/changes/add-ext-dialog/specs/dialog-extension/spec.md:3-11` 和 `plans/design-reference.md:147-154` 要求 show 命令在原生对话框关闭时才完成，并可在 session close 时以 cancel 语义完成。
- 当前 `ClientFrame::ExtCommand` / `ServerFrame::ExtCommandResult` 在 `crates/opentray-spec/src/protocol.rs:287-296,360-364` 中是一请求一响应模型。
- `crates/opentray-core/src/broker.rs:430-448` 在 `ext_command_with_host` 返回后立即生成响应；`crates/opentray-bin/src/main.rs:803-840` 随后写出 response 并进入事件 barrier。
- `packages/cli/src/local-broker.ts:321-339,414-419` 只会等待已带 `requestId` 的既有 response，不存在 deferred token、cancel、重连或“晚到 response”状态。

仅在 `opentray-ext-dialog` crate 中保存 pending 指针无法让 Node Promise 收到晚到结果，也无法防止同一 request 的早 ACK/晚 final 重复结算。

**修复建议与落点**

在 `openspec/changes/add-ext-dialog/specs/dialog-extension/spec.md` 与 `plans/design-reference.md §5` 之前新增协议设计章节，二选一并冻结：

- 推荐：增加通用 deferred command envelope，例如 `ExtCommandAccepted { requestId, operationId }`、`ExtCommandCompleted { operationId, result }`、`ExtCommandCancelled { operationId, reason }`，并在 `@opentray/spec`、Rust broker、Node `PendingRequest` 中实现明确状态机；或
- 若保留单一 response frame，则将 dialog 设计成 broker-owned request slot，允许 transport 在命令返回后按原 requestId 写最终 frame，并明确 request map 的“pending until final”状态、重复完成和连接关闭语义。

必须补充：同 session busy 的原子占用、session close 先撤销再完成、response-before-event barrier、连接关闭时 deferred Promise 的 typed rejection，以及 Node/Bun transport 测试。验证条件是一个命令在两个后续普通命令之间完成，且只结算一次。

### P0-2：Win32 模态泵会阻塞 Winit/EventLoopProxy 传输事件

**证据与影响**

- `add-ext-dialog` 设计在 `plans/design-reference.md:140-151` 和 spec `:71-85` 声明 `TaskDialogIndirect` / `IFileDialog::Show` 在 GUI STA 内运行，同时声称其它 tray 事件继续派发。
- 当前 broker 由 Winit owner loop 处理 transport/menu 事件（`crates/opentray-bin/src/main.rs:608-710,775-840`）；Windows named-pipe pump 线程只把 frame 转成 transport event（`crates/opentray-bin/src/windows_transport.rs:168-208`），真正 dispatch 仍回到 Winit loop。
- Win32 API 的系统 modal message pump 能处理窗口消息，但不会自动执行 broker 的 `EventLoopProxy` user event；因此“WndProc 存活”不等于其它 OpenTray 命令已被 broker 分派。

如果按现稿直接在 owner loop 调 `Show`，同 broker 的另一 tray、跨 app session、甚至 pending dialog completion 都可能停在 proxy 队列中，直接违反 spec。

**修复建议与落点**

在 `openspec/changes/add-ext-dialog/plans/design-reference.md §5` 和 `spec.md` 重写 Win32 拓扑，必须选择并证明一种方案：

1. 在 owner loop 使用真正可重入、非阻塞的 native dialog API/回调封装，把 UI 状态推进拆成 user events，并为 transport frame 与 dialog completion 建立统一 owner-loop 状态机；或
2. 将 dialog 放到专属 STA/UI 线程，所有输入经 broker owner loop 的消息代理进入，结果通过 `EventLoopProxy` 回传；同时证明 tray backend 的 HWND/notify icon 所属线程约束不会被破坏。

不能把“系统模态泵会继续派发窗口消息”当作 broker 事件证据。验收必须包含：dialog 打开期间同 app 另一 tray、另一 app session、普通 `set-menu`/`ext-command` 三类请求真实交错完成；捕获 transport/request 时间线而非只截图窗口。

### P0-3：macOS modal-session 步进没有 wake/affinity/teardown 合同

**证据与影响**

- `plans/design-reference.md:142-148` 只规定 `beginModalSession` / `runModalSession` 要集成 Winit `ControlFlow`，没有定义谁触发下一次 step、如何从 AppKit callback 唤醒 owner loop、窗口关闭和 session close 的竞态顺序。
- d19 设计事实明确：Winit loop 通过 `EventLoopProxy` 串行化 transport；AppKit/Wry callback affinity 在当前 checkout 未被证明，不能把同线程作为 ABI 前提。

若仅把 step 放在 `ControlFlow::Wait` 的普通 wake 中，可能永远没有下一次 wake；若由错误线程直接访问 AppKit/`Rc<RefCell>`，则出现崩溃或未定义 UI 行为。session close、用户关闭和 app teardown 还可能重复 resolve pending response。

**修复建议与落点**

在 dialog design §5 增加明确状态机：`Created -> Presented -> Stepping -> Dismissed | Revoked`，声明唯一 UI owner、`EventLoopProxy<UserEvent::DialogWake/Close>`、modal session token、一次性 completion CAS，以及退出前 `endModalSession` 顺序。补充 macOS 原生 probe：至少证明 modal step、普通 tray/menu frame、session close 和 broker exit 的交错次序；没有真机证据前，不得在 tasks 中把此项视为普通 crate 实现。

### P0-4：Win32 sound session close 会进程级误伤其它 session

**证据与影响**

- `add-ext-sound/plans/plan.md:20,32,39-41` 与 `design-reference.md:69-86` 承认 `PlaySound` 是进程级单声道，但仍要求 session close 只停止该 session 的播放、不得停止其它 session。
- `specs/sound-extension/spec.md:13-17` 把这两个要求同时冻结为 MUST。
- `PlaySound(NULL, SND_PURGE)` 没有 session 参数；任一 extension instance 调用都会停止当前进程所有 PlaySound 播放。

现稿会发生：A 播放，B 播放并按 Windows 语义取消 A，A session close 再调用 purge，停止 B；或者 A 当前播放、B 仅关闭时也误停止 A。两种都违反 owner tuple/session cleanup law。

**修复建议与落点**

在 `add-ext-sound/plans/design-reference.md §1.4` 和 spec Requirement 1 中冻结一个 `currentPlaybackOwner`/`playbackToken`：broker/native extension 只在关闭 session 持有当前 token 时执行 purge；若 token 属于其它 session，关闭不得 purge。新播放原子替换旧 token，并发取消语义要返回“accepted but prior owner superseded”的内部状态，不能把旧播放伪装成仍存活。若无法提供 token 级保护，则必须撤回“session close 只停止本 session”并把 Win32 能力改为 broker-wide stop，不能静默保留矛盾合同。测试至少覆盖 A/B 交错和关闭顺序四格。

### P0-5：扩展命令作用域无法表达 session ownership

**证据与影响**

- 当前 `ExtensionScope` 的命令 envelope 只有 `appId/trayId/ext`；session id 只在 broker cleanup 路径中存在。`crates/opentray-spec/src/ext.rs` 与 `crates/opentray-core/src/extension.rs:137-170` 没有把 session 传给 `ExtensionInstance::command`。
- dialog 要求 busy/cleanup 按 `(appId, trayId, sessionId)`，sound 要求 session close 只停止自己的播放；但两个 native extension 从 command 输入本身无法判断调用 session。
- 仅按 `(appId,trayId)` 存状态会把同一 app 的不同 caller session 合并，破坏 AGENTS 的 session-authoritative cleanup law。

**修复建议与落点**

在 `@opentray/spec` 的 `ExtensionEnvelope`/`ExtCommand` 传输中增加 host-owned `sessionId`（或由 broker 为每个 mount 传入不可伪造的 per-session handle），并让 `ExtensionInstance::command`、dynamic FFI host context、registry key 和 native state 使用它。extension 不得从用户 JSON 自报 session；broker 从连接/session owner 注入。补同 app 多 session、同 tray cleanup、重用 mount generation 的隔离测试，且在 session close 前先 revoke/cancel 再调用 extension cleanup。

### P0-6：dialog close/cancel 默认值在平台实现上不一致

**证据与影响**

- dialog 通用规则要求没有 `cancelId` 时标题栏/ESC/system dismissal resolve 到按钮 `0`（`design-reference.md:73-75`、spec `:19-27`）。
- Win32 `allowCancelOnClose` 的默认描述却是“cancelId 存在时 true”（`design-reference.md:111`）；TaskDialog 关闭在未启用 cancellation 时可能不产生可映射的 cancel response。
- `buttons=[]`、`defaultId/cancelId` 越界或重复的行为也尚未冻结；native 层若自行修正会造成跨平台结果差异。

**修复建议与落点**

在 dialog spec §1.2/§2.2 冻结：按钮非空；`defaultId`/`cancelId` 必须是合法索引；Windows 对所有可关闭对话框默认启用 cancellation，再统一映射无 cancelId 到 0；若平台无法观察关闭原因，返回 typed `dialog_dismissal_unavailable` 而不是伪造成功。为标题栏、ESC、系统关闭、session close 补 macOS/Windows 四路一致性测试。

### P0-7：embedded artifact 路径和身份链还没有安全闭合

**证据与影响**

- `plans/design-reference.md:160-177` 规定 `libraryPath` 相对 facade 根并 realpath；但当前 resolver（`packages/cli/src/native-extension-artifact.ts:102-142,320-336`）尚未有 embedded 分支，也没有包根 containment 约束。
- 直接 `join(dirname(packageJsonUrl), libraryPath)` 的实现会允许 `../../outside/library`，即使 realpath 可达也不再是 facade 自带 artifact。
- 当前 loader 身份校验（`crates/opentray-bin/src/dynamic_extension.rs`）要求 extension name、ABI、artifactSetVersion、contract fingerprint、target 全匹配；文档没有明确 embedded facade 版本、内嵌 bytes、构建证据和 manifest 的同一版本提交关系。

**修复建议与落点**

在 `packages/cli/src/native-extension-artifact.ts` 增加 `NativeExtensionEmbeddedArtifact` 分支和结构化错误类别：`target-unsupported`、`path-outside-facade`、`manifest-invalid`、`library-unreadable`。把 `packageJsonUrl` 转成 `fileURLToPath`，canonicalize facade root 与 candidate，再用 `relative(root, candidate)` 拒绝 `..`/绝对逃逸；校验 target key、文件扩展名/平台和 contract manifest。构建阶段记录每个目标的 SHA-256 与 embedded manifest，stage/pack 后重新 hash，loader 只接受同一 facade version/contract/target/build identity。补 adversarial traversal、symlink escape、替换 bytes、manifest skew 测试。

### P0-8：构建图没有四目标收齐矩阵、内嵌 staging 或身份证据链

**证据与影响**

- 当前 `scripts/binaries/native-build-graph.ts:20-31,129-176,347-399` 只认识 `runtime | webview | badge`；`artifacts.ts`、`stage-release-artifacts.ts:67-93` 也只处理既有 per-platform package 形态。
- `verify-native-plan`、release plan 和工作流没有 `dialog`/`sound` component，也没有把四目标产物拷贝到 `packages/ext-*/platforms/<target>/` 的收齐步骤。
- change 的 tasks 只在 `add-ext-dialog/tasks.md:29-32` 与 `add-ext-sound/tasks.md:26-28` 写“staging 到 platforms”，没有图节点、artifact manifest、缺目标失败或 facade pack 前置。

因此普通 npm install 无法从当前 release pipeline 得到文档声称的单包四目标库；即使手工复制文件，也不能证明 facade package version 与 native manifest version 一致。

**修复建议与落点**

在 `scripts/binaries/native-build-graph.ts` 增加 `dialog`、`sound` component 和 target capability matrix；每个目标生成 native inspector/manifest/hash evidence。新增 facade staging job：只有四目标（darwin-arm64/x64、windows-arm64/x64）全部匹配当前 facade version/contract fingerprint 时，才写入 `platforms/<target>` 并生成 manifest；缺目标、过期 target 或 hash 不匹配必须失败。同步 `release-plan.ts`、`verify-native-plan.ts`、`stage-release-artifacts.ts`、`.github/workflows/release.yml`、包 `files` 字段和测试。验证条件是从 clean checkout 执行 release dry-run，再用 `npm pack --dry-run` 解包并逐目标调用 resolver/loader identity check。

### P0-9：dialog/sound 的 typed 错误只写在 facade 叙述中，没有 broker/native 传播合同

**证据与影响**

- 当前动态扩展错误虽支持 structured detail（`crates/opentray-core/src/extension.rs:58-67`、`broker.rs:568-571`），但 `packages/cli/src/local-broker.ts:394-399` 只构造普通 `Error("code: message")`。
- 新 spec 要求 `dialog_platform_unsupported`、`dialog_session_busy`、`dialog_capability_unavailable`、`sound_not_found` 等可供调用者稳定区分；文档没有冻结错误 payload schema、哪些错误在 facade 前置、哪些由 native 返回、如何保留字段载荷（namespace/platform/name/attempted catalog）。

**修复建议与落点**

在 `@opentray/spec` 冻结错误 envelope `{ code, message, details }`，`details` 为 discriminated union；同步 Rust `ExtensionError::Detailed`、server error frame、Node typed error factory。明确 Linux/路径/WAV/平台 namespace 属 facade preflight，busy/capability/native-not-found 属 broker/native，并要求所有分支都在不改变状态前失败。为每个 code 添加 wire round-trip 和 facade `instanceof`/details 测试，禁止消费方解析人类 message。

## 3. P1 重要问题

### P1-1：comctl6 activation context 决策只有一句“broker manifest”

`add-ext-dialog/plans/plan.md:46` 和 `design-reference.md:145-156,203-222` 没有指定 `RT_MANIFEST` 资源、构建文件、scope（broker EXE 还是 extension DLL）、运行时探测及 packaged-exe 验收。裁决见 §4：manifest 绑定 broker EXE，TaskDialog 能力按真实 activation context 探测；不可用时只走 MessageBox，`taskDialog=false`，commandLink/expander typed reject。落点为 `crates/opentray-bin` 的 Windows resource/build 配置、dialog DTO 和 Windows native test。

### P1-2：体积基线是预期，不是证据

`design-reference.md:194-201` 与 sound `design-reference.md:102-107` 只有“远低于 2MB”估计。Owner 法则要求 npm-pack 压缩体积 `>=2MB` warning、`>3MB` fail，但当前没有真实四目标产物、压缩器版本、tarball bytes 或归档证据。必须在 Batch D 生成每包实际 `npm pack --dry-run` tarball/byte report，固定报告格式和 commit；2MB warning 要有 Owner split decision，3MB 立即切平台包。没有实测不能给 packaging GO。

### P1-3：DTO “darwin 编过即证明 win32”不是机械编译门

`design-reference.md:218-220`（dialog）和 sound `:99-100` 的说法与当前 cfg 分平台编译模型不成立。新增字段可能只在当前 target 编译到。应把能力 DTO schema 提到共享 `@opentray/spec`/Rust schema，加入 exhaustive serialization fixture；CI 明确执行 darwin 与 windows 两个 target 的 compile/type/test，不能以单一 target 代替。

### P1-4：Win32 WAV-only 不能只看扩展名

`add-ext-sound/design-reference.md:69-78` 与 spec `:45-53` 只要求非 `.wav` 前置拒绝。至少应做大小有限的 `RIFF`/`WAVE` header 检查、case-insensitive suffix、readability 和路径 canonicalization；伪装 MP3/截断 WAV 在 native call 前返回 `sound_format_unsupported` 或 `sound_file_unreadable`。落点为 facade preflight、fixture tests 和 Windows native negative test。

### P1-5：playSystemSound 的平台原生 miss 语义需可测

现稿要求“三步解析”但未冻结 native resolver 的成功判定：`NSSound(named:)` 可能得到对象但播放失败，Win32 `PlaySound(SND_ALIAS)` 的返回值和注册表别名可变。必须保留顺序：通用表 -> 平台原生名 -> typed miss，并定义“accepted”依据、attempted names/catalog details 和 broker.log 诊断。真机只把可闻性作为观察，不把听觉主观判断当唯一门；以原生返回值、日志和必然 miss 名称为门。

### P1-6：sound 对 dialog 批次 A 的依赖没有工程化

`add-ext-sound/plan.md:8,29,55-59` 与 tasks `:3-8` 只用文字依赖 dialog 批次 A；两个同波提交没有 CI dependency/check，容易并行实现或错误归档。应在 sound change 的 tasks/validation 中明确“shared embedded/pack-size base commit required”，在 release plan 中先验证 dialog A 的 resolver/pack script，再开放 sound；两 change 只能在共享基建与各自实现/验证均完成后一起归档。

### P1-7：OpenSpec check/self-review 产物未闭合

本轮仅验证了 `validate`；按仓库 vision-driven 流程，change 还需要 `check` 与 review/self-review artifacts。dialog tasks `:38` 明确要求 self-review md/html，sound tasks 没有对应条目。实现前应补齐两个 change 的 check、self-review、验证数字和偏差记录；不得把 validate 结构通过写成 Apply-ready。

### P1-8：dialog 选项语义仍有跨平台不确定项

`NSSavePanel allowsOtherFileTypes` 与 filters 交互仍留作“实测后议”（dialog plan `:47`）。必须在实现前冻结：空 filters、`allowsOtherFileTypes`、defaultExtension、save path 不存在、绝对路径 canonicalization 和取消结果，且为 macOS/Windows 各列 deterministic tests 与真机观察项。未知 namespace/字段必须在 facade 前置拒绝，不能依赖 native 忽略。

## 4. 开放问题裁决

### 4.1 sound 通用系统音名表集合与双平台映射

冻结 v1 仅三项：

| 通用名 | macOS | Windows |
|---|---|---|
| `notification` | `Glass` | `SystemAsterisk` |
| `warning` | `Sosumi` | `SystemExclamation` |
| `error` | `Basso` | `SystemHand` |

`default/info/question` 只属于 `beep(BeepKind)`，不进入 `playSystemSound` 通用 catalog，避免把 alert 分级和命名系统音混为一层。解析顺序固定为：通用表命中后直接投影；否则原样尝试当前平台 native name；失败返回 `sound_not_found`，details 至少含 requested name、platform 和 attempted mode/catalog。不得静默成功。

### 4.2 sound session-token 化播放停止

裁决：采用 `PlaybackToken { sessionId, generation, sequence }`，由 broker/native extension 维护当前 Win32 `PlaySound` owner。每次新播放原子替换当前 token，并按 Win32 进程级单声道规则取消旧播放；session close 只有在 token 仍归该 session 时才允许 `PlaySound(NULL, SND_PURGE)`。若当前 token 属其它 session，close 不得 purge。Darwin 维护 session-owned `NSSound` 实例集合，close 只 stop 自己的集合。这个 token 不是 Node-facing completion event，也不改变 fire-and-forget API。

### 4.3 playSound 播放前 WAV 内容校验

裁决：Windows facade 必须在 dispatch 前完成路径展开/canonicalize/readability、大小上限和 `RIFF` + `WAVE` header 检查；扩展名大小写不敏感但不足以证明格式。header 不匹配或文件截断返回 `sound_format_unsupported`；不可读返回 `sound_file_unreadable`。macOS 保持 NSSound 支持的有限格式矩阵，但仍需 readability/canonical path 检查。不能把校验推到 `PlaySound` 后再解释返回值。

### 4.4 dialog comctl6 activation context

裁决：Common-Controls v6 manifest 绑定 broker EXE 的 `RT_MANIFEST` 资源，不绑定 facade DLL；这样所有 dialog instances 共享同一个进程 activation context，且符合 broker 负责原生 GUI 组合的边界。构建时由 Windows resource/build step 写入 manifest dependency；运行时在 broker 启动后执行一次真实 TaskDialog capability probe，记录 `taskDialog`/`commandLinks`/`expander` DTO。探测失败时使用 MessageBox fallback，但 `buttonStyle: commandLink` 或 `expander` 必须 typed `dialog_capability_unavailable`，不得静默降级。需要 packaged broker 真机证据，不能只依赖 source build。

### 4.5 embedded 体积基线

裁决保持 Owner 阈值：对每个 embedded facade 执行真实 `npm pack`（不是仅统计原始 DLL），记录压缩 tarball 字节数、npm/pnpm 版本、四目标文件清单和 hash。`>= 2 MiB` 产生 CI warning，并在发布前记录 Owner 是否拆分；`> 3 MiB` 立即拆为 per-platform packages。当前文档的“远低于 2MB”只是假设，不能作为基线或 GO 依据。首次 release 必须把 ext-dialog 和 ext-sound 的独立实测报告写入 review/evidence artifact。

## 5. 综合评分依据

### `add-ext-dialog`：4.0 / 10，NO-GO

加分项：能力原子边界清楚；dialog 与 picker 合包符合 Owner 裁决；prompt、Linux native、page bridge、EventPort 完成事件边界明确；平台 namespace、DTO、embedded identity、pack-size 阈值和真机验收意图完整；与 d19 的“命令外事件才进 EventPort”边界一致。

扣分项：deferred response 与现有协议不相容且没有迁移设计；Win32 modal pump 与 Winit/EventLoopProxy 线程拓扑直接冲突；macOS modal step 缺 wake/affinity/teardown 细节；embedded resolver containment/typed error/构建收齐链未落地；comctl6 和体积仍是未经证实的默认假设。由于前三项任一项都会导致实现返工或运行时卡死，不能进入实现。

### `add-ext-sound`：5.5 / 10，NO-GO

加分项：能力面小且符合“优先保持轻量”；beep 独立包、fire-and-forget、Linux typed unsupported、Windows WAV-only 和 common/native sound 两级解析方向合理；没有引入完成事件或媒体引擎超集。

扣分项：依赖未工程化的 dialog 批次 A；Win32 `SND_PURGE` 与 session cleanup 合同矛盾；WAV-only 仅扩展名不足以满足前置格式边界；通用名表尚未冻结；shared staging/release graph、embedded identity、pack-size evidence 和双平台 DTO gate 未实现。sound 可在 dialog 批次 A 完成并按本报告裁决收敛后进入实现，但当前仍不能单独 GO。

## 实现前的最小解锁顺序

1. 先落地并验证 shared `embedded` resolver、containment、typed errors、四目标 staging、manifest/hash 和 pack-size audit。
2. 冻结并实现 deferred-response protocol；再做 dialog 的 macOS/Windows owner-loop/modal probes。
3. 完成 dialog facade/native/真机交错验收后，按 §4.1-4.3 实现 sound token/WAV/catalog。
4. 两个 change 分别完成 `check`、self-review、clean-pack evidence 和 changeset，最后再归档/发布。
