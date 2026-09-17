# OpenTray `add-ext-dialog` / `add-ext-sound` R7 终验复核

- **基线**：`bf7da3b6`（R6 修订）
- **范围**：R6 两项 P0、四项可落地 P1、active OpenSpec 与正式 gate。
- **实测**：门 fixture `4/4`；`verify:spec-consistency` OK；两项 `vision validate` 通过；两项 `vision check` 返回 `ok: true`；`git diff --check` 通过。

## 1. 总评与结论

R6 的设计裁决已完成闭合。DeferredCompletionPort 现在按值 attach，与 EventPort 的生命周期模式一致；tag/reserved、单输出 disposition 矩阵、四格 V2/V1 探测、poll-only/port-only 终帧和 Win32 两分支时间线没有新的规范矛盾。CI 路径已覆盖 `openspec/**`、`scripts/openspec/**` 和 `package.json`，结构化一致性门也已进入正式 verify 与 native-artifacts workflow。

本轮未发现新的 P0 设计阻塞。剩余问题均是批次 A 实现/验证事项：一致性脚本的 Windows 主入口判断仍应 URL-safe；fixture 声称覆盖“每 ruleId”但实际样例只覆盖 semantic 规则；V2 ABI 的真实 Rust/C layout、协议 version 2、共享常量、embedded resolver/pack receipt 和 sound 的 job-level dependency 尚未有实现证据。这些不阻止批次 A 开工，但在相应 task 勾选和归档前必须闭合。

**结论：`add-ext-dialog` 8.8/10，GO（附实现期条件）；`add-ext-sound` 9.0/10，GO（附 dialog 批次 A 依赖）。批次 A 可以开工。**

## 2. R6 closure ledger

| R6 项 | R7 结论 | 核对结果 |
|---|---|---|
| P0-1 port 生命周期 | **闭合** | design §5.1:183-191 明确按值传递 `ExtDeferredPortV1`、扩展只复制 struct/保留 `port_data`、不可保留 struct 指针，并列入 attach-teardown fixture；与 `ExtEventPortV1` 按值 attach 一致。 |
| P0-2 disposition 所有权 | **闭合** | design §5.1:164-174 冻结 tag 0/1、reserved、value 无 bytes、`out_events` 唯一通道、Deferred 非空结构化丢弃、两块缓冲独立所有权；tasks 2.2 加入 Immediate 双输出负例。 |
| P1-1 CI paths | **闭合** | `.github/workflows/verify-native-artifacts.yml:6-16` 已覆盖规范、脚本和 package manifest。 |
| P1-2 结构化 gate | **闭合（实现期仍需扩 coverage）** | `RULES` 区分 `name`/`semantic`，semantic 不受 allowlist；四个 fixture 用例均通过，真实仓库扫描 OK。 |
| P1-3 URL path | **闭合** | gate 使用 `fileURLToPath(new URL(...))`。主入口比较仍有 Windows 兼容性改进项，见 P1。 |
| P1-4 符号矩阵 | **设计闭合** | design §5.1:176-181 冻结 V2-only/V1-only/双符号/双缺失和诊断；真实 loader 矩阵属于批次 A 实现。 |
| P1-6 sound dependency | **设计闭合，CI job wiring 待实现** | sound tasks 1.1 明确 needs/路径门；当前尚无 sound-specific job output，这是实现期工程门。 |

## 3. P0 阻塞问题

**无。** R6 两项 P0 均已转化为可执行、无歧义的 ABI 约束；当前工作树仍未实现这些代码，但这属于已冻结任务，不是设计矛盾。

## 4. P1 实现期问题

### P1-1：一致性 gate 的主入口判断在 Windows 仍不稳

- **落点**：`scripts/openspec/check-ext-dialog-sound-consistency.mjs:100`。
- **证据**：脚本虽已用 `fileURLToPath` 解析根目录，但主入口仍比较 `import.meta.url === \`file://${process.argv[1]}\``。Windows 的 `process.argv[1]` 可能是 `C:\\...`，与 `file:///C:/...` 不等价；`node scripts/...` 可能静默跳过 `runOnRepo()` 并返回 0。
- **修复/验收**：用 `pathToFileURL(resolve(process.argv[1])).href === import.meta.url` 或直接导出 `main()` 并由 package script显式调用；在 Windows path fixture/CI 中断言脚本确实扫描 active docs。

### P1-2：fixture 的“每 ruleId”断言尚未覆盖 name 规则

- **落点**：`scripts/openspec/check-ext-dialog-sound-consistency.test.ts:21-38`。
- **证据**：样例只触发 semantic rule（barrier、dry-run、identity、双 session、poll、pre-Accept），没有逐一触发 `retired-frame-*`、`retired-sync-backend*` 等 name rule；第 4 个用例只校验 rule table 结构，不能证明每个 ruleId 可命中。
- **修复/验收**：为每个唯一 ruleId 生成一条 sample，name 规则同时覆盖“有 marker 放行/无 marker 命中”；测试应断言样例触发的 ruleId 集等于 `RULES` 的唯一 ID 集。

### P1-3：V2 ABI 仍需真实 C/Rust layout 与 loader 四格实现

- **落点**：design §5.1:161-191、tasks 2.1/2.2。
- **验收要求**：真实 `#[repr(C)]` disposition/port 类型和 `size_of/offset_of` fixture；V2-only、V1-only、双符号、双缺失动态库 fixture；Immediate 双输出、未知 tag、非零 reserved、attach-teardown 和 deferred oversize/closed/invalid-handle 测试；能力诊断和 load 日志字段与设计一致。

### P1-4：协议、共享常量和 embedded 身份链仍是未完成实现门

- **落点**：tasks 2.1-2.6、5.1-5.2。
- **验收要求**：协议 version 2 全矩阵（Node/broker/socket endpoint/ready metadata/旧版本拒绝）、`EXTENSION_EVENT_RECORD_MAX_BYTES` Rust/TS 唯一真值、`ExpectedExtensionIdentity` sha256/buildIdentity、真实 pack/unpack receipt 和双 target identity 检查；当前源代码仍处在旧实现基线，不能提前勾选任务。

### P1-5：sound 的 job-level dependency 需从 prose 变为 CI 图

- **落点**：`openspec/changes/add-ext-sound/tasks.md:11`。
- **验收要求**：dialog 批次 A 的测试/pack/identity 结果作为 job output，sound native/facade job 通过 `needs` 和路径门消费该 output；只改 sound 时不能绕过 dialog shared baseline。

### P1-6：AGENTS 法则保持 provisional 直到证据回写

- **落点**：`AGENTS.md:547-580`。
- **验收要求**：归档前补实际 V2 symbol/tag/port constant、protocol-2 receipt、真实 pack 证据、STA teardown 和 PlaybackArbiter spy 结果，随后把 provisional 标记改为定稿。

## 5. 复核通过的语义裁决

- DeferredOperation 只有 port submit 产生终帧；poll 永不携带 terminal。
- Win32 pre-entry failure 是原 requestId 同步错误；post-entry failure 才是 Accepted→terminal error。
- V2-only 不要求旧 command symbol；V1-only 永不按新签名调用；双符号优先 V2；双缺失 typed `abi_incompatible`。
- `out_events` 是唯一事件/结果缓冲；disposition 不携带 bytes，避免双重释放。
- Sound 三名通用系统音、NODEFAULT 三件套、WAV 内容校验、PlaybackArbiter 和单 session 多 mount 语义保持不变。

## 6. 批次 A 开工条件

可以开工。开工前无需再改产品语义；实现阶段必须先完成 ABI/layout、协议 version 2、共享常量和 embedded resolver，再进入 dialog native B；sound 只能在 dialog A 的 job output 绿后进入 native/facade。上述 gate 主入口和 fixture coverage 应作为 2.6b/6.2 的实现验收项。

## 7. 评分

### `add-ext-dialog`: 8.8/10 — GO（附实现期条件）

R6 的 P0/P1 设计裁决全部闭合，剩余是可验证的 ABI、协议、构建和 gate 实现证据。

### `add-ext-sound`: 9.0/10 — GO（附 dialog 批次 A 依赖）

声音原子自身无新的设计阻塞；共享基建和 CI 依赖必须按硬门执行后才能进入 sound 实现。
