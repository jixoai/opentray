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

**scheme 白名单（Codex R1 已裁：严格白名单，冻结）**：v1 允许 `http/https/file/mailto`
（scheme 匹配大小写不敏感）；其余 scheme（`ssh:`/`chrome://`/自定义处理器）→ typed
`opener_scheme_blocked`（details 含 scheme）。理由：host 侧 API 输入可能来自外部数据；自定义
scheme 处理器注册表有持久化驻留与意外副作用面；严格列表最小惊讶。**放宽方向是未来的兼容性
增量，收紧会破坏既有调用**——v1 从严。

**路径/URL 解析边界（冻结）**：
- 绝对路径判定：POSIX 以 `/` 起；win32 `C:\x` 形态（`[A-Za-z]:[\\/]`）为绝对；
  **`C:x`（无分隔符）为 drive-relative 相对路径 → typed `opener_target_invalid`
  （reason:"drive-relative"）**；`\\\\server\\share\\…` UNC 为合法绝对路径；
  `\\?\\` 前缀按字面传原生（不做规范化——规范化是调用方职责，本层拒绝语义歧义输入）。
- `file:` URL：**原样传原生**（darwin `NSWorkspace.open(url)`；win32 `ShellExecuteW` 同受
  理该 scheme）——**不做 URL→路径规范化**（规范化引入解码/编码歧义面；需要路径语义的调用方
  应直接传绝对路径）。
- 相对路径/无协议字符串 → typed `opener_target_invalid`（details: reason）。

**`revealInFolder(path)`**：路径必须为绝对路径（相对/drive-relative → typed
`opener_target_invalid`）。win32 经 `ShellExecuteW("open", "explorer.exe", "/select,<path>")`
单参数传参，**安全契约（冻结的拒绝集合——拒绝而非转义，转义矩阵是持续攻击面）**：路径含
`"` 引号、NUL、或任一 C0 控制字符（0x00–0x1F）→ typed `opener_target_invalid`
（reason:"path-control-char" / "path-quote"）；**尾随反斜杠在传参前裁剪一个**（`explorer /select`
对尾反斜杠有历史解析缺陷；裁剪不改变定位语义）；UNC 路径合法（explorer 原生支持）。
darwin `NSWorkspace.activateFileViewerSelecting([url])`（无参数注入面）。
**win32 `open` 受理语义（冻结）**：`ShellExecuteW` 返回值 **> 32** = 受理成功（resolve）；
**≤ 32** = 失败 → typed `opener_failed`（details: {shellExecuteResult: <int>}，并按系统
SE_ERR_* 表补充 reason 字符串如 "noassoc"/"filenotfound"/"accessdenied"）。

## 3. 打包与错误码

embedded（同族）；`contract.json` =
`{"extensionName":"opener","contractFingerprint":"opentray-ext-opener-contract-1"}`。

**DTO（冻结 schema；@opentray/spec 与 opentray-spec 双侧同构 + exhaustive fixture）**：

```ts
export interface OpenerBackendCapabilities {
  platform: 'darwin' | 'win32';
  allowedSchemes: readonly ['http', 'https', 'file', 'mailto'];  // v1 冻结白名单（小写 canonical）
  supportsRevealInFolder: true;    // v1 双平台均真
}
```

typed 错误码：`opener_platform_unsupported` / `opener_target_invalid`（details: reason，含
"relative"/"drive-relative"/"path-quote"/"path-control-char"）/ `opener_scheme_blocked`
（details: scheme）/ `opener_failed`（details: {shellExecuteResult?, osError?}——darwin 为
osError 布尔受理语义，win32 为 SE 结果码映射）。

## 4. 线程与依赖

- darwin：NSWorkspace 经 owner 线程。
- win32：ShellExecuteW 在 owner 线程。**COM 前提（冻结契约，非实测注记）**：owner 线程在
  broker 启动时已完成其 apartment 初始化（winit/事件泵既有的进程级初始化纪律）；扩展命令路径
  **不做任何 CoInitialize/CoUninitialize 补偿**（ShellExecuteW 的默认动词路径不要求调用方
  显式 apartment；若平台实测发现例外，属实现期 P0 回写本节而非现场补偿）。CI 矩阵：宿主
  cargo test 覆盖参数构造层；真机断言受理语义。
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
