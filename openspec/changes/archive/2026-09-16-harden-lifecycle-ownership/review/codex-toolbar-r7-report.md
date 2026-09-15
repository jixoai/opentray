# OpenTray Toolbar R7 确认轮复核

## 范围与证据边界

本轮按 `/tmp/hlo-r7-brief.md` 限定，仅复核 R6 的 P1（typed-fail 出口未提交 host outbox）和两个证据缺口。复核基线为当前真实工作区 `HEAD d2e50322a59976b88c94bc17d876958ba3241f13`；工作树仅有既有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md`，未修改。`git diff --check d2e50322^..HEAD` 通过。

本机直接运行了当前已有的 `target/debug/deps/opentray_ext_webview-62fa82a79287a7b4` 测试二进制，未触发 Cargo 重编译：全量 macOS 配置 `177/177` 通过（4.31s），两个新增 twin 各自通过。该二进制是与本次 HEAD 构建时间相邻的既有产物，因此把它记为本机可复现的已有构建证据，不把它表述为本轮重新编译证据。简报提供的 macOS 连续两次 `177/177` 和 Windows aarch64 真机 `186/186`（含新增 2 个 twin）作为 supplied evidence；本轮没有重新连接 Windows 真机。

## 核销结果

### 1. P1：两端三条 page command 的所有目标出口均提交 host events

- macOS `crates/opentray-ext-webview/src/macos/bridge.rs:435-501`：`postMessage` 不再用 `required_channel_id(?)` 早退；参数错误包装为 `ChannelPostError { pushes: Vec::new() }`，进入统一失败臂并在返回前调用 `submit_host_channel_events`（`442-467`）。`closeMessageChannel` 和 `destroyMessageChannel` 以 `required_channel_id(...).and_then(...)` 合并参数/registry 结果，成功臂和 `Err` 臂都提交（`475-501`）。
- Windows `crates/opentray-ext-webview/src/windows/channels.rs:226-292`：与 macOS 同构；`postMessage` 的参数 typed-fail 进入失败臂（`232-258`），close/destroy 的 `Ok` 与 `Err` 均在返回前提交（`266-292`）。
- 所有 `registry.borrow_mut()` 都局限在 `and_then`/局部语句内；提交发生在 match 臂中。`submit_host_channel_events` 先在局部借用块内 drain，再释放借用后调用 EventPort，必要时重新借用回插（macOS `634-661`；Windows `459-486`）。未发现跨 deliver/submit 的 `RefMut` 重入风险。

### 2. P1 回归 twin

- macOS `crates/opentray-ext-webview/src/macos/tests.rs:3323-3404`：以 rejecting fake port 预置一个 retained host record；缺失 `channelId` 的 close 使 submit 计数由 1 增至 2，未知 id 的 destroy 再增至 3。
- Windows `crates/opentray-ext-webview/src/windows/channels.rs:733-792`：同一断言和同一 port-injectable fixture，形成平台 twin。
- 注：`SessionChannels::destroy` 对未知 id 按既有契约是幂等成功（`crates/opentray-ext-webview/src/channels.rs:460-464`），因此测试中的“未知 id destroy”动态覆盖的是 destroy 的成功出口，而非 registry `Err` 出口。实际 `Err` 臂仍由两端源码 `and_then` 后的统一 `match` 覆盖；这是测试命名/分支精度的轻微证据注记，不构成当前实现阻塞。

### 3. Windows document-navigation 证据缺口

- Windows twin `crates/opentray-ext-webview/src/windows/channels.rs:794-835` 完成初次加载、页面完成、再次导航，断言 EventPort 收到一次 `channel.closed`、`Edge` 分类、正确 tray 路由，且 host outbox 为空。
- macOS 对应测试位于 `crates/opentray-ext-webview/src/macos/tests.rs:3263-3320`；两端导航钩子均在关闭 channel、投递 page push 后调用 `submit_host_channel_events`（macOS `701-729`；Windows `523-550`）。
- OpenSpec delta 的平台 twin 与导航要求为 `openspec/changes/harden-lifecycle-ownership/specs/webview-extension/spec.md:57-69`，当前实现与测试均闭合。

## 结论

R6 P1 的参数校验、registry 结果和成功出口均已统一经过 host EventPort 提交；两端 twin 和 Windows 导航证据缺口已补齐。当前范围内没有发布阻塞问题。评分保留少量扣分给“已有二进制而非本轮重编译”以及 destroy unknown-id 测试分支命名不精确；不重新打开 R6 已接受的低优先级注释/重复 helper 项。

GO | 综合评分 9.5/10 | 报告路径 /tmp/codex-toolbar-r7-report.md
