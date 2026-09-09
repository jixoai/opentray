/**
 * App-icon composition (ported from @create-opentray/core icon-compose, owner
 * round-12 semantics preserved): the user's foreground icon is composited onto
 * one of three BACKGROUNDS — black, white, or transparent — with the
 * background auto-selected for contrast against the artwork's own luminance.
 * The foreground's ORIGINAL PIXELS are always preserved (never recolored);
 * macOS receives an 824px-content variant inside the 1024 canvas (platform
 * best practice), Windows/Linux take the full 1024.
 *
 * The bundled background PNGs carry the squircle alpha mask. That mask is the
 * owner's clipping law (invert → polarize → mask): it is applied to EVERY
 * composition — including the transparent background, whose square source
 * would otherwise render un-rounded on macOS.
 *
 * Pixel operations run on raw ImageData (WASM stack); sharp is not involved.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assetsDirectory } from "./assets";
import {
  cloneImage,
  containImage,
  decodeImageFile,
  emptyImageOf,
  insideImage,
  pasteImage,
  resizeImage,
  type ImageDataLike,
} from "./raster";

export const APP_ICON_CANVAS = 1024;
/** macOS best-practice content size inside the 1024 canvas. */
export const MACOS_CONTENT_SIZE = 824;
/** Default foreground inset ratio (user-adjustable 0.5–0.95). */
export const FOREGROUND_SCALE_DEFAULT = 0.8;

export type IconBackground = "black" | "white" | "transparent";

export const ICON_BACKGROUNDS: readonly IconBackground[] = [
  "black",
  "white",
  "transparent",
];

const BACKGROUND_FILES: Record<Exclude<IconBackground, "transparent">, string> = {
  black: "create-openspec-template-iOS-Dark-1024@1x.png",
  white: "create-openspec-template-iOS-Default-1024@1x.png",
};

const backgroundCache = new Map<Exclude<IconBackground, "transparent">, ImageDataLike>();

const loadBackground = async (
  background: Exclude<IconBackground, "transparent">,
): Promise<ImageDataLike> => {
  const cached = backgroundCache.get(background);
  if (cached !== undefined) return cloneImage(cached);
  const image = await decodeImageFile(
    join(assetsDirectory(), BACKGROUND_FILES[background]),
  );
  backgroundCache.set(background, image);
  return cloneImage(image);
};

/** Test hook: drop memoized background tiles. */
export const resetCompositionCache = (): void => {
  backgroundCache.clear();
  squircleMaskImage = undefined;
};

/**
 * Full-resolution RGBA pixels of a source sampled at a bounded size with NO
 * padding (sharp `fit: "inside"` semantics): letterbox pixels would dilute
 * the coverage statistic that drives background auto-selection. EXIF
 * orientation is applied during decode so phone-photo icons compose upright.
 */
const foregroundSample = async (
  sourcePath: string,
): Promise<ImageDataLike> => {
  const decoded = await decodeImageFile(sourcePath);
  return insideImage(decoded, 512, "lanczos3");
};

/** Both analysis metrics from ONE decode (huge uploads must not double). */
export const foregroundStats = async (
  sourcePath: string,
): Promise<{ luminance: number | undefined; coverage: number }> => {
  const { data, width, height } = await foregroundSample(sourcePath);
  let weight = 0;
  let sum = 0;
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] ?? 0) / 255;
    if (a > 0) {
      const lum =
        (0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)) / 255;
      weight += a;
      sum += lum * a;
    }
    if ((data[i + 3] ?? 0) > 16) opaque += 1;
  }
  const luminance = weight < width * height * 0.02 ? undefined : sum / weight;
  return { luminance, coverage: opaque / (width * height) };
};

/** Mean luminance of the artwork's own pixels (0 = black … 1 = white). */
export const foregroundLuminance = async (
  sourcePath: string,
): Promise<number | undefined> =>
  (await foregroundStats(sourcePath)).luminance;

/** Opaque coverage ratio (0–1): fraction of the canvas the artwork paints. */
export const foregroundCoverage = async (sourcePath: string): Promise<number> =>
  (await foregroundStats(sourcePath)).coverage;

/** Owner rule: pick the background for a foreground automatically. */
export const autoBackground = (options: {
  readonly luminance: number | undefined;
  readonly coverage: number;
}): IconBackground => {
  // A fully opaque foreground already carries its own backdrop — compose on
  // transparency so the user's art passes through verbatim.
  if (options.coverage >= 0.985) {
    return "transparent";
  }
  // Light artwork → dark background; dark artwork → light background. The
  // artwork's own pixels stay untouched either way.
  return options.luminance !== undefined && options.luminance > 0.5
    ? "black"
    : "white";
};

let squircleMaskImage: Promise<Uint8Array> | undefined;

/**
 * The squircle clip mask (1024², one byte per pixel) taken from the bundled
 * background's alpha: 255 inside the rounded tile, 0 outside.
 */
const squircleMask = (): Promise<Uint8Array> => {
  squircleMaskImage ??= (async () => {
    const bg = await loadBackground("white");
    if (bg.width !== APP_ICON_CANVAS || bg.height !== APP_ICON_CANVAS) {
      throw new Error("squircle mask must be 1024×1024");
    }
    const mask = new Uint8Array(APP_ICON_CANVAS * APP_ICON_CANVAS);
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = bg.data[i * 4 + 3]!;
    }
    return mask;
  })();
  return squircleMaskImage;
};

/** Clip RGBA pixels to the squircle via a dest-in alpha multiply. */
const clipToSquircle = async (image: ImageDataLike): Promise<ImageDataLike> => {
  const mask = await squircleMask();
  const out = cloneImage(image);
  for (let i = 0; i < mask.length; i += 1) {
    out.data[i * 4 + 3] = Math.round((out.data[i * 4 + 3]! * mask[i]!) / 255);
  }
  return out;
};

/**
 * Composite the app icon. The foreground's ORIGINAL pixels are preserved on
 * every background — the background choice provides the contrast, not a
 * recolor of the artwork.
 *
 * Output: the full-canvas tile (Windows/Linux form) plus the macOS variant
 * where the ENTIRE tile (background + art) is scaled to the platform content
 * size and centered on the transparent canvas. Dock icons since Big Sur
 * carry those margins instead of running edge-to-edge.
 */
export const composeAppIcon = async (options: {
  readonly foregroundPath: string;
  readonly background: IconBackground;
  readonly scale?: number;
  /** v1 sampling intent: false keeps pixel-art edges discrete (point sampling). */
  readonly imageSmoothingEnabled?: boolean;
  readonly outputDir: string;
}): Promise<{
  readonly compositePath: string;
  readonly macOSPath: string;
  readonly background: IconBackground;
}> => {
  const scale = options.scale ?? FOREGROUND_SCALE_DEFAULT;
  const smoothing = options.imageSmoothingEnabled !== false; // v1 default: true
  const method = smoothing ? "lanczos3" as const : "nearest" as const;
  await mkdir(options.outputDir, { recursive: true });

  // Per-composition subdirectory: fixed filenames must never overwrite an
  // earlier composition, because the wizard serves previews by cache key.
  const key = compositionCacheKey({
    foregroundPath: options.foregroundPath,
    background: options.background,
    scale,
    imageSmoothingEnabled: smoothing,
  });
  const compositionDir = join(options.outputDir, key);
  await mkdir(compositionDir, { recursive: true });

  const fgSize = Math.round(APP_ICON_CANVAS * scale);
  const offset = Math.round((APP_ICON_CANVAS - fgSize) / 2);

  const decoded = await decodeImageFile(options.foregroundPath);
  const foreground = await containImage(decoded, fgSize, fgSize, method);

  const base =
    options.background === "transparent"
      ? emptyImageOf(APP_ICON_CANVAS, APP_ICON_CANVAS)
      : await loadBackground(options.background);
  const composed = cloneImage(base);
  pasteImage(composed, foreground, offset, offset);
  // Every composition is clipped to the squircle: OVER compositing lets the
  // foreground's square corners escape the tile at large scales, so the clip
  // runs for ALL backgrounds, not just the transparent one.
  const clipped = await clipToSquircle(composed);

  const macOSMargin = Math.round((APP_ICON_CANVAS - MACOS_CONTENT_SIZE) / 2);
  const macOSContent = await resizeImage(
    clipped,
    MACOS_CONTENT_SIZE,
    MACOS_CONTENT_SIZE,
    // Sampling intent governs the macOS downscale as well: pixel art must
    // keep hard edges in the content variant, not just the full-size tile.
    method,
  );
  const macOSVariant = emptyImageOf(APP_ICON_CANVAS, APP_ICON_CANVAS);
  pasteImage(macOSVariant, macOSContent, macOSMargin, macOSMargin);

  const writeVariant = async (image: ImageDataLike, suffix: string): Promise<string> => {
    const path = join(compositionDir, `app-composited${suffix}.png`);
    const { encodeDensePng } = await import("./encode");
    await writeFile(path, await encodeDensePng(image));
    return path;
  };

  const compositePath = await writeVariant(clipped, "");
  const macOSPath = await writeVariant(macOSVariant, "-macos");
  return { compositePath, macOSPath, background: options.background };
};

/** Stable cache key for a composed icon (wizard-side preview reuse). */
export const compositionCacheKey = (options: {
  readonly foregroundPath: string;
  readonly background: IconBackground;
  readonly scale: number;
  readonly imageSmoothingEnabled?: boolean;
}): string =>
  createHash("sha256")
    .update(
      `${options.foregroundPath}|${options.background}|${options.scale}|${options.imageSmoothingEnabled !== false ? "smooth" : "nearest"}`,
    )
    .digest("hex")
    .slice(0, 16);
