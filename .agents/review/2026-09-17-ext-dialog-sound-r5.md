# OpenTray `add-ext-dialog` / `add-ext-sound` R5 终验复核

- **基线**：`8729b906`（R4 修订，当前工作树）
- **范围**：active OpenSpec 的 plan/design/spec/tasks、现有 extension ABI/loader/protocol 交界、一致性门与 R4 六项 P0 closure claim。
- **性质**：设计/实现可开工性复核；当前尚未把“实现期任务未完成”本身计作缺陷，但设计不得与现有宿主 ABI 产生未定义行为。

## 1. 总评与结论

R4 已实质收敛了大部分产品语义：dialog 的 macOS broker-owned re-arm、Win32 STA worker 与卸载竞态、sound 的三名系统音表、WAV 精确前置校验、PlaybackArbiter、embedded 身份字段和真实 pack 证据要求均已进入规范主线。`vision validate/check`、`git diff --check` 和本轮一致性脚本均可运行。

但 R5 仍 **NO-GO**。阻塞不是实现缺口，而是 active 规范之间和规范与既有 ABI 之间仍存在会直接导致错误实现的矛盾：

1. design §5.1 声称改造现有 `opentray_ext_command` 且旧扩展“无 disposition 符号即 Immediate”，但现有 ABI 只有同名旧符号；按新函数指针调用旧 DLL 是未定义行为。
2. dialog living spec §101-103 与 tasks §2.2 仍保留 `poll_owner -> Done(terminal)` 和“3 秒失败产生 terminal”，与 design §5.2/§5.3 已冻结的 port-only、pre-Accept 同步 typed error 相冲突。
3. design §5.1 引用的“opentray-spec EventPort 记录字节常量”当前不存在；实际 `EVENT_DATA_MAX_BYTES` 是 `opentray-bin` 私有常量，无法作为跨 ABI 的共享冻结值。
4. consistency script 目前是可执行的文本负面扫描，但未进入 `verify`/`vision check`/CI，也不检测上述两种语义矛盾，因此单独返回 `OK` 不能证明 active 文档是 SSOT。

**结论**：`add-ext-dialog` **7.4/10，NO-GO**；`add-ext-sound` **8.0/10，NO-GO（依赖 dialog 批次 A）**。批次 A 不能以本轮状态宣告“可直接实现”；完成最小解锁清单后可重新进入终验。

## 2. R4 P0 closure ledger

| R4 项 | R5 核对结论 | 证据与状态 |
|---|---|---|
| P0-1 Deferred ABI 事务 | **未闭合** | design §5.1 已写 disposition、handle、port 生命周期和 version 1→2，但现有 `crates/opentray-spec/src/ext.rs:17-24` 只有 `opentray_ext_command`，`crates/opentray-bin/src/dynamic_extension.rs:33-38,350-352` 仍按旧四参函数取符号。没有可探测的 V2 符号、C layout、旧函数所有权边界。payload 共享常量也不存在。 |
| P0-2 macOS re-arm/唯一终帧源 | **design 闭合，SSOT 未闭合** | design §5.2:216-233 已冻结 `Pending` only、broker re-arm、generation、WaitUntil 和配额；但 `spec.md:103` 仍写 `Done(terminal) | Pending`，`tasks.md:15` 仍写 `Done | Pending`。实现者按 spec 仍可能保留第二终帧通道。 |
| P0-3 Win32 pre-Accept/卸载竞态 | **design 闭合，spec 未闭合** | design §5.3:246-253 已冻结原 `requestId` 同步错误、不发 Accepted/terminal，且 join 超时不得 deinit/dlclose；`spec.md:103` 仍称 3 秒失败产生 `dialog_presentation_failed` terminal。 |
| P0-4 PlaybackArbiter/单 session | **闭合（设计层）** | sound design §1.4:96-111 与 spec Requirement/Scenario 已改为单 session 多 mount、完整 token 比较、alias/file 共用 mutex 和一次 purge；未再命名活的第二 caller session。实现期仍需 spy/交错测试证据。 |
| P0-5 embedded 身份链 | **规范闭合，尚无实现证据** | dialog/sound 场景已包含 `sha256`/`buildIdentity`，plan/design 采用 Node manifest/hash → LoadExt expected identity → broker 重 hash → Library 后 native manifest、init 前校验的可实现序。现有 `ExpectedExtensionIdentity` 尚未包含这些字段，这是批次 A 的明确实现任务，不应在实现前伪报已完成。 |
| P0-6 pack/consistency gate | **pack 要求闭合；一致性门不可信为正式门** | design/spec/tasks 已要求真实 `npm pack --json --pack-destination`、同一 tgz 解包、四目标 identity 和 >3MB fail；脚本可运行并返回 OK，但未接入 `package.json verify`、vision workflow 或 CI，且没有 `Done(terminal)`/pre-Accept terminal 语义规则。 |

## 3. P0 阻塞问题

### P0-1：Deferred command ABI 的“旧符号恒 Immediate”不可实现

- **落点**：`openspec/changes/add-ext-dialog/plans/design-reference.md:161-172`；`crates/opentray-spec/src/ext.rs:17-35`；`crates/opentray-bin/src/dynamic_extension.rs:27-38,350-354`。
- **问题**：design 将现有 `ExtCommandFn` 改为增加 `out_disposition`，同时声称没有 disposition 符号的旧扩展恒 Immediate。但旧扩展仍导出同名 `opentray_ext_command`，loader 无法通过“符号不存在”区分旧签名；将旧函数地址 cast 成新函数类型并调用会造成 ABI/栈/寄存器未定义行为。`ExtCommandDispositionV1` 还是伪 enum 文字，没有 `repr(C)` 字段、size/offset、reserved 位、所有权和 `out_events` 的互斥规则。
- **可验证修复**：冻结独立 `EXT_SYMBOL_COMMAND_V2 = "opentray_ext_command_v2"`（或把 ABI 主版本提升并明确拒绝旧扩展）；V2 保留 V1 旧签名，loader 按 V2→V1 探测，V1 只走 Immediate 路径。将 disposition 冻结为真实 `#[repr(C)]` struct/union（tag、padding、handle/events 字段、`size_of`/`offset_of` fixture），明确 deferred 时 `out_events` 必须为空以及每个 `ExtOwnedBytes` 的释放方。把符号常量、loader 分支、contract fingerprint、Node/Bun/Rust round-trip 测试同步到 `spec.md`、tasks §2.1/§2.2。

### P0-2：living spec/tasks 与 design 的终帧模型相互矛盾

- **落点**：`openspec/changes/add-ext-dialog/specs/dialog-extension/spec.md:101-103`；`openspec/changes/add-ext-dialog/tasks.md:14-16`；对照 `plans/design-reference.md:198-200,216-217`。
- **问题**：design 已冻结“唯一终帧来源是 DeferredCompletionPort，`poll_owner` 只返回 Pending”，但 spec/tasks 仍允许 `Done(terminal)`。这会使实现者同时保留 poll 返回终帧和 port submit 两条完成路径，直接破坏 exactly-once/CAS 设计。
- **可验证修复**：将 spec 与 tasks 的所有 `Done(terminal)`/`Done | Pending` 改为 `Pending { next_deadline, wake_reason }`；增加负面场景：poll 返回值不得携带 payload，任何 terminal 只能由 port submit 进入 owner-loop CAS。重新运行一致性门，并用一个规范 fixture 搜索旧短语以确保失败可见。

### P0-3：Win32 pre-Accept 3 秒错误仍被 living spec 描述为 terminal

- **落点**：`openspec/changes/add-ext-dialog/specs/dialog-extension/spec.md:103`；对照 `plans/design-reference.md:246-249`、`tasks.md:24-26`。
- **问题**：design 已冻结“3 秒进入模态失败发生在 Accepted 可观察之前，原 requestId 同步 typed error；不产生 operation/Accepted/terminal”，但 spec 仍写“3 s ... typed `dialog_presentation_failed` terminal”。这会让 Node pending registry 收到无法关联的终帧，或让同步错误被误建 operation。
- **可验证修复**：在 spec Requirement 中明确两个分支：pre-Accept = 同步 request response；entered = Accepted 后 terminal error。补两条 wire timeline 场景，断言 requestId/operationId 的出现顺序和 terminal 禁止条件；将 grep 门加入该语义规则。

### P0-4：EventPort payload 上限没有共享真值

- **落点**：`plans/design-reference.md:175-177`；实际实现 `crates/opentray-bin/src/event_hub.rs:50-66`。
- **问题**：design 要求 DeferredCompletionPort 引用 `opentray-spec` EventPort 记录字节常量，但当前 `EVENT_DATA_MAX_BYTES = 64 * 1024` 是 broker-private `pub(crate)` 常量，`opentray-spec` 没有对应导出。实现阶段无法保证 EventPort 与 DeferredPort 对同一数值和 fixture 负责。
- **可验证修复**：在 `crates/opentray-spec/src/ext.rs`（或独立 `limits.rs`）定义公开、命名稳定的 `EXTENSION_EVENT_RECORD_MAX_BYTES`，由 `event_hub` 和 deferred port 同时引用；TS `@opentray/spec` 导出相同数值并做 Rust/TS fixture 比对。删除 design 中“引用但不存在”的表述后跑双端序列化测试。

### P0-5：一致性 gate 不是正式验证门，且有结构性漏检

- **落点**：`scripts/openspec/check-ext-dialog-sound-consistency.mjs:7-79`；`package.json` scripts；`openspec/changes/add-ext-dialog/tasks.md:44`。
- **问题**：脚本只扫描固定 basename、按行匹配、允许含 `移除/不承诺/retired` 等 marker 的整行跳过；它没有检测 `Done(terminal)`、pre-Accept terminal、符号兼容、payload 常量等本轮实际阻塞语义。它也未被 `verify`、`bun run openspec:vision -- check` 或 CI 调用；因此本轮 `OK` 只能证明“已列出的 retired 文本没有命中”，不能证明 SSOT 一致。
- **可验证修复**：把脚本注册为 package `verify` 的明确子门并在 CI workflow 直接执行；增加 fixture 测试（正常负面引用、伪装 marker 的规范冲突、Done/pre-Accept/Library 顺序冲突）。扫描规范文件时采用结构化规则而非仅按行 allowlist，并输出文件、行号、规则 ID；任务 6.2 只在该正式入口通过后才允许勾选。

## 4. P1 重要问题

1. **C layout 证据尚未落地**：即使补 V2 符号，design 仍需明确 `ExtDeferredPortV1` 的 `repr(C)` 字段、函数指针 ABI、null/struct_size 规则、port 内存存活和 `ExtOwnedBytes` 释放责任。落点：design §5.1、`opentray-spec` layout tests、tasks §2.1/§2.2。
2. **协议 version 文档与当前常量暂不一致**：design 说 1→2 并要求双侧拒绝测试，但当前 `crates/opentray-spec/src/protocol.rs:10` 仍是 `PROTOCOL_VERSION = 1`。这属于批次 A 的待实现项，但必须把升级涉及的 Node、broker、socket endpoint、ready metadata 和旧协议拒绝矩阵列入同一提交门，避免仅改 parser。
3. **embedded identity 仍只有计划级证据**：当前 `ExpectedExtensionIdentity` 尚无 `sha256/buildIdentity` 字段，真实 pack、stage 后重 hash、native inspector 和 adversarial bytes 替换都还未执行。pack-size 与 resolver 不能在实现期前被自评为完成；无真实 tgz receipt 不得 packaging GO。
4. **comctl6 仍是实现验收项而非现状事实**：RT_MANIFEST、`.rc`/cargo wiring、启动探测 DTO、packaged broker 证据已写入 tasks §3.3b，但当前工作树没有对应 broker resource 实现；应保持“待实现/待真机验收”措辞，避免 self-review 将其标为已完成。
5. **AGENTS 法则仍为 provisional**：`AGENTS.md` 已预落 Dialog And Sound Extension Law，满足 R4 的沉淀要求，但归档前需把实际 ABI symbol/version、shared limit、真实 pack receipt 和 STA teardown 证据回写为定稿，不能把 provisional 章当成实现证据。
6. **Sound 的批次依赖必须保持硬门**：sound 设计已经正确引用 dialog 的 embedded/deferred/pack 基建；tasks 1.1 与 6.2 应在 CI 中表达“dialog batch A green 后才运行 sound native/facade”，而不是仅靠文档排序。否则 sound 可单独绿但共享协议仍未可用。

## 5. 已确认闭合的裁决

- 通用系统音名冻结为三项：`notification → Glass/SystemAsterisk`、`warning → Sosumi/SystemExclamation`、`error → Basso/SystemHand`；`default/info/question` 仅属于 `beep`。
- `playSystemSound` 顺序为通用名 → 平台原生名 → typed `sound_not_found`，Win32 固定 `SND_ALIAS | SND_ASYNC | SND_NODEFAULT`，以原生返回值判定，不静默成功。
- Win32 `playSound` 为内容级 WAV-only 前置校验：RIFF declared size、fmt/data、奇数 pad 和 64MiB/边界族均已冻结；拒绝路径要求 native spy 零调用。
- PlaybackArbiter 以完整 `(sessionId, instanceGeneration, sequence)` token 在单 mutex 内串行化 native 调用、返回值和提交/清除；session close 至多一次 purge。
- macOS owner-loop re-arm、generation 丢弃、WaitUntil、每轮最多 4 owner×1 step；Win32 cap 8、entry 3s、join 2s、STA/WM_APP 和 deinit-after-join 规则已明确。
- embedded 路径 containment、manifest/hash/buildIdentity 顺序、TOCTOU 已知边界、真实 npm pack 与同一 tgz 解包证据均已写入规范；这些仍是实现/CI 待产出的验收证据，而非当前事实。

## 6. 最小解锁清单

1. 在 `opentray-spec` 与 loader 中冻结并实现 V2 command symbol（或明确 ABI 主版本拒绝旧 DLL），补真实 `repr(C)` disposition/port layout、ownership 和 Rust/TS fixtures。
2. 同步 dialog spec、tasks、design：删除 `Done(terminal)`；把 pre-Accept 3 秒失败改成 requestId 同步 typed error，并补 wire timeline 场景。
3. 把 EventPort/deferred payload 上限提取为共享 `opentray-spec`/`@opentray/spec` 常量，移除 broker-private 唯一真值。
4. 将 consistency script 接入正式 `verify`/CI/vision 门，补语义冲突规则和负面 fixture；重新运行两项 `vision check`。
5. 批次 A 完成后产出协议 version 2、embedded identity 字段、真实 pack/unpack receipt 和 dual-target tests；再启动 dialog native B，最后按硬依赖启动 sound。

## 7. 评分依据与最终判定

### `add-ext-dialog`: 7.4/10 — NO-GO

产品边界、平台调度和失败语义已经接近可实现；但 deferred ABI 与现有同名旧符号存在未定义行为风险，且 living spec/tasks 仍会诱导双终帧和错误的 pre-Accept terminal。两项均会导致返工或运行时错误，故不能进入批次 A 实现。

### `add-ext-sound`: 8.0/10 — NO-GO（依赖门）

sound 自身的命名表、返回值边界、WAV 解析和 arbiter 设计已较完整，单独评分高于 dialog；但其 embedded、protocol、pack-size 均依赖 dialog 批次 A，而共享 ABI/常量尚未闭合。待上述最小解锁清单完成并由 dialog A 先行验证后，sound 才可进入实现。
