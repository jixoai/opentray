# wizard-share-and-list-scan — Tasks

## 1. Alignment / Investigation

- [x] 1.1 plan.md 已记录双代理勘察结论（export 链路现状、列表缺口根因、用户需求无历史注释）与全部用户 Q&A。
- [x] 1.2 无破坏性迁移/清理：扫描方案只读，不改磁盘布局。

## 2. BDD Contract

- [x] 2.1 scan：混合目录（信封/向导/外来）分类正确；向导投影含 executable/args/cwd/env/window/developerMode/pm(lockfile 推断)——trace 到 create-apps-discovery R1/R2。
- [x] 2.2 exportFrozen：冻结态（未 create）产出脚本含 --app-id/--exec 向量；上传图标字节内嵌；env 未 ack 拒绝——trace 到 create-share-export R1。
- [x] 2.3 workbench /api/apps 双来源；/open 双布局（bundle 优先/冷启动）；/export 向导分支——trace 到 discovery R3 + share R2。
- [x] 2.4 env 值永不回显（键名/存在性允许）。
- [x] 2.5 每个任务仅由当前工作上下文完成并验证后勾选。

## 3. Implementation

- [x] 3.1 commit-check apply 阶段后先提交 OpenSpec artifacts。
- [x] 3.2 Core scan.ts + index 导出 + scan.test.ts。
- [x] 3.3 workbench-api：/api/apps、/config、/open、/export（向导分支）。
- [x] 3.4 wizard exportFrozen() + server POST /api/export。
- [x] 3.5 WebUI：create-dialog 分享按钮、ExportDialog 泛化 runner、applications 手风琴详情+打开+分享、api.ts openApp、app.tsx 接线。
- [x] 3.6 关键效果点意图注释（指向 plan.md 决策 D1–D5）。

## 4. Verification

- [x] 4.1 core/create/webui 测试 + typecheck 全绿；vision-driven 基线。
- [x] 4.2 端到端：Applications 出现 web-dsh-npx；展开详情；打开应用；行内分享 sh；向导确认面板（未生成）分享 + 复制/下载；注册路径回归。
- [x] 4.3 self-review + validate/check + 提交。
