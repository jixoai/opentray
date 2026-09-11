# add-webview-orchestration — Tasks

## 1. Alignment / Investigation

- [ ] 1.1 结构门（机械可验证部分）：`plans/plan.md` 含 D1–D23 决策表与「D → requirement → task 追溯矩阵」，且矩阵覆盖每个 D；`bun run openspec:vision -- validate add-webview-orchestration` 通过；`plans/plan-v*.md` 均带「非规范历史备份」横幅；R1 B1–B10 与 R2 R2-B1–B19 的修订落位在 plan/specs/tasks 中可逐条对应（R2 落位：B1 备份横幅、B2/B10/B14 D6/D19/D20 合并与 schema、B3 session_scope 措辞、B4/B11 D2 bridge 策略、B5/B16 D20 close/destroy、B6/B15 canonical 编码、B7/B17 D12 职责边界、B8/B19 2.7b 生命周期矩阵、B9 D19 查询+seq、B12 命令行为闭环、B13 showAddressBar 删除、B18 D 范围同步）。MODIFIED requirement 与主 spec 的对齐是**人工复核项**（其本质是有意改写，无自动脚本可证），记录进 self-review，不以 validate 冒充。
- [ ] 1.2 每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（trace 到 plans/plan.md 决策与 specs requirement）

- [ ] 2.1 协议类型（@opentray/spec + opentray-spec Rust）：多 webview 命令帧（create/destroy/list 含 **per-child bridge 策略 DTO `{webviewId, messageChannels, navigatorWindow, navigatorScreen, nativeApi}` 全默认 false**、navigate/back/forward、focus）、**统一事件族** per-view 事件帧（kind ∈ `{urlChange, titleChange, focused, geometryChange}`；schema：`{owner:{appId,trayId,sessionId}, windowId, webviewId, kind, seq, payload 字段级 {url:string}/{title:string}/{focused:boolean}/{rect:{x,y,width,height}|null}（与页面桥同构）}` + 显式 subscribe/unsubscribe 帧，codec fixture 固化）、查询命令（`getUrl/getTitle` 返回 `(value, seq)`）、布局协议（layers/flex 字段/box/输入校验）、通道帧（create/onCreated/post/close/destroy/list + reason 枚举 + **RFC 8785 canonical 编码器，共享 fixture `fixtures/canonical-json/`（输入值 + 期望字节，含 `-0`/`1.0`/指数/Unicode 边界）** + 错误码注册表 `unknown_view/invalid_layout_measure/multiwebview_unsupported_style/tray_session_active/bridge_required/session_scope/not_open/payload_too_large/queue_overflow/invalid_payload`（queue_overflow 身兼 reason 与 post 错误码））、owner tuple 字段——类型与编解码往返测试（**TS/Rust canonical 编码器同字节——fixture 断言**）；两平台 DTO 平价断言（Darwin release 编译门）；事件传输语义测试（订阅生命周期/按 view 有序/断连停止，断言不依赖轮询间隔）——trace webview-extension 全部 requirement + webview-layout/webview-messaging 对应条款。
- [ ] 2.2 布局求解：Taffy 集成纯函数测试——layer 树 → Rect 快照（toolbar 列布局、镂空叠层、flex 分配、min/max 钳制）、未知 view id（`unknown_view`）、非法度量（NaN/负值/∞/min>max → `invalid_layout_measure`，求解前拒绝）、默认单层单 fill 回退、**不透明跨层重叠合法 + 样式互斥 v1 两检查点同错误码 `multiwebview_unsupported_style`（child 创建 / 窗口样式变更，拒绝前旧状态保持；检查点 (3) layout commit 为 future guard，v1 不设 BDD——见 spec 正文分层）**、box 输入穿透——trace webview-layout 全 requirement + webview-extension「orchestration」样式互斥 scenario。
- [ ] 2.2b overlay 投影（D23）：纯函数测试——(窗口 overlay 区域 ∩ view rect) → view 本地安全区（相交/部分相交/无交集空矩形）；单 webview 铺满退化 = 现值回归；布局提交后投影重算 + `geometryChange` 推送到受影响 view；拖拽区 view 本地声明 → 窗口坐标平移 → 布局提交重注册（陈旧平移清除）——trace webview-extension「overlay geometry per-view projection」+ webview-layout 提交事务句。
- [ ] 2.3 通道状态机：created→open→closed(reason)→destroyed 全转移；`not_open` 类型化错误；FIFO；**onClose 生命周期观测面（每闭恰一次 {reason}；不走私 onMessage）**；**close vs destroy 双 API + 单观测基数（open 上 destroy=单次回调 reason=destroyed；close 后 destroy=静默移除墓碑无二次回调；重复 destroy no-op）**；**post 超限 = 返回类型化错误 queue_overflow 且关通道（双端 onClose 观测）**；**精确上限（恰 1000 条/恰 1 MiB canonical 字节合法；第 1001 条 → queue_overflow；单条 canonical >1MiB → payload_too_large 且通道存活；RFC 8785 编码跨 TS/Rust 同字节共享 fixture `fixtures/canonical-json/`；NaN/Infinity → invalid_payload）**；**wire 七帧字段级 DTO（create{target}→{channelId}；post{channelId,payload}；close/destroy{channelId}→ok 幂等；list{}→{channels:[{channelId,state,reason?,endpoints:[{side,peer}]}]}；事件 created{channelId}/closed{channelId,reason}；错误信封 {error:{code,message}}、owner tuple 随帧；页面 peer 只给 side 标签不暴露 webviewId）+ codec fixture（@opentray/spec 与 Rust 协议 crate 双侧消费）**；list 语义（live + closed 墓碑、每会话 LRU 32、destroyed 不列出、页面只见参与集）；文档导航关闭页面侧端口；无桥目标 `bridge_required`；跨会话 `session_scope` 且零部分状态；页面创建者（page→page 经桥方法、host 不可被定向）——trace webview-messaging 四 requirement。
- [ ] 2.4 TS facade：createWebview（**含 per-child bridge 策略参数**）/destroyWebview/listWebviews/navigate/back/forward/focus()、urlChange/titleChange/focused 订阅 + **getUrl()/getTitle() 查询返回 (value, seq) + 订阅-查询-丢弃陈旧 seq 竞态语义**、setLayout/layout.update、row/column/view/fixed/grow sugar 编译对象 JSON、createMessageChannel({target})/onCreatedMessageChannel/listMessageChannels/**close()/destroy()/destroyMessageChannel(id)**——jsdom/mock endpoint 测试（含事件订阅生命周期与断连语义），trace 对应 requirement。
- [ ] 2.5 page bridge：webviewId 只读属性、`navigator.opentrayWebview.createMessageChannel({target})`（创建端返回 + 对端 onCreatedMessageChannel）、端点收发/关闭/销毁事件、**无 bridge 策略的 child 零暴露（content webview 默认无桥）**——trace webview-extension「page bridge knows its own id」「bridge is opt-in per child」+ webview-messaging「targeted connections」「page creates a channel」。
- [ ] 2.6 create 侧：toolbar 双 webview entry 模板断言（**两种应用**：URL toolbar + 命令应用服务窗 toolbar；布局、通道导航接口、无 PTY、shell 无导航端点、**无 iframe browse 产物**）、**命令应用行为闭环（服务 URL 真值/前进后退/重载/同步默认与 URL 模式平价）**、**showAddressBar 旧字段删除（canonical 唯一 = window.toolbar；旧冻结配置 loose-parse 忽略；新配置/导出不输出该字段）**、frameEmbeddable 全链路退役、向导开关默认关 + 两流程提供 + config 往返 + 预览边界（StableIframe 仅创作期）——trace generated-app-entry MODIFIED+ADDED、create-wizard MODIFIED+ADDED、create-project-config/create-cli-command-tree MODIFIED。
- [ ] 2.7 会话清扫：owner tuple 归属——同 broker、同 app、**distinct trays** 双 session 各持多 webview 窗口，其一关闭 → 恰清该 session 的窗口/webview/布局/通道，另一 session 存活可观测；lease 断开同语义——trace webview-extension「Session cleanup is scoped」（并覆盖现存 mod.rs:587-590 忽略 session id 的缺陷修复）。
- [ ] 2.7b 生命周期与事件族 scenario → task → 测试位映射（可机器核对，替代数量自述）：
  | scenario | task | 测试位 |
  |---|---|---|
  | lifecycle「Re-show preserves」 | 2.4 | facade jsdom：hide→show 复用、page runtime 存活 |
  | lifecycle「Destroy removes」 | 2.4 | facade jsdom：destroy 后 show 全新 session |
  | lifecycle「second session typed rejection」 | 2.7 | Rust runtime 测试：tray_session_active、旧 session 不动 |
  | lifecycle「Session cleanup scoped」 | 2.7 | Rust runtime 测试：distinct trays 交叉清扫 |
  | lifecycle「Lease cleanup」 | 2.7 | Rust runtime 测试：断连隔离 |
  | orchestration「样式互斥 v1 两检查点」 | 2.2 | 纯函数：检查点 (1)(2) 同错误码（(3) 为 future guard，v1 不设 BDD） |
  | events「Focus transfer both edges」 | 2.4 + 3.5 | facade 断言双 view focused true/false + 帧字段/seq；原生侧断言回调直推无轮询 |
  | events「Query plus sequence」 | 2.4 | facade jsdom：订阅-查询-丢弃陈旧 seq |
  | events「Events stop at disconnect」 | 2.4 | facade jsdom：断连停止 |
  | overlay「empty safe area / view-local tracking / single-view regression」 | 2.2b + 3.4 | 纯函数投影 + 原生事务推送 geometryChange |
  bootstrap 兼容性（可变 shell 状态可更新 / bootstrap-immutable 漂移拒绝）在 Rust runtime 测试覆盖（trace lifecycle MODIFIED 正文）。

## 3. Implementation — P1 原生能力（macOS 先行）

- [ ] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts，再开始产品代码。
- [ ] 3.2 协议层：opentray-spec Rust 帧（owner tuple 字段）+ @opentray/spec TS 类型 + 两平台 capability DTO（webviewId/布局/通道/事件/错误码）；Taffy 依赖进 opentray-ext-webview（版本锁 Cargo 并记构建证据；opentray-core 零变化）。
- [ ] 3.3 Rust 结构重构：WebviewSlot 1:1:1 → Window 容器 + N webview 槽（bridge_state 单 webview 指针解体）；**`session_closed` 按 session id 精确清扫（修 mod.rs:587-590）**；wry build_as_child/with_bounds 接线；样式互斥检查点 (1) child 创建 + (2) 窗口样式变更 → `multiwebview_unsupported_style`（检查点 (3) layout commit 为 v1 前向兼容位——v1 无 per-view 透明输入，不设 BDD，见 plan D6）；**同 tray 第二 window session 创建 → `tray_session_active`**。
- [ ] 3.4 Rust 布局：layer 数组 → 每层 Taffy 树求解（输入校验前置、逻辑→物理像素经 scale factor）→ setFrame 应用；resize 原生重算（windowDidResize 接线）；box 视图（layer-backed NSView，background/border/cornerRadius，不接受 first responder 实现输入穿透）；**布局提交事务含 overlay 安全区投影重算 + geometryChange 推送 + 拖拽区重注册（D23，单 webview 退化路径先行）**。
- [ ] 3.5 Rust 通道：注册表（会话作用域 + owner tuple）+ 状态机（精确上限/墓碑 LRU32）+ 推送投递（ipc_handler 收 + evaluate_script 派发）；per-view urlChange/title/focused 事件**原生回调直推事件通道（不进 16ms drain）**；back/forward 原生历史 API（WKWebView goBack 穿透）。
- [ ] 3.6 macOS 原生验证：multiwebview 窗口冒烟——toolbar+content 布局、resize 跟手、**focus() 切换（断言双 view focused 边沿事件 + 帧字段/seq）**、navigate/back/forward、urlChange 跟随页内跳转、HN（XFO DENY）整页渲染、登录态持久实证、box 边框绘制且鼠标穿透、不透明重叠 + 样式互斥检查点 (1)(2) 拒绝、**toolbar bridge={webviewId,messageChannels} 且 content 零桥暴露**。

## 4. Implementation — P1 Windows 泛化（真机 `ssh gaubeehonor`，专门子代理执行）

> **同步通道（4.0 建立，已实证）**：git push over ssh 因远端 cmd shell 引号语义不可用——通道为 **git bundle + `/usr/bin/scp`(SFTP) → bare 中继 → Windows worktree**。增量同步：本机 `git bundle create /tmp/opentray-orch.bundle add-webview-orchestration` → `/usr/bin/scp ... gaubeehonor:E:/dev/github/opentray-orch.bundle` → 远端 `git -C E:\dev\github\opentray-orch-bare.git fetch E:\dev\github\opentray-orch.bundle add-webview-orchestration:add-webview-orchestration` → `git -C E:\dev\github\opentray-orch fetch orchrelay && git reset --hard orchrelay/add-webview-orchestration`。Windows 检出：`E:\dev\github\opentray-orch`（分支 worktree，主检出未动）；herdr workspace `w40`（pane `w40:p1` 持有 ssh 会话，cmd shell，中文输出需 `chcp 65001`）。**npm 安装必须 `--registry=https://registry.npmmirror.com`（npmjs.org 在该机被阻断）**；E 盘仅 18.4 GB 可用（cargo 用 caller-scoped target dir）；pnpm 10 忽略了 esbuild 等构建脚本（需要时 `pnpm approve-builds`）。

- [x] 4.0 Windows 真机准备（2026-09-11 完成，子代理取证 + 编排者抽验）：herdr workspace w40 + `w40:p1` ssh 会话（密钥认证直连）；工具链在位（git 2.53 / cargo+rustc 1.96 / node 26.3.1 / pnpm 10.22）；LAN 同步通道建立（bundle+scp→bare 中继→worktree，见上方节引）；Windows worktree `E:\dev\github\opentray-orch` @ 4de6cbd 与本机 HEAD 一致、干净、tracking orchrelay；`cargo metadata --no-deps` OK；`pnpm install --prefer-offline --registry=https://registry.npmmirror.com` 成功（746 包）。摩擦记录：git-over-ssh cmd 引号问题、zsh ssh wrapper 须用 /usr/bin/ssh、npmjs 阻断、cd 跨盘需 /d、GBK 输出——均已绕过并写入 AGENTS.md。
- [ ] 4.1 Windows child webview 接线（WebView2 多 controller 同 HWND、**共享 environment + 每 session retained WebContext（outlives children，创建错误含 profile 路径，profile 路径法不变）**、bounds 物理/逻辑换算、z 序 child HWND 顺序、box parent hit-test 穿透）；WM_SIZE 多 controller 泛化（host paint → N controller bounds → WRY child bounds 顺序法保持）；**WCO insets 按 view 投影动态重算（去硬编码全客户区假设）+ WM_NCHITTEST/拖拽路由按标题栏区域下实际 child view（D23）**。
- [ ] 4.2 Windows 通道/事件同实现验证（WebMessageReceived + ExecuteScript 派发；DTO 平价断言在 Windows 编译/测试通过）。
- [ ] 4.3 Windows 真机验收：同 3.6 冒烟清单在真机复跑取证 + WebContext/profile 专项（controller 销毁重建不换 profile 目录）。

## 5. Implementation — P2 create 承载切换

- [ ] 5.1 url-entry-template + entry-template 重写：**两种应用** toolbar/地址栏 = toolbar webview（shell 资产）+ content webview（直接 URL/已验证服务地址）+ column 布局；通道导航接口（指令/监听/查询三件套，create 包私有 schema）；托盘 Reload → content 原生重载；titleSync 投影 content 文档；**showAddressBar 字段与旧 iframe 分支删除（wizard.ts / entry-template.ts / config 旧路径；canonical 唯一 = window.toolbar）**。
- [ ] 5.2 browse-page 改造为 toolbar 页（去 iframe；地址栏真值 = urlChange 推送；快捷键保持；**stable-iframe 预览 tab 不动，仅创作期**）。
- [ ] 5.3 frameEmbeddable 退役：scrape.ts responseHeadersAllowEmbedding/ScrapeResult 字段/deriveUrlPresets 透传/CLI --toolbar 回退路径删除；**符号级 grep 门：`rg -n "frameEmbeddable|responseHeadersAllowEmbedding" packages/` 零命中**；相关测试更新（/deny fixture 用例改断言「不再回退、不警告」）。
- [ ] 5.4 向导「导航工具栏」开关（两流程、默认关、config 往返、draft 持久化）；CLI --toolbar 对命令应用开放。
- [ ] 5.5 关键效果点意图注释（指向 plan.md D1–D23）。

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
