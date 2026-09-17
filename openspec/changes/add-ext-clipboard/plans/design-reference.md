# add-ext-clipboard — Design Reference（规范附录，实现以本档为准）

> 共享框架（embedded 打包、V2 Immediate 命令 ABI、`getBackend()` 异步冻结快照
> （`{type:"backend"}` 事件法则）、typed 错误码 details 对象、嵌入身份链、Linux typed
> unsupported）沿用 add-ext-dialog/add-ext-sound 已定稿法则。意图索引见 `plan.md`。

## 0. 定位与边界

能力词 `clipboard` = **OS 剪贴板文本原子**。host 侧读写系统剪贴板。

不做清单（v1）：非文本格式（图像/文件列表/自定义 UTI——v2 以 typed 格式清单扩展）、剪贴板变化
监听（EventPort producer，需求证实后再议）、格式转换、Linux 原生。

## 1. 公共 API（facade `@opentray/ext-clipboard`）

```ts
export const attachClipboard = (
  tray: TrayHandle,
  options?: ClipboardExtensionOptions
): ClipboardCapability => { /* tray.extend 家族同构 */ }

export interface ClipboardCapability {
  readText(): Promise<string | null>;   // 空剪贴板/无文本 = null，不是错误
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
  getBackend(): Promise<ClipboardBackendCapabilities>;
}
```

v1 仅 UTF-8 文本。`writeText('')` 合法（写入空文本，等价语义上清空但保留所有权语义差异——
darwin clearContents 与 setString("") 是两个操作；不合并）。

**编码与边界契约（冻结）**：
- 计量单位：**JS/TS 字符串的 UTF-16 码元数**（与 `String.length` 一致；win32 CF_UNICODETEXT
  同单位）。容量上限冻结 **1 MiB = 1,048,576 UTF-16 码元**（writeText preflight 强制，超限 →
  typed `clipboard_payload_too_large`，details: lengthUtf16, limit）；readText 返回值无上限
  （读入信任本机剪贴板内容，深拷贝即返）。
- 孤立代理对（lone surrogate）：输入含孤立高低代理（如 `"\uD83D"`）时，writeText 按
  WTF-8/替换策略拒绝——**冻结：typed `clipboard_payload_invalid`**（details: reason:"lone-surrogate",
  index），不做替换静默写入（替换会破坏读回往返一致性）。readText 遇到原生侧未终止 UTF-16
  （理论上不可能——CF_UNICODETEXT 契约要求零终止；防御性截断至终止位并按实际字节返回，不报错）。
- **NULL 语义区分（win32 冻结）**：`GetClipboardData(CF_UNICODETEXT) == NULL` 且
  `GetLastError() == ERROR_SUCCESS/无ClipboardOwner 数据` → 剪贴板无文本 → 返回 **null**；
  NULL 且 `GetLastError()` 为其他错误（如 ERROR_INVALID_HANDLE）→ typed
  `clipboard_unavailable`（details 含 OS 错误码）。darwin：`string(forType:)` 返回 nil → null
  （无歧义路径）。

## 2. 平台投影

| 维度 | darwin | win32 |
|---|---|---|
| 写 | NSPasteboard.generalPasteboard().clearContents() + setString(forType:.string)，owner 线程 | OpenClipboard(NULL) + EmptyClipboard + SetClipboardData(CF_UNICODETEXT)（HGLOBAL 全局内存，UTF-16 零终止）+ CloseClipboard |
| 读 | string(forType:.string)（nil → null） | OpenClipboard + GetClipboardData(CF_UNICODETEXT) → 深拷贝后立即 CloseClipboard |
| 清 | clearContents() | OpenClipboard + EmptyClipboard + CloseClipboard |
| 竞态 | AppKit 串行化 | **经典锁竞态**：OpenClipboard 可能 ACCESS_DENIED（他进程持有）。**冻结纪律（可执行语义）**：以命令派发时刻为起点的 **monotonic deadline（Instant 基准）总预算 2000ms**；仅当 `OpenClipboard` 返回失败且 `GetLastError() == ERROR_ACCESS_DENIED` 时重试（其他错误即刻 typed `clipboard_unavailable`）；退避序列 10ms→20ms→40ms→80ms→160ms→200ms 封顶，其后恒 200ms；**每次 sleep 裁剪至剩余预算**（不超时睡眠）；预算耗尽或下次重试已无可执行空间 → typed `clipboard_locked`（details: attempts（含首次尝试）、elapsedMs（含原生调用耗时，截止 typed 错误构建时刻）） |

**所有权/延迟渲染不做**（v1）：不注册延迟供给回调；写入即交付字节。

## 3. 打包与错误码

embedded（同族）；`contract.json` =
`{"extensionName":"clipboard","contractFingerprint":"opentray-ext-clipboard-contract-1"}`。

**DTO（冻结 schema；@opentray/spec 与 opentray-spec 双侧同构 + exhaustive fixture）**：

```ts
export interface ClipboardBackendCapabilities {
  platform: 'darwin' | 'win32';
  textOnly: true;                    // v1 固定 true（格式清单 v2 扩展位）
  maxWriteUtf16: 1_048_576;          // 平台无关契约常量
  boundedOpenRetry: boolean;         // win32=true（锁竞态重试律）；darwin=false（AppKit 串行化）
}
```

typed 错误码：`clipboard_platform_unsupported` / `clipboard_locked`（details: attempts,
elapsedMs）/ `clipboard_unavailable`（原生 API 失败，details 含 OS 错误码）/
`clipboard_payload_too_large`（details: lengthUtf16, limit）/
`clipboard_payload_invalid`（details: reason, index）。
注意：`readText` 无文本返回 **null 非 typed 错误**（空态一等公民，与 picker cancel=null 同律）。

## 4. 线程与依赖

- darwin：NSPasteboard 经 owner 线程（MainThreadOnly 家族纪律）。
- win32：剪贴板 API 允许任意线程，但按「扩展命令在 GUI owner 线程派发」总律执行；
  Open→操作→Close 在单命令内闭合，绝不跨命令持有剪贴板句柄。
- 无新增系统依赖（user32 现有；AppKit 现有）。

## 5. 测试策略

- TS（vitest Node+Bun）：ABI 形状夹具、错误码 details、描述符、Linux typed 拒+零帧。
- 原生：win32 重试纪律 spy 测试（注入 OpenClipboard 失败序列：先拒后成/恒拒 → 退避轨迹与
  typed 终态断言）；HGLOBAL 编解码边界（空串/emoji/代理对/超长 1MiB）单测；darwin seam 化
  pasteboard。
- 真机（双平台）：read/write/clear 往返（进程外系统剪贴板可观察——macOS `pbpaste`/win32
  PowerShell Get-Clipboard 交叉取证）、锁竞态真机复现（并发写压测）、null 空态。
- 真实 pack 证据：泛化管线自动覆盖。
