# create-no-first-launch-force-terminal — Tasks

## 1. Alignment / Investigation

- [x] 1.1 `plans/plan.md` 记录代码勘察、既有 OpenSpec 勘察与全部用户 Q&A（2026-08-19）。
- [x] 1.2 破坏性清理确认：事故孤儿进程（昨日 16:49 npm exec 树、02:32 僵尸 main.mjs 树）已在用户批准的计划内清理完毕。

## 2. BDD Contract

- [ ] 2.1 materialize：install 完成即 success（无 launch/bundle 步、无子进程、无 ready-marker 等待）——trace 到 `create-materialize-pipeline` R1。
- [ ] 2.2 open-app：Darwin 无 bundle 时 detached 冷启动 `node main.mjs`，有 bundle 时维持 `open`——trace 到 R2。
- [ ] 2.3 entry 渲染：恒 PTY（含降级）、无阻塞嗅探门、自适应 monitor（1s→5s、状态变化回快）、异常退出强制弹终端窗（exitCode≠0 或先于任何服务退出）、树杀、顶层 catch——trace 到 `generated-app-entry` R1–R5。
- [ ] 2.4 scaffold：shell server + app-shell 资产 + `@lydell/node-pty` 无条件装配。
- [ ] 2.5 command-run：预览 PTY kill 扫后代并有界等待。
- [ ] 2.6 边界：随机端口/多端口、安静退避、退出码 0 但先于服务退出仍算异常、PTY 依赖缺失降级不致命。
- [ ] 2.7 每个任务仅由当前工作上下文中完成并验证过它的 agent 勾选。

## 3. Implementation

- [ ] 3.1 `bun run openspec:vision -- commit-check create-no-first-launch-force-terminal --phase apply` 通过后先提交 OpenSpec artifacts。
- [ ] 3.2 `materialize.ts`：删除 launchGeneratedApp/firstLaunchEntry/READY_MARKER/waitForDirectory；`materialize` = payload；结果类型收敛。
- [ ] 3.3 `wizard.ts`/`server.ts`/`commands.ts`：payload-only 成功流；pinHint 文案；无 bundlePath。
- [ ] 3.4 `open-app.ts`：Darwin 冷启动回退 + 测试。
- [ ] 3.5 `scaffold.ts`：恒装 shell 资产与 PTY 依赖 + 测试。
- [ ] 3.6 `entry-template.ts`：入口重构（恒 PTY/自适应 monitor/异常弹窗/树杀/顶层 catch）+ 渲染断言。
- [ ] 3.7 `command-run.ts`：`startPtyRun.kill()` 后代 sweep + 有界等待。
- [ ] 3.8 `create-dialog.tsx`：步骤徽章收敛为 scaffold/icon/install。
- [ ] 3.9 关键效果点补意图注释（指向 plans/plan.md 决策编号 D1–D6）。

## 4. Verification

- [ ] 4.1 `bun test packages/create` 全绿（含更新后的既有用例）。
- [ ] 4.2 `bun run openspec:vision -- validate create-no-first-launch-force-terminal` 通过。
- [ ] 4.3 macOS 手工验收：dsh 命令三步生成成功；打开应用冷启动；服务窗口（随机端口）自动打开；构造异常退出强制弹终端窗回放输出；退出无孤儿（lsof/pgrep 复查）。
- [ ] 4.4 self-review artifact + commit-check，OpenSpec 提交。
