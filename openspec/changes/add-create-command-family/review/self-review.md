# add-create-command-family — Self-Review (Round 4)

对照基准：`plans/plan.md`（Round 2，D1–D13）、`specs/` deltas、`tasks.md`。
复核闭环：Codex R1 3.5/10（B1–B5）→ R2 修复 → Codex R2 5.5/10（剩恢复链 + 带值 flag）→ R3 修复 → Codex R3 6.0/10（剩 cargo 路径绕过 + 客户端 tokenizer 近似）→ R4 修复（本稿，待 R4 复核）。

## Round 4 增量（d39e81c）

| 阻塞 | 修复 | 证据 |
|------|------|------|
| R3-B1 cargo 路径绕过（`/opt/homebrew/bin/cargo install` 溜过字面头判定） | 两级判定：字面头 + resolveOnPath 解析后可执行文件名（basename cargo 且首非选项子命令 install；新增 WizardOptions.resolveOnPath seam） | wizard.test 三用例（路径形式/seam 裸名/非 cargo 放行） |
| R3-B2 客户端轻量 tokenizer 近似（转义差异域 + 投影被升为权威） | webui 依赖 shell-quote（^1.10.0，与 core 同版本），镜像 tokenizeCommand 与 core tokenizeCommandLine 逐行对齐（配平 + op 拒绝） | `npx tool a\ b` 转义金样本进 core（32）与 webui（49）两份测试 |
| （UI）选择器可供性 | 品牌图标 + ChevronDown 下拉箭头（w-11），含用户手动微调的两端布局 | typecheck/测试绿；生产资产重建 |

测试：core 32 / create 248 / webui 49 全绿；三包 typecheck 绿；validate 通过。

## 偏差（Deviations from intent）

1. **D12 保证域收窄**：`tokenizeCommandLine` 既有配平法则拒绝含奇数单引号的 token（如 `"it's"`，先于本变更存在）。序列化按 POSIX 规范实现，但保证域 = tokenizer 接受域。修改 tokenizer 影响全部命令流，超出本变更范围。
2. **D11 跨系列切换仍为「重置模板」**：同系列重复点击已 no-op；跨系列确认/撤销待用户反馈再迭代。
3. **B3 采用客户端同规则而非服务端投影**：与 D9 镜像模式一致；服务端投影记为后续演进项。R4 起客户端 tokenizer 与 core 同源，该取舍的漂移风险已消除。
4. **R4 复核未执行**：Codex 会话异常（hook 超时/中断，R3 结论文件未能落盘、从终端缓冲还原），由用户接手处理 Codex 环境；R4 修复基于 R3 结论完成，独立复核待用户恢复后补跑。

## 需用户确认的新问题

1. 跨系列切换直接重置命令，是否需要「确认/可撤销」？
2. 分享 env 确认是否要升级为服务端投影契约？
3. Codex 环境恢复后是否补跑 R4 复核（建议：是）。

## 证据

- 测试：core 32 / create 248 / webui 49 全绿；三包 `tsc --noEmit` 绿；vision-driven 基线绿。
- E2E：六系列推导、env true↔undefined 落盘取证、rust 投影重启恢复（快照 + UI）、cargo install 字面/路径拒绝未 spawn、带值 flag 回落 custom。
- Codex 结论：R1 `/tmp/codex-review-add-create-command-family.md`（3.5）、R2 `…-r2.md`（5.5）、R3 6.0（终端缓冲还原，原文因 codex 写文件 hook 超时未落盘）。
- GUI 冒烟：IAB 快照多轮（选择器/只读区/env 图标/Rust 恢复/无错误浮层）。

## Git 证据

- `6b09564` docs(spec) → `e4cf887` feat R1 → `a3a31ec` chore 原型 → `b992caa` docs(spec) R2 → `aad8947` fix R2 → `05b2211` docs(spec) R3 → `6bbbaa1` fix R3 → `d39e81c` fix R4（含用户微调）。
- 未提交路径：`.zcode/`（会话产物）；review/ 工件随本稿提交。
- tasks 勾选均由当前上下文完成并验证后更新。

## 循环状态

- 迭代次数：4（R1 实现 + R2/R3/R4 修复）；评分轨迹 3.5 → 5.5 → 6.0 → 待 R4。
- 下一循环动作：用户恢复 Codex 后补跑 R4 复核；通过则 `check` gate → 用户验收 → archive。
- 退出条件判断：意图五要点全部落地；两轮阻塞均收敛至「边界保真」主题且本轮已按结论闭合，待独立复核确认。
