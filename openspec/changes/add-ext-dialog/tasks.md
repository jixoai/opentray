# add-ext-dialog — Tasks（R1 修订版）

> 规范附录：`plans/design-reference.md` 是实现准绳——deferred envelope 协议、双平台模态
> 拓扑、embedded containment、构建收齐矩阵、typed 错误 envelope 全部以其为准。
> 评审记录：R1 4.0/10 NO-GO（`.agents/review/2026-09-17-ext-dialog-sound-r1.md`）；
> 本版吸收 P0-1/2/3/5/6/7/8/9、P1-1/2/3/8 与 §4 裁决。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract — 批次 A（协议 + 共享基建）

- [ ] 2.1 `@opentray/spec`：deferred command envelope（`ExtCommandAccepted/Completed/Cancelled`）帧类型与状态机常量；命令作用域 `sessionId` 注入字段；typed 错误 envelope `{code, message, details}`（discriminated union）与全部 dialog 错误码；Dialog 命令/选项/结果类型（含命名空间、BackendCapabilities DTO——DTO schema 双侧共享 + exhaustive fixture）；单测。
- [ ] 2.2 broker（opentray-bin/core）：deferred 响应实现（exactly-once 结算、barrier 顺序、连接关闭 typed 拒绝）；`ExtCommand` 注入连接 session 的 sessionId；registry/实例状态键升级含 sessionId；Node/Bun transport 确定性测试（deferred 命令夹在两个普通命令之间完成且只结算一次）。
- [ ] 2.3 opentray SDK：`NativeExtensionEmbeddedArtifact`——containment 校验（canonicalize + relative 拒绝 `..`/绝对/symlink 逃逸）、四类结构化错误（`target-unsupported`/`path-outside-facade`/`manifest-invalid`/`library-unreadable`）、adversarial 四族测试（穿越/symlink/字节替换/manifest skew）。
- [ ] 2.4 `scripts/check-pack-size.mjs`：真实 `npm pack --dry-run` tarball 体积测量，≥2MB 警告、>3MB 失败；fixture 双臂单测。

## 3. Implementation — 批次 B（crates/opentray-ext-dialog）

- [ ] 3.1 macOS 原生 probe 前置（P0-3）：modal step / 普通 tray-menu frame / session close / broker exit 交错次序取证；未取得 probe 证据前不得展开普通实现勾选。
- [ ] 3.2 macOS：modal-session 步进状态机（`Created→Presented→Stepping→Dismissed|Revoked`；`EventLoopProxy<UserEvent::DialogWake/Close>` 唤醒；一次性 completion CAS；teardown 先 CAS 再 endModalSession）；NSAlert（suppression/severity/escape 映射 cancelId）/ NSOpenPanel / NSSavePanel。
- [ ] 3.3 win32：对话框专属 STA 线程（CoInitialize + 消息循环；输入经 owner loop 代理，结果 EventLoopProxy 回传；tray HWND 线程约束不破的时间线取证）；TaskDialogIndirect（broker EXE RT_MANIFEST 绑定 comctl6 + 启动能力探测 + MessageBox 兜底与 DTO 上报）/ IFileOpenDialog / IFileSaveDialog。
- [ ] 3.4 busy 原子占用（每 (appId,trayId,sessionId) 一个，第二个 typed `dialog_session_busy`）；session close 先撤销（`Cancelled`）再 cleanup；四路 dismissal（标题栏/ESC/系统关闭/session close）一致映射。
- [ ] 3.5 BackendCapabilities DTO 嵌入上报 + exhaustive serialization fixture（双 target CI 编译门）。

## 4. Implementation — 批次 C（packages/ext-dialog facade）

- [ ] 4.1 `attachDialog(tray, options?)` → capability（tray.extend 家族同构）；`contract.json`（extensionName "dialog"、fingerprint contract-1）；embedded 描述符。
- [ ] 4.2 facade preflight：Linux/命名空间 mismatch/未知字段/空 buttons/索引越界/路径类 typed 拒绝（状态变更前失败）；能力前置拒绝（comctl6 不可用时 commandLink → `dialog_capability_unavailable`）。
- [ ] 4.3 vitest 确定性套件（Node+Bun 双跑）：糖语义、dismissal 映射、cancel=null、命名空间矩阵、embedded 解析错误矩阵、typed 错误 wire round-trip + instanceof。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `dialog` component + 收齐矩阵（四目标全部匹配 facade version/contract 才写 `platforms/<target>/`，缺目标/过期/hash 不匹配即失败）；release-plan/verify-native-plan/stage-release-artifacts/release.yml 同步；broker EXE RT_MANIFEST（comctl6 依赖声明）。
- [ ] 5.2 CI：check-pack-size 接入（2MB warn / 3MB fail）+ **真实体积实测报告**（tarball 字节数/npm 版本/四目标清单+hash）写入 evidence artifact——无实测不给 packaging GO（R1 §4.5）。

## 6. Verification

- [ ] 6.1 双平台真机验收：每方法冒烟；**交错时间线取证**（对话框打开期间同 app 另一 tray 菜单、另一 app session 请求、普通 set-menu/ext-command 三类真实交错完成）；四路 dismissal 一致性；session close 撤销；busy typed；跨 session 并发；suppression 回传；commandLink/expander 真机截证（win）；同 app 双 session 隔离（P0-5 场景）。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；clean checkout release dry-run + `npm pack --dry-run` 解包逐目标 identity check。
- [ ] 6.3 self-review（md+html）+ check ok:true；Codex 复核轮（R2+）至 GO。

## 7. Release

- [ ] 7.1 AGENTS.md：Monorepo Law += 包体积门（Owner ruling 2026-09-16，首例 ext-dialog，已在工作树预落）；新章 Dialog Extension Law（design-reference §9 三条提炼）。
- [ ] 7.1b 同步 `.agents/skills/develop-opentray-ext`：Non-Negotiable「Do not ship one fat cross-platform native package」按体积门裁决修订为「≤3MB 内嵌合法，>3MB 必拆」，platform-packages.md 同步。
- [ ] 7.2 skills/opentray 公共消费文档（Documentation Ownership 法则）+ packages/ext-dialog/README。
- [ ] 7.3 changeset（minor）→ 合并 main → version → push → CI 全绿 → npm 上线（与 add-ext-sound 同波）。
