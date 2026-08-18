# Self-Review — create-no-first-launch-force-terminal

Reviewer: ZCode (GLM). Date: 2026-08-19. Iteration: 1.

## 实现与意图对照（plans/plan.md 决策 D1–D6）

| 决策 | 实现 | 证据 |
|------|------|------|
| D1 生成期不重跑命令 | `materialize()` = `materializePayload`；launch 阶段/marker/bundle 等待全删 | materialize.ts diff；CLI dry-run 不再列 `launch app`；验收：CLI create 三步即成 |
| D2 异常退出强制弹终端窗 | `command.exited.then` 检测（code≠0 / signal / 先于任何已验证服务退出）→ `revealTerminalWindow()`；ring 回放 | entry-template.ts；验收：`bash -c 'echo boom…; exit 3'` 应用弹窗，app.log 含注记 |
| D3 无上限自适应嗅探 | while 循环 + `nextIntervalMs()`（1s 活跃 / 5s 安静或 loadavg>核数 / 变化即回 1s） | entry-template.ts monitor 块；验收：dsh ~3min 后 3080 被发现并开窗，全程无死线 |
| D4 恒 PTY | 无条件 `import("@lydell/node-pty")` + 无条件依赖 + pipes 降级记录 | scaffold.ts deps；验收：app.log 出现 npx TTY spinner（旧 pipes 模式零输出） |
| D5 树杀 | 入口 killCommand（组杀+PPid sweep+SIGKILL 兜底）；预览 PTY/Bun kill 补 sweep | entry-template.ts / command-run.ts；验收：SIGTERM 后 npm exec/dsh 全灭、3080 释放 |
| D6 启动失败落盘 | `main().catch` → app.log 堆栈 + exit(1) | entry-template.ts 尾部 |

## 事实核查（对照事故取证）

- 事故机残留（昨日 16:49 孤儿 npm exec + 02:32 僵尸 main.mjs 树）已于实施前清理。
- dsh 行为确证：`web` 子命令默认监听 3080，被占时退避随机端口；HTTP 200 正常——旧 30s 门是唯一死因放大器。
- 原始 bug 复现路径在新代码下全程存活并最终成功（服务窗口打开）。

## Deviations from intent

1. **CLI 依赖范围既有缺陷顺带修复**：`readDependencyRange` 原读取私有 CLI 包自身版本（0.1.0 → 安装远古 opentray 0.1.0）。未在 plan.md 中列出，属验收中发现的阻塞级缺陷，已修（按 create-opentray 发布线解析）。
2. **shell 资产接线恢复**：f38da35 核心提取时 `resolveShellAssetsDir` 丢失（向导路径从未传 `shellAssetsDir`，shell 模式实际缺 UI 资产）。本次以 core 内默认解析器恢复（发布布局自引用 + 源码目录回退），非 plan 原文但为 D2 的必要前提。
3. **终端窗按需创建而非常驻隐藏**：plan「拒绝路径」已记录此选择（隐藏 appMode 窗口有 Dock 投影风险），实现遵守。

## New questions requiring user confirmation

1. 终端窗口目前只读展示异常（含输出回放与退出码）；是否需要「重启命令」操作（已标记为后续增强，不在本变更）？
2. 服务未出现期间 plain 应用只有托盘无窗口——是否需要可选「等待页」窗口（已标记为后续增强）？
3. `~/.opentray/create/npx` 与 `web-dsh-npx` 两个失败残留项目目录与旧版 bundle 仍保留在机上，是否由用户自行删除或重新生成？

## Evidence paths

- 测试：core 130 / create 188 / webui 15 / vision-driven 16 全绿（vitest + bun test）。
- 手工验收命令记录：CLI `create`（crash 与 dsh 两组）、冷启动 `node main.mjs`、`/api/events` snapshot 轮询、SIGTERM 清理检查（进程树、3080 监听、app.log）。
- 事故取证：`~/.opentray/create/{npx,web-dsh-npx}/app.log`（单行 sniff 超时）、pgrep/lsof 时间线（见 plans/plan.md 事实节）。

## Git evidence

- `b7a3cd7` docs(spec): intent/specs/tasks（spec 先行）。
- `898be55` fix(create): 实现 + 测试 + tasks.md 勾选（同提交）。
- 未提交路径：`.zcode/`（会话工件，不入库）。
- 任务勾选均由当前工作上下文完成并验证后勾选。

## Loop / exit-condition judgment

- 迭代次数：1（无未解决问题复发）。
- 复核闭环：**环境阻塞**——`HERDR_ENV != 1`，按全局规则不得自行启动外部 Codex（gpt-5.6-terra/xhigh）。等待用户在 Herdr pane 中运行复核，或明确豁免。
- 归档判断：自评通过，但按提交纪律「Archive only after acceptance」，归档推迟至用户验收 + Codex 复核通过后。
