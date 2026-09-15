# OpenTray harden-lifecycle-ownership R6 复审

## 范围与证据边界

本复核以真实工作区和 `git diff 456b8e4d..HEAD` 为准，重点核查 `abf5bf71`、`1de8be2b` 及其后 `4c9111a2` 的工件修订。当前真实 `HEAD` 是 `4c9111a2`，不是简报中注明的 `1de8be2b`；后者之后还有 walkthrough/changeset 提交。工作树未修改；已有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 未触碰。

独立重跑：

- `packages/ext-webview`: `pnpm exec vitest run src/orchestration.test.ts src/index.test.ts`，2 files / 75 tests passed。
- `packages/create/packages/core`: `pnpm exec vitest run src/scaffold.test.ts`，1 file / 10 tests passed。
- 将 `shellServerSource(...)` 生成文本直接送入 `node --input-type=module --check`，语法通过。
- `git diff --check 456b8e4d..HEAD` 通过。

简报列出的 Darwin Rust 176/176、workspace Rust 370/370、Windows aarch64 184/184、其余 JS/packaging 全量计数、Owner 黑盒走查，本轮没有在当前环境独立重跑，因此以下标为“简报提供”，不升级为本轮实测。

## 阻塞问题

### P1：close/destroy typed-fail 没有在返回前提交 host outbox

delta 明确要求 macOS/Windows 的 `postMessage/close/destroy` 在“成功或 typed-fail”时都先提交已 drain 的 host events（`openspec/changes/harden-lifecycle-ownership/specs/webview-extension/spec.md:57-62`；简报 `:24`）。

- page-side `postMessage` 成功臂和失败臂都有 `submit_host_channel_events`：macOS `crates/opentray-ext-webview/src/macos/bridge.rs:435-455`，Windows `crates/opentray-ext-webview/src/windows/channels.rs:226-246`。
- `closeMessageChannel` / `destroyMessageChannel` 的成功臂有 submit，但 typed-error 直接返回：macOS `bridge.rs:457-482`，Windows `channels.rs:248-273`。这些错误可能是 `not_open`、权限/归属拒绝等；若 outbox 已有待发记录，调用返回时不会满足“before returning”约束。
- `required_channel_id(&payload)?` 也在三条命令的入口提前返回（macOS `bridge.rs:435-458,472-474`；Windows `channels.rs:226-249,263-264`），所以缺失/空 `channelId` 的 typed-fail 同样绕过 submit。

这不是 RefCell 重入，而是明确的规格闭环缺失，足以阻塞发布。建议两端对三条 page command 采用统一的 error/finally 路径：参数校验错误、registry typed-error 和成功结果都在返回前调用 `submit_host_channel_events`；补充“预置 host outbox + close/destroy typed-fail + fake EventPort 收到事件”的 macOS/Windows twin 测试。

## 逐项核销

### EventPort Pushed/Retain 与用户数据

实现映射符合要求：`submit_channel_event` 中 Direct -> `Pushed`；Backpressured 且 retry enqueue 成功 -> `Pushed`；retry 溢出 -> `Retain`；Rejected、PortClosed、无端口 -> `Retain`（`crates/opentray-ext-webview/src/event_port.rs:261-296`）。FFI 结果分类在 `event_port.rs:483-533`；EventHub 的 Rejected 只由不可解析/超限等输入校验产生（`crates/opentray-bin/src/event_hub.rs:1001-1043`）。两端调用方只在 `Retain` 时把记录收回 outbox：macOS `crates/opentray-ext-webview/src/macos/bridge.rs:614-643`，Windows `crates/opentray-ext-webview/src/windows/channels.rs:439-460`。

因此在当前 EventHub 合同下，Direct、一次入 retry 的 Backpressure、overflow、Rejected、PortClosed、无端口均没有可达的静默丢失路径；本轮独立 JS 测试不覆盖 native FFI。注意 retry flush 对已入队记录收到 `Rejected`/`LegacyFlush` 时会丢弃该 retry 项（`event_port.rs:334-343`），当前 Hub 不会对同一份已通过 JSON/长度校验的不可变记录产生该结果；它仍是一个应由 native 回归测试锁定的契约假设，而不是本轮确认的现实丢失。

### FIFO 与 drain

`drain_host_events` 先按 record 顺序把 page->host queue 追加到 `host_outbox`，再整体 `drain(..)` 出队（`crates/opentray-ext-webview/src/channels.rs:642-663`）。`requeue_host_events_front` 反向遍历后 `push_front`，所以输入 `[oldest, ..., newest]` 恢复后仍为 oldest-first（`channels.rs:666-676`）。已有专测覆盖三条消息的前端回插和下一次 drain FIFO（`channels.rs:892-919`）。

### RefCell 重入

正常成功路径都先以 `let outcome = registry.borrow_mut()...` 结束 registry 借用，再调用 deliver/submit；macOS `bridge.rs:457-480`，Windows `channels.rs:248-271`。`submit_host_channel_events` 也只在一个局部 borrow block 中 drain，释放后执行 EventPort，再重新 borrow 回插（macOS `bridge.rs:614-643`；Windows `channels.rs:439-460`）。导航钩子先结束 channel registry 借用，再 deliver/submit（macOS `bridge.rs:681-708`；Windows `channels.rs:502-529`）。未发现旧的 match-scrutinee 临时 `RefMut` 残留；P1 是失败臂漏调用，不是重入崩溃。

### 帧同构与 facade

响应路径把 extension envelopes 镜像为 `ServerFrame::ExtEvent`（`crates/opentray-core/src/broker.rs:439-445,535-545`）；异步 EventPort drain 通过 `deliver_bound` 构造同一 `ServerFrame::ExtEvent`（`crates/opentray-bin/src/extension_events.rs:182-200`）。facade 的 `routeFrame` 对两条来路统一按 `channel.closed` / `channel.message` 分派（`packages/ext-webview/src/orchestration.ts:852-886`），无需新增消费协议。本轮 `orchestration.test.ts` 与 `index.test.ts` 75/75 通过，支持该 JS 消费闭环。

### Toolbar context-menu 守卫

守卫只在 `target === join(SHELL_DIR, "toolbar.html")` 分支注入（`packages/create/packages/core/src/shell-server-template.ts:168-172`），监听捕获阶段 `..., true`；豁免选择器严格为 `input,textarea,[contenteditable]:not([contenteditable=\"false\"])`（`shell-server-template.ts:108-113`）。模板字符串中的反斜杠和引号生成后已用 module-aware `node --check` 验证语法。现有 create-core 断言仅检查生成文本（`packages/create/packages/core/src/scaffold.test.ts:231-241`），没有实际启动生成 server 并发送 contextmenu 的行为测试；这是证据缺口，不改变静态语义核销。

## OpenSpec 与实现一致性

新增 channel push、FIFO fallback、双平台调用点和 document-navigation 场景均已写入 delta（`openspec/changes/harden-lifecycle-ownership/specs/webview-extension/spec.md:39-69`）。macOS 有导航 EventPort 专测，验证 `channel.closed`、Edge class 与 outbox 清空（`crates/opentray-ext-webview/src/macos/tests.rs:3263-3320`）。Windows 有导航状态/关闭语义测试，但没有对应 EventPort push 专测；这正是简报注明的 Windows 不对称。按 patch 范围可接受为残余证据缺口，但发布前应补 twin。

`plan.md` 的 D7 叙述与源码一致：它准确记录了 D6 证伪、host_outbox 的旧响应搭载根因、EventPort `submit_channel_event`、Retain 前端回插、同构 `ExtEvent` 路由和导航钩子（`openspec/changes/harden-lifecycle-ownership/plans/plan.md:60-62`）。`tasks.md` 的 5.3 走查记录属于 Owner/简报提供证据，本轮没有独立复现（`tasks.md:46-50`）。未发现超出简报范围的功能性 scope creep。

## 实现质量与评分

D7 的核心设计清楚：权威 outbox、显式 Pushed/Retain、有限 Edge retry、前端 FIFO 回退和统一 `ExtEvent` 帧消除了原先“空闲直到 Dock 激活”的主要投递缺口。平台 twin 的实现对称，且普通成功路径已经避免 RefCell 重入。低优先级质量问题是 macOS/Windows 的 submit helper 重复，以及把根因走查叙事大段复制到源码注释；不影响行为，但注释应压缩并把历史证据留在 OpenSpec。

综合评分 **7.4/10**：核心投递与无丢失主路径 3.0；FIFO、重入和帧同构 2.0；导航/toolbar 修复及工件一致性 1.5；独立 JS/语法/diff 门 0.7；P1 typed-fail 漏提交 -1.5；Windows native 专测与全量 Rust/真机证据未本轮独立复核 -1.3。

NEEDS-WORK | 综合评分 7.4/10 | 报告路径 /tmp/codex-toolbar-r6-report.md
