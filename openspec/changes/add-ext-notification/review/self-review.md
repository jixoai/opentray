# add-ext-notification — Self-Review（实现阶段）

> 评审人：编排者。对象：实现（facade + shared schema + 原生 crate + broker 桥 + 打包）。
> 性质：**实现自评**——Codex 实现复核待进行（pending），本档不代勾。

## 总判定

实现落地：`@opentray/spec` 冻结 schema（`NotificationBackendCapabilities` DTO、
64/256/64 UTF-16 界限、五码错误族）、facade
`packages/ext-notification/src/{index,shared}.ts`（payload preflight 矩阵 +
win32 subtitle 拼接 + transport 无关授权结算）、原生 crate
`crates/opentray-ext-notification`（darwin UNUserNotificationCenter + DeferredOperation
授权事务/10s 超时/一次性 CAS；win32 恒 granted Immediate）、broker 组合层
`crates/opentray-bin/src/{host_capabilities,tray_notification}.rs`
（通用 capability 表路由 + 托盘图标 NIF_INFO 桥）、embedded 打包（四目标 +
contract.json）。

## 冻结契约自查（对照 design-reference）

- resolve-on-acceptance；payload 界限 64/256/64 为平台无关共同契约（UTF-16 码元，
  facade preflight，绝不静默截断）；win32 subtitle 降级为
  `subtitle + "—" + body`（em dash、无空格；无 body 时 subtitle 独立成文），
  拼接后 ≤256 联合校验。未知 NotifyOptions 字段 → typed
  `notification_payload_invalid` `{field}`（非 TypeError）。
- win32 桥（O1=B 冻结）：notify 经 broker 组合层通用 capability 表（静态数据条目，
  匹配器零字面量；注册即追加）路由到已注册托盘图标的
  `Shell_NotifyIconW(NIM_MODIFY, NIF_INFO)` 通道（复用 `(HWND, uID)`，无新窗口/
  身份原子）；图标缺失 → `notification_tray_absent`；原生 FALSE →
  `notification_failed`（win32 错误码）；单气泡位后到替换前到；silent →
  `NIIF_NOSOUND`。opentray-core 零能力词特判（core-neutrality grep 门）。
- darwin 授权 = DeferredOperation 复用（首个非模态用例，零新 ABI 符号）：回调主线程
  hop 唤醒 owner loop；10s 超时 → `notification_failed`
  （`reason:"authorization-timeout"`）；outcome/timeout/session-close cancel 三路
  一次性 CAS 终帧。win32 两授权命令恒 Immediate（granted/true，零 deferred 帧）；
  facade 两种结算形状通吃。
- denied 线性化：notify 受理在单 owner-loop 帧内对照缓存最近授权快照（键 =
  `(appId, trayId, sessionId, instanceGeneration)`）；denied 快照 → typed
  `notification_denied` `{status}` 且零投递；首帧无快照先在 10s 预算内查询再投递；
  快照不作跨会话信任，session close 清除。
- Linux typed 拒、零 broker 帧；未知 attach 选项字段 TypeError。

## 已知边界（诚实声明）

1. Codex 实现复核 **pending**——本档为编排者实现自评，无第三方对抗轮。
2. 双平台真机验收（通知出现/截图取证、denied 路径、win32 气泡/Toast 渲染形态）
   未收口。
3. tasks.md 尚未勾选（编排者收口时统一处理）。

## Git 证据

- 本档（docs 波）之前：实现 commits 见 `git log --oneline -- packages/ext-notification crates/opentray-ext-notification crates/opentray-bin/src/host_capabilities.rs crates/opentray-bin/src/tray_notification.rs packages/spec`。
- verify:spec-consistency / vision-driven test：docs 波后重跑（见 change 收口记录）。
