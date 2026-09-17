# add-ext-clipboard — Tasks（design draft）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported）已随 `add-ext-dialog` 与 `add-ext-sound` 归档落地——**直接复用，无依赖门**。
> 评审记录：design draft，Codex 评审 pending（确认性流程——设计内无开放问题，全部预授权
> 冻结；复核确认后进入实现）。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过。
  - 证据要求：vision validate add-ext-clipboard ok；CI 接线复用泛化 embedded-packages 管线（dialog/sound 已绿路径零新增脚本）。

## 2. BDD Contract

- [ ] 2.1 `@opentray/spec`：ClipboardCapability 面（`readText(): Promise<string | null>` / `writeText(text)` / `clear()`）、ClipboardBackendCapabilities（共享 schema + exhaustive fixture）、typed 错误码三枚（`clipboard_platform_unsupported` / `clipboard_locked`（details: attempts, elapsedMs）/ `clipboard_unavailable`（details 含 OS 错误码））的 details 判别联合；单测。
  - 证据要求：spec 套件绿（Node + Bun 双跑）。

## 3. Implementation — 批次 B（crates/opentray-ext-clipboard）

- [ ] 3.1 darwin：NSPasteboard.generalPasteboard 写（`clearContents()` + `setString(forType: .string)`）/ 读（`string(forType: .string)`，`nil` → null）/ 清（`clearContents()`），owner 线程（MainThreadOnly 家族纪律）；seam 化 pasteboard 读取。
  - 证据要求：darwin seam 单测覆盖写/读/清三路径。
- [ ] 3.2 win32：`OpenClipboard → 操作 → CloseClipboard` 单命令内闭合（绝不跨命令持有句柄）；写 = `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)`（HGLOBAL 全局内存，UTF-16 零终止）；读 = `GetClipboardData` 深拷贝后立即 Close；清 = `EmptyClipboard`；**有界重试纪律**（`OpenClipboard` ACCESS_DENIED → 总预算 ≤2s，退避 10ms→20ms→…→200ms 封顶，耗尽 → typed `clipboard_locked`）。
  - 证据要求：spy 注入 OpenClipboard 失败序列（先拒后成 / 恒拒 → 退避轨迹与 typed 终态断言）；HGLOBAL 编解码边界单测（空串/emoji/代理对/超长 1MiB）。
- [ ] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture 比对。
  - 证据要求：双平台构造器 exhaustive fixture 单测；交叉编译零 warning。

## 4. Implementation — 批次 C（packages/ext-clipboard facade）

- [ ] 4.1 `attachClipboard(tray, options?)` → capability（tray.extend 家族同构）；**`getBackend(): Promise<...>` 异步冻结快照**（惰性加载后请求 DTO）；`contract.json`（extensionName "clipboard"、fingerprint `opentray-ext-clipboard-contract-1`）；embedded 描述符（复用 SDK 既有 kind）。
  - 证据要求：无同步 backend 属性；快照冻结断言。
- [ ] 4.2 facade preflight：Linux typed unsupported（零 broker 帧）；v1 仅 UTF-8 文本（非 string 入参 pre-transport TypeError）。
  - 证据要求：Linux 拒绝路径断言零 dispatch。
- [ ] 4.3 vitest 确定性套件（Node + Bun）：ABI 形状往返夹具（`{type:"backend"}` 法则）/ 错误码 details / embedded 描述符 / Linux typed 拒 + 零帧。
  - 证据要求：Node 与 Bun 双跑全绿。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `clipboard` component + 收齐矩阵（复用泛化 embedded-packages 管线）；package.json `files` 收口；pack-size 接入 + **真实体积实测报告**写入 evidence artifact（薄逻辑库，远低于 2MB 警告线）。
  - 证据要求：真实 tgz stat/digest + 解包逐 target identity（含 sha256/buildIdentity 断言）。

## 6. Verification

- [ ] 6.1 双平台真机验收：read/write/clear 往返（进程外系统剪贴板可观察——macOS `pbpaste` / win32 PowerShell Get-Clipboard 交叉取证）；锁竞态真机复现（并发写压测 → typed `clipboard_locked` 或预算内成功）；null 空态；`writeText('')` 与 `clear()` 语义分立取证；getBackend DTO 上报。
  - 证据要求：darwin（本机）+ Windows（honor 真机）双平台记录；证据落 evidence artifact。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；**真实 pack 证据**（共享 check-pack-size 脚本管线）。
  - 证据要求：CI run 全绿链接 + pack-size OK 输出。

## 7. Release

- [ ] 7.1 AGENTS.md Clipboard Extension Law 章提炼落档（readText null 空态一等公民、`writeText('')` ≠ clear、win32 有界重试纪律（预算/退避梯/typed 终态）、`Open→操作→Close` 单命令句柄闭合、owner 线程纪律）。
- [ ] 7.2 skills/opentray
  - 公共消费文档 `skills/opentray/references/ext-clipboard.md` + `packages/ext-clipboard/README`（内容源：design-reference + README；Owner 要求「其它 AI 能通过文档写出正确的代码」）。
  - **验收子项（一等任务，缺失即不通过）**：文档必须覆盖——① 安装（正常包管理器安装起点，无诊断步骤前置）；② 完整 API 面（attachClipboard / readText / writeText / clear / getBackend，含 readText null 空态与 `writeText('')` 语义）；③ 全部 typed 错误码及 details 载荷（attempts/elapsedMs、OS 错误码）；④ 平台降级与边界（v1 仅 UTF-8 文本、无变化监听、Linux typed unsupported、win32 锁竞态重试行为）；⑤ 一个可运行最小示例（copy-paste 即可跑通）。
- [ ] 7.3 self-review（md + html）+ check ok:true + Codex 复核至 GO。
- [ ] 7.4 changeset（minor）。

## archive-completeness

- [ ] specs delta 合入 `openspec/specs/clipboard-extension/`；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题（设计预授权冻结项无回溯）。
