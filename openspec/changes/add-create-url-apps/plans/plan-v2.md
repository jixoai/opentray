# add-create-url-apps — Intent Document (SSOT)

> 原始需求（用户，2026-09-09）：「create-opentray 加入直接将 url 打包成应用的
> 支持。这个需求很简单，你按照现有的架构设计去补充推进这个新功能即可。」
>
> 用户语言系统：**「直接将 url 打包成应用」** —— 不跑命令、不验证端口，给一个
> URL 就得到一个可固定到 Dock/任务栏的桌面应用。

## 最终可见效果（operator 视角）

```bash
npx create-opentray create --url https://example.com
# → 注册一个应用：图标 glyph 兜底、身份自动推导（Example / com.example）
#   打开后是一个指向该 URL 的 appMode 桌面窗口 + 托盘（Show/Quit）
#   可固定 Dock（macOS）/任务栏（Windows），可 list/edit/copy/export/uninstall

npx create-opentray create --url https://example.com \
  --app-name "Example" --app-icon ./logo.png --window 1000x700
# → 身份与图标可覆盖；其余 v1 注册律（快照、force、running 保护）原样成立
```

操作者信任点：URL 应用与命令应用走**同一条** v1 注册/生命周期管线——
`app list` 同样列出、`app edit` 可改名/换图标/改 URL、`app export` 产出自包含
`--url` 命令、`app uninstall` 同样保护外链 payload。操作者无需理解新概念。

## 调研事实（已核实代码）

- `CreateConfigV1.command` 为必填（`config.ts` zod `commandSchema`）；消费
  `config.command` 的假设点：`lifecycle.ts`（`buildMaterializeInput` 投影、
  `planCreate` env 计数）、`export.ts`（`toCliFlags`、`reviewEnvironment`）、
  `cli/commands.ts`（`app edit` patch、`app export` env ack）、`scaffold.ts`
  （README、shell server `commandDisplay`、package.json `@lydell/node-pty` 依赖）、
  `entry-template.ts`（PTY spawn + 端口监控 + 服务窗口）、`scan.ts`
  （`readWizardProjectConfig` 读 payload 的 command）。
- `entry-template.ts` 的服务窗口已经是「URL → appMode WebView 窗口」概念
  （`ensureServiceWindow`）；URL 应用是该概念的直接静态化。
- `open-app.ts` 只 spawn `node main.mjs`（URL 应用天然兼容）；
  `killProcessTree` 对无子进程的 node 进程树仍正确。
- `scaffold.ts` 把 shell host（terminal/address-bar）作为无条件资产写入每个
  payload（D2 of create-no-first-launch-force-terminal）——其存在理由是命令
  输出与 abnormal-exit surface，URL 应用两者皆无。
- 现有 spec capabilities 触碰面：`create-project-config`、`generated-app-entry`、
  `create-lifecycle-kernel`、`create-materialize-pipeline`、
  `create-cli-command-tree`、`create-resource-export`、`create-apps-discovery`。
- 既有 law：CLI 从不抓取名称或 favicon（`--app-icon` 由用户提供或 glyph 兜底）。

## 决策

| # | 决策 | 依据 |
|---|------|------|
| D1 | v1 schema 内新增 `url?: string`、`command` 变可选，superRefine **恰好其一**（XOR）。schemaVersion 保持 1 | 无破坏迁移先例（add-create-command-family 2.1）：全部现存文档继续有效；类型层 `command?` 让 TS 编译器枚举出每个假设点 |
| D2 | URL 应用 entry 用独立模板文件 `url-entry-template.ts`：无 PTY、无 shell server、无端口监控、无命令 teardown；一个直接指向 config.url 的 appMode WebView 窗口（`titleSync` + `iconSync` favicon 同步，与无地址栏命令窗口同配置） | entry-template.ts 顶部意图注释约束其为「命令监督」模板；单文件双形态会撑爆正交意图预算 |
| D3 | URL payload 差异化资产：package.json 不写 `@lydell/node-pty` 依赖；不写 `app-shell-server.mjs` 与 `app-shell/`；README 渲染 URL 形态 | 无命令 → 无 TTY/终端概念；依赖最小化 |
| D4 | URL 仅接受 `http:`/`https:`；生成时**不 fetch、不探活、不抓取** | 与「never scrapes」law 一致；离线可生成；可达性是打开时的事 |
| D5 | 身份自动推导 `deriveUrlIdentity(url)`：appId = 首个路径段（存在且合法时）+ reversed hostname（`https://example.com/app` → `app.com.example`）；appName = 路径首段或 hostname 首标签的 Title Case。CLI `create --url` 下 `--app-id`/`--app-name` 可省略 | URL 自带身份信息；与 `web.dsh.npmjs` 的「最具体段在前」推导风格一致；wizard 的 currentDefaults 心智在 CLI 的投影 |
| D6 | CLI：`create --url` 与 `--exec/--arg/--cwd/--env` 互斥（同给报 `invalid_config`）；`app edit` 支持 URL 应用（可改 `--url`，等价于命令应用改 `--exec`）；`app export` 对 URL 应用导出 `--url` 形态 | 同一条 CLI 契约树；无 env 概念 → env ack 恒不需要 |
| D7 | `scan.ts` 的 payload 配置读取兼容 URL 应用（command 可缺省） | `app list`/发现面不区分两类应用的健康语义 |
| D8 | WebUI wizard 的 URL 模式**本轮不做**（后续独立 change） | wizard 核心价值是「跑命令验证端口」，URL 应用无验证环节；CLI 非交互一步到位已是完整用户路径。webui 是独立 React 包，混入会显著扩大本轮验证面 |
| D9 | `open-app`、runtime-record、stop/uninstall 不改 | URL 应用 main.mjs 与命令应用同为单 node 进程（还少了子树） |
| D10 | URL 创建默认抓取链接页面，把 `<title>` 与最佳 favicon 作为**默认预设**（用户验收轮拍板，2026-09-09）。优先级：显式 flag > `--config` 文档 > 抓取预设 > 地址文本推导；appId 恒用地址推导（title 不稳定，不进身份）；favicon 用抓取管线已规范化的临时文件（ICO 已拆帧、SVG 已致密化）作为 file 源喂给既有 importResource 快照。`--no-scrape` 显式关闭（离线/隐私出口）；抓取 bounded（默认 5s/请求）且任何失败静默回落（hostname 推导 + glyph），绝不阻塞创建。dry-run 同样抓取（展示真实将提交的预设）。app edit 不抓取（注册已有 committed 快照）。命令模式不受影响——其 never-scrape 法则保持（CLI 不跑命令，无从抓起） | 这是 URL 模式相对命令模式的结构性优势：命令要跑起来才能抓，URL 创建时链接就在手上；wizard 对已验证服务的 suggestion 心智在 CLI URL 路径的直接投影 |

## 数据流

```
create --url U (exec/arg/cwd/env 缺席)
   │
   ▼
compileDesiredConfig ── D5 缺省身份 ──► CreateConfigV1 { url: U, command: ∅ }
   │
   ▼
planCreate / applyCreate ── 资源快照 → commit config → payload 原子 swap（不变）
   │ buildMaterializeInput: url 透传、无 command 投影
   ▼
materializePayload ─► writeScaffold
   │   ├─ main.mjs ← url-entry-template（D2）
   │   ├─ package.json：无 node-pty（D3）
   │   └─ 无 app-shell-server.mjs / app-shell/（D3）
   ▼
~/.opentray/create/<key>/app/main.mjs → createTray + window(U) + Quit
```

## 开放问题（默认假设先行）

| 问题 | 影响 | 默认假设 |
|------|------|----------|
| URL 应用要不要 address-bar shell？ | D2/D3 资产面 | 不要（后续可按需加，非本轮） |
| `http://127.0.0.1:<port>`（已有本地服务）允许吗？ | D4 校验 | 允许；不探活，与远程 URL 同路径 |
| 要不要抓 favicon 当默认图标？ | 图标体验 | 不抓（既有 law；glyph 兜底，`--app-icon` 可给 URL） |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| `createAppFromUrl` 独立管线/独立命令 | 违反「CLI 和 WebUI 不能实现分叉的创建语义」；注册/生命周期/导出全部重复 |
| schemaVersion 升 2 + source union | 破坏性且无必要：XOR 字段在 v1 内即可表达，旧读者忽略未知字段即可（`.loose()` 解析已如此） |
| entry-template.ts 内条件分支双形态 | 单文件意图超载（已 6 条）；URL 形态编译期检查同样需要独立模板函数 |
| URL 模式下仍写 shell/PTY 资产 | 为不存在的命令输出付体积与依赖成本；terminal 无意义 |

## 常规性判定

本变更是现有平台法则下的**常规原子**：不触碰 tray-first/App/Session 法、
Darwin carrier 法、App Launch 法（cold launch 仍走 `node main.mjs` 的
`appLaunch` 向量）。唯一的新法是 config v1 的 XOR 语义与 URL entry 的
最小形态——都是既有法的直接投影。

## 实施计划（specs/tasks 追溯）

1. Core/config：`url` 字段 + XOR + 类型 helper（`appSourceOf`）+ 测试。
2. Core/app-id：`deriveUrlIdentity` + 测试。
3. Core/scaffold + url-entry-template：差异化资产 + 测试（快照式断言产物）。
4. Core/lifecycle + export：url 投影、`--url` 导出、env 语义 + 测试。
5. Core/scan：payload config 兼容 + 测试。
6. CLI/options + commands：`--url` 编译、互斥、edit/export 接线 + 测试。
7. 文档：packages/create/README、skill references、（website 不动）。
8. 验证：core/create 两包 vitest + typecheck；`create --url` 真实 dry-run
   （临时 HOME）取证；vision-driven 基线。
