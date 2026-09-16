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
- **强制关闭法则**（P0-6 冻结）：close/ESC/系统 dismissal 一律 resolve 为 `cancelId`；未定义
  cancelId 时 resolve 为 0（第一个按钮）。Windows 对所有可关闭对话框**默认启用 cancellation**
  （TDF_ALLOW_CANCELLATION 默认 true，与 cancelId 存在与否无关）；平台无法观察关闭原因时返回
  typed `dialog_dismissal_unavailable`，不伪造成功。
- **输入校验冻结**（P0-6）：`buttons` 必须非空；`defaultId`/`cancelId` 必须是合法索引（越界
  或空按钮 → typed `dialog_invalid_options`，在 facade 前置拒绝，任何状态变更之前失败）。
- `suppressionLabel` 缺省 → 结果 `suppressed: false`；复选框状态只上报不持久化——持久化是
  应用自己的状态（OpenTray 不替应用做决定）。
- picker 取消 → `null`（不是空数组、不是 reject）；确认 → **绝对路径**（`~` 展开、URL 规范
  化、canonicalize）；save 结果不保证存在。multiple 确认至少一项。
- filters：extensions 仅扩展名（不含点，大小写不敏感）；空/缺省 = 全部文件；macOS 映射
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
| messageDialog | `allowCancelOnClose` | **true**（P0-6 冻结：所有可关闭对话框默认启用，与 cancelId 无关） | 标题栏关闭是否映射 cancelId（TDF_ALLOW_CANCELLATION） |
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

## 5. 原生架构（crates/opentray-ext-dialog；R1 P0-1/2/3/5 修订版）

### 5.1 完成协议：通用 deferred command envelope（@opentray/spec + broker + Node 三层）

现有 `ExtCommand`/`ExtCommandResult` 是一请求一响应，无晚到响应承载。本 change 增加通用
deferred 帧（对一切扩展可用，不私有于 dialog）：

```text
ExtCommandAccepted  { requestId, operationId }          # 命令已受理，对话框已呈现
ExtCommandCompleted { operationId, result }             # 对话框关闭，终值回传
ExtCommandCancelled { operationId, reason }             # 撤销（session close / 连接关闭）
```

- **状态机**：Node `PendingRequest` 扩展为 `pending-until-final`——收到 `Accepted` 不结算
  Promise，仅在 `Completed`/`Cancelled` 上结算；同一 operationId 二次终帧必须被丢弃
  （exactly-once CAS）。
- **barrier 顺序**：session close 先撤销（`Cancelled`）再执行扩展 cleanup；deferred 终帧
  遵守现有 response-before-event barrier。
- **连接关闭**：传输断开时全部 pending operation 以 typed `dialog_transport_closed` 拒绝。
- **验收门**：一个 deferred 命令在两个后续普通命令之间完成且只结算一次（确定性
  transport 测试，Node 与 Bun 双跑）。
- 不上 EventPort：完成是请求作用域的响应；EventPort 仍只服务无请求上下文的事件（d19 边界）。

### 5.2 macOS：modal-session 步进状态机

```text
Created → Presented → Stepping ⇄ Stepping … → Dismissed | Revoked
```

- **唯一 UI owner**：主线程（AppKit 约束）。show 命令在 owner loop 派发内只做
  `NSAlert/NSPanel 构造 + beginModalSession + EventLoopProxy 唤醒注册`，**立即返回
  Accepted**，绝不在派发内 `runModal`/`runModal` 裸调用（禁令）。
- **步进驱动**：每次 owner loop wake（`ControlFlow` 回调）步进一次 `runModalSession`；
  AppKit 回调（按钮点击/面板结束）经 `EventLoopProxy<UserEvent::DialogWake>` 唤醒 owner
  loop 推进状态——步进不会因 `Wait` 无 wake 而饿死。
- **一次性 completion CAS**：Dismissed/Revoked 只允许一个胜者；胜者发出 `Completed`
  （用户关闭）或由撤销路径发出 `Cancelled`（session close）。
- **teardown 顺序**：broker 退出/session close → `Revoked`（先 CAS 占位）→
  `endModalSession` + 面板 close → 扩展 cleanup。禁止在未 CAS 时直接操作 panel。
- **真机 probe 前置**：modal step、普通 tray/menu frame、session close、broker exit 的
  交错次序必须先以原生 probe 取证，才允许按普通 crate 任务展开（P0-3 验收要求）。

### 5.3 win32：对话框专属 STA UI 线程

- **拓扑**：对话框（TaskDialogIndirect / IFileOpenDialog::Show / IFileSaveDialog）运行在
  **专用 COM STA 线程**（per-broker 单一 dialog 线程，线程内 CoInitialize + 消息循环）；
  绝不在 winit owner loop 线程内进入任何模态调用——系统模态泵不执行 EventLoopProxy
  user event，会冻结传输事件派发（R1 P0-2 证据）。
- **输入代理**：show 命令参数经 owner loop 序列化投递到 dialog 线程；dialog 线程完成时
  经 `EventLoopProxy` 回传 owner loop，由 owner loop 发出 deferred 终帧。
- **线程约束证明**：tray backend 的 HWND/notify-icon 所属线程不受影响（dialog 线程不触碰
  tray HWND）；`WM_TASKBARCREATED` 等仍由 owner loop 处理。验收含 dialog 打开期间 tray
  菜单交互时间线取证。
- **comctl6**：Common-Controls v6 manifest 绑定 **broker EXE 的 RT_MANIFEST 资源**（不绑
  facade DLL，全进程共享 activation context）；broker 启动后执行一次真实 TaskDialog 能力
  探测并写 DTO；不可用 → MessageBox 兜底 + `commandLink`/`expander` typed
  `dialog_capability_unavailable`（不静默降级）。

### 5.4 busy 与撤销语义

- 每 `(appId, trayId, sessionId)` 同时至多一个活动对话框；同 session 第二个 show →
  typed `dialog_session_busy`（broker 前置原子拒绝）。跨 session 并发合法（会话隔离
  法则；macOS 多 modal session 共存，win32 dialog 线程内嵌套模态或排队均可表达）。
- **session close 撤销**：先 CAS `Revoked` → 撤销原生对话框（macOS endModalSession /
  win32 向 dialog 线程投递 close）→ 发 `ExtCommandCancelled`（cancel 语义：
  messageDialog → cancelId 分支、picker → null）→ 再扩展 cleanup。与用户取消的不可区分
  是正确语义。
- **dismissal 映射**（P0-6 冻结）：标题栏关闭/ESC/系统 dismissal → `cancelId`；未定义
  cancelId → 按钮 0；平台无法观察关闭原因 → typed `dialog_dismissal_unavailable`。

### 5.5 命令作用域注入 sessionId（R1 P0-5，broker 侧）

`ExtensionEnvelope`/`ExtCommand` 传输面增加 host-owned `sessionId`（broker 从连接注入，
扩展不得自报）；`ExtensionInstance::command` 签名、dynamic FFI host context、registry 键
与 native 状态全部升级为含 sessionId。补同 app 多 session、同 tray cleanup、mount
generation 复用的隔离测试。

### 5.6 依赖与权限

macOS 依赖 Darwin carrier/AppKit（ext-badge 同族）；无 TCC 权限需求。win32 新增链接面：
comctl32（TaskDialog）、shell32（IFileDialog）；无 WinRT。typed 错误 envelope 全链路见
§7.5。

## 6. 打包与体积门（Owner ruling 2026-09-16 立法，本 change 首例适用）

### 6.1 SDK 协议增量：`kind: "embedded"` artifact

```ts
export interface NativeExtensionEmbeddedTarget { libraryPath: string; } // 相对 facade 包根
export interface NativeExtensionEmbeddedArtifact extends NativeExtensionIdentitySource {
  kind: "embedded";
  targets: Partial<Record<NativeExtensionTarget, NativeExtensionEmbeddedTarget>>;
}
```

解析规则（并入 `resolveNativeExtensionArtifact`；R1 P0-7 加固）：

- `libraryPath` 相对 `packageJsonUrl` 所在目录 join，但**必须 containment 校验**：
  `fileURLToPath` 后 canonicalize facade root 与 candidate，`relative(root, candidate)`
  拒绝 `..` 起段与绝对路径（`../../outside/library` 不可表达）；symlink 逃逸同样被
  realpath 后的 containment 拒绝；
- 结构化错误四类（typed，替代单一 resolution-failed）：`target-unsupported` /
  `path-outside-facade` / `manifest-invalid` / `library-unreadable`；
- `expectedIdentity` 与 package kind 同源（facade version = artifactSetVersion +
  contract.json fingerprint）→ 内嵌形态下 artifact-set 恒随 facade 版本走；
- 缺目标（如 linux-x64）→ `target-unsupported` typed 错误，facade 捕获后映射
  `dialog_platform_unsupported`；
- adversarial 测试：路径穿越、symlink 逃逸、字节替换、manifest skew 四族。

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
- **实测即证据**（R1 §4.5）：「远低于 2MB」是假设不是基线——首次 release 必须产出每包
  真实 `npm pack` 压缩 tarball 字节数报告（npm/pnpm 版本、四目标清单与 hash 一并记录）
  写入 review/evidence artifact；无实测不给 packaging GO。

### 6.4 构建图收齐矩阵（R1 P0-8）

- `scripts/binaries/native-build-graph.ts` 注册 `dialog` component 与 target capability
  matrix；每目标产出 native inspector/manifest/SHA-256 证据（同 badge 管线）。
- **facade staging 收齐规则**：四目标（darwin-arm64/x64、windows-arm64/x64）全部匹配当前
  facade version 与 contract fingerprint 才写入 `packages/ext-dialog/platforms/<target>/`
  并生成 manifest；缺目标、过期 target、hash 不匹配必须失败。
- 同步改动面：`release-plan.ts`、`verify-native-plan.ts`、`stage-release-artifacts.ts`、
  `.github/workflows/release.yml`、facade `files` 字段及配套测试。
- 验收：clean checkout 执行 release dry-run → `npm pack --dry-run` 解包 → 逐目标调用
  resolver/loader identity check 全绿。

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

法则（R1 P1-3 修正）：DTO schema 提升到共享 `@opentray/spec`（TS）与 opentray-spec crate
（Rust）的公共 schema，配 **exhaustive serialization fixture**（字段新增时 fixture 编译期
穷尽检查，漏一个平台即红）；CI 明确执行 darwin 与 windows **两个 target** 的
compile/type/test——单一 target 编译通过不构成门。
facade 以 `dialog.backend` 暴露只读快照；命名空间开关的可用性判断以 DTO 为运行时事实源
（例：comctl6 缺失时传 `buttonStyle: 'commandLink'` → typed
`dialog_capability_unavailable`，不静默降级为标准按钮）。

### 7.5 typed 错误 envelope（R1 P0-9）

`{ code, message, details }`，`details` 为 discriminated union，在 @opentray/spec 冻结
schema；Rust `ExtensionError::Detailed` 与 server error frame、Node typed error factory
三侧同构。职责分界：**facade preflight**——`dialog_platform_unsupported`（Linux）、
`dialog_platform_namespace_mismatch`、`dialog_invalid_options`（含空 buttons/索引越界）、
路径类；**broker/native**——`dialog_session_busy`、`dialog_capability_unavailable`、
`dialog_dismissal_unavailable`、native not-found 族。所有分支在状态变更前失败；每个 code
有 wire round-trip 与 facade `instanceof`/details 测试；禁止消费方解析人类 message。

## 8. 测试策略（R1 修订）

- **TS 确定性**（vitest，Node 与 Bun 双跑）：deferred envelope 状态机（Accepted 不结算/
  Completed/Cancelled exactly-once/传输关闭 typed rejection/一个 deferred 命令夹在两个普通
  命令之间完成且只结算一次）；命名空间校验（mismatch/未知字段/commandLink 前置/空
  buttons/索引越界）；糖语义；dismissal 映射；picker null/绝对路径 canonicalize；embedded
  artifact 解析（多目标/缺目标/**路径穿越/symlink 逃逸/字节替换/manifest skew** 四族
  adversarial）；typed 错误 wire round-trip；pack-size 脚本 fixture 双臂。
- **原生验收（双平台真机）**：每方法冒烟；**交错时间线取证**——对话框打开期间同 app 另一
  tray 菜单交互、另一 app session 请求、普通 `set-menu`/`ext-command` 三类真实交错完成
  （捕获 transport/request 时间线，不只截窗口图）；**四路 dismissal 一致性**（标题栏/
  ESC/系统关闭/session close → 同一 cancelId 映射）；session close 撤销；`dialog_session_busy`；
  跨 session 并发；suppression 回传；commandLink/expander 真机截证；macOS modal-step
  probe 证据（P0-3：step/menu frame/session close/broker exit 交错次序）。
- **双 target CI 编译门**：darwin 与 windows 两 target 各自 compile/type/test + DTO
  exhaustive fixture（P1-3）。
- **体积与发布证据**：`npm pack --dry-run` 实测报告（§6.3）；clean checkout release
  dry-run + 解包逐目标 identity check（§6.4）。

## 9. 法条草案（收尾落 AGENTS.md）

1. Monorepo Law += 包体积门（§6.3 全文，标注 Owner ruling 2026-09-16、首例 ext-dialog）。
2. 新章 **Dialog Extension Law**（从本档提炼）：模态不阻塞 broker 事件派发（macOS
   modal-session 步进状态机 / win32 对话框专属 STA 线程 + EventLoopProxy 回传；任何
   owner-loop 线程内模态调用均为违规）；完成走通用 deferred command envelope（exactly-once；
   不上 EventPort）；每 session 一对话框（busy typed）；session close 先撤销再 cleanup，以
   cancel 语义结算；平台命名空间严格 typed 校验；prompt 不做、Linux typed unsupported、
   无 page 桥。
3. **deferred command envelope 是通用协议能力**：任何扩展的长时间命令（对话框、未来导出
   等）一律走 Accepted/Completed/Cancelled，不私有造帧；sessionId 由 broker 注入命令作用域，
   扩展不得自报。
