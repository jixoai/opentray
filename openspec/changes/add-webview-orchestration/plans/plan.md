# add-webview-orchestration — Intent Document (SSOT)

> 原始需求（用户，2026-09-10/11，四轮演进）：
> 1. 「接下来我们要讨论 toolbar 模式下，使用 iframe 导致无法加载的问题。」
> 2. 「在 ext-webview 这里实现一套全新的 createWebview/listWebviews/currentWebview/destoryWebview/setWebviewStyle/getWebviewStyle 等接口。webviewStyle 的关键就是提供：x/y/width/height/zIndex 这些尺寸层级的能力。」
> 3. 「我们可能还得实现一下文本之间的信息互相发送。采用类似 MessageChannel 的设计（但是要提供更丰富的生命周期，WebMessageChannel 本身的设计有一些取舍的，我们得完善生命周期）」
> 4. 「我觉得我们有必要引入一套声明式布局。」（附 `.agents/documents/webview-layout-v1/v2/v3.md` 三份候选文档）
> 5. 「界面上没有 toolbar 的开关项，我们完成了这个功能后，toolbar 就可以作为一个稳定的功能来提供了，所以我们需要在界面上明确提供是否启用『导航工具栏』的功能。」
>
> 用户语言系统：**「一个窗口链与多个 webview 实例的编排」「声明式布局」「多图层」「叠加或者镂空」「layer 是一个抽象的概念」「原生控件」「定向直连」「传输 port 就是很大问题」「create-opentray 本质上是一种通用的 opentray 程序（有一个后端入口）」「导航工具栏」**。
>
> 复核轮记录：Codex（gpt-5.6-terra/xhigh）R1 评分 5.5/10，阻塞 B1–B10 全部采纳——
> 本版（plan-v2）以 D18–D22 与各 spec delta 修订收口；报告
> `/tmp/codex-review-add-webview-orchestration.md`。

## 最终可见效果（operator 视角）

```bash
npx create-opentray create --url https://news.ycombinator.com --toolbar
# 过去：CLI 警告「站点拒绝嵌入」→ 强行回退直连；或 toolbar 白 iframe
# 现在：窗口 = 原生导航工具栏（后退/前进/重载/地址栏）+ 真实站点整页加载
#   XFO DENY 站点（HN/GitHub/Google/YouTube/Slack）照常渲染；
#   登录态持久（cookie 第一方，WKWebView ITP 不再拦截）；
#   地址栏真值跟随页内跳转；⌘L / ⌘←→ 在工具栏焦点时可用
```

开发者视角（新能力面）：

```ts
const shell = tray.extend(WebviewExt).createWebviewWindow({ style: { appMode: true } })
const toolbar = shell.createWebview({ id: "toolbar", url })
const content = shell.createWebview({ id: "content", url })
shell.setLayout(column([fixed("toolbar", 44), grow("content")]))   // 声明式布局
const ch = await shell.createMessageChannel({ target: toolbar.id }) // 定向直连通道
```

操作者信任点：toolbar 从「尽力而为的 iframe 包装」变成「与浏览器标签页同权的原生
承载」——嵌入策略（XFO/CSP）、sandbox 能力、第三方 cookie 三类结构性失败全部构造性
消失；向导出现显式「导航工具栏」开关（默认关闭）。

## 调研事实（已核实代码）

- **失败空间五层实证（2026-09-11）**：HN/GitHub/Google/YouTube/Slack 的 GET 响应
  全部拒嵌（XFO/CSP frame-ancestors）；Wikipedia/example.com 可嵌。iframe 承载的
  结构性天花板是存储层：wrapper 顶层 `127.0.0.1` → 目标站永远是第三方 → macOS
  WKWebView 用默认持久 data store（crates/opentray-ext-webview/src/macos/mod.rs:828
  builder 无自定义 store）→ ITP 默认拒第三方 cookie → 登录类站点必然登录回路。
  R4 验收时「Wikipedia 可用」与此吻合（匿名站点不受影响）。
- **wry 0.55.1 已具备全部原语**：`build_as_child()`（lib.rs:1491）、
  `with_bounds(Rect)`、`set_bounds()/bounds()` 全平台实现（wkwebview/webview2/
  webkitgtk/android）、`focus()`/`focus_parent()`；官方 examples/multiwebview.rs 与
  gtk_multiwebview.rs 即目标形态。Codex R1 亦实证（`wry/src/lib.rs:1393-1495,2141-2169`）。
- **ext-webview 现结构是 1 窗口:1 webview:1 bridge**：macos/mod.rs:88-106
  `MacosWebviewRuntime.slot: Option<WebviewSlot>`、`WebviewSlot.webview: Box<WebView>`
  单 NavigatorWindowBridge；:828-876 以 `build(&host_view)` 挂单 webview。**且
  `session_closed(_session_id)` 忽略 session id、清空全局 app-mode 集合（:587-590）
  ——这是 D18 要在 requirement 层封死的既有缺陷**。
- **事件传输现状**：IPC/window events 入队后由 `DrainIpcMessages`/`DrainWindowEvents`
  消费（macos/mod.rs:429-487，16ms drain 轮询成本法的来源）；url/title 回调目前只
  更新 page access/metadata（:842-851），没有 per-view 事件面 —— D19 的增量所在。
- **原生穿透先例**：`install_download_navigation_delegate(webview.as_ref())`、
  `focus_webview_responder` 直接拿 wry 实例装 AppKit delegate —— back/forward 等
  原生导航 API 可走同一通路。
- **布局文档三份**（.agents/documents/）：v1 = flex 树 + Taffy + JSON 协议为真源 +
  View/Layout 分离 + resize 全原生；v2 = 极简 flex DSL（元组/`"*"` 语法）；
  v3 = QML anchors + Flex/Anchor 双内核。
- **toolbar 现载体（两种应用共用）**：URL 应用 url-entry-template.ts:110-140 与
  命令应用地址栏窗口 entry-template.ts:271-285 都加载 shell server 的
  `browse.html?url=`（browse-page.tsx:226-232，sandbox iframe）；导航模型 =
  Navigation API 伪路由（wrapper 永不跨源导航）。已知缺陷：跨源 iframe 内点链接后
  地址栏失真（wrapper 不可观测）；XFO 站点白屏无反馈。**载体切换必须同时覆盖
  命令模式地址栏窗口，不能只切 URL 应用。**
- **living spec 冲突点（Codex B1/B2 实证）**：create-wizard「Interactive Terminal
  Preview」requirement 的 `Show-address-bar` scenario（spec.md:138-142）仍法源性
  要求生成应用地址栏窗口 = iframe + Web Navigation API；命令应用在
  generated-app-entry 无 toolbar 契约。修订面见 D13/D22。
- **探测回退现状**：scrape.ts:63-75,241-257,368-397
  `responseHeadersAllowEmbedding` + frameEmbeddable 透传；CLI `--toolbar` 回退。
- **生成物冻结性质**：已生成应用的 payload 不随 create-opentray 升级而变 ——
  承载切换对旧应用零迁移。
- **平台法约束**：Windows WndProc 立法区（WM_SIZE 顺序、material host paint、
  NCCALCSIZE、soft-resize 边带）未在多 child webview 下验证；「TS 侧每个通用 WebView
  能力必须由两平台 WindowCapabilities DTO 序列化，Darwin release 构建是编译门」；
  「WebView 轮询成本法：新事件必须推送制，不进 16ms drain」；「Extension cleanup
  law：状态按 (appId, trayId, sessionId) 归属，session-close 不得清掉别的 live
  session」；「Windows WebView2 Profile Law：retained WebContext、profile 路径不继承
  broker executable」。
- **验收基建（Owner 指示，2026-09-11）**：Windows 侧开发/编译/验证使用局域网真机
  ——herdr pane 内执行 `ssh gaubeehonor` 登录，项目检出位于
  `E:\dev\github\opentray`；分支经 LAN 内 git 同步（不对外发布）；Windows 侧
  工作整体交给专门的子代理执行（子代理反馈协议照常生效）；重负载构建遵守
  herdr pane 受控与并行度规则。

## 决策（四轮 grill 拍板 + Codex R1 复核修订，2026-09-11）

| # | 决策 | 依据 |
|---|------|------|
| D1 | **承载 = 同一 OS 窗口内 sibling 子视图编排**（macOS NSView 子视图 / Windows child HWND），不做多 OS 窗口坐标编排 | x/y/zIndex 语义只在窗口内有意义；多 OS 窗口叠拼的 z 序/焦点/Spaces/激活全是对抗 |
| D2 | **契约面**：`createWebview / destroyWebview / listWebviews` + `navigate / back / forward` + `urlChange / titleChange / focused` 推送事件 + per-webview `focus`（`WebviewHandle.focus()` 显式命令 + `focused` 事件，窗口级 focus 保持独立）+ **`webviewId` 只读属性**（`currentWebview()` 方法否决，改为桥上只读属性） | 缺导航与事件成员 toolbar 载不起；webviewId 是布局与通道的寻址基础 |
| D3 | **声明式布局**：v1 架构（JSON 协议真源 + Taffy 引擎 + View/Layout 分离 + resize 全原生）+ v2 语义纪律（flex 子集）；anchors 不落本期，留协议演进位 | 用户三份文档的融合；协议要跨平台长期演进，对象形 JSON 是平价 DTO 的安全形 |
| D4 | **多图层一等公民**：窗口布局 = 自底向上 layer 数组，每层独立 flex 树求解；z 序 = layer 数组顺序 + 层内兄弟顺序，**无独立 zIndex 字段** | 叠加/镂空是编排原生需求（webview 加边框即开篇用例）；单一 z 法源可推理 |
| D5 | **box 视图 = 涂绘原语**：View Registry 第一种非 webview 视图，v1 字段 `background` + `border{width,color}` + `cornerRadius`；layer 纯几何分组不带涂绘；装饰视图输入穿透；box 是未来原生控件家族的第一员 | 概念单职责（layer 管叠放、view 管内容含装饰）；层平面涂绘会撞 Windows material/host-paint 立法区 |
| D6 | **重叠解禁（仅不透明）**：webview 跨层不透明重叠合法；**任一**参与重叠的 webview 处于透明/材质样式 → 类型化拒绝，且拒绝发生在 layout commit 之前（旧布局保持生效）；v1 限定 framed 窗口（frameless/material + 多 webview 组合 = typed `multiwebview_unsupported_style`，挂后续加固门） | 把禁令精确化到真正未验证的部分；toolbar 生成的窗口本就 framed + appMode |
| D7 | **resize 归属全原生**：`setLayout(tree)` 整体替换 + `layout.update(id, patch)` 增量；窗口 resize 由 Taffy 原生侧重算并 setFrame，JS 永不算坐标、不参与重排 | live-drag 零 IPC 零抖动；此前的 dock 预设想法被一般化取代 |
| D8 | **协议字段集 v1**：容器 `dir/gap/children` + 节点 `width/height/flex/minWidth/minHeight/maxWidth/maxHeight`；无 padding/align/justify/percent/basis；TS sugar `row/column/view/fixed/grow` 编译为对象 JSON；`createWebviewWindow` 内部投影「单层单 fill」默认布局 | 平铺编排够用；语义压缩防 CSS 化（v2 纪律）；元组形与 `"*"` 语法否决（协议演进性） |
| D9 | **通道 = 定向直连**：`createMessageChannel({ target: webviewId })`，创建者隐式持端（**host/entry 是合法端点**），对端 `onCreatedMessageChannel` 事件接收，`listMessageChannels` 发现；**无 port 转移**。target 恒为 webview（host 不可被定向，只能作为创建者参与）；页面侧创建走桥方法 `navigator.opentrayWebview.createMessageChannel({ target })`，返回创建端 endpoint（Promise） | Web MessageChannel 的转移语义正是其最难用的部分；broker 注册表 + 事件把转移问题整个绕开 |
| D10 | **权威模型 B**：页面可在会话内发起通道（作用域 `(appId, trayId, sessionId)` 默认放行，跨 App/跨会话构造上不可表达）；目标 webview 必须已启用页面桥（page_access），任意第三方内容页默认无桥 | 既有 page_access 面天然挡不受信页面，不发明新授权系统 |
| D11 | **端口生命周期状态机**：`created → open → closed(reason) → destroyed`；reason ∈ {explicit, peer_webview_destroyed, window_destroyed, session_closed, document_navigated, queue_overflow}；非 open 投递 = 类型化错误 `not_open`（不静默丢）；每端口 FIFO；**文档导航即关页面侧端口（不做跨导航缓冲）**；payload = UTF-8 字符串或任意 JSON 值，无 transferables | 对 Web MessageChannel 五大取舍的清算：GC 死亡不可观测 / 转移纠缠 / 静默丢弃 / 文档绑定生命周期 / 无枚举无背压 |
| D12 | **导航接口归 create 包私有**：指令 / 监听状态 / 查询状态三件套 schema 由 create 包定义，经通道传输；shell server 保持纯静态资产，**不出 HTTP API**；「带后端入口的通用 opentray 程序经 IPC 暴露能力」沉淀为 skills/opentray 模式（实施期文档） | ext-webview 只提供传输与原语；HTTP 面不扩大；降级路径不留（通道失败是应暴露的 bug） |
| D13 | **toolbar 载体切换（两种应用）**：iframe 包装退役（**破坏性更新**，不留下降/隐藏选项）；URL 应用 toolbar 与命令应用地址栏窗口统一改为 toolbar webview（顶层固定高）+ content webview（fill）；地址栏真值 = content 的 urlChange；托盘 Reload 语义保持；**命令应用获得同等的 `window.toolbar` 生成契约（generated-app-entry 新 requirement），旧 `show-address-bar` 高级选项语义替换为原生载体** | 生成物冻结 → 零迁移；两种应用共用同一 browse.html 载体，只切一种会留下半旧半新的双面维护 |
| D14 | **frameEmbeddable 探测退役**：scrape 的 `responseHeadersAllowEmbedding`、ScrapeResult/deriveUrlPresets 的 frameEmbeddable 透传、CLI 回退路径整体删除；requirement 级断言 = generated-app-entry MODIFIED 的「SHALL NOT probe, warn about, or strip」scenario；task 级验证 = 符号级 grep 门（源码与测试无 frameEmbeddable/responseHeadersAllowEmbedding 残留） | 原生承载下嵌入策略构造性无关；死面不留 |
| D15 | **向导「导航工具栏」开关**：URL 与 command 应用流程都提供（用户明示 localhost 也统一支持，部分应用依赖前进后退/路由路径可见），**默认全关** | 「一些应用依赖」→ 开关而非默认位 |
| D16 | **双平台同批交付 + DTO 平价为 spec 契约**：本 change 引入的每个通用能力字段（webviewId、布局协议、通道帧、事件帧）必须由两平台 capability DTO 序列化（Darwin release 编译门）；macOS 先行、Windows 泛化随后，同一 change 收口；Windows 真机验收经 `ssh gaubeehonor`（herdr pane，`E:\dev\github\opentray`，专门子代理执行） | 拆 change 会造成能力契约漂移；平价不欠债 |
| D17 | **流程**：单 change（webview-extension delta + webview-layout 新 + webview-messaging 新 + generated-app-entry/create-wizard/create-project-config/create-cli-command-tree delta）；FULL-WORKFLOW；Codex 复核闭环（herdr，gpt-5.6-terra / xhigh） | 平台级能力变更的复核价值配得上 RemixCode |
| D18 | **所有权三元组法（Codex B3）**：多 webview 状态按 `(appId, trayId, sessionId)` 归属；windowId 会话内唯一；webviewId 窗口会话内唯一；`session_closed` 必须按 session id 精确清扫（**封死现存 mod.rs:587-590 忽略 id 清全局的缺陷**）；lease 断开只清本 lease 的 N 个 webview；同 tray 多 session 交叉清扫隔离进 BDD。协议帧携带 owner tuple 字段 | AGENTS.md Extension cleanup law 的直接投影；生命周期 requirement 弃用「surface」措辞回归 App/Tray/Session 本体 |
| D19 | **事件传输闭环（Codex B8）**：`urlChange/titleChange/focused` 是 per-view 推送帧，键 = `(windowId, webviewId)`；订阅 = facade 监听器（创建即生效，断连即失效）；事件按 view 有序；**新事件禁止复用 16ms drain 轮询**（原生回调直推事件通道）；传输语义进 2.1/2.4/3.5 三层测试 | CPU 轮询成本法；drain 是存量路径，不是新事件的观察机制 |
| D20 | **通道精确语义（Codex B5/B6）**：`listMessageChannels` = live + closed 墓碑（每会话 LRU 上限 32 条，destroy = 显式调用 / 容量逐出 / 会话关闭；destroyed 不再列出）；队列上限 = 每端口 ≤1000 条 **且** ≤1 MiB（UTF-8 字节长，按累计值计，边界值合法）；单条 payload > 1 MiB → 类型化错误 `payload_too_large`（不入队、不关通道）；超限累积 → 关通道 reason `queue_overflow`。类型化错误码注册表：`unknown_view / invalid_layout_measure / multiwebview_unsupported_style / translucent_overlap / bridge_required / session_scope / not_open / payload_too_large`（reason 与 error 是两个命名空间） | 「bounded 但无数值」不可验收；list 自相矛盾必须裁决；稳定错误码是协议契约 |
| D21 | **平台实现契约（Codex B9/B10）**：Taffy 是 `opentray-ext-webview` 的依赖（**永不进 opentray-core**——kernel 法），版本随实现落 Cargo 并记入构建证据；布局输入校验（有限、非负、min≤max；NaN/±∞/负值 → `invalid_layout_measure`）发生在求解之前；逻辑像素 → 物理像素经窗口 scale factor 于 apply 时换算；Windows：N 个 controller 共享同一 WebView2 environment + 每 session retained WebContext（outlives children，创建错误含 profile 路径），profile 路径法不变；box 输入穿透在 Windows 走 parent hit-test 契约（child 不吞鼠标） | wry 原语只证明可挂载，不证明 OpenTray 平台法已被满足；契约不落 requirement 就不可验收 |
| D22 | **向导预览边界（Codex B1）**：向导创作期预览 tab（StableIframe）保持 iframe——它是 authoring-time-only 表面，**永不作为物化应用载体**；生成应用的 toolbar/地址栏窗口只用多 webview 载体（living spec 的 `Show-address-bar` iframe 法随之 MODIFIED） | 边界不命名则 living spec 与 delta 互相要求相反的载体 |

自持实施细节（Owner 有异议可回弹）：box 的 `kind` 判别字段（webview 为默认）；
layer 的 `visible` 开关；通道 id 会话内不透明不可跨会话复用；控件家族膨胀后再考虑
从 ext-webview 拆包。

## D → requirement → task 追溯矩阵

| 决策 | spec requirement（delta 文件） | task / 证据 |
|------|-------------------------------|-------------|
| D1 | webview-extension「orchestrate multiple webviews」 | 2.1, 3.3, 3.6 |
| D2 | webview-extension「orchestrate」（focus/focused）+「per-view navigation」 | 2.4, 3.6 |
| D3/D8 | webview-layout「declarative layered flex protocol」 | 2.2, 2.4 |
| D4 | webview-layout「declarative layered flex protocol」（z-order/图层） | 2.2 |
| D5 | webview-layout「box view paint primitive」 | 2.2, 3.4 |
| D6 | webview-extension「orchestrate」（framed/translucent 场景门） | 2.1, 2.2 |
| D7 | webview-layout「native and resize-authoritative」 | 2.2, 3.4, 4.1 |
| D9 | webview-messaging「targeted connections」 | 2.3, 2.5 |
| D10 | webview-messaging「session-scoped and page-access-gated」+「page creator」 | 2.3, 2.5 |
| D11/D20 | webview-messaging「explicit observable state machine」+「list/queue 精确语义」 | 2.3 |
| D12 | generated-app-entry「toolbar mode」 | 2.6, 5.1 |
| D13 | generated-app-entry「toolbar mode」+「command applications toolbar」+ create-wizard「Interactive Terminal Preview」MODIFIED | 2.6, 5.1, 5.2 |
| D14 | generated-app-entry「Embedding-hostile addresses render」scenario | 5.3（符号级 grep 门） |
| D15 | create-wizard「navigation toolbar option」+ create-cli-command-tree MODIFIED | 5.4 |
| D16 | webview-extension「orchestrate」（DTO parity 句） | 2.1, 4.2 |
| D17 | —（流程） | 6.5 |
| D18 | webview-extension「lifecycle scoped」（owner tuple MODIFIED） | 2.1, 3.3 |
| D19 | webview-extension「per-view push events」（transport 闭环） | 2.1, 2.4, 3.5 |
| D20 | webview-messaging 全 requirement（错误码/上限/list） | 2.3 |
| D21 | webview-layout（输入校验）+ webview-extension（Windows context 契约句） | 2.2, 4.1, 4.3 |
| D22 | create-wizard「Interactive Terminal Preview」MODIFIED + 「navigation toolbar option」边界句 | 2.6, 5.4 |

## 架构与数据流

```text
                 JS（entry / 受信页面）
  row()/column()/view()/fixed()/grow()     createMessageChannel({target})
        │ sugar 编译为对象 JSON                   │
        ▼                                        ▼
  window.setLayout({ layers: [...] })     broker 通道注册表（会话作用域）
        │                                        │ 推送投递（无轮询）
  layout.update(id, patch)                page bridge（init-script 注入,
        │                                        page_access 门槛）
        ▼                                        ▼
  ┌───────────────── Native（双平台） ─────────────────┐
  │ Window 容器 ── layer[]（数组序 = z 序，自底向上）    │
  │   每层独立 Taffy flex 树 → Rect                     │
  │   View Registry: webview │ box（原生控件家族第一员） │
  │   resize → Taffy 原生重算 → setFrame（JS 不参与）    │
  └────────────────────────────────────────────────────┘

toolbar 载体（P2）：
entry ─ createWebviewWindow(framed, appMode)
      ├─ createWebview("toolbar", shell 资产 URL)  ┐ column([fixed(toolbar,44),
      ├─ createWebview("content", config.url)      ┘  grow(content)])
      ├─ createMessageChannel({target: toolbar})   ← 导航接口（指令/监听/查询）
      └─ 托盘 Reload → content 重新加载（不再 evaluate location.reload() 于 wrapper）
```

## 开放问题（默认假设先行）

| 问题 | 影响 | 默认假设 |
|------|------|----------|
| toolbar 模式下窗口标题/图标是否跟随 content 文档 | generated-app-entry | titleSync 单向跟随 content webview（旧 D13 默认投影到真文档）；iconSync 维持 opt-in 默认关 |
| 向导预览 tab（stable-iframe）是否迁移多 webview | 范围 | 不迁移（D22：authoring-time-only 边界已入 spec；独立后续 change 可再议） |
| back/forward 实现层 | 实现面 | 原生历史 API 优先（macOS WKWebView goBack、WebView2 GoBack，原生穿透通路已验证）；不可行平台回落 evaluate |
| window.open / target=_blank 策略 | content webview 行为 | 同 webview 内导航（浏览器标签页语义）；两平台原生事件需接线验证 |
| Windows 多 child 与既有 WndProc 立法区的交互深度 | P1 风险 | framed 窗口范围先行；frameless/material 组合显式拒绝（D6）挂后续加固门 |
| Taffy 具体版本 | 实现面 | 实现期 `cargo add` 时锁定（当前 0.9 系），版本记入构建证据（D21） |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 多 OS 窗口坐标编排（跨窗口 zIndex） | z 序/焦点/Spaces/激活模型全是对抗；不是 toolbar 需要的形态 |
| 保留 iframe 承载作回退 / `--toolbar-iframe` 隐藏项 | 生成物冻结使回退失去必要；双载体双维护面 |
| 向导预览 tab 一并迁移多 webview | 创作期预览的 iframe 限制（localhost 服务几乎不受嵌入策略影响）不构成迁移压力；边界命名即可消除 living 冲突（D22） |
| v3 anchors 通用求解器本期落地 | 为已排除的悬浮场景自研约束求解（且按 Owner 算法规则须 Codex 复核闭环）；协议留加法演进位 |
| layer 自带 background/filter 涂绘 | 层平面涂绘撞 Windows material/host-paint 立法区；box 视图以单职责替代 |
| 通道双 port 返回 + 转移语义 | Owner 否决：port 转移是大问题；定向直连 + 注册表 + 事件 |
| shell server 出 HTTP 导航 API | Owner 否决：走 IPC 即可，不污染 HTTP 面 |
| 手写 ~200 行 flex 求解器替代 Taffy | 自研算法按 Owner 规则须上复核闭环；成熟依赖优于自研 |
| 跨文档导航的消息缓冲 | 语义诚实优先；v1 不做，需要时以协议演进位追加 |
| 协议元组 JSON / `"*"` flex 语法 | 元组形加字段是破坏性重构；对象形是兼容演进（v2 的手感留在 TS sugar 层） |
| 新事件复用 16ms drain 轮询 | CPU 轮询成本法（AGENTS.md WebView polling cost law）；drain 是存量兼容路径 |

## 常规性判定

本变更**部分修法，不违抗**：不触碰 tray-first/App/Session 法、Darwin carrier 法、
App Launch 法、monorepo 包界（能力全部落在 ext-webview 原子内 + create 包消费面；
Taffy 只进 ext-webview，opentray-core 零依赖变化）。修订的既有法（全部进 specs
delta，不绕开）：

1. webview-extension「Webview lifecycle SHALL be scoped to surface tray and
   lease」→ 弃用「surface」措辞，owner tuple `(appId, trayId, sessionId)` 落约；一窗
   上限保持，窗内多 webview（D18）。
2. generated-app-entry 的 toolbar iframe 包装律 + create-wizard 的
   `Show-address-bar` iframe scenario → 载体整体替换为多 webview；frameEmbeddable
   探测/回退律废除（D13/D14/D22）。

## 实施计划（specs/tasks 追溯）

P1 原生能力（macOS 先行 → Windows 泛化，同一 change 内）：
1. 协议层：opentray-spec Rust 帧（含 owner tuple 字段）+ @opentray/spec TS 类型
   （webview 生命周期 / 布局 / 通道 / per-view 事件四组命令与事件 + 错误码注册表）+
   两平台 DTO 平价（Darwin release 编译门）。
2. Rust 结构重构：WebviewSlot 1:1:1 → Window 容器 + N webview 槽（bridge_state 单
   webview 指针解体）；`session_closed` 按 id 精确清扫（修 mod.rs:587-590 缺陷）；
   wry build_as_child/with_bounds 接线；frameless/material typed 拒绝。
3. Rust 布局引擎：Taffy 集成（输入校验、layer 树求解、resize 原生重算、逻辑→物理
   像素、box 视图 + Windows parent hit-test 穿透）。
4. Rust 通道：注册表 + 状态机（精确上限/墓碑）+ 推送投递（ipc_handler 收 +
   evaluate_script 派发）；per-view urlChange/title/focused 事件原生直推（不进
   drain）。
5. TS facade：WebviewWindowHandle 扩展（createWebview/setLayout/focus/通道）与
   page bridge 扩展（id/创建通道/接收端点）。
P2 create 承载切换：
6. url-entry-template + entry-template 重写（两种应用统一 toolbar 双 webview + 布局
   + 通道导航接口）；browse-page 改造为 toolbar 页（无 iframe）；frameEmbeddable
   全链路退役（符号级 grep 门）。
7. 向导「导航工具栏」开关（两种应用、默认关、config 往返）；`Show-address-bar`
   living scenario 替换为原生载体。
P3 验收：
8. 双平台原生测试；Windows 真机验收（herdr 0.9 多设备，含 WebContext/profile 与
   多 child resize 门）；toolbar 端到端（XFO DENY 站点渲染 + 登录回路回归）；
   vision validate/check + Codex 复核闭环。
