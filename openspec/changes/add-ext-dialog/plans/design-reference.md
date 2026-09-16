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

### 5.1 DeferredOperation：完整命令→终帧 ABI 事务（R3 P0-1 冻结）

```text
# 协议帧（@opentray/spec + opentray-spec 冻结全量 schema 与 parser 真值；version 1→2）
ServerFrame::ExtCommandAccepted  { requestId, operationId }   # 命令受理（Accepted 语义见 §5.3）
ServerFrame::ExtOperationTerminal { operationId, payload }   # 唯一终帧

# 命令 FFI（独立 V2 符号，repr(C) 冻结；R5 P0-1 裁决）
EXT_SYMBOL_COMMAND_V2 = "opentray_ext_command_v2"
opentray_ext_command_v2(instance, context, envelope, out_events, out_disposition) -> ExtResultCode
#[repr(C)] ExtCommandDispositionV1 = { tag: u32, reserved: u32 (=0),
  value: union { none: (), operation_handle: u64, events: ExtOwnedBytes } }   // size_of/offset_of 由 fixture 冻结
# 兼容规则（无 UB）：loader 先探测 V2 符号——缺失则用旧 opentray_ext_command（V1 四参签名，
# 永不以新签名调用），该扩展恒 Immediate、无 deferred 能力（探测结果入能力诊断）
# 约束：tag=Deferred 时 out_events 必须为空；ExtOwnedBytes 的释放责任与现状一致（host 经
# free_string 释放）；tag=Immediate 时 value.events 拥有与旧 out_events 相同语义

# 原生侧可选版本化符号（opentray-spec 常量）
opentray_ext_attach_deferred_completion_port_v1(instance: *mut c_void, port: *const ExtDeferredPortV1)
# instance 参数必须携带：多 mount 时 port 归属实例，一 mount 一 port，杜绝跨实例覆盖
#[repr(C)] ExtDeferredPortV1 = { abi_version: u32, struct_size: u32,
  port_data: *mut c_void,                                   // broker 拥有，进程级存活
  submit: unsafe extern "C" fn(*mut c_void, u64, *const u8, usize) -> i32 }
submit(port_data, handle: u64, payload_bytes, payload_len) -> ExtResultCode
```

**handle wire 表示**：FFI 侧 `u64`；Node 侧传输帧用十六进制字符串（JSON 安全）；payload
上限 = **共享常量 `EXTENSION_EVENT_RECORD_MAX_BYTES`**——批次 A 在 opentray-spec（Rust）
与 @opentray/spec（TS，同值导出）定义该公开常量，event_hub 现私有 `EVENT_DATA_MAX_BYTES`
迁出引用它，deferred port 与 EventPort 对同一数值与 fixture 负责（Rust/TS 双端比对测试）。

**终帧载荷**：`TerminalPayload = { kind: "result", value: JSON } | { kind: "error", error:
TypedExtensionError }`——Node 侧 resolve/reject 的唯一依据。

**事务规则（全部冻结）**：

- **handle 签发**：operationId 与 opaque handle 均由 broker 生成，**仅在命令调用期间**经
  `ExtCommandDispositionV1::Deferred` 下发（host→extension 单向，一次有效）；handle 为
  u64 nonce，绑定 `(sessionId, instanceGeneration, operationId)`；扩展自造/重放 handle →
  `EXT_ERR_INVALID_HANDLE`，错 owner → 丢弃 + 诊断（不回帧）。
- **port 生命周期（EventPort 同款模式）**：immutable host-owned 状态；`abi_version` +
  `struct_size` 校验（不符 → `event_port_abi_incompatible` 同族错误，不静默降级）；
  submit 为 bounded-copy（超限 → `EXT_ERR_OVERSIZED`）；返回码 `EXT_OK /
  EXT_ERR_PORT_CLOSED / EXT_ERR_INVALID_HANDLE / EXT_ERR_OVERSIZED`；**submit 通道在
  LoadExt ACK 后才打开**；session/instance 清理前先 revoke（此后 submit 恒
  `EXT_ERR_PORT_CLOSED`，无队列突变）；broker 不在可能仍有 stale worker submit 的窗口
  释放 host 内存——port_data 指向 broker 拥有的进程级存活状态。
- **终帧语义**：`result` 分支 resolve，`error` 分支以 TypedExtensionError reject；撤销
  路径由扩展产出 cancel 分支 result payload（与用户取消同构）；重复终帧/旧 generation →
  owner loop CAS 无状态丢弃 + 诊断。
- **唯一终帧来源（R4 P0-2 裁决）**：**跨线程终帧提交只有 port submit 一条路**；
  `poll_owner` 只返回 `Pending`——poll 与 port 不允许双通道产出终帧，「实现批二选一」的
  开口作废。
- **事件顺序的诚实声明**：dialog 不经 EventPort 发任何事件，**不承诺任何 event
  barrier**——终帧与其它帧的相对顺序由 transport 写出顺序唯一决定。
- **断连语义分层**：共享 spec 冻结通用 `extension_transport_closed`（核心 client 对一切
  pending operation 的统一拒绝，无任何扩展名分支）；ext-dialog facade 将其映射为公开的
  `dialog_transport_closed`（facade 层 mapping，core 不认识 dialog）。
- **protocol version 1→2**：双侧常量同步提升；旧版本帧/符号的兼容拒绝路径有 exhaustive
  测试；Node/Bun 双端在同一切换门内。
- **确定性测试族**：ABI layout/未知 version、伪造/stale/错 owner handle、success/error
  终帧 round-trip（Rust/TS/Node/Bun）、accepted 前后断连、重复终帧、revoke 后 submit、
  核心 client 无 dialog 分支的编译期证明、旧扩展（无 disposition 符号）恒 Immediate。

### 5.2 macOS：broker-owned 调度器（poll_owner + WaitUntil，无自旋无饿死）

`UserEvent` 是 opentray-bin 私有 enum，DLL 不得持有 waker（R2 P0-2）。调度契约冻结：

- **poll 结果类型**：`poll_owner(operation) -> Pending { next_deadline, wake_reason }`——
  终帧只经 §5.1 port submit（唯一通道），poll 不产出终帧。
- **调度器归属 broker + re-arm 机制（R4 P0-2 冻结）**：owner loop 持有**一个合并的
  `DialogPollDue(generation)` user event**，`ControlFlow::WaitUntil(min deadline)` 驱动；
  AppKit 回调只写扩展内部**原子 deadline**——broker 侧一个 per-operation 的 re-arm
  watcher（owner loop 自有 timer/proxy wake，非 DLL 持有）在 deadline 被提前时重新投递
  `DialogPollDue` 并让 loop 重算 WaitUntil：**回调改 deadline → broker-owned wake → loop
  醒来重算**，杜绝「已睡到较晚时刻而 deadline 已提前」的饿死路径。同 generation 多次
  due 合并为一次 poll。
- **native 回调约束**：不得保留 broker 指针、不得无上限自发 wake、不得直接调用 winit
  ——「需要继续步进」只能通过原子 deadline 表达。
- **撤销**：revoke 先从调度表移除该 generation（stale due 事件经 generation 检查丢弃），
  再 endModalSession。
- **配额**：每次 owner loop 迭代的 modal poll 工作量有界（冻结：单次迭代 ≤ 4 个 owner、
  每 owner ≤ 1 次 runModalSession 步进），menu/transport 帧不被饿死。
- **probe 前置**（协议完成后）：无外部事件下终态推进（WaitUntil 到期 + re-arm 双路径）、
  deadline 提前场景、空闲 CPU/wake 计数有界、modal 步进之间普通 menu/transport 帧正常
  完成、exit/revoke 竞态无 AppKit 调用且无重复终帧。

### 5.3 win32：per-owner 有界 STA worker 与诚实 Accepted 语义

- **Accepted 的诚实语义（R3 P0-3 裁决）**：win32 `IFileDialog::Show` 是同步调用，无文档
  化的「已呈现」先验信号——Accepted 在 win32 统一冻结为「**worker 已进入原生模态调用**」
  （对 TaskDialog 以 `TDN_CREATED` 回调为呈现证据、`IFileDialog::Show` 以进入调用为证据，
  probe 先行取证）；绝不把排队称为 presentation。
- **数值冻结**：worker 上限 **8**（per broker）；达到上限 → typed
  `dialog_worker_limit_reached`（区别于同 owner 第二对话框的 `dialog_session_busy`），
  拒绝发生在 Accepted 之前，绝不静默排队；worker 启动+进入模态调用超时 **3s**；close
  join 超时 **2s**；close dispatcher = `WM_APP+{owner 序号}`，仅 worker 线程处理自己的
  COM 对象。
- **pre-Accept 失败事务（R4 P0-3 冻结）**：3s 进入超时发生在 operationId/Accepted 可被
  Node 观察之前——该失败必须是**带原 requestId 的同步 typed error 响应**（
  `dialog_presentation_failed`），不产生 operation、不发 Accepted、不发无关联终帧；
  已进入模态调用之后的失败才走 Accepted → terminal error。
- **卸载竞态裁决（R4 P0-3 冻结）**：**worker 未退出不得 deinit/dlclose**——join 超时
  （2s）只允许两种结局：(a) 保留 library/instance 引用直至 worker 自然退出后再清理
  （broker 继续退出流程，清理延后）；(b) 放弃本次清理并按致命诊断终止 broker 进程。
  绝不在 worker 仍可能执行 `opentray_ext_*` 时释放 DLL（use-after-unload 零容忍）。
- **线程契约**：`ExtDeferredPortV1.submit` 为 host 拥有的线程安全状态（Send+Sync 由
  broker 侧保证）；跨线程移动的只有**可拷贝的请求数据与 port shim**——扩展实例与全部
  COM/AppKit 对象永不移动。opentray-core 的 blanket `ExtensionInstance: Send` 与
  dynamic_extension 的 `unsafe impl Send` 对 UI-affine 实例**移除或证明永不移动**（改为
  owner-thread registry + 线程亲和断言）。
- **shutdown 顺序**：按 owner 逆序投递 close → join（2s 有界）→ 诊断 → 扩展 cleanup；
  worker 在 join 超时后不再接收新请求。
- comctl6：绑定 broker EXE `RT_MANIFEST`；启动能力探测写 DTO；不可用 → MessageBox 兜底
  + `commandLink`/`expander` typed `dialog_capability_unavailable`。

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

- 对内嵌平台二进制的包执行**真实 `npm pack --json --pack-destination <temp>`**，从生成
  `.tgz` 的 `stat` 取压缩体积（`--dry-run` 仅快速开发预警）；
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
- **embedded staging manifest（身份链闭合，R3 P0-5 顺序修正）**：staging 生成 root-contained
  `platforms/manifest.json`——每目标 relative path、SHA-256、buildIdentity、facade
  version、contract fingerprint，随 pack 发布。**校验顺序（可实现序）**：Node 侧
  containment 校验 manifest + 计算选中 library hash → 把 expected sha256 与 buildIdentity
  纳入 `LoadExt`/`ExpectedExtensionIdentity` 传输 → broker 在 dlopen 前对已解析路径重算
  hash 比对 → **native embedded manifest 只能在 `Library::new` 之后、`init` 之前**校验
  （manifest 是库内导出符号；诚实声明，不声称 before Library::new）。TOCTOU 残余（hash
  后 dlopen 的窗口）单独记录为已知边界——hash-then-load 不能消除全部 OS 竞态，CI 以
  stage/pack 后重 hash 为 release authority。adversarial 测试必须替换**真实 library
  bytes**（而非仅改 JSON 声称）。
- 同步改动面：`release-plan.ts`、`verify-native-plan.ts`、`stage-release-artifacts.ts`、
  `.github/workflows/release.yml`、facade `files` 字段及配套测试。
- 验收：clean checkout 执行 release 预演（真实 pack）→ 解包 tgz → 逐目标 resolver/
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
facade 以异步 `getBackend(): Promise<DialogBackendCapabilities>` 暴露快照；命名空间开关的可用性判断以 DTO 为运行时事实源
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

- **TS 确定性**（vitest，Node 与 Bun 双跑）：deferred 事务（handle 签发/伪造/stale/错
  owner、Accepted 不结算、TerminalPayload result/error 双分支 round-trip、exactly-once、
  传输关闭 typed rejection、一个 deferred 命令夹在两个普通命令之间完成且只结算一次、
  核心 client 无 dialog 分支编译期证明）；命名空间校验（mismatch/未知字段/commandLink
  前置/空 buttons/索引越界）；糖语义；dismissal 映射；picker null/路径 canonicalize；
  embedded artifact 解析（多目标/缺目标/**路径穿越/symlink 逃逸/真实字节替换/manifest
  skew** 四族 adversarial + LoadExt expected sha256/buildIdentity 字段断言）；typed 错误
  wire round-trip；pack-size 脚本 fixture 双臂（真实 tgz stat）。
- **原生验收（双平台真机）**：每方法冒烟；**交错时间线取证**——对话框打开期间同 session
  其它 tray 菜单交互、普通 `set-menu`/`ext-command` 真实交错完成（捕获 transport/request
  时间线，不只截窗口图）；**四路 dismissal 一致性**（标题栏/
  ESC/系统关闭/session close → 同一 cancelId 映射）；session close 撤销（cancel 分支
  payload）；`dialog_session_busy` / `dialog_worker_limit_reached`（cap-1/cap/cap+1）；
  suppression 回传；commandLink/expander 真机截证；macOS modal-step
  probe 证据（§5.2：WaitUntil 驱动/空闲 wake 有界/menu 帧不饿死/exit race）。
- **双 target CI 编译门**：darwin 与 windows 两 target 各自 compile/type/test + DTO
  exhaustive fixture（P1-3）。
- **体积与发布证据**：真实 `npm pack --json --pack-destination` 产物（tgz stat/digest/
  npm 版本/packlist/目标 hash）；clean checkout release 预演（真实 pack）+ 解包同一
  tgz 逐目标 identity check（§6.3/§6.4）。
- **文档一致性 grep 门**（R3 P0-6，可执行脚本
  `scripts/openspec/check-ext-dialog-sound-consistency.mjs`）：本 change 全部文档禁止以下
  负面清单——`ExtCommandCompleted`、`ExtCommandCancelled`、同步 `backend` 属性、
  same-broker 跨 session 并发表述、dry-run 作为发布证据——评审记录中的历史引用除外。

## 9. 法条草案（收尾落 AGENTS.md）

1. Monorepo Law += 包体积门（§6.3 全文，标注 Owner ruling 2026-09-16、首例 ext-dialog）。
2. 新章 **Dialog Extension Law**（从本档提炼）：模态不阻塞 broker 事件派发（macOS
   broker-owned 调度器 poll_owner + WaitUntil 合并 wake / win32 per-owner 有界 STA
   worker；任何 owner-loop 线程内模态调用均为违规；**扩展不得持有任何 waker——调度权恒在
   broker**）；完成走 DeferredOperation 事务（CommandDisposition tagged 返回 + 唯一
   Terminal 帧 result/error 判别；DeferredCompletionPort 生命周期同 EventPort 模式）；
   每-owner 一对话框（busy/worker-limit typed 两级）；session close 先撤销再 cleanup，以
   cancel 分支 result 结算；平台命名空间严格 typed 校验；prompt 不做、Linux typed
   unsupported、无 page 桥。
3. **DeferredOperation 是通用协议能力**：任何扩展的长时间命令一律走 CommandDisposition
   /TerminalPayload 事务，不私有造帧；`extension_transport_closed` 是核心 client 的通用
   断连拒绝，扩展 facade 自行映射公开码；sessionId 由 broker 注入命令作用域，扩展不得
   自报。
