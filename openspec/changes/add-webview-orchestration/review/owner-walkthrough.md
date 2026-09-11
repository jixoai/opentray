# Owner 人为走查命令行文档 — add-webview-orchestration

> 变更：toolbar 模式 iframe 载体 → 同窗多 webview 原生编排（两种应用统一）。
> 本文档每条命令都已由编排者或子代理真实执行验证（Windows 运行时步骤除外——
> 机器就绪态与 dry-run 已验证，窗口交互需你的桌面会话）。
> 走查通过后的收尾（archive/合并/发布）等你确认。

---

## A. macOS（本机）

### A0. 前置（幂等，已验证）

```bash
REPO=/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.worktree/add-webview-orchestration
SCRATCH_DIR=~/opentray-owner-walkthrough
mkdir -p "$SCRATCH_DIR/tgz"

cd "$REPO"
mbx build --release -p opentray-bin -p opentray-ext-webview -j 2
cp -f target/release/libopentray_ext_webview.dylib \
      packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib
mkdir -p packages/darwin-arm64/bin packages/darwin-arm64/app
cp -f target/release/opentray packages/darwin-arm64/bin/opentray
cp -f packages/darwin-app-carrier/Info.plist packages/darwin-arm64/app/Info.plist
pnpm -F opentray build
for p in opentray @opentray/spec @opentray/packaging @opentray/icon \
         @opentray/darwin-arm64 @opentray/ext-webview \
         @opentray/ext-webview-darwin-arm64; do
  pnpm -F "$p" pack --pack-destination "$SCRATCH_DIR/tgz" >/dev/null
done
ls "$SCRATCH_DIR/tgz"    # 应有 7 个 *-0.23.0.tgz
```

### A1. URL 应用：HN + 导航工具栏（核心走查）

```bash
cd "$SCRATCH_DIR"
pnpm --dir "$REPO" create-opentray create \
  --url https://news.ycombinator.com --toolbar --skip-install --pm npm --json

APP_DIR="$HOME/.opentray/create/com-ycombinator-news/app"
cd "$APP_DIR"
TGZ="$SCRATCH_DIR/tgz" node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const t = (n) => `file:${process.env.TGZ}/${n}`;
pkg.overrides = {
  "opentray": t("opentray-0.23.0.tgz"),
  "@opentray/spec": t("opentray-spec-0.23.0.tgz"),
  "@opentray/packaging": t("opentray-packaging-0.23.0.tgz"),
  "@opentray/icon": t("opentray-icon-0.23.0.tgz"),
  "@opentray/darwin-arm64": t("opentray-darwin-arm64-0.23.0.tgz"),
  "@opentray/ext-webview": t("opentray-ext-webview-0.23.0.tgz"),
  "@opentray/ext-webview-darwin-arm64": t("opentray-ext-webview-darwin-arm64-0.23.0.tgz"),
};
pkg.dependencies["opentray"] = t("opentray-0.23.0.tgz");
pkg.dependencies["@opentray/ext-webview"] = t("opentray-ext-webview-0.23.0.tgz");
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");'
npm install --no-fund --no-audit
node main.mjs &
```

**肉眼确认清单：**

- [ ] 窗口 = 顶部 44px 工具栏 + **HN 整页**（XFO DENY 站点作为顶层上下文——iframe 时代这里直接失败）
- [ ] 点页内链接 → 地址栏随 urlChange 更新（真值跟随，非猜测）
- [ ] ⌘← / ⌘→ 后退/前进（原生历史）
- [ ] 工具栏聚焦时 ⌘L 聚焦地址栏；输入 URL 回车导航
- [ ] 托盘 Reload → content 原生重载；托盘 Quit → 干净退出（终端无报错、exit 0）
- [ ] **焦点观察步**（机器验证环境受阻项，代你设为观察点）：点击 content 再点击工具栏地址栏——焦点环迁移、输入正常
- [ ] （可选）登录某个站点 → 托盘 Quit → 再 `node main.mjs` → 登录态仍在（第一方存储持久；机器已用本地 set-cookie 实证跨进程存活）

退出：托盘 Quit 或 `kill %1`（退出码应为 0）。

### A2. 向导路径（「导航工具栏」开关）

```bash
mkdir -p /tmp/opentray-wizard-home
HOME=/tmp/opentray-wizard-home pnpm --dir "$REPO" create-opentray web --no-open \
  | grep -o 'http://127.0.0.1:[0-9]*/?token=[0-9a-f]*' | tail -1 > /tmp/wizard.url
open "$(cat /tmp/wizard.url)"
```

**操作**：粘贴 URL 或命令 → 找到「导航工具栏」开关（默认关）→ 打开 → 生成 → Open App。
确认开关默认关闭、两种流程（URL/命令）都有、生成产物走 A1 同款窗口。

### A3.（可选）命令应用 + toolbar + 本地服务

```bash
mkdir -p "$SCRATCH_DIR/cmd-content"
echo '<!doctype html><title>Cmd Service</title><h1>command app service</h1>' \
  > "$SCRATCH_DIR/cmd-content/index.html"
cd "$SCRATCH_DIR"
pnpm --dir "$REPO" create-opentray create --app-id local.cmd-demo \
  --app-name "Cmd Demo" --exec python3 --arg=-m --arg=http.server --arg=8137 \
  --cwd "$SCRATCH_DIR/cmd-content" --toolbar --skip-install --pm npm --json
cd "$HOME/.opentray/create/local-cmd-demo/app"
# （复用 A1 的 overrides 注入 + npm install，TGZ 同指 $SCRATCH_DIR/tgz）
node main.mjs &
```

确认：服务窗 = 工具栏 + python 服务页；地址栏显示 `http://127.0.0.1:8137`；Quit 后服务子进程回收。

### A4. 清理（可选）

```bash
pnpm --dir "$REPO" create-opentray app uninstall com.ycombinator.news
pnpm --dir "$REPO" create-opentray app uninstall local.cmd-demo
rm -rf /tmp/opentray-wizard-home "$SCRATCH_DIR"
```

> 注意：macOS 上 WebKit 数据按应用身份存于 `~/Library/WebKit/<appId>`，不随 HOME 隔离；
> 走查后如需彻底清理可一并删除对应目录。

---

## B. Windows（gaubeehonor，桌面会话内执行）

**机器就绪态（已由编排者备好）**：`E:\dev\github\opentray-orch` @ 分支 add-webview-orchestration（最新含双阻塞修复）、
TS 六包已构建、`opentray.exe`/`opentray_ext_webview.dll` release 已暂进平台包、字体资产已补、
9 个 tarball 已打包到 `C:\Users\gaube\opentray-owner-walkthrough\tgz`、
注入脚本 `inject-overrides.mjs` 已就位、create CLI dry-run 已验证（ok:true、toolbar 保留）。
**你在 Windows 桌面开一个终端（cmd 或 PowerShell）按序执行即可。**

### B1. URL 应用：HN + 导航工具栏

```bat
cd /d %USERPROFILE%\opentray-owner-walkthrough
pnpm --dir E:\dev\github\opentray-orch create-opentray create ^
  --url https://news.ycombinator.com --toolbar --skip-install --pm npm --json

cd /d %USERPROFILE%\.opentray\create\com-ycombinator-news\app
set TGZ=%USERPROFILE%\opentray-owner-walkthrough\tgz
node %USERPROFILE%\opentray-owner-walkthrough\inject-overrides.mjs
npm install --registry=https://registry.npmmirror.com --no-fund --no-audit
node main.mjs
```

确认清单同 A1（Windows 上另关注：任务栏图标正常、DPI 缩放下工具栏高度仍 44 逻辑像素、
窗口 resize 时工具栏高度不变内容跟随）。

### B2.（可选）命令应用 + toolbar

```bat
cd /d %USERPROFILE%\opentray-owner-walkthrough
mkdir cmd-content 2>nul
echo ^<!doctype html^>^<title^>Cmd Service^>^<h1^>win cmd^</h1^> > cmd-content\index.html
pnpm --dir E:\dev\github\opentray-orch create-opentray create --app-id local.cmd-demo ^
  --app-name "Cmd Demo" --exec python --arg=-m --arg=http.server --arg=8137 ^
  --cwd %USERPROFILE%\opentray-owner-walkthrough\cmd-content --toolbar ^
  --skip-install --pm npm --json
cd /d %USERPROFILE%\.opentray\create\local-cmd-demo\app
set TGZ=%USERPROFILE%\opentray-owner-walkthrough\tgz
node %USERPROFILE%\opentray-owner-walkthrough\inject-overrides.mjs
npm install --registry=https://registry.npmmirror.com --no-fund --no-audit
node main.mjs
```

（需 python 在 PATH；没有可换 `--exec cmd --arg=/c --arg=python -m http.server 8137` 或跳过本节。）

### B3. 终核建议的额外观察点（双平台通用）

1. 拖拽窗口边缘 resize：工具栏恒高、内容区跟随、无闪烁（原生重排，零 JS）。
2. 若页面有登录，重启应用后登录态保持。
3. 托盘菜单 Show/Reload/Quit 全部可达。
4. 长时间静置无明显 CPU 占用（无轮询回归——16ms drain 法的对照直觉）。

---

## 走查结果反馈

- 任一项不符 → 直接回复本会话描述现象（app.log 在 `~/.opentray/create/<app>/app/app.log`，broker.log 在运行时目录）。
- 全部通过 → 回复「走查通过」，我执行收尾：archive OpenSpec change、清理 worktree/herdr、合并主线、按需发版。

*生成于 2026-09-12 · 分支 add-webview-orchestration @ 9d8dd08 之后 · 全部实现与验证证据见 openspec/changes/add-webview-orchestration/{tasks.md,review/}*
