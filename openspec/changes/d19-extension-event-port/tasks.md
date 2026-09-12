# d19-extension-event-port — Tasks

> 规范附录：`plans/design-reference.md`（B'' 终稿）是实现准绳——ABI 结构、规范事件类表、容量常量、兼容矩阵、测试清单、法条草案全部以其为准。

## 1. Alignment

- [ ] 1.1 plan.md 索引 D1–D6 与 design-reference 一致；validate 通过；每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract

- [ ] 2.1 opentray-spec：ExtEventClassV1/ExtEventRouteV1/ExtEventInputV1/ExtEventPortV1 类型 + attach 符号常量 + EXT_ERR_BACKPRESSURE(4)/EXT_ERR_PORT_CLOSED(5)；单测（repr(C) 布局冻结）。
- [ ] 2.2 EventHub 确定性套件（crates/opentray-bin/src/event_hub.rs 内嵌测试，fake RuntimeWake）：源绑定/伪造不可表达、PENDING 不外泄、per-source FIFO+多线程线性化、Latest 替换+字节上限重算、Edge BACKPRESSURE、BestEffort 计数、per-source/全局容量、轮转公平、唤醒合并、drain 竞态不留滞、会话关竞态（每个结果要么关前送达要么 PORT_CLOSED，绝不穿会话）、reload 代际（旧端口不能路由到新同名挂载）、超限/坏 UTF-8/坏 JSON/oversized 拒绝、源槽上限结构化拒绝。
- [ ] 2.3 ABI fixture 矩阵：E0 旧扩展（无符号→legacy flush）、E1 完整（direct）、部分对/坏版本/坏大小→event_port_abi_incompatible、attach 失败→REVOKED、能力诊断报告 direct vs legacy。
- [ ] 2.4 路由统一：send_event 经同一 hub ingress 挂 post-response barrier；源绑定路由替代自报 scope（重跑既有 router ownership 用例）。
- [ ] 2.5 facade resync：urlChange/titleChange 序号跳变 → 查询取高值——orchestration.test.ts 增用例。

## 3. Implementation — 批次 A（broker 侧）

- [ ] 3.1 commit-check research-plan 后提交 OpenSpec artifacts。
- [ ] 3.2 opentray-spec ABI 类型/常量/结果码（crate 归属：仅 C 兼容声明）。
- [ ] 3.3 opentray-bin event_hub.rs：SourceKey{generation,owner_session_id,app_id,instance_name}/phase(PENDING→OPEN→REVOKED)/有界队列（容量=design-reference 常量表）/Latest 合并/指标/RuntimeWake 适配（mac+win: Winit UserEvent::ExtensionEventsReady；Linux: mpsc BrokerEvent）。
- [ ] 3.4 dynamic_extension.rs：可选符号解析（all-or-nothing 单符号）、attach 时机与 PENDING→OPEN（LoadExt ACK）/失败→REVOKED、源槽上限。
- [ ] 3.5 extension_events.rs：源绑定路由（drain 验证 tray 存活与归属）+ send_event 统一入 hub + 能力诊断。
- [ ] 3.6 main.rs/unix_transport.rs：UserEvent/`BrokerEvent` 臂 + drain_extension_events（64条/128KB 量子）接入三平台循环。

## 4. Implementation — 批次 B（ext-webview 迁移）

- [ ] 4.1 ext-webview abi_support：导出 attach 符号，存 port（进程级不可变值）。
- [ ] 4.2 macOS 生产者迁移：title/url/focus/geometry/load 五族原生回调从 outbox 改 try_submit（规范事件类表：url/title=Latest(webviewId+键)、focus/geometry/load 三相=Edge、progress=BestEffort）；Edge BACKPRESSURE 的扩展侧有界重试（不阻塞 AppKit 回调）。
- [ ] 4.3 Windows 生产者迁移（真机）：同表同构（WebView2 观察者 → try_submit）。
- [ ] 4.4 facade gap-resync（packages/ext-webview orchestration.ts）。
- [ ] 4.5 真机冒烟：mac 本机 + win 真机——空闲（Node 零命令）导航事件直达 facade tap；broker 身份取证。

## 5. Implementation — 批次 C（Phase 2 退役轮询）

- [ ] 5.1 POLLED_WINDOW_EVENTS 逐成员映射：focus/blur/visible/style → EventPort 推送（订阅控制原生生产者）；reopen 活动追踪改推送。
- [ ] 5.2 删 drainWindowEvents 命令/native window_events 队列/facade 16ms interval/监听计数定时器（一次兼容性决策）；权限轮询明确保留。
- [ ] 5.3 双平台空闲取证：常驻 app-mode 窗口静置+原生回调发生时，migrated 家族 drain 命令计数=0。
- [ ] 5.4 既有 drain 相关测试更新；app-reopen MRU 行为回归。

## 6. Verification

- [ ] 6.1 mbx test 全绿（spec/bin/ext-webview/core）+ 三包 TS + typecheck + vision validate。
- [ ] 6.2 兼容矩阵六格 e2e（旧 fixture 共存）。
- [ ] 6.3 self-review（md+html）+ check。
- [ ] 6.4 Codex 复核（herdr，gpt-5.6-terra/xhigh）：阻塞当日修复。

## 7. Release

- [ ] 7.1 AGENTS.md：Dynamic Extension EventPort Law 落档（design-reference 草案为准）+ WebView polling cost law 更新（兑现注记）。
- [ ] 7.2 README/skills 文档面（ext-webview 事件语义、直接推送能力）。
- [ ] 7.3 changeset（minor）→ 合并 main → version → push → CI 全绿 → npm 上线。
