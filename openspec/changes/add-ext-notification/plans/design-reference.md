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

**payload 边界（冻结；UTF-16 码元计数；facade preflight 强制）**：title ≤ 64、body ≤ 256、
subtitle ≤ 64——取 win32 `NOTIFYICONDATAW.szInfoTitle`/`szInfo` 的物理容量（64/256 UTF-16）
为**平台无关共同契约**（同契约跨平台一致优于按平台分立上限）；超限 → typed
`notification_payload_invalid`（details: field, lengthUtf16, limit）。win32 subtitle 降级拼入
body 时按**拼接后 ≤ 256 联合校验**（超限同样 typed 拒绝，绝不静默截断）。

## 2. 平台投影

| 维度 | darwin | win32 |
|---|---|---|
| 机制 | UNUserNotificationCenter（UserNotifications 框架） | **Shell_NotifyIcon(NIF_INFO)**：复用本 caller 已注册的托盘图标的气泡/Toast 通道 |
| 前提 | 调用方 Darwin carrier `.app` 提供 bundle identity（现有法则：caller-specific carrier 天然满足）；UNUserNotificationCenter 须 owner 线程取用 | 托盘图标已由 core 注册（OpenTray 本就是托盘平台——每个 consumer 必然有图标）；无需 AUMID/快捷方式原子 |
| 授权 | getAuthorizationStatus/requestAuthorization 实义；denied 下 notify → typed `notification_denied` | 无授权概念：恒 granted（文档化降级） |
| title/body | UNMutableNotificationContent title/body/subtitle | szInfo/szInfoTitle（ balloons 在 Win10+ 自动升级为 Toast 渲染） |
| silent | 默认声音 = 系统默认；true 则不设声音标志 | NIF_INFO 无独立静默位：true 时以 NIIF_NOSOUND 投影 |
| 已知限制（文档化降级） | 无 delegate（v1 无事件）；通知中心留存由系统策略管理 | 无行动按钮；时长由系统策略；Win10 之前为经典气泡 |

**win32 路径裁决（Codex R1 已裁：B，冻结）**：notify 经 **broker 内部托盘通知桥**执行——
win32 上 notify 命令 envelope 到达 broker 后，由 **composition 层的通用 tray-notification
capability**（broker 侧；opentray-core 不得出现 `ext=="notification"` 特判）对该命令 envelope
携带的 `(appId, trayId, sessionId, instanceGeneration)` scope 所绑定的**已注册托盘图标**执行
`Shell_NotifyIconW(NIM_MODIFY, NIF_INFO)`——不新增窗口、不新增身份原子、复用既有 `(HWND, uID)`
同一律。冻结细则：
- 扩展 crate `opentray-ext-notification` 在 win32 目标**仍然构建与加载**（manifest/身份/
  getBackend DTO 走通用 FFI 路径），仅 `notify` 在 broker 命令面被路由到桥——路由判据是
  envelope 的能力词经 composition 层通用 capability 表，不是扩展名硬编码。
- 桥的错误映射（typed，details 对象）：托盘图标缺失/未注册 → `notification_tray_absent`；
  `Shell_NotifyIconW` 返回失败 → `notification_failed`（details 含 win32 错误码）。
- 身份绑定：桥只操作**同一 scope 会话已注册**的托盘图标（跨 app/session 不可达）；多 mount
  共用同一图标通道——后到通知替换前到（win32 单气泡位，文档化降级）。
- 未来 WinRT Toast 演进只替换 projection 层；facade wire 契约、manifest/DTO、错误模型不变。

## 3. 打包（引用归档 dialog §6/sound §3，不重复）

`packages/ext-notification/platforms/{darwin-arm64,darwin-x64}/libopentray_ext_notification.dylib`
+ `{win32-arm64,win32-x64}/opentray_ext_notification.dll`；embedded kind；contract.json =
`{"extensionName":"notification","contractFingerprint":"opentray-ext-notification-contract-1"}`；
pack-size 同门（预计 <0.5 MiB，纯逻辑无大依赖）。

**DTO（冻结 schema；@opentray/spec 与 opentray-spec 双侧同构 + exhaustive fixture）**：

```ts
export interface NotificationBackendCapabilities {
  platform: 'darwin' | 'win32';
  authorizationModel: 'user' | 'always-granted';            // darwin='user'; win32='always-granted'
  channel: 'user-notification-center' | 'tray-icon-info';   // 平台投影通道（诊断只读）
  titleLimitUtf16: 64;   // 平台无关契约常量（与 payload 边界同源）
  bodyLimitUtf16: 256;
  subtitleLimitUtf16: 64;
  supportsSubtitle: boolean;                                 // win32=false（降级拼接）
}
```

typed 错误码：`notification_platform_unsupported` / `notification_denied`（details: status）/
`notification_payload_invalid`（details: field, lengthUtf16, limit）/
`notification_tray_absent`（win32 桥：scope 无已注册图标）/ `notification_failed`
（details: reason 或 OS 错误码；含授权查询 10s 超时 reason:"authorization-timeout"）。

## 4. 线程与依赖（O2 裁决冻结：内部信号/事件，禁同步等待）

- darwin：UNUserNotificationCenter 授权读取/请求 = 异步回调 → **回调经主线程 dispatch 唤醒
  owner loop → 一次性完成事务**。通道形态：**复用既有 DeferredOperation 事务与完成端口**——
  `getAuthorizationStatus`/`requestAuthorization` 命令返回
  `ExtCommandDispositionV1::deferred(handle)`（不新增 ABI 符号；这是 deferred 基建的首个
  非模态用例），授权回调到达后经既有 terminal 通道交付。超时冻结 **10s** → typed
  `notification_failed`（reason:"authorization-timeout"）；session close 复用注册表 session 键
  清除律撤销在途回调（terminal 为 cancel 分支）。win32 上两命令恒 Immediate（恒 granted），
  零 deferred 帧。
- **denied 线性化**：`notify` 受理判定 = 授权状态 + 投递受理在同一 owner-loop 帧内序贯判定
  （状态查询不占用 10s 预算——darwin 上 UNUserNotificationCenter 的同步
  getNotificationSettings 亦为回调制，故 `notify` 的受理采用**缓存的最近一次授权快照**：
  首次无缓存时先经 deferred 查询（10s 预算内）再投递；后续 notify 复用快照并在 typed 错误与
  后端日志中注明快照来源——绝不静默丢弃）。
- 状态缓存键 = `(appId, trayId, sessionId, instanceGeneration)`；缓存不作跨会话信任。
- win32：Shell_NotifyIconW 在 owner 线程（与托盘注册同一线程律）；无授权异步面。
- 无 TCC 新增（通知授权走 UserNotifications 自身机制，非 TCC 弹窗）。

## 5. 测试策略

- TS 确定性（vitest Node+Bun）：preflight 矩阵（空 title/UTF-16 边界 64·256·64/拼接超限/
  未知字段）、错误码 details、getBackend 冻结快照 + **ABI 形状往返夹具（`{type:"backend"}` 法则）**、
  DTO exhaustive fixture 双平台构造器、embedded 描述符。
- 原生（darwin）：授权状态机 fake 全族——granted/denied/notDetermined、延迟回调、**永不回调
  → 10s 超时 typed**、session close 撤销在途（terminal cancel 分支恰一次）；notify 快照
  线性化（denied 快照 → typed 拒绝且零投递调用——spy 断言）。
- 原生（win32）：桥 seam——spy `Shell_NotifyIconW` 参数形态（NIF_INFO/NIIF_NOSOUND、UTF-16
  边界值恰填满不溢出）；托盘图标缺失 → `notification_tray_absent`；多 mount 后到替换前到；
  授权命令 Immediate 恒 granted 零 deferred 帧。
- owner-loop 非阻塞：全命令断言派发零阻塞步（无 >1ms）。
- 真机验收（双平台）：notify 受理 + 系统通知出现（人工/截图取证，可闻性不作门）；denied 路径
  typed；silent 位投影证据；win32 气泡/Toast 渲染形态记录。
- 真实 pack 证据：泛化 embedded 管线自动覆盖（零新增脚本）。
