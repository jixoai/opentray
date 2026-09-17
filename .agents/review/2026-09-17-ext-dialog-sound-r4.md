# OpenTray ext-dialog / ext-sound R4 终验评审

评审基线：当前工作树，`bd16c2ff`（R3 修订提交）及其后的未提交文件。
评审范围：`openspec/changes/add-ext-dialog/`、`openspec/changes/add-ext-sound/`，并对照现有协议、动态扩展 FFI、resolver 与仓库法则。此报告评审的是实现前规范是否可直接开工，不把自评或结构校验当作实现证据。

## 1. 总评与结论

R4 明确闭合了 R3 的 RIFF 数学、三项通用系统音名映射、`SND_NODEFAULT`、PlaybackArbiter 单 mutex 线性化、单 session sound 场景、embedded staging 的真实字节方向、真实 `npm pack` 证据要求，以及 `getBackend()` 的异步 API。两项 `vision validate` 和 `vision check` 均返回 `ok:true`，`git diff --check` 通过。

但两项仍 **NO-GO**。结构检查没有执行声明中的 grep 门；而且现有 FFI 仍是同步 `ExtCommandFn`/`ExtCommandResult`，R4 文档没有冻结把 host-issued handle 和 tagged disposition 接入该 ABI 的 C 布局。macOS deadline 没有可达的 broker re-arm 机制，Win32 3 秒前置失败和 2 秒 join 超时还会产生未关联终帧或卸载仍在执行的 DLL。Sound 设计仍要求不可表达的活跃 A/B caller session。以上任一项都足以导致实现返工或运行时崩溃。

## 2. P0 阻塞问题

### P0-1：DeferredOperation 仍没有可实现的 command-to-terminal C ABI

**证据**

- `add-ext-dialog/plans/design-reference.md:161-170` 只写了抽象的 `CommandDisposition` 和 `submit(port_data, handle, payload_bytes, payload_len)`，没有 `ExtCommandDispositionV1` 的 `repr(C)` 布局、out-parameter/返回值约定、错误内存所有权或 handle 在命令调用中的注入位置。
- 现有 `crates/opentray-bin/src/dynamic_extension.rs:33-38` 的 `ExtCommandFn` 仍只有 `(instance, context, envelope, out_events)`，不能返回 deferred disposition；`packages/spec/src/index.ts:599-602` 仍只有同步 `ext-command-result`。
- 新 attach 草案 `design-reference.md:168-170` 没有 `instance` 参数，而现有 EventPort attach `crates/opentray-spec/src/ext.rs:213-217` 明确是 `attach(instance, port)`。多 mount 时 port 所属实例因此未定义。
- `CommandScope` 要求注入 `sessionId/instanceGeneration`，但当前 `ExtensionScope` 仍只有 `appId/trayId/ext`（`packages/spec/src/index.ts:425-429`；`crates/opentray-spec/src/ext.rs:232-240`）。64-bit handle 也未冻结为 C `u64`、十六进制字符串或其它 Node 安全表示。
- 文档声称要提升 protocol version，但当前 `packages/spec/src/index.ts:14` 与 `crates/opentray-spec/src/protocol.rs:10` 仍为 `1`；没有写明新版本号、兼容拒绝和 Node/Bun 双端切换门。

**影响**：实现者必须自行决定旧 FFI 如何返回 `Immediate|Deferred`、Node 如何关联 operation，以及同一 facade 多 mount 如何隔离；可能出现 Accepted 后永不 resolve、把 terminal error 当成功值，或一个 mount 覆盖另一个 mount 的 port。

**修复与落点**：在 `design-reference.md §5.1`、`specs/dialog-extension/spec.md Requirement 1`、`tasks.md:14-17` 和 `crates/opentray-spec/src/ext.rs` 冻结：`ExtCommandDispositionV1` 的字段/对齐/所有权、命令函数签名、`attach(instance, port)`、handle wire 表示和 nonce/绑定校验；在 `protocol.rs` 与 `packages/spec/src/index.ts` 增加 `Accepted`/`Terminal` 全量帧及 exhaustive parser。加入 Rust/TS/Node/Bun layout、伪造/重放/错 owner/旧 generation、result/error round-trip 测试，并证明 `markDead` 只产生通用 `extension_transport_closed`。

### P0-2：macOS `WaitUntil` 调度存在唤醒饿死路径，终帧来源仍未唯一化

**证据**

- `design-reference.md:203-216` 要求 `ControlFlow::WaitUntil(min deadline)`，同时规定 AppKit callback 只能推进 deadline、不能持有 broker 指针或发 wake。callback 若把 deadline 推早，而 owner loop 已睡到较晚时刻，没有机制让 loop 重新计算 deadline。
- 同节写成“`Done` 经 §5.1 port 或 poll 返回，二选一在实现批冻结”，这把 exactly-once 的终帧来源留给实现决定。
- 当前 broker 仍在 `crates/opentray-bin/src/main.rs:608-610` 设置 `ControlFlow::Wait`，现有 `ProxyWake`（`main.rs:569-576`）只覆盖 EventPort drain，没有 `DialogPollDue`/deadline re-arm 合同。

**影响**：对话可能在无外部事件时永久停留，或实现者同时启用 poll 与 port 造成重复终帧；普通 menu/transport 交错也无法由文档证明。

**修复与落点**：在 `§5.2`、dialog Requirement 2、`tasks.md:15,23-24` 选定一种可达的 broker-owned re-arm：例如 callback 只写原子 deadline，broker-owned timer/wake 在 deadline 变化后重新投递 `DialogPollDue(generation)`，并明确 callback 不直接调用 winit。冻结唯一终帧来源（建议 port submit 为唯一跨线程提交，poll 只返回 Pending），删除“实现批再选”，补 WaitUntil 无外部事件、deadline 提前、revoke/exit race 和 no-duplicate-terminal probe。

### P0-3：Win32 Accepted 前失败与 join 超时会断开 operation 或执行卸载后的 DLL

**证据**

- `design-reference.md:220-229` 把 Accepted 定义为 worker 已进入原生调用，但又规定“进入超时 3s → `dialog_presentation_failed` 终帧”。3 秒超时发生在 Accepted/operationId 可被 Node 观察之前，文档没有 requestId 级立即错误还是先 Accepted 的选择。
- `design-reference.md:235` 规定 close → join（2s）→ 诊断 → extension cleanup。join 超时后 worker 可能仍在执行 `opentray_ext_*`，而现有 `DynamicExtensionInstance::drop` 在 `dynamic_extension.rs:522-534` 先 deinit 再释放 `_library`；设计没有进程级保活、强制终止或禁止 dlclose 的策略。
- 当前 UI-affine 实例仍有 `unsafe impl Send`（`dynamic_extension.rs:284-298`），规范只说“移除或证明永不移动”，没有落地的 owner-thread registry ABI。

**影响**：请求可能没有任何可关联的 terminal；更严重的是 join 超时后 deinit/dlclose 与仍运行的 worker 并发，形成 use-after-unload/FFI 崩溃。

**修复与落点**：在 `§5.3`、Requirement 2、`tasks.md:25-26` 选定并冻结一种事务：未进入模态调用的 3s 失败必须是带原 `requestId` 的同步 typed error，或先发 Accepted 再发 terminal，不能写成未关联的 terminal。关闭时必须“worker 已退出才 cleanup/dlclose”；2s 超时只能保留 library/instance 至 worker 结束，或放弃清理并终止 broker 进程，不能继续释放 DLL。补 cap-1/cap/cap+1、entry-timeout、join-timeout、线程 ID 与 deinit-after-join 断言。

### P0-4：Sound 原生验收仍虚构活跃 A/B caller session

**证据**：`openspec/changes/add-ext-sound/plans/design-reference.md:155-157` 仍要求“**A/B 会话交错与关闭顺序四格**”；同一 change 的规范却在 `specs/sound-extension/spec.md:13-17` 明确当前 broker 为 single-session，只允许用两个模拟 `CommandScope` token 做 arbiter 单测，不能命名活跃第二 caller session。现有运行时也以 `OPENTRAY_BROKER_SINGLE_SESSION` 拒绝第二连接。

**影响**：验收无法在支持的拓扑中执行，或会诱使实现扩大被 Owner 否决的 runtime；这不是测试措辞差异，而是生命周期所有权边界冲突。

**修复与落点**：将 sound design §5、`tasks.md:35` 和 plan 索引改为同一 caller session 的多 mount/一次 close 序列；真实集成只验证最新匹配 token 至多 purge 一次，双 token 交错留在 PlaybackArbiter deterministic unit test。不得出现 live session B，除非另立 multi-session runtime change。

### P0-5：身份链的 SSOT 和现有 resolver/loader 仍未闭合

**证据**

- dialog Requirement 7 的正文要求 SHA-256/buildIdentity，但场景 `specs/dialog-extension/spec.md:121-125` 仍只断言 `{extensionName, artifactSetVersion, contractFingerprint}`。
- `add-ext-dialog/plans/plan.md:56` 仍写“broker 在 `Library::new` 前重验 actual build identity”，而 R4 的 design 已诚实改为 `Library::new` 后、`init` 前读取库内 manifest（`design-reference.md:333-342`）。`tasks.md:16` 同样保留旧的 “`Library::new` 前 buildIdentity 重验”。
- 共享类型尚未包含新字段：`packages/spec/src/index.ts:441-446` 与 `crates/opentray-spec/src/ext.rs:46-51` 的 `ExpectedExtensionIdentity` 仍无 `sha256/buildIdentity`；loader 先 `Library::new`（`dynamic_extension.rs:306`），随后只校验 actual build identity 非空（`:772-781`）。

**影响**：按 SSOT 实现会无法把 manifest 期望值传到 `LoadExt`，或错误地要求在无法读取库内符号前校验 buildIdentity；替换真实 bytes 不能得到承诺的拒绝。

**修复与落点**：以 design §6.4 的顺序为唯一规范，更新 plan/tasks、dialog 场景及 sound 场景；在 `packages/spec`、`crates/opentray-spec`、`protocol.rs`、`native-extension-artifact.ts`、`dynamic_extension.rs` 冻结 expected `sha256/buildIdentity` 字段，Node hash → `LoadExt` → broker load 前 rehash → `Library::new` 后 manifest、`init` 前校验。保留 TOCTOU 已知边界，并加入 packed bytes 真实替换测试。

### P0-6：声明的 grep 门目前既不执行，也会被自身负面清单触发

**证据**

- 仍有旧规范性文本：`add-ext-dialog/plans/plan.md:43` 和 `tasks.md:16` 保留 `terminal-before-event barrier`；`tasks.md:16` 保留 `Library::new` 前校验；`tasks.md:43` 仍写 `release dry-run`；`specs/dialog-extension/spec.md:98` 仍写 facade “reads `backend`”。
- `design-reference.md:403-405` 把旧词列在“禁止”清单中；普通全文 `rg` 会把 `ExtCommandCompleted`/`ExtCommandCancelled` 等负面示例自身命中，文档没有定义排除路径、allowlist 或脚本。
- 本轮 `vision validate/check` 均成功，但该 workflow 没有运行上述语义 grep；因此 `check ok:true` 不能证明 SSOT 一致。

**影响**：未来实现者可能照 plan/tasks 的旧条款实现 barrier、同步 backend 或错误的身份顺序；发布门显示绿色但无法阻止回归。

**修复与落点**：修正 plan/tasks/spec 的所有规范性残留；新增可复制的 `scripts/openspec/check-ext-dialog-sound-consistency.*`，限定扫描 active `plans/`, `specs/`, `tasks.md`，排除 `review/` 与明确的负面-example block，或采用结构化 forbidden-pattern allowlist；CI/`vision check` 显式调用并输出命中行。禁止词应包括旧完成帧、core 内 `dialog_transport_closed`、同步 `backend`、same-broker live cross-session、release dry-run、`before Library::new`。

## 3. P1 重要问题

1. **Dialog embedded 场景断言不足。** 即使 P0-5 修正，`spec.md:121-125` 仍必须列出目标 manifest 的 `sha256` 与 `buildIdentity`，否则 resolver 测试可以只验证旧三字段。
2. **`getBackend()` 场景措辞未同步。** `spec.md:98` 仍写读取 `backend`，而设计和 Requirement 约定是 `await getBackend()`。改为异步调用并断言 immutable snapshot，补 TS type-test。
3. **comctl6 决策已冻结但工程落点不足。** `plan.md:53`/`design-reference.md:237-238` 正确选择 broker EXE 的 `RT_MANIFEST`、启动探测、MessageBox 兜底与 capability typed reject；但仓库当前 `crates/opentray-bin` 没有对应 `.rc`/build-resource/探测产物落点。补 Windows resource 文件、cargo build wiring、探测日志/DTO fixture 与 packaged broker 真机证据，避免实现期自行发明 activation-context 装载方式。
4. **Deferred port 的 bounded payload 上限未给出可引用的数值。** `design-reference.md:181` 只说“与 EventPort record limit 一致”；应引用共享常量并在 ABI layout/oversized fixture 中冻结字节数。
5. **架构法则尚未沉淀到 `AGENTS.md`。** 全局仓库规则要求架构诊断形成项目级法则；本提交未更新 `AGENTS.md`，且未跟踪的 `.agents/documents/d19-extension-event-port-design.md` 不能替代已提交 SSOT。实现前应将 DeferredOperation、dialog owner scheduler、STA lifetime、PlaybackArbiter 与真实 pack evidence 的法则落档，避免后续归档丢失。
6. **未执行实现/发布门。** 本轮只验证了 `vision validate/check` 与 `git diff --check`；workspace tests、Node+Bun 双跑、双 target compile/type/test、真实 `npm pack`/同 tgz 解包身份检查、macOS wake probe、Windows STA/TaskDialog/IFileDialog 真机验收均未运行。它们不应被 self-review 的 `ok:true` 替代。

## 4. 开放问题裁决

### Sound 通用名与映射

冻结为三项且不扩表：

| 通用名 | Darwin | Win32 |
|---|---|---|
| `notification` | `Glass` | `SystemAsterisk` |
| `warning` | `Sosumi` | `SystemExclamation` |
| `error` | `Basso` | `SystemHand` |

`default/info/question` 只属于五级 `beep`，不进入 `playSystemSound` 目录。通用名 miss 后按平台原生名尝试；Win32 必须使用 `SND_ALIAS | SND_ASYNC | SND_NODEFAULT`，原生 false 或 Darwin 目录 miss 返回 `sound_not_found`，不得静默回退。

### PlaybackToken / 停止范围

接受 R4 的 `PlaybackArbiter`：process-wide 单 mutex 同时包住 native 调用、返回值处理和完整 `(sessionId, instanceGeneration, sequence)` token 提交/清除；close 在同一锁中比较完整 token，匹配才执行一次 `PlaySound(NULL, SND_PURGE)`。当前 single-session runtime 的真实集成不命名第二 caller session；双 token 仅为模拟单测。`MessageBeep` 不进入 token。

### WAV 前置校验

接受精确门：Win32 路径 canonicalize/readability、≤64 MiB、至少 12 bytes、`declared_size + 8 ≤ actual`、RIFF/WAVE、`fmt ` 与 `data` 均存在、每个 chunk 加奇数 pad 后仍在 declared RIFF 区域与实际文件内、`fmt` 至少 16 bytes；任何失败为 typed error 且 PlaySound spy 零调用。七族 fixture 必须覆盖最小头、u32 溢出、边界、奇数 pad、缺 fmt、缺 data、越 declared/physical。

### Dialog comctl6 activation context

接受“绑定 broker EXE 的 `RT_MANIFEST` 资源，启动探测一次，DTO 反映 TaskDialog 能力；不可用时 MessageBox 兜底，但 `commandLink`/`expander` typed `dialog_capability_unavailable`”的语义。仍需按 P1-3 给出具体 Windows resource/build/probe 落点和 packaged broker 证据。

### 体积基线

接受 Owner 法则：对实际 `npm pack --json --pack-destination` 生成的同一 `.tgz` 取 `stat` 压缩字节数；`≥2 MB` 警告并记录 Owner 拆分决策，`>3 MB` 强制拆成 `@opentray/<name>-<os>-<arch>`。当前没有实际四目标 stage/pack/unpack 证据，因此两个 change 均不得宣称 packaging GO。

## 5. 综合评分与最小解锁清单

### `add-ext-dialog`：6.7 / 10，NO-GO

方向和平台边界已明显收敛，错误 envelope、modal 状态、STA 数值、embedded 顺序和验证矩阵写得较完整；扣分集中在 P0-1/2/3/5/6：ABI 还不能接入现有 C FFI，macOS 调度可能饿死，Win32 cleanup 有卸载竞态，身份链在 plan/共享 schema 未落地，grep 门会假绿。最小解锁顺序：

1. 冻结并实现 `CommandDispositionV1`、handle/port ABI、Accepted/Terminal 帧和 CommandScope；
2. 冻结 broker deadline re-arm 与唯一 terminal source；
3. 冻结 Win32 pre-Accept failure 和 worker/library 超时生命周期；
4. 同步 plan/tasks/spec 的身份字段、`Library::new` 顺序、`getBackend` 和旧 barrier/dry-run 文本，落地可信 grep 门；
5. 再执行批次 A 的 Node+Bun、双 target、resolver adversarial、真实 pack/unpack 与 native probes。

### `add-ext-sound`：7.1 / 10，NO-GO（依赖 dialog 批次 A）

声音 API、三项映射、WAV 解析和 PlaybackArbiter 设计已达到可实现方向，R3 的 sound living spec 主要问题已修正；扣分来自 P0-4 的设计/规范冲突、对 dialog embedded/deferred 基建的硬依赖，以及所有真实 native/pack 证据仍为空。最小解锁顺序：

1. 删除真实 A/B caller-session 验收，改成 single-session multi-mount integration + simulated-token unit test；
2. 等 dialog 批次 A 的协议、embedded resolver、pack-size 和一致性 grep 门全部绿；
3. 完成 sound 双平台原生实现、PlaybackArbiter spy、RIFF 七族、DTO fixture、真实同 tgz identity/体积证据和真机命令返回值验收。

在上述 P0 修正并重新验证前，不能宣布两个 change GO，也不能以当前文档批准批次 A 进入实现；修正后可按 dialog A → sound B 的依赖顺序开工。
