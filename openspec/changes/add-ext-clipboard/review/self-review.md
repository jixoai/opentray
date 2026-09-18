# add-ext-clipboard — Self-Review（实现阶段 + 复核轮收口）

> 评审人：编排者。对象：实现（facade + shared schema + 原生 crate + 打包）+ Codex 复核轮。
> 性质：**实现自评 + 复核轮记录**——7.3 的 Codex GO 以 I4 综合裁决为准，本档不代勾。

## 总判定

实现落地：`@opentray/spec` 冻结 schema（`ClipboardBackendCapabilities` DTO、
`CLIPBOARD_MAX_WRITE_UTF16 = 1_048_576`、三码错误族）、facade
`packages/ext-clipboard/src/index.ts`（preflight 门、immediate 派发、
`getBackend()` 冻结快照）、原生 crate `crates/opentray-ext-clipboard`
（win32 HGLOBAL 所有权 + 2000ms/退避梯重试纪律；darwin NSPasteboard owner 线程）、
embedded 打包（四目标 + contract.json）。Codex 实现复核 I1 唯一 P1 已修复；
真机验收抓到并修复一项法则级缺陷（见下）。

## 冻结契约自查（对照 design-reference）

- 计量单位 = UTF-16 码元（`String.length`）；1 MiB 上限、lone-surrogate typed 拒
  （`{reason:"lone-surrogate", index}`）——facade 与原生双侧实现，绝不替换写入。
- `readText` null 空态（非错误非空串）；`writeText('')` 合法；非字符串 → TypeError。
- win32 重试：仅 `ERROR_ACCESS_DENIED`、单调 2000ms 总预算（**锚定命令派发时刻**，
  I1 修订：入口 Instant 在 alloc/encode 前捕获并贯穿 open_bounded）、10→20→40→80→160→200ms
  梯、睡眠裁剪至剩余预算、耗尽 → `clipboard_locked` `{attempts, elapsedMs}`；
  其他错误即拒 `clipboard_unavailable` `{osErrorCode}`。
- HGLOBAL 所有权律：交接成功不 free（系统接管）；失败路径全部回收后才 typed 报错；
  读侧 GlobalLock 深拷贝、Close 后不触碰。
- **空板读 oracle（真机修订 2026-09-18）**：`IsClipboardFormatAvailable(CF_UNICODETEXT)`
  是「无文本」唯一权威；NULL 后 `GetLastError()` 不是契约（真机空板报 1168）。
- Linux typed 拒、零 broker 帧；未知 attach 选项字段 TypeError。

## 复核轮记录（I1）+ 真机法则修正

| 项 | 内容 | 闭环 |
|---|---|---|
| I1 P1（重试预算锚点） | open_bounded 原在 alloc/encode 后取 Instant，预算未从命令派发起算 | 56de08c7：三 flow 入口捕获 started 贯传；darwin 32/32 + Windows 真机 26/26 复验 |
| 真机法则缺陷（探针抓到） | `EmptyClipboard` 后 `GetClipboardData` NULL + `GetLastError()==1168`（ERROR_NOT_FOUND）→ 冻结的 ERROR_SUCCESS 映射把一等空态变 `clipboard_unavailable`；clipboard_probe 两轮确定性复现 | 30f3b276：可用性 oracle 修订（design §1 + spec delta 同步改写）；修复后真机 clear→read `"text":null`；darwin pbpaste 跨进程观察 marker 与清空；Windows 跨进程（进程 A 写 marker → 进程 B read 模式读回） |

## 真机验收证据（6.1）

darwin 本机 + Windows honor 真机（clipboard_probe，ffd256c9 扩展 read 模式）：
emoji（代理对）往返逐字节保持；空串写读回 `""` 与 clear 后 `null` 语义分立；
跨进程可观察（pbpaste / 第二进程读）；getBackend DTO 双平台构造器 fixture 冻结；
Windows 单测 26/26（0 警告）。注：ssh 会话 PowerShell Get-Clipboard 读取在
session 0 下不可靠，跨进程以探针第二进程读为准（诚实声明）。

## 已知边界（诚实声明）

1. 并发锁竞态真机压测未做——竞态族由 spy 确定性单测覆盖（sound 先例同构处理）。
2. 6.2 全量门 CI run 链接于 PR 后回填；7.3 GO 以 I4 综合裁决为准。

## Git 证据

- 实现波：ae96bf58（crate）+ c467b68b（facade）+ b8a9b321（打包注册）+ bdfd2c07（spec）。
- 复核修复：56de08c7（I1 P1）+ 30f3b276（空板读法则）+ ffd256c9（真机探针）。
