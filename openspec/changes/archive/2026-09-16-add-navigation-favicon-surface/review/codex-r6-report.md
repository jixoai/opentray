# add-navigation-favicon-surface R6 复审报告（自 pane transcript 重建存档）

> Codex 的执行沙箱 /tmp 与宿主不共享，原报告文件宿主不可达；本文件从
> herdr pane transcript 的完整结论段重建，逐字保留判定与评分依据。

## 结论

**NEEDS-WORK；代码面暂不 GO。综合评分：8.6/10（R5 为 8.0，+0.6）。**

统一修复确实消除了 R5 的 FIFO URL 伪造、永久 ever_blocked、状态码 14
和共享层平台常量——五项 R5 残余中四项已闭合。但 CancelLedger 的
"id 未命中且 pending > 0 就抑制并递减"仍在用时间窗口猜测 completion
身份：若普通导航失败与规则取消交错，普通失败会被吞掉。最后一项只是
从 FIFO 猜测收缩为 pending-window 猜测，仍未满足"普通 completion 不得
因无法归因的规则取消而丢失"的契约。

## 剩余 P2（R6 修复轮已处理）

可验证的最小修复是：让每次规则取消拥有可与 completion 精确关联的
generation/token；id 未命中时不得仅凭 pending > 0 抑制事件。至少补充
handler-level 交错测试：

- blocked A 后普通导航 B 失败，B 的 completion 必须正常产生 loadState.failed；
- blocked A completion 的 id 缺失或未知，只能消费 A 对应的取消记录；
- B 先完成、A 后完成，以及 A/B 乱序完成，均不得吞帧或重复终态；
- 重复 completion、controller destroy/recreate 和 ledger 清空后，不得命中前代取消记录。

## 质量评价（原文摘录）

实现质量较 R5 明显提升：取消状态已统一建模，平台专属常量回到 Windows
adapter，URL 不再通过 FIFO 伪造，普通用户取消也不再被 controller 生命
周期级状态永久屏蔽。但 admission 仍缺少可证明的身份关联，当前测试若只
覆盖"单一 blocked 导航 + 对应 completion"，无法证明真实交错场景安全。

## 独立验证（原文摘录）

spec 56/56、ext-webview orchestration 34/34、两包 typecheck、OpenSpec
strict、diff-check 通过；附件 Windows 194/194 + 52/52 与黑盒 11/11 可核对。
