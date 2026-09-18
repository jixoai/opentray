# add-ext-clipboard — Intent Document (SSOT)

> 原始需求（Owner，2026-09-18）：
> 1. 「继续持续迭代…直到 notification/clipboard/opener 等工作全部完成。」
> 2. 「确保同步更新 skills 文档…其它 AI 能通过文档写出正确的代码。」
>
> 用户语言系统：**「能力原子」「host 侧读写」「其它 AI 能通过文档写出正确的代码」**。
> 关联 change：`add-ext-dialog` / `add-ext-sound`（同族已归档——embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象、Linux typed
> unsupported 等共享基建**直接复用，无依赖门**）；同波 sibling：`add-ext-notification`、
> `add-ext-opener`。
> 评审记录：design draft（`plans/design-reference.md` 为规范附录，实现以它为准）；
> **Codex R1 已完成（确认性流程，2026-09-17/18）**——设计内无开放问题，全部决策预授权冻结；
> R1 终稿补冻结编码契约（UTF-16 计量 / 1 MiB 上限 / 孤立代理对拒绝 / win32 NULL 区分）、
> 可执行重试语义与 HGLOBAL 所有权律（commits 5e46ddb7/93380cdc），均已回写 design-reference。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-clipboard` 一个包即得：`readText()`（空剪贴板/无文本 → `null`，空态一等公民）、`writeText(text)`、`clear()`——v1 仅 UTF-8 文本。
- win32 经典锁竞态（他进程持有剪贴板 → `OpenClipboard` ACCESS_DENIED）由冻结的有界重试纪律覆盖：总预算 ≤2s、退避 10ms→20ms→…→200ms 封顶，耗尽 → typed `clipboard_locked`（details 含 attempts/elapsedMs）。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），无新增系统依赖（user32/AppKit 现有）。
- Linux 调用得到 typed `clipboard_platform_unsupported`，不触碰 broker。
- skills/opentray 公共文档随包同步交付：其它 AI 仅凭文档（安装 / API 面 / 错误码 / 平台降级 / 最小可运行示例）能写出正确的 clipboard 消费代码。

## 调研事实（API 层面，实现批核验补锚点）

- darwin：`NSPasteboard.generalPasteboard()`——写 = `clearContents()` + `setString(forType: .string)`；读 = `string(forType: .string)`（`nil` → null）；清 = `clearContents()`；MainThreadOnly 家族纪律（owner 线程）。
- win32：`OpenClipboard(NULL)` 可能 ACCESS_DENIED（他进程持有——经典锁竞态）；写 = `EmptyClipboard` + `SetClipboardData(CF_UNICODETEXT)`（HGLOBAL 全局内存，UTF-16 零终止）+ `CloseClipboard`；读 = `GetClipboardData(CF_UNICODETEXT)` → 深拷贝后立即 `CloseClipboard`；清 = `EmptyClipboard` + `CloseClipboard`。
- win32 剪贴板 API 允许任意线程，但按「扩展命令在 GUI owner 线程派发」总律执行；user32 现有零新增依赖。
- `writeText('')` 与 `clear()` 在 darwin 是两个操作（`setString("")` vs `clearContents()`）——所有权语义差异，不可合并。

## 决策（D1–D7；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-clipboard`，crate `crates/opentray-ext-clipboard`，embedded 单包内嵌四目标（复用 dialog/sound 归档基建，不重复建设，**无依赖门**）；contract fingerprint `opentray-ext-clipboard-contract-1` | 同族框架已归档落地；体积规范（2026-09-16） |
| D2 | 能力面 = `readText(): Promise<string \| null>` + `writeText(text)` + `clear()` + `getBackend()` 异步冻结快照；v1 仅 UTF-8 文本 | design §1；readText 空态 null 与 picker cancel=null 同律 |
| D3 | `writeText('')` 合法且不与 `clear()` 合并——写入空文本（darwin `setString("")`）与清空（`clearContents()`/`EmptyClipboard`）是两个操作，所有权语义差异保留 | design §1 冻结 |
| D4 | win32 锁竞态冻结纪律（可执行语义）= 命令派发时刻起 monotonic deadline（Instant 基准）总预算 2000ms；仅当 `OpenClipboard` 失败且 `GetLastError()==ERROR_ACCESS_DENIED` 时重试（其他错误即刻 typed `clipboard_unavailable`）；退避 10ms→20ms→40ms→80ms→160ms→200ms 封顶其后恒 200ms；每次 sleep 裁剪至剩余预算（不超时睡眠）；预算耗尽或下次重试已无可执行空间 → typed `clipboard_locked`（details: attempts 含首次尝试、elapsedMs 含原生调用耗时至 typed 错误构建时刻）；`Open→操作→Close` 单命令内闭合，绝不跨命令持有剪贴板句柄 | design §2 竞态行（R1 冻结） |
| D5 | darwin NSPasteboard owner 线程（MainThreadOnly 家族）；无延迟渲染/所有权供给（v1 写入即交付字节）；原生 API 失败 → typed `clipboard_unavailable`（details 含 OS 错误码） | design §2/§3/§4 |
| D6 | 流程：单 change，批次 A（spec 类型）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验收 + 文档 + changeset） | sound 同款编排 |
| D7 | 编码与所有权契约（R1 冻结）= 计量单位 UTF-16 码元（与 `String.length` 一致，win32 CF_UNICODETEXT 同单位）；writeText 容量上限冻结 1 MiB = 1,048,576 码元（preflight 强制，超限 → typed `clipboard_payload_too_large`，details: lengthUtf16, limit），readText 返回值无上限；孤立代理对 → typed `clipboard_payload_invalid`（details: reason:"lone-surrogate", index），不做替换静默写入；win32 NULL 区分（`GetClipboardData==NULL` 且 `ERROR_SUCCESS` → null；其他错误 → typed `clipboard_unavailable`）；HGLOBAL 所有权律（写：`SetClipboardData` 成功后系统接管绝不 `GlobalFree`，失败扩展负责回收含 EmptyClipboard 失败路径；读：板载 HGLOBAL 经 `GlobalLock` 拷贝 + `GlobalUnlock` 后再 Close，绝不 free、Close 后不触碰）；DTO 冻结 schema = platform / textOnly(true) / maxWriteUtf16(1_048_576) / boundedOpenRetry(win32=true) | design §1/§2/§3（R1 冻结） |

## 开放问题（无——设计预授权冻结）

| 问题 | 状态 |
|------|------|
| （无） | 设计无开放问题：全部决策预授权冻结（见决策表与 design-reference）；Codex R1 已完成（确认性流程，非对抗点），无新增对抗点 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 非文本格式（图像/文件列表/自定义 UTI） | v1 文本原子；v2 以 typed 格式清单扩展（design §0 不做清单） |
| 剪贴板变化监听（EventPort producer） | 需求未证实，再议 |
| 格式转换 | 超出文本原子范围 |
| 延迟渲染/所有权供给回调 | v1 写入即交付字节；不注册延迟供给 |
| Linux 原生 | typed `clipboard_platform_unsupported`（与 dialog/sound 同律） |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 剪贴板类型（ClipboardCapability 面、ClipboardBackendCapabilities 冻结 schema、typed 错误码五枚 details 判别联合：`clipboard_platform_unsupported` / `clipboard_locked` / `clipboard_unavailable` / `clipboard_payload_too_large` / `clipboard_payload_invalid`）——embedded artifact kind 与 pack-size 审计**直接复用 dialog/sound 归档基建，无依赖门**。
2. 批次 B：crates/opentray-ext-clipboard——darwin（NSPasteboard 写/读/清，owner 线程，seam 化）+ win32（CF_UNICODETEXT 编解码、HGLOBAL 所有权律、深拷贝即 Close、有界重试纪律）。
3. 批次 C：packages/ext-clipboard facade（attachClipboard、Linux typed 拒零帧、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 接入 + 真实体积实测。
5. 批次 E：双平台真机验证（read/write/clear 往返进程外交叉取证 `pbpaste`/PowerShell Get-Clipboard；锁竞态并发压测；null 空态；`writeText('')` ≠ clear）+ skills 公共文档（一等任务，见 tasks 7.2）+ changeset（minor）。
