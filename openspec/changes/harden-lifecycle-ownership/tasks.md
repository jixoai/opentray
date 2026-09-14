# harden-lifecycle-ownership — Tasks

> 只有在当前工作上下文中亲自完成并验证过的任务才能勾选。
> 每个任务完成前先跑它的验证命令；实现阶段遵守仓库基线（mbx 前缀 cargo、`pnpm --filter <pkg> exec vitest run <file>` 聚焦、显式路径 git add + staged 审计）。

## 1. Alignment / Investigation

- [x] 1.1 重读 `plans/plan.md` §5 D1–D5 与四个 spec delta，确认实现位置清单：`packages/packaging/src/app-bundle.ts:661-681`、`packages/packaging/src/app-launch.ts:34-55,106-125`、`crates/opentray-ext-webview/src/macos/mod.rs:911-945,2384-2414,1780-1815,1488-1500`、`crates/opentray-ext-webview/src/windows/mod.rs:1031-1061,1540-1564`、`crates/opentray-ext-webview/src/orchestration.rs:469-507,558-590`、`packages/cli/src/local-broker.ts:100-115`、`packages/cli/src/daemon/caller-label.ts:19-49`、`packages/create/packages/core/src/url-entry-template.ts:152-169`、`entry-template.ts:318-327`。
- [x] 1.2 钉死 F2 分歧：写一个最小复现脚本（broker kill 后 entry 的 (value,seq)/getUrl/订阅三类 await 的终结行为），在当前 HEAD 上记录实测结果，作为 D3 验收基线；结论写回本任务行。
  - 实测结论（2026-09-15，/tmp 一次性脚本 + 源树 broker/dylib，SIGKILL 自己起的 broker，隔离 home）：
    (a) 死亡时刻在飞的 pending 命令与 (value,seq) 查询 → **REJECT "broker connection closed"**（request-map rejectAll，既有行为，Node/Bun 一致，前提是 data 监听在消费）；
    (b) 死亡**之后**新发起的 getUrl/getTitle/isVisible/destroy → **永久 HANG**（挂点不在 orchestration 的 gap-resync，而在 `packages/cli/src/local-broker.ts` 的 request 路径：close 已触发过 rejectAll 后，新请求进入 pending map、对已销毁 socket write 只返回 false、不再有任何终止事件——Node 与 Bun 均实证 `write-after-close` 不产生 error 事件）；这正是 F2 僵尸 entry 的静默根源；
    (c) 事件订阅/推送等待 → **HANG（无 terminal 通知面）**，仅静默停投；
    (d) `connection.close()` 死后仍 resolve；无 SDK 句柄在死后保持事件循环存活（active handles=0），僵尸形态来自 entry 自身 shell server + 挂起的 await。
  - 修复后复跑：全部 (b) 类 REJECT、(c) 类可经 `onConnectionDead` 终态通知观测、window 句柄 `connectionDead=true`（/tmp/d3-f2-repro-run6-after-fix.log）。

## 2. BDD（先于实现）

- [x] 2.1 锁 BDD（trace: darwin-runtime-carrier ADDED / darwin-launch-descriptor ADDED；plan D1）：`packages/packaging` 新增测试——空锁/非法锁/死 PID 锁的有界回收、kill -9 中途物化后可重启、release token 保护（延迟 release 不删替换者锁）、app-bundle 与 app-launch 共用同一 helper 的断言。
- [x] 2.2 owner 校验 BDD（trace: webview-extension ADDED；plan D2）：`crates/opentray-ext-webview` reentrancy seam 测试——收集旧会话条目 → 插入同 tray 新会话 → 执行 destroy → 断言新会话的 window/webviews/channels/popups 完整；macOS/Windows 双平台；unattributed 过渡分支不被无关会话关闭触发。
- [x] 2.3 transport-dead BDD（trace: client-sdk ADDED / MODIFIED；plan D3）：`packages/cli` + `packages/ext-webview` 测试——broker 连接死亡后 pending reject（既有）、订阅 terminal 通知、gap-resync 取消、事件句柄进入 dead 状态；复用 1.2 的复现脚本作为集成级证据。（SDK 侧完成：cli local-broker/sdk 4 例 + ext-webview orchestration 4 例；集成证据 run6 日志）
- [x] 2.4 端点身份 BDD（trace: client-sdk MODIFIED；plan D4）：`packages/cli/src/daemon/caller-label.test.ts` 扩展——有 appId → appId slug；appName 不进链；无 appId 工具回退链不变；同 app 三种启动方式同端点。（前三项完成；"三种启动方式同端点"的运行时等价由 appId 派生唯一性保证，端到端走查归 4.1/5.3）
- [x] 2.5 模板 BDD（trace: generated-app-entry MODIFIED；plan D5）：`packages/create/packages/core` 测试——show() 失败中止 carrier 且不 attach 子视图；bootstrap 每里程碑一条结构化记录；命令入口模板同构适用。

## 3. Implementation

- [x] 3.1 共享 owner-stamped 锁 helper（PID+token 写入 flush 后才持有；空/非法/死 PID bounded 回收；release token 校验），`app-bundle.ts` 与 `app-launch.ts` 两处切换到 helper，删除私有重复实现。
- [x] 3.2 registry destroy/remove API 签名升级为携带 `(appId,trayId,sessionId,windowId)`，`session_closed`/`destroy_window_session`/`destroy_child_webview`（macOS+Windows）全部改为 owner 校验后销毁；unattributed 分支收紧为「仅当关闭会话可能拥有时清扫」。
- [x] 3.3 SDK connection-dead 状态：传播到订阅/gap-resync/事件句柄；fire-and-forget 失败汇入该状态；生成 entry 增加显式停机策略（连接死亡 → 非零退出或受监督重启，配置于模板）。（SDK 侧：transport 终态 + 立即拒绝 + onConnectionDead 面到 tray/window；orchestration 死亡停投/取消 resync/吸收 fire-and-forget/本地 session_closed 通道关闭。entry 模板停机策略由编排者补齐：两模板 `tray.onConnectionDead` → connectionDead 里程碑 + exit(1)，quit 路径 quitting 旗标防误触；entry-bootstrap.test 死亡/优雅双用例）
- [x] 3.4 端点派生：`callerLabel ?? appIdSlug ?? npm_package_name ?? basename(argv[1]) ?? opentray`（内部优先级，appName 移除），`OpenTrayRuntimeOptions` 不新增公共字段；`resolveDaemonPaths`/ready metadata/broker env/endpoint 测试同步。（resolveDaemonPaths 无需改动——派生只发生在 connectLocalBroker；ready metadata/broker env 经 paths 透传，local-broker.test 已覆盖）
- [x] 3.5 模板：去掉 `show().catch(()=>{})` 吞错；carrier bootstrap 里程碑日志（listenShell/createTray/show/toolbar/content/layout/channel）写入 app.log；url 与 command 两个模板同构。
- [x] 3.6 关键效果点意图注释（引用 plan D 编号），仅在法条语义处注释（如锁回收预算、owner 校验不可绕过）。

## 4. Verification / Regression

- [ ] 4.1 黑盒 kill 矩阵重放（本机）：物化中途 kill -9 ×3 → 重启全成功；运行中 kill -9 → 重启成功；broker-only kill → entry 有界时间内终结（无僵尸）；双启动方式（CLI open + 直接 node）→ 同端点、SINGLE_SESSION 生效。
- [ ] 4.2 app.log 叙事验证：健康启动完整里程碑记录；故障注入（OPENTRAY_BROKER_BIN 指向坏二进制）后日志能定位失败里程碑。
- [ ] 4.3 Windows 对称位验证（`ssh gaubeehonor`，E:\dev\github\opentray）：D2 的 Windows destroy 路径测试通过；锁 helper 在 Windows 语义下等价（无 POSIX flock 依赖则用显式回退）。
- [ ] 4.4 全量绿门：`bun test scripts/openspec/vision-driven.test.ts`、`openspec schema validate vision-driven`、受影响包 `pnpm -r --filter ... test` 全绿；新增测试全部纳入。
- [ ] 4.5 Codex 复核轮（R2）：以 R1 报告为基线复核 diff + 测试证据，要求阻塞清零与评分对比；阻塞项处理后才可进入发布。

## 5. Release / Archive

- [ ] 5.1 changeset（patch：opentray、@opentray/ext-webview、@opentray/packaging、create-opentray）+ 版本纪律检查（0.27.5）。
- [ ] 5.2 `bun run openspec:vision -- commit-check harden-lifecycle-ownership --phase research-plan`（以及后续 phase）通过；OpenSpec 工件先于产品代码提交。
- [ ] 5.3 用户走查验收（baidu app 全交互：地址栏/前进/后退/刷新/新窗口；kill -9 恢复；app.log 叙事）。
- [ ] 5.4 `pnpm run changeset` 后 push；合并 main 后 trusted publishing 发布 0.27.5；`openspec` archive + 清理。
