# OpenTray `add-ext-dialog` / `add-ext-sound` R6 终验复核

- **基线**：`eb939ecd`（R5 修订）
- **复核范围**：active OpenSpec、Deferred ABI/既有 EventPort 交界、正式验证接线、R5 五项 P0 closure。
- **本轮实测**：`bun run verify:spec-consistency` OK；两项 `vision validate` 通过；两项 `vision check` 返回 `ok: true`；`git diff --check` 通过。

## 1. 总评与结论

R5 的五项语义闭合基本成立：独立 `opentray_ext_command_v2` 探测、V1 无 UB fallback、poll-only/port-only 终帧、Win32 两分支失败时间线、共享 payload 常量命名，以及带 ruleId 的一致性脚本均已写入 active 文档。Sound 的三名系统音、PlaybackArbiter、WAV 边界和单 session 场景继续保持一致。

本轮仍 **NO-GO**，原因是新冻结的 DeferredPort ABI 还没有满足“可直接实现”的 C 生命周期契约：`attach` 传入裸 `*const ExtDeferredPortV1`，但没有规定该 struct 指针的存活期/是否允许扩展保留；这与现有 EventPort 按值传递、port 状态进程级存活的法则不一致。另有 CI 触发范围和 gate 自测仍不足以证明“所有规范变更必经正式门”。这些不是实现缺失，而是 ABI/验证设计尚未完全冻结。

**结论**：`add-ext-dialog` **8.2/10，NO-GO**；`add-ext-sound` **8.6/10，NO-GO（依赖 dialog 批次 A）**。补完下方最小解锁后，剩余事项可全部归入“实现并验证”，即可明确批次 A 开工。

## 2. R5 五项 P0 closure ledger

| R5 项 | R6 结论 | 证据 |
|---|---|---|
| P0-1 V2 command ABI | **部分闭合，仍有 P0 残留** | design §5.1:161-176 已独立 V2 符号、V2→V1 探测、repr(C) 字段和释放责任；但 DeferredPort 使用 `*const ExtDeferredPortV1`，未定义指针存活/复制规则；`tag` 的数值、未知值/非零 reserved 行为也未冻结。既有 EventPort attach 在 `crates/opentray-spec/src/ext.rs:216-217` 按值传递。 |
| P0-2 poll/terminal 语义 | **闭合** | dialog spec:103、tasks:15 已为 Pending-only/port-only；spec:105-115 有 pre/post wire timeline；一致性门 rule `poll-terminal-channel` 可拦截旧短语。 |
| P0-3 Win32 两分支失败 | **闭合** | spec:103、105-115 明确 pre-entry 原 requestId 同步错误、无 operation/Accepted/terminal；post-entry 才 Accepted→terminal error；gate 有 `preaccept-terminal` 规则。 |
| P0-4 shared payload limit | **设计闭合，代码待批次 A** | design:180-183/tasks:14 命名 `EXTENSION_EVENT_RECORD_MAX_BYTES` 并要求 Rust/TS 同值 fixture、EventHub 迁出私有常量；当前源码仍是 `event_hub.rs:63` 的旧私有常量，这是实现任务而非本轮规范矛盾。 |
| P0-5 consistency gate | **脚本闭合，正式触发链仍有 P1** | `package.json:31,35` 已挂入 verify，workflow:43-45 已加 step，16 条语义规则有 ruleId；但 PR `paths` 未包含 `openspec/**`、`scripts/openspec/**`、`package.json`，规范-only 提交不会触发该 workflow；6.2b 三臂 fixture 仍只是待实现任务。 |

## 3. P0 阻塞问题

### P0-1：DeferredCompletionPort 的 C 指针生命周期未冻结

- **落点**：`openspec/changes/add-ext-dialog/plans/design-reference.md:171-177`；对照 `crates/opentray-spec/src/ext.rs:197-217`。
- **问题**：设计声明“EventPort 同款生命周期”和 `port_data` 进程级存活，却把 attach 定义为 `port: *const ExtDeferredPortV1`。没有说明 host 传入的 struct 本身由谁持有、持有多久、扩展是否可以复制或保留该指针。若 broker 将栈上 struct 地址传入，扩展在 attach 返回后保存它即可形成悬空指针；若要求 host 永久分配，又缺少 ABI 责任和 teardown 规则。现有 EventPort 通过值传递 `ExtEventPortV1`，避免了这一新生命周期。
- **可验证修复**：优先将签名改为 `attach(instance, port: ExtDeferredPortV1)`，沿用 EventPort 的“按值复制小 struct、只保留 `port_data`”规则；或明确 `port` 指向 broker 进程级存活内存、扩展不得保留/必须按值复制，并加入 stale-pointer/attach-teardown fixture。同步冻结 `tag=0 Immediate`、`tag=1 Deferred`、未知 tag/非零 reserved 的 typed 拒绝规则，以及 V2-only extension 不再要求旧 `EXT_SYMBOL_COMMAND` 的条件 required-symbol 检验。

### P0-2：V2 disposition 的所有权边界仍有双输出歧义

- **落点**：design §5.1:163-169。
- **问题**：V2 函数同时有 `out_events` 参数和 `ExtCommandDispositionV1.value.events`；文字只说 deferred 时 `out_events` 必须为空、Immediate 时 `value.events` 沿用旧语义，没有明确 `out_events` 是旧 EventPort envelope 输出、命令结果，还是必须废弃的兼容槽位。实现者可能同时填充两处、重复投递或对同一 `ExtOwnedBytes` 双重释放。
- **可验证修复**：在 C ABI 表格中明确每个 tag 的输出矩阵：Immediate/Deferred 各字段是否必须为 null/zero、两块 bytes 是否独立所有权、host 逐字段释放责任和重复填充的错误码；若 `out_events` 仅是旧事件输出，改名/注明其与 disposition result 的独立语义，并加入 Immediate 双输出负例 fixture。

## 4. P1 重要问题

1. **CI workflow 对规范-only PR 不触发**：`.github/workflows/verify-native-artifacts.yml:5-13` 的 `pull_request.paths` 没有 `openspec/**`、`scripts/openspec/**`、`package.json`。应补路径或建立独立 spec-consistency workflow，并用一条只改 active spec 的 fixture PR 验证 gate 必跑。
2. **一致性 gate 的 allowlist 仍按整行跳过**：`check-ext-dialog-sound-consistency.mjs:16-26,72-80` 只要行内出现“移除/不承诺/retired”等 marker 就跳过整行；这可能放行同一行中同时存在真实规范冲突的文本。6.2b 三臂测试应实际落地，至少断言“合法负面引用放行、伪装 marker 的冲突命中、每个 ruleId 输出”。
3. **脚本违反跨平台路径法则**：`check-ext-dialog-sound-consistency.mjs:12` 使用 `new URL(...).pathname`，没有 `fileURLToPath()`；Windows 驱动器/空格路径可能被错误解析。应改为 `fileURLToPath(new URL(...))` 并加入 Windows path fixture。
4. **V2 能力诊断和 required-symbol 选择未给出 wire 形状**：现有 `REQUIRED_EXTENSION_SYMBOLS` 仍把旧 `opentray_ext_command` 列为 required，loader 仍在 `dynamic_extension.rs:350-352` 无条件取旧符号。批次 A 必须实现“V2-only、V1-only、两者同时存在、两者皆无”的矩阵，并把能力诊断字段固定到 broker log/DTO；否则设计虽说 V2→V1，现有加载器仍可能拒绝 V2-only DLL。
5. **shared constant 的数值与协议升级仍是实现门**：文档冻结了常量名和 1→2 全矩阵，但当前 `@opentray/spec`/`opentray-spec` 仍是 `PROTOCOL_VERSION = 1`，源码未有 `EXTENSION_EVENT_RECORD_MAX_BYTES`。这不再是设计矛盾，但没有批次 A 的 Rust/TS fixture、旧协议拒绝、socket endpoint/ready metadata 证据，不得宣称基建完成。
6. **sound CI 硬依赖仍主要是 tasks prose**：`add-ext-sound/tasks.md:11` 要求 needs/路径门，但当前 workflow 没有 sound-specific job 或 dialog-A artifact output。实现期应把 dialog A 的测试/产物作为可引用 job output，禁止仅凭文档排序启动 sound。
7. **AGENTS law 仍 provisional**：`AGENTS.md:547-580` 已正确沉淀法则，但没有 V2 symbol、shared-limit 数值和真实 pack receipt；归档前按实现证据定稿，不把当前章视为运行时证明。

## 5. 已确认无新矛盾的裁决

- dialog：Pending-only、DeferredCompletionPort 唯一终帧、pre/post Win32 wire timeline、macOS re-arm、Win32 cap 8/3s/2s、STA ownership 和 deinit-after-join 语义相互一致。
- sound：三项通用系统音名及双平台映射、`SND_ALIAS|SND_ASYNC|SND_NODEFAULT`、WAV 内容级前置校验、PlaybackArbiter 完整 token 和单 session 多 mount 场景保持一致。
- sound 的批次依赖仍正确：其共享 embedded/deferred/pack 基建必须由 dialog 批次 A 先落地并验证，不能并行绕过。

## 6. 最小解锁清单

1. 冻结 DeferredPort attach 为按值（或写明进程级指针存活/不可保留），补 tag 数值、未知/保留字段规则，以及 V2 disposition 两输出所有权矩阵。
2. 在 loader/spec fixture 中实现 V2-only/V1-only/双符号/缺失四格 required-symbol 与能力诊断矩阵。
3. 将 consistency workflow 的 PR paths 覆盖 `openspec/**`、`scripts/openspec/**`、`package.json`，落地 6.2b 三臂 fixture，并用 `fileURLToPath` 修正脚本路径。
4. 批次 A 实现并验证协议 version 2、共享 payload 常量、embedded identity/pack receipt；完成后才启动 dialog native B 和 sound。

## 7. 评分与最终判定

### `add-ext-dialog`: 8.2/10 — NO-GO

R5 的主要语义阻塞已解除，设计质量明显提升；但 DeferredPort 的裸指针生命周期和 disposition 双输出所有权仍可导致未定义行为、重复投递或双重释放，属于实现前必须冻结的 ABI 问题。

### `add-ext-sound`: 8.6/10 — NO-GO（依赖门）

sound 自身设计已接近可开工，三名表、native false 边界、WAV parser 和 arbiter 均无新语义矛盾；但它仍依赖 dialog 批次 A 的 ABI/共享常量/正式 gate，且当前依赖门还未成为可引用 CI job output。
