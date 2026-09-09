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
| D11 | 生成窗口的导航快捷键分两层（用户验收轮，2026-09-09）：**toolbar 模式**下 browse.html 包装页监听 keydown（⌘/Ctrl+←→、⌘/Ctrl+[ ]、⌘/Ctrl+R、F5、⌘/Ctrl+L 聚焦地址栏）驱动既有 Navigation API 后退/前进与 iframe 重载；**所有 URL 应用**的托盘菜单新增 `Reload` 项，经 `evaluate("location.reload()")` 实现（ext-webview 已有 navigate/evaluate，无原生 back/forward/reload 命令）。已知限制：焦点在跨域 iframe 内时包装页收不到键盘事件（ WKWebView 子 frame 事件不越过 origin 边界），文档明示；原生全局快捷键（主菜单 accelerator / native 键盘钩子）属 opentray 主仓库 ext-webview 后续，不在本 change | ext-webview 当前无键盘事件面与原生导航命令，生成侧/facade 层只能做到包装页 + 托盘可达路径；诚实分层优于假装完整 |
| D12 | URL 模式 toolbar：`create --url --toolbar` → v1 config `window.toolbar?: boolean`，payload 恢复 shell server + app-shell 静态资产（**仍无 node-pty 依赖**——shell server 的 PTY 是可选注入），窗口加载 `browse.html?url=<encoded target>` 包装页（与命令模式地址栏窗口同一实现）。toolbar 模式下 titleSync/iconSync 均不设置（wrapper 文档标题固定、跨域 iframe 不可观测——与命令模式地址栏窗口既有行为一致）；iframe 嵌入策略限制（X-Frame-Options 拒绝的站点无法包装）文档明示 | 复用既有 address-bar 包装架构是最小增量；原生 toolbar 需 ext-webview native 开发，超出本 change |
| D13 | 窗口元数据同步默认值（用户拍板）：`window.titleFollowsDocument` 默认 **true**（documentToWindow 单向——窗口标题跟随 document.title；windowToDocument 反向不再默认）；`window.iconFollowsDocument` 默认 **false**（favicon→窗口图标运行时跟随关闭，显式 `--icon-follow` 开启）。两字段进 v1 config（可 edit/export 往返），CLI `--no-title-follow` / `--icon-follow`，命令模式非地址栏服务窗口同样应用。toolbar 模式下两字段无效（见 D12） | App 身份（图标）应稳定由 v1 catalog 决定，页面 favicon 漂移不该悄悄改窗口图标；标题跟随是浏览器直觉默认 |
| D14 | 图标背景自动选择的**边缘环规则**（用户验收轮拍板，2026-09-10）：`foregroundStats` 在既有 luminance/coverage 之外增采样**边缘环**统计（环宽 `max(2, round(min(w,h)×0.04))`，返回 `edge: { opaque, luminance, uniform }`，uniform = 不透明环内像素每通道极差 ≤ 24/255 留 JPEG 噪声余量）；`autoBackground` 仅在 `coverage ≥ 0.985`（满幅）分支参考 edge：`edge.opaque ≥ 0.98 && edge.uniform` → 匹配环色（`luminance > 0.5 ? white : black`），否则维持 transparent。无 edge 参数的旧调用行为不变（wizard 的 `analyzeIconForeground` 直传 stats，零改动受益） | 满幅白底黑字 favicon（维基百科类）自带实底，旧算法判 transparent 会让白垫浮在系统背景上；「边缘全同色」正是「艺术自带底色」的可判定信号——照片/满幅艺术边缘杂色，不受影响 |
| D15 | 图标候选 UX 分层（用户验收轮，2026-09-10）：**应用图标选择器只展示 original + subject**（solid-black/solid-white 剪影是 macOS 托盘模板素材，仅留在高级托盘选择器——此前 app-form 漏过滤导致用户在应用图标行看到纯黑候选）；**图标合成卡片（背景/缩放/预览）仅在有生效前景时渲染**（空状态隐藏）；`trayIconIsSolid` 收窄为仅 solid-* 变体（subject 不是模板剪影，误标会让 macOS 给彩色主体做模板染色） | 候选行的语义应与用途对齐；无前景时背景选择无意义，卡片是噪音 |
| D16 | **浏览器端主体提取**（用户验收轮，2026-09-10）：webui 懒加载 `@imgly/background-removal`（isnet_quint8 ~42MB，模型资产走厂商 CDN；device gpu 自动回落 CPU WASM）对最清晰 original 提取主体，PNG 经新会话方法 `addIconCandidate`（`/api/icon-candidate` 裸字节 + query 元数据）落进会话拥有图标目录并以 `variant:"subject"` 广播进候选列表；每源候选每页面会话至多一次、全部失败路径静默降级；构建链剪除 Vite 复制的死重 ort wasm（imgly#147，dist 26MB→4MB）。**不启用 COOP/COEP**（会破坏跨域 iframe 预览 tab；无 SAB 时 CPU 单线程推理慢但可接受，WebGPU 可用时亚秒）。**开放问题：该包及模型权重为 AGPL-3.0**，create 系列包为 MIT——按 Owner 点名的包实现，许可冲突待 Owner 拍板（移除成本 = 删 subject-extraction.ts + 一个 effect） | 浏览器是唯一有完整 ML 运行时（WASM/WebGPU）的环境；Node 包在 Bun 下有 segfault 前科；候选列表是会话状态，服务端只做持久化与广播 |

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
