# create-no-first-launch-force-terminal — Tasks

## 1. Alignment / Investigation

- [x] 1.1 `plans/plan.md` 记录代码勘察、既有 OpenSpec 勘察与全部用户 Q&A（2026-08-19）。
- [x] 1.2 破坏性清理确认：事故孤儿进程（昨日 16:49 npm exec 树、02:32 僵尸 main.mjs 树）已在用户批准的计划内清理完毕。

## 2. BDD Contract

- [x] 2.1 materialize：install 完成即 success（无 launch/bundle 步、无子进程、无 ready-marker 等待）——trace 到 `create-materialize-pipeline` R1。
- [x] 2.2 open-app：Darwin 无 bundle 时 detached 冷启动 `node main.mjs`，有 bundle 时维持 `open`——trace 到 R2。
- [x] 2.3 entry 渲染：恒 PTY（含降级）、无阻塞嗅探门、自适应 monitor（1s→5s、状态变化回快）、异常退出强制弹终端窗（exitCode≠0 或先于任何服务退出）、树杀、顶层 catch——trace 到 `generated-app-entry` R1–R5。
- [x] 2.4 scaffold：shell server + app-shell 资产 + `@lydell/node-pty` 无条件装配。
- [x] 2.5 command-run：预览 PTY kill 扫后代并有界等待。
- [x] 2.6 边界：随机端口/多端口、安静退避、退出码 0 但先于服务退出仍算异常、PTY 依赖缺失降级不致命。
- [x] 2.7 每个任务仅由当前工作上下文中完成并验证过它的 agent 勾选。

## 3. Implementation

- [x] 3.1 `bun run openspec:vision -- commit-check create-no-first-launch-force-terminal --phase apply` 通过后先提交 OpenSpec artifacts。
- [x] 3.2 `materialize.ts`：删除 launchGeneratedApp/firstLaunchEntry/READY_MARKER/waitForDirectory；`materialize` = payload；结果类型收敛。
- [x] 3.3 `wizard.ts`/`server.ts`/`commands.ts`：payload-only 成功流；pinHint 文案；无 bundlePath。
- [x] 3.4 `open-app.ts`：Darwin 冷启动回退 + 测试。
- [x] 3.5 `scaffold.ts`：恒装 shell 资产与 PTY 依赖 + 测试。
- [x] 3.6 `entry-template.ts`：入口重构（恒 PTY/自适应 monitor/异常弹窗/树杀/顶层 catch）+ 渲染断言。
- [x] 3.7 `command-run.ts`：`startPtyRun.kill()` 后代 sweep + 有界等待。
- [x] 3.8 `create-dialog.tsx`：步骤徽章收敛为 scaffold/icon/install。
- [x] 3.9 关键效果点补意图注释（指向 plans/plan.md 决策编号 D1–D6）。

## 4. Verification

- [x] 4.1 `bun test packages/create` 全绿（含更新后的既有用例）。
- [x] 4.2 `bun run openspec:vision -- validate create-no-first-launch-force-terminal` 通过。
- [x] 4.3 macOS 手工验收（2026-08-19 完成）：CLI 三步生成成功（无 launch/bundle 步）；崩溃应用冷启动 → 命令 exit 3 → 强制弹终端窗（app.log 含命令输出+异常退出注记）；Darwin bundle 首次运行物化（~/.opentray/apps/test-crash-accept）；dsh 原始失败命令冷启动 → PTY 内 npx spinner 可见 → ~3min 后 dsh 监听 3080，monitor 自动发现+HTTP 验证并开服务窗口（远超旧 30s 死线，入口全程存活）；SIGTERM 退出：入口/npm exec/dsh 全树清杀、3080 释放、app.log 保留完整 PTY 历史。
- [ ] 4.4 self-review artifact + commit-check，OpenSpec 提交。
