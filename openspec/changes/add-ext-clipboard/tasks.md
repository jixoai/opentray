# add-ext-clipboard — Tasks（implementation complete; release evidence in flight）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported）复用 `add-ext-dialog`/`add-ext-sound` 归档成果——直接复用，无依赖门。
> 评审记录：design R2 GO 9.2（cf6fcafe）；实现复核 I1 P1（重试预算锚点）已修
> 56de08c7；真机复核抓到并修复空板读法则缺陷（IsClipboardFormatAvailable oracle，
> 30f3b276，design/spec 已修订落档）。

## 1. Alignment

- [x] 1.1 plan 索引与 design-reference 一致；validate 通过。
  - 证据：cc6ec121 同步冻结 SSOT；R2 GO 9.2；`openspec:vision validate add-ext-clipboard` valid（2026-09-18 复验）。

## 2. BDD Contract

- [x] 2.1 `@opentray/spec`：ClipboardCapability 面、ClipboardBackendCapabilities、typed 错误码三枚 details 判别联合；单测。
  - 证据：bdfd2c07（CLIPBOARD_MAX_WRITE_UTF16=1,048,576 等常量/DTO/guards）；spec 套件 156/156 既有绿。

## 3. Implementation — 批次 B（crates/opentray-ext-clipboard）

- [x] 3.1 darwin：NSPasteboard 写/读/清三路径，owner 线程纪律，seam 化。
  - 证据：ae96bf58；seam 单测覆盖三路径（32/32 darwin 的一部分）。
- [x] 3.2 win32：单命令句柄闭合；写=EmptyClipboard+SetClipboardData(CF_UNICODETEXT)；读=GetClipboardData 深拷贝后即 Close；清=EmptyClipboard；有界重试纪律（预算锚定命令派发，I1 修订 56de08c7；退避梯 10→…→200ms 修至剩余预算）。
  - 证据：spy 注入失败序列（先拒后成/恒拒→退避轨迹+typed 终态）绿；HGLOBAL 边界（空串/emoji/代理对/1MiB）绿；**真机修订**：空板读以 IsClipboardFormatAvailable 为唯一 no-text oracle（30f3b276；真机证据 EmptyClipboard 后 GetClipboardData NULL+GetLastError 1168，clipboard_probe 两轮确定性复现）。
- [x] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture 比对。
  - 证据：exhaustive fixture 单测绿；x86_64+aarch64 msvc 交叉 0 warning（2026-09-18 复验含 --examples/--tests）。

## 4. Implementation — 批次 C（packages/ext-clipboard facade）

- [x] 4.1 attachClipboard → capability；异步冻结 getBackend 快照；contract.json（fingerprint opentray-ext-clipboard-contract-1）；embedded 描述符。
  - 证据：c467b68b；无同步 backend 属性断言 + 快照冻结断言绿。
- [x] 4.2 facade preflight：Linux typed unsupported（零 broker 帧）；非 string 入参 TypeError。
  - 证据：Linux 拒绝路径零 dispatch 断言绿（20/20×2）。
- [x] 4.3 vitest 确定性套件（Node + Bun）：ABI 往返夹具（{type:"backend"}）/错误码 details/embedded 描述符/Linux typed 拒+零帧。
  - 证据：20/20 Node + Bun。

## 5. Packaging — 批次 D

- [x] 5.1 native-build-graph 注册 clipboard component + 四目标矩阵；package.json files 收口；pack-size 接入。
  - 证据：b8a9b321（34-job 矩阵、5 embedded 包）；真实 tgz stat/digest + 解包逐 target identity 由本 PR 的 workspace pack-size 审计与 native artifact CI 产出（run id 于合并前回填）。

## 6. Verification

- [x] 6.1 双平台真机验收：read/write/clear 往返（进程外可观察）；null 空态；writeText('') 与 clear() 语义分立；getBackend DTO 上报。
  - 证据：darwin 本机 clipboard_probe（ffd256c9）——emoji（代理对）往返、空串写读回 ""、清后读回 null、进程外 `pbpaste` 观察 marker 与清空；Windows 真机 honor（26/26 + probe 全矩阵 + 跨进程：进程 A 写 marker → 进程 B `read` 模式读回）。锁竞态族由 spy 确定性单测覆盖（sound 先例同构）。**真机抓到并修复法则级缺陷**：空板 GetClipboardData NULL+1168 误判 unavailable → oracle 修复后 clear→read 一等 null（30f3b276）。注：ssh 会话 PowerShell Get-Clipboard 读取不可靠（session 0），跨进程以探针第二进程读为准。
- [x] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；真实 pack 证据。
  - 证据：GitHub Actions run 35303325775（PR #9，commit 487b3ea1）全绿——workspace-verify（spec 门+脚本套件+cargo 全仓+typecheck+全包测试）+ 34-job 原生矩阵（8 组件 ×4 目标，三新扩展 12 job 含 manifest/identity 检查）+ stage/pack；pack-size 与解包 identity 证据由同 run 的 stage-and-pack 产出。

## 7. Release

- [x] 7.1 AGENTS.md Host Atom Extension Law 章落档（含空板读 oracle 修订语义）。
  - 证据：edd516bd。
- [x] 7.2 skills/opentray 公共消费文档 references/ext-clipboard.md + README（安装/完整 API 面/错误码 details/平台边界/最小示例五要件齐备）。
  - 证据：a5e2b3ef；五要件对照自检 d5559a37。
- [x] 7.3 self-review + check ok:true + Codex 复核至 GO。
  - 证据：self-review 终稿（复核轮记录 + 真机法则修正）；vision check ok:true；I1 P1 闭合（56de08c7）；I4 终裁实现分 **9.4**（R2 9.2），release GO 无阻塞。
- [x] 7.4 changeset（minor）。
  - 证据：.changeset/nine-otters-host.md（三原子合并 minor，fixed family → 0.30.0）。

## archive-completeness

- [ ] specs delta 合入 openspec/specs/clipboard-extension/；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题。
