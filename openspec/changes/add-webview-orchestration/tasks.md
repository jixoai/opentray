# add-webview-orchestration — Tasks

## 1. Alignment / Investigation

- [ ] 1.1 结构门（可执行验证）：`plans/plan.md` 含 D1–D22 决策表与「D → requirement → task 追溯矩阵」；`bun run openspec:vision -- validate add-webview-orchestration` 通过；7 份 spec delta 中每个 MODIFIED requirement 与主 spec 对应块逐字对齐（仅目标条目修订）。R1 复核 B1–B10 修订落位：B1/D22 create-wizard MODIFIED、B2 generated-app-entry ADDED、B3/D18 owner tuple、B4/D2 focus、B5/B6/D20 精确语义、B7/D9 页面创建者、B8/D19 事件闭环、B9/D21 平台契约、B10/D6 重叠门。
- [ ] 1.2 每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（trace 到 plans/plan.md 决策与 specs requirement）

- [ ] 2.1 协议类型（@opentray/spec + opentray-spec Rust）：多 webview 命令帧（create/destroy/list、navigate/back/forward、focus）、per-view 事件帧（urlChange/titleChange/focused，键 `(windowId, webviewId)`）、布局协议（layers/flex 字段/box/输入校验）、通道帧（create/onCreated/post/close/list/destroy + reason 枚举 + 错误码注册表 `unknown_view/invalid_layout_measure/multiwebview_unsupported_style/translucent_overlap/bridge_required/session_scope/not_open/payload_too_large`）、owner tuple `(appId, trayId, sessionId)` 字段——类型与编解码往返测试；两平台 DTO 平价断言（Darwin release 编译门）；**事件传输语义测试（订阅生命周期/按 view 有序/断连停止，断言不依赖轮询间隔）**——trace webview-extension 三个 requirement + webview-layout/webview-messaging 对应条款。
- [ ] 2.2 布局求解：Taffy 集成纯函数测试——layer 树 → Rect 快照（toolbar 列布局、镂空叠层、flex 分配、min/max 钳制）、未知 view id（`unknown_view`）、非法度量（NaN/负值/∞/min>max → `invalid_layout_measure`，求解前拒绝）、默认单层单 fill 回退、**不透明跨层重叠合法 + 透明/材质参与重叠 → `translucent_overlap`（commit 前拒绝、旧布局保持）**、box 输入穿透——trace webview-layout 全 requirement + webview-extension「Opaque cross-layer overlap」scenario。
- [ ] 2.3 通道状态机：created→open→closed(reason)→destroyed 全转移；`not_open` 类型化错误；FIFO；**精确上限（恰 1000 条/恰 1 MiB 合法；第 1001 条 → queue_overflow；单条 >1MiB → payload_too_large 且通道存活；UTF-8 字节计）**；**list 语义（live + closed 墓碑、每会话 LRU 32、destroyed 不列出、页面只见参与集）**；文档导航关闭页面侧端口；无桥目标 `bridge_required`；跨会话 `session_scope`；**页面创建者（page→page 经桥方法、host 不可被定向）**——trace webview-messaging 四 requirement。
- [ ] 2.4 TS facade：createWebview/destroyWebview/listWebviews/navigate/back/forward/**focus()**、urlChange/titleChange/**focused** 订阅、setLayout/layout.update、row/column/view/fixed/grow sugar 编译对象 JSON、createMessageChannel({target})/onCreatedMessageChannel/listMessageChannels/destroy——jsdom/mock endpoint 测试（含事件订阅生命周期与断连语义），trace 对应 requirement。
- [ ] 2.5 page bridge：webviewId 只读属性、`navigator.opentrayWebview.createMessageChannel({target})`（创建端返回 + 对端 onCreatedMessageChannel）、端点收发/关闭事件、无桥页面零暴露——trace webview-extension「page bridge knows its own id」+ webview-messaging「targeted connections」「page creates a channel」。
- [ ] 2.6 create 侧：toolbar 双 webview entry 模板断言（**两种应用**：URL toolbar + 命令应用服务窗 toolbar；布局、通道导航接口、无 PTY、shell 静态、**无 iframe browse 产物**）、**show-address-bar 高级选项 → 原生载体语义替换**、frameEmbeddable 全链路退役、向导开关默认关 + 两流程提供 + config 往返 + 预览边界（StableIframe 仅创作期）——trace generated-app-entry MODIFIED+ADDED、create-wizard MODIFIED+ADDED、create-project-config/create-cli-command-tree MODIFIED。
- [ ] 2.7 会话清扫：owner tuple 归属——同 broker 双 session 各持多 webview 窗口，其一关闭 → 恰清该 session 的窗口/webview/布局/通道，另一 session 存活可观测；lease 断开同语义——trace webview-extension「Session cleanup is scoped」（并覆盖现存 mod.rs:587-590 忽略 session id 的缺陷修复）。

## 3. Implementation — P1 原生能力（macOS 先行）

- [ ] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts，再开始产品代码。
- [ ] 3.2 协议层：opentray-spec Rust 帧（owner tuple 字段）+ @opentray/spec TS 类型 + 两平台 capability DTO（webviewId/布局/通道/事件/错误码）；Taffy 依赖进 opentray-ext-webview（版本锁 Cargo 并记构建证据；opentray-core 零变化）。
- [ ] 3.3 Rust 结构重构：WebviewSlot 1:1:1 → Window 容器 + N webview 槽（bridge_state 单 webview 指针解体）；**`session_closed` 按 session id 精确清扫（修 mod.rs:587-590）**；wry build_as_child/with_bounds 接线；frameless/material → `multiwebview_unsupported_style`；透明/材质参与重叠 → `translucent_overlap`（layout commit 前）。
- [ ] 3.4 Rust 布局：layer 数组 → 每层 Taffy 树求解（输入校验前置、逻辑→物理像素经 scale factor）→ setFrame 应用；resize 原生重算（windowDidResize 接线）；box 视图（layer-backed NSView，background/border/cornerRadius，不接受 first responder 实现输入穿透）。
- [ ] 3.5 Rust 通道：注册表（会话作用域 + owner tuple）+ 状态机（精确上限/墓碑 LRU32）+ 推送投递（ipc_handler 收 + evaluate_script 派发）；per-view urlChange/title/focused 事件**原生回调直推事件通道（不进 16ms drain）**；back/forward 原生历史 API（WKWebView goBack 穿透）。
- [ ] 3.6 macOS 原生验证：multiwebview 窗口冒烟——toolbar+content 布局、resize 跟手、**focus() 切换 + focused 事件**、navigate/back/forward、urlChange 跟随页内跳转、HN（XFO DENY）整页渲染、登录态持久实证、box 边框绘制且鼠标穿透、不透明重叠 + 透明拒绝。

## 4. Implementation — P1 Windows 泛化（真机 `ssh gaubeehonor`，专门子代理执行）

- [ ] 4.0 Windows 真机准备：herdr pane 内起 `ssh gaubeehonor` 会话；验证 `E:\dev\github\opentray` 检出与工具链在位（cargo、pnpm）；将 `add-webview-orchestration` 分支经 LAN git 同步到该检出（不对外发布）；后续 4.x 全部在该真机执行，产物/日志取证回传；子代理报告须含进程回收证据与遇到的工具链摩擦（子代理反馈协议）。
- [ ] 4.1 Windows child webview 接线（WebView2 多 controller 同 HWND、**共享 environment + 每 session retained WebContext（outlives children，创建错误含 profile 路径，profile 路径法不变）**、bounds 物理/逻辑换算、z 序 child HWND 顺序、box parent hit-test 穿透）；WM_SIZE 多 controller 泛化（host paint → N controller bounds → WRY child bounds 顺序法保持）。
- [ ] 4.2 Windows 通道/事件同实现验证（WebMessageReceived + ExecuteScript 派发；DTO 平价断言在 Windows 编译/测试通过）。
- [ ] 4.3 Windows 真机验收：同 3.6 冒烟清单在真机复跑取证 + WebContext/profile 专项（controller 销毁重建不换 profile 目录）。

## 5. Implementation — P2 create 承载切换

- [ ] 5.1 url-entry-template + entry-template 重写：**两种应用** toolbar/地址栏 = toolbar webview（shell 资产）+ content webview（直接 URL/已验证服务地址）+ column 布局；通道导航接口（指令/监听/查询三件套，create 包私有 schema）；托盘 Reload → content 原生重载；titleSync 投影 content 文档；**show-address-bar 选项语义替换为原生载体**。
- [ ] 5.2 browse-page 改造为 toolbar 页（去 iframe；地址栏真值 = urlChange 推送；快捷键保持；**stable-iframe 预览 tab 不动，仅创作期**）。
- [ ] 5.3 frameEmbeddable 退役：scrape.ts responseHeadersAllowEmbedding/ScrapeResult 字段/deriveUrlPresets 透传/CLI --toolbar 回退路径删除；**符号级 grep 门：`rg -n "frameEmbeddable|responseHeadersAllowEmbedding" packages/` 零命中**；相关测试更新（/deny fixture 用例改断言「不再回退、不警告」）。
- [ ] 5.4 向导「导航工具栏」开关（两流程、默认关、config 往返、draft 持久化）；CLI --toolbar 对命令应用开放。
- [ ] 5.5 关键效果点意图注释（指向 plan.md D1–D22）。

## 6. Verification

- [ ] 6.1 分层测试：spec 包编解码、Rust 单元（布局/状态机/清扫）、TS facade/bridge、create 三包全绿 + typecheck；`bun run openspec:vision -- validate add-webview-orchestration`。
- [ ] 6.2 双平台端到端取证（隔离 HOME，绝不污染 Owner 会话）：macOS 本机 + Windows 真机——create --url <XFO DENY 站点> --toolbar 渲染/登录/地址栏跟随/后退前进/重载；命令应用 toolbar 服务窗同验证；单 webview 零改动路径回归（无 setLayout 的 createWebviewWindow）。
- [ ] 6.3 回归：直连模式（非 toolbar）URL 应用与命令应用行为不变；vision-driven 基线（bun test scripts/openspec/vision-driven.test.ts + openspec schema validate vision-driven）。
- [ ] 6.4 self-review（review/self-review.md + html）+ `check` + 分 phase 提交。
- [ ] 6.5 Codex 复核闭环（herdr，gpt-5.6-terra / xhigh）：阻塞项修复后二次复核；评分与依据记录进 review；R1 报告 /tmp/codex-review-add-webview-orchestration.md、每轮对比。

## 7. Docs

- [ ] 7.1 packages/ext-webview/README：多 webview/布局/通道/事件公开 API 契约（含错误码表）。
- [ ] 7.2 skills/opentray：「带后端入口的 opentray 程序经 IPC 通道暴露能力」模式 + toolbar 新载体说明；packages/create/README 命令树更新（--toolbar 两应用、嵌入探测退役）。
- [ ] 7.3 移除 iframe 载体时期关于嵌入限制的文档表述（skill references / README 中的 XFO/sandbox 限制段落），替换为多 webview 载体事实；保留向导预览 iframe 的创作期说明（D22 边界）。
