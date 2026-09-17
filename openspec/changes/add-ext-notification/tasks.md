# add-ext-notification — Tasks（design draft）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate 命令 ABI、typed 错误码 details 对象）已随 `add-ext-dialog`
> 与 `add-ext-sound` 归档落地——**直接复用，无依赖门**。
> 评审记录：design draft，Codex 评审 pending——开放问题 O1（win32 路径 A/B）、O2
> （getAuthorizationStatus 同步性）以 Codex 裁决为准，裁决回写 plan/design 后 win32 腿
> 实现才冻结。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；O1/O2 的 Codex 裁决回写 plan/design 后实现批次冻结对应腿。
  - 证据要求：vision validate add-ext-notification ok；CI 接线复用泛化 embedded-packages 管线（dialog/sound 已绿路径零新增脚本）。

## 2. BDD Contract

- [ ] 2.1 `@opentray/spec`：NotificationAuthorizationStatus（`'granted' | 'denied' | 'notDetermined'`）、NotifyOptions（title 必填非空上限 256 / body 上限 4096 / subtitle / silent）、NotificationBackendCapabilities（共享 schema + exhaustive fixture）、typed 错误码三枚（`notification_platform_unsupported` / `notification_denied` / `notification_payload_invalid`）的 details 判别联合；单测。
  - 证据要求：spec 套件绿（Node + Bun 双跑）。

## 3. Implementation — 批次 B（crates/opentray-ext-notification）

- [ ] 3.1 darwin：UNUserNotificationCenter 授权读取/请求与投递（UNMutableNotificationContent title/body/subtitle；silent 位投影），owner 线程（objc2 UserNotifications 绑定，零 raw msgSend）；getAuthorizationStatus 同步性按 O2 裁决实现（bounded 同步等待或 Immediate + 内部信号量，公共 Promise 面不变）。
  - 证据要求：授权状态机 fake（预授权 runner 或 seam 化授权读取——UNUserNotificationCenter 无法在 CI 无头环境弹授权）。
- [ ] 3.2 win32：按 O1 裁决实现——B = broker 内部桥（`NIF_MODIFY` 设 `NIF_INFO` 复用本 caller 已注册 `(HWND, uID)` 托盘图标；`NIIF_NOSOUND` 投影 silent；szInfo/szInfoTitle 投影 title/body）；A 否决则 win32 v1 typed `notification_platform_unsupported` 腿；NIF_INFO 命令面 seam 断言（spy Shell_NotifyIconW）。
  - 证据要求：spy 断言零新增窗口/零新增身份原子；命令 envelope broker 侧短路路径有测试。
- [ ] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture 比对。
  - 证据要求：双平台构造器 exhaustive fixture 单测；交叉编译零 warning。

## 4. Implementation — 批次 C（packages/ext-notification facade）

- [ ] 4.1 `attachNotification(tray, options?)` → capability（tray.extend 家族同构）；**`getBackend(): Promise<...>` 异步冻结快照**（惰性加载后请求 DTO）；`contract.json`（extensionName "notification"、fingerprint `opentray-ext-notification-contract-1`）；embedded 描述符（复用 SDK 既有 kind）。
  - 证据要求：无同步 backend 属性；快照冻结断言。
- [ ] 4.2 facade preflight：payload 矩阵（空 title / 超长 title（>256）/ 超长 body（>4096）/ 未知字段 → typed `notification_payload_invalid`，零 broker 帧）、Linux typed unsupported（零 broker 帧）。
  - 证据要求：preflight 矩阵全负例断言零 dispatch。
- [ ] 4.3 vitest 确定性套件（Node + Bun）：preflight 矩阵 / 错误码 details / getBackend 冻结快照 + **ABI 形状往返夹具（`{type:"backend"}` 法则）** / embedded 描述符。
  - 证据要求：Node 与 Bun 双跑全绿。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `notification` component + 收齐矩阵（复用泛化 embedded-packages 管线）；package.json `files` 收口；pack-size 接入 + **真实体积实测报告**写入 evidence artifact（预计 <0.5 MiB，2MB 警告线内）。
  - 证据要求：真实 tgz stat/digest + 解包逐 target identity（含 sha256/buildIdentity 断言）。

## 6. Verification

- [ ] 6.1 双平台真机验收：notify 受理 + 系统通知实际出现（人工/截图取证，可闻性不作门）；denied 路径 typed `notification_denied`；silent 位投影证据（win32 `NIIF_NOSOUND` / darwin 不设声音标志）；授权面（darwin granted/denied/notDetermined；win32 恒 granted 文档化降级）；getBackend DTO 上报。
  - 证据要求：darwin（本机）+ Windows（honor 真机）双平台记录；证据落 evidence artifact。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；**真实 pack 证据**（共享 check-pack-size 脚本管线）。
  - 证据要求：CI run 全绿链接 + pack-size OK 输出。

## 7. Release

- [ ] 7.1 AGENTS.md Notification Extension Law 章提炼落档（resolve-on-acceptance、授权模型双平台矩阵（win32 恒 granted 降级）、win32 裁决后路径法则（B 桥或 typed unsupported 回退）、payload 冻结上限、owner 线程纪律）。
- [ ] 7.2 skills/opentray
  - 公共消费文档 `skills/opentray/references/ext-notification.md` + `packages/ext-notification/README`（内容源：design-reference + README； Owner 要求「其它 AI 能通过文档写出正确的代码」）。
  - **验收子项（一等任务，缺失即不通过）**：文档必须覆盖——① 安装（正常包管理器安装起点，无诊断步骤前置）；② 完整 API 面（attachNotification / notify / getAuthorizationStatus / requestAuthorization / getBackend 与 NotifyOptions 字段语义）；③ 全部 typed 错误码及 details 载荷；④ 平台降级矩阵（win32 无授权概念恒 granted、subtitle 拼入 body 前缀、无行动按钮、时长系统策略、Win10 前经典气泡；darwin notDetermined 首次 notify 隐式弹窗、通知中心留存归系统策略）；⑤ 一个可运行最小示例（copy-paste 即可跑通）。
- [ ] 7.3 self-review（md + html）+ check ok:true + Codex 复核至 GO（含 O1/O2 裁决落档核验）。
- [ ] 7.4 changeset（minor）。

## archive-completeness

- [ ] O1/O2 裁决已回写 plan/design-reference 并体现在最终 spec；specs delta 合入 `openspec/specs/notification-extension/`；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题。
