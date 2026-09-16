# add-ext-dialog — Design Reference（规范附录，实现以本档为准）

> 意图索引见 `plan.md`（D1–D6）。本档承载：API 形态、平台命名空间矩阵、降级矩阵、
> 平台独有能力清单（v1 / roadmap / 永久拒绝）、原生模态架构、embedded 打包与体积门、
> capabilities DTO、测试策略、法条草案。

## 0. 定位与边界

能力词 `dialog` = **OS 标准模态交互面**：消息框 + 文件选择器。目标市场是
「无页面上下文」的 host 侧调用（tray 菜单动作、后台 CLI、webview 不可见时）。
声音（beep/系统音/文件播放）是独立能力词，由同波开发的 `@opentray/ext-sound`
承担（change：`add-ext-sound`；Owner ruling 2026-09-17）。

不做清单（全部永久或 v1 裁决，理由见 plan.md 拒绝路径）：

- prompt（文本输入态）
- page bridge（页面 JS 不可见本能力）
- 对话框内容超链接、自定义 accessory view / 自绘 UI
- Linux 原生实现（typed `dialog_platform_unsupported`）
- EventPort（完成即命令响应）

家族 roadmap（非本 change）：`ext-opener`（P1）、`ext-notification`（P1，Windows AUMID
法则须先裁决）、`ext-clipboard`（P2，watch 是 EventPort producer）、`ext-capture`（P3，
独立 change：OS 原生源选择器 + 输出形态 + TCC 权限法则）、`ext-color`（P3，需求触发）。

## 1. 公共 API（facade `@opentray/ext-dialog`）

```ts
export const attachDialog = (
  tray: TrayHandle,
  options?: DialogExtensionOptions
): DialogCapability => { /* tray.extend 家族，session-scoped，同构 attachBadge/attachWebview */ }

export interface DialogCapability {
  alert(message: string, options?: MessageDialogOptions): Promise<void>;
  confirm(message: string, options?: MessageDialogOptions): Promise<boolean>;
  messageDialog(options: MessageDialogOptions): Promise<MessageDialogResult>;
  pickFile(options?: FilePickOptions): Promise<string | null>;
  pickFile(options: FilePickOptions & { multiple: true }): Promise<readonly string[] | null>;
  pickDirectory(options?: DirectoryPickOptions): Promise<string | null>;
  pickSavePath(options?: SavePickOptions): Promise<string | null>;
  readonly backend: DialogBackendCapabilities;
}
```

### 1.1 通用选项（跨平台语义，两平台均能诚实投影）

| 族 | 字段 | 类型/默认 | 语义 |
|---|------|-----------|------|
| message | `message` | `string`（必填） | 主文案 |
| message | `detail` | `string?` | 次文案（macOS detail 文本 / win32 content 附加行） |
| message | `buttons` | `readonly string[]`（messageDialog 默认 `["OK"]`） | 按钮标签数组，按索引返回 |
| message | `defaultId` | `number?`（默认 0） | 回车/默认聚焦按钮 |
| message | `cancelId` | `number?` | ESC/关闭的映射目标 |
| message | `severity` | `'info'\|'warning'\|'error'`（默认 `info`） | 图标/声音分级 |
| message | `suppressionLabel` | `string?` | 出现即显示「不再询问」复选框 |
| pick | `filters` | `readonly { name: string; extensions: readonly string[] }[]?` | 空/缺省 = 全部文件 |
| pick | `defaultPath` | `string?` | 起始目录或含文件名的起始位置（save） |
| pick | `title` / `fileNameLabel` | `string?` | 面板标题 / 文件名输入框标签 |
| pick | `showsHidden` | `boolean`（默认 false） | 显示隐藏文件 |
| pick | `multiple`（pickFile） | `boolean`（默认 false） | 多选 |
| save | `defaultFilterIndex` | `number?` | 预选过滤器 |
| save | `createDirectories` | `boolean`（默认 true） | 允许在面板内新建目录（见降级矩阵） |

```ts
interface MessageDialogResult { response: number; suppressed: boolean; }
```

### 1.2 语义法则

- 糖语义：`alert` = buttons `["OK"]`；`confirm` = buttons `["OK","Cancel"]`、defaultId 0、
  cancelId 1，返回 `response === 0`。
- **强制关闭法则**：close/ESC/系统 dismissal 一律 resolve 为 `cancelId`；未定义 cancelId 时
  resolve 为 0（第一个按钮）。实现必须保证（macOS 为 cancel 按钮设 escape keyEquivalent；
  win32 TDF_ALLOW_CANCELLATION 缺省随 cancelId 存在）。
- `suppressionLabel` 缺省 → 结果 `suppressed: false`；复选框状态只上报不持久化——持久化是
  应用自己的状态（OpenTray 不替应用做决定）。
- picker 取消 → `null`（不是空数组、不是 reject）；确认 → **绝对路径**（`~` 展开、URL 规范
  化）；save 结果不保证存在。multiple 确认至少一项。
- filters：extensions 仅扩展名（不含点，大小写不敏感）；macOS 映射
  `UTType(filenameExtension:)`（含动态回退），win32 映射 `COMDLG_FILTERSPEC`。

## 2. 平台命名空间（`options.darwin` / `options.win32`）

结构化对象、逐字段类型化。**校验法则**：出现非当前平台的命名空间 → typed
`dialog_platform_namespace_mismatch`（载荷含命名空间名与当前平台），绝不静默忽略；任何
未知字段 → typed `dialog_invalid_options`。校验在 facade 侧完成，broker 前置拒绝。

### 2.1 `options.darwin`

| 能力 | 字段 | 默认 | 投影 |
|---|------|------|------|
| pickFile | `canSelectPackages` | false | NSOpenPanel.canSelectPackages（.app 等包作为文件可选） |
| pickFile | `treatsFilePackagesAsDirectories` | false | 包可作为目录浏览进入 |
| pickFile | `resolvesAliases` | true | 别名解析为原目标 |
| pickFile | `includeDirectories` | false | canChooseFiles+canChooseDirectories 同时成立（**混选**，结果可混合文件与目录） |
| pickFile / pickSavePath | `panelMessage` | — | 面板内说明文字（NSSavePanel.message） |
| pickSavePath | `allowsOtherFileTypes` | false | 允许保留非过滤器扩展名 |

messageDialog 的 darwin 命名空间 v1 为空（suppression 已是通用能力；sheet 锚定与
accessory 见 §4）。**空命名空间保持可表达**（`darwin: {}` 合法），为后续字段留位。

### 2.2 `options.win32`

| 能力 | 字段 | 默认 | 投影 |
|---|------|------|------|
| messageDialog | `buttonStyle` | `'standard'` | `'commandLink'` = TaskDialog 命令链接按钮 |
| messageDialog | `buttonHints` | — | `(string\|undefined)[]` 按索引对齐的按钮说明，仅 commandLink 下合法 |
| messageDialog | `footer` | — | TaskDialog 页脚文字 |
| messageDialog | `expander` | — | `{ expandedInformation, label?, expandedByDefault? }` 折叠详情 |
| messageDialog | `allowCancelOnClose` | cancelId 存在时 true | 标题栏关闭是否映射 cancelId（TDF_ALLOW_CANCELLATION） |
| pickFile / pickDirectory / pickSavePath | `addToRecent` | true | false → FOS_DONTADDTORECENT（不写最近使用） |
| pickSavePath | `strictFileTypes` | false | FOS_STRICTFILETYPES（扩展名不符阻止确认） |
| pickSavePath | `defaultExtension` | — | SetDefaultExtension（自动补全扩展名） |
| pickFile / pickSavePath | `okButtonLabel` | — | SetOkButtonLabel |

## 3. 降级矩阵（文档化投影降级 = 法则允许的差异，非平台特例）

| 通用选项 | darwin 行为 | win32 行为 |
|---|---|---|
| `createDirectories` | canCreateDirectories 开关生效 | 保存面板「新建文件夹」常在（恒可创建，开关无效但无害） |
| `severity: 'error'` | critical alert 风格 | TD_ERROR_ICON |
| `fileNameLabel` | NSSavePanel.nameFieldLabel（NSOpenPanel 继承同字段） | IFileDialog.SetFileNameLabel |

## 4. 平台独有能力

**v1 结论：无独立方法级平台能力**——平台特有面全部是通用能力的命名空间开关
（§2）。独立方法级能力全部 roadmap 门控，且各自需要新法则先行：

| 能力 | 平台 | 门控原因 |
|---|---|---|
| `previewFile(paths)`（Quick Look 预览面板） | darwin | QLPreviewPanel 需要 panel controller 与窗口锚定法则 → 独立 change |
| sheet 锚定（messageDialog 挂 webview 窗口 window-modal） | darwin | 跨扩展窗口句柄归属法则未立（NSWindow 属 ext-webview） → 独立 change |
| shield 图标（TD_SHIELD_ICON，elevation 语义） | win32 | 牵连提权语义，需求出现再议 |

永久拒绝（非 roadmap）：内容超链接（钓鱼面）、自定义 accessory view / 自绘输入 UI。

## 5. 原生架构（crates/opentray-ext-dialog）

- **线程与派发**：命令派发在 GUI 主线程（winit 串行化，d19 证据）。对话框绝不在派发内
  同步阻塞：
  - **macOS**：`beginModalSession`/`runModalSession` 步进集成进 wint `ControlFlow`
    （每次 wake 步进 modal session，窗口/tray 事件继续派发）。**禁止** `NSAlert.runModal`/
    `NSApp.runModal` 裸调用。
  - **win32**：TaskDialogIndirect / `IFileDialog::Show` 于 STA 主线程——其模态泵持续派发
    窗口消息，tray WndProc 存活；winit 外循环暂停但 Shell_NotifyIcon 消息路径不断。
- **pending response**：show 命令注册 `(session, dialogToken)` 挂起响应；对话框关闭时
  由 GUI 线程回帧；不占用传输线程；响应即完成（无 EventPort）。
- **并发法则**：每 `(appId, trayId, sessionId)` 同时至多一个活动对话框；同 session 第二个
  show → typed `dialog_session_busy`（broker 前置拒绝）。跨 session 并发合法（会话隔离
  法则；macOS 多 modal session 共存、win32 嵌套模态泵均可表达）。
- **session close 撤销**：扩展 cleanup 撤销该 session 未决对话框（endModalSession / 关闭
  对话框 HWND），挂起 Promise 以 **cancel 语义 resolve**（messageDialog → cancelId 分支、
  picker → null）——与用户取消不可区分是正确语义。
- macOS 依赖 Darwin carrier/AppKit（ext-badge 同族）；无 TCC 权限需求（非沙盒 broker 的
  标准面板）；win32 无额外运行时依赖（TaskDialog = comctl32 v6，IFileDialog = shell32）。

## 6. 打包与体积门（Owner ruling 2026-09-16 立法，本 change 首例适用）

### 6.1 SDK 协议增量：`kind: "embedded"` artifact

```ts
export interface NativeExtensionEmbeddedTarget { libraryPath: string; } // 相对 facade 包根
export interface NativeExtensionEmbeddedArtifact extends NativeExtensionIdentitySource {
  kind: "embedded";
  targets: Partial<Record<NativeExtensionTarget, NativeExtensionEmbeddedTarget>>;
}
```

解析规则（并入 `resolveNativeExtensionArtifact`）：

- `libraryPath` 相对 `packageJsonUrl` 所在目录 join；
- realpath 可达性校验（复用 `resolveAccessibleLibrary`，错误码同族）；
- `expectedIdentity` 与 package kind 同源（facade version = artifactSetVersion +
  contract.json fingerprint）→ 内嵌形态下 artifact-set 恒随 facade 版本走；
- 缺目标（如 linux-x64）→ 现有 `native extension does not support target` typed 错误，
  facade 捕获后映射 `dialog_platform_unsupported`。

### 6.2 包布局与契约

```text
packages/ext-dialog/
  contract.json            # { "extensionName": "dialog", "contractFingerprint": "opentray-ext-dialog-contract-1" }
  platforms/darwin-arm64/libopentray_ext_dialog.dylib
  platforms/darwin-x64/libopentray_ext_dialog.dylib
  platforms/win32-arm64/opentray_ext_dialog.dll
  platforms/win32-x64/opentray_ext_dialog.dll
```

无 optionalDependencies 平台包。crates/opentray-ext-dialog 为唯一原生源。
**共享基建**：本 change 批次 A 交付的 `kind: "embedded"` 解析与 pack-size 审计是通用基建，
`add-ext-sound`（同波）与后续任何内嵌多平台二进制的包直接复用，不重复建设。

### 6.3 体积门（workspace `scripts/check-pack-size.mjs`）

- 对内嵌平台二进制的包执行 `npm pack --dry-run`，取 **tarball 压缩体积**；
- `≥ 2MB` → 警告（CI warning + 发布前必须 Owner 决策记录）；
- `> 3MB` → CI fail（必须拆分为 `@opentray/<name>-<os>-<arch>` 平台包，不再询问）；
- 已发布平台包形态的既有包（ext-badge/ext-webview/ext-lynx）不受追溯；
- 预期基线：薄封装 dylib/dll（AppKit/comctl32/shell32 均系统动态链接不进产物），压缩合计
  远低于 2MB；实测数字归档进验证证据作为首例锚点。

## 7. `DialogBackendCapabilities` DTO

```ts
export interface DialogBackendCapabilities {
  platform: 'darwin' | 'win32';
  taskDialog: boolean;                    // win32 comctl6 可用；MessageBox 降级时 false
  commandLinks: boolean;                  // taskDialog（win32 专属开关的后盾）
  expander: boolean;                      // 同上
  suppression: boolean;                   // 双平台 true
  packageSemantics: boolean;              // darwin
  mixedFileDirectorySelection: boolean;   // darwin
  addToRecentControl: boolean;            // win32
}
```

法则：新增通用能力必须被**每个平台**的 DTO 与原生构造器序列化（WebView
WindowCapabilities 编译门同款——darwin target 编译通过即证明 win32 侧 DTO 齐全）。
facade 以 `dialog.backend` 暴露只读快照；命名空间开关的可用性判断以 DTO 为运行时事实源
（例：comctl6 缺失时传 `buttonStyle: 'commandLink'` → typed
`dialog_capability_unavailable`，不静默降级为标准按钮）。

## 8. 测试策略

- **TS 确定性**（vitest）：命名空间校验（mismatch/未知字段/commandLink 前置）、糖语义
  （alert/confirm 按钮集与返回）、cancel/强制关闭法则、picker null/绝对路径、embedded
  artifact 解析（多目标/缺目标/不可达 typed 错误/artifactSet 随 facade 版本）、pack-size
  脚本本身（fixture 包 warn/fail 两臂）。
- **原生验收（双平台真机）**：每方法冒烟；**对话框打开期间 tray 存活证据**（同 app 双
  tray 菜单事件 + 跨 app 隔离事件照常派发）；session close 撤销；`dialog_session_busy`；
  跨 session 并发；suppression 状态回传；commandLink/expander 真机截证。
- **交叉编译门**：darwin target 编译通过 = win32 DTO/能力序列化齐全。
- **体积证据**：`npm pack --dry-run` 输出归档进验证记录。

## 9. 法条草案（收尾落 AGENTS.md）

1. Monorepo Law += 包体积门（§6.3 全文，标注 Owner ruling 2026-09-16、首例 ext-dialog）。
2. 新章 **Dialog Extension Law**（从本档提炼）：模态不阻塞 tray 事件（macOS modal-session
   步进 / win32 STA 模态泵）；每 session 一对话框（busy typed）；session close 以 cancel
   语义 resolve 未决对话框；完成走 pending command response（无 EventPort）；平台命名空间
   严格 typed 校验；prompt 不做、Linux typed unsupported、无 page 桥。
