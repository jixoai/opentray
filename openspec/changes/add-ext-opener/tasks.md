# add-ext-opener — Tasks（implementation complete; release evidence in flight）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported）复用 `add-ext-dialog`/`add-ext-sound` 归档成果。
> 评审记录：design R2 GO 9.0（O1 裁决 = 严格四 scheme 白名单 http/https/file/mailto，
> 放宽留作未来加法，已回写 plan/design/spec）；实现复核 I2 P1（native URL 门与
> `new URL()` 不同构）已修 90398aaf（url crate WHATWG 同构 + 双侧语料测试）。

## 1. Alignment

- [x] 1.1 plan 索引与 design-reference 一致；validate 通过；O1 裁决回写后 scheme 门冻结。
  - 证据：7e9673bf 同步；R2 GO 9.0；`openspec:vision validate add-ext-opener` valid（2026-09-18 复验）。

## 2. BDD Contract

- [x] 2.1 `@opentray/spec`：OpenerCapability 面、OpenerBackendCapabilities、typed 错误码四枚 details 判别联合；单测。
  - 证据：bdfd2c07（OPENER_ALLOWED_SCHEMES 四 scheme 冻结常量等）；spec 套件既有 156/156 绿。

## 3. Implementation — 批次 B（crates/opentray-ext-opener）

- [x] 3.1 darwin：NSWorkspace open(file)/open(url)/activateFileViewerSelecting 三面，owner 线程，seam 化。
  - 证据：be5b3d6e；darwin seam 单测三路径（26/26 darwin 的一部分，含 I2 修复后 +1 语料测试）。
- [x] 3.2 win32：ShellExecuteW("open", …) 投影；/select 引号包裹无空隙；scheme 大小写不敏感。
  - 证据：spy 断言参数形态（引号包裹/无元字符拼接）绿；scheme 大小写矩阵绿；Windows 真机 28/28（I2 修复后复验，0 警告）。
- [x] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture。
  - 证据：exhaustive fixture 绿；x86_64+aarch64 msvc 交叉 0 warning（含 --examples）。

## 4. Implementation — 批次 C（packages/ext-opener facade）

- [x] 4.1 attachOpener → capability；异步冻结 getBackend；contract.json（fingerprint opentray-ext-opener-contract-1）；embedded 描述符。
  - 证据：be5b3d6e；无同步 backend 属性 + 快照冻结断言绿。
- [x] 4.2 facade preflight：解析矩阵（绝对路径存在性非受理前提 / URL `new URL()` 可解析 / 其余 typed 拒）；scheme 白名单门（四 scheme，大小写不敏感，details 含 scheme）；path-quote 拒；Linux typed unsupported（零 broker 帧）。
  - 证据：解析矩阵正/负例断言（dispatch 与零 dispatch 分界）绿；malformed URL 语料（http:/http:///[invalid/空格 host → relative typed 拒 + 零帧；bare mailto:/file:/file:x 放行 verbatim）27/27×2。
- [x] 4.3 vitest 确定性套件（Node + Bun）：全矩阵/白名单大小写/ABI 往返（{type:"backend"}）/embedded/Linux typed 拒。
  - 证据：27/27 Node + Bun（I2 修复后）。

## 5. Packaging — 批次 D

- [x] 5.1 native-build-graph 注册 opener component + 矩阵；files 收口；pack-size 接入。
  - 证据：723c03c6/b8a9b321；真实 tgz stat/digest + 解包逐 target identity 由本 PR 的 pack-size 审计与 native artifact CI 产出（run id 于合并前回填）。

## 6. Verification

- [x] 6.1 darwin 真机验收（opener_probe，本机 2026-09-18）：open(https) 默认浏览器受理、open(绝对文件) 默认应用受理、reveal Finder 定位（真实桌面动作）、blocked scheme typed（details {scheme:"ftp"}）、relative typed（{reason:"relative"}）、path-quote 拒（{reason:"path-quote"}）、getBackend DTO 由 lib fixture 冻结。Windows：命令面/参数形态/spy 矩阵真机 28/28 绿；GUI 可见动作（浏览器/资源管理器弹出）在 ssh session 0 下不可见，列 Owner 真机清单。
  - 证据：opener_probe 六行输出（3 ok + 3 err 载荷精确）；cargo 26/26 darwin、28/28 Windows。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check + 真实 pack 证据。
  - 待本 PR CI run（含 workspace-verify 门）全绿后回填链接。

## 7. Release

- [x] 7.1 AGENTS.md Host Atom Extension Law 章落档（含 O1 严格白名单裁决、path-quote 拒绝律、resolve-on-acceptance）。
  - 证据：edd516bd。
- [x] 7.2 skills/opentray references/ext-opener.md + README（五要件：安装/完整 API/错误码 details/安全边界/最小示例）。
  - 证据：a5e2b3ef；五要件自检 d5559a37。
- [ ] 7.3 self-review + check ok:true + Codex 复核至 GO（含 O1 落档核验）。
  - 进展：self-review d5559a37；I2 P1 修复 90398aaf 双平台复验（darwin 26/26、Windows 28/28、facade 27/27×2、交叉 0 警告）；I2b 闭合裁决与 I4 综合 GO 进行中。
- [x] 7.4 changeset（minor）。
  - 证据：.changeset/nine-otters-host.md。

## archive-completeness

- [ ] O1 裁决已回写（R2 已核）；specs delta 合入 openspec/specs/opener-extension/；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题。
