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
