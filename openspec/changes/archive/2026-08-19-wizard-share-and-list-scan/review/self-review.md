# Self-Review — wizard-share-and-list-scan

Reviewer: ZCode (GLM). Date: 2026-08-19. Iteration: 1.

## 实现与意图对照（plans/plan.md 决策 D1–D5）

| 决策 | 实现 | 证据 |
|------|------|------|
| D1 分享=命令行+sh/ps1（复用 export 内核） | workbench /export 与向导 /api/export 全部走 buildExportPlan/buildScriptExport | E2E：行内分享输出内嵌 PNG base64 的自包含脚本 |
| D2 扫描 ~/.opentray/create/* 双布局 | Core scan.ts listCreateEntries（信封→registry；向导标记→投影；其余忽略，只读） | scan.test 6/6；E2E：web-dsh-npx 以 source=wizard 上列表 |
| D3 确认面板分享（未生成） | wizard exportFrozen + POST /api/export + 确认面板「分享」按钮 | E2E：prime→confirm→export 出脚本；create root 目录数不变（零物化） |
| D4 列表行：详情/编辑/打开/分享 | 手风琴详情（config 投影，env 只显键名）；编辑复用 ?edit=；/open 走 openMaterializedApp；分享复用 ExportDialog | E2E：/open 唤醒 `~/.opentray/apps/web-dsh-npx/DeepSeek Harness.app` |
| D5 env 值不回显 | 列表仅 hasEnv；详情仅键名；未确认拒绝不携值；已确认完整导出含值（契约明示） | workbench-api.test 断言 409 body 无值 |

## Deviations from intent

1. **/api/apps/:key/export 改为按 key 寻址**（原按 body.appId + loadRegistration）：双布局统一寻址的必要重构；CLI export 命令不受影响（走 Core 导出而非该端点）。
2. **手风琴用自研单开折叠**而非 shadcn Accordion 组件：行内含多操作按钮，包进 AccordionTrigger 会误触发折叠；行为等价（单开、aria-expanded）。
3. **向导行隐藏卸载按钮**：无 runtime.json/所有权模型（范围外已声明），避免不可信操作入口。

## New questions requiring user confirmation

1. 向导项目的「卸载/删除」入口（rm -rf 项目目录 + 清 bundle）是否需要？需要的话另立变更定义所有权与确认语义。
2. CLI `app list` 是否同样接入双布局扫描（本次只改 WebUI 工作台，范围外已声明）。

## Evidence paths

- 测试：core 139 / create 205 / webui 15 全绿（新增 scan 6、workbench-api 5、exportFrozen 3）。
- E2E（构建产物 + 真实服务器）：列表双布局 ✔；config 投影 ✔；行内分享 sh（内嵌图标 base64 + 精确 argv）✔；冻结分享（未生成，零物化）✔；/open bundle 唤醒 ✔；退出整树清杀 + 3080 释放 ✔。

## Git evidence

- `c6a2c12` docs(spec) → `548233d` feat(create) 实现+测试+任务状态（同提交）。
- 任务勾选均由当前工作上下文完成并验证后勾选。

## Loop / exit-condition judgment

- 迭代 1，无未解决问题复发。
- Codex 复核仍环境阻塞（HERDR_ENV != 1，与上一变更相同）。
- 归档待用户验收。
