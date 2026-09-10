# add-webview-orchestration — Tasks

## 1. Alignment / Investigation

- [ ] 1.1 `plans/plan.md` 已记录四轮 grill 全部拍板（D1–D17）、失败空间实证（五层 + 头部矩阵 + WKWebView 默认 store ITP 推论）、wry 0.55.1 原语核实（build_as_child/with_bounds/set_bounds/focus + multiwebview 示例）、两种应用共用 browse.html 载体事实、平台法约束与拒绝路径；破坏性更新点（iframe 载体退役、frameEmbeddable 退役、旧 D11/D12 法退役）已获 Owner 明示同意，无需再确认。
- [ ] 1.2 每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（trace 到 plans/plan.md 决策与 specs requirement）

- [ ] 2.1 协议类型（@opentray/spec + opentray-spec Rust）：多 webview 命令帧（create/destroy/list、navigate/back/forward、urlChange/title 事件）、布局协议（layers/flex 字段/box）、通道帧（create/onCreated/post/close/list + reason 枚举）的类型与编解码往返测试；两平台 DTO 平价断言（Darwin release 编译门）——trace webview-extension「orchestrate multiple webviews」「per-view navigation」、webview-layout 三 requirement、webview-messaging 四 requirement。
- [ ] 2.2 布局求解：Taffy 集成纯函数测试（layer 树 → Rect 快照：toolbar 列布局、镂空叠层、flex 分配、min/max 钳制、未知 view id 拒绝、默认单层单 fill 回退）——trace webview-layout 全 requirement。
- [ ] 2.3 通道状态机：created→open→closed(reason)→destroyed 全转移、非 open 投递类型化错误、FIFO、队列上限关断（queue_overflow）、文档导航关闭页面侧端口、无桥目标创建失败、跨会话不可表达——trace webview-messaging「explicit observable state machine」「session-scoped and page-access-gated」。
- [ ] 2.4 TS facade：createWebview/destroyWebview/listWebviews/navigate/back/forward/urlChange 订阅、setLayout/layout.update、row/column/view/fixed/grow sugar 编译对象 JSON、createMessageChannel({target})/onCreatedMessageChannel/listMessageChannels——jsdom/mock endpoint 测试，trace 对应 requirement。
- [ ] 2.5 page bridge：webviewId 只读属性、通道端点接收/收发/关闭事件、无桥页面零暴露——trace webview-extension「page bridge knows its own id」+ webview-messaging「targeted connections」。
- [ ] 2.6 create 侧：toolbar 双 webview entry 模板断言（布局、通道导航接口、无 PTY、shell 静态）、frameEmbeddable 全链路退役（scrape 字段/CLI 回退路径删除后既有测试更新）、命令应用地址栏窗口同载体、向导开关默认关 + 两流程提供 + config 往返——trace generated-app-entry MODIFIED、create-project-config MODIFIED、create-cli-command-tree MODIFIED、create-wizard ADDED。

## 3. Implementation — P1 原生能力（macOS 先行）

- [ ] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts，再开始产品代码。
- [ ] 3.2 协议层：opentray-spec Rust 帧 + @opentray/spec TS 类型 + 两平台 WindowCapabilities/WebviewCapabilities DTO（新增 webviewId/布局/通道字段；Taffy 依赖进 ext-webview crate）。
- [ ] 3.3 Rust 结构重构：WebviewSlot 1:1:1 → Window 容器 + N webview 槽（macos/mod.rs bridge_state 单 webview 指针解体）；wry build_as_child/with_bounds 接线；frameless/material 窗口 typed 拒绝；会话清扫扩展 N webview（Extension cleanup law）。
- [ ] 3.4 Rust 布局：layer 数组 → 每层 Taffy 树求解 → setFrame 应用；resize 原生重算（windowDidResize/WM_SIZE 接线，遵守 Windows WM_SIZE 既定顺序法）；box 视图（layer-backed NSView / 实心绘制 + border + cornerRadius，输入穿透）。
- [ ] 3.5 Rust 通道：注册表（会话作用域）+ 状态机 + 推送投递（ipc_handler 收 + evaluate_script 派发，纯推送不进 16ms drain）；有界队列；原生 urlChange/title 事件接出（on_page_load/document_title 回调已就位）。
- [ ] 3.6 macOS 原生验证：multiwebview 窗口冒烟（toolbar+content 布局、resize 跟手、focus 切换、navigate/back/forward、urlChange 跟随页内跳转、HN（XFO DENY）整页渲染、登录态持久实证）。

## 4. Implementation — P1 Windows 泛化

- [ ] 4.1 Windows child webview 接线（WebView2 多 controller 同 HWND、bounds 物理/逻辑换算、z 序 child HWND 顺序）；WM_SIZE 多 controller 泛化（host paint → N controller bounds → WRY child bounds 顺序法保持）。
- [ ] 4.2 Windows 通道/事件同实现验证（WebMessageReceived + ExecuteScript 派发）；WebContext profile 法保持（多 controller 共享 environment）。
- [ ] 4.3 Windows 真机验收（herdr 0.9 多设备）：同 3.6 冒烟清单在 Windows 真机复跑取证。

## 5. Implementation — P2 create 承载切换

- [ ] 5.1 url-entry-template + entry-template 重写：toolbar/地址栏 = toolbar webview（shell 资产）+ content webview（直接 URL/服务地址）+ column 布局；通道导航接口（指令/监听/查询三件套，create 包私有 schema）；托盘 Reload → content 原生重载；titleSync 投影 content 文档。
- [ ] 5.2 browse-page 改造为 toolbar 页（去 iframe；地址栏真值 = urlChange 推送；快捷键保持；stable-iframe 预览 tab 不动）。
- [ ] 5.3 frameEmbeddable 退役：scrape.ts responseHeadersAllowEmbedding/ScrapeResult 字段/deriveUrlPresets 透传/CLI --toolbar 回退路径删除；相关测试更新（/deny fixture 用例改断言「不再回退」）。
- [ ] 5.4 向导「导航工具栏」开关（两流程、默认关、config 往返、draft 持久化）；CLI --toolbar 对命令应用开放。
- [ ] 5.5 关键效果点意图注释（指向 plan.md D1–D17）。

## 6. Verification

- [ ] 6.1 分层测试：spec 包编解码、Rust 单元（布局/状态机）、TS facade/bridge、create 三包全绿 + typecheck；`bun run openspec:vision -- validate add-webview-orchestration`。
- [ ] 6.2 双平台端到端取证（隔离 HOME，绝不污染 Owner 会话）：macOS 本机 + Windows 真机——create --url <XFO DENY 站点> --toolbar 渲染/登录/地址栏跟随/后退前进/重载；命令应用地址栏窗口同验证。
- [ ] 6.3 回归：直连模式（非 toolbar）URL 应用与命令应用行为不变；单 webview 窗口（无 setLayout）零改动路径；vision-driven 基线（bun test scripts/openspec/vision-driven.test.ts + openspec schema validate vision-driven）。
- [ ] 6.4 self-review（review/self-review.md + html）+ `check` + 分 phase 提交。
- [ ] 6.5 Codex 复核闭环（herdr，gpt-5.6-terra / xhigh）：阻塞项修复后二次复核；评分与依据记录进 review。

## 7. Docs

- [ ] 7.1 packages/ext-webview/README：多 webview/布局/通道公开 API 契约。
- [ ] 7.2 skills/opentray：「带后端入口的 opentray 程序经 IPC 通道暴露能力」模式 + toolbar 新载体说明；packages/create/README 命令树更新（--toolbar 两应用、嵌入探测退役）。
- [ ] 7.3 移除 iframe 载体时期关于嵌入限制的文档表述（skill references / README 中的 XFO/sandbox 限制段落），替换为多 webview 载体事实。
