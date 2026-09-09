# Vision-Driven Self Review — shared-icon-kernel

## Review State

- **Iterations**: 1 review loop (super-thinker fast-remix round), fixes applied and re-verified within the same loop; no issue recurrence.
- **Exit-condition judgment**: exit normally — all tasks checked, full battery green, two blocking findings fixed with regression coverage, user accepted the visible surface.

## Intent vs Output (plans/plan.md 对照)

| 意图 | 产出 | 判定 |
|------|------|------|
| D1 落点 = Darwin bundle 物化层，Rust 零改动 | `broker-command.ts` `synthesizeDefaultAppIcon`；crates/ 无 diff | 达成 |
| D2 单一内核 `@opentray/icon` | 六模块（wasm/raster/compose/encode/generate/default-icon）+ 字体阶梯；vite-plugin 91 行薄壳；create core 删净自有实现 | 达成 |
| D3 WASM 图像栈去 sharp | 全仓 grep 无 sharp import；npm pack 审计无 libvips | 达成 |
| D4 glyph = 连续曲率 squircle 标准 | figma-squircle path 直嵌 SVG；vision 像素级核验（渐近尾签名、IoU 0.996+） | 达成 |
| D5 字体阶梯（强制项） | 内嵌 Inter 子集 + OS 扫描 fontBuffers + 文本存在性像素探针；`loadSystemFonts` 恒 false | 达成 |
| D6 carrier 物化关切，Core 目录不变 | `getAppIcon` 语义无 diff；仅 daemon 层合成 | 达成 |
| D7 失败回落 + defaultAppIcon 开关 | broker.log 诊断回落（含 mkdir 加固）；5 个集成场景全绿 | 达成 |
| D8 缓存 + manifest 身份 | runtimeDir 缓存 mtime 断言；bundle manifest icon hash 走既有校验 | 达成 |
| D9 recipe/cache bump | schema 6→7、squircle-v3→v4 | 达成 |
| D10 验收 Darwin | 4 场景 + iconutil 往返 + appMode 活 Dock 演示（用户验收） | 达成 |

## Deviations from Intent

1. **create glyph 兜底最初未与 runtime 统一**（spec delta 违约，复核建议 1）——已修：`generateDefaultAppIcon` 增加 `fileStem` 接缝，materialize 兜底直连同一生成器，两路径字节等同有回归测试。
2. **B1 exifr CJS/ESM 互操作缺陷**：所有 JPEG 解码在真实 Node 抛 TypeError（vitest 合成命名导出掩盖）——已修并以真实 Node dist 冒烟 + 回归测试双重验证。
3. **B2 CRC32 缺掩码**：全部产物 PNG 的 pHYs chunk CRC 非法——已修，zlib.crc32 独立权威全 chunk 校验通过。
4. **语义微偏移（已注释明示，未改回）**：trim 由左上角颜色基准改为 alpha 基准（更诚实的内容信号）；composed letterbox 由不透明黑改为透明（对齐 round-12 法案）；iconDimensions 由 header 探测改为解码取维（小图无感，注释声明）。
5. **wizard 快速路径**：物化上下文新增 `generateDefaultIcon` 接缝（与既有 `generateIcon` 同构），测试 stub 两路。

## New Questions Requiring User Confirmation

无阻塞项。一个后续候选（非本变更）：Windows/Linux exe 图标嵌入是构建期话题，按 plan D10 另立变更。

## Evidence

- **测试**：icon 13 / packaging 22 / cli 121 / vite-plugin 5 / create-core 192 / create 212 = **565 全绿**；6 包 `tsc --noEmit` 全绿。
- **平台**：`iconutil -c iconset` 往返校验通过（macOS 原生工具接受产物，含 CJK 应用名）。
- **运行时**：临时 OPENTRAY_HOME 真实物化（CFBundleIconFile/AppIcon.icns/manifest hash/launch descriptor）；appMode 窗口演示 `lsappinfo` 注册 `笔记工具`，Dock 瓦片经用户视觉验收（"效果挺好的"）。
- **发布**：`npm pack --dry-run`（icon 866KB，dist 无私有 import、无 sharp）；vite-plugin dist 外部化审计。
- **复核**：super-thinker 综合评分 7/10（架构 9 / 法案 8 / 文档 8 / 测试 6 / 正确性 5→修复后两项阻塞清零）；复核报告结论"修复 B1/B2 并收口建议 1 后可达发布标准"。
- **基线**：`bun test scripts/openspec/vision-driven.test.ts` 16/16；`openspec schema validate vision-driven` 通过。

## Git Evidence

- 提交链（rebase 后）：`docs(spec): prepare shared-icon-kernel for apply` → `feat(icon): @opentray/icon kernel…` → `feat(cli): synthesize glyph default…` → `refactor(icon): migrate vite-plugin and create…` → `docs(law): App Icon Law…` → `docs(spec): demos` → `fix(icon): review round…`（本 self-review 与归档随后提交）。
- 工作区：无未提交产品代码；`packages/ext-webview-darwin-arm64/lib/*.dylib` 为本地构建暂存，已由 .gitignore 排除（原生物料不入库法）。
- 任务勾选：28/28 全部由当前工作上下文完成并验证后勾选；复核轮新增第 6 节记录。

## Next Loop Action

无需下一轮。归档后建议的独立后续：create-webui 浏览器侧预览切换收益验证（jsquash 浏览器兼容红利）、Windows/Linux exe 图标嵌入变更。
