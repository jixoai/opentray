/**
 * App-icon composition (owner round-12): the user's foreground icon is
 * composited onto one of three BACKGROUNDS — black, white, or transparent —
 * and the foreground is auto-tinted for contrast against that background.
 * macOS receives the result at 824px inside the 1024 canvas (platform
 * best practice: macOS masks ~10% margins); Windows takes the full 1024.
 *
 * The bundled background PNGs already carry the squircle alpha mask, which
 * is what rounds the composite's corners on macOS.
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

/**
 * Mean luminance of the opaque pixels (0 = black … 1 = white); a fully
 * transparent image reports undefined. Alpha-weighted so faint specks
 * cannot skew the reading.
 */
export const foregroundLuminance = async (
  sourcePath: string,
): Promise<number | undefined> => {
  const { data, info } = await sharp(sourcePath, { failOn: "none" })
    .ensureAlpha()
    .resize(64, 64, { fit: "contain" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let weight = 0;
  let sum = 0;
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    const a = (data[i + 3] ?? 0) / 255;
    if (a <= 0) continue;
    const lum =
      (0.299 * (data[i] ?? 0) +
        0.587 * (data[i + 1] ?? 0) +
        0.114 * (data[i + 2] ?? 0)) /
      255;
    weight += a;
    sum += lum * a;
  }
  if (weight < info.width * info.height * 0.02) {
    return undefined; // effectively empty
  }
  return sum / weight;
};

/**
 * Opaque coverage ratio (0–1): the fraction of the canvas the foreground
 * actually paints. A fully opaque square (logo shot on solid background)
 * reports 1 — the case where the TRANSPARENT background must be used so the
 * user's own art shows through untouched.
 */
export const foregroundCoverage = async (sourcePath: string): Promise<number> => {
  const { data, info } = await sharp(sourcePath, { failOn: "none" })
    .ensureAlpha()
    .resize(64, 64, { fit: "contain" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let opaque = 0;
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    if ((data[i + 3] ?? 0) > 16) opaque += 1;
  }
  return opaque / (info.width * info.height);
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
  // Light artwork → dark background; dark artwork → light background.
  return options.luminance !== undefined && options.luminance > 0.5
    ? "black"
    : "white";
};

/**
 * Composite the app icon.
 *
 * Foreground treatment: the artwork is normalized to a SINGLE-COLOR layer by
 * using its alpha as a mask (this is exactly what the scraper's solid
 * silhouettes are) — white when it must read against the black background,
 * black against white. On the transparent background the ORIGINAL pixels
 * pass through untouched (no recoloring of the user's art).
 *
 * Output: `app-composited.png` at CANVAS size, plus `app-composited-macos.png`
 * where the foreground is re-rendered at 824px (background kept at 1024 —
 * macOS masks the margins, so the squircle stays crisp while content lands
 * at the best-practice scale).
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

  const build = async (contentSize: number, suffix: string): Promise<string> => {
    const fgSize = Math.round(contentSize * scale);
    const offset = Math.round((APP_ICON_CANVAS - fgSize) / 2);

    // Alpha-mask the foreground into a solid-color layer.
    const { data: fgRaw, info: fgInfo } = await sharp(options.foregroundPath, {
      failOn: "none",
    })
      .ensureAlpha()
      .resize(fgSize, fgSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = Buffer.alloc(fgSize * fgSize);
    for (let i = 0; i < fgSize * fgSize; i += 1) {
      mask[i] = fgRaw[i * fgInfo.channels + 3] ?? 0;
    }

    let base: sharp.Sharp;
    if (options.background === "transparent") {
      base = sharp({
        create: {
          width: APP_ICON_CANVAS,
          height: APP_ICON_CANVAS,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      });
      // Original pixels pass through on the transparent background.
      const original = await sharp(options.foregroundPath, { failOn: "none" })
        .resize(fgSize, fgSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const bytes = await base
        .composite([{ input: original, top: offset, left: offset }])
        .png({ compressionLevel: 9 })
        .toBuffer();
      const path = join(compositionDir, `app-composited${suffix}.png`);
      await writeFile(path, bytes);
      return path;
    }

    const color = options.background === "black" ? 255 : 0;
    const layer = await sharp(mask, {
      raw: { width: fgSize, height: fgSize, channels: 1 },
    })
      .tint({ r: color, g: color, b: color })
      .png()
      .toBuffer();
    const bgBytes = await loadBackground(options.background);
    const bytes = await sharp(bgBytes)
      .composite([{ input: layer, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    const path = join(compositionDir, `app-composited${suffix}.png`);
    await writeFile(path, bytes);
    return path;
  };

  const compositePath = await build(APP_ICON_CANVAS, "");
  const macOSPath = await build(MACOS_CONTENT_SIZE, "-macos");
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
