<!--
Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持，这需要同步更新所有
的 README.md，提供 README-zh.md 等):
1. Faithful zh mirror of README.md: identical structure, tables, and code
   blocks; prose translated only.
2. Top language cross-links keep the zh↔en pair discoverable (the
   unipty/opendweb README pair convention).
-->

# OpenTray

<p align="center"><img src="./docs/opentray-logo.png" alt="OpenTray logo" width="180"></p>

[English](README.md) | 简体中文

OpenTray 是一个面向 Node/Deno/Bun CLI 与 AI 技能生态的桌面状态运行时。

当前的平台模型是托盘优先（tray-first）：

- `App`：由调用方持有的运行时身份与隔离边界。
- `Tray`：归属于该 app/运行时的单个桌面状态原子。
- `Session`：托盘事件与变更的实时权威来源。
- `Extension`：作用域限定在 app 与托盘上的可选原生能力原子。

OpenTray 不再将 `Space`、`Surface`、`createSpace()`、`createSurface()` 或 `resolveDefaultSpace()` 作为公共本体暴露。应用代码直接调用 `createTray()`，并自行持有前台/后台生命周期。

已经有一个在本地提供 HTTP 服务的命令？`npx create-opentray` 可以把它包装成一个
OpenTray 托管的应用——通过浏览器向导交互式完成（`create-opentray web`）、完全
非交互式完成（`create-opentray create --app-id … --app-name … --exec …`），
或阅读内置 AI 技能（`npx create-opentray skill`）。参见
[create-app 指南](./skills/opentray/references/create-app.md)。

第一个应用直接调用 `createTray()`。默认运行时会自动启动本地 broker：

```ts
import {
  createTray,
  type CreateTrayHandle,
  type CreateTrayOptions,
  type TrayIcon,
} from "opentray";

const icon: TrayIcon = { "text-only": "OT" };
let tray: CreateTrayHandle;
const options: CreateTrayOptions = {
  id: "com.example.first-app",
  icon,
  menu: {
    items: [
      {
        title: "Quit",
        primaryEvent: true,
        onMenuClick: () => void tray.destroy(),
      },
    ],
  },
};

tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
});
```

## 工作区

| 目录                     | npm 包                    | 用途                                                      |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `packages/cli`           | `opentray`                | 面向开发者的托盘优先 SDK 与 CLI 包。                        |
| `packages/spec`          | `@opentray/spec`          | TypeScript 协议与共享契约包。                              |
| `packages/packaging`     | `@opentray/packaging`     | 与打包器无关的运行时工件装配（staging）契约。                 |
| `packages/vite-plugin`   | `@opentray/vite-plugin`   | 构建在 packaging 契约之上的第一个 Vite 适配器。               |
| `packages/ext-webview`   | `@opentray/ext-webview`   | 富弹出层扩展门面。                                        |
| `packages/ext-webview-*` | `@opentray/ext-webview-*` | 平台 WebView 动态库包。                                    |
| `packages/ext-badge`     | `@opentray/ext-badge`     | 平台徽标/进度/覆盖层 API 扩展。                             |
| `packages/ext-island`    | `@opentray/ext-island`    | 路线图上的灵动岛/实时活动扩展。                              |
| `packages/<os>-<arch>`   | `@opentray/<os>-<arch>`   | 平台运行时工件包。                                        |

Lynx 扩展维护在独立仓库
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) 中。
OpenTray 核心不构建、不装配、也不发布 Lynx 工件。

## API

获取最新发布的包请使用 `latest`。当应用使用官方扩展时，请在这组包上锁定同一个
OpenTray 协议线标签：

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

同一协议线上的 alpha 包使用 `alpha-A-B`。请将 `A-B` 替换为 `@opentray/spec`
发布的协议线标签；除非在排查包漂移问题，否则不要混用 `latest` 与协议线标签。

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.build",
  icon: {
    type: "file",
    path: "./build.png",
    text: "Build",
    "text-only": "Build",
  },
  tooltip: {
    title: "Build",
    description: "Build monitor",
  },
  menu: {
    items: [
      {
        title: "Open",
        primaryEvent: true,
        onMenuClick: () => {
          // Open an app-owned window, command, or extension surface.
        },
      },
      "-",
      ["More", ["Settings", "Quit"]],
    ],
  },
});
```

可见的托盘文本属于图标投影的一部分（`icon.text`、`icon["text-only"]` 或
`icon["icon-text"].text`），而不是托盘顶层的 `title`。如果投影后没有任何可见的
图标/文本存活，原生托盘后端会回退到运行时 `appName`，托盘因此不会变成一个看不见
的点击目标。
运行时身份与托盘投影是分离的。当宿主需要显式的诊断身份时，通过运行时选项传入：

```ts
await createTray(options, {
  appId: "com.example.build",
  appName: "Build",
});
```

`primaryEvent` 是普通菜单项上的一个角色，触发的是通常的 `menuClick`。
当你想监听原始的托盘图标点击、又不想让某个菜单项成为主路由时，使用
`tray.onTrayClick(...)`。

`opentray` 包重新导出面向应用的类型，例如 `CreateTrayOptions`、`TrayIcon`、
`TrayMenu`、`TrayTooltip`、`TrayEvent` 和 `TrayBoundsResult`。对于常规托盘
工作，应用代码不需要 `Parameters<typeof createTray>`，也不需要直接 import
`@opentray/spec`。

顶层 `createTray(...)` 及其返回的 `setMenu(...)` 接受面向应用的菜单简写。
更底层的 `createClient(...)` 保持仅协议形态，供需要精确线上报文结构的工具使用。

如果你已经持有宿主进程，`createTray()` 仍是更底层的托盘 API。

## 应用模式窗口

`@opentray/ext-webview` 窗口默认是托盘持有的工具窗口。当某个 WebView 应该表现
为普通桌面应用窗口时，设置 `style.appMode: true`：它会加入 Windows 任务栏与
Alt+Tab，或 macOS 的 Dock 与 Command-Tab。

```ts
import { WebviewExt } from "@opentray/ext-webview";

const window = tray.extend(WebviewExt).createWebviewWindow({
  url,
  width: 960,
  height: 720,
  style: { appMode: true, autoHide: false },
});
```

`appMode` 不隐含 `keepOnTop`、无边框外观、自动隐藏、材质或可见性行为。普通应用、
托盘工具、混合窗口产品、Dock 重开、冷启动 `appLaunch`、开发监督进程与诊断等
主题，请阅读公开的
[应用模式决策指南](skills/opentray/references/app-mode.md)。

## 打包

`@opentray/packaging` 将运行时可执行工件、原生 sidecar 与伴随资产装配到按
app-id 推导的输出路径，并写入 `opentray-app-manifest.json` 清单。常见打包器的
适配器均已发布：`@opentray/vite-plugin`、`@opentray/tsdown-plugin`、
`@opentray/esbuild-plugin` 和 `@opentray/webpack-plugin`。四者写入相同的清单
结构；按你现有的工具链选择即可。

```ts
import { openTrayVitePlugin } from "@opentray/vite-plugin";

export default {
  plugins: [
    openTrayVitePlugin({
      app: { id: "com.example.build", name: "Build" },
      runtimeHost: {
        source: "node_modules/@opentray/darwin-arm64/bin/opentray",
      },
    }),
  ],
};
```

`@opentray/darwin-arm64` 这类平台运行时包携带 `bin/opentray` 或
`bin/opentray.exe`。打包始终是构建层的关注点。它装配工件并产出清单事实；
它不持有托盘生命周期、会话权威、后端选择或扩展分发。

默认的 `createTray()` 传输面向本地运行时宿主，并在首次使用需要时自动启动它。
普通应用代码通过公开的托盘/会话协议与打包好的 `opentray` 可执行文件通信；
它不加载 Node addon，也不需要为了创建托盘把业务逻辑拆进 worker。

## 开发检查

先跑聚焦检查，再跑更宽的门：

```bash
pnpm --filter @opentray/spec test
pnpm --filter opentray test
cargo test -p opentray-spec --lib
cargo test -p opentray-core --lib
cargo test -p opentray-backend-tray-icon --lib
bun run openspec:vision -- validate opentray-v0-9
git diff --check
```

人类可见的示例位于 `packages/cli/examples` 与各后端 crate 的示例中。它们应当证明
真实的托盘/窗口行为，而不向 `opentray-core` 引入原生 GUI 或扩展特定逻辑。
