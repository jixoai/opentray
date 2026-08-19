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
- [ ] 4.3 self-review + validate/check + 按 phase 提交。
- [ ] 4.4 Codex 复核（Herdr，gpt-5.6-terra / xhigh，异步）→ 处理结论 → 复验。
