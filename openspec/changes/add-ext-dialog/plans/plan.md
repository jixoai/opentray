# add-ext-dialog — Intent Document (SSOT)

> 原始需求（Owner，2026-09-16）：
> 1. 「开始规划原生的 dialog 相关的开发……不考虑工期，长远考虑」——命名与功能取舍讨论。
> 2. 对 GPT 多包方案（ext-dialog/ext-picker/ext-capture/ext-color/ext-notification/ext-clipboard/System）的评审结论：**dialog 与 picker 合并**（Electron/Tauri 先例均同包、共享全部模态基础设施）；"System" 组改名 `ext-opener` 且不属本 change；capture/color 延后独立立项。
> 3. 包体积规范（Owner ruling，立法）：「如果一个包，在多平台打包后，整体包压缩后的体积不超过 3mb，那么就不拆分成多个平台包。2mb 是一个警告红线，需要报警提醒我决策是否要拆分。到了 3mb 基本就不用问我了，拆了就是。」
> 4. 「把一些平台特有的能力加上去……通用能力上有特定的开关，或者在通用能力外有独立的能力。那么这些设计你也列出来。」
> 5. beep 独立成包（Owner ruling，2026-09-17）：新增 `@opentray/ext-sound`，提供 `playSystemSound(name or platform-name)` 与 `beep(BeepKind)`；`playSound(path)` 按成本裁决——优先保持轻量，全平台低成本则通用，仅部分平台低成本则平台特供。ext-dialog 不再提供 beep，两个包同波开发、各自独立 change。
> 6. 「后续就和 Codex 去讨论。除非有重大决策项需要我参与就停下来问我，否则以 Codex 的决策为准。如果可以就持续推进，直到全部开发和测试全部完成。」
>
> 用户语言系统：**「只做 web 做不到的功能」（2026-09-12 Owner ruling）、「能力原子」、「OS 标准对话框」、「优先保持轻量」**。
> 评审记录：Codex R1：**4.0/10 NO-GO**；R2：**5.0/10 NO-GO**；R3：**5.8/10 NO-GO**；R4：**6.7/10 NO-GO**；R5（`.agents/review/2026-09-17-ext-dialog-sound-r5.md`）：**7.4/10 NO-GO**——本版为 R5 修订版（P0-1 V2 command 符号 + repr(C) 真布局、P0-2/3 spec/tasks 终帧语义同步 + wire timeline 场景、P0-4 共享 payload 常量 `EXTENSION_EVENT_RECORD_MAX_BYTES`、P0-5 一致性门语义规则化 + 正式接入 verify 聚合器与 verify-native-artifacts CI）。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-dialog` 一个包即得：`messageDialog`（`alert`/`confirm` 糖）、`pickFile`/`pickDirectory`/`pickSavePath`——darwin+win32 四目标二进制内嵌单包发布，压缩体积远低于 2MB 警告线。声音能力（`beep`/`playSystemSound`）由同波开发的 `@opentray/ext-sound` 独立提供（change：`add-ext-sound`）。
- 对话框打开期间：**本 app 其它 tray 菜单事件与其它 app 的 tray 交互照常派发**（双平台实测证据），模态绝不卡死 broker。
- 平台特有开关类型安全直达（win32 commandLink/expander/footer、darwin 包语义/文件目录混选）；传错平台的命名空间得到 typed 拒绝，绝不静默忽略。
- Linux 调用得到 typed `dialog_platform_unsupported`，不触碰 broker。

## 调研事实（全部经代码核验）

- 原生工件解析器现有两种 kind：`package`（从 facade 依赖闭包解析平台包，ext-badge 用）与 `file`（单文件，诊断用）——**均不支持单包内嵌多目标二进制**（packages/cli/src/native-extension-artifact.ts:47-49、:102-128）。
- facade 先例：ext-badge = `contract.json`（extensionName/contractFingerprint）+ `optionalDependencies` 挂 4 平台包 + `attachBadge(tray, options)`（packages/ext-badge/package.json、src/index.ts:35、src/native-artifact.ts）。
- 平台二进制命名铁律：facade 全名 + os + arch（packages/ 目录实证 ext-badge-darwin-arm64 等）；ext-badge 无 Linux 包，dialog 采用同矩阵。
- 原生 crate 落点：crates/opentray-ext-badge、crates/opentray-ext-webview → dialog 落 crates/opentray-ext-dialog。
- d19 证据：macOS/Windows 扩展命令派发经 Winit 循环串行化（GUI 主线程）；裸模态调用（`NSAlert.runModal`）会阻塞 wint `ControlFlow::Wait` 循环——模态集成是本 change 最高风险项。
- **R1 核验事实（Codex，锚点见评审报告）**：`ExtCommand`/`ExtCommandResult` 是一请求一响应（protocol.rs:287-296/360-364），broker 在 `ext_command_with_host` 返回后立即回帧（broker.rs:430-448），Node `PendingRequest` 只等待已带 requestId 的响应（local-broker.ts:321-339）——**无 deferred/晚到响应承载**（P0-1）。
- Win32 模态 API 的系统泵只派发窗口消息，不执行 winit `EventLoopProxy` user event——GUI 线程内模态调用期间传输事件停止派发，「WndProc 存活」不等于 broker 仍在派发（P0-2）。
- `ExtensionEnvelope` 命令作用域只有 `appId/trayId/ext`，sessionId 未进命令面，扩展无法从命令输入判断调用 session（P0-5）。
- `PlaySound(NULL, SND_PURGE)` 是进程级停止（P0-4，影响 ext-sound）。
- d19 EventPort 法则：EventPort 服务「命令派发之外的主机事件」；dialog 完成本身就是命令响应。
- Win32 没有原生输入对话框；Electron 与 Tauri 的 dialog 面均无 prompt（生态先例盲区，GPT 方案未察觉）。
- NSOpenPanel 继承自 NSSavePanel（nameFieldLabel 等在 open 面板同样可用）；IFileDialog 的 SetFileNameLabel/SetOkButtonLabel 对 open/save 均可用。

## 决策（D1–D6；细节裁决全部以 design-reference.md 为准，此处为索引）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-dialog`，**单包内嵌四目标二进制**（体积规范首例）：SDK 新增 `kind: "embedded"` artifact，二进制位于 facade 包 `platforms/<target>/`；不建平台子包 | Owner 体积规范（≤3MB 内嵌 / 2MB 警告 / >3MB 拆）；解析器现状两种 kind 均不覆盖 |
| D2 | 能力面 = `messageDialog`（+alert/confirm 糖）+ `pickFile`/`pickDirectory`/`pickSavePath`；**beep 移交 ext-sound**（`add-ext-sound` change，2026-09-17 Owner ruling）；**prompt 不做**（Win32 无原生输入框，Electron/Tauri 均不做）；Linux typed `dialog_platform_unsupported`；不做 page 桥 | 「只做 web 做不到的功能」；无页面上下文是本包市场；声音是独立能力词 |
| D3 | 平台特有面 = `options.darwin`/`options.win32` **结构化命名空间**（非当前平台 typed 拒绝）+ `DialogBackendCapabilities` DTO（每平台序列化，编译门）；v1 无独立平台独有方法——独立能力全部 roadmap 门控（darwin previewFile/ sheet 锚定、win32 shield 图标） | 「平台特例不进共享层，暴露能力契约」法则；WebView WindowCapabilities DTO 先例 |
| D4 | 完成语义 = **DeferredOperation 主模型 + 版本化 DeferredCompletionPort ABI**（R5 P0-1 冻结 V2 符号）：**独立 `opentray_ext_command_v2` 符号**（loader V2→V1 探测，V1 扩展永不以新签名调用——恒 Immediate，无 UB；探测入能力诊断）；`ExtCommandDispositionV1`/`ExtDeferredPortV1` repr(C) 布局 + size_of/offset_of fixture + deferred 时 out_events 必空 + ExtOwnedBytes 释放责任；`attach(instance, port)` 带实例参数（多 mount 隔离）；handle wire = u64（Node 侧十六进制字符串）；payload 上限 = **共享常量 `EXTENSION_EVENT_RECORD_MAX_BYTES`**（opentray-spec 与 @opentray/spec 同值导出，event_hub 私有常量迁出）；operation 绑定 `(sessionId, instanceGeneration, operationId)`；session-close 取消与用户取消同通道结算（terminal payload = result/error 判别联合）；不复用 scoped ExtHostContext、不伪装 EventPort；broker 侧 operation registry + owner loop CAS 结算 + 仅向仍匹配的 session writer 投递（**不承诺任何 event barrier**）；protocol version 1→2（双侧同步 + 兼容拒绝测试）；Node `markDead` 以**通用** `extension_transport_closed` 拒绝（facade 映射公开码，core 无扩展分支） | R2-R5 P0-1 链：同名旧符号以新签名调用是 UB；共享常量须有唯一真值 |
| D5 | 模态调度 v3（R2 P0-2）：**broker-owned owner-loop poll/wake**——扩展只登记 opaque operation，broker 在 owner thread 经版本化 FFI `poll_owner(operation)` 驱动 macOS `runModalSession` 步进并自行合并 wake；**DLL 不得命名/持有 UserEvent/EventLoopProxy**（opentray-bin 私有类型不可进 ABI）。win32 = **每活动 (appId,trayId,sessionId) 一个有界 STA worker**（worker 只拥有自己的 COM dialog/HWND；冻结 worker 上限、presentation ACK、`WM_APP` close dispatcher、join timeout、shutdown 顺序；单全局 STA 被否决——排队违反 Accepted=presented，嵌套无 reentrancy 合同）。UI-affine 实例限 owner-thread registry，**不得以 `unsafe impl Send` 作隐含保证**。macOS probe 移至协议完成之后，且必须覆盖 owner wake 饿死与 exit race | R2 P0-2：UserEvent 为 bin 私有；单 STA 与跨 owner accepted 语义冲突；Send 移动 AppKit 对象无证明 |
| D6 | 流程：单 change，批次 A（spec 协议三件 + broker deferred/sessionId + SDK embedded resolver + pack-size 审计）→ B（crates/opentray-ext-dialog 双平台原生）→ C（facade）→ D（构建图收齐矩阵 + CI）→ E（验证 + 文档 + changeset） | 与 d19/add-webview-orchestration 同款编排；R1 最小解锁顺序 |
| D7 | **保留单会话 caller-scoped broker 运行时**（R2 P0-3 裁决选项 a）：不在本 change 扩大运行时——删除「同 tray 双 session 并发」场景，改为**同 session 多 tray / 多 mount 隔离**；命令 ABI 仍升级为 broker 注入 `CommandScope { appId, trayId, sessionId, instanceGeneration }`（单会话下 session 唯一，但归属仍由 host 注入、扩展不得自报）；跨进程不承诺共享 native state。multi-session shared broker 若未来立项走独立 runtime change | R2 P0-3：现 broker `OPENTRAY_BROKER_SINGLE_SESSION` 拒绝第二连接、kernel 锁 (appId,trayId)→session owner，双 session 场景在现行法则下不可表达 |
| D8 | typed 错误 = **`TypedExtensionError` 共享 schema**（R2 P0-7）：`{code, message, details}` discriminated union 冻结于 @opentray/spec 与 opentray-spec，ServerFrame error 与 deferred terminal 使用同一 JSON 形状；Node 导出含 `code/details/cause` 的 error class；每个错误码指定 detail variant。**backend 查询为异步 `getBackend(): Promise<...>`**（badge `getCapabilities` 惰性模式：load 后请求 DTO 返回不可变快照；每个方法 dispatch 前 await 同一快照做能力前置）——同步属性与惰性加载矛盾（R2 P0-7 裁决） | ServerFrame::Error 现只有 code/message；attach 同步期 DLL 未加载，不可能既同步又真实 |

## 开放问题（R1 后仅余实现级）

| 问题 | 裁决（R1 §4 / P1，已冻结） |
|------|----------|
| comctl6 activation context | **绑定 broker EXE 的 RT_MANIFEST 资源**（不绑 facade DLL）；broker 启动后真实 TaskDialog 能力探测一次并写入 DTO；不可用时 MessageBox 兜底但 `commandLink`/`expander` typed `dialog_capability_unavailable`（不静默降级）；packaged broker 真机取证 |
| dialog 选项语义冻结 | buttons 非空；`defaultId`/`cancelId` 必须是合法索引（越界 typed 拒绝）；Windows 对所有可关闭对话框默认启用 cancellation，无 cancelId 统一映射 0；平台无法观察关闭原因时返回 typed `dialog_dismissal_unavailable` 而非伪造成功；空 filters=全部文件；`allowsOtherFileTypes` 默认 false（不再实测后议）；save 取消=null；结果绝对路径 canonicalize |
| 内嵌体积实测基线 | 「远低于 2MB」是假设不是证据：批次 D 必须产出**真实 `npm pack --json --pack-destination <temp>`** 证据（R2 P0-6：dry-run 不落 .tgz 不可解包）——stat 压缩字节数、npm/pnpm 版本、packlist、四目标 hash 与 stage manifest，随后解包同一 tgz 在每 target runner 跑 resolver+inspector identity check；`--dry-run` 只作快速开发预警；2MB 警告需 Owner 拆分决策记录；无实测不给 packaging GO |
| embedded 身份链（R2/R4 P0-5） | staging 生成 root-contained **embedded manifest**（每目标 relative path/SHA-256/buildIdentity/facade version/contract fingerprint）随 pack 发布；**可实现序（design §6.4 为唯一规范）**：Node 验 manifest+hash → `LoadExt`/`ExpectedExtensionIdentity` 新增 expected sha256/buildIdentity 字段 → broker dlopen 前对已解析路径重 hash → native manifest 在 `Library::new` 之后、`init` 之前校验；TOCTOU 残余声明为已知边界；CI 以 stage/pack 后重 hash 为 release authority；adversarial 测试必须替换真实 library bytes |
| save 路径 canonicalization（R2 P1-4） | 已存在 selection → realpath；save 的不存在 leaf → canonicalize existing parent 后 lexical join，不声称 full realpath |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| `ext-system` 单包 | TCC 画像泄漏（capture 会污染全员 carrier）、依赖图超集（最小消费者背最大图）、契约指纹整体失效、发布节奏耦合（Owner 已否决） |
| `ext-system-dialog` 命名 | "system" 零信息量 + 垃圾抽屉前缀；生态心智（Electron/Tauri dialog）站在短名 |
| dialog/picker 拆两包 | 两大生态先例均同包；模态循环集成/attach/session/二进制矩阵全共享，拆分付不起成本 |
| prompt（v1 或顺手做） | Win32 无原生输入框；自绘模板破坏 OS 标准纯度；Electron/Tauri 均不做 |
| EventPort 承载完成事件 | d19 法则：EventPort 只服务命令派发之外的事件；dialog 完成即命令响应 |
| page bridge（navigator.opentray.alert） | 2026-09-12 Owner ruling：页面能做的归页面（HTML modal/showOpenFilePicker） |
| 对话框内容超链接（TDF_ENABLE_HYPERLINKS） | 系统外观的钓鱼攻击面，永久拒绝（非 roadmap） |
| 自定义 accessory view / 自绘输入 UI | prompt 家族已裁决不做；破坏「OS 标准对话框」纯度 |

## 实施计划（specs/tasks 追溯；对齐 R2 最小解锁顺序）

1. 批次 A（共享基建 + 协议，**独立可审可落地单元**）：`@opentray/spec`/opentray-spec——DeferredOperation 全量 server frame 与 parser schema（broker 生成 operation、`(sessionId, instanceGeneration, operationId)` 归属、terminal payload 恒带结果）、`TypedExtensionError` details union、`CommandScope` 注入、Dialog 类型与 BackendCapabilities（共享 schema + exhaustive fixture）；可选版本化 **DeferredCompletionPort + `poll_owner` ABI 符号**（同 EventPort 可选符号模式）；opentray-bin/core——operation registry、owner loop CAS 结算、session writer 路由、`Send` 安全裁决（UI-affine 实例限 owner-thread registry）；Node——pending-until-final 状态机、typed error class、断连 typed 拒绝；opentray SDK——`NativeExtensionEmbeddedArtifact`（containment + embedded manifest 身份链 + 四类错误）+ `scripts/check-pack-size.mjs`。
2. 批次 B（crates/opentray-ext-dialog，**协议落地并先行评审后开工**）：macOS probe（协议之后：owner wake 饿死/exit race/step 与 menu frame 交错）→ modal-session 步进（经 poll_owner 驱动）；win32 **per-owner 有界 STA worker**（worker 上限/presentation ACK/WM_APP dispatcher/join timeout/shutdown 顺序）；busy 原子占用；session close 撤销。
3. 批次 C（packages/ext-dialog facade）：attachDialog、`getBackend()` 异步快照、类型化命名空间校验、糖类型精确化（`Omit` 排除 message/buttons/default/cancel；pickFile overload `multiple?: false` vs `multiple: true`）、typed 错误工厂、embedded 描述符、contract.json。
4. 批次 D（构建图）：native-build-graph 注册 + 收齐矩阵；**embedded staging manifest**（path/SHA-256/buildIdentity/version/fingerprint）；release-plan/verify-native-plan/stage-release-artifacts/release.yml 同步；broker EXE RT_MANIFEST；**真实 npm pack + 解包逐 target identity** 证据。
5. 批次 E（验证）：双平台真机——交错时间线（同 session 多 tray / 另一 app 实例）、四路 dismissal 一致性、断连/重复终帧/错 owner/旧 generation 竞态族、adversarial 四族（含真实字节替换）、双 target CI、self-review + check 绿、skills 公共文档 + changeset。
