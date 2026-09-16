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
> 评审记录：Codex R1（gpt-5.6-terra/xhigh，2026-09-17，`.agents/review/2026-09-17-ext-dialog-sound-r1.md`）：add-ext-dialog **4.0/10 NO-GO**——本版为 R1 修订版（P0-1/2/3/5/6/7/8/9、P1-1/2/3/8 与 §4 裁决全部吸收）。

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
| D4 | 完成语义 = **通用 deferred command envelope**（R1 P0-1 推荐方案）：`ExtCommandAccepted{requestId, operationId}` + `ExtCommandCompleted{operationId, result}` + `ExtCommandCancelled{operationId, reason}`，@opentray/spec + broker + Node PendingRequest 三层状态机；exactly-once 结算、session close 先撤销再完成、response-before-event barrier、连接关闭 typed rejection；**不上 EventPort**（完成是请求作用域的响应，不是广播事件） | R1 P0-1：现协议一请求一响应，无 deferred 承载；Node 侧无晚到响应状态 |
| D5 | 模态红线 v2（R1 P0-2/P0-3）：**win32 = 对话框专属 STA UI 线程**（输入经 owner loop 消息代理，结果经 EventLoopProxy 回传；证明 tray HWND/notify-icon 线程约束不破）；**macOS = modal-session 步进状态机** `Created→Presented→Stepping→Dismissed\|Revoked`（`EventLoopProxy<UserEvent::DialogWake/Close>` 唤醒、唯一 UI owner、一次性 completion CAS、teardown 先 endModalSession）；每 (appId,trayId,sessionId) 同时至多一个对话框（busy 原子占用，第二个 typed `dialog_session_busy`） | R1 P0-2：Win32 模态泵不执行 EventLoopProxy user event；P0-3：步进无 wake/affinity/teardown 合同会竞态 |
| D6 | 流程：单 change，批次 A（spec 协议三件 + broker deferred/sessionId + SDK embedded resolver + pack-size 审计）→ B（crates/opentray-ext-dialog 双平台原生）→ C（facade）→ D（构建图收齐矩阵 + CI）→ E（验证 + 文档 + changeset） | 与 d19/add-webview-orchestration 同款编排；R1 最小解锁顺序 |
| D7 | **命令作用域注入 host-owned sessionId**（R1 P0-5）：`ExtensionEnvelope`/`ExtCommand` 传输面增加 broker 从连接注入的 sessionId（扩展不得自报），registry/实例状态键升级为含 sessionId；同 app 多 session 隔离测试 | 现作用域只有 appId/trayId/ext；busy/cleanup 语义无法在 native 表达 |
| D8 | **typed 错误 envelope** `{code, message, details}`（details 为 discriminated union）全链路冻结：@opentray/spec schema + Rust `ExtensionError::Detailed` + server error frame + Node typed error factory；facade preflight（Linux/路径/命名空间/格式）与 broker/native（busy/capability/native-not-found）职责分界，所有分支在状态变更前失败 | R1 P0-9：现 Node 侧只构造普通 Error("code: message")，消费方无法稳定区分 |

## 开放问题（R1 后仅余实现级）

| 问题 | 裁决（R1 §4 / P1，已冻结） |
|------|----------|
| comctl6 activation context | **绑定 broker EXE 的 RT_MANIFEST 资源**（不绑 facade DLL）；broker 启动后真实 TaskDialog 能力探测一次并写入 DTO；不可用时 MessageBox 兜底但 `commandLink`/`expander` typed `dialog_capability_unavailable`（不静默降级）；packaged broker 真机取证 |
| dialog 选项语义冻结 | buttons 非空；`defaultId`/`cancelId` 必须是合法索引（越界 typed 拒绝）；Windows 对所有可关闭对话框默认启用 cancellation，无 cancelId 统一映射 0；平台无法观察关闭原因时返回 typed `dialog_dismissal_unavailable` 而非伪造成功；空 filters=全部文件；`allowsOtherFileTypes` 默认 false（不再实测后议）；save 取消=null；结果绝对路径 canonicalize |
| 内嵌体积实测基线 | 「远低于 2MB」是假设不是证据：批次 D 必须产出每包真实 `npm pack` 压缩 tarball 字节数报告（含 npm/pnpm 版本、四目标清单与 hash）写入 evidence artifact；2MB 警告需 Owner 拆分决策记录；无实测不给 packaging GO |

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

## 实施计划（specs/tasks 追溯；对齐 R1 最小解锁顺序）

1. 批次 A（共享基建 + 协议）：`@opentray/spec`——deferred command envelope、sessionId 注入、typed 错误 envelope、Dialog 命令/选项/结果类型与 BackendCapabilities DTO；opentray-bin/core——deferred 响应状态机 + sessionId 注入 + registry 键升级；opentray SDK——`NativeExtensionEmbeddedArtifact`（containment + 四类结构化错误）+ `scripts/check-pack-size.mjs`。
2. 批次 B（crates/opentray-ext-dialog）：macOS modal-session 步进状态机（DialogWake/Close user event、一次性 completion CAS、endModalSession teardown 顺序）；win32 专属 STA UI 线程拓扑（owner loop 消息代理 + EventLoopProxy 回传 + tray 线程约束证明）；busy 原子占用；session close 撤销。
3. 批次 C（packages/ext-dialog facade）：attachDialog、类型化命名空间校验、typed 错误工厂、embedded 描述符、contract.json。
4. 批次 D（构建图）：native-build-graph 注册 dialog component 与收齐矩阵（四目标全部匹配 facade version/contract 才写入 `platforms/`，缺目标/过期/hash 不匹配即失败）；release-plan/verify-native-plan/stage-release-artifacts/release.yml 同步；broker EXE RT_MANIFEST；体积实测报告。
5. 批次 E（验证）：双平台真机——对话框打开期间同 app 另一 tray / 另一 app session / 普通 set-menu 与 ext-command 交错完成的时间线取证；四路 dismissal（标题栏/ESC/系统关闭/session close）一致性；adversarial 路径逃逸/symlink/字节替换/manifest skew；双 target CI 编译门；skills 公共文档 + changeset（minor）。
