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

## 6. Round 2（用户验收轮：URL 创建抓取预设，D10）

- [x] 6.1 backup-plan → plan-v1.md；plan.md 新增 D10：URL 创建默认抓取页面 title/favicon 作预设（flag > --config > 预设 > 地址推导；appId 恒地址推导；--no-scrape 关闭；失败静默回落；edit 不抓取）。
- [x] 6.2 Core/scrape.ts：scrapeUrl 提炼（scrapeService 变 loopback 包装；/favicon.ico 兜底按站点根解析）+ deriveUrlPresets（title 截断 80、favicon 走已规范化临时文件）+ index 导出。
- [x] 6.3 CLI：compileDesiredConfig enrichment 注入点；create --scrape/--no-scrape（yargs 否定式，default true）；runCreate 抓取接线 + progress 提示；appIconSource 预设回填。
- [x] 6.4 测试：scrape.test 4 项（任意地址抓取、根化兜底、预设/失败、title 截断）；commands.test 既有 URL 用例 --no-scrape 化 + 4 项 D10 e2e（fixture server 预设进 committed 配置/快照、显式 flag 优先、--no-scrape、不可达回落）。
- [x] 6.5 specs delta：create-cli-command-tree MODIFIED requirement 修订 no-scraping 条款（命令模式不抓保持）+ 两个新 scenario；README/skill 三件套同步。

## 7. Round 3（用户验收轮：窗口导航/toolbar/sync 默认值，D11–D13）

- [x] 7.1 backup-plan → plan-v2.md；plan.md 新增 D11（快捷键分层：wrapper 键盘 + 托盘 Reload）、D12（URL toolbar：shell 资产回归、无 PTY）、D13（titleFollowsDocument 默认 true 单向 / iconFollowsDocument 默认 false opt-in，进 v1 config 往返）。
- [x] 7.2 Core/config：window 加 toolbar/titleFollowsDocument/iconFollowsDocument（zod 默认填充）；scaffold URL 分支 hostShell=toolbar；url-entry-template：toolbar 包装窗 + 无 sync、直连窗 titleSync 单向 + iconSync opt-in、托盘 Reload（evaluate location.reload()）；命令模板服务窗口同步 D13 投影。
- [x] 7.3 Core/export：--toolbar/--no-title-follow/--icon-follow 仅在偏离默认时序列化；CLI create/edit flags（yargs 无 default，避免吞 --config 文档值）。
- [x] 7.4 create-webui browse-page：⌘/Ctrl+←→/[]、⌘/Ctrl+R、F5、⌘/Ctrl+L 快捷键（wrapper 焦点域）+ jsdom 测试 3 项；dist 重建（browse.html 相对路径修正）。
- [x] 7.5 测试：config（window 默认/显式）、scaffold（toolbar 资产/无 PTY/包装窗断言 + URL 默认 sync 断言更新）、CLI（flags e2e + export 往返 + patches-only 断言随持久 sync 字段更新）。
- [x] 7.6 文档：README + skill 三件套同步（含 iframe 嵌入与快捷键焦点限制的明示）。

## 8. Round 4（用户验收轮：toolbar 嵌入探测回退）

- [x] 8.1 根因实证：HN 的 GET 响应带 X-Frame-Options: DENY + CSP frame-ancestors 'self'（此前 HEAD 探测误判，已修正检查方法与文档表述）。
- [x] 8.2 Core/scrape：responseHeadersAllowEmbedding（XFO 除 ALLOWALL 拒绝；CSP frame-ancestors 无通配拒绝）；ScrapeResult/deriveUrlPresets 透传 frameEmbeddable。
- [x] 8.3 CLI：--toolbar 遇 frameEmbeddable===false 打印明确警告并回退直连 payload（delete flags.toolbar）；--no-scrape 无探测数据时请求照常（限制已文档明示）。
- [x] 8.4 测试：scrape 31（策略矩阵 + 预设投影）、CLI 26/26（fixture /deny 路由 e2e：警告 + 无 shell 资产；允许路由保留 toolbar）；用例生命周期归位（fixture server 的 afterAll 时序修复）。
- [x] 8.5 实机验证：HN --toolbar 自动回退（警告可见）；Wikipedia --toolbar 获得 true toolbar（地址栏 + 快捷键 + 托盘 Reload）。

## 9. Round 5（用户验收轮：图标背景自动选择的边缘环规则，D14）

- [x] 9.1 kernel compose.ts：`foregroundStats` 增边缘环统计（环宽 `max(2, round(min(w,h)×0.04))`，`edge: { opaque, luminance, uniform }`，uniform 容差 24/255）；`autoBackground` 满幅分支匹配实色环（white-pad→white、black-pad→black），无环旧调用行为不变；`ForegroundEdgeStats` 导出。
- [x] 9.2 测试：icon.test.ts autoBackground edge 参数矩阵（白环/黑环/杂色/不连续）+ foregroundStats 白底 fixture 实测（手工 PNG 编码器——kernel 无 sharp 依赖，测试不引入原生依赖）；15/15 全绿。
- [x] 9.3 `pnpm --filter @opentray/icon build` 重建 dist；create-core icon-compose 4/4（wizard `analyzeIconForeground` 直传 stats 零改动受益）。
- [x] 9.4 实证：生产路径探针（deriveUrlPresets 抓真实 en.wikipedia.org favicon）→ `edge {opaque 1, luminance 0.996, uniform true}` → 建议 white；独立向导实例 API + 浏览器走查（「白色 自动」选中、预览白底黑标、squircle 外角透明像素核验）；create-webui owner-law 注释同步。

## 10. Round 6（用户验收轮：图标候选 UX 三项，D15–D16）

- [x] 10.1 #3 定性：zh.wikipedia.org 的两个纯黑候选 = scrape 管线的 `solid-black` alpha 蒙版剪影（macOS 托盘模板素材，探针实证 4 候选 = 2 原图 + 2 剪影）；根因是 app-form 渲染候选未过滤 variant（icon-picker 有过滤）。
- [x] 10.2 #1+D15：图标合成卡片（背景/缩放/预览）仅在有生效前景时渲染（values/defaults.iconPath 或上传）；app-form 候选行过滤为 original+subject（含「AI 主体提取」title/alt）；`trayIconIsSolid` 收窄为仅 solid-*（wizard.ts 两处）。
- [x] 10.3 #2+D16 服务端：`IconVariant` 增 `"subject"`；wizard 会话新方法 `addIconCandidate(port, {bytes, variantOf, width, height, format})`（state/port/variantOf 守卫、字节落会话拥有 temp dir、index 顺延、emit icons 事件）；server 新路由 `/api/icon-candidate`（裸字节 + query 元数据，400/409 分级）。
- [x] 10.4 #2 webui：`subject-extraction.ts` 懒加载 @imgly/background-removal（isnet_quint8 + device gpu）；app.tsx 自动提取 effect（每源候选每页面会话一次、frozen/materializing/success 不跑、失败静默、spinner 状态经 prop 链入 app-form）；候选/托盘选择器认识 subject 变体。
- [x] 10.5 构建链：webui 依赖 `@imgly/background-removal@^1.7.0` + `onnxruntime-web@1.21.0`（peer 精确锁）；`scripts/prune-ort-wasm.mjs` 剪除 Vite 复制的死重 ort wasm（imgly#147；dist 26MB→4MB）并入 build 链。
- [x] 10.6 测试：wizard.test addIconCandidate 2 项（追加+事件+containment+可选；端口/未知源拒绝）、server.test 路由 1 项（200+icon-data 服务+409+400）；create 43、webui 65 全绿，typecheck 双零。
- [x] 10.7 实机走查（独立实例 47812 + 内置浏览器）：空态背景卡片隐藏 ✓；zh.wikipedia 预设后卡片显示（白色 自动，D14 生效）✓；应用图标行仅 2 原图（纯黑剪影移出）✓；「AI 提取主体中…」→ CDN 模型分块下载 → `AI 主体提取 160×160 PNG` 候选落地 → 点选后分析（明度 0.47/覆盖 18%）自动建议白色 ✓；截图视觉确认（3 候选 + 透明底 W 主体 + 白底合成预览）✓。

## 11. Round 7（用户验收轮：卡片显隐语义修正 + 剪影算法替代 + 模型内联，D17）

- [x] 11.1 卡片显隐改权威源：预设会把 iconPath 提交进服务端 form（与手选不可区分），显隐改用 webui 自身 `selectedIconRef`/`uploadedIconUrl`——预设态隐藏、点选/上传后显示（走查实证：预设态 card:false → 点选后 card:true）。
- [x] 11.2 剪影算法替代：scrape.ts 移除原图蒙版剪影生成（zh.wikipedia 双黑候选根因）；`renderSolidSilhouette`/`SOLID_SIZE` 导出；`addIconCandidate` 在 subject 落库后从 subject alpha 蒙版派生 solid-black/white（像素实证：剪影 coverage 0.191 = W 主体形状，旧算法为 ~1.0 实心方块）。
- [x] 11.3 模型内联：`vendor-imgly-data.mjs`（quint8 + 双 wasm/mjs loader 共 22 分块 ~79MB，.imgly-cache 缓存，失败降级警告）入 build 链；server 增 `/imgly-data/*` 静态路由；subject-extraction 本地 publicPath 优先 + CDN 兜底；copy-webui 的 shell 拷贝排除 imgly-data；create-webui/.gitignore（dist/.imgly-cache）。
- [x] 11.4 测试：scrape 断言改为「无 solid 输出」；wizard addIconCandidate 用真实 PNG fixture 断言 subject + 双剪影派生（variants/尺寸/containment）；core 31、create 43、webui 65 全绿，typecheck 双零。
- [x] 11.5 走查（独立实例）：模型 100% 本地加载（localChunks 21 / cdnChunks 0）；预设态卡片隐藏；主体候选落地；点选后卡片出现且「白色 自动」；高级托盘选择器出现「黑色纯色/白色纯色」subject 派生剪影。

## 12. Round 8（用户验收轮：模型后端缓存代理 + fp16 质量，D18）

- [x] 12.1 后端缓存代理：`/imgly-data/<version>/<file>` 路由（形状严格校验、`~/.opentray/cache/imgly-data/<version>/` 持久磁盘缓存、temp+rename 原子提交、in-flight 去重、16MB 单文件上限、immutable 缓存头、上游可注入测试缝）。
- [x] 12.2 前端：版本化 publicPath `/imgly-data/<IMGLY_DATA_VERSION>/`（版本 pin 由 `check-imgly-version.mjs` 入 test 链守卫）；模型切 isnet_fp16；progress 回调 → spinner 文案（下载百分比/推理中）；浏览器不再直连 CDN。
- [x] 12.3 删除构建期 vendor：vendor-imgly-data.mjs、build 链项、.imgly-cache、copy-webui 排除、dist/imgly-data（webui dist 回 4MB，发布包不再携带模型）。
- [x] 12.4 测试：server 代理 1 项（fixture 上游 → miss 下载 → 关停上游后 hit 持久 → 502/404 形状守卫），10/10；wizard 34/34；webui 65/65 + 版本守卫；typecheck 双零。
- [x] 12.5 走查：冷缓存首跑（后端从 CDN 拉 fp16 106MB/30 文件、浏览器 32 分块全走代理 0 直连、spinner「下载模型 10%→…」）；**质量数值**：fp16 subject 覆盖 0.081 vs quint8 0.175（多出≈残留白垫），近白残留仅 232px；**跨重启**：新随机端口 + 新会话 → 12s 内候选落地（磁盘缓存命中）。

## 13. Round 9（用户验收轮：换链后主体提取实时跟随，D19）

- [x] 13.1 根因：提取去重 key 为 `端口:序号`——URL 模式端口恒 0、序号每次从 0 起，换链后 key 复用被「已尝试」抑制；且 en/zh 等域名共享同一 favicon 静态资产（内容寻址路径相同），纯内容路径也无法区分代际。
- [x] 13.2 服务端：icons 事件与 snapshot 增 `generation`（scrape 侧替换处递增：submitUrl、scrape 轮询、replaceIconCandidates 缝、复位点；addIconCandidate 追加不增）。
- [x] 13.3 webui：按 generation 重置尝试记录（快照恢复同样生效）；在途提取被代际更换超越时废弃结果（旧主体不与新列表同序号候选错配）。
- [x] 13.4 测试：新增 generation 语义用例（换链递增 / 追加稳定 / snapshot 透传）；wizard+server 44 用例（3 个 materialize 超时为高负载抖动，单跑仲裁全过）；webui 65 + 守卫 + typecheck 双零。
- [x] 13.5 走查实证：同内容重新提交（zh→zh，favicon 字节相同）→ 代际 1→2 → 主体重新提取并追加（事件序列 (1,2)(1,5)(2,2)(2,5)）；快照恢复路径亦触发提取。走查中确证一个客户端现象：URL 卡存在乐观源地址状态（提交中断时页面可先行显示新地址），服务端 urlSource 为准。

## 14. Round 10（用户验收轮：缩略图代际缓存穿透 + 提取参数化，D20）

- [x] 14.1 #1 根因：换链后候选缩略图 URL 不变（`/api/icon-data/<port>/<index>`），React 不改 src 则浏览器不重取——点击选中已用新字节（服务端列表已换），纯渲染残留（实测该路由本就 `no-store`，非 HTTP 缓存问题）。修复：缩略图身份 = `(index, generation)`，`iconDataUrl(port, index, generation)` 全链路（候选行/托盘选择器/合成预览/提取源拉取）携带 `?g=`。
- [x] 14.2 #2 参数化：`SubjectExtractionSettings { model: isnet|isnet_fp16|isnet_quint8, alphaThreshold: 0–128, shrink: 0–6px }`；后处理纯函数 `postProcessSubject`（阈值清零 + N 次 3×3 alpha 腐蚀，`SubjectPixels` 结构化类型使 jsdom/node 可测）；「AI 提取设置」面板（模型精度三档 + 双滑杆 + 说明）。
- [x] 14.3 #2 替换语义：`addIconCandidate` 对同源既有 subject 连同其派生剪影一并移除后追加新主体（序号合法回收），「按当前设置重新提取」即走此路径——列表永不出现双主体/双剪影。
- [x] 14.4 走查发现的残留向量修复：替换回收同序号槽位但代际不变 → 缩略图 src 不变 → 旧主体像素残留；修复为替换路径递增 `iconGeneration`（追加仍稳定，D19 语义不变）。
- [x] 14.5 测试：替换语义用例扩展（替换后恰 1 主体 + 2 剪影 + 代际 +1）；后处理纯函数 3 项（默认 no-op 同引用/阈值清零/腐蚀收缩）；聚焦复跑通过。
- [x] 14.6 实机走查（独立实例 47812→47813 + 内置浏览器）：baidu→wikipedia 换链缩略图 `?g=1→?g=2` 穿透、候选行换成维基 W（视觉判读确认非百度残留）；设置面板收缩 2px/4px 重提取——服务端字节哈希实测变化（4576B→1583B，收缩更狠字节更少）、列表形状恒为 1 主体 + 2 剪影；修复后复验重提取缩略图 `g=2→g=3` 跳变且三图 `complete:true` 解码成功。
