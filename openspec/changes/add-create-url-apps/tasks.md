# add-create-url-apps — Tasks

## 1. Alignment / Investigation

- [x] 1.1 `plans/plan.md` 已记录完整代码勘察（config/scaffold/entry-template/lifecycle/export/scan/cli 消费点）、现有 specs 触碰面、用户原始需求与 D1–D9 决策；无破坏性迁移（v1 内 XOR 扩展，schemaVersion 保持 1），无需用户确认的重置路径。
- [x] 1.2 每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（trace 到 plans/plan.md 决策与 specs requirement）

- [x] 2.1 config：XOR（url+command 同给 / 两者皆无 → invalid_config）、非 http(s) scheme 拒绝、纯 url 文档解析不合成 command 默认值——`config.test.ts`，trace create-project-config「URL source excludes command semantics」「Non-HTTP URL scheme is rejected」。
- [x] 2.2 app-id：`deriveUrlIdentity` 离线推导（路径段+reversed hostname / 纯 hostname / 非法段回落 app.opentray）——`app-id.test.ts`，trace「URL identity SHALL derive from the address」。
- [x] 2.3 entry/scaffold：URL payload 产物断言（无 PTY import/spawn/端口监控、无 node-pty 依赖、无 app-shell*、icon catalog 在、README URL 形态）——`scaffold.test.ts`，trace generated-app-entry「no supervision」+ materialize「drops PTY and shell assets only」。
- [x] 2.4 export：URL 应用导出含 `--url` 无 command flags、env ack 恒 false、command/ps1 往返——`export` 相关测试（core 或 cli），trace create-resource-export「URL application exports as a URL invocation」。
- [x] 2.5 lifecycle/scan：URL desired state plan/apply 走原事务管线（dry-run effects 等价）、`app list` 健康、payload 投影无 command 合成——trace create-lifecycle-kernel 回归 + create-apps-discovery「URL project projects without command defaults」。
- [x] 2.6 CLI：`create --url` 单独成立（身份自动推导）、`--url`+`--exec` 互斥失败、`app edit` 改 url、`app export` --url 形态——`commands.test.ts`/`options` 测试，trace create-cli-command-tree 三个 scenario。

## 3. Implementation

- [x] 3.1 commit-check research-plan 阶段后先提交 OpenSpec artifacts，再开始产品代码。
- [x] 3.2 Core/config.ts：`url?: string` + `command` 可选 + XOR superRefine + `appSourceOf` helper（discriminate 返回值）；index 导出。
- [x] 3.3 Core/app-id.ts：`deriveUrlIdentity(url)`（纯函数，含 appId 合法性回落）；index 导出。
- [x] 3.4 Core/url-entry-template.ts：URL entry 模板（tray + 直接窗口 + titleSync/iconSync + Quit + app.log 兜底）；scaffold.ts 分支资产（无 node-pty/app-shell，README URL 形态）；ScaffoldAppConfig 类型扩展。
- [x] 3.5 Core/lifecycle.ts：`buildMaterializeInput` url 投影（无 command 段）；planCreate env 计数对无 command 安全。
- [x] 3.6 Core/export.ts：`toCliFlags` url 分支（--url 替代 exec/arg/cwd/env）；env 读取安全化。
- [x] 3.7 Core/scan.ts：`readWizardProjectConfig` command 可缺省 + url 投影。
- [x] 3.8 CLI/options.ts：`url` flag、互斥校验、URL 身份缺省推导；CLI/commands.ts：`create --url` builder + check、`app edit` url patch、`app export` env 计数安全化。
- [x] 3.9 关键效果点意图注释（指向 plan.md D1–D9）。

## 4. Verification

- [x] 4.1 core 与 create 两包 vitest 全绿 + typecheck 全绿（含 create-webui 若受类型影响）。
- [x] 4.2 真实端到端取证（临时 HOME）：`create --url https://example.com --dry-run` 与真实 apply（skipInstall）→ payload 断言（main.mjs 无 spawn、package.json 无 node-pty）、`app list` 健康、`app export --format command` 输出 `--url`。
- [x] 4.3 回归：现有命令应用全量测试不回归（XOR 不影响纯 command 文档）。
- [x] 4.4 self-review（子代理复核）+ `validate`/`check` + 分 phase 提交。

## 5. Docs

- [x] 5.1 packages/create/README.md：命令树/Non-interactive create 增加 `--url`；skill references（cli-reference/how-it-works）同步。
