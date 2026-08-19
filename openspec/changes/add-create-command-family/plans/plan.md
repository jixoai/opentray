# add-create-command-family — Intent Document SSOT

## Current Round

- Round: 5（用户拍板遗留项：跨系列切换无需确认/撤销——表单独立前端缓存已做实；env 预设改为用户 env 配置行的双向投影，唯一可信源 = 外层 env 配置）
- Status: apply 修订中
- Previous plan backup: plans/plan-v2.md

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Backup plan before material revision: `bun run openspec:vision -- backup-plan <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## 用户原始需求（时间戳记录）

- 2026-08-19（原始需求）：「针对 create-opentray……改进命令的容易配置……支持业内流行的几种命令：1. npm 系列：npx | pnpx | bunx | yarn dlx | nubx(nubjs) | deno run | vpx(vite-plus)，特性是 X [flags] <package><@version>；2. go 系列：go run pkg@version；3. Rust 系列：cargo install & xxx，不能直接运行，需要先安装；4. Python 系列：uvx、pipx run；5. .NET 系列：dnx；6. 自定义。……针对性地做出轻设计，改进参数输入的便捷性。比如 npmjs 生态最好自动带上 npm_config_yes=true。……针对以上五种系列设计『默认 appid』的生成规则。」（原型演示诉求：预设命令点击自动填充）
- 2026-08-19（appId 尾段拍板）：用户在「短码 npm/go/rs/py/cs / 全名 npmjs/golang/rust/python/dotnet / 无尾段补 .app」三方案中选择 **全名 npmjs/golang/rust/python/dotnet**。
- 2026-08-19（原型方向拍板）：「基于分域表单来做改造，其它方案可以删除了。改造方式是：我们将它做成一个 inputgroup，这样整个页面的高度仍然保持不变，只需要一个 input 的高度。start 部分是一个选择器，可以选择域，这里都使用图标，自定义模式的图标就是一个 edit-icon。如果选择自定义模式，那么 inputgroup 主体部分是一个 input，可以自由输入。其它模式，主体部分是一个 ReadonlyInput，点击不能输入但是会弹出一个 fromDialog（所以它更像是一个 button 的作用），在 Dialog 里面进行详细的操作。」
- 2026-08-19（图标要求）：「图标请使用官方图标，最好是 svg，其次是 webp，其次是 png。」
- 2026-08-19（预设位置，原型期）：「预设不放（改）在 Dialog 里面，我们这个原型到时候是要用作参考的，预设挂在 input 外面。」
- 2026-08-19（env 展示）：「env 信息不要直接显示在 input 上，你可以用一个 icon 来表示这个命令预设了 env，然后 hover 显示 tooltip，在这里显示 env 信息。」随后：「这个 hover 效果可以，同时也支持 click 会更好」；「位置需要调整一下，现整体垂直居中」。
- 2026-08-19（预设定位，生产边界）：「你要记得，这个预设只是我们测试用的，最终是不会落入到正式开发中。开始使用 openspec 将这个新功能推进并 apply 到 create-opentray 的 webui 中。」

## 用户语言系统

- 「系列 / 域」= 命令生态家族（npm / Go / Rust / Python / .NET / 自定义），二者同义，UI 文案用「系列」。
- 「分域表单」= 按系列渲染结构化字段的表单形态；已收敛为「单行 InputGroup + 表单 Dialog」。
- 「InputGroup」= 单行输入组：前缀域选择器 + 主体输入/只读命令区 + 尾部操作。
- 「ReadonlyInput」= 只读命令区，行为同按钮，点击弹「formDialog（表单 Dialog）」做详细配置。
- 「生态尾段」= appId 末段的固定生态标识（npmjs/golang/rust/python/dotnet）。
- 「预设」在原型语境 = 测试用示例命令 chips；生产不包含（见 D6）。

## 事实（勘察实证）

1. 现行命令配置 = `packages/create-webui/src/components/command-card.tsx`：自由字符串 Input（string 模式）或 TagInput（argv 模式）+ 命令选项折叠区（cwd/env/模式）；env 无任何预设机制；`npm_config_*` 全仓只有 `npm_config_user_agent`（PM 检测）。
2. 现行默认 appId 推导 = `packages/create/packages/core/src/app-id.ts`：选项前 token 归一化后反转点连接（`npx @deepseek-ai/dsh@latest web` → `web.dsh.npx`）；对 `go run rsc.io/fortune@latest` 会推出无意义的 `fortune.run.go`，对 `cargo install ripgrep` 推出 `ripgrep.install.cargo`。
3. `dnx` 已核实为 .NET 10 SDK（10.0.100+）的 npx 等价物（NuGet 工具免装运行）。
4. 原型（`packages/create-webui/src/prototypes/command-family/`，dev-only）已验证核心规则：28 项单测覆盖分系列 appId 新旧对照、parse↔build 往返、runner 归一（同一包 7 种 npm runner 推导一致）、env 预设边界；单行 InputGroup + 域选择器 + 表单 Dialog + 官方图标 + env 图标 Tooltip（hover/click 钉住/垂直居中）已按用户逐轮反馈定稿。
5. lucide-react 0.545 运行时无 `Snake` 导出但类型面存在（typecheck 漏网、页面白屏实证）——品牌图标必须以 vendor 的官方 SVG 落地，不能用图标库近似品。
6. simple-icons（CC0）提供 npm/go/rust/python/dotnet 官方品牌单色 SVG；原型已 vendor（`src/prototypes/command-family/icons/*.svg`）并以 currentColor 内联渲染。
7. 向导命令流：客户端 debounce POST `/api/prime`（不 spawn 推导 placeholder）→ 运行 POST `/api/command`；服务端 `wizard.ts` `currentDefaults()/commandEnv()/exportFrozen()` 为权威；`WizardCommandOptions`（cwd/env/argsMode）由 `/api/command-options` 白名单 patch 并随草稿持久化；v1 `CommandConfig` 已携带 `env` overlay。
8. `?edit=<appId>` 编辑模式强制 argv 模式（向量往返精确）；create-webui 无 workspace 依赖，客户端类型以 `wizard-protocol.ts` 手工镜像（仓内既有模式）。

## 决策

| # | 决策 | 依据 |
|----|------|------|
| D1 | UI 形态 = 单行 InputGroup：前缀域选择器（官方品牌 SVG 图标；自定义 = edit 图标）+ 主体。自定义系列 → 自由输入 Input（现状行为）；其它系列 → 只读命令区（点击弹表单 Dialog：Runner/包名/版本/参数、Rust 二进制与两步预览、env 预设行；草稿「确定」回写命令串、「取消」丢弃）。页面保持单 input 高度 | 用户 2026-08-19 原型拍板 + 逐轮修正 |
| D2 | 系列 = npm（npx/pnpx/bunx/yarn dlx/nubx/deno run/vpx，`X [flags] <pkg>[@version] [args]`）、go（`go run <module>[@version]`）、rust（`cargo install <crate>` → 运行二进制）、python（uvx / pipx run）、dotnet（`dnx <tool>[@version]`）、custom | 用户原始需求 |
| D3 | 默认 appId 新规则：丢弃 runner 机制段（同一包换 runner 推导不变）→ 身份段（选项前子命令段 + 归一化包名；Rust 以运行二进制为身份，缺省同 crate 名；Python 包名 `.`/`_` 归一 `-`；去 `@scope`/`@version`/`npm:` 前缀/路径末段）+ **全名生态尾段 npmjs/golang/rust/python/dotnet**；无身份段回落 `app.opentray`；appName 不含生态尾段；custom 系列保持现行规则不变 | 用户尾段方案拍板；原型测试实证 |
| D4 | env 预设（R10 终版，用户浏览器验收拍板）：**用户显式配置的 env 行是唯一可信源，无任何隐形注入**——npx/pnpx 预设 `npm_config_yes=true` 仅以 env 行显式条目形式生效；Dialog 预设控件 = env 行的双向投影（启用=写条目 / 移除=删条目，无独立开关）；外面手动配置/删除即时同步到 Dialog 与输入行图标（图标 = 条目存在才点亮）；外部移除条目后 Dialog 显示「+ 启用」（R10 修复的验收场景）。`envPresetDisabled` 字段废除（未发布，破坏性收敛）；重复键 last-wins（与服务端 overlay 一致）；分享/导出 ack 沿 env 行既有法律 | 用户 2026-08-19/20 拍板「env 行唯一可信源」+ 验收反馈「外部移除后应显示 + 启用」 |
| D5 | 品牌图标 = simple-icons 官方单色 SVG vendor 进 create-webui（currentColor 渲染，明暗主题安全）；自定义 = lucide Pencil；不引入图标位图与图标库近似品 | 用户图标要求（svg > webp > png；官方） |
| D6 | **预设命令 chips 不进生产**（仅原型测试用）；生产 Dialog 无预设行；原型文件保留为 dev-only 参考（不在 vite build inputs，不随包分发） | 用户 2026-08-19 明确声明 |
| D7 | Rust 两段式仅表单展示：Dialog 呈现 `cargo install <crate>` 安装行（可复制）+ 运行向量；向导试运行与持久化仍只执行运行向量，不代执行 cargo install。**禁跑判定取保守完备语义（R6 修订）：解析后可执行文件经 realpath 归一、basename 小写并剥 .exe，命中 cargo 且 argv 含独立 "install" token 即拒——Cargo 全局带值选项（--color/--config/-C）与 rustup `+toolchain` 前缀会推移子命令位置，逐语法解析必被绕过；代价是罕见「非 install 子命令但参数含 install」会被误拒（failed 提示指引），安全语义「绝不」优先，不得改回仅解析首个子命令的不安全实现** | 用户认知（Rust 不能直跑）+ 运行向量法律 + Codex R4-B1/R6 认可的安全取舍 |
| D8 | 系列 UI 仅作用于 string 模式；argv 模式与 `?edit=` 编辑流保持现状（向量往返精确）。选择非 custom 系列时若处于 argv 模式则切回 string；argv 模式下系列选择器回落 custom | 既有向量精确法律；编辑流不破坏 |
| D9 | 单一解析权威：客户端 Dialog 串行化为命令字符串（build），服务端 prime/submit/export 用同一 core 解析器重析（parse）推导系列、appId 与 env 预设；除 env 预设开关与系列作者状态（R2 修订，见 D11）外不新增命令族 API 字段；create-webui 以手工镜像模块复用 core 纯函数（仓内 wizard-protocol.ts 既有模式）+ 少量金样本防漂移测试 | 包边界法律（webui 无 workspace 依赖）+ 双权威风险规避 |
| D10 | CLI（`--exec` 等flags）与 v1 config schema 本变更不动：系列是向导期创作关注点，持久化产物仍是向量；CLI 分系列提效另立变更 | 范围控制；schema `.strict()` 版本化成本 |
| D11 | 系列作者状态进 `WizardCommandOptions.family`（可空 FamilyFormState 投影，R2 修订）：向导会话区分「作者状态」与「执行向量」——显式 family 投影是系列/appId/env 预设的服务端权威；命令串仍是执行/持久化向量（Rust 的命令串 = 运行行，如 `rg --json .`）。`cargo install` 头的命令解析为 rust 系列但提交运行必须被拒绝（指引到 Dialog 填写运行二进制），向导绝不代执行安装（D7 收紧）。选择器为显式状态源（不再从命令串派生 UI 系列）：同系列重复点击 no-op；custom 自由输入不因输入了 runner 头而翻转。**跨系列切换无需确认/撤销（R5 用户拍板）**：每个系列的表单草稿独立缓存在前端（Dialog 编辑即写缓存，未确定切走再切回不丢） | Codex B1/B4 + 用户 R5：切换无破坏性，表单各系列独立缓存 |
| D11a | Dialog 打开时固定会话快照 `{family, state}`；Dialog 内选择器是明确的「暂存并切换」动作，因此 npm 编辑后切 Go 再切回仍保留该会话草稿。未确认草稿只存于该会话，取消按钮、X、遮罩和 ESC 均丢弃整次会话而不上传。前端投影缓存只保存最新服务端 `commandOptions.family` 或已确定状态：新投影总是刷新缓存；若当前会话该系列尚未编辑，表单立即刷新，若是会话内其它 clean 系列则在重新进入时刷新；若已编辑，保留草稿直到用户明确确定（以本地值写回）或取消（丢弃草稿并采用已缓存的新投影）。取消的回滚锚点始终是打开瞬间快照，不得捕获随后渲染的系列/初值，也不得把快照反向覆盖已到达的新服务端投影。这避免陈旧缓存因普通系列切换反向覆盖服务端权威。 | Codex R6-B2 复核 + 用户 2026-08-19 指定会话快照、SSE dirty 边界与状态化回归 |
| D12 | 参数保真（R2 修订）：FamilyFormState.args 保存「序列化后的参数串」——parse 侧对剩余 tokens 做对称 POSIX 引号序列化（含空白/引号/元字符的 token 加引号），build 直接拼接，保证 tokenize(build(parse(cmd))) === tokens 往返无损；Dialog 的参数输入即该串（所见即所写）。保证域 = tokenizeCommandLine 的接受域（其既有引号配平法则本就拒绝含奇数单引号的 token，先于本变更；序列化仍按 POSIX 规范实现）。无法无损映射的命令回落 custom 而非静默重写 | Codex B5：`npx tool "hello world"` 曾被改义 |
| D13 | 分享确认投影（R2 修订）：客户端 `hasEnv` 与服务端同规则——显式 env 非空 或 激活预设（parse 命令 ∈ npm 系列 npx/pnpx 且未 envPresetDisabled 且无显式同名条目）；预设 env 触发的分享必须出现 ack 入口 | Codex B3：预设导致 env_ack_required 而 UI 无入口 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 智能识别（粘贴识别）/ 配方库（预设优先）两原型方向 | 用户明确选定分域表单并要求删除其它方案 |
| 预设命令 chips 进入生产 | 用户明确「只是测试用，不会落入正式开发」 |
| v1 config / ScaffoldAppConfig 记录 `series` 字段 | 向量已是持久化权威；避免 schema bump 与双事实源 |
| 向导代执行 `cargo install` | 超出运行向量合同；安装是消费者前置动作（D7） |
| webui 添加 @create-opentray/core workspace 依赖 | webui 现无 workspace 依赖，资产预构建分发；沿用手工镜像 + 防漂移测试的仓内模式 |
| 图标库近似品（Squirrel 代表 Go 等）/ webp/png 位图 | 用户要求官方图标且 SVG 优先；lucide Snake 运行时缺失实证图标库风险 |
| 客户端独持系列状态并扩展 /api 命令契约 | 双权威；服务端重析即可（D9） |

## 平台法定位

常规原子（不破法）：Tray-first、caller-owned App、向量持久化、registry/信封法律均不动。本变更修订 `create-wizard` 既有「默认 appId 推导」要求为分系列版（MODIFIED delta），并在 `create-workbench-form` 渐进披露法则下新增系列表单 Dialog 的后果可见性场景（env 预设不可被折叠隐藏）；env 预设完全落入既有 env overlay / ack / 值不回显法律。

## 最终可见效果（操作者视角）

1. 向导命令卡从「自由输入一整条命令」变成：左侧一枚官方生态图标（点开菜单切 npm/Go/Rust/Python/.NET/自定义），主体显示组装好的命令；点主体弹表单 Dialog 分字段填写（runner、包名、版本、参数……），「确定」回写；页面高度不变。
2. 填 `npx @deepseek-ai/dsh@latest web` → 应用 ID 默认 `web.dsh.npmjs`（换 bunx/pnpx 结果相同）；`go run rsc.io/fortune@latest` → `fortune.golang`；Rust 填 ripgrep → `rg.rust`；名称与项目目录随之更新——不再出现 `fortune.run.go` 这类机制段污染。
3. npm 系列（npx/pnpx）运行时输入行出现 Terminal 小图标，悬停/点击看到 `npm_config_yes=true · 跳过 npm 安装确认`；生成的应用与分享脚本里该变量真实生效，首跑无安装确认交互；Dialog 里可移除。
4. 自定义模式与 `?edit=` 编辑流行为与今天完全一致。

## 意图驱动计划

- Core `packages/create/packages/core/src/command-family.ts`：Family 常量、tokenize/parse/build（含 Rust 两段、deno npm: 前缀）、family appId 推导（D3）、env 预设推导（D4）+ `command-family.test.ts`（迁移原型 28 用例为权威测试）。
- Core `app-id.ts`：保留现行推导（custom 路径权威），导出组合入口供 wizard 使用。
- Wizard `wizard.ts`：`currentDefaults()` 接分系列推导；`commandEnv()` 合并预设（envPresetDisabled 可关）；`exportFrozen()`/create 落盘 env 含预设；`WizardCommandOptions` 增 `envPresetDisabled`（server patch 白名单 + 草稿）。
- WebUI：`src/components/command-family/`（brand-icons + input-group + form-dialog，生产版无预设行）；`src/lib/command-family.ts` 镜像 core 纯函数 + 金样本测试；`command-card.tsx` string 模式接入；`wizard-protocol.ts` 镜像类型。
- 验证：core bun test、webui vitest + typecheck、向导端到端手验（npx 预设 env 注入、go/rust/python/dotnet appId、自定义与 ?edit= 回归）。

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| env 预设是否也应在分享脚本中高亮说明？ | 分享产物含注入变量，接收者可能困惑 | 不高亮：分享脚本 env 表现与手动配置一致，ack 机制已把关注 |
| Dialog 内是否保留 appId 实时预览条 | 增强即时反馈 vs Dialog 高度 | 保留轻量预览（镜像推导，仅新 appId + 目录），不再展示旧规则对照（那是评审期工具） |

## Exit Conditions

- Default max review iterations: 2（Codex 复核 + 修订）
- Issue recurrence threshold: 同一问题复发 2 次即升级用户裁决
- Custom exit condition from intent: 分系列 appId、env 预设、单行 InputGroup + Dialog、官方图标、预设不进生产——五点全部落地且既有自定义/?edit= 流零回归
