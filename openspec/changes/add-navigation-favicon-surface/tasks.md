# Tasks — add-navigation-favicon-surface

## 1. Contract layer（@opentray/spec）

- [x] 1.1 事件族扩展（trace: webview-extension MODIFIED）：`WEBVIEW_EVENT_KINDS` 增 `navigationAction` / `faviconChange`；冻结 payload DTO（`{ url, navigationType, isUserInitiated? }` / `{ href }`）；`navigationType` 枚举与守卫；帧形状测试更新。
- [x] 1.2 `navigation_blocked` 稳定错误码注册（不与 WebErrorStatus 数值碰撞；沿用 loadState `errorCode` 数字通道，值域表 + 测试）。
- [x] 1.3 规则 DTO：`WebviewNavigationRule { pattern, action: "block" }` + glob 匹配纯函数（共享语义，表驱动测试：通配、scheme/host/path 边界、非法 pattern 拒绝）。

## 2. Native（crates/opentray-ext-webview，mac+win 对称）

- [x] 2.1 macOS `decidePolicyForNavigationAction`：从纯转发升级为「观察 + 规则求值」——推 `navigationAction`（navigationType 映射，Edge 类，订阅门控）；规则命中 → `WKNavigationActionPolicyCancel` + `loadState failed(navigation_blocked)`。
- [x] 2.2 Windows `NavigationStarting`：同构——`IsRedirected`/`IsUserInitiated` 映射推帧；`Cancel = true` + failed 帧。
- [x] 2.3 `CreateWebview` options 增 `favicon` 与 `navigationRules`；`SetWebviewNavigationRules` 命令（parse + 校验 + 生效；owner-typed）。
- [x] 2.4 favicon 观察：bootstrap 门控改为 `favicon || iconSyncPageToNative`；bridgeless+favicon 注入仅观察脚本（无 bridge 命名空间）；`pageIconChanged` 处理按视图解析绝对 href → `faviconChange`（Latest 类、coalesce key、`getFavicon` 查询态）。
- [x] 2.5 EventPort 分类表更新（navigationAction=Edge、faviconChange=Latest）+ 订阅门控接线（subscribe/unsubscribe 家族扩展）。
- [x] 2.6 平台 twin 测试：委托钩子（fake action args→帧断言）、规则匹配器、favicon 注入门控、blocked→failed 链。

## 3. Facade（packages/ext-webview）

- [x] 3.1 `WebviewHandle` 增 `onNavigationAction` / `onFaviconChange` / `getFavicon()` / `setNavigationRules()`；`createWebview` options 透传 `favicon` / `navigationRules`。
- [x] 3.2 TS 类型测试 + orchestration 帧路由测试（routeFrame 两新 kind）。

## 4. 验证

- [x] 4.1 全量电池：workspace Rust（mac）+ Windows 真机（ssh）+ JS 包 + 仓基线。
- [x] 4.2 黑盒（walkthrough 模式）：规则拦截 baidu 跳转→failed(navigation_blocked)；动态换 favicon→faviconChange 到达。
- [x] 4.3 Codex 复审一轮（GO 后进发布）。

## 5. Release / Docs

- [ ] 5.1 changeset（minor：opentray 生态 `@opentray/spec`、`@opentray/ext-webview`；patch 透传者）→ push → CI 发布 0.28.0。
- [ ] 5.2 更新 `skills/opentray/references/multi-webview.md`（事件表 + 新 API + Known limits 收缩）与 SKILL.md 索引；contract.json fingerprint bump 随实现。
- [ ] 5.3 更新博客 `2026-09-16-opentray-v0-27`（zh+en：导航/favicon 两节 + Known limits 移除）。
