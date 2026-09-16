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
- d19 EventPort 法则：EventPort 服务「命令派发之外的主机事件」；dialog 完成本身就是命令响应，不适用 EventPort。
- Win32 没有原生输入对话框；Electron 与 Tauri 的 dialog 面均无 prompt（生态先例盲区，GPT 方案未察觉）。
- NSOpenPanel 继承自 NSSavePanel（nameFieldLabel 等在 open 面板同样可用）；IFileDialog 的 SetFileNameLabel/SetOkButtonLabel 对 open/save 均可用。

## 决策（D1–D6；细节裁决全部以 design-reference.md 为准，此处为索引）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-dialog`，**单包内嵌四目标二进制**（体积规范首例）：SDK 新增 `kind: "embedded"` artifact，二进制位于 facade 包 `platforms/<target>/`；不建平台子包 | Owner 体积规范（≤3MB 内嵌 / 2MB 警告 / >3MB 拆）；解析器现状两种 kind 均不覆盖 |
| D2 | 能力面 = `messageDialog`（+alert/confirm 糖）+ `pickFile`/`pickDirectory`/`pickSavePath`；**beep 移交 ext-sound**（`add-ext-sound` change，2026-09-17 Owner ruling）；**prompt 不做**（Win32 无原生输入框，Electron/Tauri 均不做）；Linux typed `dialog_platform_unsupported`；不做 page 桥 | 「只做 web 做不到的功能」；无页面上下文是本包市场；声音是独立能力词 |
| D3 | 平台特有面 = `options.darwin`/`options.win32` **结构化命名空间**（非当前平台 typed 拒绝）+ `DialogBackendCapabilities` DTO（每平台序列化，编译门）；v1 无独立平台独有方法——独立能力全部 roadmap 门控（darwin previewFile/ sheet 锚定、win32 shield 图标） | 「平台特例不进共享层，暴露能力契约」法则；WebView WindowCapabilities DTO 先例 |
| D4 | 完成语义 = pending command response：show 命令挂起，对话框关闭时回帧；close/ESC = cancelId 语义；**不上 EventPort** | d19 法则边界内正确分类；一次性调用 |
| D5 | 模态红线：macOS modal-session 步进集成进 wint loop（禁裸 runModal）；Windows STA 模态泵；每 (appId,trayId,sessionId) 同时至多一个对话框（第二个 typed `dialog_session_busy`）；session close 撤销未决对话框并以 cancel 语义 resolve | 会话隔离法则；WebView polling cost law 同族教训；tray 存活是验收项 |
| D6 | 流程：单 change，批次 A（spec 类型 + SDK embedded kind + pack-size 审计）→ B（crates/opentray-ext-dialog 双平台原生）→ C（packages/ext-dialog facade）→ D（构建管线 staging + CI 体积门）→ E（验证 + 公共文档 + changeset） | 与 d19/add-webview-orchestration 同款编排 |

## 开放问题（默认假设先行）

| 问题 | 默认假设 |
|------|----------|
| comctl32 v6 activation context 声明方式 | broker 清单声明；不可用时 TaskDialog 降级 MessageBox，`backend.taskDialog=false` 如实上报 |
| NSSavePanel `allowsOtherFileTypes` 与 filters 交互 | 默认 false 起步，实测后议 |
| 内嵌体积实测基线 | 预期远低于 2MB；实测数字归档进验证证据，作为体积门首例锚点 |

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

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 协议类型（命令/选项/结果/BackendCapabilities DTO）→ opentray SDK `NativeExtensionEmbeddedArtifact` kind + 解析/typed 错误 → `scripts/check-pack-size.mjs` 体积审计。
2. 批次 B：crates/opentray-ext-dialog——macOS（NSAlert modal-session 步进、NSOpenPanel/NSSavePanel）+ Windows（TaskDialog comctl6 + MessageBox 降级、IFileOpenDialog/IFileSaveDialog STA）；pending response + session busy + cleanup 撤销。
3. 批次 C：packages/ext-dialog facade（attachDialog、类型化命名空间校验、embedded 描述符、contract.json）。
4. 批次 D：构建管线向 `platforms/<target>/` staging + CI 体积门（2MB warn / 3MB fail）。
5. 批次 E：双平台原生验收（含 tray 存活证据）+ 体积报告 + skills/opentray 公共文档 + changeset（minor）。
