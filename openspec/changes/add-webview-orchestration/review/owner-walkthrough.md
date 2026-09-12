# Owner 人为走查 — add-webview-orchestration（一行命令版）

> 所有脚本在 `openspec/changes/add-webview-orchestration/demos/`（已提交，双平台已验证：
> macOS 全链实测；Windows 无头链路实测，仅最后的窗口启动留给你的桌面会话）。

---

## macOS（本机）

```bash
DEMOS=/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.worktree/add-webview-orchestration/openspec/changes/add-webview-orchestration/demos

$DEMOS/prepare.sh            # ① 一次性准备（构建+打包，幂等；已替你跑过）
$DEMOS/run-url-app.sh        # ② HN + 导航工具栏 —— 核心走查
$DEMOS/wizard.sh             # ③ 向导（「导航工具栏」开关，默认关）
$DEMOS/run-command-app.sh    # ④（可选）命令应用 + 本地服务 + 工具栏
$DEMOS/cleanup.sh            # ⑤ 走查完清理
```

**② 的确认清单**（其余脚本看预期效果即可）：

- [ ] 窗口 = 顶部 44px 工具栏 + **HN 整页**（iframe 时代这里直接失败的站点）
- [ ] 点页内链接 → 地址栏跟随更新；⌘←/⌘→ 后退前进；⌘L 聚焦地址栏
- [ ] 托盘 Reload / Quit（Quit 退出码 0，终端无报错）
- [ ] 拖拽 resize：工具栏恒高、内容跟随、无闪烁
- [ ] 焦点观察步：点击内容区 ↔ 点击工具栏，焦点环迁移正常
- [ ] （可选）登录某站 → Quit → 重跑 ② → 登录态仍在

---

## Windows（gaubeehonor，桌面开一个 cmd）

```bat
set DEMOS=E:\dev\github\opentray-orch\openspec\changes\add-webview-orchestration\demos

%DEMOS%\prepare.cmd          &rem ① 一次性准备（幂等；机器已就绪，可跳过）
%DEMOS%\run-url-app.cmd      &rem ② HN + 导航工具栏 —— 核心走查
%DEMOS%\run-command-app.cmd  &rem ③（可选）
%DEMOS%\cleanup.cmd          &rem ④ 清理
```

② 的确认清单同 macOS，Windows 额外看：任务栏图标正常、DPI 缩放下工具栏仍 44 逻辑像素。

> 应用使用专属 `walk.*` app-id（避免与历史注册冲突——首版脚本曾静默复用 9 月 9 日旧 HN 注册，
> 其 toolbar 正是旧嵌入法剥掉的，导致「无工具栏」；已修复并双平台重验）。两台机器均已预创建并装好依赖，② 直接进到启动窗口。
> 你刚才看到的无工具栏窗口来自旧注册 `com.ycombinator.news`（非本次代码），已被新 walk 注册取代。

---

## 反馈

- 任一项不符 → 回复现象（app.log 在 `~/.opentray/create/<app>/app/app.log`）。
- 全部通过 → 回复「走查通过」，我执行收尾（archive、清 worktree/herdr、合主线、按需发版）。
