# Owner 走查 — add-webview-orchestration（已发布版命令）

> 变更已合入 main 并推送（0.25.0，CI native matrix 构建发布中）。
> registry 安装后走查无需任何 overrides/脚本——一条命令即完整路径。

## 等待发布完成

```bash
gh run watch --repo jixoai/opentray          # 或网页看 release.yml；完成后：
npm view create-opentray version             # 应显示 0.25.0
```

## macOS

```bash
mkdir -p ~/opentray-025-walk && cd ~/opentray-025-walk
npm exec create-opentray@0.25.0 -- create --url https://news.ycombinator.com --toolbar
# 向导形态（含「导航工具栏」开关，默认关）：
npm exec create-opentray@0.25.0 -- web
```

## Windows（桌面 cmd）

```bat
mkdir %USERPROFILE%\opentray-025-walk & cd /d %USERPROFILE%\opentray-025-walk
npm exec create-opentray@0.25.0 -- create --url https://news.ycombinator.com --toolbar
```

## 确认清单（首轮走查 + D24–D26）

- [ ] 窗口 = 44px 工具栏 + HN 整页（XFO DENY 顶层加载）
- [ ] 地址栏随页内跳转；⌘←/⌘→；⌘L；托盘 Reload/Quit（exit 0）
- [ ] resize 工具栏恒高；登录态跨重启持久
- [ ] 进度条（工具栏下缘，导航时出现收敛）、favicon（地址栏左侧）
- [ ] 新窗口：target=_blank / 中键 / 右键菜单 → 朴素弹窗，关应用回收

## 清理

```bash
npm exec create-opentray@0.25.0 -- app uninstall com.ycombinator.news   # 或走查用的 app-id
```

*源码树走查脚本随 change 归档于 `openspec/changes/archive/2026-09-12-add-webview-orchestration/demos/`。*
