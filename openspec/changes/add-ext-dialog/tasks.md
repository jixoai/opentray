# add-ext-dialog — Tasks（R2 修订版）

> 规范附录：`plans/design-reference.md` 是实现准绳——DeferredOperation 主模型、
> DeferredCompletionPort/poll_owner ABI、per-owner STA worker、单会话运行时裁决、embedded
> 身份链、真实 pack 证据、TypedExtensionError + async getBackend 全部以其为准。
> 评审记录：R1 4.0 → R2 5.0（NO-GO）；本版吸收 R2 P0-1/2/3/5/6/7 与 P1-1/2/4/5。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract — 批次 A（协议 + 共享基建；独立可审单元）

- [ ] 2.1 `@opentray/spec` + opentray-spec：`ExtCommandAccepted`/`ExtOperationTerminal`（payload 恒带结果）全量 server frame 与 parser 真值；operation 归属 `(sessionId, instanceGeneration, operationId)`；`TypedExtensionError {code, message, details}` discriminated union（ServerFrame error 与 terminal 共用 JSON 形状；每个 dialog 错误码指定 detail variant）；`CommandScope` 注入；Dialog 命令/选项/结果类型 + BackendCapabilities 共享 schema + exhaustive fixture；protocol version 提升；单测（repr/schema 冻结）。
- [ ] 2.2 可选版本化 ABI 符号：`opentray_ext_attach_deferred_completion_port_v1`（EventPort 生命周期模式：immutable host 状态/version+struct_size/bounded-copy submit/CLOSED+INVALID_HANDLE+OVERSIZED 返回码/LoadExt ACK 后打开/清理前 revoke）+ **`poll_owner(operation) -> Done | Pending{next_deadline, wake_reason}`**（owner-loop 调度器：合并 DialogPollDue(generation)、WaitUntil(min deadline)、每迭代 ≤4 owner × 1 步进配额）；opentray-spec 常量与 stub FFI 决策表测试（同 EventPort 测试形态）。
- [ ] 2.3 broker（opentray-bin/core）：operation registry + owner loop CAS 结算（重复/错 owner/旧 generation 无状态丢弃+诊断）+ session writer 路由（不承诺 event barrier）；CommandScope 注入与 registry 键升级；`Send` 安全裁决（UI-affine 实例 owner-thread registry，不依赖 unsafe Send）；**LoadExt 携带 expected sha256/buildIdentity，dlopen 前重 hash，native manifest 库开后 init 前校验**（顺序以 design §6.4 为准）。
- [ ] 2.4 Node（packages/cli）：pending-until-final 状态机、导出 typed error class（code/details/cause）、markDead 断连 typed `dialog_transport_closed` 拒绝；确定性测试（Node+Bun 双跑）：accepted 后两普通请求/重复终帧/completion-Exit race/disconnect 前后/旧 generation/wrong owner。
- [ ] 2.5 opentray SDK：`NativeExtensionEmbeddedArtifact`——containment + embedded staging manifest 身份链（hash 计算 + buildIdentity 纳入 expected identity）+ 四类结构化错误 + adversarial 四族（含替换真实 library bytes）。
- [ ] 2.6 `scripts/check-pack-size.mjs`：真实 `npm pack --json --pack-destination <temp>`（stat tgz 字节、npm 版本、packlist、目标 hash）；≥2MB 警告、>3MB 失败；`--dry-run` 仅开发预警；fixture 双臂单测。

## 3. Implementation — 批次 B（crates/opentray-ext-dialog；批次 A 落地并过评审后开工）

- [ ] 3.1 macOS probe（**协议完成后前置**）：owner wake 饿死（Wait 无事件步进不停滞）/ exit race / step 与普通 menu frame 交错次序取证；未取得 probe 证据不得勾选 3.2。
- [ ] 3.2 macOS：show 登记 opaque operation + `beginModalSession` 立即 Accepted；`poll_owner` 驱动 `runModalSession` 步进状态机（一次性 completion CAS；teardown 先 CAS 再 endModalSession）；NSAlert（suppression/severity/escape→cancelId）/ NSOpenPanel / NSSavePanel；终帧 payload 恒带结果。
- [ ] 3.3 win32：per-owner 有界 STA worker（**数值冻结：cap 8 / 启动+进入超时 3s（**pre-Accept 失败 = 原 requestId 同步 typed error，不发 Accepted/终帧**）/ join 超时 2s（**worker 未退出不得 deinit/dlclose：保留引用至自然退出或放弃清理终止进程**）/ WM_APP close dispatcher**；**Accepted 诚实语义 = worker 已进入原生模态调用**，TaskDialog 以 TDN_CREATED 取证，IFileDialog 无先验呈现信号不谎称）；TaskDialogIndirect / IFileOpenDialog / IFileSaveDialog；cap-1/cap/cap+1 测试（满载 typed `dialog_worker_limit_reached` 前置拒绝，绝不静默排队）；线程亲和断言（command/deinit 恒 owner 线程，仅可拷贝数据与 port shim 跨线程；blanket Send 移除或证明永不移动）；deinit-after-join 断言。
- [ ] 3.3b comctl6 工程落点（R4 P1-3）：crates/opentray-bin Windows resource 文件（`.rc` 声明 common-controls v6 依赖）+ cargo build wiring（winres/embed-resource 选型按仓库现状）+ 启动探测日志/DTO fixture + packaged broker 真机证据。
- [ ] 3.4 busy 原子占用（同 scope 第二个 typed `dialog_session_busy`）；session close 先 CAS Revoked → 撤销 → cancel 分支 payload 终帧 → cleanup；四路 dismissal 一致映射。
- [ ] 3.5 BackendCapabilities DTO 嵌入上报 + 双 target CI + exhaustive fixture 比对。

## 4. Implementation — 批次 C（packages/ext-dialog facade）

- [ ] 4.1 `attachDialog(tray, options?)` → capability；`getBackend(): Promise<...>`（惰性 ensureLoaded 后请求 DTO，返回不可变快照；方法 dispatch 前 await 快照做能力前置）；`contract.json`；embedded 描述符。
- [ ] 4.2 facade preflight：Linux/命名空间 mismatch/未知字段/空 buttons/索引越界/路径类 typed 拒绝（状态变更前失败）；糖类型精确化（`Omit<...,"message"|"buttons"|"defaultId"|"cancelId">`；pickFile `multiple?: false` vs `multiple: true` overload，type-test 固定推断）。
- [ ] 4.3 vitest 确定性套件（Node+Bun）：糖语义、dismissal 映射、cancel=null、save 路径 canonicalize（存在 realpath / 不存在 leaf=parent canonicalize+lexical join）、命名空间矩阵、embedded 解析错误矩阵、typed 错误 wire round-trip + instanceof。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `dialog` component + 收齐矩阵；**embedded staging manifest**（path/SHA-256/buildIdentity/version/fingerprint，root-contained）；release-plan/verify-native-plan/stage-release-artifacts/release.yml 同步；broker EXE RT_MANIFEST。
- [ ] 5.2 CI：check-pack-size 真实 pack 证据（tgz stat/版本/packlist/hash + 解包逐 target identity）写入 evidence artifact——无实测不给 packaging GO。

## 6. Verification

- [ ] 6.1 双平台真机验收：每方法冒烟；交错时间线取证（**同 session 多 tray/多 mount** + 跨 app 实例隔离；普通 set-menu/ext-command 交错完成）；四路 dismissal 一致性；断连/重复终帧/错 owner/旧 generation 竞态族；session close 撤销（payload=cancel 分支）；busy typed；suppression 回传；commandLink/expander 真机截证（win）。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI + vision validate + **check 绿（含 self-review 产物）** + **一致性 grep 脚本绿**；clean checkout release 预演（真实 pack+解包）逐目标 identity check。
- [ ] 6.3 self-review（md+html）+ check ok:true；Codex 复核轮（R3+）至 GO。

## 7. Release

- [ ] 7.1 AGENTS.md：Monorepo Law += 包体积门（已在工作树预落）；新章 Dialog Extension Law（design-reference §9 三条提炼，含 DeferredOperation 法则）。
- [ ] 7.1b 同步 `.agents/skills/develop-opentray-ext`：「one fat cross-platform native package」按体积门裁决修订。
- [ ] 7.2 skills/opentray 公共消费文档 + packages/ext-dialog/README。
- [ ] 7.3 changeset（minor）→ 合并 main → version → push → CI 全绿 → npm 上线（与 add-ext-sound 同波）。
