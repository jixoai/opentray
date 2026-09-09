/**
 * @opentray/icon — the shared OpenTray app-icon generation kernel.
 *
 * Public surface:
 * - `generateOpenTrayAppIcon` — strict cross-platform AppIcon catalog from a
 *   brand source image (used by the Vite plugin and create-opentray).
 * - `generateDefaultAppIcon` — the synthesized first-letter glyph default
 *   (used by the runtime daemon's omitted-appIcon materialization and by
 *   create-opentray's glyph fallback).
 * - Composition layer (`composeAppIcon` …) for consumer-supplied foregrounds.
 * - Raster utilities shared by the above.
 */
export {
  generateOpenTrayAppIcon,
  packageVersion,
  type OpenTrayAppIconOptions,
  type OpenTrayAppIconCacheMetadata,
  type OpenTrayAppIconManifest,
} from "./generate";

export {
  generateDefaultAppIcon,
  type DefaultAppIconOptions,
  type DefaultAppIconResult,
} from "./default-icon";

export {
  composeAppIcon,
  compositionCacheKey,
  foregroundStats,
  foregroundLuminance,
  foregroundCoverage,
  autoBackground,
  resetCompositionCache,
  APP_ICON_CANVAS,
  MACOS_CONTENT_SIZE,
  FOREGROUND_SCALE_DEFAULT,
  ICON_BACKGROUNDS,
  type IconBackground,
} from "./compose";

export {
  buildGlyphIconSvg,
  glyphLetterOf,
  neutralGlyphLetterOf,
  GLYPH_ACCENT_DEFAULT,
  GLYPH_CANVAS,
  GLYPH_TILE_INSET,
  GLYPH_TILE_SIZE,
  GLYPH_TILE_RADIUS,
  GLYPH_TILE_SMOOTHING,
} from "./glyph";

export {
  glyphFontLadder,
  embeddedGlyphFont,
  resetGlyphFontCache,
  GLYPH_FONT_FAMILY,
} from "./fonts";

export {
  decodeImage,
  decodeImageFile,
  rasterizeSvg,
  encodeImagePng,
  resizeImage,
  containImage,
  insideImage,
  cloneImage,
  emptyImageOf,
  pasteImage,
  cropImage,
  trimBounds,
  opaqueCoverage,
  brightPixelRatio,
  type ImageDataLike,
  type ResizeMethod,
} from "./raster";

export {
  encodeDensePng,
  encodeIcns,
  encodeIco,
  pngWithDensity,
  ICNS_REPRESENTATIONS,
  ICO_SIZES,
  LINUX_SIZES,
} from "./encode";

export { IconKernelInitError } from "./wasm";
