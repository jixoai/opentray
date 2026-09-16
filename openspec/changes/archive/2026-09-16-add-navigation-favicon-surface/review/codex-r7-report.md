# add-navigation-favicon-surface R7 复审报告

## 结论

**GO（代码面）；综合评分 9.2/10。**

`df312331` 的 identity-precise 收紧满足 R6 最小修复要求：可读 completion id 只查 tombstone，未知可读 id 不消费 pending；pending 仅处理不可读 id 的 completion。R6 的普通交错失败被吞问题已闭合，R5 的五个 P2 均不再构成代码阻塞。

## 范围与证据

- R7 简报：用户提供的 `add-navigation-favicon-surface` R7 复审要求
- R6 基线：`85e8bba0`；R7 修复：`df312331`
- 实现：`crates/opentray-ext-webview/src/orchestration.rs`、`crates/opentray-ext-webview/src/windows/orchestration.rs`
- 规范：`openspec/changes/add-navigation-favicon-surface/specs/webview-navigation/spec.md`、`specs/webview-favicon/spec.md`、`specs/webview-extension/spec.md`
- 未跟踪 `.agents/documents/d19-extension-event-port-design.md` 未修改，保留。

本轮独立通过：

- `@opentray/spec` webview Vitest：**56/56 PASS**
- `@opentray/ext-webview` orchestration Vitest：**34/34 PASS**
- 两包 `tsc --noEmit`：**PASS**
- `openspec validate add-navigation-favicon-surface --strict`：**PASS**
- `git diff --check 85e8bba0..df312331`：**PASS**

附件证据可核对：macOS `ext-webview 189 + spec 52`；Windows 原始日志 `/tmp/win-r7.log` 实际为 `ext-webview 196/196 + spec 52/52`（高于简报写的 194，按原始日志计数）；黑盒 `/tmp/navfav-smoke/stdout7.log` 为 11/11 PASS，blocked 链为 `navigationAction` → 即时 `failed(4500001)`。macOS/Rust 与 Windows native 为 supplied evidence，本轮未在高 swap/已有 cargo 负载环境中重复重型构建。

## P1/P2 阻塞问题

### P1：无

未发现跨应用数据破坏、任意代码执行或所有平台启动失败问题。

### P2：无

### R5 五个 P2 对照

1. **starting-side id getter 双终态：已闭合。** Windows 在 `NavigationStarting` 决策点先发稳定 `failed(4500001)`，随后 `note_cancel(None/Some(id))`；后续失败 completion 由对应 tombstone 或不可读窗口抑制，终态不再推迟也不重复。
2. **FIFO orphan 错误归因：已删除。** `take_oldest_orphan()` 和 URL 伪造路径不存在；ledger 从不发帧、不携带 URL、不猜 completion 身份。
3. **`ever_blocked` 永久吞普通取消：已闭合。** 生命周期布尔及状态码 14 分类器已删除；可读未知 id 永远走普通路径，pending 只在不可读 completion 上消费并随窗口关闭。
4. **tombstone 过期/非 14 双终态：按 R7 取舍闭合交错丢帧风险。** 任何失败状态都进入 ledger 判定；新鲜 tombstone 精确抑制，淘汰 tombstone 的可读迟到 id 放行普通平台帧，避免误吞普通导航失败。该取舍可能留下极迟到的冗余平台失败帧，但不再以身份猜测为代价吞掉可读普通帧。
5. **共享层 WebView2 常量污染：已闭合。** `WEBVIEW2_OPERATION_CANCELED_STATUS` 与 `should_drop_unattributed_cancel` 已从 platform-neutral orchestration 删除。

## R6 最小验收清单核对

- **Readable interleave：通过。** `suppress_failed_completion(Some(unknown_id)) == false`，无论 B 先于 A、重复 B，均不消费 A 的 pending；A 命中 tombstone 后静默。
- **Unreadable window：通过。** `Some(id)` 永不查 pending；只有 `None` completion 消费 pending，计数归零后普通失败恢复发送。
- **Eviction：通过。** tombstone 淘汰后的可读 id 走普通路径；最新 tombstone 仍精确抑制；ledger twin 验证 6 次取消、2 个保留 tombstone、4 个 pending fallback 的计数关系。
- **即时终态：通过。** blocked URL 在决策点确定并发出 stable failed，completion 只承担抑制，不再承担终态生成。
- **隔离：通过。** controller-local ledger 随 observer 闭包生命周期销毁，fresh ledger 不消费前驱取消。

## 剩余问题（非代码 GO 阻塞）

### P3-1：Windows 注释残留旧的 eviction 语义

`windows/orchestration.rs` 的 completion 注释仍写着“unreadable or evicted ids fall back to the outstanding-cancellation counter”，但 R7 实现对可读 evicted id 明确放行，只有 `None` 才查 counter。应在发布前同步注释，避免维护者误以为 evicted readable id 会被抑制。

### P3-2：真实 COM handler 异常路径覆盖仍弱于纯 ledger twin

R7 新增测试主要验证 `CancelLedger` 纯状态机；没有独立 fake `NavigationStarting/Completed` handler 测试覆盖 getter error、可读未知 id、重复 completion 和 eviction 后的 native frame序列。Windows native 全量日志与黑盒通过足以支持代码 GO，但发布前应补 handler-level fixture，防止闭包接线偏离纯函数契约。

### P3-3：Release/Docs 尚未执行

`tasks.md` 的 4.3、5.1 changeset、5.2 skill/API/contract 文档和 5.3 中英文博客仍为 `[ ]`。这是发布交付项，不阻塞本轮代码面 GO；应在 Owner 接受后完成。

## 实现质量评价

R7 的重构边界清晰：终态生成留在 native decision point，ledger 只做抑制判定；共享层不再知道 Windows 错误码；URL 不再从 completion 侧猜测。`CancelLedger` 的三类状态转移（精确 tombstone、不可读 fallback、窗口关闭）均有 twin，且 fresh-ledger 隔离保持可验证。

剩余设计妥协被明确写出：不可读 completion 没有身份时，pending 窗口内的普通不可读失败可能被抑制；这是真正的无身份边界，而非 FIFO 或生命周期布尔猜测。淘汰 tombstone 选择允许极迟到冗余帧，优先保护可读普通导航，这是 R6 问题的正确风险方向。

## Standards / Spec 轴

- **Standards：** 未发现新的 hard violation；R6 暴露的平台常量污染已删除。P3-1 是注释与实现不同步，属于维护质量问题。
- **Spec：** navigation spec 的 action-first、同步 veto、稳定 blocked error code 和 exactly-one decision terminal 均已满足；favicon resolver/Latest query 语义未回归。

## 综合评分与 R6 变化

**9.2/10，GO。**

评分依据：

- `+2.4`：R5 五个 P2 全部有明确结构性修复，不再靠 FIFO、永久布尔或平台状态码猜测。
- `+1.8`：identity-precise readable interleave、unreadable-only window、eviction pass-through 和 fresh-ledger twins 齐全。
- `+1.6`：即时终态、favicon URL 解析、订阅门控和协议主链保持正确。
- `+1.5`：本轮 spec/ext-webview 测试、typecheck、OpenSpec strict、diff-check 全绿；Windows/黑盒附件可核对。
- `-0.6`：不可读普通失败在 pending 窗口内仍存在文档化近似，无法进一步精确归因。
- `-0.3`：handler-level fixture、注释同步和 release/docs 尚待完成。

R6 为 **8.6/10 NEEDS-WORK**。R7 上升 **0.6 分**：最后一个 readable interleave 丢帧窗口已由“可读 id 只查 tombstone”闭合，代码面从 NEEDS-WORK 进入 GO；剩余项均为 P3 交付/证据完善。

## GO 后动作

1. 修正 Windows completion 注释并补 handler-level getter-error/eviction fixture。
2. 执行 `tasks.md` 4.3、5.1、5.2、5.3，记录 changeset、contract fingerprint、公共 skill 和博客产物。
3. 保留实际日志计数（Windows 196/196，不使用简报 stale 的 194）并在发布记录中标注 macOS/Windows 平台边界。
