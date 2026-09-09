# shared-icon-kernel — Intent Document (SSOT)

> 原始需求（用户，2026-09-09）：「create-opentray 这里能生成完美的 macOS 图标，
> 这个能力能不能下方到 opentray 的内核中？现在内核自动生成的图标不是很合理，
> 属于一种更加原始的体验。create-opentray 这里提供的标准会更先进更现代化。」
>
> 用户语言系统：**「下沉到内核」「更先进更现代化的标准」「原始的体验」** ——
> 省略图标不该得到白纸兜底；create-opentray 验证过的现代化图标标准应当成为
> OpenTray 运行时的默认体验，而不是脚手架工具的专属福利。

## 需求承载 Q&A（用户已裁决，2026-09-09）

| 问题 | 用户裁决 |
|------|----------|
| 省略 `appIcon` 时默认图标长什么样？ | **首字母 glyph**（与 create-opentray 兜底同标准；区分度 + CJK/emoji 可渲染） |
| 生成核心放哪个包？ | **新建 `@opentray/icon`**（编码器从 vite-plugin 迁出、合成层从 create core 迁出，三方共享） |
| 图像处理依赖怎么引？ | **换成 jsquash**（WASM，「更现代化更轻，符合我们这种轻量处理的需求」），不用 sharp |
| 走什么工作方式？ | **fast-remix**（super-thinker 子代理复核，不启 Codex） |

## 最终可见效果（operator 视角）

```ts
// 消费者什么都不写：
const tray = await createTray({ trayId: "notes", title: "Notes" }, { appId, appName: "笔记工具" });
```

macOS Dock / Cmd+Tab 显示的是**蓝底白字首字母 squircle 图标**（连续曲率圆角、
824-in-1024 macOS 边距规范），不再是 macOS 通用白纸 exec 图标。中文应用名渲染
中文首字。Windows/Linux 消费者安装体不新增 libvips 级原生依赖（jsquash 为
WASM）。显式声明 `appIcon` 的消费者行为与今天完全一致。

操作者信任点：
- create-opentray 生成的项目、Vite 插件消费者、裸 SDK 消费者，**三方看到的是
  同一套图标标准**（同一份实现），不再是 create 一套、内核一套。
- `tray.app.getAppIcon()` 等公开 API 语义不变（见 D6）。

## 调研事实（已核实代码）

- **"内核自动生成的图标"并不存在**：省略 `appIcon` 时
  `packages/cli/src/daemon/broker-command.ts:373` 不传图标 →
  `packages/packaging/src/app-bundle.ts:248-260` 删除 `CFBundleIconFile` 并
  `rm` AppIcon.icns → Rust `opentray-backend-tray-icon/src/native.rs:219-256`
  `setApplicationIconImage(None)` → Dock 回落 bundle 图标 → bundle 无图标 →
  **macOS 通用白纸图标**（generic exec icon）。归档 change
  `2026-08-19-add-webview-app-mode-and-app-icon` tasks 2.13 已记录该现象。
- create-opentray 的现代化管线（纯 Node，sharp/libvips）：
  - glyph 兜底：`@create-opentray/core/src/scrape.ts:644-667`
    `createGlyphIconSvg`（512 viewBox、`rx=96` 圆角、`#0A84FF`、首字母）。
  - 合成层：`@create-opentray/core/src/icon-compose.ts`（351 行）——
    黑/白/透明背景自适应（`foregroundStats`/`autoBackground`，手写像素循环）、
    squircle 蒙版 `dest-in` 裁剪（蒙版取自打包的背景模板 PNG alpha）、
    824-in-1024 macOS 变体（`MACOS_CONTENT_SIZE = 824`）。
  - 编码层：`@opentray/vite-plugin/src/app-icon.ts`（407 行）——
    `generateOpenTrayAppIcon`（含 `composed`/`macosSourcePath` 接缝）、
    figma-squircle 连续曲率 tile（`cornerSmoothing: 1`）、ICNS 10-tag
    （ic04…ic10，显式 representation + 72 DPI）、ICO 7 档、Linux PNG 7 档、
    六层 cache 身份。**编码器唯一实现已在 vite-plugin**；create 通过
    `workspace:*` 复用（`materialize.ts:21,232-249`）。
- vite-plugin 的 squircle tile 参数：`TILE_INSET=64`、`TILE_RADIUS=196`、
  `TILE_SMOOTHING=1`、`SYMBOL_SIZE=704`、`APP_ICON_DENSITY=72`，
  `RECIPE_VERSION = "squircle-v3:…"`，`CACHE_SCHEMA_VERSION = 6`。
- Rust 侧零图像代码；bundle 物化在 Node（`ensureDarwinBundle`，此处天然有
  `paths.appName`）。bundle 写入图标后，Rust `setApplicationIconImage(None)`
  自动回落 bundle 图标——**冷启动 Dock 图标无需 Rust 改动**。
- `AppIcon` 类型契约：`packages/spec/src/index.ts:237-249`（`appIcon?`）、
  校验 `packages/cli/src/app-icon.ts`（拒绝 raw RGBA/text/URL、变体唯一性）。
- AGENTS.md App Icon Law 现行条文：「Omitted `appIcon` never inherits tray
  artwork. Packaged/carrier identity wins when present, then the
  operating-system executable/default artwork applies.」——本变更修订其后半句。
- `app-identity` capability spec 只存在于归档 change
  （`archive/2026-08-19-add-webview-app-mode-and-app-icon/specs/app-identity/`），
  未合入 `openspec/specs/`；现行 SSOT 为 AGENTS.md 法案 + 代码。
- jsquash 家族（已核实）：`@jsquash/png`/`oxipng`/`resize`（Rust resize 内核，
  lanczos3 等）/`jpeg`/`webp`/`avif`/`jxl`，WASM、浏览器与 V8（Node）双环境。
- **硬约束（已核实）**：`@resvg/resvg-wasm` 在 WASM 环境下**不能加载系统字体**
  （thx/resvg-js #289），文字渲染只能显式 `fontBuffers`/`fontFiles` 喂入。
- **Spike 结论（demos/wasm-spike，2026-09-09，Node 24 + Bun 1.3 实测）**：
  - resvg-wasm + `fontBuffers` 字体阶梯成立：拉丁（Arial Bold.ttf）与 CJK
    （`/System/Library/Fonts/STHeiti Light.ttc`）真实渲染；resvg 对 font-family
    未覆盖字符有 per-cluster 回退（落到 db 中其它字体）。
  - **`loadSystemFonts: true` 在 WASM 下文字静默不渲染**（实测得到纯色板）——
    字体阶梯（D5）是强制项而非优化项。
  - `@jsquash/png` v3 自动 init 在 Node 走 `fetch(file URL)` 必败；必须经
    `@jsquash/png/decode.js` 子路径 `init(wasmBytes)` 预初始化（encode 共享
    同一 wasm 实例）。`pHYs` 默认缺席 → D11 手工注入确认必要且可行
    （chunk 解析 IHDR→IDAT→IEND 验证插入点）。
  - `@jsquash/resize`：默认导出 `resize(imageData, { width, height, method })`
    为 async，`initResize(wasmBytes)` 预初始化，lanczos3 的 1024→824/16 正常。
  - 字形图像结构程序化校验通过：圆角 alpha=0、tile 覆盖 ~97%、字形白像素
    6.8%（拉丁）/7.2%（CJK）。
- 依赖分类法案（AGENTS.md 用户全局区）：tsdown 只 bundle devDependencies 里的
  workspace 包；`dependencies` 里的包被视为 external 由消费者从 registry 解析。
  `@opentray/icon` 独立发布 → jsquash 等放 `dependencies`；发布前 grep dist +
  `npm pack --dry-run` 验证。
- 进行中 create 变更（`add-create-url-apps` 刚合入 main：`--url` 打包）也触碰
  `materialize.ts`；本变更迁移时以最新 main 为基线。

## 决策

| # | 决策 | 依据 |
|---|------|------|
| D1 | 落点 = **Node runtime 的 Darwin bundle 物化层**（`ensureDarwinBundle`），Rust 零改动 | 整条 create 管线是 Node 代码；bundle 有图标后 `setApplicationIconImage(None)` 自动回落 bundle 图标；往 Rust 引图像栈违背分层且是大工程 |
| D2 | 新建 `packages/icon` → **`@opentray/icon`**（monorepo 法案 `packages/* → @opentray/<dir>`），持有 glyph/栅格化/合成/编码/默认图标全部内核；vite-plugin 变薄壳 re-export，create core 删除自有实现改 import | 单一事实源；runtime 依赖名为 vite-plugin 的构建工具包边界扭曲；用户已裁决 |
| D3 | 图像栈 = **jsquash + `@resvg/resvg-wasm` + `figma-squircle` + `@shockpkg/icon-encoder` + `exifr`**，全仓库图标路径去 sharp | 用户裁决 jsquash（轻量/现代/浏览器兼容——wizard 预览因此受益）；后三者是既有纯 JS 依赖原样保留 |
| D4 | 默认图标 = **appName 首字母 glyph**：figma-squircle 连续曲率 tile（对齐 vite-plugin `TILE_*` 参数标准，优于现行 `rx=96` 普通圆角）+ accent 底 + 首字母；输出 1024 全幅 + 824-in-1024 双变体 + 三平台资产目录 | 用户裁决；create 兜底与 vite-plugin tile 标准的并集升级 |
| D5 | **字体阶梯**：内嵌 OFL 拉丁字体（确定性渲染）→ 运行时扫描 OS 字体目录经 `fontBuffers` 喂入（覆盖 CJK 等）→ 覆盖检查失败兜底中性字形 | resvg-wasm 无法加载系统字体是硬约束；不内嵌 CJK megafont（体积），OS 扫描保持本机覆盖 |
| D6 | 生成的默认图标是 **carrier 物化层关切，非 Core App identity**：Core 声明目录保持空，`getAppIcon`/`getAppIconVariant`/`setAppIcon` 公开语义不变 | App Icon Law 的 identity/catalog 语义不动；只修订 omitted 的回落行为，避免 App identity API 语义膨胀 |
| D7 | WASM/编码失败 → **诊断日志 + 静默回落现状**（无图标），不破坏「普通安装即连贯」法案；新增 `appBundle.defaultAppIcon?: boolean`（默认 `true`）显式退出 | 安装鲁棒性优先；诊断可观测（对齐 broker.log 精神） |
| D8 | 默认图标缓存于 runtimeDir（key = appName + 生成器实现哈希 + recipe 版本），二次启动零再生成；**默认图标字节参与 bundle manifest icon hash**（物化身份法自动生效） | vite-plugin 六层 cache 身份法的精神投影到运行时；identity 漂移 → 合法再物化 |
| D9 | 迁移即升级：vite-plugin/create 切到共享包时 **recipe/cache 版本 bump**，sharp 时代旧缓存一次性合法失效再生成 | cache 身份法：实现变了哈希必须变 |
| D10 | 验收范围：**Darwin**（bundle 默认图标 + `iconutil` 校验 + 二次启动缓存命中 + 显式 appIcon 回归）。Windows/Linux 资产随一次生成顺带产出，但不宣称默认图标能力（无物化路径） | Windows exe 图标嵌入是构建期话题；诚实宣称原则 |
| D11 | PNG 密度：**手工 pHYs 72dpi chunk 注入**（纯 JS PNG chunk 手术 + CRC），不赌 jsquash 暴露 pHYs | ICNS 72 DPI 法案要求 representation 密度确定性 |

## 数据流

```
createTray(…, { appId, appName })            appIcon 省略
   │
   ▼
daemon 启动 → ensureDarwinBundle (broker-command.ts)
   │ appIcon === undefined 且 defaultAppIcon !== false
   ▼
@opentray/icon generateDefaultAppIcon({ appName })
   │ glyph SVG（figma-squircle path + 首字母，字体阶梯 D5）
   │ resvg-wasm 栅格化 1024 → jsquash/resize 缩 824 变体
   │ pHYs 72dpi 注入（D11）→ ICNS 10-tag / ICO / Linux PNG
   ▼
runtimeDir 缓存（D8）→ 包装为 darwin icns AppIcon 资产
   │
   ▼
ensureDarwinAppBundle({ appIcon })  → CFBundleIconFile + AppIcon.icns + manifest hash
   │  失败任意一步 → 诊断日志 + 现状回落（D7）
   ▼
Dock 冷启动显示 glyph 图标（Rust setApplicationIconImage(None) 回落 bundle 图标）
```

共享化迁移（同一内核、三方消费）：

```
                    ┌─ @opentray/icon（新）─ glyph / raster(jsquash+resvg) /
                    │   compose / encode(ICNS+ICO+PNG+pHYs) / generate / default-icon
                    │
   ├─ @opentray/vite-plugin：openTrayAppIconPlugin + generateOpenTrayAppIcon（薄壳，API 不变）
   ├─ @create-opentray/core：composeAppIcon/foregroundStats/autoBackground/glyph 改 import；去 sharp
   └─ packages/cli（runtime）：ensureDarwinBundle 默认图标（D1/D7/D8）
```

## 开放问题（默认假设先行）

| 问题 | 影响 | 默认假设 |
|------|------|----------|
| 内嵌 OFL 拉丁字体选哪个（Inter？IBM Plex？） | glyph 视觉 + 包体积（~100-400KB） | Inter 单字重（实现期下载定格；Spike 已证明任何 TTF 字节均可经 fontBuffers 生效） |
| create core 是否连 tray 128px 缩放等非图标 sharp 用点一起迁 | create 是否能完全卸 sharp | 一起迁（`@opentray/icon` 暴露 resize util），目标 create 零 sharp |
| webui wizard 浏览器内预览是否本轮切 jsquash | webui 改动面 | 不主动改 webui；jsquash 浏览器兼容为后续红利，core 切换后 Node 侧预览自动受益 |
| `defaultAppIcon` 开关类型放哪 | 类型契约 | `appBundle` 选项块内（`AppOptions`/daemon options 声明处），spec delta 同步 |
| glyph accent 色是否可配置 | 公开 API 面 | 内核默认 `#0A84FF`；`generateDefaultAppIcon` 留 `accent?` 参数，runtime 不暴露（避免 Core 状态膨胀） |
| jsquash 子路径 `init(wasmBytes)` 的引入方式在 tsdown 产物中如何定格 | 发布包的 wasm 解析 | 包内提供 Node 专用 loader（readFile + `init`），wasm 文件随包发布（dist 旁置或 import.meta.url 解析），实现期以 `npm pack` + 干净目录安装验证 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| Rust 内核绘制图标 | 往 Rust 引图像绘制 + ICNS 编码 + 字体栈，大工程且违背既有分层（Node 拥有物化；Rust 零图像代码是现状事实） |
| runtime 直接依赖 `@opentray/vite-plugin` | 构建工具包名承载运行时能力，边界扭曲，需为它开法案特例 |
| 预烘焙 glyph 图标集（A-Z/0-9 若干 ICNS） | CJK/emoji 首字母覆盖不了；ICNS 全 representation 单个数百 KB，集 合体积不可接受 |
| 保留 sharp 作为图像栈 | 用户裁决 jsquash（轻量、现代、浏览器兼容）；sharp 在主包引入 libvips 原生依赖违背产品轻量定位 |
| 默认图标进 Core App identity 目录（`getAppIcon` 返回合成资产） | App identity API 语义膨胀；catalog/variant 法案无需动（D6） |
| 保持 OS 默认 + 仅显式 API | 用户明确要默认体验升级，不要 opt-in |

## 常规性判定

本变更是现有平台法则下的**常规原子**，附带一条既有法案的**默认行为修订**：
App Icon Law 中「omitted `appIcon` → operating-system default artwork applies」
修订为「omitted `appIcon` → Darwin carrier 物化层合成首字母 glyph 默认图标」。
不触碰 tray-first/App/Session 法、session 隔离、extension 边界、broker 协议；
Core identity 语义（D6）与显式 `appIcon` 校验法原样成立。新增的法只有
`@opentray/icon` 的包所有权法（生成内核单一事实源）与默认物化行为本身。

## 实施计划（specs/tasks 追溯）

1. **Spike（demos/）**：jsquash wasm 在 Node/tsdown 产物加载、`@jsquash/resize`
   lanczos3、resvg-wasm `fontBuffers` 字体阶梯（拉丁内嵌 + macOS 系统字体扫描
   CJK 实测）、pHYs chunk 注入可行性。结论回填本 plan 的开放问题。
2. **`@opentray/icon` 包**：README 公开 API 契约先行 → glyph/raster/compose/
   encode/generate/default-icon 模块 + 资产（背景模板 PNG 迁移、内嵌字体）+
   单测（SVG 快照、ICNS 10-tag、pHYs、与 sharp 旧产物像素容差对比、缓存命中）。
3. **Runtime 默认图标**：`ensureDarwinBundle` 接线 + runtimeDir 缓存 + 失败
   回落 + `defaultAppIcon` 开关 + 集成测试（`CFBundleIconFile`/`iconutil`
   往返/二次启动缓存命中/显式 appIcon 回归）。
4. **迁移**：vite-plugin 薄壳化（API 不变，recipe/cache bump）；create core
   去 sharp 改 import 共享内核（含 glyph 兜底统一走 `generateDefaultAppIcon`）；
   既有测试迁移 + 修绿。
5. **法规与文档**：AGENTS.md App Icon Law 修订 + `@opentray/icon` 所有权法；
   skills/opentray 公开文档；根/包 README；specs deltas（app-identity 默认物化、
   packaging-plugin 共享内核、darwin-runtime-carrier 默认图标）。
6. **复核与收尾**：fast-remix（super-thinker）多轮复核闭环 → `validate`/`check`
   → 分 phase 提交 → 归档 → push。
