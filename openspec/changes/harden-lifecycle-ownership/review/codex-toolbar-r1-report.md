# OpenTray toolbar R1 对抗性复核报告

- 复核基线：`63c8782b803ae2ac255bb7049b770c25f7bc042f`
- 工作树：只读；唯一既有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 保留未动
- 结论：**NEEDS-WORK**
- 综合评分：**5.5/10**

## 总结

当前 HEAD 直接证实 Darwin app bundle 锁存在不可回收的陈旧化路径：`open(lockPath, "wx")` 成功后没有写入 owner，`kill -9` 会留下 0 字节锁，之后固定等待 5 秒并报 `bundle_lock_timeout`。这是用户现场 5/5 复现、且应进入 0.27.5 的确定 blocker。

Bug 1 的清理实现确有 owner/session 不可绕过的裸 `tray_id` 删除缺陷，但简报描述的“旧 session 清理已取条目、随后新 session 插入、再由旧清理删除新 session”的生产交错，当前 broker 调度没有证明可达：`Exit` 和 transport `Disconnected` 都在单一事件循环中同步调用 Core/extension cleanup。该项应作为高风险结构缺陷保留，并补 seam 测试，不应在没有现场时断言它是 `unknown_view×5` 的唯一根因。

Bug 3 的归因与 HEAD 不完全一致。`getUrl()`/`getTitle()` 是普通 request，`LocalBrokerConnection` 在 socket `error`/`close` 上会拒绝 handshake 与全部 pending request；现有测试也验证 broker close 后 `child.getUrl()` reject `broker connection closed`。仍成立的问题是事件订阅、sequence-gap resync 和 listener surface 没有统一的 connection-dead 状态，fire-and-forget `.catch()` 只打印错误，因而可能静默停止更新。

Bug 4 的“回溯跳过 private 包”在 HEAD 不存在。caller label 逻辑是 `explicit > npm_package_name > script basename > opentray`，没有读取 package.json 或检查 `private`。但 `connectLocalBroker` 又优先使用 `appName`/`appId`，生成模板确实传入二者，因此现场 label=`opentray` 与当前模板/HEAD 不一致，必须先锁定实际 `main.mjs`、实际安装版本及 `require.resolve()` 路径。

## Q1：Bug 1 迟到清理交错是否可达

### 源码事实

- Core `ClientFrame::Exit` 直接执行 `close_session_with_extension_host`：`crates/opentray-core/src/broker.rs:147-173`。
- Core cleanup 同步删除该 session 的 trays，再同步调用 `extensions.session_closed`：`crates/opentray-core/src/kernel.rs:266-281`。
- Unix transport 的 `Disconnected` 在 broker 主循环内同步取出 transport session、revoke EventPort、调用 Core close：`crates/opentray-bin/src/unix_transport.rs:261-290`。
- macOS 主循环的 `Disconnected` 同样同步执行：`crates/opentray-bin/src/main.rs:825-850`。
- Windows `ClientFrame::Exit` 完成 Core cleanup 后直接移除 session 并退出，不等待可能延迟的 named-pipe `Disconnected`：`crates/opentray-bin/src/main.rs:801-823`。
- macOS extension cleanup 先按 `session_id` 从 registry 取条目，却按裸 tray id 删除 native session：`crates/opentray-ext-webview/src/macos/mod.rs:913-945`、`2384-2414`。
- Windows 具有同构实现：`crates/opentray-ext-webview/src/windows/mod.rs:1031-1061`、`1540-1564`。
- Registry 的 owner 匹配本身按 session id 正确；但 `destroy_window`/`destroy_window_session` API 只接收 tray id：`crates/opentray-ext-webview/src/orchestration.rs:469-507`、`554-584`。
- `unattributed` 条目在任意 session close 时被移除，是明确 transitional rule：`crates/opentray-ext-webview/src/orchestration.rs:558-575`。

### 判定

这是明确的结构性竞态面：如果一个旧条目已经被 `registry.session_closed(old)` 收集，而在调用 `destroy_window_session(tray_id)` 前有 reentrancy/异步 native callback 插入新 owner，同一 tray 的新 session 会被裸 key 删除。当前主调度是串行同步的，源码没有显示这段窗口会在生产路径中让新 session 插入；因此“机制存在”已证实，“简报交错在当前 runtime 可达”未证实。

### 建议的最小证明

为 macOS/Windows 各加一个测试 seam：收集 old entry → 注入同 tray/new session → 执行 destroy；断言 new session 仍存在。修复应让 destroy API 接受并校验 `(appId,trayId,sessionId,windowId)`，不只在一个调用点加 `if`。

## Q2：被摧毁后是否会重建为同 owner + 同 window id 且空 webviews

### 源码事实

- `ensure_session` 使用 `app_id=self.app_id()`、传入 `tray_id`、`owner_session_id`，window id 缺省为 `"default"`：macOS `crates/opentray-ext-webview/src/macos/mod.rs:1835-1946`；Windows 对应路径 `crates/opentray-ext-webview/src/windows/mod.rs:1180-1258`。
- `registry.open_window(owner.clone())` 先登记 owner；创建失败会回滚 registry：macOS `:1859-1884`，Windows `:1195-1215`。
- 新 `WindowSession` 明确初始化 `webviews: HashMap::new()`；只有 `!window_only` 才构造 primary webview：macOS `:1985-2194`。Windows 的 `session_has_no_primary` 也是 `session.webviews.is_empty()`：`windows/mod.rs:1587-1589`。
- `resolve_window` 严格比较 app/tray/session/window 后返回 `self.sessions.get(tray_id)`：macOS `:1451-1470`；随后 `native_webview_for` 再从 `session.webviews` 查 id，失败即 `unknown_view`：`:1488-1500`。Windows 同样输出 `unknown_view`，`windows/orchestration.rs:1719-1728`。
- `unknown_view` 文本为 `webview id <id> is not registered in this window session`：macOS `:2617-2626`。

### 判定

**可以发生。** `windowOnly` bootstrap 本来就允许空 `webviews`，随后由 `create-webview` 填充。若某次销毁后同一连接以相同 owner/session/window 再次 `show({windowOnly:true})`，registry/window resolve 可以通过，而 child map 仍为空，所有 child command 都会得到 `unknown_view`。这证明了症状形态，但不证明是当前现场的唯一触发源。

可替代解释包括：

1. 初始 `window.show()` 错误在生成模板中被吞掉，随后仍执行 `attachToolbarCarrier`：`packages/create/packages/core/src/url-entry-template.ts:152-169`，以及 command entry 的同样模式 `entry-template.ts:318-327`。
2. `createWebview(toolbar/content)` 任一步 native/ABI 失败，导致 child 注册不完整；当前 carrier 只把 channel/post 错误写入 app.log，未把 bootstrap 每一步及 child registration 结构化记录。
3. stale broker/extension artifact 或 command-surface skew；简报现场只有 `unknown_view`，不足以排除实际加载 dylib 与 facade 不一致。
4. toolbar channel self-heal 与 session teardown/re-show 顺序交错；carrier 会在 close 后 300 ms 重建 channel：`packages/create/packages/core/src/toolbar-carrier.ts:163-205`。
5. `windowOnly` 的正常空 session 与 `create-webview` 请求排序交错。

## Q3：caller label 回溯与 private 包

### 源码事实

- `resolveCallerLabel` 只有 `explicit > npm_package_name > basename(argv[1]) > opentray`：`packages/cli/src/daemon/caller-label.ts:19-49`。
- 没有 package.json 读取，也没有 `private` 判断；测试明确覆盖 basename 和 neutral fallback：`packages/cli/src/daemon/caller-label.test.ts:25-39`。
- `connectLocalBroker` 的实际优先级是 `options.callerLabel ?? appName ?? appId ?? resolveCallerLabel()`：`packages/cli/src/local-broker.ts:100-115`。
- 生成 package.json 虽然写入 `private: true`：`packages/create/packages/core/src/scaffold.ts:161-186`，但该字段没有进入 label 解析。
- 生成 URL/command entry 都传入 `appId` 和 `appName`：`url-entry-template.ts:91-114`、`entry-template.ts` 的同构 createTray 调用。

### 判定与修法

简报所说“private 包被跳过导致 `opentray`”与当前 HEAD 不符。现场形态更可能来自旧生成物、旧安装 graph、未使用当前模板，或直接调用 SDK 时未传 app identity。先收集实际 entry 内容、`opentray` package version、`require.resolve("opentray")`、`pnpm why` 和 broker ready metadata。

“模板显式固定 caller label”是可行的确定性方向，但当前公开 `OpenTrayRuntimeOptions` 没有 `callerLabel`（仅内部 `ConnectLocalBrokerOptions` 有）：`packages/cli/src/sdk.ts:29-42`、`local-broker.ts:67-75`。因此不能只修改 `resolveCallerLabel`；应先决定是否公开 runtime callerLabel，或从已解析的 caller package identity 统一派生，并同步 endpoint、stateRoot、ready metadata、broker env 和测试。

## Q4：修复方案 1–4 复核

### 方案 1：session owner 校验

必要且应进入 0.27.5，但当前描述不完整：必须同时覆盖 macOS/Windows 的 `session_closed`、`destroy_window_session`、`destroy_child_webview`、registry destroy/remove API 及 unattributed transitional 分支。契约应使裸 tray-id 删除无法绕过 owner 校验。需要 reentrancy seam、跨 session 保活测试和 channel/popup cleanup 断言。

### 方案 2：bundle lock 自愈

必要且是确定 blocker。当前实现 `ensureDarwinAppBundle` 在 `packages/packaging/src/app-bundle.ts:106-124` 获取锁；`acquireBundleLock` 在 `:661-681` 只 `open(...,"wx")`，成功后没有写内容，EEXIST 固定等待，最终 `bundle_lock_timeout`。`app-launch.ts` 另有一份同样不带 owner 的锁实现：`packages/packaging/src/app-launch.ts:34-55`、`:106-125`；若只修 app-bundle，launch descriptor 更新仍会留下同类陈旧锁。应共享 PID+token lock helper，写入并 flush owner 后才视为持有；空/非法/死 PID 可 bounded reclaim；release 必须 token/inode 安全，防止误删替换后的锁。

### 方案 3：broker 死亡后的僵尸 entry

方向正确但需重写验收：

- 普通 request pending 已由 `LocalBrokerConnection.rejectAll` 处理：`packages/cli/src/local-broker.ts:253-258`、`:387-394`。
- `getUrl/getTitle` 是 request map，不是只等推送：`packages/ext-webview/src/orchestration.ts:899-930`；现有测试验证 close 后 reject：`packages/ext-webview/src/orchestration.test.ts:612-637`。
- 真正缺口是 push/listener：`sendBestEffort` 与 gap-resync `.catch()` 只 `console.error`：`orchestration.ts:409-415`、`:486-557`；没有统一 connection-dead 状态、listener terminal callback、resync cancellation 或 entry-level shutdown。

0.27.5 应拆为 transport-dead 状态传播、pending request rejection（保持现有）、event subscription fail-loud、gap-resync 取消、生成 entry 的 process/session shutdown；不能把“getUrl 永不 reject”作为当前 HEAD 已证实事实。

### 方案 4：固定 label

可属于 0.27.5，但前提是先冻结 API/identity 来源。单在模板中写字符串会引入 appId/appName/package identity 三套来源；应让生成器输出一个稳定、规范化的 caller label，并让 runtime 将其贯穿 paths/ready/env/endpoint。若不公开 `callerLabel`，则必须在 SDK 内从 caller package identity 统一派生并证明 direct launch 与 CLI 相同。

### 方案 5：A+B 架构

应保持后续独立 change。entry 单一所有者、WebSocket/SSE 控制线会扩大生命周期和协议边界，不能混入 0.27.5 的小修复。

## Blockers

1. **P1 / confirmed：** Darwin app bundle 与 app-launch descriptor 两处锁均不可回收空/非法 stale lock；用户会永久卡在 5 秒 timeout，必须修并加 kill/restart 回归测试。
2. **P1 / high-risk:** macOS/Windows session cleanup 以裸 tray id 删除 native session；虽生产交错未证明，owner 校验缺失不可接受。
3. **P1 / evidence gap:** `unknown_view×5` 的现场日志只证明 child lookup 失败，不能区分迟到清理、bootstrap partial failure、stale artifact 或 channel/session ordering。
4. **P1 / contract gap:** 方案 4 未说明公开 callerLabel 还是 package identity 派生，无法直接实现而不改变 API 语义。
5. **P2:** push/listener transport death 只 console-log，可能造成 entry 表面存活但 UI 永不再同步。

## 验证记录

- `pnpm --dir packages/create/packages/core test -- src/toolbar-carrier.test.ts`：15 files / 202 tests passed（包含 syntax gate、D24 loadState、channel self-heal）。
- `pnpm --filter opentray test -- src/daemon/lifecycle.test.ts src/daemon/caller-label.test.ts src/local-broker.test.ts`：14 files / 124 tests passed。
- `pnpm --filter @opentray/ext-webview exec vitest run src/orchestration.test.ts src/index.test.ts`：2 files / 71 tests passed。
- `pnpm --filter @opentray/packaging exec vitest run src/app-bundle.test.ts`：1 file / 8 tests passed；现有测试未覆盖空 bundle lock 的 stale reclaim。
- `cargo test -p opentray-core disconnect_cleans_only_current_session`：1 passed。
- `cargo test -p opentray-ext-webview --lib orchestration::tests`：14 passed（含 registry/session cleanup tests）；未覆盖“收集旧 entry 后 reentrant 插入新 owner”的 seam。
- create-opentray 包级全量运行另有一个与本 toolbar 复核无关的既有 `wizard.test.ts` force-wipe timeout；专项 core 测试通过，不能把该旁支失败归因于 toolbar。
- 未执行 macOS GUI/黑盒现场复现；未执行 Windows native GUI。所有平台结论均限于源码、单元测试和当前 Darwin host 上的非 GUI 验证。

## 评分依据

- 源码可读性、owner/session 注释和已有单元覆盖：7/10。
- toolbar carrier syntax/self-heal 实现及测试：7/10。
- 生命周期与锁健壮性：3/10（确定 stale lock blocker，且 app-bundle/app-launch 重复实现）。
- 根因证据闭合度：4/10（Bug 1 生产可达性、Bug 3、label 现场归因均有重要不一致）。
- 修复方案可执行性：5/10（1/2 方向明确；3/4 需收窄并先冻结契约）。

综合 **5.5/10，NEEDS-WORK**：在补齐两处锁自愈、owner 校验 seam/实现、transport-dead 设计和现场 artifact/entry 证据前，不建议进入 GO 或撰写无条件通过的 OpenSpec change。
