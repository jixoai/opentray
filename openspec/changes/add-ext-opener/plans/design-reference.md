# add-ext-opener — Design Reference（规范附录，实现以本档为准）

> 共享框架（embedded 打包、V2 Immediate 命令 ABI、`getBackend()` 异步冻结快照
> （`{type:"backend"}` 事件法则）、typed 错误码 details 对象、嵌入身份链、Linux typed
> unsupported）沿用 add-ext-dialog/add-ext-sound 已定稿法则。意图索引见 `plan.md`。

## 0. 定位与边界

能力词 `opener` = **默认应用打开原子**：URL / 文件以用户默认应用打开，或在文件管理器中定位。

不做清单（v1）：应用选择器（OpenWithDialog）、默认应用查询/设置、拖放、深链返回值、
Linux 原生。

## 1. 公共 API（facade `@opentray/ext-opener`）

```ts
export const attachOpener = (
  tray: TrayHandle,
  options?: OpenerExtensionOptions
): OpenerCapability => { /* tray.extend 家族同构 */ }

export interface OpenerCapability {
  open(target: string): Promise<void>;          // URL 或绝对文件路径
  revealInFolder(path: string): Promise<void>;  // 文件管理器中定位（非打开）
  getBackend(): Promise<OpenerBackendCapabilities>;
}
```

`resolve-on-acceptance`（同族）：原生调用受理成功即 resolve；目标应用何时/是否呈现不属于受理。

## 2. 目标解析（preflight 法则，冻结）

`open(target)`：
1. 绝对文件路径（存在性不作为受理前提——打开一个稍后出现的路径不是本层的错误语义；
   但 **不可读/不可 stat 的路径参数仍透传原生**，原生拒绝 → typed `opener_failed`）
   → darwin `NSWorkspace.open(URL(fileURLWithPath:))`；win32 `ShellExecuteW("open", path)`。
2. URL（`new URL()` 可解析且有协议）→ darwin `NSWorkspace.open(url)`；
   win32 `ShellExecuteW("open", url)`。
3. 其余（相对路径、无协议字符串）→ typed `opener_target_invalid`（details: {reason}）。

**scheme 白名单（安全裁决，交 Codex 对抗）**：v1 冻结允许 `http/https/file/mailto`；其余 scheme
（`ssh:`/`chrome://`/自定义处理器）→ typed `opener_scheme_blocked`（details 含 scheme）。
理由：host 侧 API 无页面同源约束，自定义 scheme 处理器注册表可被滥用为持久化驻留向量；
白名单是最小惊讶面。若 Codex 裁定过严，放宽为「拒绝可执行类 scheme（file 除外）+ 透传其余」。

`revealInFolder(path)`：路径必须为绝对路径（相对 → typed `opener_target_invalid`）；
darwin `NSWorkspace.activateFileViewerSelecting([url])`；win32 `explorer.exe /select,<path>`
（经 `ShellExecuteW("open", "explorer", params)`，参数经完整路径传参不拼接 shell 元字符）。

## 3. 打包与错误码

embedded（同族）；`contract.json` =
`{"extensionName":"opener","contractFingerprint":"opentray-ext-opener-contract-1"}`。

typed 错误码：`opener_platform_unsupported` / `opener_target_invalid` /
`opener_scheme_blocked` / `opener_failed`（原生拒绝，details 含 OS 错误串/码）。

## 4. 线程与依赖

- darwin：NSWorkspace 经 owner 线程。
- win32：ShellExecuteW 在 owner 线程（COM 已由 broker 初始化路径依赖最小化——
  ShellExecuteW 不要求显式 CoInitialize 的调用方补偿，但若实测要求则跟随现有 STA 初始化纪律）。
- explorer /select 的参数注入面：路径以引号包裹单参数传递，`/select,` 前缀与路径间无
  用户可控空隙；路径含引号字符时 typed `opener_target_invalid`（reason: path-quote）——
  冻结：拒绝而非转义（转义矩阵是持续性攻击面）。

## 5. 测试策略

- TS（vitest Node+Bun）：解析矩阵（绝对路径/URL×协议/相对路径/无协议串）、scheme 白名单
  矩阵（含大小写 `HTTPS://`——scheme 大小写不敏感）、reveal 相对路径拒、错误码 details、
  ABI 形状夹具、描述符、Linux typed 拒。
- 原生：win32 spy 断言 ShellExecuteW 参数形态（引号包裹/无元字符拼接）；darwin seam。
- 真机（双平台）：open(https URL) 默认浏览器受理、open(绝对文件) 默认应用受理、
  revealInFolder 文件管理器定位（人工/截图取证）、blocked scheme typed 断言。
- 真实 pack 证据：泛化管线自动覆盖。
