# Batch B Rust Native Implementation Review R1

范围：`52c2ffa9..a7909218 -- crates/`，并复核修复提交 `8663387a`、`91a9b87d`。

## P0/P1 台账

- **原 P1-1（pre-entry terminal 泄漏）：已闭合。** `state.rs:464` 的
  `worker_completion_transaction` 以显式 `entered` 选择 `PreEntry`/`Submit`；
  `windows/mod.rs:390` 只在 `WorkerCompletion::Submit` 分支调用 deferred port，
  pre-entry 错误经 entry handshake 回到原 requestId。`task_dialog.rs:180` 的
  pre-`TDN_CREATED` 错误、`file_dialog.rs:300` 的 `IModalWindow` cast 错误均位于
  entry 之前。回归测试覆盖 `PreEntry`、close-race、post-entry error、abandoned、
  revoked 五个状态，实测 crate `34/34` 通过。
- **原 P1-2（pin 失败仍可卸载）：已闭合。** `state.rs:497` 的
  `UnloadDecision::BlockUnload` 由注入式 pin seam 产生；`windows/mod.rs:497`
  在 2s join 后结算 Clean/Pinned/BlockUnload；`lib.rs:191` 在 `BlockUnload` 时于
  `Box::from_raw`/宿主 `dlclose` 前永久 `park`，因此不返回到卸载路径。失败 pin、
  成功 pin、无泄漏三项测试均通过，`34/34` 绿。

## 测试质量抽查

- 两个修复的核心决策均有平台中性、可注入、无 sleep 的状态机测试；实现分支与
  测试枚举一一对应，未发现假绿或竞态依赖。
- 断言仍主要停留在 seam 层：pre-entry 测试未安装计数 deferred-port 以直接证明
  零提交，BlockUnload 测试未实际调用不可返回的 `deinit`（仅证明其决策值）。
  这是覆盖增强项而非当前实现矛盾；建议后续增加受控 port counter 与子线程/超时
  harness，避免未来回归只改状态机而绕过真实调用链。

## 评分与结论

实现评分：**9.0/10**（较批次 A `8.8/10` 提升；两项此前 P1 已修复，扣分仅来自
真实 Win32/卸载路径无法在本机独立复现及上述 seam-only 断言强度）。

批次 E（GUI 真机验收）：**GO**。批次 B 的 macOS/Windows 原生实现、调度与卸载
边界已具备开工条件；E 仍必须在 Windows 真机验证 STA、TaskDialog/MessageBox、
文件 picker 和 join/pin 诊断，不得把本地 34/34 视为跨平台 GUI 证据。
