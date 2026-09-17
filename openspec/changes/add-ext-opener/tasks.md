# add-ext-opener — Tasks（design draft）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported）已随 `add-ext-dialog` 与 `add-ext-sound` 归档落地——**直接复用，无依赖门**。
> 评审记录：design draft，Codex 评审 pending——开放问题 O1（scheme 白名单宽严）以 Codex
> 裁决为准，裁决回写 plan/design/spec 后 scheme 门实现才冻结。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；O1 的 Codex 裁决回写 plan/design/spec 后 scheme 门实现冻结。
  - 证据要求：vision validate add-ext-opener ok；CI 接线复用泛化 embedded-packages 管线（dialog/sound 已绿路径零新增脚本）。

## 2. BDD Contract

- [ ] 2.1 `@opentray/spec`：OpenerCapability 面（`open(target)` / `revealInFolder(path)`）、OpenerBackendCapabilities（共享 schema + exhaustive fixture）、typed 错误码四枚（`opener_platform_unsupported` / `opener_target_invalid`（details: {reason}，含 reason: path-quote）/ `opener_scheme_blocked`（details 含 scheme）/ `opener_failed`（details 含 OS 错误串/码））的 details 判别联合；单测。
  - 证据要求：spec 套件绿（Node + Bun 双跑）。

## 3. Implementation — 批次 B（crates/opentray-ext-opener）

- [ ] 3.1 darwin：`NSWorkspace.open(URL(fileURLWithPath:))` / `NSWorkspace.open(url)` / `NSWorkspace.activateFileViewerSelecting([url])`，owner 线程；seam 化 NSWorkspace 调用。
  - 证据要求：darwin seam 单测覆盖 open(file)/open(url)/reveal 三路径。
- [ ] 3.2 win32：`ShellExecuteW("open", path/url)` 投影；`explorer.exe /select,<path>` 经 `ShellExecuteW("open", "explorer", params)`——路径以引号包裹单参数传递，`/select,` 前缀与路径间无用户可控空隙；owner 线程（COM 若实测要求则跟随现有 STA 初始化纪律）；scheme 大小写不敏感匹配。
  - 证据要求：spy 断言 ShellExecuteW 参数形态（引号包裹 / 无元字符拼接）；scheme 大小写矩阵。
- [ ] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture 比对。
  - 证据要求：双平台构造器 exhaustive fixture 单测；交叉编译零 warning。

## 4. Implementation — 批次 C（packages/ext-opener facade）

- [ ] 4.1 `attachOpener(tray, options?)` → capability（tray.extend 家族同构）；**`getBackend(): Promise<...>` 异步冻结快照**（惰性加载后请求 DTO）；`contract.json`（extensionName "opener"、fingerprint `opentray-ext-opener-contract-1`）；embedded 描述符（复用 SDK 既有 kind）。
  - 证据要求：无同步 backend 属性；快照冻结断言。
- [ ] 4.2 facade preflight：目标解析矩阵（绝对路径（存在性不作受理前提；不可读/不可 stat 仍透传原生）/ URL（`new URL()` 可解析且有协议）/ 其余 → typed `opener_target_invalid`）；scheme 白名单门（按 O1 裁决冻结：四 scheme 或放宽集；非白名单 → typed `opener_scheme_blocked` details 含 scheme）；revealInFolder 相对路径拒、**路径含引号字符拒（reason: path-quote）**；Linux typed unsupported（零 broker 帧）。
  - 证据要求：解析矩阵全正/负例断言（含 dispatch 与零 dispatch 分界）。
- [ ] 4.3 vitest 确定性套件（Node + Bun）：解析矩阵 / scheme 白名单矩阵（含大小写 `HTTPS://`）/ reveal 相对路径拒 / 错误码 details / ABI 形状往返夹具（`{type:"backend"}` 法则）/ embedded 描述符 / Linux typed 拒。
  - 证据要求：Node 与 Bun 双跑全绿。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `opener` component + 收齐矩阵（复用泛化 embedded-packages 管线）；package.json `files` 收口；pack-size 接入 + **真实体积实测报告**写入 evidence artifact（薄逻辑库，远低于 2MB 警告线）。
  - 证据要求：真实 tgz stat/digest + 解包逐 target identity（含 sha256/buildIdentity 断言）。

## 6. Verification

- [ ] 6.1 双平台真机验收：open(https URL) 默认浏览器受理、open(绝对文件) 默认应用受理、revealInFolder 文件管理器定位（人工/截图取证）、blocked scheme typed 断言（details 含 scheme）、path-quote 拒、getBackend DTO 上报。
  - 证据要求：darwin（本机）+ Windows（honor 真机）双平台记录；证据落 evidence artifact。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；**真实 pack 证据**（共享 check-pack-size 脚本管线）。
  - 证据要求：CI run 全绿链接 + pack-size OK 输出。

## 7. Release

- [ ] 7.1 AGENTS.md Opener Extension Law 章提炼落档（resolve-on-acceptance、preflight 解析矩阵（存在性非受理前提）、scheme 白名单裁决后法则、path-quote 拒绝律（拒绝而非转义）、owner 线程纪律）。
- [ ] 7.2 skills/opentray
  - 公共消费文档 `skills/opentray/references/ext-opener.md` + `packages/ext-opener/README`（内容源：design-reference + README；Owner 要求「其它 AI 能通过文档写出正确的代码」）。
  - **验收子项（一等任务，缺失即不通过）**：文档必须覆盖——① 安装（正常包管理器安装起点，无诊断步骤前置）；② 完整 API 面（attachOpener / open / revealInFolder / getBackend 与 resolve-on-acceptance 语义）；③ 全部 typed 错误码及 details 载荷（含 reason 枚举与 path-quote）；④ 平台降级与安全边界（scheme 白名单及大小写不敏感、路径含引号拒绝、存在性非受理前提、Linux typed unsupported）；⑤ 一个可运行最小示例（copy-paste 即可跑通）。
- [ ] 7.3 self-review（md + html）+ check ok:true + Codex 复核至 GO（含 O1 裁决落档核验）。
- [ ] 7.4 changeset（minor）。

## archive-completeness

- [ ] O1 裁决已回写 plan/design-reference 并体现在最终 spec；specs delta 合入 `openspec/specs/opener-extension/`；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题。
