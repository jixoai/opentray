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
  alert(message: string, options?: MessageSugarOptions): Promise<void>;
  confirm(message: string, options?: MessageSugarOptions): Promise<boolean>;
  messageDialog(options: MessageDialogOptions): Promise<MessageDialogResult>;
  pickFile(options?: FilePickOptions & { multiple?: false }): Promise<string | null>;
  pickFile(options: FilePickOptions & { multiple: true }): Promise<readonly string[] | null>;
  pickDirectory(options?: DirectoryPickOptions): Promise<string | null>;
  pickSavePath(options?: SavePickOptions): Promise<string | null>;
  getBackend(): Promise<DialogBackendCapabilities>;
}

/** 糖函数不可覆盖 message/buttons/defaultId/cancelId（R2 P1-5 精确类型冻结）。 */
export type MessageSugarOptions = Omit<
  MessageDialogOptions,
  "message" | "buttons" | "defaultId" | "cancelId"
>;
```

`getBackend()` 为**异步**（R2 P0-7 裁决）：扩展惰性加载（`ensureLoaded` 模式同 badge
`getCapabilities`）——attach 同步期 DLL 未加载，不可能既同步又真实；方法内部在 native
dispatch 前 await 同一快照做能力前置（`commandLink` 可用性等）。不存在同步 `backend`
属性。

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

## 5. 原生架构（crates/opentray-ext-dialog；R2 P0-1/2/3 修订版）

### 5.1 DeferredOperation 主模型 + 版本化 DeferredCompletionPort ABI

现有 `ExtCommand` 是同步单响应；扩展命令 ABI 返回后 `ExtHostContext` 即失效（EventPort Law
禁止驻留）。完成通道设计为**新的可选版本化 ABI 符号**（与 EventPort 可选符号同模式）：

```text
# 协议帧（@opentray/spec + opentray-spec 冻结全量 schema 与 parser 真值）
ServerFrame::ExtCommandAccepted  { requestId, operationId }   # 命令受理（对话已呈现/已登记）
ServerFrame::ExtOperationTerminal { operationId, payload }   # 唯一终帧：payload 恒携带 extension result

# 原生侧可选符号（opentray-spec 常量，同 EventPort 家族）
opentray_ext_attach_deferred_completion_port_v1(...)   # 一次 attach，immutable port
port.submit(opaque_operation_handle, bounded_terminal_payload_json)
```

- **operation 归属**：operationId 由 broker 生成，绑定不可伪造的
  `(sessionId, instanceGeneration, operationId)`——扩展只能提交 host 签发的 opaque handle，
  不能自造。
- **terminal payload 恒携带结果**：用户取消、四路 dismissal、session close 撤销，一律由
  扩展产出最终结果（cancelId 分支 / picker null / `dialog_dismissal_unavailable` typed
  error payload）经同一通道结算——session-close 取消与用户取消同构，**不存在独立
  `Cancelled` 帧**，杜绝 Node 侧 extension-specific 推导（R2 P0-1 裁决）。
- **broker 侧**：`NativeBrokerApp` 持通用 operation registry——port completion 到达后由
  owner loop CAS 结算（重复终帧/错 owner/旧 generation 无状态丢弃 + 诊断），仅向仍匹配的
  transport session writer 投递终帧；terminal-before-same-operation-event barrier 冻结。
- **Node 侧**：`PendingRequest` 升级 pending-until-final（Accepted 不结算）；连接 `markDead`
  时本地全部 pending operation 以 typed `dialog_transport_closed` 拒绝——broker 不向已关闭
  socket 承诺写终帧。
- **protocol version** 提升；所有 exhaustive switch 双侧同步；确定性测试族：accepted 后两
  普通请求、重复终帧、completion/Exit race、disconnect before/after accepted、旧
  generation、wrong owner。

### 5.2 macOS：broker-owned owner-loop poll/wake（DLL 不持有任何 waker）

`UserEvent` 是 opentray-bin 私有 enum，动态 DLL ABI 不暴露 EventLoopProxy（R2 P0-2 证据）。
调度权反转：

- 扩展在 show 命令内只**登记 opaque operation**（构造 NSAlert/NSPanel +
  `beginModalSession`）并立即返回 Accepted；
- broker owner loop 通过版本化 FFI **`poll_owner(operation)`** 驱动每次 `runModalSession`
  步进，并自行合并/投递 wake（包括 AppKit 回调触发的再调度——扩展经 completion port 或
  poll 返回值告知「需要继续步进」）；
- 状态机 `Created → Presented → Stepping → Dismissed | Revoked`；一次性 completion CAS；
  teardown 顺序：CAS `Revoked` → `endModalSession` + panel close → 扩展 cleanup；
- **probe 前置（协议之后）**：必须覆盖 owner wake 饿死（`ControlFlow::Wait` 无事件时步进
  不停滞）、exit race（broker 关闭与步进并发）、step 与普通 menu frame 交错次序。

### 5.3 win32：per-owner 有界 STA worker

单全局 STA 被否决（R2 P0-2：排队违反 Accepted=presented；嵌套无 reentrancy 合同）。改为：

- **每活动 `(appId, trayId, sessionId)` 一个 STA worker**（有界上限，冻结数值；超限 →
  typed `dialog_busy` 族拒绝）；worker 只拥有自己的 COM dialog/HWND（TaskDialogIndirect /
  IFileOpenDialog / IFileSaveDialog 在 worker 线程 `CoInitialize` 后运行）；
- **presentation ACK**：worker 完成呈现后才发 Accepted（对齐「Accepted = 已呈现」）；
- **close dispatcher**：撤销请求经 `WM_APP` 投递到该 worker 线程处理（COM 接口不跨线程）；
- **join timeout 与 shutdown 顺序冻结**：broker 退出时按 owner 逆序 close → join（有界
  超时 + 诊断）→ 扩展 cleanup；
- tray backend 的 HWND/notify-icon 线程归属不受影响（worker 不触碰 tray HWND）；
- comctl6：绑定 broker EXE `RT_MANIFEST`（§5.4/§2.2 不变）。

### 5.4 busy 与撤销语义

- 每 `(appId, trayId, sessionId)` 同时至多一个活动对话框；同 owner 第二个 show → typed
  `dialog_session_busy`（broker 前置原子拒绝）。**单会话运行时下**（§5.5）并发对话来自同
  session 的多 tray/多 mount 与不同 app 实例——跨 owner 并发合法。
- **session close 撤销**：先 CAS `Revoked` → 撤销原生对话框（macOS endModalSession /
  win32 WM_APP dispatcher）→ 扩展以 cancel 分支结果 payload 提交终帧 → 扩展 cleanup。
- **dismissal 映射**（不变）：标题栏/ESC/系统 dismissal → `cancelId`；无 cancelId → 0；
  平台无法观察 → typed `dialog_dismissal_unavailable`（作为 terminal payload 的 error 形态）。

### 5.5 运行时模型：保留单会话 caller-scoped broker（R2 P0-3 裁决选项 a）

现 broker 以 `OPENTRAY_BROKER_SINGLE_SESSION` 拒绝第二连接，kernel 锁
`(appId,trayId) → sessionId` owner——「同 tray 双 caller session 并发」在现行法则下不可
表达。**本 change 不扩大运行时**：

- 删除双 session 同 tray 场景；隔离验收改为**同 session 多 tray / 多 mount** +
  跨 app 实例（独立 broker 进程，互不触碰）；
- 命令 ABI 仍升级为 broker 注入 `CommandScope { appId, trayId, sessionId,
  instanceGeneration }`（单会话下 session 唯一，但归属由 host 注入、扩展不得自报）；
  registry/busy/deferred operation 键全部使用 CommandScope；
- multi-session shared broker 若未来立项，走独立 runtime change（连接准入/tray owner/
  registry/writer 路由/生命周期法则先行），dialog/sound 届时再适配。
- `unsafe impl Send` 裁决：UI-affine 原生实例限制在 owner-thread registry，不以隐含 Send
  保证跨线程移动（R2 P0-2）。

### 5.6 依赖与权限

macOS 依赖 Darwin carrier/AppKit（ext-badge 同族）；无 TCC 权限需求。win32 新增链接面：
comctl32（TaskDialog）、shell32（IFileDialog）；无 WinRT。typed 错误 envelope 见 §7.5。

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
- **实测即证据**（R1 §4.5 + R2 P0-6）：「远低于 2MB」是假设不是基线——发布证据必须是
  **真实 `npm pack --json --pack-destination <temp>`**：从生成 `.tgz` 的 `stat` 读取压缩
  字节数，保存 npm/pnpm 版本、packlist、四目标 hash 与 stage manifest；随后**解包同一
  tgz** 在每 target runner 执行 resolver + native inspector/loader identity check。
  `--dry-run` 仅作快速开发预警，不得作为发布证据或解包输入。首次 release 报告写入
  review/evidence artifact；2MB 警告需 Owner 拆分决策记录；无实测不给 packaging GO。

### 6.4 构建图收齐矩阵与 embedded 身份链（R1 P0-8 + R2 P0-5）

- `scripts/binaries/native-build-graph.ts` 注册 `dialog` component 与 target capability
  matrix；每目标产出 native inspector/manifest/SHA-256 证据（同 badge 管线）。
- **facade staging 收齐规则**：四目标（darwin-arm64/x64、windows-arm64/x64）全部匹配当前
  facade version 与 contract fingerprint 才写入 `packages/ext-dialog/platforms/<target>/`
  并生成 manifest；缺目标、过期 target、hash 不匹配必须失败。
- **embedded staging manifest（身份链闭合）**：staging 生成 root-contained
  `platforms/manifest.json`——每目标 relative path、SHA-256、buildIdentity、facade
  version、contract fingerprint，随 pack 发布。resolver 必须 containment 校验该 manifest、
  计算选中 library 的 hash、把 buildIdentity/hash 纳入 expected load identity；broker 在
  `Library::new` 前重验 actual embedded manifest 的 build identity 与 expected 一致。
  **TOCTOU 裁决**：CI closure 以 stage/pack 后重 hash 为 release authority；运行时至少在
  load 前重 hash 并拒绝不匹配。adversarial 测试必须替换**真实 library bytes**（而非仅改
  JSON 声称）。
- 同步改动面：`release-plan.ts`、`verify-native-plan.ts`、`stage-release-artifacts.ts`、
  `.github/workflows/release.yml`、facade `files` 字段及配套测试。
- 验收：clean checkout 执行 release dry-run（真实 pack）→ 解包 tgz → 逐目标 resolver/
  loader identity check 全绿。

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
