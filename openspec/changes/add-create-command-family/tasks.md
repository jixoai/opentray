# add-create-command-family — Tasks

## 1. Alignment / Investigation

- [x] 1.1 plan.md 已记录原型期全部用户 Q&A 与拍板（尾段方案、InputGroup 形态、图标要求、env Tooltip、预设不进生产）、勘察事实与 D1–D10 决策。
- [x] 1.2 无破坏性迁移：不改 v1 config schema、registry 布局、CLI 契约；custom/?edit= 流零回归为验收线（4.2 证据：custom 推导与 argv 模式路径未动，wizard.test 全绿）。

## 2. BDD Contract

- [x] 2.1 Core command-family：parse/build 往返（11 条金样本命令）、runner 归一（同一包 6 种 npm runner 同 appId）、deno `npm:` 前缀补全、cargo install 两段式——core `command-family.test.ts`，trace 到 create-wizard R1/R2。
- [x] 2.2 分系列 appId：`web.dsh.npmjs` / `fortune.golang`（旧 `fortune.run.go`）/ `rg.rust`（旧 `ripgrep.install.cargo`）/ `format.ruff.python` / `dotnet-format.dotnet`；custom 保持 `up.compose.docker`；空输入回落 `app.opentray`——同上，trace 到 create-wizard R1。
- [x] 2.3 env 预设：npx/pnpx 注入 `npm_config_yes=true` 且进冻结导出（exportFrozen 断言 `npm_config_yes=true` 进 sh 脚本）；移除后不注入；其余 runner/系列零注入——wizard.test「injects the npm-series env preset…」+ exportFrozen 用例，trace 到 create-wizard R3。
- [x] 2.4 WebUI 镜像金样本：`src/lib/command-family.test.ts` 与 core 同源断言（appId 六系列、rust 二进制身份、deno 补全、名称/目录投影、env 边界）。
- [x] 2.5 每个任务仅由当前工作上下文完成并验证后勾选。

## 3. Implementation

- [x] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts（6b09564 docs(spec)）。
- [x] 3.2 Core `command-family.ts`（Family/parse/build/derive/envPresets + index 导出）+ `command-family.test.ts`；`app-id.ts` 保持 custom 权威不动。
- [x] 3.3 wizard.ts：currentDefaults 分系列推导、commandEnv 合并预设（用户显式条目优先）、exportFrozen/create env 落盘、`WizardCommandOptions.envPresetDisabled`（server /api/command-options 白名单 + 草稿随 command-options 事件持久化 + webui wizard-protocol 镜像）。
- [x] 3.4 WebUI 生产组件 `src/components/command-family/`：brand-icons（vendor simple-icons 官方 SVG + Pencil）、command-family-input（单行 InputGroup + 域选择器 + 自定义自由输入/只读区 + env 指示图标 Tooltip hover/click 钉住）、family-form-dialog（结构化字段 + Rust 安装行展示 + env 预设行 + 轻量 appId 预览；无预设命令）；`src/lib/command-family.ts` 镜像 + 金样本测试。
- [x] 3.5 command-card.tsx string 模式接线（argv 模式与 ?edit= 保持现状；选非 custom 系列自动切回 string）；command-family-input 内实现。
- [x] 3.6 关键效果点意图注释（指向 plan.md 决策 D1–D10）。

## 4. Verification

- [x] 4.1 core bun test 169 绿（新增 command-family 26 项）；create vitest 240 绿（更新 12 项为新法则 + 新增 env 预设 BDD）；create-webui vitest 47 绿（新增镜像金样本 4 项）+ 三包 typecheck 全绿；vision-driven 基线（16 绿、schema valid）。
- [x] 4.2 向导端到端（真实 server，HOME=/tmp/ot-e2e-home）：prime 六系列 → snapshot 默认值 `web.dsh.npmjs`/`Web Dsh`/`web-dsh-npmjs`、`fortune.golang`/`fortune-golang`、`hello.cowsay.npmjs`（bunx 归一）、`ripgrep.rust`、`format.ruff.python`、`dotnet-format.dotnet`、custom `up.compose.docker`；env 预设直接证据：`envPresetDisabled=false` 运行 npx 子进程 env `npm_config_yes=true`，`=true→undefined` 随开关翻转（子进程写文件取证）；GUI 冒烟：向导页渲染系列选择器/只读命令区/命令选项折叠区无 error overlay，env 指示图标随开关出现/消失，App ID placeholder 为家族推导值。注：spawn 级断言来自 wizard.test 接缝用例（PTY 输出不走 SSE log 事件，故 env 取证用子进程落盘）。
- [x] 4.3 self-review + validate/check + 按 phase 提交（R2 完成后收口，见 review/self-review.md）。
- [x] 4.4 Codex 复核（Herdr，gpt-5.6-terra / xhigh）第一轮完成：3.5/10，阻塞 B1–B5 全部采纳并修复（见第 5 节）；结论存 /tmp/codex-review-add-create-command-family.md；二次复核进行中。

## 5. Round 2（Codex 复核 3.5/10 → B1–B5 修复）

- [x] 5.1 backup-plan → plan-v1.md；plan.md Round 2：D9 修订 + 新决策 D11（系列作者状态进 WizardCommandOptions.family，Rust crate/binary 不再依赖命令串；cargo install 禁跑）、D12（args 对称 POSIX 引号序列化，保证域=tokenizer 接受域）、D13（客户端 hasEnv 与服务端同规则）。
- [x] 5.2 B5：core+webui serializeArg/serializeArgs（空白/元字符加引号、空 token → ''）；往返金样本（core 172 绿 / webui 48 绿）。
- [x] 5.3 B1：WizardCommandOptions.family 作者状态（服务端 familyState() 权威：currentDefaults/commandEnv 统一走它）；submitCommand 对 cargo install 头 failed 拒绝（绝不 spawn）；server 白名单接受投影/null；bin.ts 草稿恢复 commandOptions（含 family/envPresetDisabled）。
- [x] 5.4 B2：app.tsx /api/command-options body 补 envPresetDisabled + family。
- [x] 5.5 B3：app.tsx hasEnv 同规则（显式 env 或激活预设 → 分享确认入口）。
- [x] 5.6 B4：选择器显式状态源（selection 保持用户意图；同系列点击 no-op；custom 输入 runner 头不翻转 UI）；Dialog 确定/切族上传作者状态；rust 作者草稿 per-family 缓存。
- [x] 5.7 修复后 E2E（真实 server，HOME=/tmp/ot-e2e-home-2）：rust 投影 + 命令串 `rg --json .` → appId `rg.rust`/目录 `rg-rust` 稳定；`cargo install ripgrep` 提交 → failed 指引文案且未 spawn；npm 投影 env true → disabled=true → undefined → family:null 回派生（commandOptions 快照证实）；GUI：选择器/只读区/env 图标渲染无错误浮层。
- [x] 5.8 测试与已知环境问题：core / create / webui 通过，三包 typecheck 绿。曾出现的全量序列 20s 超时已定因：E2E 残留向导进程抢占资源（`pkill -f "create/src/bin.ts"` 清理后全量 246/246 全绿，单文件多轮全绿）——非代码回归。

## 6. Round 3（Codex R2 复核 5.5/10 → 剩余阻塞闭合）

- [x] 6.1 R2-B1（恢复链）：`CommandFamilyInput` 以 `commandOptions.family` 驱动 selection 初值/SSE 同步与 dialogInitial（优先级：服务端投影 > 本地草稿 > 命令解析 > 空模板）；E2E：rust 投影 + `rg --json .` 重启后快照恢复（command/投影/appId `rg.rust`）且 UI 显示 Rust 选择器 + 只读区 `rg --json .`。
- [x] 6.2 草稿机制缺陷修复（恢复链依赖）：`writeDraft` 并发 read-modify-write 丢失更新 → promise 链串行化（E2E 复现→修复后草稿三键完整）；`readDraft` form 门槛放宽为 form/command/commandOptions 分键恢复。
- [x] 6.3 R2-B2（带值 flag）：runner 选项区仅接受已知无值 flag 白名单（deno -A/--allow-*/--no-*/-q…、npx -y/--yes），白名单外/带 = 的 option 保守回落 custom 且 raw 用序列化保真（core+webui 同源）；金样本：`deno run --config 'path with spaces' npm:cowsay` → custom 且往返逐项相等。
- [x] 6.4 非阻塞采纳：cargo install 拒绝前移到 `session.stop()` 之前（不中断存活预览）；server/bin 共用 `normalizeFamilyProjection`（同一接受集合）。
- [x] 6.5 spec delta 跟进 R2 行为：新增「Family Authoring State SHALL Survive Reloads And Never Execute Installs」需求（恢复/禁跑/带值 flag 三场景）。
- [x] 6.6 回归：core 31 / create 246 / webui 49 全绿；三包 typecheck 绿；validate 通过。

## 7. Round 4（Codex R3 复核 6.0/10 → 剩余两阻塞闭合）

- [x] 7.1 R3-B1（cargo 路径绕过）：submitCommand 禁跑升级为两级判定——字面头快路径之外，按「解析后的可执行文件名」（resolveOnPath，新增 WizardOptions seam）basename 判 cargo 且首个非选项子命令为 install 即拒绝（覆盖 `/opt/homebrew/bin/cargo install`、`cargo --offline install` 等路径/别名/全局 flag 形式）；wizard.test 新增路径形式 + seam 解析 + 非 cargo 不受影响三用例。
- [x] 7.2 R3-B2（客户端 tokenizer 近似）：create-webui 依赖 shell-quote（与 core 同版本 ^1.10.0），镜像 tokenizeCommand 重写为与 core tokenizeCommandLine 逐行对齐的 shell-quote 适配（配平检查 + op 拒绝，!ok → 空数组走 custom 回落）——消除轻量近似差异域，客户端投影不再基于错误解析；转义金样本（`npx tool a\ b` → 单 token `a b` 往返相等）进 core 与 webui 两份测试。
- [x] 7.3 UI 可供性：系列选择器前缀加下拉箭头（品牌图标 + ChevronDown，w-11）；含用户手动微调的两端布局（justify-between + ms-2/me-0.75），生产与原型同步。
- [x] 7.4 回归：core 32 / create 248 / webui 49 全绿；三包 typecheck 绿；webui 生产资产已重建。R4 复核待用户恢复 Codex 环境后进行（本轮 codex 会话异常由用户接手处理）。

## 8. Round 5（用户拍板遗留项落地）

- [x] 8.1 跨系列切换：确认/撤销不做（用户拍板）——表单独立前端缓存做实：Dialog `onDraftChange` 字段级写 per-series authoringRef，未确定切走再切回不丢（plan D11 修订）。
- [x] 8.2 env 唯一可信源（plan D4 R5 修订 + spec delta「single source of truth」场景）：Dialog 预设控件改为 env 配置行的双向投影——启用 = env 行写 `npm_config_yes=true`；移除 = 删条目 + `envPresetDisabled=true`（杜绝移除后被默认注入复活）；三态展示（explicit 显用户值 / default 默认注入 / off）；外面手动改动经 SSE 即时回灌 Dialog。输入行图标改为「将携带即点亮」，Tooltip 区分来源（显式条目显示用户值 + 唯一可信源说明）。
- [x] 8.3 E2E（HOME=/tmp/ot-e2e-home-5，子进程落盘取证）：env 行显式 true → 子进程 true；显式 false → 子进程 false（用户值优先）；删条目 + disabled → undefined。服务端法则（显式优先/默认注入）不变，create 248 既有用例零改动通过。
- [x] 8.4 回归：webui typecheck + 49 测试绿；生产资产重建。GUI 图标联动留用户浏览器自查（IAB 面板当时不可用）。

## 9. Round 6（Codex R4/R5 复核 5.0/10 → 三阻塞闭合）

- [x] 9.1 B1（cargo 分类器绕过）：判定重写为保守完备语义——解析后可执行文件经 realpath 归一（覆盖 PATH 软链接别名）、basename 小写比较并剥 .exe（覆盖 CARGO.EXE），命中 cargo 且 argv 含独立 "install" token 即拒（覆盖 --color always/-C <dir>/+nightly 等带值选项与工具链前缀推移子命令的绕过；宁可误拒罕见含 install 参数的其它 cargo 子命令）。wizard.test 新增带值 flag/工具链/大小写/真实 symlink 四类反例。
- [x] 9.2 B2（切走覆盖草稿）：switchFamily 保留 per-series 前端缓存——已有缓存（含 Dialog onDraftChange 写入的未确定编辑）直接恢复，仅首次进入落空模板；切走再切回表单不丢（D11 R5 承诺成立）。
- [x] 9.3 B3（重复 env 键投影不一致）：lib 新增 explicitEnvValue（last-wins，与服务端顺序写入语义一致），图标/Dialog/Tooltip 投影统一取最后同名条目；重复键金样本进 webui 测试。
- [x] 9.4 tokenizer 差分金样本（非阻塞采纳）：未闭合引号/重定向/命令替换 → custom 回落，webui 镜像与 core 同源断言。
- [x] 9.5 回归：create 249 / webui 51 / core 32 全绿；typecheck 绿；生产资产重建。jsdom 组件交互测试记录为后续（webui 现无组件测试环境）。

## 10. Round 7（Codex R6 复核 6.5/10 → B2 生命周期闭合）

- [x] 10.1 取消丢弃：FamilyFormDialog 以 committedRef 区分确定/取消，取消（含 DialogClose/遮罩/ESC 关闭）回调 onCancel → CommandFamilyInput 把 per-series 缓存回滚到本次打开时初值；「编辑→取消→重开」不再看到已取消的值。
- [x] 10.2 投影播种：serverFamily 首次到达且该系列无本地缓存时写入 authoringRef——「恢复 npm（pkg cowsay）→ 切 Go → 切回 npm」不再退化为空模板。
- [x] 10.3 组件交互测试（Codex 连续两轮点名）：webui 引入 jsdom + @testing-library/react（devDeps；vitest include 扩到 .tsx），新增 command-family-input.test.tsx 三序列——播种切回保留 / 编辑取消重开丢弃 / 确定回写命令与作者投影。
- [x] 10.4 误拒边界入法：plan D7 R6 修订 + spec delta 明确 cargo 保守判定（realpath 归一/小写/剥 .exe + argv 含独立 install 即拒，禁止收窄回首子命令解析）。
- [x] 10.5 回归：create 249 / webui 54（+3 组件）/ core 32 全绿；typecheck 绿；validate 通过；生产资产重建。

## 11. Round 8（算法升级：Codex gpt-5.6-terra/max 接管 B2 实现）

- [x] 11.1 升级依据：评分 6.5→6.0 两轮震荡触发「停止自行实现交给 Codex（max）」规则；Codex 52 分钟完成实现。
- [x] 11.2 DialogSession 会话模型：打开瞬间冻结 {family, state} 快照（取消四路径——按钮/X/遮罩/ESC——整体丢弃会话）；SSE 不改写快照。
- [x] 11.3 Dialog 内系列切换入口（「暂存并切换」语义）：未确认编辑在会话内跨系列保留，「npm 编辑→切 Go→切回 npm」不丢；确定仅提交当前系列。
- [x] 11.4 投影缓存与会话草稿分离：projectionCache 永远可被新服务端投影刷新（陈旧草稿无法反向上传）；会话内当前系列未编辑时随 SSE 刷新、已编辑保留至确定/取消（合流规则记入 plan D11a）。
- [x] 11.5 状态化组件测试（rerender 模拟 SSE）：R6 点名的 (a) 编辑中投影更新后取消、(b) 已播种后新投影再切走切回、(c) 编辑中跨系列切换返回 + 取消四路径全覆盖；webui 58 项。
- [x] 11.6 验证：webui 58 / create 249 / core 32 全绿；typecheck 绿；validate 通过；生产资产重建；GUI 冒烟无错误浮层。

## 12. Round 9（Codex R8 复核 7.8/10 → 剩余两项闭合）

- [x] 12.1 R8-B1（组合测试缺口）：新增 it.each(cancellationPaths)×「Dialog 内 npm 编辑→切 Go 编辑→切回 npm 后取消」组合——断言 npm 重开为打开快照、Go 会话草稿不可恢复、外层命令串未因编辑/取消上传；跨系列确定用例补「命令含 draft-npm 且不含 Go 草稿」payload 断言（确定仅提交当前系列）。webui 62 项。
- [x] 12.2 R8-B2（意图注释治理）：command-family-input.tsx 与 family-form-dialog.tsx 头部补齐用户原始需求（时间戳）+ 正交意图清单 + 妥协声明（会话 reducer 拆分推迟至归档后重构轮，理由记录）。
- [x] 12.3 回归：webui 62 / create 249 全绿；typecheck 绿；生产资产重建。core 全量在复核侧环境因宿主进程检查用例失败（lifecycle/resources，非本变更面）；我侧 core 定向 32 绿。
- [x] 12.4 R9 针对性复核（/tmp/codex-review-add-create-command-family-r8.md）：B1/B2 双双判定闭合、无新阻塞，**综合评分 9.4/10（7.8 → +1.6），通过本轮复核**。评分轨迹：3.5 → 5.5 → 6.0 → 5.0 → 6.5 → 6.0 → 7.8 → 9.4。遗留非阻塞（复核明确不影响闭合）：确定路径 callback recorder 精确断言作者投影、command-display/command-options 分离 SSE 事件乱序测试。

## 13. Round 10（用户浏览器验收：env 投影实时同步缺陷 → 语义终版）

- [x] 13.1 用户验收发现：外部移除 npm_config_yes 后 Dialog 未显示「+ 启用」——根因是「默认注入」隐形状态与 envPresetDisabled 残留开关与「唯一可信源」心智不符。用户拍板：外部移除 = 未启用（+ 启用入口）。
- [x] 13.2 语义终版（D4 R10）：废除隐形注入与 envPresetDisabled 字段——预设仅以 env 行显式条目生效（wizard commandEnv 移除注入逻辑；server 白名单/bin 草稿归一/protocol/app POST 移除字段）；Dialog 二态（explicit 显值 / off 显示「+ 启用」）；输入行图标 = 条目存在才点亮，Tooltip 统一「来自环境变量配置」；移除 = 纯删条目。
- [x] 13.3 测试更新：注入类用例改显式（无条目不注入/显式条目生效/删除即关闭/作者状态不驱动 env/冻结导出含显式条目）；spec delta 需求重写为「Explicit Projection Of The User Env List」。
- [x] 13.4 回归：webui 62 / create 249 全绿；typecheck 绿。
