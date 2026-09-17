# add-ext-notification — Intent Document (SSOT)

> 原始需求（Owner，2026-09-18）：
> 1. 「继续持续迭代…直到 notification/clipboard/opener 等工作全部完成。」
> 2. 「确保同步更新 skills 文档…其它 AI 能通过文档写出正确的代码。」
>
> 用户语言系统：**「能力原子」「host 侧发起」「其它 AI 能通过文档写出正确的代码」**。
> 关联 change：`add-ext-dialog` / `add-ext-sound`（同族已归档——embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象等共享基建**直接复用，
> 无依赖门**）；同波 sibling：`add-ext-clipboard`、`add-ext-opener`。
> 评审记录：design draft（`plans/design-reference.md` 为规范附录，实现以它为准）；
> **Codex R1 已裁并回写冻结**（commit c5f9cd99）——O1（win32 路径）裁 B：broker 内部
> 托盘通知桥；O2（授权异步性）裁：复用 DeferredOperation 事务，禁 owner-loop 同步等待；
> 裁决全文见 design-reference §2/§4，开放问题已清零。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-notification` 一个包即得：`notify({ title, body?, subtitle?, silent? })` 系统通知——darwin 经 UNUserNotificationCenter 真投递，win32 经本 caller 已注册托盘图标的气泡/Toast 通道；`getAuthorizationStatus` / `requestAuthorization` 授权面（darwin 实义；win32 恒 granted / 恒 true，文档化降级）。
- `notify` 为 resolve-on-acceptance（与 sound 同律）：原生受理即 resolve；用户是否看到/何时看到不属于受理语义。
- denied 下 `notify` → typed `notification_denied`；payload 冻结边界（UTF-16 码元计数）：title ≤ 64、body ≤ 256、subtitle ≤ 64——平台无关共同契约（win32 subtitle 降级拼接后按 ≤ 256 联合校验），超限 → typed `notification_payload_invalid`，绝不静默截断；win32 桥错误面：`notification_tray_absent` / `notification_failed`。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），预计 <0.5 MiB（纯逻辑无大依赖），远低于 2MB 警告线。
- Linux 调用得到 typed `notification_platform_unsupported`，不触碰 broker。
- skills/opentray 公共文档随包同步交付：其它 AI 仅凭文档（安装 / API 面 / 错误码 / 平台降级 / 最小可运行示例）能写出正确的 notification 消费代码。

## 调研事实（API 层面，实现批核验补锚点）

- darwin：UNUserNotificationCenter（UserNotifications 框架）是标准通知面——UNMutableNotificationContent title/body/subtitle；授权模型 granted/denied/notDetermined；denied 下投递被系统拒绝；notDetermined 首次投递由系统隐式发起授权弹窗；通知中心留存由系统策略管理；须 owner 线程取用；bundle identity 前提由 caller-specific Darwin carrier 现有法则天然满足。
- darwin 绑定路径：objc2 UserNotifications 绑定，零 raw msgSend；无 TCC 新增（通知授权走 UserNotifications 自身机制，非 TCC 弹窗）。
- win32：`Shell_NotifyIcon(NIF_INFO)` 是托盘图标的气泡/Toast 通道——balloons 在 Win10+ 自动升级为 Toast 渲染；无独立静默位（`NIIF_NOSOUND` 投影 silent）；无行动按钮、时长由系统策略、Win10 之前为经典气泡。OpenTray 本就是托盘平台——每个 consumer 必然已注册图标（core 持有 `(HWND, uID)`），无需 AUMID/快捷方式原子。
- 方案 A（WinRT Toast）需 AUMID 注册原子——App Launch Command Law 已判定 Windows 快捷方式/launcher 原子属独立未来工作（对本 change 构成依赖倒置）。
- 与 dialog/sound 同族：`tray.extend` 家族、session-scoped、单会话运行时；`notify` 非模态、V2 Immediate ABI 直达；darwin 授权读取/请求为异步回调，经既有 DeferredOperation 事务完成（O2 裁决：不新增 ABI 符号、禁 owner-loop 同步等待）；v1 无 EventPort 事件。

## 决策（D1–D6；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-notification`，crate `crates/opentray-ext-notification`，embedded 单包内嵌四目标（复用 dialog/sound 归档基建，不重复建设，**无依赖门**） | 同族框架已归档落地；体积规范（2026-09-16）；纯逻辑预计 <0.5 MiB |
| D2 | 能力面 = `notify(NotifyOptions)` + `getAuthorizationStatus()` + `requestAuthorization()` + `getBackend()` 异步冻结快照；notify resolve-on-acceptance | design §1；受理语义与 sound 同律 |
| D3 | 授权模型 = darwin 实义（denied 下 notify → typed `notification_denied`；notDetermined 首次 notify 系统隐式弹窗，文档化）；win32 无授权概念——恒 granted / requestAuthorization 恒 true（文档化降级，非错误） | design §2 授权行 |
| D4 | 平台投影 = darwin UNUserNotificationCenter（owner 线程；carrier bundle identity 现有法则）；win32 `Shell_NotifyIcon(NIF_INFO)` 复用本 caller 已注册托盘图标——**O1 已裁 B（冻结）**：broker 内部托盘通知桥（`NIF_MODIFY` 设 `NIF_INFO`，复用 `(HWND, uID)` 同一律，零新增窗口/身份原子）；路由判据 = composition 层通用 capability 表按能力词路由（opentray-core 不得出现 `ext=="notification"` 特判）；扩展 crate 在 win32 仍构建加载（身份/manifest/DTO 走通用 FFI 路径）；桥错误映射 `notification_tray_absent`/`notification_failed`；scope 绑定同会话已注册图标（跨 app/session 不可达）；多 mount 后到替换前到（文档化降级）；WinRT Toast 仅作未来 projection 层替换（wire 契约/manifest/DTO/错误模型不变） | design §2（Codex R1 O1=B 冻结） |
| D5 | payload 冻结 = UTF-16 码元 title 必填非空 ≤ 64、body ≤ 256、subtitle ≤ 64（取 win32 szInfoTitle/szInfo 物理容量为平台无关共同契约，同契约跨平台一致优于按平台分立上限）；win32 subtitle 降级拼接后 ≤ 256 联合校验，超限 typed 拒绝、绝不静默截断；silent 默认 false（平台默认提示音）、true 静默（win32 `NIIF_NOSOUND`）；违规 → typed `notification_payload_invalid`（details: field, lengthUtf16, limit）；v1 无平台特供命名空间；DTO 冻结 schema = platform / authorizationModel / channel / titleLimitUtf16(64) / bodyLimitUtf16(256) / subtitleLimitUtf16(64) / supportsSubtitle | design §1/§3 |
| D6 | 流程：单 change，批次 A（spec 类型）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验收 + 文档 + changeset） | sound 同款编排 |

## 开放问题（无——Codex R1 裁决已回写冻结）

| 问题 | 状态 |
|------|------|
| O1 win32 通知路径 A/B | **已裁 B（冻结）**：notify 经 broker 内部托盘通知桥——composition 层通用 tray-notification capability 按能力词路由（非扩展名硬编码），对 envelope scope `(appId, trayId, sessionId, instanceGeneration)` 所绑定的已注册托盘图标执行 `Shell_NotifyIconW(NIM_MODIFY, NIF_INFO)`；错误映射 `notification_tray_absent`（图标缺失/未注册）/ `notification_failed`（Shell 失败，details 含 win32 错误码）；scope 内图标跨 app/session 不可达；多 mount 后到替换前到（文档化降级）；WinRT Toast = projection-only 未来演进（wire 契约/manifest/DTO/错误模型不变） |
| O2 getAuthorizationStatus 同步性 | **已裁（冻结）：复用 DeferredOperation 事务，禁同步等待**——`getAuthorizationStatus`/`requestAuthorization` 返回 `ExtCommandDispositionV1::deferred(handle)`（不新增 ABI 符号；deferred 基建首个非模态用例），回调经主线程 dispatch 唤醒 owner loop 一次性完成事务；超时 10s → typed `notification_failed`（reason:"authorization-timeout"）；session close 经注册表 session 键清除律撤销在途回调（terminal cancel 分支）；win32 两命令恒 Immediate（零 deferred 帧）；denied 线性化 = 授权快照 + 投递受理同一 owner-loop 帧序贯判定（缓存快照复用，typed 错误与后端日志注明快照来源，绝不静默丢弃） |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 通知激活/点击事件（EventPort producer） | 需求未证实；v1 无事件面（design §0 不做清单） |
| 行动按钮与内联回复、分组与角标进度、富媒体附件 | 超出 OS 标准通知原子范围 |
| 自定义声音 | 平台默认提示音 + silent 开关已覆盖；自定义声音不做 |
| Linux 原生 | typed `notification_platform_unsupported`（与 dialog/sound 同律） |
| 平台特供选项命名空间（v1） | design §1：无任何选项字段透传平台特供命名空间 |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 通知类型（NotificationAuthorizationStatus、NotifyOptions、NotificationBackendCapabilities 冻结 schema、typed 错误码五枚 details 判别联合：`notification_platform_unsupported` / `notification_denied` / `notification_payload_invalid` / `notification_tray_absent` / `notification_failed`）——embedded artifact kind 与 pack-size 审计**直接复用 dialog/sound 归档基建，无依赖门**。
2. 批次 B：crates/opentray-ext-notification——darwin（UNUserNotificationCenter 授权 + 投递，owner 线程；授权命令经 DeferredOperation 事务 + 10s 超时 + session-close 撤销；denied 快照线性化）+ win32（O1=B 冻结：broker 内部托盘通知桥 NIF_INFO，composition 层 capability 表路由；扩展 crate 身份/manifest/DTO 照常构建加载）。
3. 批次 C：packages/ext-notification facade（attachNotification、preflight 矩阵、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 接入 + 真实体积实测。
5. 批次 E：双平台真机验证（notify 受理 + 系统通知实际出现，人工/截图取证，可闻性不作门；denied 路径；silent 位投影证据）+ skills 公共文档（一等任务，见 tasks 7.2）+ changeset（minor）。
