# add-create-command-family — Tasks

## 1. Alignment / Investigation

- [ ] 1.1 plan.md 已记录原型期全部用户 Q&A 与拍板（尾段方案、InputGroup 形态、图标要求、env Tooltip、预设不进生产）、勘察事实与 D1–D10 决策。
- [ ] 1.2 无破坏性迁移：不改 v1 config schema、registry 布局、CLI 契约；custom/?edit= 流零回归为验收线。

## 2. BDD Contract

- [ ] 2.1 Core command-family：parse/build 往返（11 条金样本命令）、runner 归一（同一包 7 种 npm runner 同 appId）、deno `npm:` 前缀补全、cargo install 两段式——trace 到 create-wizard R1（分域表单/推导）。
- [ ] 2.2 分系列 appId：`web.dsh.npmjs` / `fortune.golang`（旧 `fortune.run.go`）/ `rg.rust`（旧 `ripgrep.install.cargo`）/ `format.ruff.python` / `dotnet-format.dotnet`；custom 保持 `up.compose.docker`；空输入回落 `app.opentray`——trace 到 create-wizard R1。
- [ ] 2.3 env 预设：npx/pnpx 注入 `npm_config_yes=true` 且进冻结导出；移除后不注入；其余 runner/系列零注入——trace 到 create-wizard R3。
- [ ] 2.4 WebUI 镜像金样本：create-webui 镜像模块与 core 同源样本断言防漂移。
- [ ] 2.5 每个任务仅由当前工作上下文完成并验证后勾选。

## 3. Implementation

- [ ] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts。
- [ ] 3.2 Core `command-family.ts`（Family/parse/build/derive/envPresets + index 导出）+ `command-family.test.ts`（迁移原型 28 用例为权威测试）；`app-id.ts` 保持 custom 权威不动。
- [ ] 3.3 wizard.ts：currentDefaults 分系列推导、commandEnv 合并预设、exportFrozen/create env 落盘、WizardCommandOptions.envPresetDisabled（含 server /api/command-options 白名单与草稿持久化、webui wizard-protocol 镜像）。
- [ ] 3.4 WebUI 生产组件 `src/components/command-family/`：brand-icons（vendor 官方 SVG + Pencil）、command-family-input（单行 InputGroup + 域选择器 + 自定义自由输入/只读区）、family-form-dialog（结构化字段 + env 预设行 + 轻量 appId 预览；无预设命令）；`src/lib/command-family.ts` 镜像 + 金样本测试。
- [ ] 3.5 command-card.tsx string 模式接线（argv 模式与 ?edit= 保持现状；选非 custom 系列自动切回 string）；env 指示图标 + Tooltip（hover/click 钉住、垂直居中）。
- [ ] 3.6 关键效果点意图注释（指向 plan.md 决策 D1–D10）。

## 4. Verification

- [ ] 4.1 core bun test + create-webui vitest/typecheck 全绿；vision-driven 基线（`bun test scripts/openspec/vision-driven.test.ts`、`openspec schema validate vision-driven`）。
- [ ] 4.2 向导端到端手验：npx dsh 命令组装 + appId `web.dsh.npmjs` + 运行 env 注入（broker.log/进程 env 证据）；go/rust/python/dotnet 四系列推导；env 移除后消失；custom 与 ?edit= 回归。
- [ ] 4.3 self-review + validate/check + 按 phase 提交。
- [ ] 4.4 Codex 复核（Herdr，gpt-5.6-terra / xhigh，异步）→ 处理结论 → 复验。
