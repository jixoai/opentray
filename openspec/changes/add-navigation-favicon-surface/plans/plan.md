# Intent Document — add-navigation-favicon-surface

## 0. 用户语言系统（Owner 原话，2026-09-16 博客评审轮）

- 「我看你文档，发现接口的一个缺口：没有 favicon 的原生获取的支持？我想起一些，有些网站动态配置 favicon 确实你也都没有收到变更。」
- 「另外，文档中都没提到 navigationEvent 相关的支持。」
- 「有些人想要开发定制 toolbar ，这就是很好的入门文档。」（动机：工具栏是这两个接口的第一消费者）
- 「开工 openspec change（favicon 原生获取 + 变更事件；导航细粒度事件/否决面）。完成后，发布小版本，然后更新 skill 和 2026-09-16-opentray-v0-27」

用户心智模型：宿主（entry）应该能像浏览器扩展一样**看到**页面正在发生什么（导航动作、favicon 变化）并在导航发生前**拦截**它。

## 1. 问题陈述（final visible effect 反推）

今天一个自制工具栏的作者能做到：

- 地址栏跟 `urlChange`、进度条跟 `loadState`（started/finished/failed）。
- 但看不到「这次导航是用户点了链接、还是表单提交、还是重定向」——重定向只表现为一连串 `started`。
- 不能在任何导航开始前否决它（拦截广告跳转、限制子域）。
- 拿不到内容页的 favicon：`iconSync` 只把页面图标投影到窗口图标（且只在带 bridge 的主视图上）；没有 `getFavicon()` 查询、没有动态变更事件。Google 搜索结果页那种运行中换 favicon 的站点，宿主永远不知道。

目标可见效果：

1. `content.onNavigationAction(e => ...)` 收到每次导航动作的 `{ url, navigationType, isUserInitiated }`；
2. `createWebview({ ..., navigationRules: [...] })` / `setNavigationRules()` 声明拦截规则，被拦的导航收到 `failed`（`errorCode` = 专属码）；
3. `createWebview({ ..., favicon: true })` 后：`content.onFaviconChange(e => ...)` 收到 `{ href }`，`content.getFavicon()` 返回 `{ value: { href } | null, seq }`。

## 2. 研究（已完成的代码考古，2026-09-16）

### favicon 现状
- 观察器已存在且跨平台共享：`src/bootstrap.rs`（页面层 `MutationObserver` 观察 `link[rel~=icon]` 的 href/rel 变化 + DOMContentLoaded）→ `opentray.window.sync::pageIconChanged { href }`（bootstrap.rs:855）。
- 门控：仅当 `iconSyncPageToNative` 开启，且 bootstrap 只注入带 bridge 策略的视图（macos/mod.rs:1735 注释：policy-less child = 无脚本无 ipc）。
- 平台原生侧（macOS）无公开 favicon API；Windows 同理。页面 DOM 观察是唯一可靠来源（iconSync 已实证，含动态变更）。

### 导航委托现状
- macOS：`LoadStateNavigationDelegate`（load_state.rs:62）已包装 `decidePolicyForNavigationAction/Response` 并**纯转发**给原委托——钩子位已在委托链上，加观察与规则零新链路。`WKNavigationAction` 提供 `navigationType`（linkActivated/formSubmitted/backForward/reload/other）与 target frame。
- Windows：`NavigationStarting` 已接线（orchestration.rs:408）发 `started`；`ICoreWebView2NavigationStartingEventArgs` 提供 `Uri` / `IsRedirected` / `IsUserInitiated` / **`Cancel`**（原生否决）。
- `loadState` payload 是字段冻结（spec webview.ts:274），扩展走新事件 kind 而非改冻结字段。

### 相关 spec/change
- `webview-extension`（事件族、bridge 策略、通道）、`webview-layout`、`webview-messaging`（本次不动通道）。
- d19 EventPort 定律：新事件必须走端口推送 + 订阅门控 + 分类表（Latest/Edge/BestEffort）。
- 平台法则「The platform only builds what the web cannot do itself」：宿主侧导航拦截与 favicon 观察是原生职责（页面无法替宿主拦截自己）。
- 平台线程法则：`decidePolicyFor` / `NavigationStarting` 在 UI 线程同步回调——**否决不能等宿主 IPC 往返**，必须原生同步求值（声明式规则）。

## 3. 待用户确认的问题与当前推断

1. **否决形态**：v1 用声明式规则（模式匹配 + block），不做「宿主回调式异步否决」（UI 线程不能等 socket 往返；异步否决需要先 cancel-再-重放，语义危险）。推断 Owner 接受——浏览器扩展的 blocking webRequest 本质也是声明式同步匹配。
2. **favicon 观察对 bridgeless 视图的开放方式**：独立 `favicon: true` 开关（默认关）。开启后注入**仅含 favicon 观察器**的最小 bootstrap（无 bridge 命名空间、无 id、无通道）——「宿主观察，页面零能力」。推断 Owner 接受（比「全有或全无」更好，且默认不变）。
3. **规则匹配语法**：glob（`*://*.example.com/*` 风格子集，实做 `scheme://host/path` 的 `*` 通配）。不做正则（转义与 ReDoS 面）。

以上如 Owner 无异议按推断执行（已按「开工」指令视为放行，异见随时回滚）。

## 4. 决策表

- **D1 favicon 面**：每 webview `favicon?: boolean`（默认 false）。观察实现统一走共享 bootstrap 的既有 MutationObserver；触发条件改为 `favicon || iconSyncPageToNative`。bridgeless + favicon 开启 → 注入仅观察脚本。新事件 `faviconChange` payload `{ href }`，Latest 类（coalesce key `<webviewId>/favicon`，`getFavicon()` 为 (value, seq) 查询对）。href 由原生按文档 URL 解析为绝对地址。
- **D2 navigationAction 事件**：新 per-view 事件 kind，payload `{ url, navigationType: "link" | "form" | "backForward" | "reload" | "redirect" | "other", isUserInitiated?: boolean }`。macOS 从 `WKNavigationAction.navigationType` 映射（redirect 不可直接判定 → other；文档如实）；Windows 从 `IsRedirected`/`IsUserInitiated` 映射（redirect 精确，link/form 不可分 → userGesture ? "link" : "other"）。Edge 类（每个动作都是边缘，不合并）。订阅门控：无订阅者不产生记录。
- **D3 导航否决（声明式规则）**：`createWebview({ navigationRules })` + `setNavigationRules(rules)` 命令。规则 `{ pattern: string, action: "block" }`（v1 只有 block；allow 留给后续 default-deny 模式）。原生在 decidePolicyFor / NavigationStarting 同步求值：命中 → cancel + 推 `loadState failed`（`errorCode` 用专属稳定码 `ERR_NAVIGATION_BLOCKED = -3000` 之外另定注册值，避免与 WebErrorStatus 撞车——定为 `navigation_blocked` 字符串码需评估 spec 数字编码现状后落位）。规则变更即时生效，无回放。
- **D4 冻结面演进**：`WEBVIEW_EVENT_KINDS` 增两 kind（spec crate minor）；`createWebview` options 增 `favicon` / `navigationRules` 字段（可选，缺省=现状）；facade 增 `onNavigationAction` / `onFaviconChange` / `getFavicon` / `setNavigationRules`。contract.json fingerprint bump。
- **D5 测试策略**：bootstrap 观察器逻辑复用 iconSync 既有测试路径；mac/win 各自的委托测试（fake action args）；规则匹配器纯函数单测（两平台共享匹配语义表驱动测试）；facade TS 测试；黑盒：规则拦截后 loadState failed 断言 + favicon 动态换链路（复用 walkthrough 探针模式）。

## 5. 范围排除

- 异步宿主回调否决、default-deny 模式、规则优先级/例外——后续 change。
- favicon 字节获取（只给 href；宿主自行 fetch）。
- 通道/布局/会话所有权——不动。

## 6. 验证策略

- 单测：规则匹配器表驱动；事件 payload 形状；bootstrap 门控逻辑。
- 集成：mac 委托钩子（navigationAction + blocked→failed）、win NavigationStarting 同构；favicon 观察注入 bridgeless 视图。
- 黑盒（walkthrough 复用）：导航 baidu→拦截规则命中→failed(navigation_blocked)；动态换 favicon→faviconChange。
- Codex 复审一轮后发布 0.28.0（minor：新增公共 API 面）。
- 发布后更新 `skills/opentray/references/multi-webview.md`（事件表 + 新 API + Known limits 收缩）与博客 `2026-09-16-opentray-v0-27`（zh+en 补两节）。
