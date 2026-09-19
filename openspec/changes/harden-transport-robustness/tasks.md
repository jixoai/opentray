# harden-transport-robustness — Tasks

> 意图 SSOT：`plans/plan.md`。Work items W1–W9 映射 issue #11。
> 机制/策略边界：deadline、心跳、有界 teardown、写纪律、重建重放 = SDK 机制；
> 进程重启向量、健康投影、预算数值策略 = 应用策略（Tier 2 钩子交还）。

## 1. Alignment

- [ ] 1.1 Owner 裁决回填：Codex 复核启用与否、W7 同 change 与否、预算持久化形态、Tier-0 默认开启确认。
- [ ] 1.2 validate 通过；plan/specs/tasks 三者可追溯（每个 W 项 → requirement → task）。

## 2. Client transport correctness（W1 / W3 — Phase A）

- [x] 2.1 `packages/cli` 运输层 per-call deadline：`LocalBrokerConnection.request()` 挂预算类（interactive 5s / teardown 2s / bootstrap 10s），到期 typed 超时拒绝，晚到回复安全丢弃（pending 条目已删除即 no-op）。
  - 证据：f059dc7a；`TransportTimeoutError` 第三拒绝类；`init()` 10s bootstrap race。
- [x] 2.2 typed 拒绝分类法落位：`TransportTimeoutError` 与 transport-lost / broker-rejected 家族区分；deferred 操作超时保持 `ExtensionOperationError` 家族语义一致。
  - 证据：f059dc7a + 09cc0e07（review 修正为两阶段律：deadline 只覆盖 dispatch→acceptance，受理即停表——用户持握的模态对话框不受 transport deadline 杀死，终帧只受运输活性约束）。spec delta 同步冻结两阶段律。
- [x] 2.3 有界 teardown：`destroy()`/`close()` 墙钟（每原生步 2s + 排水），P3.6 优雅退出哨兵语义逐字保留；caller-initiated 路径永不触发恢复。
  - 证据：f059dc7a；`close()` 2s 降级 `destroy()` 后 resolve；destroy-tray 帧带 `{deadlineMs: 2000}` 标记（Phase D 的 teardown 类通道）。
- [x] 2.4 单测（移植 pnpm-pub 场景形状）：never-settle 在预算内拒绝；晚到回复丢弃；happy path 零可观测开销；wedged handle 的 destroy 有界且原生 destroy 仍被发出。
  - 证据：164/164（packages/cli vitest）+ typecheck exit 0（两阶段修正后复跑）。

## 3. Broker-side road repair（W7 — Phase B）

- [x] 3.1 Unix：出站帧改为有界 per-session 队列（1024 帧）+ 专职 writer 线程；写/flush 错误升级为该 session 的 Disconnected 处理（session 清理 + 事件源吊销 + ExitOwnedBroker 行为保留）。
  - 证据：c918d704；升级一次性 CAS 去重 + eprintln 落 broker.log；owner loop 全部 9 个写点变纯入队。
- [x] 3.2 队列满/不可排水 → 同一升级路径，绝不 park 生产者；owner loop 不再出现阻塞 socket 写。
  - 证据：`full_outbound_queue_escalates_without_parking_the_producer`（<1s 断言）。
- [x] 3.3 Windows：pump 队列改有界（1024）+ 同升级语义（对死客户端不再无界增长）。
  - 证据：c918d704 windows_transport.rs 对称 OutboundWriter；镜像测试 da731621 五件套（满队升级+去重/FIFO/wedged drain 有界/无客户端 shutdown 有界/停止排水管道客户端有界升级）；**真机验收（LAN 中继 gaubeehonor，worktree @ da731621）：131 通过 0 失败**，含全部 5 个新 windows_transport 测试。
- [x] 3.4 H3 调查：listener-shutdown join 悬挂路径加固（endpoint 被 rebound 时 loop-exited broker 不得存活悬挂）；结论无论修复与否写入 change 记录。
  - 证据：悬挂为真（独立探针复刻旧代码形状 3s watchdog 触发 HUNG）；修复 = nonblocking accept + 20ms tick + 500ms 有界 join（超时 detach）+ endpoint 按 (dev,ino) 保全；回归测试 `listener_shutdown_is_bounded_when_the_endpoint_was_rebounded`。
- [x] 3.5 Rust 测试：写失败→disconnect 升级；owner loop 不被写阻塞；停止排水的客户端在有界时间内让 broker 升级该 session。
  - 证据：cargo test -p opentray-bin 146/146（基线 139），连续 3 轮绿 + 编排者复跑 1 轮绿；e2e 不排水客户端经真实 accept 路径有界升级；FIFO（ack 先于事件帧）；Exit 250ms 终末投递窗；升级即 shutdown 收敛 writer 线程（review 追加）。

## 4. Death detection + state surface（W2 / W6 Tier1 — Phase C）

- [x] 4.1 客户端心跳：既有 `ClientFrame::Health` round-trip，30s 空闲间隔 / 3s 探测 deadline / 3 连续失败判死（皆可覆盖）；socket close/error 立即判死。
  - 证据：18bb4e1e transport-supervision.ts；空闲门控（忙碌运输零探针）；非探针 expiry 计入失败连续计数但单次绝不判死（W1 律）。
- [x] 4.2 判死走既有单飞行 `markDead` 路径（in-flight 立即拒绝、事件停投）；`transportStateChange`（healthy|recovering|abandoned）边沿触发事件面。
  - 证据：18bb4e1e；每代 onConnectionDead 转发保持 D3 消费者语义；判死后对半开连接有界 close（2s 降级）拒绝 in-flight。
- [x] 4.3 测试：半开夹具（broker 活着但不答）在判死窗口内判死 + in-flight 拒绝；心跳参数覆盖生效。
  - 证据：transport-supervision.test.ts 18 例（wedge 判死/忙碌零探针+静默复探/socket close 即判/expiry 计数/参数短化）。

## 5. Recovery（W4 / W5 / W6 Tier2 — Phase D）

- [x] 5.1 声明式 journal：核心 tray/app 变更（createTray 选项、last-set menu/icon/tooltip、app name/icon）、extension mounts（精确 resolved artifact + identity + mountId）、ext-webview 窗口（options、last-set style、事件订阅集）。
  - 证据：18bb4e1e 帧嗅探零 API 变更；防御性 structuredClone；LWW 原位替换；destroy-tray 成功驱逐（防复活）；appId 以新世代 default-app 应答为权威重写。
- [x] 5.2 重生序列：cooldown backoff（1s ×2 封顶 30s）→ 既有 connectLocalBroker（identity 门与锁回收原样重apply）→ 重连握手 → 重放 journal（bootstrap 预算类、fresh requestId、原 trayId 注入）→ facade rebuild 回调（注册序，携 fresh sessionId）→ 全量状态快照再发射 → healthy。进程内预算 3 次/10 分钟（默认，可覆盖）。
  - 证据：18bb4e1e；adoptGeneration 全序列成功才提交世代（恢复中消费调用对死代 fail-fast）。
- [x] 5.3 预算耗尽：停止重生；全部 handle 方法 fail-fast typed `TransportAbandonedError`（code `transport_abandoned`，details `{recoveries, windowMs}`）；终态 `abandoned` 事件；应用保持无头运行。
  - 证据：预算耗尽测试断言无循环 + fail-fast + abandoned。
- [x] 5.4 Tier 2 `recovery.restartApp`：提供即取代进程内重建，有界 teardown 后回调恰好一次（异常不重入）→ 终态。
  - 证据：Tier 2 测试（恰好一次、零重连）。
- [x] 5.5 ext-webview facade：drain/订阅生命周期跟随 supervision 状态；重建后从原生查询合成全量快照（可见性/几何）；页面 reload 契约文档化。
  - 证据：18bb4e1e；rebuild = dispose 死态 orchestration → 重建 → applyShow(fresh sessionId) → 重放合并 style → isVisible+getBounds 合成 visibleChange/moved/resized；focus/style 无查询动词保持 edge-only（design-reference 裁决 5）；82/82。

## 6. Acceptance + docs（W8 / W9 — Phase E）

- [x] 6.1 kill -9 drill 常驻门：最小 ~5 行 createTray 应用夹具，杀 broker 后一个预算窗内自动恢复，零消费者恢复代码；确定性 wedge 模拟断言预算耗尽 → fail-fast + `abandoned`（无悬挂、无循环）。
  - 证据：68dc791f `transport-drill.test.ts`——kill 腿走真实 broker（本检出 cargo 产物经 `OPENTRAY_BROKER_BIN`；无二进制时响亮 skip 并提示构建命令），断言 healthy→recovering→healthy 边沿 + 恢复后 round-trip + 干净销毁 + broker 退出；预算耗尽腿恒跑（恰好 maxRestarts 次尝试 + typed fail-fast + 无循环）。drill home 用短 POSIX /tmp 根守 sun_path 预算（AGENTS 法则）。
- [x] 6.2 平台证据：macOS 本地 + CI；Windows 经 LAN 中继按仓法规律；核心侧（client/broker Rust/TS）双平台确定性测试。
  - 证据：macOS drill 绿（5.5s，185/185 全包）；Windows 真机（中继 gaubeehonor @ da731621）Rust 套件 131/131 含 5 个新 windows_transport 测试；TS kill 腿无二进制自动 skip（确定性腿恒跑）。
- [x] 6.3 `skills/opentray` 消费者文档：恢复即页面 reload 契约、丢事件窗口 + 快照再发射保证、默认值表、Tier 0/1/2 阶梯。
  - 证据：`skills/opentray/references/transport-robustness.md` + SKILL.md 路由行；`packages/cli/README.md` 公共 API 契约段（拒绝分类法/两阶段 deferred 律/预算与钩子面）。
- [ ] 6.4 changeset + 版本推进按 monorepo 法；AGENTS.md 法则在归档时落档。

## 7. Verification

- [ ] 7.1 全量门：workspace 测试 + typecheck + `pnpm run verify` + `openspec validate --all --strict` + `git diff --check`。
- [ ] 7.2 issue #11 全局验收对照：零改动消费者存活 kill -9；无公共方法可永久悬挂；耗尽降级 fail-fast；drill 常绿；pnpm-pub 采用后可净删补偿层。
