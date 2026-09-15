# OpenTray toolbar R2 复核报告

## 结论

- Verdict：**NEEDS-WORK**
- 综合评分：**6.5/10**（R1：5.5/10，提升 +1.0）
- 复核基线：`f3d845a8`（实现 `456b8e4d`，OpenSpec `18f78f1f`）
- 工作树：只读；既有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 未修改。

R1 的 D1 锁、D3 transport-dead、D4 caller label 三项已实质闭合，D2 现代 owner-tuple 路径也已补齐 seam；但仍有一个协议级 D2 绕过和一个 D5 可观测性竞态。因此不能将本轮判为阻塞清零或 GO。

## 阻塞项

### P1：legacy `destroy` 没有验证调用方 owner tuple

R2 brief/plan 要求所有 destroy-style 路径（包括 legacy Destroy arm）携带并验证 `(appId, trayId, sessionId, windowId)`，且不得用裸 tray id 删除（`openspec/changes/harden-lifecycle-ownership/plans/plan.md:54`；delta 的 owner-tuple 与不可表达裸删除场景见 `openspec/changes/harden-lifecycle-ownership/specs/webview-extension/spec.md:5-24`）。现代 orchestration/channel 命令确实经过 owner-carrying 分支（`crates/opentray-ext-webview/src/lib.rs:419-428,937-960`），但 legacy `destroy` 被明确排除在该分支之外。

macOS 和 Windows 的 handler 接收的只有 `tray_id`，再从 registry 取当前 resident owner 并直接调用 destroy；registry 缺失时还按 tray 进入未校验的 native teardown：

- macOS：`crates/opentray-ext-webview/src/macos/mod.rs:721-742`
- Windows：`crates/opentray-ext-webview/src/windows/mod.rs:841-862`

其上游也没有把 broker transport session 传入 extension command：`crates/opentray-core/src/kernel.rs:328-337`、`crates/opentray-core/src/broker.rs:415-437`；而 `ext_command_with_host` 只 `require_tray`，不是 `require_owned_tray`。因此“resident owner 是 commanding session”的注释不是校验；旧/非 owner caller 只要能发出同 app/tray 的 legacy command，就能摧毁当前 resident session，无法满足 R2 的 owner-typed destroy 契约。现有 seam 测试只覆盖 cleanup 收集后的 stale tuple，不覆盖旧 caller 的 legacy Destroy。

修复建议：让 legacy destroy 在进入 native runtime 前携带真实 broker session id 和默认 window id，并走与 orchestration 相同的完整 owner 比对；或者废弃无 owner 的 legacy destroy wire arm。禁止通过 registry 反查 resident owner 来伪造调用者身份；macOS/Windows 各补“旧 session destroy 不得摧毁新 session”的运行时测试。

### P1：D5 成功里程碑日志没有顺序/落盘保证

规范要求健康 toolbar bootstrap 在 `app.log` 中为每个 milestone 写一条**按执行顺序**的记录，并能仅凭日志判断健康（`openspec/changes/harden-lifecycle-ownership/specs/generated-app-entry/spec.md:5-9,25-30`）。当前 `logEvent` 直接返回 `appendFile` Promise，但关键成功记录均 fire-and-forget：

- URL entry：`packages/create/packages/core/src/url-entry-template.ts:63-74,120,168,194-198`
- command entry：`packages/create/packages/core/src/entry-template.ts:66-74,260,328,373-376,414-417`
- 共享 carrier：`packages/create/packages/core/src/toolbar-carrier.ts:62-80`（成功 milestone 使用 `void event(...)`）

多个 appendFile 请求没有 happens-before；线程池/文件系统完成顺序可与 bootstrap 执行顺序不同，失败边界或 `process.exit` 还可能让尚未完成的成功记录缺失。当前专项运行偶尔通过不能证明该契约，交接记录已观察到 `listenShell` 排在 `createTray` 前的时序竞态；本轮重跑 `entry-bootstrap + toolbar-carrier` 为 12/12 通过，只说明该次没有触发竞态。

修复建议：让模板和 carrier 共享一个串行 append 队列（或每个 milestone `await logEvent`），失败记录和顶层退出同一队列 flush；测试注入延迟写入并重复运行，断言记录顺序、唯一性和退出前完整落盘。

## R1 五项逐项核销

1. **D1 双锁自愈：通过。** `app-bundle.ts` 与 `app-launch.ts` 都复用 `owner-stamped-lock.ts`；owner 写入并 `sync` 后才持有，空/非法/死 PID 有界回收，hard-link claim 仲裁并发回收（`packages/packaging/src/owner-stamped-lock.ts:78-143,145-184`）。本轮 `owner-stamped-lock.test.ts`：1 file / 12 tests passed。已知极窄风险是 release 的 read-then-unlink TOCTOU（`owner-stamped-lock.ts:94-100`），现有 token 测试覆盖延迟替换但未覆盖双 release 并发；记录为 P2 residual，不改变 D1 结论。
2. **D2 owner tuple：部分通过。** registry `DestroyOutcome`、`Superseded` reentrancy seam、view destroy、session cleanup 及 macOS/Windows registry twin 已落地（`crates/opentray-ext-webview/src/orchestration.rs:418-554,620-648`）。`Vacant` 的语义是“本调用方的 session sweep 已先移除 registry entry，随后允许清扫同 tray 的 orphan native session”；这个判断依赖 native session 建立前先登记 registry 的内部顺序，registry-level tests 覆盖了 `Vacant`，但没有覆盖 registry 缺失且 native map 同时被其他调用方重建的 runtime seam。legacy Destroy 在 `None => teardown_window_session(tray_id)` 分支正是该未校验入口，故与上面的 P1 直接相连。
3. **D3 connection-dead：通过。** `LocalBrokerConnection.markDead` 幂等拒绝 pending、死后 request 立即 reject 并只通知一次（`packages/cli/src/local-broker.ts:314-352,430-458`）；orchestration 清理 listeners/resync/channels 并传播 terminal state（`packages/ext-webview/src/orchestration.ts:433-507`）。本轮 CLI 3 files / 36 tests、WebView 2 files / 75 tests passed。graceful `close()` 也会触发 transport terminal state，但模板的 `quitting` guard 保持正常 exit(0)，已有专项测试覆盖，不列 blocker。
4. **D4 caller label：通过。** 派生顺序为 `explicit > appId slug > npm_package_name > argv basename > opentray`，`appName` 不参与（`packages/cli/src/daemon/caller-label.ts:27-60`、`packages/cli/src/local-broker.ts:117-130`）。Windows 的六个失败与本变更无关：`package-identity.ts` 在 `f5edf527` 与当前内容 SHA-256 相同，当前 diff 只涉及 `app-bundle.ts`/`app-launch.ts` 锁接入，未触碰该文件。
5. **D5 模板错误可见性：部分通过。** initial `show()` 不再被吞掉，失败步骤和顶层 stack 会写日志，连接死亡会退出非零；但成功记录的异步顺序缺口仍使健康叙事不可靠，见 P1。

## 过渡期残余风险

- `WindowRegistry::session_closed` 和 `PopupLedger::close_all_of_session` 用全局 `closing_owns_attributed` 决定是否清扫所有 unattributed entries（`crates/opentray-ext-webview/src/orchestration.rs:620-648,715-742`）。现代 session 关闭不会清扫 legacy lease 的边界已有测试；多个同时存在的 legacy caller 仍无法区分，后一个无 attributed entry 的关闭可能清扫其他 legacy lease。这是简报承认的过渡期取舍，建议后续为 legacy lease 引入可识别的连接 token，或明确禁止并行 legacy owner；本轮列 P2 residual。
- native cargo/GUI acceptance 未在本机重跑。报告只把简报提供的 Windows/Rust/黑盒结果作为 supplied evidence，不将其升级为本轮独立证据；本轮独立门限见下节。

简报中提供的 macOS 发布形态黑盒（kill-9 恢复、broker-only death、双启动、坏 broker）以及 macOS Rust 169 tests、Windows aarch64 Rust 180/180 和 Windows owner-lock 12/12，作为历史/supplied evidence 与本轮源码结论一致；它们没有替代本轮未执行的 native gate，也不能覆盖 legacy Destroy caller-identity 缺口或 D5 append 顺序竞态。

## 本轮独立验证

- `pnpm --filter @opentray/packaging exec vitest run src/owner-stamped-lock.test.ts`：1 file / 12 tests passed。
- `pnpm --filter opentray exec vitest run src/daemon/caller-label.test.ts src/local-broker.test.ts src/sdk.test.ts`：3 files / 36 tests passed。
- `pnpm --filter @opentray/ext-webview exec vitest run src/orchestration.test.ts src/index.test.ts`：2 files / 75 tests passed。
- `pnpm --filter @create-opentray/core exec vitest run src/entry-bootstrap.test.ts src/toolbar-carrier.test.ts`：2 files / 12 tests passed。
- `git diff --check 18f78f1f..HEAD`：通过。
- 未运行 cargo/native GUI gate；未把 macOS 黑盒或 Windows 真机结果冒充独立复现。

## 评分依据

- D1 锁自愈与测试：9/10。
- D2 owner/session 隔离：6/10（现代路径强，legacy destroy 是协议绕过）。
- D3 transport-dead 生命周期：8/10。
- D4 endpoint identity：8.5/10。
- D5 bootstrap 可观测性：5.5/10（失败可见，但成功顺序不受保证）。
- 验证证据完整度：6/10（JS 专项门独立通过，native cargo/GUI 未重跑）。

综合 **6.5/10**，较 R1 的 **5.5/10** 提升 **1.0**；在修复 legacy destroy 的真实 owner 传递、串行化 bootstrap 日志并补对应 seam/stress 测试前，不建议发布或归档该 change。
