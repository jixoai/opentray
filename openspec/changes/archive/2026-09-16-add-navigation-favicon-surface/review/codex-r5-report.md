# add-navigation-favicon-surface R5 复审报告

## 结论

**NO-GO / NEEDS-WORK；综合评分 8.0/10。**

候选提交 `39e2d4b3` 相对 R4 基线 `22e4b243` 已补上 completed-side `NavigationId()` 失败不再静默丢帧，以及常规 tombstone 命中不再重复发帧。但代码面仍没有闭合 blocked navigation 的“一个 action、一个稳定 failed、无第二终态”契约，且新增的取消防御会吞掉合法普通取消；因此不能进入 GO 后的 changeset、公共文档和发布步骤。

## 复审范围与证据边界

- 简报：`/tmp/navfav-codex-brief-r5.md`
- R4 报告：`/tmp/navfav-codex-report-r4.md` 与 `openspec/changes/add-navigation-favicon-surface/review/codex-r4-report.md`
- 实现：`39e2d4b3`，仅改动 `crates/opentray-ext-webview/src/orchestration.rs`、`crates/opentray-ext-webview/src/windows/orchestration.rs`
- 规范：`openspec/changes/add-navigation-favicon-surface/specs/webview-navigation/spec.md`、`specs/webview-favicon/spec.md`、`specs/webview-extension/spec.md`
- 未跟踪 `.agents/documents/d19-extension-event-port-design.md` 未修改，保留。

独立执行并通过：

- `@opentray/spec` webview Vitest：**56/56 PASS**
- `@opentray/ext-webview` orchestration Vitest：**34/34 PASS**
- 两包 `tsc --noEmit`：**PASS**
- `openspec validate add-navigation-favicon-surface --strict`：**PASS**
- `git diff --check 22e4b243..39e2d4b3`：**PASS**

复核简报附件：Windows 原始日志为 `opentray-ext-webview 194/194`、`opentray-spec 52/52`，黑盒冒烟 `11/11 PASS`；macOS 的 187/52 为简报提供的证据，本轮未再次启动 Rust/macOS 重负载。Windows 日志还有 `note_load_progress`、`BlockedNavigationRing::len` 等 dead-code warning，不是本轮新增行为 blocker。

## 阻塞问题

### P1：无

本轮未发现会造成跨应用数据破坏、任意代码执行或所有平台启动失败的 P1 问题。

### P2-1：starting-side `NavigationId()` 失败仍会产生第二条普通终态

证据：`crates/opentray-ext-webview/src/windows/orchestration.rs:468-531`，以及完成处理 `:627-676`。

规则命中时，起始侧 `NavigationId()` 失败会先发 `failed(4500001)`，随后 `SetCancel(true)`，但没有进入 ring，也没有记录“该 controller 已经为这次取消发过终态”的标记。后续 `NavigationCompleted`：

1. 若 id 读取成功，`complete(id)` 返回 `Ordinary`；
2. 若 id 读取失败，ring 为空，`take_oldest_orphan()` 也返回 `None`；
3. `ever_blocked` 只在 `block()` 成功时置位，因此该路径不会触发 `OperationCanceled(14)` 防御；
4. 普通失败分支随后发出平台错误（通常为 `failed(14)`）。

所以“starting getter-error 立即稳定失败”并不等于 exactly-once；它可形成稳定 `4500001` 加普通平台失败两条终态。R4 的 action-first 修复已满足顺序，但这条异常状态机仍未闭合。

可验证修复：在 controller-local ledger 增加不可归因的“starting-side terminal already emitted”记录，并让下一次 completion 只消费记录、绝不发普通终态；同时增加 start-id-error + completion-id-readable、start-id-error + completion-id-error、重复 completion 三组 handler 测试，断言只出现一条 `failed(4500001)`。

### P2-2：completed getter-error 的 FIFO 归因没有 WebView2 顺序契约

证据：`windows/orchestration.rs:584-597`、`orchestration.rs:586-591`。

`take_oldest_orphan()` 在 completed-side id getter 失败时消费最老未决 blocked URL。代码注释把“completions follow starts in order”当作假设，但没有找到 WebView2 对交错/乱序 completion 的保证，也没有 handler-level 测试证明这一点。可执行反例是：blocked A 在 ring 中，allowed B 随后开始并先完成，但 B 的 completion id 不可读；该 completion 会被错误标记为 A 的 `failed(4500001)`，A 后续 completion 再走普通路径。这样既错报 URL，也破坏事件和终态归属。

可验证修复：不要以 FIFO 伪造导航身份；保留 controller-local 未归因 completion 状态，只在有明确 generation/token 关联时发稳定 blocked 帧，否则丢弃并记录诊断。若产品决定冻结 FIFO 作为平台前提，必须补充可引用的 WebView2 顺序保证和交错 allowed/blocked、乱序 getter-error、重复 completion 的 handler 测试。

### P2-3：`ever_blocked` 永久吞掉合法的 `OperationCanceled(14)`

证据：`orchestration.rs:525,567,597-608` 与 `windows/orchestration.rs:651-660`。

`ever_blocked` 只增不减。一旦 controller 曾经有过任意规则阻断，之后所有 `WebErrorStatus=14` 都被静默丢弃，即使当前规则已清空、导航是普通允许导航、用户按 ESC 或引擎主动取消。这是对既有 `loadState failed` 行为的回归；简报称其为“accepted collateral”，但 OpenSpec 只要求 blocked 导航的稳定错误码，没有授权删除普通失败事件。

可验证修复：记录规则取消的 generation/provenance，而不是 controller 生命周期级布尔；只有明确属于已发 blocked 终态的 completion 才抑制。增加“先 block，随后清空规则，再由用户取消允许导航”的回归测试，要求仍发送普通 `failed(14)`。

### P2-4：tombstone 过期后非 14 状态仍回到普通失败路径

证据：`orchestration.rs:574-584` 的 `Ordinary` fallback，及 `windows/orchestration.rs:627-675`。

ring/tombstone 容量为 64。旧 tombstone 被淘汰后，迟到 completion 无法识别为 `AlreadyTerminal`；R4 新增的防御只覆盖状态码 14。若同一已补偿 blocked navigation 的迟到 completion 报告其它失败状态，仍会发普通 `loadState failed`，形成第二终态，且 URL 来自共享 `pending_url`，可能属于另一条导航。现有纯测试明确把过期 id 定义为 `Ordinary`，所以这不是不可达分支。

可验证修复：让所有已补偿/已终止 generation 在 completion 生命周期内进入不可重复终态，或对任何无法归因的 completion 一律只记录诊断、不发送普通 terminal；增加 65+ eviction、乱序、重复和非 14 status 的 handler 测试。

### P2-5：平台中立 orchestration 层引入 WebView2 专属状态码

证据：`orchestration.rs:597-617`。该文件和 `BlockedNavigationRing` 的注释明确将 ring 定义为 platform-neutral，但把 `WEBVIEW2_OPERATION_CANCELED_STATUS = 14` 和 WebView2 取消语义放进共享模块。仓库 AGENTS 规则要求共享层不得加入平台特例，应由 Windows adapter 持有常量/分类器，或通过平台能力谓词注入。

可验证修复：将 status 常量和 `is_rule_cancel_completion` 移到 Windows 模块；共享 ring 只表达“已终止/可归因/未知”状态。补一次 macOS 编译与跨平台模块检查，确保共享层不再引用 Windows 错误域。

### P3-1：controller teardown 仍只有 ring-level 隔离证明

当前实现依赖 WebView2 controller/observer 闭包析构来释放 ring；已有 fresh-ring twin 只证明纯 ring 不会消费前驱 id，没有真实 destroy/recreate controller 后迟到 completion 的平台 handler 证据。这不是本轮代码面 GO 的主阻塞，但发布前应补覆盖，避免生命周期假设再次成为跨视图归因问题。

### P3-2：release/docs 任务仍未闭合

`openspec/changes/add-navigation-favicon-surface/tasks.md:29-31` 的 5.1 changeset、5.2 公共 `skills/opentray`/contract 文档和 5.3 中英文博客仍为 `[ ]`。按简报约定它们应在代码 GO 后执行，因此当前属于后续发布阻塞，不改变本轮 NO-GO 的主要代码判断。

## R4 修复逐项核对

1. **completed getter-error 丢终态：部分修复。** 有未决 ring 条目时不再直接 return，而是 FIFO 消费并发出稳定 blocked 帧；ring 为空时继续普通路径。问题是 FIFO 归因未证明，且 starting-side id error 根本不入 ring，仍能重复发终态。
2. **tombstone 过期双终态：部分修复。** 正常 tombstone 命中返回 `AlreadyTerminal`，状态 14 的不可归因 completion 有防御；但 tombstone 仍有界，非 14 迟到 completion 仍回到 `Ordinary`，所以 exactly-once 没有在所有平台失败状态上成立。
3. **handler 测试：未完全满足。** ring twin 覆盖 FIFO、空 ring、tombstone 消费，纯函数覆盖 status-14 防御；没有真实 handler 对 getter error、allowed/blocked 交错、starting-id-error 重复终态、65+ eviction 非 14 状态的覆盖。
4. **重跑证据：基本满足但证据边界需保留。** Windows 与黑盒原始日志可核对，轻量 JS/TS/OpenSpec/diff 门禁本轮独立通过；macOS/Rust 仍是简报提供证据，不宣称本轮独立重跑。

## 已确认保持正确的部分

- `NavigationStarting` 在读取 id 前先推送 `navigationAction` 并同步求值规则（`windows/orchestration.rs:438-468`）。
- blocked 起始 id 可读时，URL 与 navigation id 进入 ring；正常 completion 命中后只发一次 `failed(4500001)`。
- eviction 的常规迟到 completion 命中 tombstone 时返回 `AlreadyTerminal`，不会重复发帧。
- fresh controller 使用新 ring，ring-level predecessor id 不会被 successor 消费。
- favicon 仍采用 `url::Url::parse + join`，并在 join 前后要求 HTTP(S)+host；本轮没有发现 R4 已修复的 resolver 回归。
- 黑盒链路保持 `navigationAction -> failed(4500001)`，允许导航仍能正常完成，favicon 动态变化和 query 收敛均通过附件证据。

## 质量评价

实现有明显进步：把 blocked URL/id 配对、普通 tombstone 消费、FIFO/防御纯逻辑抽出来，常规路径比 R4 更容易测试；action-first 重排也准确修复了 R3 的事件顺序缺陷，favicon 解析和事件主链保持清晰。

主要质量短板是失败路径的状态模型仍由注释和全局布尔拼接而成：`ever_blocked` 是过宽的 primitive state，FIFO orphan 是未经协议证明的归因猜测，ring 的 bounded memory 与 exactly-once 目标互相冲突；同时共享模块承载 Windows 错误域，破坏平台边界。代码注释还同时声称 exactly-once 并承认“residual duplicate window”，规范意图和实现承诺不一致。

## Standards 轴

- **P2 hard violation：** 共享 `orchestration.rs` 引入 WebView2 专属 status 14，违反 AGENTS 的“共享层不得加入平台 special case”规则。
- **P2 behavior/spec：** FIFO 错误归因、`ever_blocked` 取消回归和 tombstone 非 14 fallback 均是契约问题，不只是 Fowler smell。
- 判断性 smell：`ever_blocked` 命名和语义过宽（Mysterious Name/primitive state）；ring 与 Windows handler 的异常路径注释有重复。`git diff --check` 已通过。

## 综合评分与 R4 变化

**8.0/10，NO-GO。**

评分依据：

- `+2.0`：R3 的 action-first 已稳定，starting-side 可读 id 的正常 blocked 链正确。
- `+1.8`：正常 ring 配对、eviction compensation、tombstone `AlreadyTerminal`、fresh-ring 隔离和纯测试明显补强。
- `+1.5`：favicon resolver、订阅门控、native veto 和协议主链保持对齐。
- `+1.3`：本轮独立 JS/TS/OpenSpec/diff 门禁全绿，Windows/黑盒附件可核对。
- `-0.8`：starting-id-error 仍可重复终态，completed FIFO 又引入错误归因窗口。
- `-0.6`：`ever_blocked` 吞掉普通取消，tombstone 非 14 仍可重复失败。
- `-0.2`：共享层平台边界违规及 handler-level 异常覆盖不足。

R4 为 **8.2/10 NEEDS-WORK**。R5 的常规 completed getter/tombstone 路径确有实质进展，但本轮复核发现的 starting getter-error、FIFO 归因、取消回归和共享层污染使评分不升反降；代码面仍不能 GO。

## GO 前最小验收清单

1. 为 starting-id-error 建立 controller-local terminal marker，证明稳定 blocked failure 只出现一次。
2. 移除无证明的 FIFO orphan 归因，或冻结并验证 WebView2 completion 顺序/generation 契约。
3. 将取消抑制从 `ever_blocked` 改为规则取消 provenance；保留真实普通 `OperationCanceled` 的既有失败事件。
4. 所有过期/无法归因 completion 均不得发第二条普通 terminal；覆盖 65+ eviction、乱序、重复和非 14 status。
5. 把 WebView2 status 分类移出 platform-neutral orchestration，并补跨平台编译检查。
6. 在修复后重新记录 macOS/Rust、Windows 真机和黑盒原始输出，核对日志实际计数；然后执行 `tasks.md` 的 5.1 changeset、5.2 公共 skill/contract 文档、5.3 中英文博客。
