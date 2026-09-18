# add-ext-notification — Tasks（implementation complete; release evidence in flight）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计、V2 Immediate/Deferred 命令 ABI、typed 错误码 details 对象）复用
> `add-ext-dialog`/`add-ext-sound` 归档成果。
> 评审记录：design R2 GO 9.0；O1 裁决 = B（win32 notify 走 broker 组合层托盘图标桥
> Shell_NotifyIconW NIF_INFO，非 WinRT Toast/AUMID）；O2 裁决 = deferred 授权复用
> ExtCommandDispositionV1::deferred(handle)，无新 ABI 符号，10s 超时 + one-shot CAS +
> dispatch2 主线程跳；UTF-16 载荷上限冻结 64/256/64（title/body/subtitle，win32
> NOTIFYICONDATAW 物理上限为跨平台契约）；win32 subtitle 拼接 = em-dash
> `${subtitle}—${body}`（facade 与 crate 字节一致）。

## 1. Alignment

- [x] 1.1 plan 索引与 design-reference 一致；validate 通过；O1/O2 裁决回写后实现冻结。
  - 证据：cc6ec121 同步冻结 SSOT；R2 GO 9.0；`openspec:vision validate add-ext-notification` valid（2026-09-18 复验）。

## 2. BDD Contract

- [x] 2.1 `@opentray/spec`：NotificationAuthorizationStatus、NotifyOptions（上限按冻结 64/256/64，非草稿期 256/4096）、NotificationBackendCapabilities、typed 错误码三枚 details 判别联合；单测。
  - 证据：ce3d2f41（NOTIFICATION_TITLE/BODY/SUBTITLE_LIMIT_UTF16 = 64/256/64 冻结常量）；spec 套件绿。

## 3. Implementation — 批次 B（crates/opentray-ext-notification）

- [x] 3.1 darwin：UNUserNotificationCenter 授权读取/请求与投递（title/body/subtitle；silent 投影），owner 线程（objc2 UserNotifications，零 raw msgSend）；授权查询 Immediate + 请求走 deferred 事务（O2 裁决）。
  - 证据：48cda22d + 0e6055b8（auth.rs deferred 事务引擎：OwnerExecutor/AuthQueryChannel/PostSink/TerminalSink seams；fake 授权状态机 runner）；darwin 34/34×5。
- [x] 3.2 win32：按 O1=B 裁决——授权面 transport-agnostic 恒可用查询 + notify 为 payload 校验后诚实 typed broker-bridge 拒绝（本 crate 不做静默 no-op）；气球投递由 broker 组合层桥承载（见 opentray-bin）。
  - 证据：48cda22d；win32 auth-only 腿 + spy；Windows 真机 31/31（dead-code 清理 78750e9f 后 0 警告）。
- [x] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture。
  - 证据：exhaustive fixture 绿；x86_64+aarch64 msvc 交叉 0 warning（含 --tests）。

## 4. Implementation — 批次 C（packages/ext-notification facade）

- [x] 4.1 attachNotification → capability；异步冻结 getBackend；contract.json（fingerprint opentray-ext-notification-contract-1）；embedded 描述符。
  - 证据：216d5a79；无同步 backend 属性 + 快照冻结断言绿。
- [x] 4.2 facade preflight：payload 矩阵（空 title / 超长 title>64 / 超长 body>256 / 超长 subtitle>64 / 拼接超限 → typed `notification_payload_invalid`，零 broker 帧）；Linux typed unsupported（零帧）。
  - 证据：preflight 全负例零 dispatch 断言绿（21/21×2）。
- [x] 4.3 vitest 确定性套件（Node + Bun）：preflight 矩阵 / 错误码 details / getBackend 冻结快照 / ABI 形状往返夹具（{type:"backend"}）/ embedded 描述符 / em-dash subtitle 拼接字节一致。
  - 证据：21/21 Node + Bun。

## 5. Packaging — 批次 D

- [x] 5.1 native-build-graph 注册 notification component + 矩阵（34 jobs、5 embedded 包）；files 收口；pack-size 接入。
  - 证据：ce3d2f41；真实 tgz stat/digest + 解包逐 target identity 由本 PR 的 pack-size 审计与 native artifact CI 产出（run id 于合并前回填）。

## 6. Verification

- [x] 6.1（命令面腿）双平台命令面/授权面/payload 矩阵/DTO：darwin 34/34×5（含 ABI 往返与 ERROR_SLOT 互斥）；Windows 真机 31/31（auth-only 腿 + spy）；win32 气球桥真通道证据见 opentray-bin 137 darwin / 122 Windows（HOST_CAPABILITY_ROUTES + 托盘桥 + grep-gate）。getBackend DTO 双平台构造器 fixture 冻结。
  - （GUI 腿）通知横幅实际出现 / darwin 授权弹窗首次出现 / 气球外观（Win10 前经典样式）属交互面，列 Owner 真机清单；命令受理与 typed 载荷已由探针/测试面覆盖。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check + 真实 pack 证据。
  - 待本 PR CI run（含 workspace-verify 门）全绿后回填链接。

## 7. Release

- [x] 7.1 AGENTS.md Host Atom Extension Law 章落档（授权模型矩阵、O1=B 桥路径、64/256/64 冻结上限、em-dash 拼接律、deferred 授权事务复用律）。
  - 证据：edd516bd。
- [x] 7.2 skills/opentray references/ext-notification.md + README（五要件：安装/完整 API/错误码 details/平台降级矩阵/最小示例）。
  - 证据：a5e2b3ef；五要件自检 d5559a37。
- [x] 7.3 self-review + check ok:true + Codex 复核至 GO（含 O1/O2 落档核验）。
  - 证据：self-review 终稿（I3a/I3b/I4 复核轮记录）；vision check ok:true；O1/O2 裁决 R2 已核；I4 终裁实现分 **9.2**（R2 9.0），release GO 无阻塞。
- [x] 7.4 changeset（minor）。
  - 证据：.changeset/nine-otters-host.md。

## archive-completeness

- [ ] O1/O2 裁决已回写（R2 已核）；specs delta 合入 openspec/specs/notification-extension/；tasks 证据齐备；review/state.json 终态；changeset 发布；无遗留开放问题。
