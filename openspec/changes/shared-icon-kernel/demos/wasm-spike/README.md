# wasm-spike — jsquash + resvg-wasm feasibility (2026-09-09)

Verified under Node 24 + Bun 1.3, macOS arm64. Run: `node spike.mjs` (needs `bun add` first).

## Conclusions (feed shared-icon-kernel plan/specs)

1. **resvg-wasm + fontBuffers 字体阶梯成立**：拉丁（Arial Bold.ttf）与 CJK
   （STHeiti Light.ttc）经 `fontBuffers` 真实渲染；resvg 对缺字字符有 per-cluster
   字体回退（font-family 未覆盖时自动落到 db 中其它字体）。
2. **`loadSystemFonts: true` 在 WASM 下文字静默不渲染**（实测纯色板无字形）——
   字体阶梯是强制项，不是优化项。经验依据 thx/resvg-js #289。
3. **@jsquash/png v3 自动 init 在 Node 走 fetch(file URL) 必败**：必须经
   `@jsquash/png/decode.js` 子路径 `init(wasmBytes)` 预初始化（encode 共享同一
   wasm 实例）。decode/encode 正常，`pHYs` 默认缺席 → 72dpi 需手工 chunk 注入；
   chunk 解析（IHDR→IDAT→IEND）验证插入点可行。
4. **@jsquash/resize**：默认导出 `resize(imageData, { width, height, method })`
   为 async；`initResize(wasmBytes)` 预初始化；lanczos3 下 1024→824/16 正常。
5. 字形图像结构程序化校验：圆角 alpha=0、tile 97% 覆盖、字形 6.8-7.2% 白像素。

macOS CJK 字体扫描源（实测可读）：`/System/Library/Fonts/STHeiti Light.ttc`、
`Hiragino Sans GB.ttc`、`PingFang.ttc`（存在性按机器回退）。

## How to re-run

```bash
bun add @jsquash/png @jsquash/resize @resvg/resvg-wasm
node spike.mjs   # or: bun spike.mjs
```
