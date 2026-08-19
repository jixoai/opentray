# add-create-command-family — Self-Review (Final)

对照基准：`plans/plan.md`（Round 5，D1–D13 含 D11a）、`specs/` deltas、`tasks.md`。
复核闭环（8 轮）：R1 3.5 → R2 5.5 → R3 6.0 → R4/R5 5.0 → R6 6.5 → R7 6.0 →（算法升级：Codex gpt-5.6-terra/max 接管实现）→ R8 7.8 → R9 **9.4 通过**。结论文件：/tmp/codex-review-add-create-command-family*.md（r1–r8）。
Proof gate：`bun run openspec:vision -- check add-create-command-family` → ok:true。

## 最终状态

- 意图五要点全部落地：分系列 appId（runner 归一 + 全名尾段 npmjs/golang/rust/python/dotnet）、env 预设（用户 env 行唯一可信源的双向投影）、单行 InputGroup + 会话化表单 Dialog、官方 SVG 图标、预设命令不进生产；custom/?edit= 零回归。
- 草稿生命周期经 Codex max 实现的 DialogSession 模型闭合（打开快照 / 会话内跨系列暂存 / 取消四路径整体丢弃 / 确定仅提交当前系列 / D11a SSE 合流），组件交互测试矩阵锁定（webui 62）。
- 安全边界：cargo install 保守完备禁跑（realpath 归一 + argv 含独立 install token 即拒，误拒边界入法 D7/spec）；参数 POSIX 对称序列化 + shell-quote 双端同源，往返逐项无损。
- 测试终值：core 32 / create 249 / webui 62；三包 typecheck 绿。

## 遗留（非阻塞，复核确认不影响闭合）

1. 确定路径的 callback recorder 精确断言（作者投影与命令串同时只提交当前系列）。
2. command-display / command-options 分离 SSE 事件的乱序时序测试。
3. 会话 reducer / projectionCache 拆分为 controller hook（归档后重构轮，已在文件头声明）。
4. Windows 原生 cargo 路径判定 CI 用例（CARGO.EXE/重解析点，本地仅符号链接测试）。

## Git 证据（12+ 笔）

6b09564 docs(spec) → e4cf887 feat R1 → a3a31ec chore 原型 → b992caa/aad8947 R2 → 05b2211/6bbbaa1 R3 → d39e81c R4+箭头 → 04ac1dc R5 投影 → bd8da4a R6 → ffa974a R7 → f2e4f01 R8（codex max）→ 984d6f9 R9 → 本稿工件提交。未跟踪：`.zcode/`（会话产物）。

## 循环终态

迭代 9 轮（R1 实现 + 8 轮复核/修复，其中 R8 由 Codex max 按算法升级规则接管实现）；退出条件满足：R9 复核 9.4 通过 + check gate ok。下一步：用户浏览器验收 → `openspec archive add-create-command-family`（归档提交为最后一步）。
