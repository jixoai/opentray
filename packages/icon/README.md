# @opentray/icon

The shared OpenTray app-icon generation kernel — one implementation of glyph
defaults, foreground composition, squircle tiling, and native asset encoding
(ICNS / ICO / Linux PNG), consumed by the Vite plugin, create-opentray, and
the OpenTray runtime daemon.

The image stack is WebAssembly (jsquash codecs, resvg rasterizer): no sharp,
no libvips, no compiler toolchain. The same code path runs under Node, Bun,
and browsers.

## Public API

### `generateOpenTrayAppIcon(options)`

Generate one strict cross-platform `AppIcon` asset set from a brand source
image. Preserves the contract previously exported by
`@opentray/vite-plugin` (that package is now a thin shell over this kernel):

```ts
import { generateOpenTrayAppIcon } from "@opentray/icon";

const metadata = await generateOpenTrayAppIcon({
  sourcePath: "./brand/logo.png",
  // Pre-composed art (background + squircle already baked in) passes pixels
  // through verbatim instead of re-tiling:
  composed: false,
  // Separate macOS content source (the best-practice content-size variant);
  // ICNS encodes from it while ICO/Linux use sourcePath:
  macosSourcePath: undefined,
  icnsOutputPath: "./static/icons/app-icon.icns",
  icoOutputPath: "./static/icons/app-icon.ico",
  linuxOutputDirectory: "./static/icons/linux",
  manifestOutputPath: "./static/icons/app-icon.json",
  cachePath: "./.cache/app-icon.json",
});
// metadata.appIcon — absolute file sources ready for createTray({ appIcon })
```

Outputs carry explicit 72 DPI PNG density and the ten-tag ICNS
representation set. Results are cached under a full identity: source bytes,
generator implementation, recipe version, encoder/rasterizer stack versions,
and every output path.

### `generateDefaultAppIcon(options)`

The synthesized default App icon: the application name's first glyph on the
continuous-curvature squircle tile (figma-squircle path, the same tiling
standard as the brand path), emitted as a full platform catalog plus a macOS
content-size variant. Used by the runtime's omitted-`appIcon` materialization
and by create-opentray's glyph fallback — both consumers share one visual
standard.

```ts
import { generateDefaultAppIcon } from "@opentray/icon";

const result = await generateDefaultAppIcon({
  appName: "笔记工具",        // first character rendered through the font ladder
  accent: "#0A84FF",         // optional
  outputDir: "./.opentray/app-icon",
});
// result.appIcon — AppIcon array (darwin icns + windows ico + linux pngs)
// result.icnsPath / result.icoPath / result.linuxPngPaths / result.manifestPath
```

Text rendering uses an explicit font ladder — an embedded OFL subset
(Inter SemiBold, see `assets/inter-glyph.OFL.txt`) plus a bounded, ranked
scan of well-known OS font directories — because the WASM rasterizer cannot
autoload system fonts. Rendering is verified by a text-presence pixel probe;
a glyph the ladder cannot cover throws instead of silently emitting a blank
or tofu tile (callers decide their fallback).

### Composition layer

Ports of the create-opentray composition semantics for consumer-supplied
foregrounds (`composeAppIcon`, `foregroundStats`, `foregroundLuminance`,
`foregroundCoverage`, `autoBackground`, `compositionCacheKey`): the
foreground's original pixels are never recolored; the background (black /
white / transparent) is auto-selected from the artwork's own luminance;
every composition is clipped to the squircle mask; macOS receives the
content-size variant inside the 1024 canvas.

### Raster utilities

`decodeImage` (PNG/JPEG/WebP/AVIF/SVG with EXIF orientation), `resizeImage`
(lanczos3 / nearest point sampling), `containImage` / `insideImage`
(transparent letterboxing / no padding), pixel operations
(`pasteImage`, `cropImage`, `trimBounds`, `opaqueCoverage`,
`brightPixelRatio`), `pngWithDensity` (72 DPI pHYs chunk surgery), and the
encoders (`encodeIcns`, `encodeIco`, `encodeDensePng`).

## WASM bootstrap

Codecs are initialized lazily with wasm bytes read from disk
(`readWasm`/`loadPng`/`loadResize`/`loadResvg`) — the packages' auto-init
fetches a `file:` URL, which Node rejects. Initialization failure raises
`IconKernelInitError`; the runtime daemon treats it as a diagnosed fallback,
build tools surface it directly.

## Platform scope

Generation always emits all three platform asset families. Default-icon
materialization acceptance is Darwin-only today: Windows and Linux have no
runtime bundle-carrier path, and their executable-icon embedding is a
build-time concern.

## License

MIT. Bundled font assets ship under their own SIL OFL 1.1 license
(`assets/inter-glyph.OFL.txt`).
