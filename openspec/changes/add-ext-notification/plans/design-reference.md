# add-ext-notification — Design Reference（规范附录，实现以本档为准）

> 共享框架（embedded 打包、V2 Immediate 命令 ABI、`getBackend()` 异步冻结快照、typed 错误码
> details 对象、嵌入身份链）沿用 add-ext-dialog/add-ext-sound 已定稿法则，本档不重复；引用
> 其归档 spec。意图索引见 `plan.md`。

## 0. 定位与边界

能力词 `notification` = **OS 标准通知原子**：host 侧发起的系统通知（标题/正文），无页面上下文。
与 dialog/sound 同族：`tray.extend` 家族、session-scoped、单会话运行时。

不做清单（v1）：通知激活/点击事件（EventPort producer——需求证实后再议）、行动按钮与内联回复、
分组与角标进度、自定义声音（平台默认提示音）、富媒体附件、Linux 原生（typed
`notification_platform_unsupported`，与 dialog/sound 同律）。

## 1. 公共 API（facade `@opentray/ext-notification`）

```ts
export const attachNotification = (
  tray: TrayHandle,
  options?: NotificationExtensionOptions
): NotificationCapability => { /* tray.extend 家族同构 */ }

export type NotificationAuthorizationStatus = 'granted' | 'denied' | 'notDetermined';

export interface NotificationCapability {
  notify(options: NotifyOptions): Promise<void>;
  getAuthorizationStatus(): Promise<NotificationAuthorizationStatus>;
  requestAuthorization(): Promise<boolean>;  // darwin 实义；win32 恒 true
  getBackend(): Promise<NotificationBackendCapabilities>;
}

export interface NotifyOptions {
  title: string;                 // 必填非空
  body?: string;
  subtitle?: string;             // darwin 投影；win32 文档化降级（拼入 body 前缀）
  silent?: boolean;              // 默认 false：平台默认提示音；true = 静默
}
```

`notify` 为 **resolve-on-acceptance**（与 sound 同律）：原生受理即 resolve；用户是否看到/何时看到
不属于受理语义。notDetermined 状态下首次 `notify`：darwin 由系统隐式发起授权弹窗（文档化），
win32 无此概念。无任何选项字段透传平台特供命名空间（v1 无）。

## 2. 平台投影

| 维度 | darwin | win32 |
|---|---|---|
| 机制 | UNUserNotificationCenter（UserNotifications 框架） | **Shell_NotifyIcon(NIF_INFO)**：复用本 caller 已注册的托盘图标的气泡/Toast 通道 |
| 前提 | 调用方 Darwin carrier `.app` 提供 bundle identity（现有法则：caller-specific carrier 天然满足）；UNUserNotificationCenter 须 owner 线程取用 | 托盘图标已由 core 注册（OpenTray 本就是托盘平台——每个 consumer 必然有图标）；无需 AUMID/快捷方式原子 |
| 授权 | getAuthorizationStatus/requestAuthorization 实义；denied 下 notify → typed `notification_denied` | 无授权概念：恒 granted（文档化降级） |
| title/body | UNMutableNotificationContent title/body/subtitle | szInfo/szInfoTitle（ balloons 在 Win10+ 自动升级为 Toast 渲染） |
| silent | 默认声音 = 系统默认；true 则不设声音标志 | NIF_INFO 无独立静默位：true 时以 NIIF_NOSOUND 投影 |
| 已知限制（文档化降级） | 无 delegate（v1 无事件）；通知中心留存由系统策略管理 | 无行动按钮；时长由系统策略；Win10 之前为经典气泡 |

**win32 路径裁决（设计冻结候选，交 Codex 对抗）**：方案 A = WinRT Toast
（需 AUMID 注册原子——App Launch Command Law 已判定 Windows 快捷方式原子属独立未来工作，依赖
倒置）；方案 B = Shell_NotifyIcon(NIF_INFO) 经 **broker 内部桥**（命令 envelope 到达 broker 后由
core 的托盘图标持有者执行 NIF_MODIFY 设 NIF_INFO——不新增窗口、不新增身份原子、复用既有
`(HWND, uID)` 同一律）。**推荐 B**：零新增系统前提，代价是通知命令不走动态扩展 FFI 的一般路径而
由 broker 内建命令面承载——扩展 crate 仍存在（身份/manifest/DTO 一致性），win32 notify 命令在
broker 侧短路到托盘图标。若 Codex 否决 B，回退 A + win32 v1 typed unsupported。

## 3. 打包（引用归档 dialog §6/sound §3，不重复）

`packages/ext-notification/platforms/{darwin-arm64,darwin-x64}/libopentray_ext_notification.dylib`
+ `{win32-arm64,win32-x64}/opentray_ext_notification.dll`；embedded kind；contract.json =
`{"extensionName":"notification","contractFingerprint":"opentray-ext-notification-contract-1"}`；
pack-size 同门（预计 <0.5 MiB，纯逻辑无大依赖）。

typed 错误码：`notification_platform_unsupported` / `notification_denied` /
`notification_payload_invalid`（title 空/超长——上限冻结 256 字符；body 上限 4096）。

## 4. 线程与依赖

- darwin：UNUserNotificationCenter 请求与投递经 owner 线程（winit 串行化；objc2
  UserNotifications 绑定，零 raw msgSend）；授权状态读取异步回调经有界等待或 EventPort latest-state
  ——**裁决**：v1 用 bounded 同步等待（xhigh 风险点，Codex 审）还是把 getAuthorizationStatus
  也做成 Immediate + 内部信号量？
- win32：Shell_NotifyIcon 在 owner 线程（与托盘注册同一线程律）。
- 无 TCC 新增（通知授权走 UserNotifications 自身机制，非 TCC 弹窗）。

## 5. 测试策略

- TS 确定性（vitest Node+Bun）：preflight 矩阵（空 title/超长/未知字段）、错误码 details、
  getBackend 冻结快照 + **ABI 形状往返夹具（`{type:"backend"}` 法则）**、embedded 描述符。
- 原生：darwin 授权状态机 fake（UNUserNotificationCenter 无法在 CI 无头环境弹授权——用
  预授权 runner 或 seam 化授权读取）；win32 NIF_INFO 命令面 seam 断言（spy Shell_NotifyIconW）。
- 真机验收（双平台）：notify 受理 + 系统通知实际出现（人工/截图取证，可闻性不作门）；
  denied 路径 typed 错误；silent 位投影证据。
- 真实 pack 证据：泛化 embedded 管线自动覆盖（零新增脚本）。
