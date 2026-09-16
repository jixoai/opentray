# add-navigation-favicon-surface R4 复审报告

## 结论

**NEEDS-WORK；代码面暂不 GO。综合评分：8.2/10。**

R4 已修复 R3 的 action-first 顺序，并用 tombstone 覆盖常规容量淘汰后的迟到 completion；favicon resolver 仍保持标准 `Url::parse + join`。但 blocked 导航的 exactly-once 语义仍不是无条件成立：完成侧 `NavigationId()` 读取失败会丢失稳定终态；tombstone 只有 64 项，超过窗口后旧 completion 会回到普通平台失败路径。两项都直接落在 OpenSpec 的 blocked 链和稳定错误码契约上，因此不能进入 GO 后的发布步骤。

## 复审范围与证据边界

- 简报：`/tmp/navfav-codex-brief-r4.md`
- R4 候选实现：`22e4b2435ef6e4585fe515b94c3c11aa9a65bb80`
- 候选父提交：`be155c50af5c9e7a41b072a52c4cdffa9e7cf73a`
- 当前 HEAD：`0eea679f5f31b1a16fc5ec3428c70ea2500af912`；仅多了 R3 归档报告，未改变候选实现
- 候选 diff 仅涉及：
  - `crates/opentray-ext-webview/src/orchestration.rs`
  - `crates/opentray-ext-webview/src/windows/orchestration.rs`
- 对照文档：
  - `openspec/changes/add-navigation-favicon-surface/plans/plan.md`
  - `openspec/changes/add-navigation-favicon-surface/tasks.md`
  - `openspec/changes/add-navigation-favicon-surface/specs/webview-favicon/spec.md`
  - `openspec/changes/add-navigation-favicon-surface/specs/webview-navigation/spec.md`
  - `openspec/changes/add-navigation-favicon-surface/specs/webview-extension/spec.md`

仓库已有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 未修改。

本轮独立执行：

- `@opentray/spec` webview Vitest：**56/56 PASS**
- `@opentray/ext-webview` orchestration Vitest：**34/34 PASS**
- 两包 `tsc --noEmit`：**PASS**
- `openspec validate add-navigation-favicon-surface --strict`：**PASS**
- `git diff --check 22e4b243^..22e4b243`：**PASS**

简报提供的 native/black-box 证据未全部由本轮重跑，但可核对原始附件：

- `/tmp/win-r4.log` 实际为 **193/193 ext-webview + 52/52 spec**，而简报写成 Windows ext-webview **192**；按原始日志记录，不将 stale count 升级为简报数字。
- `/tmp/navfav-smoke/stdout4.log` 的 blocked 链为 `navigationAction(link)` → `loadState failed(4500001)`，11/11 PASS。
- macOS 186 + spec 52 为简报提供证据；本轮未在当前高 swap/已有 cargo 负载环境中重复启动 Rust 构建。

## 阻塞问题

### P2-1：完成侧 `NavigationId()` getter 失败会丢失 blocked 终态

证据：`crates/opentray-ext-webview/src/windows/orchestration.rs:578-596`。

`NavigationStarting` 成功读取 id 后把 `(id, url)` 放入 ring；`NavigationCompleted` 再次读取 id，失败时直接 `return Ok(())`。这两个 COM getter 不是事务性配对，不能假定“起始成功则完成必然失败或成功一致”。因此存在可执行路径：

1. action 已推送，规则命中；
2. starting id 读取成功，ring 入账并取消；
3. completed id 读取失败，既不消费 ring，也不发送 `failed(navigation_blocked)`。

这违反 `specs/webview-navigation/spec.md:28-30` 的稳定 blocked 链和 one-terminal 要求。当前 586-591 行注释把“稳定帧已发出”写成不变量，但代码没有保证它。

可验证修复：为 controller 保留不可依赖完成侧 id 的 fallback 状态，或在 completed getter error 时按可关联的 controller-local canceled generation 发出一次稳定 blocked failure并清理；至少增加“start id OK / completed id error”和对应重复 completion 的 handler 测试。不能只记录日志后丢帧。

### P2-2：64 项 tombstone 过期后仍可产生第二条 terminal failure

证据：`crates/opentray-ext-webview/src/orchestration.rs:495-505,550-578`，调用方 `windows/orchestration.rs:598-663`。

淘汰时立即发稳定 `failed(navigation_blocked)` 并把 id 放入 tombstone；但 tombstone 满 64 后会 `pop_front()` 最旧 id（557-560 行）。该 id 的迟到 completion 随后返回 `CompletionOutcome::Ordinary`，调用方继续读取共享 `pending_url` 并发送普通 `WebErrorStatus` 失败。于是同一 blocked navigation 可能收到两条 terminal failure，且第二条 URL 还可能属于另一条普通导航。

这不是假设性代码分支：测试明确把 tombstone 过期定义为 `Ordinary`（1606-1619 行），注释也承认这是 residual duplicate window。它与 spec 的稳定错误码/单一 blocked 终态不一致；“pathological”不是 OpenSpec 的例外条件。

可验证修复：不要让已发终态的 id 回到普通失败路径。可改为更强的 controller-local generation/取消记录，或将 tombstone 的容量与 WebView2 可存活 completion 的生命周期绑定；任何无法归因的 completion 只应丢弃并记录诊断，不能发普通 failed。增加 65+ eviction、乱序 completion、重复 completion 的 handler-level 测试，断言每个 blocked URL 至多一条失败且稳定码优先。

### P3-1：发布/公共文档任务仍未闭合

`tasks.md:29-31` 的 5.1 changeset、5.2 `skills/opentray` 文档与 contract fingerprint、5.3 博客仍为 `[ ]`。按 R4 简报这些任务在代码 GO 后执行，所以不是本轮唯一代码阻塞；完成 P2 修复并重新验收后仍必须补齐。

## 已核对的 R3 修复

1. **action-first：已修复。** `windows/orchestration.rs:438-468` 先推送 `navigationAction` 并同步求值规则，只有 blocked 分支才读取 `NavigationId`；允许导航不会因 id getter 失败丢失 `started`。blocked 的 id 读取失败路径为 action → stable failed → cancel。
2. **普通 eviction exactly-once：部分修复。** `BlockedNavigationRing` 新增 `CompletionOutcome::{Blocked, AlreadyTerminal, Ordinary}`；被淘汰 id 会进入 tombstone，正常迟到 completion 命中 `AlreadyTerminal` 且不再发帧。问题在于 tombstone 过期和 completed getter error 两个异常窗口仍未闭合。
3. **teardown 隔离：基本改善。** 每个 controller/observer closure 独立持有 ring，fresh-ring twin 测试证明后继 ring 不会匹配前驱 id；但这仍是 ring-level proof，不是实际 controller token/drop 的平台测试，作为非阻塞证据缺口保留。
4. **favicon resolver：保持通过。** `Url::parse + join`，join 前后均要求 HTTP(S)+host，R2 adversarial URL 表仍覆盖 query、fragment、dot segments、authority 和 malformed IPv6。

## 实现质量评价

优点：

- action-first 重排直接修复了 R3 的事件顺序缺陷，且没有让 allowed 导航依赖 `NavigationId`；
- `BlockedNavigationRing` 将 URL 配对、淘汰补偿、tombstone 消费和 fresh-ring 隔离抽为纯逻辑，测试可读性和可验证性明显提升；
- native veto、EventPort 分类、favicon Latest/query 序列对和共享 URL resolver 的整体边界保持清晰；
- 本轮 JS、TypeScript、OpenSpec strict、diff-check 全部独立通过，原始 Windows 日志与黑盒日志也可读取。

短板：

- completed getter error 仍用注释假设替代状态机保障；
- tombstone “有界”与“exactly-once”两个目标冲突，当前实现选择了内存上限，却把无法归因的完成重新放进普通失败路径；
- native handler 层仍缺少真正覆盖 getter-error 和 64+ 乱序 completion 的测试，ring 纯测试不足以证明外层帧行为。

## Standards

- 本轮未发现新的 hard standards violation；diff 范围窄，未引入 TS `any`、格式/空白问题，导出的 `CompletionOutcome` 和 ring 方法有解释性注释。
- 质量层面的 P2 与 Spec 轴相同：完成侧 getter error 和 tombstone fallback 是失败路径契约缺陷，不只是 Fowler smell。
- 现有 warning（Windows 日志中的 unused `note_load_progress`、`BlockedNavigationRing::len` 等）不构成本轮新增 blocker，但可在发布前清理或确认其测试/跨平台用途。

## Spec

- `webview-navigation/spec.md:7` 的 action-first 顺序：R4 已满足正常和 starting-id-error 路径。
- `webview-navigation/spec.md:28-30` 的 blocked action → stable failed 链：仍被 completed-id-error 与 tombstone-expiry 两条路径破坏。
- favicon delta 的 absolute HTTP(S) href 约束：R4 保持满足，resolver 由共享 `url` crate 实现。

## 综合评分与 R3 变化

**8.2/10，NEEDS-WORK。**

评分依据：

- +2.0：R3 action-first 缺陷已修复，允许/blocked getter-error 的起始顺序清晰；
- +1.8：tombstone、`AlreadyTerminal`、fresh-ring 隔离和纯逻辑 twin 测试显著补强常规 exactly-once；
- +1.5：favicon resolver、事件门控、native veto 和协议主链保持正确；
- +1.2：本轮 JS 56/34、两包 typecheck、OpenSpec strict、diff-check 独立通过，且 Windows/black-box 原始证据可核对；
- -0.9：completed id getter error 可丢稳定终态（P2）；
- -0.7：64 项 tombstone 过期可重新发送普通失败（P2）；
- -0.4：release/docs 待办、native handler 异常路径覆盖和 supplied-count mismatch。

R3 为 **7.8/10 NEEDS-WORK**。本轮上升 **0.4 分**：action-first 与常规 eviction duplicate 已实质收敛，Windows/macOS/黑盒证据更完整；但两个异常窗口仍阻止 GO。

## GO 前最小验收清单

1. 修复 completed-side `NavigationId` getter error：start-id 已入账时必须仍能发出且只发一次稳定 blocked failure。
2. 移除 tombstone 过期后的 Ordinary fallback，或用 controller-local generation/取消状态保证所有已补偿 id 的 late completion 永不再次发普通 failure。
3. 增加 handler-level tests：start-id OK/completed-id error、64+ 乱序 completion、重复 completion、以及 destroy/recreate stale completion。
4. 修复后重新记录 macOS/Rust、Windows 真机和黑盒原始输出，确保 receipt count 与日志一致。
5. GO 后执行 changeset、skill/contract 文档和博客任务。
