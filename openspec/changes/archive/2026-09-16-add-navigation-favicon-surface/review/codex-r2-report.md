# add-navigation-favicon-surface R2 复审报告

## 结论

**NEEDS-WORK，暂不建议进入发布。综合评分：7.0/10。**

R1 的三个 P1 已基本落地：Windows blocked URL 不再依赖共享 `pending_url`，favicon 查询已有能力门控和 `value: { href } | null` 线格式，TS glob 转义也已修复并与 Rust 表驱动用例对齐。R2 仍有一个协议级 P1 和一个 Windows 生命周期/并发 P2：favicon resolver 仍是手写字符串拼接，不能保证标准 URL 解析；blocked ring 在异常/高并发条件下会丢失稳定的 `navigation_blocked` 结果。两者都需要修复后再发布。

## 复审范围与证据边界

- 候选提交：`5118542e6f349ae01ce29005b3105e94db5b307e`。
- 对比范围：`4fc5a31e^..5118542e`；OpenSpec 三件套及 `webview-extension`、`webview-navigation`、`webview-favicon` delta。
- 当前 `HEAD=6fb05d6f` 在候选之后只包含复审文档和 Windows 闭包错误类型的后续小改动；实现判断以候选树为准。
- 本轮独立通过：`@opentray/spec` webview 测试 **56/56**、`@opentray/ext-webview` orchestration 测试 **34/34**、两包 `tsc --noEmit`、`openspec validate add-navigation-favicon-surface --strict`、`git diff --check`。
- Rust workspace、Windows 真机和黑盒冒烟没有在本轮重新执行。简报中的 Rust/Windows/黑盒数字保留为 supplied evidence，不升级为本轮独立验收；当前机器 swap 使用约 17.6/18.4 GiB，且存在其他 cargo/Codex 负载。

## 阻塞问题

### P1-1：favicon href resolver 不是标准 URL resolver，仍可发出错误或非法的绝对地址

证据：`crates/opentray-ext-webview/src/orchestration.rs:497-541`，macOS 和 Windows 的 ingress 分别在 `macos/bridge.rs:110-142`、`windows/orchestration.rs:1890-1920` 调用该函数。实现只检查前缀、按 `://` 和首个 `/` 切字符串，并明确注明 `../` 不做 rebase。

可复现的契约缺口：

- `href="?v=2"` 或 `href="#icon"` 会按 base 目录拼接，不能得到标准 `URL::join` 的同一文档路径结果；`../`、`.` 也不会规范化。
- `https://`、`https:///icon`、缺失 authority 的 scheme-relative 值可能通过前缀分支或 `//` 分支；没有验证解析结果确实有合法 HTTP(S) authority。
- authority/path 用第一个 `/` 截断，不能作为 URL 语法解析器处理包含 userinfo、端口、查询、fragment 的边界输入。

这违反 `webview-favicon/spec.md:7` 的“against the document URL into an absolute https/http address”要求，也使 macOS/Windows 发送的 `faviconChange.href` 可能不是浏览器语义下的实际地址。

可验证修复：使用现有 `url` crate 的 `Url::parse(base)` + `Url::join(href)`；先要求 base scheme 为 `http`/`https` 且有 host，再要求 join 后 scheme 仍为 `http`/`https` 且有 host。增加 query-only、fragment-only、`../`/`.`、大小写 scheme、scheme-relative 缺 authority、userinfo/端口、畸形 absolute URL 的同一测试表，并由 macOS/Windows ingress 共享。

### P2-1：Windows cap-64 ring 会淘汰仍未完成的 blocked navigation，稳定错误码随后丢失

证据：`crates/opentray-ext-webview/src/windows/orchestration.rs:402-413,437-490,539-577`。

当前 ring 确实按 `(navigation_id, url)` 保存并能处理正常交错完成，但超过 64 个未完成阻断导航时会 `pop_front()`。被淘汰项的 `NavigationCompleted` 不再命中 ring，随后落入普通 `WebErrorStatus` 分支并使用共享 `pending_url`，因此不再满足 spec 要求的 blocked navigation → stable `navigation_blocked` failed 链。另有两个异常路径：

- `NavigationStarting.NavigationId` 读取失败时用 `0` 入 ring；`Completed` 读取失败直接 `return Ok(())`，既不发稳定 blocked 失败帧也不移除条目。
- 未知/重复/`id=0` 可能命中错误条目；没有针对交错、超过 cap、ID getter 错误和重复 ID 的平台测试。

可验证修复：不要把 ring 淘汰定义为语义丢失；为每个 controller 建立明确的 navigation generation/失败记录，或在无法关联时发带诊断的安全 blocked failure 并保证一次性清理。`NavigationId` 失败应进入显式“不可关联”状态，禁止以 `0` 作为正常 key。加入 fake `NavigationStarting/Completed` 测试：A/B 交错、64+ 淘汰、id=0、getter error、重复/未知 ID，并断言每个被取消动作至多一帧且错误码/URL稳定。

### P2-2：blocked ring 没有显式 teardown 清理和生命周期测试

证据：ring 在 `install_load_state_observers` 闭包中创建（`windows/orchestration.rs:412-413`）；`destroy_child_webview` 仅注销 webview/registry（`1804-1855`），没有清理协议状态或断开回调的验证。当前实现最终依赖闭包随 controller drop 释放，这不是对 session/controller teardown 的显式契约。

可验证修复：在 controller destroy/session close 路径明确取消两个 event tokens、清空 blocked records，并测试 destroy 后迟到 `NavigationCompleted` 不会发给新建的同 ID view。

### P3-1：发布任务和消费者文档仍未闭合

`openspec/changes/add-navigation-favicon-surface/tasks.md:29-31` 的 5.1 changeset、5.2 `skills/opentray` 文档、5.3 博客仍为 `[ ]`。这不阻塞代码级复审，但阻塞“完成后发布 0.28.0”的交付定义。应在发布前补齐 changeset、公共 API/事件文档和 Known limits，并让 contract fingerprint、skill 文档、博客使用同一最终线格式。

## R2 修复核对

- **已修复**：`favicon_enabled` 在两平台 create 路径透传并在 `get-webview-favicon` 命令拒绝；错误码注册为 `favicon_disabled`（Rust `webview.rs:86-116`，macOS `mod.rs:1196-1213`，Windows `orchestration.rs:1324-1341`）。
- **已修复**：Rust serde/fixture/facade 统一为始终存在的 `value: { href } | null, seq`；facade 查询和 gap-resync 均使用互斥 `if/else if/else`（`packages/ext-webview/src/orchestration.ts:635-723,1158-1180`）。
- **已修复**：bridgeless `favicon: true` 只注入 observe-only 脚本；无 favicon 时默认不启动该 observer。
- **已修复**：TS glob 使用标准元字符转义（`packages/spec/src/webview.ts:359-373`），TS/Rust 均加入 `. [ ] + ? ( ) { } ^ $ | \\` 和 `example.org`/`exampleXorg` 负例；两套表的语义一致。
- **部分修复**：共享 href resolver 已接入 macOS/Windows，但解析实现本身仍不足，见 P1-1。
- **已修复**：事件族注释、`WebviewNavigationRuleAction` API doc、contract-6 stateResync 文本已同步。
- **已修复**：`tasks.md` 的 4.1/4.2 已勾选；发布所需 5.1 changeset、5.2 skill 文档、5.3 blog 仍未勾选。

## 实现质量评价

整体架构方向正确：事件订阅门控、EventPort 分类、Latest favicon 查询/序列对、声明式 native veto、双平台共用 resolver 入口和 facade resync 的修复都体现了较好的协议意识。R2 也补上了 R1 反馈所要求的 adversarial glob 表和错误码冻结。

主要质量短板是边界语义没有完全由标准 parser 和平台 twin 测试托住。Windows ring 的 cap 目前同时承担“防无界增长”和“保证每个 blocked 导航可归因”两个互相冲突的职责；`report_view_favicon` 在 macOS/Windows 仍有重复 JSON 入口逻辑，后续容易再次漂移。当前报告不把这些重复代码作为独立 blocker，但建议抽出共享的 payload/URL 入口。

## 综合评分与 R1 变化

**7.0/10，NEEDS-WORK。**

评分依据：协议和双平台主链路完整、R1 三个 P1 已修复（+3.0）；favicon 能力门控/value 包装、facade resync、glob adversarial 表和文档同步有效（+2.0）；本轮 JS/type/OpenSpec 门禁全绿（+1.0）；resolver 仍可能产生错误 href（-1.5）；Windows ring 的淘汰、getter error、teardown 语义未闭合（-1.0）；Rust/Windows/native 黑盒证据本轮未独立重跑且 release/docs 任务未闭合（-0.5）。

相较 R1 的 **5.5/10 NEEDS-WORK**，评分上升 1.5 分；R1 的 P1-1/P1-2/P1-3 与 P2-6 已实质收敛，但尚未达到 GO 条件。修复 P1-1、P2-1/P2-2 并重新跑 Windows/Rust/黑盒证据后，才可重新评估发布。
