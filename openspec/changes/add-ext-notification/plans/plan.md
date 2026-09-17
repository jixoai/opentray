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
> **Codex 评审 pending**——对抗点为 O1（win32 路径 A/B）与 O2（getAuthorizationStatus
> 同步性），裁决回写前不冻结。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-notification` 一个包即得：`notify({ title, body?, subtitle?, silent? })` 系统通知——darwin 经 UNUserNotificationCenter 真投递，win32 经本 caller 已注册托盘图标的气泡/Toast 通道；`getAuthorizationStatus` / `requestAuthorization` 授权面（darwin 实义；win32 恒 granted / 恒 true，文档化降级）。
- `notify` 为 resolve-on-acceptance（与 sound 同律）：原生受理即 resolve；用户是否看到/何时看到不属于受理语义。
- denied 下 `notify` → typed `notification_denied`；空/超限 payload（title 上限 256、body 上限 4096）→ typed `notification_payload_invalid`。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），预计 <0.5 MiB（纯逻辑无大依赖），远低于 2MB 警告线。
- Linux 调用得到 typed `notification_platform_unsupported`，不触碰 broker。
- skills/opentray 公共文档随包同步交付：其它 AI 仅凭文档（安装 / API 面 / 错误码 / 平台降级 / 最小可运行示例）能写出正确的 notification 消费代码。

## 调研事实（API 层面，实现批核验补锚点）

- darwin：UNUserNotificationCenter（UserNotifications 框架）是标准通知面——UNMutableNotificationContent title/body/subtitle；授权模型 granted/denied/notDetermined；denied 下投递被系统拒绝；notDetermined 首次投递由系统隐式发起授权弹窗；通知中心留存由系统策略管理；须 owner 线程取用；bundle identity 前提由 caller-specific Darwin carrier 现有法则天然满足。
- darwin 绑定路径：objc2 UserNotifications 绑定，零 raw msgSend；无 TCC 新增（通知授权走 UserNotifications 自身机制，非 TCC 弹窗）。
- win32：`Shell_NotifyIcon(NIF_INFO)` 是托盘图标的气泡/Toast 通道——balloons 在 Win10+ 自动升级为 Toast 渲染；无独立静默位（`NIIF_NOSOUND` 投影 silent）；无行动按钮、时长由系统策略、Win10 之前为经典气泡。OpenTray 本就是托盘平台——每个 consumer 必然已注册图标（core 持有 `(HWND, uID)`），无需 AUMID/快捷方式原子。
- 方案 A（WinRT Toast）需 AUMID 注册原子——App Launch Command Law 已判定 Windows 快捷方式/launcher 原子属独立未来工作（对本 change 构成依赖倒置）。
- 与 dialog/sound 同族：`tray.extend` 家族、session-scoped、单会话运行时；通知命令非模态、不阻塞 owner loop（无 DeferredOperation 需求——V2 Immediate ABI 直达；v1 无 EventPort 事件）。

## 决策（D1–D6；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-notification`，crate `crates/opentray-ext-notification`，embedded 单包内嵌四目标（复用 dialog/sound 归档基建，不重复建设，**无依赖门**） | 同族框架已归档落地；体积规范（2026-09-16）；纯逻辑预计 <0.5 MiB |
| D2 | 能力面 = `notify(NotifyOptions)` + `getAuthorizationStatus()` + `requestAuthorization()` + `getBackend()` 异步冻结快照；notify resolve-on-acceptance | design §1；受理语义与 sound 同律 |
| D3 | 授权模型 = darwin 实义（denied 下 notify → typed `notification_denied`；notDetermined 首次 notify 系统隐式弹窗，文档化）；win32 无授权概念——恒 granted / requestAuthorization 恒 true（文档化降级，非错误） | design §2 授权行 |
| D4 | 平台投影 = darwin UNUserNotificationCenter（owner 线程；carrier bundle identity 现有法则）；win32 `Shell_NotifyIcon(NIF_INFO)` 复用本 caller 已注册托盘图标——**推荐 B**：broker 内部桥（`NIF_MODIFY` 设 `NIF_INFO`，复用 `(HWND, uID)` 同一律，零新增窗口/身份原子；扩展 crate 仍在，身份/manifest/DTO 一致，win32 notify 命令 broker 侧短路到托盘图标） | design §2；A/B 裁决见开放问题 O1 |
| D5 | payload 冻结 = title 必填非空上限 256；body 上限 4096；subtitle darwin 投影 / win32 文档化降级（拼入 body 前缀）；silent 默认 false（平台默认提示音）、true 静默（win32 `NIIF_NOSOUND`）；违规 → typed `notification_payload_invalid`；v1 无平台特供命名空间 | design §1/§3 |
| D6 | 流程：单 change，批次 A（spec 类型）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验收 + 文档 + changeset） | sound 同款编排 |

## 开放问题（Codex 对抗中——裁决回写前不冻结）

| 问题 | 状态 |
|------|------|
| O1 win32 通知路径 A/B | **推荐 B**（Shell_NotifyIcon NIF_INFO 经 broker 内部桥：零新增系统前提；扩展 crate 身份/manifest/DTO 保留，win32 notify 命令 broker 侧短路到托盘图标）。若 Codex 否决 B → 回退 A + win32 v1 typed `notification_platform_unsupported`（AUMID 注册原子属独立未来工作，依赖倒置）。**Codex-pending** |
| O2 getAuthorizationStatus 同步性 | v1 候选：bounded 同步等待（xhigh 风险点）vs Immediate + 内部信号量——公共 Promise 面不变，内部机制以 Codex 裁决为准。**Codex-pending** |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 通知激活/点击事件（EventPort producer） | 需求未证实；v1 无事件面（design §0 不做清单） |
| 行动按钮与内联回复、分组与角标进度、富媒体附件 | 超出 OS 标准通知原子范围 |
| 自定义声音 | 平台默认提示音 + silent 开关已覆盖；自定义声音不做 |
| Linux 原生 | typed `notification_platform_unsupported`（与 dialog/sound 同律） |
| 平台特供选项命名空间（v1） | design §1：无任何选项字段透传平台特供命名空间 |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 通知类型（NotificationAuthorizationStatus、NotifyOptions、NotificationBackendCapabilities、typed 错误码三枚 details 判别联合）——embedded artifact kind 与 pack-size 审计**直接复用 dialog/sound 归档基建，无依赖门**。
2. 批次 B：crates/opentray-ext-notification——darwin（UNUserNotificationCenter 授权 + 投递，owner 线程）+ win32（按 O1 裁决：B = broker 内部桥 NIF_INFO；否决则 win32 v1 typed unsupported 腿）。
3. 批次 C：packages/ext-notification facade（attachNotification、preflight 矩阵、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 接入 + 真实体积实测。
5. 批次 E：双平台真机验证（notify 受理 + 系统通知实际出现，人工/截图取证，可闻性不作门；denied 路径；silent 位投影证据）+ skills 公共文档（一等任务，见 tasks 7.2）+ changeset（minor）。
