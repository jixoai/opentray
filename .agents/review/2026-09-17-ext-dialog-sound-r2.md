# OpenTray ext-dialog / ext-sound 架构评审 R2

评审日期：2026-09-17

评审基线：`82981086`（相对 `82981086^`，文档变更 `+540/-139`）；R1：`.agents/review/2026-09-17-ext-dialog-sound-r1.md`。本轮审查当前 OpenSpec 文本、现有 protocol/core/bin/SDK/FFI 真实接缝；没有把任务清单的承诺当作已经存在的运行时能力。

## 1. 总评与裁决

| change | R2 评分 | 裁决 | 结论 |
|---|---:|---|---|
| `add-ext-dialog` | **5.0 / 10** | **NO-GO** | R1 的平台行为、打包目标和测试意图已大幅收敛；但 generic deferred 协议尚不能穿过现有同步 FFI/owner-loop/transport，不能进入原生实现。 |
| `add-ext-sound` | **6.2 / 10** | **NO-GO** | v1 catalog、WAV 前置边界、PlaybackToken 方向与批次依赖已收敛；仍依赖未闭合的 dialog 批次 A，且 Win32 alias 的非阻塞/不静默与 token 线性化未冻结。 |

`bun run openspec:vision -- validate add-ext-dialog` 与 `add-ext-sound` 均通过。两者 `check` 均失败：缺 `review/self-review.md`、`review/self-review.html`。`git diff --check 82981086^..82981086` 也失败，原因是 commit 新增的 R1 报告第 3--5 行尾随空白；本评审不改写已提交的 R1 产物。

## 2. R1 闭合台账

| R1 项 | R2 状态 | 依据 |
|---|---|---|
| P0-1 deferred response | **未闭合，见 P0-1** | 增加了三帧名称和状态机愿景，但缺 generic native completion ABI、operation 路由与 terminal 结果语义。 |
| P0-2 Win32 modal pump | **部分闭合，见 P0-2** | 禁止 owner-loop modal、STA 与时间线验收正确；单 STA 的 cross-session 模型及 FFI 回传未定义。 |
| P0-3 macOS modal stepping | **部分闭合，见 P0-2** | 状态、CAS、teardown、probe 前置均正确；ext crate 仍没有触发/接收 `UserEvent::DialogWake` 或 owner-loop poll 的 generic 接缝。 |
| P0-4 `SND_PURGE` 跨 session | **部分闭合，见 P0-4** | 引入 `PlaybackToken` 与四格用例；没有把 token 与实际 `PlaySound` 调用线性化，也没覆盖 `SND_ALIAS`。 |
| P0-5 host-owned sessionId | **未闭合，见 P0-3** | 文字要求注入 sessionId，但现有单 session broker/单 tray owner 与 registry/load route 未给出可实行的多 session 拓扑。 |
| P0-6 close/cancel | **设计闭合** | 非空 buttons、索引拒绝、win32 默认 cancellation、`dialog_dismissal_unavailable` 已在 dialog design §1.2/§2.2 与 spec Requirement 中冻结。仍须在实现验收四路 dismissal。 |
| P0-7 embedded containment/identity | **部分闭合，见 P0-5** | traversal/symlink containment 和四类错误明确；替换 bytes/build identity 没有可验证的 runtime 身份输入。 |
| P0-8 four-target staging | **部分闭合，见 P0-6** | 组件、矩阵、release dry-run 目标已列；当前验收写成不可解包的 `npm pack --dry-run`，没有实际 tarball/hash closure。 |
| P0-9 typed errors | **部分闭合，见 P0-7** | 三侧同构是正确目标；没有冻结 wire `details` union、terminal operation errors 与 Node typed factory 的具体映射。 |
| P1-1 comctl6 | **设计闭合** | broker EXE `RT_MANIFEST`、启动 probe、MessageBox fallback、capability reject 已明确。 |
| P1-2 pack-size baseline | **部分闭合，见 P0-6** | 阈值和证据字段正确；实际 pack/unpack 证据命令矛盾。 |
| P1-3 DTO 双目标门 | **未闭合，见 P1-1** | design/tasks 写双 target gate，两个 living spec 仍错误声称“交叉编译 darwin 会发现 win32 投影缺失”。 |
| P1-4 WAV 内容校验 | **部分闭合，见 P1-2** | 不再只看扩展名；大小上限及 RIFF 结构/截断判定尚未冻结。 |
| P1-5 system sound accepted | **部分闭合，见 P0-4** | accepted/details/log 已写；win32 flags 仍可阻塞或错误回退默认音。 |
| P1-6 sound 批次依赖 | **设计闭合** | sound `tasks.md:4-11` 将 dialog A 的落地与测试绿作为实现门，并规定同波归档。 |
| P1-7 check/self-review | **未闭合，见 P1-3** | 新增任务不能替代当前缺失产物；两 change 的实际 `check` 仍为红。 |
| P1-8 picker 选项语义 | **部分闭合，见 P1-4** | defaults 已写入 design；living spec 未覆盖关键选项，save non-existent path 的 canonicalize 定义仍冲突。 |

## 3. P0 阻塞问题

### P0-1：deferred envelope 没有可穿过 dynamic-extension FFI、broker 和连接 writer 的完成通道

**证据**

- dialog design §5.1 只定义 `Accepted { requestId, operationId }`、`Completed { operationId, result }`、`Cancelled { operationId, reason }`（`openspec/changes/add-ext-dialog/plans/design-reference.md:143-162`）。
- 现有 Rust/TS `ServerFrame` 只有 `ExtCommandResult { requestId, events }`，所有响应都靠 requestId 结算（`crates/opentray-spec/src/protocol.rs:360-389`；`packages/spec/src/index.ts:574-617`）。`LocalBrokerConnection` 收到第一个 requestId response 即删除 pending entry（`packages/cli/src/local-broker.ts:414-419`）。
- native extension 的唯一命令 ABI 是同步 `opentray_ext_command(instance, *const ExtHostContext, envelope, out_events)`；返回后 `HostCallContext` 已失效（`crates/opentray-bin/src/dynamic_extension.rs:33-44,442-483,802-816`）。而 EventPort Law 明令不允许保留/调用这一 scoped context，且 dialog 又正确地排除 EventPort 作为 completion channel。
- broker owner loop 只有 `Transport/Menu/Tray/ExtensionEventsReady/...` user event，异步完成没有类型、registry、owner-session writer 路由或 output ordering 的落点（`crates/opentray-bin/src/main.rs:557-577,696-716,924-960`）。
- `Cancelled` 不带结果，却要求 session-close 的 `messageDialog` resolve cancelId、picker resolve null（dialog spec `:15-19`；design `:204-207`）。generic Node transport 无法由 `{operationId, reason}` 得出 extension-specific result。

**影响**

按当前文字实现会落入三种错误之一：native STA/main-thread callback 保存悬空 `ExtHostContext`；完成帧无法安全写回原连接；或 `Cancelled` 被当作 rejection，违反“与用户取消不可区分”。这是 R1 P0-1 的根因仍在，而不是测试数量不足。

**裁决与最小修复**

先在 **dialog 批次 A** 冻结通用 `DeferredOperation` 主模型，再允许 dialog crate 开工：

1. `@opentray/spec` 新增完整 server frame 和 parser schema，operation 必须由 broker 生成且携带不可伪造的 `(sessionId, instanceGeneration, operationId)` 归属。Accepted 保留 requestId；terminal frame 必须带 operationId 和明确的 typed terminal payload。若 API 要把 session close 当用户取消，terminal payload 必须携带 extension result；否则将取消冻结为 typed rejection，禁止两种语义混用。
2. 以新的**可选、版本化 DeferredCompletionPort**（或等价新 ABI symbol）连接 native extension 到 broker composition。它只能提交 host-issued opaque operation handle 与 bounded terminal payload；不得复用 scoped `ExtHostContext`，不得伪装成 EventPort event。端口在 instance/session revoke 前关闭，重复/错 owner/旧 generation 终结必须无状态丢弃并留下诊断。
3. `NativeBrokerApp` 持有通用 operation registry，收到 port completion 后由 owner loop CAS 结算，并仅向仍匹配的 transport session writer 投递 terminal frame；明确 terminal-before-same-operation-event barrier。连接已经断开时，Node `markDead` 以结构化 `dialog_transport_closed` 拒绝本地所有 operation，broker 不承诺向已关闭 socket 写 `Cancelled`。
4. 扩展 Rust/TS protocol version、所有 exhaustive switches、Node/Bun deterministic test：accepted 后两普通请求、重复 terminal、completion/Exit race、disconnect before/after accepted、旧 generation completion、wrong session completion。

**落点**：`openspec/changes/add-ext-dialog/plans/design-reference.md §5.1/§7.5`、dialog living spec Requirement 1；随后 `crates/opentray-spec/src/protocol.rs`、`packages/spec/src/index.ts`、`crates/opentray-core/src/{broker,extension}.rs`、`crates/opentray-bin/src/{main,dynamic_extension}.rs`、`packages/cli/src/{local-broker,client}.ts`。

### P0-2：两平台 modal 调度仍没有 generic owner-loop callback 合同；Win32 单 STA 还与 cross-session accepted 语义冲突

**证据**

- macOS 文本要求 ext-dialog 的 AppKit callback 发送 `EventLoopProxy<UserEvent::DialogWake>`（design §5.2，`:170-181`），但 `UserEvent` 是 `opentray-bin` 私有 enum，动态 DLL ABI 不暴露 proxy（`crates/opentray-bin/src/main.rs:557-577`）。现有 FFI host 仅有 `send_event/get_rect/invoke_host`，其 lifetime 只限本次 command（`crates/opentray-spec/src/ext.rs:85-113`）。
- win32 规定 per-broker 单一 STA（design §5.3，`:183-197`），同时 §5.4 和 living spec 要求跨 session show/picker 可 accepted（`:201-203`；`spec.md:31-35`）。第一个 `TaskDialogIndirect`/`IFileDialog::Show` 在唯一 STA 阻塞期间，第二个只能排队或嵌套：排队不满足 §5.1 “Accepted = dialog presented”，嵌套又没有 reentrancy、close、COM interface/thread affinity 合同。
- `DynamicExtensionInstance` 对 raw native instance 作了 `unsafe impl Send`（`crates/opentray-bin/src/dynamic_extension.rs:284-299`），当前设计没有声明 AppKit objects 永不随 instance 移动，也没有说明 STA worker 与 FFI instance/teardown 的 join/close 顺序。

**裁决与最小修复**

P0-1 的 DeferredOperation 设计必须同时提供一个 broker-owned、extension-agnostic **owner-loop poll/wake capability**：extension 只能登记 opaque operation；broker 在 owner thread 用 versioned FFI `poll_owner(operation)`（或等价机制）驱动 macOS `runModalSession`，并由 broker 自己投递/合并 wake。不得让 DLL 命名或持有 `UserEvent`/`EventLoopProxy`，也不得把 modal tick 偷渡为 EventPort。

Win32 必须二选一并改写 spec：

- 采用每个活动 `(appId,trayId,sessionId)` 一个有界 STA worker，worker 只拥有自己的 COM dialog/HWND，关闭请求也通过该 STA dispatcher 处理；或
- 保留单 STA，但把 Accepted 的含义改为“已登记、可能排队”，新增 Presented state，并放弃“跨 session 调用立即呈现”的暗示。

本评审裁决前者更符合当前 cross-session Requirement；须冻结 worker 上限、presentation ACK、`WM_APP` close dispatcher、join timeout 和 broker shutdown 顺序。无论选择哪种，移除或证明 `ExtensionInstance: Send` 对 AppKit instance 的移动安全性；更稳妥的是把 UI-affine 实例限制在 owner-thread registry，不以 `unsafe impl Send` 作为隐含保证。

**落点**：dialog design §5.2--§5.4、dialog Requirement “modal SHALL NOT stall”；`crates/opentray-spec/src/ext.rs` 新 versioned ABI、`crates/opentray-bin/src/{main,dynamic_extension}.rs`、未来 `crates/opentray-ext-dialog/{macos,windows}`。macOS probe 任务 3.1 应移至此协议完成之后，且探针必须覆盖 owner wake starvation 和 exit race。

### P0-3：host-injected sessionId 的目标与当前运行时 session/registry 拓扑不相容，隔离场景不可执行

**证据**

- 当前 native broker 明确只服务一个初始化 caller session；第二连接被 `OPENTRAY_BROKER_SINGLE_SESSION` 拒绝（`crates/opentray-bin/src/main.rs:744-773`）。
- kernel 将 tray owner 固定在 `(appId,trayId) -> sessionId`（`crates/opentray-core/src/kernel.rs:271-315`），并在 `ExtCommand` 前强制该 owner（`:329-344`）。因此 living scenario 的“one app and tray mounted by two caller sessions”（dialog spec `:31-35`）不可能在当前 broker/session 法则下成立。
- 扩展 registry 仍按 `(AppId, String)` 存 instance，`load-ext` 和 `ExtensionRegistry::register` 没有 sessionId 输入（`crates/opentray-core/src/extension.rs:126-159`）；当前 ExtensionEnvelope scope 也没有 sessionId（`crates/opentray-spec/src/ext.rs:232-247`）。design §5.5 仅陈述“升级”，没有决定 load/lookup/cleanup 的实际 key 或是否改变单 session broker law。

**裁决与最小修复**

不得把 sessionId 加进 client JSON 或让 extension 自报。先由 Owner/implementation 选择并冻结 host 模型：

- 保持 caller-scoped单 session broker（当前法则）：删除同 broker “same tray, two sessions”场景，改为同 session 多 tray/多 mount isolation；跨进程 broker 不承诺共享 native state。sound 的 `SND_PURGE` 风险则是同一 broker 内的所有已加载 mount/operation，而非不存在的第二 caller session。
- 若产品确实要 shared broker multi-session：这是独立 runtime change，先修改 connection admission、tray ownership、load/mount registry、writer routing 和 lifecycle law；完成后再允许 dialog/sound 依赖它。

在任一模型中，extension command ABI 必须取得 broker-injected `CommandScope { appId, trayId, sessionId, instanceGeneration }`，registry 和 deferred operation key 使用它；`LoadExt` 的 session ownership、session close/reload revocation 都要有真实集成测试。

**落点**：dialog design §5.5 与 Requirement 2；若保留现有 runtime，改写 dialog/sound 的 cross-session scenarios、tasks 3.4/6.1；若扩展 runtime，先独立 OpenSpec change 覆盖 `crates/opentray-bin/src/main.rs`、`opentray-core::{kernel,extension,broker}`。

### P0-4：sound 仍可能阻塞或静默错误音，PlaybackToken 也未与 Win32 实际调用线性化

**证据**

- design 将 win32 platform-native name 写为 `PlaySound(SND_ALIAS)`（`openspec/changes/add-ext-sound/plans/design-reference.md:48-67`），而同一 change 要求所有调用不阻塞 native UI/transport（sound spec `:3-11`；design `:126-131`）。缺少 `SND_ASYNC` 时 alias 播放的默认同步行为可以阻塞 owner loop。
- 缺 `SND_NODEFAULT` 时 Windows 对未知 alias 可回退默认系统音；native bool 成功不再表示“请求的 name 被接受”，违反 `sound_not_found` 和绝不静默/错误回退要求。
- PlaybackToken 只说“原子替换”（design `:90-98`），没有规定 token swap、`PlaySound` 调用和失败路径在哪一把互斥锁中线性化。A swap→B swap+play→A play 的交错会令 token 指向 B、实际播放 A；此时 B close 的 purge 会错停 A。且文本未明确 token 覆盖 `playSystemSound` 的 `SND_ALIAS`，只列举 file playback 四格。

**裁决与最小修复**

win32 `playSystemSound` 固定使用 `SND_ALIAS | SND_ASYNC | SND_NODEFAULT`；false 必须产生 `sound_not_found { requested, platform, attempted }` 和 broker.log 诊断。将 PlaybackToken 适用于所有 `PlaySound` 路径（filename 与 alias），而非 `MessageBeep`。

冻结一个 process-wide `PlaybackArbiter`：同一 mutex/critical section 内执行 native `PlaySound`、处理其返回值、再提交或清除 `(sessionId, instanceGeneration, sequence)` token；session close 在同一 lock 内比较完整 token，匹配才 purge/clear。不允许仅 `Atomic*::swap` 包住 metadata。测试从四格扩展为两线程交错、alias-vs-file、native false、close race；每个用 spy/wrapper 断言实际 `SND_PURGE` 与播放调用次序。

**落点**：sound design §1.2/§1.4/§4、sound Requirement playSystemSound/playSound、tasks 3.2/3.3/6.1；未来 `crates/opentray-ext-sound/src/windows/*`。

### P0-5：embedded 的“替换 bytes/build identity”身份链仍是声明，不是可验证协议

**证据**

- containment 与四个错误分类明确（dialog design §6.1，`:236-248`），这是 R1 的有效修复。
- 但 expected identity 仍只含 extensionName/artifactSetVersion/contractFingerprint/target；现有 loader 对实际 manifest 只要求 `build_identity` 非空，不将它与 host expectation 比较（`crates/opentray-spec/src/ext.rs:46-62`；`crates/opentray-bin/src/dynamic_extension.rs:772-792`）。
- current resolver 也只 realpath library；没有读取 embedded staging manifest、library SHA-256 或 build identity（`packages/cli/src/native-extension-artifact.ts:85-160,320-337`）。所以“字节替换” adversarial case 不能由当前说明区分同 identity 的替换 bytes。

**裁决与最小修复**

facade staging 生成并随 pack 带入一个 root-contained embedded manifest：每个 target 的 relative path、SHA-256、buildIdentity、facade version、contract fingerprint。resolver 必须 containment 校验该 manifest、计算选中 library hash、把 buildIdentity/hash 作为 expected load identity；broker 在 `Library::new` 前重验并将 actual embedded manifest 的 build identity 与 expected 比较。明确 TOCTOU 处理：CI closure 以 stage/pack 后重 hash 为 release authority；运行时至少在 load 前重 hash 并拒绝不匹配。adversarial test 必须替换真实 library bytes，而非只替换 JSON 声称。

**落点**：dialog design §6.1/§6.4、dialog embedded Requirement；`packages/cli/src/native-extension-artifact.ts`、`packages/spec/src/index.ts`、`crates/opentray-spec/src/ext.rs`、`crates/opentray-bin/src/dynamic_extension.rs`、future staging scripts。

### P0-6：four-target release evidence 的最终命令不可执行，未形成 R1 要求的 pack-to-loader 闭环

**证据**

- dialog design §6.4 和 tasks 6.2 写“`npm pack --dry-run` 解包逐目标 identity check”（`design-reference.md:275-285`；`tasks.md:41`）。dry-run 不落可解包 `.tgz`，因此这不是可执行验收。
- pack-size 也只表述 `npm pack --dry-run`（design `:265-273`），而 R1 要求的是实际 npm-pack compressed tarball 与 clean unpack evidence。

**裁决与最小修复**

release dry-run 在隔离临时目录完成 staging 后，执行真实 `npm pack --json --pack-destination <temp>`；从生成 `.tgz` 的 `stat` 读取压缩字节数，保存 npm/pnpm 版本、packlist、四 target hash 和 stage manifest。随后解包同一个 tgz，在每个 target runner 执行 resolver + native inspector/loader identity check。`--dry-run` 可保留为快速开发预警，但不能是发布证据或解包输入。将这条同样写入 sound 引用的 shared gate。

**落点**：dialog design §6.3--§6.4、tasks 2.4/5.2/6.2；sound design §3/§5、tasks 5.1/6.2；`scripts/check-pack-size.mjs`、`scripts/binaries/{native-build-graph,stage-release-artifacts,verify-native-plan}.ts`、release workflow。

### P0-7：typed error envelope 与运行时 backend DTO 仍缺可调用的查询/序列化合同

**证据**

- design §7.5 要求 `{ code, message, details }` 三侧同构（dialog design `:310-318`），但当前 `ServerFrame::Error` 只有 code/message（`crates/opentray-spec/src/protocol.rs:384-389`），Node 将它压成普通 `Error`（`packages/cli/src/local-broker.ts:394-410`）。没有枚举 `details` variants、operation terminal error 表或 parser 真值。
- 两 facade API 都把 runtime truth 暴露为同步 `readonly backend`（dialog design `:34-43`；sound design `:25-30`），但现有 tray extension 是惰性 `ensureLoaded()`，attach 同步返回且仅在首次 command/request 时 load extension（`packages/cli/src/client.ts:574-617`）。TaskDialog probe/原生 DTO 在 DLL load 后才存在，因此 attach 时不可能既同步又真实地给出 `backend`；也无法以该属性先做 commandLink preflight。

**裁决与最小修复**

在 shared protocol 中冻结 `TypedExtensionError` 和 discriminated `details` schema，给 ServerFrame error 与 deferred terminal 使用相同 JSON 形状，Node 产出有 `code/details/cause` 的 exported error class。每个 dialog/sound error 必须指定 detail variant，不允许 `unknown` 或解析 message。

同时将 public 属性裁决为异步 `getBackend(): Promise<...>`（沿用 ext-badge `getCapabilities()` 的惰性加载模式）；它 load 后请求 extension DTO，再返回 immutable snapshot。每个 capability method 在 native dispatch 前 await 同一 snapshot 并执行 capability preflight。若 Owner 坚持属性，则其类型必须显式 `unavailable | ready`，并提供 ready Promise；不能把猜测值标为 runtime truth。

**落点**：dialog/sound public API、design §7.5/DTO sections、两份 living spec DTO Requirement、tasks 2.1/2.2/4.1/4.2；`packages/spec/src/index.ts`、`crates/opentray-spec/src/protocol.rs`、`packages/cli/src/{local-broker,client}.ts`。

## 4. P1 重要问题

### P1-1：DTO 双 target gate 的 living requirement 仍表达了错误的编译因果

dialog spec `:79-87` 与 sound spec `:61-69` 仍称“cross-compilation of darwin target SHALL fail if win32 projection is missing”。一个 target 的 cfg 编译通常不会构建另一 target projection；这与 design/tasks 的正确“双 target CI + exhaustive serialization fixture”冲突。改为：CI 显式执行两个 target 的 compile/type/test，并将同一 complete DTO fixture 比较两个平台构造器；两个任一漏字段即 fail。

### P1-2：WAV “内容校验”仍不足以判定截断，大小上限也没有数值

sound design `:74-83` 和 spec `:45-53` 只写 `RIFF`/`WAVE`、bounded size，却没有最小字节数、RIFF chunk-length 规则、`fmt `/`data` chunk 边界或 size limit。冻结低成本 preflight：最大字节数、至少 12 bytes、little-endian RIFF declared length 不得超实际文件、至少一个完整 fmt/data chunk（不做解码）。测试真 12-byte header、declared-size overflow、trailing data、空/不可读，并明确 error 分类。

### P1-3：self-review/check 任务已补，但当前 OpenSpec 交付门仍红

两 change 的 `openspec:vision check` 都报告缺 `review/self-review.md/html`。这些不妨碍本轮设计分析，却不能称 P1-7 已关闭。按任务产出两份 self-review 后重跑 check，并记录工具输出；不要把本 R2 审查报告冒充 change 自评产物。

### P1-4：picker option 仍未在 living spec 形成可验收的跨平台合同

design 现在写入空 filter、`allowsOtherFileTypes: false`、`defaultExtension` 等默认值（dialog design `:57-63,101,114-118`），但 spec 的 picker Requirement 只覆盖 filters/multiple/path（`spec.md:53-61`）。补 scenarios：darwin `allowsOtherFileTypes=false` 与 filter 冲突、win32 `defaultExtension`/`strictFileTypes`、空 filter all files、`createDirectories` degradation。另冻结路径规则：已存在 selection 可 realpath；save 的不存在 leaf 只能 canonicalize existing parent 后做 lexical join，不能声称 full realpath canonicalize。

### P1-5：API 的糖 options 与 `pickFile` overload 需要可编译的精确类型

`alert(message, options?: MessageDialogOptions)`/`confirm` 没有排除 caller 覆盖 message/buttons/default/cancel 的类型合同；`pickFile(options?: FilePickOptions)` 也会与 `{ multiple: true }` overload 重叠，可能返回错误的 `string | null` 静态类型。写出完整 public declarations：sugar 使用 `Omit<..., "message" | "buttons" | "defaultId" | "cancelId">`（只在确有可覆盖字段时保留），且 base file options 为 `multiple?: false`，multi overload 必须是 `multiple: true`。在 `tsd`/type-test 固定推断。

### P1-6：sound DTO 的 darwin format truth 不能使用省略号式“全系”

sound design `:74-78,102-108` 同时宣称 `NSSound` “全系（...）”和 `backend.fileFormats` 是 runtime truth。发布 contract 应列出 v1 承诺的有限 canonical set，或将 DTO 改为 capability category；不要把随 OS/codec 变化的开放集合当“exact accepted formats”。

## 5. 最小解锁顺序与最终评分依据

### `add-ext-dialog`：5.0 / 10，NO-GO

提高点：R1 的 dismissal、comctl6、containment、staging matrix、pack-size、双 target、macOS probe 与 typed-error 工作项都已落到明确章节/任务；不再有 owner-loop modal 的错误建议。

NO-GO 原因：P0-1--P0-3、P0-5--P0-7 仍是共享协议/FFI/运行时边界，任何一个未先冻结都会造成 unsafe callback、Promise 永久 pending、错误 session routing 或无法执行的发布验收。

最小解锁：

1. 单独冻结并实现/测试 generic DeferredOperation + versioned completion/wake ABI、terminal result/error schema、owner writer router 与 typed transport death；随后先审该 shared change。
2. 选择并写清 current single-session broker 与 cross-session requirement 的关系；若要 multi-session，先独立改 runtime，不在 dialog change 中隐含扩大。
3. 完成 macOS owner-loop probe 和 Win32 per-operation STA dispatcher probe，证明 cancel/exit/worker lifecycle；修复 runtime DTO API 为 async query。
4. 落地 embedded buildId/SHA manifest 与真实 pack/unpack matrix evidence，再进入 facade/native batch。

### `add-ext-sound`：6.2 / 10，NO-GO

提高点：通用三音名映射、Linux typed unsupported、WAV 不只看 suffix、accepted/details/log、PlaybackToken 意图、A/B 四格和 dialog A 工程化依赖均有明确文字落点。

NO-GO 原因：必须等待 dialog A 的 shared artifact/error/session 基建；此外 `SND_ALIAS` 仍缺 `SND_ASYNC|SND_NODEFAULT`，token 与真实 PlaySound 的线性化未冻结，仍可卡住 owner loop、错误回退默认音或 purge 错 owner。

最小解锁：

1. dialog A 的 deferred/error/session/embedded/real-pack gates 达到 GO 后再启动 sound。
2. 冻结并测试 win32 alias flags、统一 PlaybackArbiter、close/play race 和 alias/file token ownership。
3. 补 WAV exact preflight、DTO dual-target wording、async backend query 与两份 self-review/check；最后执行真机 native return/log 及 pack evidence 验收。
