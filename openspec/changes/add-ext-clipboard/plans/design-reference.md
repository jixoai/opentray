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

## 2. 平台投影

| 维度 | darwin | win32 |
|---|---|---|
| 写 | NSPasteboard.generalPasteboard().clearContents() + setString(forType:.string)，owner 线程 | OpenClipboard(NULL) + EmptyClipboard + SetClipboardData(CF_UNICODETEXT)（HGLOBAL 全局内存，UTF-16 零终止）+ CloseClipboard |
| 读 | string(forType:.string)（nil → null） | OpenClipboard + GetClipboardData(CF_UNICODETEXT) → 深拷贝后立即 CloseClipboard |
| 清 | clearContents() | OpenClipboard + EmptyClipboard + CloseClipboard |
| 竞态 | AppKit 串行化 | **经典锁竞态**：OpenClipboard 可能 ACCESS_DENIED（他进程持有）。**冻结纪律**：有界重试——总预算 ≤2s，退避 10ms→20ms→…→200ms 封顶；预算耗尽 → typed `clipboard_locked`（details 含 attempts/elapsedMs） |

**所有权/延迟渲染不做**（v1）：不注册延迟供给回调；写入即交付字节。

## 3. 打包与错误码

embedded（同族）；`contract.json` =
`{"extensionName":"clipboard","contractFingerprint":"opentray-ext-clipboard-contract-1"}`。

typed 错误码：`clipboard_platform_unsupported` / `clipboard_locked`（details: attempts,
elapsedMs）/ `clipboard_unavailable`（原生 API 失败，details 含 OS 错误码）。
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
