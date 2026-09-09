# add-create-url-apps — Self-Review (Round 1)

日期：2026-09-09。复核方式：general-purpose 子代理独立审 diff（fast-remix），
主编排者对其结论逐项仲裁后修复。

## 子代理复核结论摘要

评分 6.5/10 → 阻塞 B1（workbench-api.ts 13 处 `config.command` 未适配，
WebUI 列表/预填/导出对 URL 应用崩溃 + 根包 typecheck 实证红）+ 非阻塞
N1（app edit source switch 文案与行为矛盾）/N2（lifecycle、scan 的 URL
直接用例缺失）/N3（tasks 未勾选）/N4（根包 vitest worker 噪声）。

## 主编排者仲裁与处理

- **B1 属实，已修**：workbench-api.ts 五处（hasEnv ×2、config 预填、export
  构造、envCount）改为源条件展开/optional 链，URL 投影不合成 command；
  补 3 个端点用例（列表 healthy hasEnv=false、预填 url 无 command、
  export --url 无 --exec）。
- **教训记录**：主编排者此前对根包 typecheck 的"绿"是假绿——`cmd | head; echo $?`
  取了 head 的退出码（AGENTS.md 已有的「管道吞退出码」纠偏条目再次复现）。
  收尾验证已全部改为显式退出码文件。
- **N1 采纳（实现真 switch）**：app edit 在显式 `--url`（或 `--exec`）时
  丢弃另一源的投影，command ↔ URL 应用可互切；新增 CLI 用例断言切换后
  config 无 command 且 payload 无 app-shell-server.mjs。
- **N2 采纳**：lifecycle 新增 URL desired state 的 plan/apply 用例（经
  materializePayload mock 输入钉住 buildMaterializeInput 投影——本文件
  mock 了 payload，直接断言桩文件缺 opentray.app.json 属测试错误，已改）；
  scan 新增 URL wizard 项目投影用例。
- **N3 已勾**、**N4 确认环境噪声**：顺序全量 225/225 全过，4 个 worker
  启动 error 与断言无关；此前全量并行时 wizard 3 失败同因（单文件复跑
  28/28 绿，与 add-create-command-family 5.8 记录一致）。

## 最终验证证据

- core vitest 全绿（含 16 个新 URL 用例）+ `tsc --noEmit` 0
- cli vitest 34/34（含 6 个新用例）+ typecheck 0
- create 根包 vitest 顺序 225/225 + typecheck 0
- create-webui vitest 62/62 + typecheck 0
- vision-driven 基线 16/16（首轮 5 fail 为机器负载 spawn 超时，空闲复跑绿）
- 端到端取证（临时 HOME，真实 CLI）：`create --url` 身份自动推导
  （`https://dsh.example.com/app` → `app.com.example.dsh`）、apply payload
  无 PTY/shell 资产、`app list` healthy、`app export` 输出
  `--app-id com.example --app-name Example --url https://example.com --pm npm --window 1000x700`

## 遗留（记录不阻塞）

- WebUI wizard 的 URL 创建模式（D8 明确本轮不做，后续 change）。
- compileDesiredConfig 的互斥错误消息在「--config 带 url + 显式 --exec」
  组合下会提 --url 字样（用户未显式给 --url）；安全（拒绝），文案可再磨。
