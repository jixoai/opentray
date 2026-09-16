# add-navigation-favicon-surface R3 复审报告

## 结论

**NEEDS-WORK；代码面暂不 GO。综合评分：7.8/10。**

R3 已实质修复 R2 的 favicon URL 解析问题，并把 Windows blocked ledger 抽成可测试的有界 ring；但 Windows `NavigationStarting` 的 `NavigationId()` 失败分支仍在产生 `navigationAction` 之前提前返回，违反事件顺序和 blocked 链契约。容量淘汰也仍会在补偿帧之后把迟到 completion 降级成第二条 `OperationCanceled` 失败帧，代码注释把重复终态当作“文档化代价”，这不是 spec 要求的单一终态。

因此本轮不能进入 GO 后的 changeset、文档和发布步骤。

## 复审范围与证据边界

- 简报：`/tmp/navfav-codex-brief-r3.md`
- 候选实现：`be155c50af5c9e7a41b072a52c4cdffa9e7cf73a`
- 候选父提交：`6fb05d6fde86500f23808a8375eab484eb5df53c`
- 当前 HEAD：`a2f29ad5d0bebdf93c8fd88517c5ff71e9a43f90`；相对候选仅新增归档报告，未改变实现
- 实现 diff：
  - `crates/opentray-ext-webview/src/orchestration.rs`
  - `crates/opentray-ext-webview/src/windows/orchestration.rs`
- OpenSpec：`plans/plan.md`、`tasks.md`、`specs/webview-favicon/spec.md`、`specs/webview-navigation/spec.md`、`specs/webview-extension/spec.md`
- 仓库已有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 未修改

独立执行：

- `@opentray/spec` webview Vitest：**56/56 PASS**
- `@opentray/ext-webview` orchestration Vitest：**34/34 PASS**
- 两包 `tsc --noEmit`：**PASS**
- `openspec validate add-navigation-favicon-surface --strict`：**PASS**
- `git diff --check be155c50^..be155c50`：**PASS**

未独立重跑：Rust workspace、Windows 真机和黑盒。简报提供的 macOS 185、Windows 192、JS 135/80、黑盒 11/11 视为 supplied evidence；本机当时已有其他 cargo 测试，swap 为约 16.99/17.0 GiB，且不在 Herdr 管理 pane，按资源纪律未叠加 Rust 构建。

## 阻塞问题

### P2-1：`NavigationId()` 失败时丢失 `navigationAction`，且 blocked 导航顺序错误

证据：`crates/opentray-ext-webview/src/windows/orchestration.rs:438-475`。

当前顺序是先读取 `NavigationId()`，失败即 `return Ok(())`；只有成功才会计算并推送 `navigationAction`（约 477 行以后）。因此：

- 允许导航：没有 `navigationAction`、没有 `loadState started`、也不更新 `pending_url`；
- 被规则拦截的导航：先发 `loadState failed(navigation_blocked)`，但没有前置 `navigationAction`。

这违反 `webview-navigation/spec.md:7` 的“每个 decision point 推送一个 navigationAction”，以及 `:30` 的“一个 navigationAction 后跟一个 blocked failed”要求。简报声称 getter failure 已稳定化，但只稳定了错误码，没有保持事件链。

可验证修复：先读取 URI/平台属性，推送 `navigationAction` 并同步求值规则；仅在 blocked 且需要写 ring 时读取 NavigationId。ID 读取失败时，允许导航继续普通 `started/pending` 路径；blocked 导航在 action 之后直接发一次稳定 failed 并 `SetCancel(true)`，不以 0 入 ring。增加 allowed/blocked 两个 getter-error helper 测试，断言顺序和帧数量。

### P2-2：ring 淘汰补偿后，迟到 completion 仍会产生第二条失败终态

证据：`crates/opentray-ext-webview/src/orchestration.rs:496-503`、`windows/orchestration.rs:507-529,617-653`。

ring 满时 `block()` 返回淘汰项，调用方立即发送 `failed(navigation_blocked)`；但该项之后的 `NavigationCompleted` 已不在 ring，会落入普通失败分支并发送 `WebErrorStatus`（通常是 `OperationCanceled`）。同一 navigation 因此可能收到两条 terminal `loadState failed`，而 spec 只定义一条稳定 blocked failure。当前实现和注释明确接受这条重复帧，不能算 exactly-once。

可验证修复：保留“已补偿/已终止”的 bounded tombstone（按 navigation id 或不可关联 generation）直到 completion 被消费，completion 命中后丢弃；或让 ring 淘汰转为显式 pending-compensation 状态，确保后续 callback 只清理不再发普通失败。测试必须模拟 65 个并发 blocked 导航，断言每个 URL 至多一条 failed，且稳定码优先。

### P3-1：teardown 仍主要依赖闭包析构，缺少平台级可执行证明

证据：`windows/orchestration.rs:404-414` 创建 ring 并由两个 observer closure 持有；`destroy_child_webview` 路径没有本轮新增的 token 注销、ring 清空或迟到 completion 测试。注释说明“controller drop 后 closures/ring die”，但这是生命周期推断，不是显式 teardown contract。

这比 R2 已改善：ring 不再是跨视图共享容器，重建同 ID 会创建新 ring，源码上降低了串视图污染风险。但发布前仍应补一个 controller destroy/recreate + late completion 的平台 twin 测试，证明旧 ring 不会向后继视图发帧。

### P3-2：发布与公共文档任务仍未闭合

`tasks.md:29-31` 的 5.1 changeset、5.2 skill/API 文档、5.3 博客仍为 `[ ]`。按 R3 简报它们在代码 GO 后执行，故不作为本轮代码 GO 的唯一阻塞；在完成 P2 修复并重新验收后必须补齐。

## R2 问题逐项核对

1. **favicon resolver（R2 P1）— 已修复。** `resolve_webview_favicon_href` 现在使用 `url::Url::parse(base)` + `join(href)`，join 前后均要求 `http`/`https` 且存在 host；27 项测试覆盖 query、fragment、dot segments、大小写 scheme、端口、userinfo、scheme-relative、空 authority 和畸形 IPv6。macOS/Windows ingress 共用该函数。
2. **blocked ring 稳定码/0 ID（R2 P2）— 部分修复。** `(navigation_id, url)`、交错 completion、淘汰补偿、重复/未知 id 测试已加入；getter failure 不再把 0 写入 ring。但 getter failure 的 action-first 顺序仍错，淘汰后的迟到 completion 仍有重复失败帧。
3. **teardown（R2 P2）— 部分修复。** 每个 controller/observer closure 拥有独立 ring，源码注释明确 drop 语义；缺少实际 destroy/recreate/late-completion 平台测试和显式 token 清理证明。
4. **发布文档（R2 P3）— 未执行。** 仍按 GO 后顺序保留待办。

## 实现质量评价

优点：

- resolver 从手写字符串拼接升级为统一标准 parser/join，平台入口无重复解析语义；
- `BlockedNavigationRing` 把容量、交错、幂等和 URL 归因从 Windows COM callback 中抽离，纯测试明显增强；
- EventPort/订阅门控、Latest favicon 查询序列对、声明式 native veto 的总体架构保持一致；
- JS、spec、OpenSpec 严格门禁均绿，R3 diff 范围小且无空白错误。

短板：

- 失败路径的正确性仍以注释不变量代替端到端状态机约束；
- “淘汰即发送终态、迟到 completion 再走普通失败”把防无界增长与 exactly-once 终态混在一起；
- Windows handler 层没有覆盖 getter-error 和 65-way eviction 的行为测试，纯 ring 测试不足以证明调用方不会重复发帧。

## 综合评分与 R2 变化

**7.8/10，NEEDS-WORK。**

评分依据：

- +2.5：R2 resolver P1 已由标准 URL 解析和 adversarial 表驱动测试闭合；
- +1.5：ring 抽象、URL 配对、容量淘汰补偿、getter 不入 0、交错/重复/未知测试；
- +1.5：事件/规则/门控主链和 OpenSpec 对齐；
- +1.0：本轮 JS 测试、类型检查、strict OpenSpec、diff check 独立通过；
- -1.0：getter-error 在 `navigationAction` 前提前返回（P2）；
- -0.7：eviction 后可能双 terminal failed（P2）；
- -0.3：teardown/发布证据仍未闭合，且 Rust/Windows/黑盒未本轮独立重跑。

R2 为 **7.0/10 NEEDS-WORK**。本轮上升 **0.8 分**：最严重的 favicon resolver 已收敛，ring 的 URL 归因和淘汰稳定码也有实质进展；但没有达到 GO，原因是两个 Windows 异常路径仍未满足事件顺序和终态唯一性。

## GO 前最小验收清单

1. 修正 `NavigationStarting` action-first / rule-first 顺序及 getter-error 两条路径。
2. 为 eviction compensation 增加 tombstone/消费标记，保证一个 blocked navigation 至多一条 failed 帧。
3. 增加 Windows handler 测试：allowed getter error、blocked getter error、65-way eviction + late completion、destroy/recreate + stale completion。
4. 在干净/受控资源环境独立重跑 Rust、Windows 真机和黑盒，并记录实际输出。
5. GO 后再执行 changeset、skill 文档和博客更新。
