/**
 * App-icon composition (owner round-12): the user's foreground icon is
 * composited onto one of three BACKGROUNDS — black, white, or transparent —
 * and the background is auto-selected for contrast with the artwork's own
 * luminance. The foreground's ORIGINAL PIXELS are always preserved (never
 * recolored); macOS receives an 824px-content variant inside the 1024 canvas
 * (platform best practice), Windows/Linux take the full 1024.
 *
 * The bundled background PNGs carry the squircle alpha mask. That mask is the
 * owner's clipping law (invert → polarize → mask): it is applied to EVERY
 * composition — including the transparent background, whose square source
 * would otherwise render un-rounded on macOS.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

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

const TRANSPARENT: sharp.Color = { r: 0, g: 0, b: 0, alpha: 0 };

const backgroundCache = new Map<Exclude<IconBackground, "transparent">, Buffer>();

const assetsDirectory = (): string =>
  // Source checkout: module lives in src/, assets in ../assets. Built bundle:
  // assets ship beside dist output.
  moduleDirectory.endsWith(`${sep}src`)
    ? join(moduleDirectory, "..", "assets")
    : join(moduleDirectory, "assets");

const loadBackground = async (
  background: Exclude<IconBackground, "transparent">,
): Promise<Buffer> => {
  const cached = backgroundCache.get(background);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = await readFile(join(assetsDirectory(), BACKGROUND_FILES[background]));
  backgroundCache.set(background, bytes);
  return bytes;
};

/** Full-resolution RGBA pixels of a source (no geometry-altering resize). */
const foregroundRaw = async (
  sourcePath: string,
): Promise<{ data: Buffer; width: number; height: number }> => {
  const { data, info } = await sharp(sourcePath, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/**
 * Mean luminance of the artwork's own pixels (0 = black … 1 = white);
 * effectively-empty images report undefined. Alpha-weighted so transparent
 * regions contribute nothing. The source is read at FULL size: a
 * fit-contain downscale would letterbox non-square art with sharp's default
 * OPAQUE BLACK padding and drag white artwork toward "dark" (the round-12
 * defect that made a white icon suggest the white background).
 */
export const foregroundLuminance = async (
  sourcePath: string,
): Promise<number | undefined> => {
  const { data, width, height } = await foregroundRaw(sourcePath);
  let weight = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] ?? 0) / 255;
    if (a <= 0) continue;
    const lum =
      (0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)) /
      255;
    weight += a;
    sum += lum * a;
  }
  if (weight < width * height * 0.02) {
    return undefined; // effectively empty
  }
  return sum / weight;
};

/**
 * Opaque coverage ratio (0–1): the fraction of the source canvas the artwork
 * actually paints. A fully opaque image (logo shot on a solid background)
 * reports 1 — the case where the TRANSPARENT background must be used so the
 * user's own art shows through untouched.
 */
export const foregroundCoverage = async (sourcePath: string): Promise<number> => {
  const { data, width, height } = await foregroundRaw(sourcePath);
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) > 16) opaque += 1;
  }
  return opaque / (width * height);
};

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

let squircleMaskPromise: Promise<Buffer> | undefined;

/**
 * The squircle clip mask (1024², single channel) extracted from the bundled
 * background's alpha: 255 inside the rounded tile, 0 outside.
 */
const squircleMask = (): Promise<Buffer> => {
  squircleMaskPromise ??= (async () => {
    const bg = await loadBackground("white");
    const { data, info } = await sharp(bg, { failOn: "none" })
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== APP_ICON_CANVAS || info.height !== APP_ICON_CANVAS) {
      throw new Error("squircle mask must be 1024×1024");
    }
    return data;
  })();
  return squircleMaskPromise;
};

/** Clip an RGBA buffer to the squircle via a dest-in alpha mask. */
const clipToSquircle = async (bytes: Buffer): Promise<Buffer> => {
  const mask = await squircleMask();
  // Overlay whose alpha IS the mask; dest-in keeps the destination only
  // where the mask is opaque (joinChannel does not reliably replace alpha).
  const overlay = Buffer.alloc(APP_ICON_CANVAS * APP_ICON_CANVAS * 4);
  for (let i = 0; i < APP_ICON_CANVAS * APP_ICON_CANVAS; i += 1) {
    const o = i * 4;
    overlay[o] = 255;
    overlay[o + 1] = 255;
    overlay[o + 2] = 255;
    overlay[o + 3] = mask[i] ?? 0;
  }
  return sharp(bytes)
    .composite([
      {
        input: overlay,
        blend: "dest-in",
        left: 0,
        top: 0,
        raw: { width: APP_ICON_CANVAS, height: APP_ICON_CANVAS, channels: 4 },
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

/**
 * Composite the app icon. The foreground's ORIGINAL pixels are preserved on
 * every background — the background choice provides the contrast, not a
 * recolor of the artwork (the round-12 defect that painted a white icon
 * black).
 *
 * Output: `app-composited.png` at CANVAS size (Windows/Linux form — the tile
 * fills the canvas), plus `app-composited-macos.png` where the ENTIRE tile
 * (background + art) is scaled to 824 and centered on the transparent 1024
 * canvas. Dock icons since Big Sur carry those margins instead of running
 * edge-to-edge; scaling only the art (the earlier defect) left the tile
 * filling all available space.
 */
export const composeAppIcon = async (options: {
  readonly foregroundPath: string;
  readonly background: IconBackground;
  readonly scale?: number;
  readonly outputDir: string;
}): Promise<{
  readonly compositePath: string;
  readonly macOSPath: string;
  readonly background: IconBackground;
}> => {
  const scale = options.scale ?? FOREGROUND_SCALE_DEFAULT;
  const outputDir = options.outputDir;
  await mkdir(outputDir, { recursive: true });

  // Per-composition subdirectory: fixed filenames must never overwrite an
  // earlier composition, because the wizard serves previews by cache key.
  const key = compositionCacheKey({
    foregroundPath: options.foregroundPath,
    background: options.background,
    scale,
  });
  const compositionDir = join(outputDir, key);
  await mkdir(compositionDir, { recursive: true });

  const buildComposite = async (): Promise<Buffer> => {
    const fgSize = Math.round(APP_ICON_CANVAS * scale);
    const offset = Math.round((APP_ICON_CANVAS - fgSize) / 2);

    // The artwork, scaled with TRANSPARENT letterboxing (sharp's default
    // contain-padding is opaque black).
    const foreground = await sharp(options.foregroundPath, { failOn: "none" })
      .resize(fgSize, fgSize, { fit: "contain", background: TRANSPARENT })
      .png()
      .toBuffer();

    const base =
      options.background === "transparent"
        ? sharp({
            create: {
              width: APP_ICON_CANVAS,
              height: APP_ICON_CANVAS,
              channels: 4,
              background: TRANSPARENT,
            },
          })
        : sharp(await loadBackground(options.background));

    const composed = await base
      .composite([{ input: foreground, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    // Every composition is clipped to the squircle: the bundled backgrounds
    // already carry the mask in their alpha, and a transparent background
    // would otherwise leave the source's square corners visible on macOS.
    return options.background === "transparent"
      ? await clipToSquircle(composed)
      : composed;
  };

  const writeVariant = async (bytes: Buffer, suffix: string): Promise<string> => {
    const path = join(compositionDir, `app-composited${suffix}.png`);
    await writeFile(path, bytes);
    return path;
  };

  const full = await buildComposite();
  const macOSMargin = Math.round((APP_ICON_CANVAS - MACOS_CONTENT_SIZE) / 2);
  const macOSBytes = await sharp(full)
    .resize(MACOS_CONTENT_SIZE, MACOS_CONTENT_SIZE, { kernel: sharp.kernel.lanczos3 })
    .extend({
      top: macOSMargin,
      bottom: macOSMargin,
      left: macOSMargin,
      right: macOSMargin,
      background: TRANSPARENT,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const compositePath = await writeVariant(full, "");
  const macOSPath = await writeVariant(macOSBytes, "-macos");
  return { compositePath, macOSPath, background: options.background };
};

/** Stable cache key for a composed icon (wizard-side preview reuse). */
export const compositionCacheKey = (options: {
  readonly foregroundPath: string;
  readonly background: IconBackground;
  readonly scale: number;
}): string =>
  createHash("sha256")
    .update(`${options.foregroundPath}|${options.background}|${options.scale}`)
    .digest("hex")
    .slice(0, 16);
