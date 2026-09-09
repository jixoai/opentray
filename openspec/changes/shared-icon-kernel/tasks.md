# shared-icon-kernel — Tasks

## 1. Alignment / Investigation

- [x] 1.1 `plans/plan.md` 已记录完整代码勘察（runtime 缺口、create 管线分层、vite-plugin 编码器、AGENTS.md 法案、依赖分类法）与 spike 实测结论（resvg-wasm fontBuffers、jsquash 预 init、pHYs 缺席、resize 内核）；用户四项裁决（glyph/新包/jsquash/fast-remix）逐条入档；D1–D11 决策齐备，无需用户确认的破坏性迁移。
- [x] 1.2 每个 checkbox 仅由当前工作上下文完成并验证后勾选。

## 2. BDD Contract（trace 到 plans/plan.md 决策与 specs requirement）

- [ ] 2.1 icon-kernel「One shared icon kernel SHALL own app-icon generation」——包存在性/命名法（`packages/icon` → `@opentray/icon`）、三方消费无重复实现、无 sharp/libvips 依赖（`npm pack --dry-run` + 依赖树断言）。
- [x] 2.2 icon-kernel「Glyph defaults SHALL follow the continuous-curvature squircle standard」——glyph SVG 快照（figma-squircle path 参数 = 品牌路径 tile 参数）、1024 全幅 + 824-in-1024 变体几何断言、ICNS 10-tag 集合 + pHYs 72dpi chunk 存在、字体阶梯（拉丁内嵌 + CJK fontBuffers 真渲染 + 无静默丢字断言）。
- [x] 2.3 icon-kernel「Kernel outputs SHALL carry full cache identity」——实现/recipe 变更触发再生成、未变更跳过（mtime/探针断言）。
- [x] 2.4 app-identity「Omitted appIcon SHALL materialize a synthesized glyph default」——省略 appIcon 物化断言（CFBundleIconFile/AppIcon.icns/manifest hash/Core catalog 空）、CJK 首字渲染、二次启动缓存命中、失败回落诊断、`defaultAppIcon: false` 复原旧行为、`reinitialize: false` 只读不注入、显式 appIcon 永不被替换。
- [ ] 2.5 create-materialize-pipeline「Create icon pipeline SHALL consume the shared icon kernel」——create 产物走共享内核（wizard glyph 兜底 = runtime 默认同标准）、compose 语义保持（round-12 亮度/覆盖/前景像素保持回归 fixture）。

## 3. Implementation

- [x] 3.1 `packages/icon` 脚手架：package.json（jsquash 系 + resvg-wasm + figma-squircle + icon-encoder + exifr 全部 `dependencies`；tsdown 构建；wasm/字体资产发布）、tsconfig、vitest；README 公开 API 契约先行。
- [x] 3.2 `wasm.ts`：Node/Bun wasm 预加载器（readFile → `init(bytes)`；`@jsquash/png/decode.js` 子路径 init、`initResize`、resvg `initWasm`），失败抛可诊断错误（消费方决定回落）。
- [x] 3.3 `glyph.ts`：`buildGlyphIconSvg`（figma-squircle 连续曲率 tile + 首字母 + accent）与字体阶梯（内嵌 OFL 默认字体资产 → OS 目录扫描 fontBuffers → 覆盖失败中性兜底；`loadSystemFonts` 恒 false）。
- [x] 3.4 `raster.ts`：解码分派（png/jpeg/webp/avif + svg via resvg）、`resizeImage`（lanczos3 / 像素画点采样）、EXIF 方向（exifr）。
- [x] 3.5 `compose.ts`：icon-compose 语义移植（foregroundStats/autoBackground 手写循环保持、squircle dest-in、824 变体、背景模板 PNG 资产迁移）。
- [x] 3.6 `encode.ts`：pHYs 72dpi chunk 注入（PNG chunk 手术 + CRC32）、ICNS 10-tag（自 1024/824 双变体取源）、ICO 7 档、Linux PNG。
- [x] 3.7 `generate.ts`：`generateOpenTrayAppIcon`（保留 `composed`/`macosSourcePath`；cache schema bump：jsquash/resvg 实现身份替换 sharp 版本；recipe bump）。
- [x] 3.8 `default-icon.ts`：`generateDefaultAppIcon({ appName, accent?, outputDir, cacheDir })`（glyph SVG → 双变体 → 三平台目录 + manifest；缓存身份 = appName+实现+recipe）。
- [x] 3.9 Runtime 接线（packages/cli）：`ensureDarwinBundle` 省略 appIcon 时生成默认图标（runtimeDir 缓存 + 失败诊断回落 + `appBundle.defaultAppIcon?: boolean` 默认 true + `reinitialize: false` 只读短路）；spec 类型同步。
- [ ] 3.10 vite-plugin 薄壳化：`openTrayAppIconPlugin`/`generateOpenTrayAppIcon` API 不变，内部 re-export `@opentray/icon`；移除 sharp/figma-squircle/icon-encoder 直接依赖。
- [ ] 3.11 create 迁移：core 删除 icon-compose.ts/glyph 自有实现，改 import 共享内核；`writeGlyphIconTemp` 路径统一走 `generateDefaultAppIcon`；审计并迁移 tray 128px 等其余 sharp 用点，create 零 sharp。
- [ ] 3.12 关键效果点意图注释（指向 plan.md D1–D11）。

## 4. Verification

- [ ] 4.1 `@opentray/icon` vitest 全绿（SVG 快照/ICNS 结构/pHYs/像素容差/缓存命中/字体阶梯）+ 全仓 typecheck + 受影响包既有测试全绿。
- [ ] 4.2 真实端到端取证（临时 HOME/OPENTRAY home）：省略 appIcon 启动示例 → bundle `CFBundleIconFile` + `AppIcon.icns` 合法（`iconutil` 往返）→ 二次启动缓存命中 → Dock 图标实际变化（截图/程序化取证）。
- [ ] 4.3 回归：显式 appIcon 消费路径不变；vite-plugin golden 产物（recipe bump 后）合法；create wizard 预览与产物一致。
- [ ] 4.4 发布审计：`npm pack --dry-run` 依赖清单只含 registry 真实包；grep dist 无私有 workspace import 残留（tsdown 依赖分类法）。
- [ ] 4.5 fast-remix 复核（super-thinker 子代理）多轮闭环 + `validate`/`check` + 分 phase 提交。

## 5. Docs & Law

- [ ] 5.1 AGENTS.md App Icon Law 修订（omitted → glyph 物化；`@opentray/icon` 所有权法；vite-plugin 薄壳表述）。
- [ ] 5.2 skills/opentray 公开文档默认图标行为；根 README 简述；vite-plugin/create/icon 包 README。
