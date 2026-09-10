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

## Round 3/4 补记（2026-09-09 验收轮）

- Round 3（D11–D13 窗口功能）与 Round 4（嵌入探测回退）均由用户验收反馈驱动；测试面 core 197+ / cli 26 / webui 65，typecheck 三层绿。
- 修正自查：此前用 HEAD 请求探测 HN 嵌入策略是误判（HN 仅在 GET 响应携带 X-Frame-Options/CSP）；本轮以 GET 抓取头为准并写入文档。教训：策略检查必须用与浏览器一致的方法（GET）。
- CPU 战线（另一 change 的前置）：darwin set_activation_policy 变更检测已提交（broker 77.3%→4.4% 实测）；facade 轮询的 ABI 根因与两阶段修复路径已由子代理调研归档，待用户排期。

## Round 5–11 补记（2026-09-10 验收轮，终态）

11 轮用户验收循环（图标体系全线），每轮独立实例走查后才请验收；两个走查中发现的缺陷当轮修复复验：

- **R10-1 根因订正**：换链图标残留最初归因 HTTP 缓存；实测 `/api/icon-data` 本就 `no-store`，真机制是 React src 字符串不变则不重取。修复（`?g=<generation>` 缓存穿透）不受影响，判定依据已订正进 tasks.md 14.1。
- **R10 走查自抓 bug**：替换回收同序号槽位但代际不变 → 缩略图二次残留；修复为替换路径递增 iconGeneration（纯追加仍稳定，D19 语义不变）。
- **模型内联一轮回退**：D17c vendor 79MB 随包发布 → D18 用户拍板改后端磁盘缓存代理（发布包回 4MB）；quint8→fp16 有像素实证（残留覆盖 0.175→0.081）。
- **免按钮化（D21）**：设置变更 500ms 尾沿防抖自动重提取，在途变更挂起恰好一次 trailing；选中态下代际变更自动重提交选中，搭既有前景管线自动重新融合——不新建第二条融合路径。

### 终态验证证据

- create 46/46（generation/替换语义/imgly 代理）、create-webui 68/68（postProcessSubject 3 项）、core scrape 31/31、icon 15/15；typecheck 双零；`openspec:vision validate` 通过；vision-driven 基线 16/16。
- 实机走查：换链穿透（baidu→wikipedia，`?g=` 跳变 + 视觉确认）；shrink 2/4px 重提取服务端字节哈希实测变化（4576B→1583B）；替换后形状恒 1 主体 + 2 剪影；滑杆/模型钮免按钮自动重提取（g=1→2→3）；合成 key 三换（`1a5e…→2c78…→1971…`）；全图含 1024px 合成预览解码 `complete:true`。
- 版本链：53f431d / a0c2245（R5）→ 6ca26b4 → fcdd8b4 → 8ab52f8 → dd50f72 → 17d0ff9 → 0d9d8ee（R6–R11）。
- 用户终审：「可以了，整理收尾，发布新版本」（2026-09-10）。

### 遗留（记录不阻塞）

- 提取「边缘外扩」（dilate）候选——量化模型切多时的对称出路，实现成本低，待用户需要时另起小轮。
- URL 卡客户端乐观源地址显示（服务端 urlSource 为准）；IPC 轮询两阶段修复（既有 backlog）。

