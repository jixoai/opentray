# harden-lifecycle-ownership — Intent Document SSOT

- 变更性质：**现行平台法条下的常规修复原子**（不破范式；不新增公共 API；一次端点迁移为自清理型）
- 目标版本：0.27.5（patch）
- 上游证据：ZCode 黑盒/白盒定位轮（2026-09-14）+ Codex 对抗复核 R1（`/tmp/codex-toolbar-r1-report.md`，NEEDS-WORK 5.5/10，其全部 5 项 blocker 由本计划闭合）

## 1. 用户原始需求与拍板记录（原话保留）

1. 「我觉得我们既然反复修复，一直无法成功修复，那可能是底层架构真的有点问题。你有没有想跟我讨论的？」→ 引出架构复盘与定位优先。
2. 「同意 A+B，不过，我始终觉得问题没那么简单，不确定是不是删掉轮询之后架构的升级导致这个问题。否则先花时间去升级架构并不能本质解决问题。我们需要先定位问题。再做具体方案。」→ 定位先行；EventPort 假设已被证据裁决为无罪（见 §2）。
3. 「我这边没什么异议了，你跟 Codex 再做一轮讨论，然后撰写 change 去推进。如果 Codex 对你的研究有异议，那你再来跟我讨论一下，你们定下来的新的方案。」→ Codex R1 有部分异议，已带回并获得以下两项拍板。
4. 决策 2 拍板：「unknown_view -> a」——一轮修掉全部候选路径 + 结构化日志，不再做现场考古。
5. 决策 1 拍板（用户否决暴露 callerLabel）：「我一直以为，我们是用 appId 去做的，我都不知道有 caller-label 这个属性。我不觉得暴露这个属性是什么聪明的设计，只会觉得这个属性的存在令人困扰」→ 定案 D4：appId 即端点身份，callerLabel 永不公共化。

## 2. 研究记录（事实与证据链）

### 已黑盒坐实

- **F1 锁陈旧化（5/5 复现）**：entry 在 bundle 物化中途被 kill -9 → `<App>.app.opentray.lock` 变 0 字节、无持有进程 → 之后每次启动固定 5s `bundle_lock_timeout` 失败，应用永久无法启动直到手工删锁。
- **F2 僵尸 entry（1/1 复现）**：broker 被 kill 后 entry 进程存活（state SN）、shell server 仍监听、probe 循环从 broker 死亡起完全静默（既不成功也不报错）。注：Codex 源码复核指出 getUrl/getTitle 属 request-map、close 应 reject（有测试）——**现象与源码读法存在未闭合分歧**，疑似挂点在 (value,seq) gap-resync/推送路径；D3 要求以可复现测试钉死。

### 白盒确认（ZCode + Codex 双重核对）

- **F3 裸 tray_id 清扫**：`crates/opentray-ext-webview/src/macos/mod.rs:911-945` `session_closed(session_id)` 按 session_id 正确收集条目后，以裸 `owner.tray_id` 调 `destroy_window_session`（`:2384-2414`，`sessions.remove(tray_id)`）；`destroy_child_webview`（`:1780-1815`）同构。Windows 同构位：`windows/mod.rs:1031-1061`、`:1540-1564`、`windows/orchestration.rs:1719-1728`。registry 的 `destroy_window`/`remove` API 只收 tray id（`orchestration.rs:469-507`）；unattributed 过渡分支在任意 session close 时移除条目（`:558-575`）。
- **F4 unknown_view 症状形态可达**：windowOnly 会话空 `webviews` 起步；摧毁后同 owner/session/window 重新 `show({windowOnly:true})` → `resolve_window` 全过、child map 为空 → 所有子命令 `unknown_view`（`macos/mod.rs:1488-1500`、`2617-2626`）。**生产交错可达性未证实**（Core/transport 清理在单一事件循环同步串行：`opentray-core/broker.rs:147-173`、`kernel.rs:266-281`、`opentray-bin/unix_transport.rs:261-290`）。
- **F5 双锁实现均无 owner**：`packages/packaging/src/app-bundle.ts:661-681` 只 `open(wx)` 从不写内容；`app-launch.ts:34-55`、`:106-125` 另有一份同构锁管 launch descriptor。
- **F6 label 现场与 HEAD 不符**：现场 label=`opentray`（回退值），而 HEAD 派生链为 `callerLabel ?? appName ?? appId ?? resolveCallerLabel()`（`packages/cli/src/local-broker.ts:100-115`；`caller-label.ts:19-49` 无 package.json 读取、无 private 判断）。指向已装 0.27.4 包与 HEAD 的行为差异 + appName（中文/逗号）会被用作目录名的隐患。
- **F7 模板吞错**：生成模板把初始 `window.show()` 错误 `.catch(() => {})` 吞掉后仍执行 toolbar carrier（`packages/create/packages/core/src/url-entry-template.ts:152-169`、`entry-template.ts:318-327`）；carrier 无 bootstrap 结构化日志，app.log 只有终态错误——这是「无法归因」的直接原因。
- **F8 EventPort 无罪**：全部健康运行都在 direct-event-port 模式下推送正常；d19 加重了静默性（死传输从轮询报错变为无声）但非根因。

### Codex R1 对 ZCode 归因的三处修正（已吸收）

1. 「private 包被跳过导致 opentray」在 HEAD 不成立（见 F6，改按 D4 从根消除分裂）。
2. 「getUrl 永不 reject」未证实（见 F2 分歧注）。
3. 「迟到清理是唯一根因」不可断言（见 F4）——故决策 2=a：全候选路径一起修 + 日志闭合未来归因。

## 3. 事实 / 推断 / 决策 / 开放问题 / 被否决路径

- **推断 I1**（中置信）：用户现场 `unknown_view×5` 来自「会话窗口被某路径摧毁 → 同 owner re-show 重建空会话 → 自愈循环的 getUrl 逐次失败」。触发路径可能是迟到清理（F4）、吞错后的残骸 carrier（F7）、或 stale artifact——不再逐个考古，修复面覆盖全部。
- **决策**：见 §5 D1-D5。
- **开放问题**：F2 分歧的确切挂点（D3 测试钉死）；端点迁移期新旧 broker 并存窗口的实际宽度（D4 验收观察项）。
- **被否决路径**：暴露公共 `callerLabel`（用户否决）；从 caller package identity 派生 label（引入第三身份来源且迁移面更大）；继续现场考古（决策 2=a）；把 A+B 架构混入本 patch（Codex 与 Owner 一致同意分离）。

## 4. 最终可见效果（operator 视角）

- 「反复修不好」的地址栏/按钮失联类症状在 0.27.5 后：任何启动方式（CLI --open、直接 node、Dock 冷启动、编辑器终端）都落在同一 broker，单实例保护真实生效。
- kill -9 / Ctrl-C / 崩溃之后**再启动一定能起来**（锁自愈），不再出现「怎么都打不开」。
- broker 死亡后 entry 不再静默变僵尸：要么明确退出、要么明确重连，app.log 有可读叙事。
- 出问题时 app.log 里有 bootstrap 每一步的结构化记录，下一次归因不再需要一天考古。

## 5. 意图驱动的计划（specs/tasks 追溯锚）

- **D1 共享锁 helper**：PID+token 写入并 flush 后才视为持有；空/非法/死 PID bounded 回收；release 校验 token（防误删替换后的锁）。落点：`@opentray/packaging`，同修 `app-bundle.ts` + `app-launch.ts` 两处；kill/restart 回归测试（含 kill -9 中途物化）。
- **D2 session owner 校验贯穿**：销毁类 API 签名升级为携带并校验 `(appId, trayId, sessionId, windowId)`——覆盖 macOS/Windows 的 `session_closed`、`destroy_window_session`、`destroy_child_webview`、registry destroy/remove、unattributed 过渡分支；裸 tray-id 删除在类型上不可表达。测试：reentrancy seam（收集旧条目 → 注入同 tray 新会话 → 执行 destroy → 断言新会话存活）+ 跨会话保活 + channel/popup 清扫断言。
- **D3 transport-dead 全链路**：统一 connection-dead 状态传播；事件订阅 fail-loud（terminal callback）；gap-resync 取消；pending request rejection 维持现状；生成 entry 的 process/session 显式停机。验收必须包含：F2 僵尸形态的可复现测试（broker kill 后 entry 的每个 await 在有界时间内终结）。
- **D4 appId 即端点身份**：`createTray` 传 `appId` → caller label = appId 规范化 slug；`appName` 移出派生链；`callerLabel` 保持内部/诊断用途，永不进公共 API。一次性端点迁移自清理（旧端点 broker 随旧 entry 退出消亡——F2 轮已实证该生命周期）。诊断/源码示例的临时隔离轴不受影响。
- **D5 模板不吞错 + bootstrap 结构化日志**：初始 `show()` 失败必须中止 carrier 并写 app.log；carrier 每步（listenShell/createTray/show/createWebview×2/setLayout/openChannel/事件计数）落 app.log。
- **范围排除**：A+B 架构（entry 单一所有者 + toolbar 控制面简化）另立独立 change。

## 6. 验证策略

- 每项 D 的专项测试（上述）；随后按既有基线命令 + 针对性黑盒：kill -9 矩阵（物化中途/运行中/broker-only）、双启动方式端点一致性、重启后应用可启动、app.log 叙事完整性。
- Windows 侧同构验证经既有 LAN 真机通道（ssh gaubeehonor），聚焦 D2 的 Windows 对称位。
- 发布走既有 changesets + trusted publishing 流程。
