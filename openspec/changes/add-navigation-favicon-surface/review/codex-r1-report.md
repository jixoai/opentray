# add-navigation-favicon-surface 复审报告

复审范围：`3ec45ef...1418c156`（OpenSpec 三件套、实际 Rust/TypeScript diff、fixtures、contract-6）。当前 `HEAD=2b126e9a` 仅额外包含 self-review 文档；其自报证据未作为独立验收结论。

## 结论

**NEEDS-WORK，暂不建议进入 0.28.0 发布。** 事件端口分类、serde 顺序、macOS delegate 链和 Latest 去重主路径基本正确；但 Windows 阻断导航的失败 URL 关联、favicon 查询能力/线格式、TS/Rust glob 双实现一致性均存在可复现的契约或运行时问题。

## 阻塞问题清单

### P1

1. **Windows blocked `loadState.failed.url` 错误或为空，且并发导航可错配。**
   `crates/opentray-ext-webview/src/windows/orchestration.rs:401-470` 只用一个共享 `pending_url`，阻断分支只记录 `navigation_id`，没有记录被阻断 URL；完成分支 `:513-535` 再从共享 slot 读取 URL。因此首次被阻断的导航可能发空/上一 URL，多个 NavigationStarting 交错时会把失败帧关联到另一导航。这直接违反 `webview-navigation/spec.md:28-38` 要求的 blocked action → failed 链和同 URL 语义。

2. **`getFavicon()` 未按 `favicon` 能力门控，且返回线格式不是 spec 的 `(value, seq)`。**
   `packages/spec/src/webview.ts:237-244,262-265` 定义为可选顶层 `href`，facade `packages/ext-webview/src/orchestration.ts:248,1150-1166` 对所有 child 暴露；Rust `crates/opentray-ext-webview/src/macos/mod.rs:1190-1205`、`windows/orchestration.rs:1278-1293` 对所有 view 都成功返回 `{href?,seq}`。所以 `favicon:false` 的 view 仍可调用并得到 `{seq:0}`，且没有 `value: {href}|null`。这违反 `webview-favicon/spec.md:5-7,23-27`，也使 contract-6 的 `stateResync` 描述（`href,seq`）继续漂移。

3. **TS glob matcher 与 Rust matcher 不一致。**
   `packages/spec/src/webview.ts:355-364` 的转义正则多了一层反斜杠；独立执行：
   `matchesWebviewNavigationPattern("https://example.org/*", "https://exampleXorg/path")` 返回 `true`，按 spec（除 `*` 外均为字面量）应为 `false`。Rust `crates/opentray-spec/src/webview.rs:462-487` 对该输入返回 false。当前 native veto 走 Rust，故不是已证明的 native 绕过，但公开 TS 契约和“TS/Rust 双实现语义一致”已失真；规则预检、消费者复用或后续 facade 本地求值会产生错误决策。

### P2

4. **favicon href 未在 native 侧解析/限制为绝对 HTTP(S)。**
   `crates/opentray-ext-webview/src/macos/bridge.rs:110-135`、`windows/orchestration.rs:1839-1863` 只过滤空字符串；observe-only bootstrap (`crates/opentray-ext-webview/src/bootstrap.rs:65-87`) 的 fallback 也可能提交相对、`data:`、`file:` 或 `blob:`。spec 明确要求 native 在发帧前解析为绝对 http/https（`webview-favicon/spec.md:5-7`）。

5. **Windows blocked-id 集合没有边界，也忽略 NavigationId 读取错误。**
   `windows/orchestration.rs:407,431-435,513-518` 使用无上限 `HashSet<u64>`，getter 错误被 `let _` 转成 0，且只有收到 `NavigationCompleted` 才移除。WebView 被销毁时闭包最终会释放集合，但在回调缺失/异常期间仍会增长，0 或迟到 ID 也可能误认后续完成事件。应使用带 URL 的 bounded map、显式处理 ID 错误，并覆盖 session/controller teardown。

6. **facade favicon/url gap-resync 控制流回归。**
   `packages/ext-webview/src/orchestration.ts:684-715` 先独立处理 `kind === "urlChange"`，随后 `if (kind === "faviconChange") ... else`；URL gap 会额外进入 title 分支，用 `result.title`（undefined）调用 title handlers。应改为互斥 `switch`/`else if`，并补 URL-gap + title listener 回归测试。

### P3

7. **公共文档/注释漂移。** `packages/spec/src/webview.ts:268-280` 的 unified event family 注释仍只列旧五类，遗漏 navigationAction/faviconChange；`WebviewNavigationRuleAction` (`crates/opentray-spec/src/webview.rs:451-455`) 是导出 DTO 但无 API doc。更新注释及 contract-6 的 `(value,seq)` 表述。

8. **OpenSpec 交付账仍未闭合。** `tasks.md:25-33` 的 4.1/4.2/5.1-5.3 仍为 `[ ]`（全量电池、黑盒、changeset、skills/blog 文档）；self-review 中的证据不能替代任务账或发布产物。

## 已验证的正确部分

- `WebviewEventPayload` 中 `NavigationAction` 位于 `UrlChange` 前且 `navigation_type` 必填（`crates/opentray-spec/src/webview.rs:500-550`），未发现 untagged serde 吞帧问题。
- macOS `LoadStateNavigationDelegate` 对允许路径把已有 navigation/response/finish/commit/download/terminate 方法完整转发；阻断路径跳过 wrapped delegate、直接 Cancel 并发 failed，符合同步 veto 设计（`macos/load_state.rs:65-133`）。
- `ViewEvents::note_favicon_change` 同 href 不烧 seq，Latest cache/query seq 一致；EventPort 分类为 `faviconChange=Latest(<webviewId>/favicon)`、`navigationAction=Edge`（`orchestration.rs:436-478`, `event_port.rs:426-435`）。
- bridgeless favicon 脚本不创建 navigator/id/channel surface，且不会复用 16ms drain；但其提交内容仍需 native scheme 校验。

## 可验证修复建议

1. Windows 将 `blocked_ids: HashSet<u64>` 改为 bounded `HashMap<u64, String>`（或 navigation-generation keyed record），在阻断时写入当前 URI，在 completed 时按 ID取出该 URI；NavigationId/Status 读取失败直接记录诊断并走安全失败路径；session teardown 清空并测试两个交错 ID、无 completion、ID=0/读取错误。
2. 在 `ViewEvents` 保存 `favicon_enabled`；创建时透传，`get-webview-favicon` 对 false 以 typed `invalid_payload`/capability error 拒绝；统一 Rust/TS 结果为 `value: { href: string } | null, seq`，同步 fixtures、facade、contract stateResync 和 gap-resync。
3. 用无歧义的字符扫描/标准 escape helper 修复 TS glob，并加入与 Rust 完全相同的 adversarial cases（`.` `[` `]` `+` `?` `(`、host/path 边界）；将 canonical `example.org` vs `exampleXorg` 作为必测负例。
4. favicon native ingress 解析当前文档 URL，接受并发出绝对 `http`/`https`，拒绝/忽略 `data`、`file`、`blob`、相对和空值；macOS/Windows 共用 parser 或至少共用测试表。
5. 将 resync 分支改为按 kind 的互斥 `switch`，补同时注册 URL/title listener 的 gap 测试；清理 stale docs 与导出类型注释。

## Standards

仓库未发现独立 `CONTRIBUTING`/`CODING_STANDARDS` 文件；按 `AGENTS.md` 外部导出接口注释规则及 Fowler baseline 检查。`git diff --check` 通过。判断性 smell：macOS/Windows 存在重复的 `report_view_favicon` JSON 解析（Duplicated Code），`create_child_webview/build_child_webview` 参数继续成簇增长（Data Clumps）；前者可抽共享 parser，后者可封装 typed creation options。两者是质量建议，不单独作为硬 blocker。

## 验证记录

- 独立通过：`pnpm --filter @opentray/spec exec vitest run src/webview.test.ts`（56/56）。
- 独立通过：`pnpm --filter @opentray/ext-webview exec vitest run src/orchestration.test.ts`（33/33）。
- 独立通过：两包 `typecheck`、`openspec validate add-navigation-favicon-surface --strict`、`git diff --check`。
- 简报/仓库 self-review 提供 Rust workspace 379、Windows ext-webview 189 + spec 52、JS 全量及 `/tmp/navfav-smoke` 10/10；本轮未在深 swap/已有多 Codex 负载下重跑 Rust/Windows/native 黑盒，因此这些标为 supplied evidence，不升级为本轮独立复现。

## 实现质量与评分

实现质量评价：**架构方向良好，协议和跨平台接线覆盖广，测试意识较强；但发布前仍有三项契约级问题和三项运行时健壮性问题。**

**综合评分：5.5/10。**

评分依据：+2.0 事件分类/订阅门控/Latest 去重与 serde 设计；+1.5 macOS delegate、bridgeless observer 和 facade 主链路；+1.0 已提供双平台与黑盒证据（但非本轮重跑）；-2.0 Windows blocked URL/ID 关联；-1.5 favicon capability/线格式不符 spec；-0.75 TS/Rust glob divergence；-0.5 scheme 校验缺失；-0.25 resync 回归；-0.5 发布任务与文档未闭合。修复 P1/P2 后可重新评估至 8 分以上，前提是补齐全量/黑盒和 release/docs 任务。
