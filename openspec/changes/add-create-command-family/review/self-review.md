# add-create-command-family — Self-Review (Round 2)

对照基准：`plans/plan.md`（Round 2，D1–D13）、`specs/` deltas、`tasks.md`。
复核闭环：Codex R1 3.5/10（B1–B5）→ 修复 → 本文 → Codex R2（进行中）。

## 实现输出 vs 意图

| 意图 | 实现 | 判定 |
|------|------|------|
| D1 单行 InputGroup + Dialog（草稿确定/取消） | `command-family-input.tsx` + `family-form-dialog.tsx`；页面高度不变；argv/?edit= 零改动 | 达成 |
| D2 六系列 + runner 清单 | core `NPM_RUNNERS/PYTHON_RUNNERS` + parse | 达成 |
| D3 分系列 appId（全名尾段/runner 归一/名称不含尾段） | core `deriveFamily`；E2E 六系列实证 | 达成 |
| D4 env 预设（注入/显式优先/可关/ack 沿用） | wizard `commandEnv` + `envPresetDisabled`；E2E true↔undefined 取证 | 达成 |
| D5 官方 SVG（simple-icons）+ Pencil | `brand-icons.tsx` + vendor icons | 达成 |
| D6 预设命令不进生产 | 生产组件无 chips；原型 dev-only 保留（a3a31ec） | 达成 |
| D7 不代执行 cargo install | R2 收紧：submitCommand 对 cargo install 头 failed 拒绝（E2E 实证未 spawn） | 达成（R1 不足，R2 闭合） |
| D8 argv/?edit= 现状 | string 模式独占新 UI；选非 custom 自动切回 string | 达成 |
| D9 单一解析权威 | R2 修订：显式 family 投影（D11）优先、否则命令派生；服务端 `familyState()` 唯一入口 | 达成（修订后） |
| D10 CLI/schema 不动 | 未触碰 | 达成 |
| D11 作者状态/选择器显式状态源 | `WizardCommandOptions.family` + 组件 selection + per-family 草稿缓存 | 达成 |
| D12 args 序列化保真 | `serializeArg/serializeArgs`（core+webui）；往返金样本 | 达成（保证域见偏差 1） |
| D13 hasEnv 同规则 | app.tsx 投影优先 + 预设激活判定 | 达成 |

## 偏差（Deviations from intent）

1. **D12 保证域收窄**：`tokenizeCommandLine` 既有配平法则拒绝含奇数单引号的 token（如 `"it's"`，先于本变更存在）。序列化按 POSIX 规范实现，但保证域 = tokenizer 接受域。修改 tokenizer 影响全部命令流，超出本变更范围。
2. **D11 跨系列切换仍为「重置模板」**：Codex 建议加确认或可恢复草稿。取舍：同系列重复点击已 no-op（消除主要误伤），跨系列切换是显式动作；如需确认对话框/撤销，等用户反馈再迭代。
3. **B3 采用客户端同规则而非服务端投影**：Codex 倾向服务端投影（契约扩张）。取舍：与 D9 镜像模式一致、零契约变更；服务端投影记为后续演进项。
4. **两个既有真实物化用例超时**：「force wipes…」「keeps the env overlay…」在 R1 基线（stash R2）同样失败、单跑/组合跑绿 → 环境性漂移，非本变更回归（tasks 5.8 如实记录）。
5. **边角**：`npx -c '<shell 字符串>'` 类命令的派生 appId 会把 shell 串清洗为段名（E2E 观察到）；作者状态机制可显式纠偏，不阻塞。

## 需用户确认的新问题

1. 跨系列切换直接重置命令，是否需要「确认/可撤销」？（偏差 2）
2. 分享 env 确认是否要升级为服务端投影契约？（偏差 3）
3. 两个环境性超时的真实物化用例是否另行立项处理？（偏差 4）

## 证据

- 测试：core 172 / create 245 / webui 48 全绿（create 的 2 个环境性超时见偏差 4）；三包 `tsc --noEmit` 绿；vision-driven 基线 16 绿 + schema valid。
- E2E（R1）：六系列 prime 默认值、bunx 归一、env true↔undefined 落盘取证（tasks 4.2）。
- E2E（R2）：rust 投影 `rg --json .` → `rg.rust`/`rg-rust`；cargo install failed 拒绝未 spawn；npm 投影 env 随开关/清空投影回派生（tasks 5.7）。
- Codex R1 结论：`/tmp/codex-review-add-create-command-family.md`（3.5/10，B1–B5）。
- GUI 冒烟：IAB 快照（选择器/只读区/env 图标/无错误浮层）。

## Git 证据

- `6b09564` docs(spec) → `e4cf887` feat(create) R1 → `a3a31ec` chore 原型 → `b992caa` docs(spec) R2 意图 → `aad8947` fix(create) B1–B5。
- 未提交路径：`.zcode/`（会话产物，不属于变更）；工作树其余干净。
- tasks 勾选均由当前上下文完成并验证后更新。

## 循环状态

- 迭代次数：2（R1 实现 + R2 修复）；未解决问题复发计数：0（B1–B5 首轮修复，待 R2 复核确认）。
- 下一循环动作：Codex R2 复核（同 herdr workspace agent）；若评分显著提升且无新阻塞 → `check` gate → 等用户验收后 archive。
- 退出条件判断：意图五要点（分系列 appId/env 预设/单行 InputGroup+Dialog/官方图标/预设不进生产）全部落地且 custom/?edit= 零回归 —— 已满足，以 R2 复核与用户验收为准。
