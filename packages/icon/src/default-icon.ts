/**
 * The synthesized default App icon (plan D4/D5/D8): the application name's
 * first glyph on the shared continuous-curvature squircle tile, emitted as a
 * full platform catalog. One generator serves both the runtime daemon's
 * omitted-appIcon materialization and create-opentray's glyph fallback, so
 * both consumers share one visual standard and one cache discipline.
 *
 * Text-presence law: rendering is verified by pixel probe after rasterization
 * (bright-letter ratio). A ladder miss degrades first to the name's first
 * ASCII letter/digit, then to a forced embedded-font glyph — a blank tile is
 * never silently accepted.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AppIcon } from "@opentray/spec";

import {
  buildGlyphIconSvg,
  GLYPH_ACCENT_DEFAULT,
  glyphLetterOf,
  neutralGlyphLetterOf,
} from "./glyph";
import { embeddedGlyphFont } from "./fonts";
import {
  cloneImage,
  emptyImageOf,
  brightPixelRatio,
  pasteImage,
  rasterizeSvg,
  resizeImage,
  type ImageDataLike,
} from "./raster";
import {
  encodeDensePng,
  encodeIcns,
  encodeIco,
  LINUX_SIZES,
} from "./encode";
import { packageVersion, type OpenTrayAppIconManifest } from "./generate";
import { MACOS_CONTENT_SIZE, APP_ICON_CANVAS } from "./compose";

const CANVAS = APP_ICON_CANVAS;
const CACHE_SCHEMA_VERSION = 1;
/** Bright-pixel floor for a rendered letter (spike: "A" ≈ 6.8%, 笔 ≈ 7.2%). */
const TEXT_PRESENCE_FLOOR = 0.004;
const RECIPE_VERSION = "glyph-v1:squircle-tile:824-macos:72dpi";

export interface DefaultAppIconOptions {
  readonly appName: string;
  readonly accent?: string;
  readonly outputDir: string;
  /**
   * Output file stem. The runtime uses the default (`default-app-icon`); the
   * create pipeline passes `app-icon` so the glyph fallback lands in the
   * scaffold's standard catalog layout — one generator, one visual standard.
   */
  readonly fileStem?: string;
  /** Cache metadata path; defaults to `<outputDir>/../.cache/default-app-icon.json`. */
  readonly cachePath?: string;
}

export interface DefaultAppIconResult {
  readonly fullPngPath: string;
  readonly macOSPngPath: string;
  readonly icnsPath: string;
  readonly icoPath: string;
  readonly linuxPngPaths: readonly { size: number; path: string }[];
  readonly manifestPath: string;
  /** Absolute file sources ready to pass to the runtime as `appIcon`. */
  readonly appIcon: AppIcon;
  readonly cacheIdentity: string;
}

/** Generate (or reuse, by full identity) the default glyph App icon catalog. */
export async function generateDefaultAppIcon(
  options: DefaultAppIconOptions,
): Promise<DefaultAppIconResult> {
  const accent = options.accent ?? GLYPH_ACCENT_DEFAULT;
  const stem = options.fileStem ?? "default-app-icon";
  const fullPngPath = path.join(options.outputDir, `${stem}.png`);
  const macOSPngPath = path.join(options.outputDir, `${stem}-macos.png`);
  const icnsPath = path.join(options.outputDir, `${stem}.icns`);
  const icoPath = path.join(options.outputDir, `${stem}.ico`);
  const linuxPngPaths = LINUX_SIZES.map((size) => ({
    size,
    path: path.join(options.outputDir, "linux", `${size}x${size}`, `${stem}.png`),
  }));
  const manifestPath = path.join(options.outputDir, `${stem}.json`);
  const cachePath =
    options.cachePath ??
    path.join(options.outputDir, "..", ".cache", "default-app-icon.json");
  const appIcon: AppIcon = [
    {
      platform: "darwin",
      format: "icns",
      source: { type: "file", path: path.resolve(icnsPath) },
    },
    {
      platform: "windows",
      format: "ico",
      source: { type: "file", path: path.resolve(icoPath) },
    },
    ...linuxPngPaths.map(({ size, path: pngPath }) => ({
      platform: "linux" as const,
      format: "png" as const,
      size,
      source: { type: "file" as const, path: path.resolve(pngPath) },
    })),
  ];
  const cacheIdentity = await defaultIconCacheIdentity({
    appName: options.appName,
    accent,
    fileStem: stem,
    outputDir: options.outputDir,
  });
  const expected = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cacheIdentity,
    fullPngPath: path.resolve(fullPngPath),
    macOSPngPath: path.resolve(macOSPngPath),
    icnsPath: path.resolve(icnsPath),
    icoPath: path.resolve(icoPath),
    manifestPath: path.resolve(manifestPath),
    linuxPngPaths,
  };
  if (await defaultCacheMatches(cachePath, expected)) {
    return {
      fullPngPath,
      macOSPngPath,
      icnsPath,
      icoPath,
      linuxPngPaths,
      manifestPath,
      appIcon,
      cacheIdentity,
    };
  }

  const full = await renderGlyphPixels(options.appName, accent);
  const macOSVariant = await macosContentVariant(full);

  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(fullPngPath, await encodeDensePng(full));
  await fs.writeFile(macOSPngPath, await encodeDensePng(macOSVariant));
  const pngCache = new Map<number, Uint8Array>();
  const macosPngAt = async (size: number): Promise<Uint8Array> => {
    const cached = pngCache.get(size);
    if (cached !== undefined) return cached;
    const png = await encodeDensePng(
      await resizeImage(cloneImage(macOSVariant), size, size, "lanczos3"),
    );
    pngCache.set(size, png);
    return png;
  };
  const fullPngCache = new Map<number, Uint8Array>();
  const fullPngAt = async (size: number): Promise<Uint8Array> => {
    const cached = fullPngCache.get(size);
    if (cached !== undefined) return cached;
    const png = await encodeDensePng(
      await resizeImage(cloneImage(full), size, size, "lanczos3"),
    );
    fullPngCache.set(size, png);
    return png;
  };
  await fs.writeFile(icnsPath, await encodeIcns(macosPngAt));
  await fs.writeFile(icoPath, await encodeIco(fullPngAt));
  for (const { size, path: pngPath } of linuxPngPaths) {
    await fs.mkdir(path.dirname(pngPath), { recursive: true });
    await fs.writeFile(pngPath, await fullPngAt(size));
  }

  const manifestDirectory = path.dirname(manifestPath);
  const relativeSource = (sourcePath: string): { type: "file"; path: string } => ({
    type: "file",
    path: path.relative(manifestDirectory, sourcePath).split(path.sep).join("/"),
  });
  const manifest: OpenTrayAppIconManifest = {
    schemaVersion: 1,
    appIcon: [
      {
        platform: "darwin",
        format: "icns",
        source: relativeSource(path.resolve(icnsPath)),
      },
      {
        platform: "windows",
        format: "ico",
        source: relativeSource(path.resolve(icoPath)),
      },
      ...linuxPngPaths.map(({ size, path: pngPath }) => ({
        platform: "linux" as const,
        format: "png" as const,
        size,
        source: relativeSource(path.resolve(pngPath)),
      })),
    ],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(
    cachePath,
    `${JSON.stringify({ ...expected, appIcon }, null, 2)}\n`,
    "utf8",
  );
  return {
    fullPngPath,
    macOSPngPath,
    icnsPath,
    icoPath,
    linuxPngPaths,
    manifestPath,
    appIcon,
    cacheIdentity,
  };
}

/** Render the glyph tile with the text-presence ladder (no silent blanks). */
const renderGlyphPixels = async (
  appName: string,
  accent: string,
): Promise<ImageDataLike> => {
  // Ladder: the name's actual first character, then — only when it differs —
  // its first ASCII letter/digit. No unrelated forced glyph: a wrong letter
  // reads as the app's identity and is worse than a diagnosed fallback.
  const primary = glyphLetterOf(appName);
  const neutral = neutralGlyphLetterOf(appName);
  const attempts: readonly string[] =
    neutral !== null && neutral !== primary ? [primary, neutral] : [primary];
  let lastRatio = 0;
  for (const letter of attempts) {
    const svg = buildGlyphIconSvg(appName, accent, letter);
    const rendered = await rasterizeSvg(svg, CANVAS);
    lastRatio = brightPixelRatio(rendered);
    if (lastRatio >= TEXT_PRESENCE_FLOOR) {
      return rendered;
    }
  }
  throw new Error(
    `default app icon glyph rendered without text pixels for ${JSON.stringify(appName)} (probe ${lastRatio.toFixed(4)} < ${TEXT_PRESENCE_FLOOR}); the font ladder covered neither ${JSON.stringify(primary)}${attempts.length > 1 ? ` nor ${JSON.stringify(neutral)}` : ""}`,
  );
};

/** Scale the whole tile into the platform content size on a transparent canvas. */
const macosContentVariant = async (full: ImageDataLike): Promise<ImageDataLike> => {
  const margin = Math.round((CANVAS - MACOS_CONTENT_SIZE) / 2);
  const scaled = await resizeImage(
    full,
    MACOS_CONTENT_SIZE,
    MACOS_CONTENT_SIZE,
    "lanczos3",
  );
  const content = emptyImageOf(CANVAS, CANVAS);
  pasteImage(content, scaled, margin, margin);
  return content;
};

async function defaultIconCacheIdentity(options: {
  appName: string;
  accent: string;
  fileStem: string;
  outputDir: string;
}): Promise<string> {
  const font = await embeddedGlyphFont();
  const fontHash = crypto.createHash("sha256").update(font).digest("hex");
  const stack = [
    await packageVersion("@jsquash/png"),
    await packageVersion("@jsquash/resize"),
    await packageVersion("@resvg/resvg-wasm"),
    await packageVersion("@shockpkg/icon-encoder"),
    await packageVersion("figma-squircle"),
  ].join("|");
  return crypto
    .createHash("sha256")
    .update(
      [
        CACHE_SCHEMA_VERSION,
        RECIPE_VERSION,
        options.appName,
        options.accent,
        options.fileStem,
        fontHash,
        stack,
        path.resolve(options.outputDir),
      ].join("|"),
    )
    .digest("hex");
}

async function defaultCacheMatches(
  cachePath: string,
  expected: {
    schemaVersion: number;
    cacheIdentity: string;
    fullPngPath: string;
    macOSPngPath: string;
    icnsPath: string;
    icoPath: string;
    manifestPath: string;
    linuxPngPaths: readonly { size: number; path: string }[];
  },
): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(cachePath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return false;
    const record = parsed as Record<string, unknown>;
    if (
      record.schemaVersion !== expected.schemaVersion ||
      record.cacheIdentity !== expected.cacheIdentity ||
      record.icnsPath !== expected.icnsPath
    ) {
      return false;
    }
    await Promise.all([
      fs.access(expected.fullPngPath),
      fs.access(expected.macOSPngPath),
      fs.access(expected.icnsPath),
      fs.access(expected.icoPath),
      fs.access(expected.manifestPath),
      ...expected.linuxPngPaths.map(({ path }) => fs.access(path)),
    ]);
    return true;
  } catch {
    return false;
  }
}
