# d19-extension-event-port — Intent Document (SSOT)

> 原始需求（Owner，2026-09-12/13）：
> 1. D19 持久事件句柄立项：「那确实是要修复的」——修复后能删掉最后一个 16ms 轮询（全推送零轮询收官）。
> 2. 「你和 codex 去好好讨论……我需要一个长远的架构正确的方案。ext-webview 这套协议也要给其它 ext-* 的标准打样。」
> 3. 设计经两轮 Codex 对抗收敛为 **B''**（终稿全文见 `plans/design-reference.md`，含证据锚点/ABI/兼容矩阵/测试策略/法条草案——**该文档是本 change 的规范附录，实现以它为准**）。
>
> 用户语言系统：**「给所有 ext-* 打样」「长远架构正确」「只做 web 做不到的功能」**。

## 最终可见效果（operator 视角）

- 常驻 WebView 窗口空闲时，**原生 drain 命令归零**（macOS/Windows 实测）——每窗口每秒 60 次空命令的 CPU 浪费消失（AGENTS.md「WebView polling cost law」立法目标的兑现）。
- 空闲网页的原生事件（用户点链接→urlChange）**无任何命令在途也即时到达** Node 后端。
- 所有 ext-* 扩展获得同一个标准异步上报通道（Extension EventPort），旧扩展零改动照常工作。

## 调研事实（全部经代码核验，锚点见 design-reference.md「Evidence First」节）

- `ExtHostContext.host_data` 是派发函数的栈局部变量指针（dynamic_extension.rs:405/:585）——调用外驻留即 use-after-return。
- macOS/Windows 派发经 Winit 循环串行化；Linux 是阻塞 mpsc 接收循环，**KSNI 后端是桩**（无循环）——方案 C（同线程冲刷）不成立的实证。
- 现产 ext-webview：原生回调 → outbox → 下一条命令响应捎出（D19 缺口）；facade 16ms drainWindowEvents 轮询是老事件族（focus/style）的现存总线。
- `UnloadExt` 返回 unsupported（broker.rs:468）；registry 以 (appId, instance) 键且 session_closed 广播（extension.rs:169）。
- 路由器对 scope-free host 信任扩展自报 scope（extension_events.rs:91）。

## 决策（D1–D6；细节裁决全部以 design-reference.md 为准，此处为索引）

| # | 决策 | 依据 |
|---|------|------|
| D1 | **B'' 形态**：进程内 EventPort（一个可选 attach 符号 + `try_submit`）+ opentray-bin EventHub（有界队列/公平轮转/合并唤醒）→ 既有 ExtensionEventRouter → ext-event 帧。**不进 opentray-core** | 两轮对抗收敛；否决 A（裸指针注册表）/C（同线程假设不成立于 Linux）/D（拆进程违反窗口进程亲和性） |
| D2 | **Phase-1 ABI 极简**：无 retain/release、无 detach（无 UnloadExt，宿主状态进程级存活，try_submit 指向 broker 代码非扩展符号）；生命周期 PENDING→OPEN→REVOKED | Owner 方案削减三连获 Codex 接受 + 加固论证 |
| D3 | **三事件类**（Latest 可合并/Edge 背压不丢/BestEffort 可丢计数），webview 各事件类的规范表冻进契约；SourceKey 身份宿主绑定，扩展只报 tray 路由（防伪造） | 有界队列不可能对一切无损的诚实设计 |
| D4 | **兼容矩阵六格全定义**：旧扩展走现有 flush 行为；可选符号缺失≠错误；能力诊断区分 direct EventPort vs legacy flush | 分阶段发布不破坏 lockstep 法 |
| D5 | **两阶段**：Phase 1 通用管道 + webview 五族事件迁移（验收=空闲回调无命令直达 facade）；Phase 2 老事件族迁移 + **删 drainWindowEvents 与 facade 轮询**（验收=常驻窗口空闲 drain 归零，双平台实测；权限轮询明确不动） | design-reference Phased Delivery |
| D6 | **流程**：单 change；批次 A（spec 类型+EventHub+loader+路由+确定性测试）→ B（ext-webview 接入+双平台生产者迁移+facade urlChange/titleChange gap→resync）→ C（Phase 2）→ 双平台验证 + Codex 复核 → changeset 发布 | 与 add-webview-orchestration 同款编排 |

## 开放问题（默认假设先行）

| 问题 | 默认假设 |
|------|----------|
| Latest 合并下 seq 断裂的 facade resync 触发策略 | 订阅方收到 seq 跳变即发 getUrl/getTitle 查询取高值（design-reference 已定为 must-ship，实现于批次 B） |
| EventHub 容量数值微调 | 全部编译期常量按 design-reference 表落，实测后再议 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| A 注册表+长期裸指针 | 寿命/竞态人肉管理；正是现行断层的延伸 |
| C 同线程延迟冲刷 | Linux 无统一 UI 循环（实证）；第三方回调可并发；不能作通用标准 |
| D 拆进程+socket | 窗口进程亲和性（Darwin carrier 法/HWND 所有权）；Chromium 级机制无对应需求；留作远期适配器（消息形边界已留门） |
| phase-1 带 retain/release/detach | 无 UnloadExt 可防护；死代码面；v2 可选符号可加 |

## 实施计划（specs/tasks 追溯）

1. 批次 A：opentray-spec ABI 类型/常量/结果码 → opentray-bin EventHub+SourceKey+预算+唤醒适配（Winit UserEvent mac/win、Linux mpsc broker 事件）→ dynamic_extension 可选符号解析+attach → extension_events 源绑定路由 → 确定性 EventHub 套件 + ABI fixture。
2. 批次 B：ext-webview attach + mac/win 原生回调生产者迁移（五族事件按规范表分类）→ facade gap-resync → 空闲推送真机冒烟（mac 本机 + win 真机）。
3. 批次 C：POLLED_WINDOW_EVENTS 逐成员迁移（focus/blur/visible/style→EventPort；reopen 活动追踪改造）→ 删 drainWindowEvents/native window_events/facade interval → 空闲 drain 归零双平台取证。
4. 收尾：全量门 + Codex 复核 + changeset（minor）+ 合并推送发布。
