# wizard-share-and-list-scan — Intent Document SSOT

## 用户原始需求（时间戳记录）

- 2026-08-19：「我之前有要求应用的生成要能分享（直接基于参数去做分享，没生成也能有参数）。这个直接挂在『确定创建应用』旁边，我不知道代码中有没有我相关需求的注释」。
- 2026-08-19：「我现在应用生成完成后，在应用列表中都找不到，列表这里也要支持 查看详情（手风琴展开）、跳转编辑、打开应用、分享应用」。
- 2026-08-19（修订 D6，溯源）：「卸载功能我现在没看到，这个我之前是明确要求的。在应用列表页面要有这个卸载的功能」——原始出处 redesign-create-opentray-webui/interview_plan.md 用户需求 #11：「如果可以，在应用列表中提供卸载功能，不过后续的 macOS-Dock 图标 和 Windows-任务栏图标 的删除估计得用户自己手动操作了」。当时 spec 把卸载收窄为「v1 registrations」，向导布局行因此缺失；本变更补全为两种布局均提供卸载。
- 2026-08-19（分享形态确认）：「对，我之前要求的就是分享成脚本 sh/ps1，可以走下载也可以直接复制到剪切板」。
- 2026-08-19（列表数据源确认）：「我们之前说好的，就是扫描 `~/.opentray/create/*`，为什么你要推荐我走什么注册信封？」——沿用扫描约定，不改变磁盘布局。

## 用户语言系统

- 「分享」= 把应用的创建参数导出为可执行产物（sh/ps1 自包含脚本或命令行串），支持复制/下载；「没生成也能有参数」= 冻结表单态即可分享。
- 「应用列表」= WebUI Applications 页；「查看详情（手风琴展开）」= 行内展开配置详情；「跳转编辑」= 现有 ?edit= 预填流。

## 事实（勘察实证）

1. export 内核（Core buildExportPlan/buildScriptExport、CLI `app export`、workbench `POST /api/apps/:key/export`、WebUI ExportDialog）已全链路存在，但只作用于有 `create-opentray.json` 注册信封的应用。
2. 向导 `create()` 直写 `~/.opentray/create/<key>/`（无信封），`listRegistrations` 明文跳过非信封目录——用户向导生成的应用在 Applications 页/导出按钮上从未出现（用户「没见过这个按钮」的根因）。
3. 「分享」需求在代码注释/OpenSpec/git 历史中此前无任何记录（用户确认后首次落地）。
4. 向导目录的判别标记是 SCAFFOLD_MARKER_FILES（`opentray.app.json` + `main.mjs`）；`opentray.app.json`（ScaffoldAppConfig）含完整可编辑配置（command 向量/cwd/env/window/developerMode）。
5. 向导项目 package.json 不记录包管理器，但目录内有 lockfile（pnpm-lock.yaml 等）——`detectPackageManager(files)` 可推断。

## 决策

| # | 决策 | 依据 |
|---|------|------|
| D1 | 分享产物 = 命令行串 + sh/ps1 自包含脚本（内嵌图标字节），复用 export 内核，不新造格式 | 用户确认；跨机器可执行 |
| D2 | 列表发现 = 扫描 `~/.opentray/create/*`：信封目录走 listRegistrations，无信封但有 SCAFFOLD_MARKER_FILES 的目录按向导应用投影；不动任何磁盘布局 | 用户既有约定，明确否决信封统一 |
| D3 | 向导确认面板挂「分享」按钮（未生成、基于冻结参数） | 用户原始需求 |
| D4 | 列表行支持：手风琴详情、跳转编辑、打开应用、分享应用 | 用户原始需求；打开复用 openMaterializedApp（bundle 优先/冷启动回退） |
| D5 | env 值永不回显（只回显键名/存在性），沿用 export 既定法则 | export.ts 法则 |
| D6 | 卸载对两种布局开放（2026-08-19 修订）：向导项目按脚手架标记验证所有权 → 探测并（经确认）停止运行中的入口进程（按项目绝对路径匹配 argv，整树清理）→ 删除项目目录与 OpenTray-home 内已物化的 Darwin bundle；注册布局维持 uninstallApp 原语义 | 用户需求 #11 溯源修订；注册表「legacy never mutated」法则就此让位于显式卸载契约 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 向导改走 applyCreate 注册信封 | 用户明确否决（沿用扫描约定）；布局破坏性不必要 |
| 卸载仅限注册布局（原范围外声明） | 用户需求 #11 面向整个应用列表；向导项目按脚手架标记验证所有权后同样卸载 |
| 向导 URL 深链分享 | 向导 URL 含 localhost+token，无法分享给他人 |
| 新造「参数串」导入格式 | 用户确认复用 sh/ps1 脚本；不做导入解析端点 |
| 向导项目停止/卸载 | 需 runtime.json/所有权模型，范围外另立变更 |

## 平台法定位

常规原子：不改变 registry 信封法律（信封目录仍由 listRegistrations 独占解释）；scan 是「发现投影层」，只读、不更改磁盘；export 法则（env 不回显、embedded 资源、ack）原样复用。

## 最终可见效果（操作者视角）

1. 向导填完参数（不必生成）→ 确认面板「分享」→ 选 sh/ps1/命令行 → 复制或下载，拿到含完整向量与图标字节的脚本。
2. Applications 页立刻能看到所有向导生成的应用（如 web-dsh-npx）；行可展开查看命令向量/cwd/env 键名/包管理器/窗口/项目目录等详情。
3. 列表行一键「打开应用」（bundle 唤醒或冷启动）、「分享」（同导出对话框）、「编辑」跳转向导预填。

## 意图驱动计划

- Core `scan.ts`：listCreateEntries（双来源统一投影）+ readWizardProjectConfig（ScaffoldAppConfig → 编辑/导出同构 config，pm 按 lockfile 推断，iconSource 取项目内 app-icon/app-icon.png 稳定路径）。
- workbench-api：/api/apps 双来源；/api/apps/:key/config 双布局；新增 /api/apps/:key/open；/api/apps/:key/export 向导分支。
- wizard `exportFrozen()` + server `POST /api/export`（冻结态 → CreateConfigV1 → export 内核）。
- WebUI：确认面板分享按钮；ExportDialog 泛化（runner 注入）；applications 行手风琴详情 + 打开/分享操作；api.ts openApp。
- 验证：scan 单测、exportFrozen 单测、端点集成测试、webui typecheck、端到端手工验收（web-dsh-npx 上列表 + 未生成分享）。
