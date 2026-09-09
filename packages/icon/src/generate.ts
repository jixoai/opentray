// App-icon catalog generation (ported from @opentray/vite-plugin app-icon;
// orthogonal intents maintained 2026-07-20, kernel move 2026-09):
// 1. Normalize a brand source image into a readable application icon with a
//    white safe-area tile and a transparent outer margin (continuous-curvature
//    squircle, figma-squircle path).
// 2. Produce standard macOS ICNS, Windows ICO, and Linux theme PNG assets with
//    explicit 72 DPI density.
// 3. Cache the output by source, source implementation, bundled implementation,
//    recipe, encoder/rasterizer stack versions, and every output path so stale
//    generated assets cannot leak into a dev runtime.
// Compromise: published packages do not ship TypeScript sources, so their cache
// uses a null source hash and the bundled implementation hash as the
// implementation authority; linked consumers hash both layers.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { getSvgPath } from "figma-squircle";

import type { AppIcon } from "@opentray/spec";

import {
  cloneImage,
  containImage,
  cropImage,
  decodeImageFile,
  emptyImageOf,
  insideImage,
  pasteImage,
  rasterizeSvg,
  resizeImage,
  trimBounds,
  type ImageDataLike,
} from "./raster";
import {
  encodeDensePng,
  encodeIcns,
  encodeIco,
  ICO_SIZES,
  ICNS_REPRESENTATIONS,
  LINUX_SIZES,
} from "./encode";

const ICON_SIZE = 1024;
const TILE_INSET = 64;
const TILE_SIZE = ICON_SIZE - TILE_INSET * 2;
const TILE_RADIUS = 196;
const TILE_SMOOTHING = 1;
const SYMBOL_SIZE = 704;
const APP_ICON_DENSITY = 72;
const CACHE_SCHEMA_VERSION = 7;
const RECIPE_VERSION = `squircle-v4:${ICON_SIZE}:${TILE_INSET}:${TILE_RADIUS}:${TILE_SMOOTHING}:${SYMBOL_SIZE}:${APP_ICON_DENSITY}dpi:icns-tagged:wasm-stack`;

const require = createRequire(import.meta.url);

export interface OpenTrayAppIconOptions {
  readonly sourcePath: string;
  readonly outputPath?: string;
  readonly icnsOutputPath?: string;
  readonly icoOutputPath?: string;
  readonly linuxOutputDirectory?: string;
  readonly manifestOutputPath?: string;
  readonly cachePath?: string;
  /** Advanced: override the module whose bytes identify the generator implementation. */
  readonly implementationPath?: string;
  /** Advanced: override the source file whose bytes identify the generator implementation. */
  readonly implementationSourcePath?: string;
  /**
   * Pre-composed source: skip glyph re-tiling; pass pixels through verbatim.
   */
  readonly composed?: boolean;
  /**
   * Separate macOS content source; ICNS encodes from this while ICO/Linux
   * use sourcePath.
   */
  readonly macosSourcePath?: string;
}

export interface OpenTrayAppIconCacheMetadata {
  readonly schemaVersion: number;
  readonly sourceSha256: string;
  readonly macosSourceSha256?: string;
  readonly composed?: boolean;
  readonly sourceImplementationSha256: string | null;
  readonly implementationSha256: string;
  readonly recipeVersion: string;
  readonly jsquashPngVersion: string;
  readonly jsquashResizeVersion: string;
  readonly resvgVersion: string;
  readonly iconEncoderVersion: string;
  readonly figmaSquircleVersion: string;
  readonly exifrVersion: string;
  readonly outputPath: string;
  readonly icnsOutputPath: string;
  readonly icoOutputPath: string;
  readonly linuxPngOutputPaths: readonly {
    readonly size: number;
    readonly path: string;
  }[];
  readonly manifestOutputPath: string;
  /** Absolute file sources ready to pass to OpenTray at runtime. */
  readonly appIcon: AppIcon;
}

export interface OpenTrayAppIconManifest {
  readonly schemaVersion: 1;
  /** File paths are relative to the manifest file. */
  readonly appIcon: AppIcon;
}

/** Generate one strict cross-platform AppIcon asset set. */
export async function generateOpenTrayAppIcon(
  options: OpenTrayAppIconOptions
): Promise<OpenTrayAppIconCacheMetadata> {
  const outputPath =
    options.outputPath ??
    path.join(path.dirname(options.sourcePath), "app-icon.png");
  const icnsOutputPath =
    options.icnsOutputPath ??
    path.join(path.dirname(outputPath), "app-icon.icns");
  const icoOutputPath =
    options.icoOutputPath ??
    path.join(path.dirname(outputPath), "app-icon.ico");
  const linuxOutputDirectory =
    options.linuxOutputDirectory ??
    path.join(path.dirname(outputPath), "linux");
  const manifestOutputPath =
    options.manifestOutputPath ??
    path.join(path.dirname(outputPath), "app-icon.json");
  const cachePath =
    options.cachePath ??
    path.join(path.dirname(outputPath), "../../.cache/app-icon.json");
  const implementationPath =
    options.implementationPath ?? fileURLToPath(import.meta.url);
  const metadata = await createCacheMetadata({
    sourcePath: options.sourcePath,
    implementationPath,
    ...(options.composed === true ? { composed: true } : {}),
    ...(options.macosSourcePath === undefined
      ? {}
      : { macosSourcePath: options.macosSourcePath }),
    outputPath,
    icnsOutputPath,
    icoOutputPath,
    linuxOutputDirectory,
    manifestOutputPath,
    ...(options.implementationSourcePath === undefined
      ? {}
      : { implementationSourcePath: options.implementationSourcePath }),
  });

  if (await cacheMatches(cachePath, metadata)) return metadata;

  const rendered = await renderAppIconPixels(
    options.sourcePath,
    options.composed === true,
  );
  const macosRendered =
    options.macosSourcePath === undefined || options.macosSourcePath === options.sourcePath
      ? rendered
      : await renderAppIconPixels(options.macosSourcePath, options.composed === true);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(icnsOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(icoOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(outputPath, await encodeDensePng(rendered));
  await fs.writeFile(
    icnsOutputPath,
    await encodeIcns(pngCacheFor(macosRendered).pngAt),
  );
  await fs.writeFile(
    icoOutputPath,
    await encodeIco(pngCacheFor(rendered).pngAt),
  );
  for (const { size, path: pngPath } of metadata.linuxPngOutputPaths) {
    await fs.mkdir(path.dirname(pngPath), { recursive: true });
    await fs.writeFile(
      pngPath,
      await encodeDensePng(
        await resizeImage(rendered, size, size, "lanczos3"),
      ),
    );
  }
  await writeManifest(metadata);
  await fs.writeFile(
    cachePath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
  return metadata;
}

const pngCacheFor = (source: ImageDataLike): {
  pngAt(size: number): Promise<Uint8Array>;
} => {
  const bySize = new Map<number, Uint8Array>();
  return {
    async pngAt(size: number): Promise<Uint8Array> {
      const cached = bySize.get(size);
      if (cached !== undefined) return cached;
      const png = await encodeDensePng(
        await resizeImage(cloneImage(source), size, size, "lanczos3"),
      );
      bySize.set(size, png);
      return png;
    },
  };
};

async function renderAppIconPixels(
  sourcePath: string,
  composed = false,
): Promise<ImageDataLike> {
  if (composed) {
    // Pre-composed art: normalize to the 1024 canvas and pass through —
    // the background and squircle mask are already baked in.
    const decoded = await decodeImageFile(sourcePath);
    return containImage(decoded, ICON_SIZE, ICON_SIZE, "lanczos3");
  }
  const source = await decodeImageFile(sourcePath);
  const bounds = trimBounds(source, 0);
  if (bounds === null) throw new Error(`icon source has no visible pixels: ${sourcePath}`);
  const trimmed = cropImage(
    source,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
  );
  const symbol = await insideImage(trimmed, SYMBOL_SIZE, "lanczos3");
  const symbolLeft = Math.round((ICON_SIZE - symbol.width) / 2);
  const symbolTop = Math.round((ICON_SIZE - symbol.height) / 2);
  const squirclePath = getSvgPath({
    width: TILE_SIZE,
    height: TILE_SIZE,
    cornerRadius: TILE_RADIUS,
    cornerSmoothing: TILE_SMOOTHING,
    preserveSmoothing: true,
  });
  const whiteTile = await rasterizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}"><path d="${squirclePath}" fill="#fff"/></svg>`,
    TILE_SIZE,
  );
  const canvas = emptyImageOf(ICON_SIZE, ICON_SIZE);
  pasteImage(canvas, whiteTile, TILE_INSET, TILE_INSET);
  pasteImage(canvas, symbol, symbolLeft, symbolTop);
  return canvas;
}

async function createCacheMetadata(options: {
  sourcePath: string;
  implementationPath: string;
  implementationSourcePath?: string;
  /** Pass-through mode: skip glyph re-tiling (part of cache identity). */
  composed?: boolean;
  /** Separate macOS content source (part of cache identity). */
  macosSourcePath?: string;
  outputPath: string;
  icnsOutputPath: string;
  icoOutputPath: string;
  linuxOutputDirectory: string;
  manifestOutputPath: string;
}): Promise<OpenTrayAppIconCacheMetadata> {
  const sourceImplementationPath =
    options.implementationSourcePath ??
    (await resolveSourceImplementationPath(options.implementationPath));
  const linuxPngOutputPaths = LINUX_SIZES.map((size) => ({
    size,
    path: path.resolve(
      options.linuxOutputDirectory,
      `${size}x${size}`,
      "app-icon.png"
    ),
  }));
  const icnsOutputPath = path.resolve(options.icnsOutputPath);
  const icoOutputPath = path.resolve(options.icoOutputPath);
  const appIcon: AppIcon = [
    {
      platform: "darwin",
      format: "icns",
      source: { type: "file", path: icnsOutputPath },
    },
    {
      platform: "windows",
      format: "ico",
      source: { type: "file", path: icoOutputPath },
    },
    ...linuxPngOutputPaths.map(({ size, path: pngPath }) => ({
      platform: "linux" as const,
      format: "png" as const,
      size,
      source: { type: "file" as const, path: pngPath },
    })),
  ];
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceSha256: await sha256(options.sourcePath),
    ...(options.macosSourcePath === undefined
      ? {}
      : { macosSourceSha256: await sha256(options.macosSourcePath) }),
    ...(options.composed === true ? { composed: true } : {}),
    sourceImplementationSha256:
      sourceImplementationPath === null
        ? null
        : await sha256(sourceImplementationPath),
    implementationSha256: await sha256(options.implementationPath),
    recipeVersion: RECIPE_VERSION,
    jsquashPngVersion: await packageVersion("@jsquash/png"),
    jsquashResizeVersion: await packageVersion("@jsquash/resize"),
    resvgVersion: await packageVersion("@resvg/resvg-wasm"),
    iconEncoderVersion: await packageVersion("@shockpkg/icon-encoder"),
    figmaSquircleVersion: await packageVersion("figma-squircle"),
    exifrVersion: await packageVersion("exifr"),
    outputPath: path.resolve(options.outputPath),
    icnsOutputPath,
    icoOutputPath,
    linuxPngOutputPaths,
    manifestOutputPath: path.resolve(options.manifestOutputPath),
    appIcon,
  };
}

async function writeManifest(
  metadata: OpenTrayAppIconCacheMetadata
): Promise<void> {
  const manifestDirectory = path.dirname(metadata.manifestOutputPath);
  const relativeSource = (
    sourcePath: string
  ): { type: "file"; path: string } => ({
    type: "file",
    path: path
      .relative(manifestDirectory, sourcePath)
      .split(path.sep)
      .join("/"),
  });
  const manifest: OpenTrayAppIconManifest = {
    schemaVersion: 1,
    appIcon: [
      {
        platform: "darwin",
        format: "icns",
        source: relativeSource(metadata.icnsOutputPath),
      },
      {
        platform: "windows",
        format: "ico",
        source: relativeSource(metadata.icoOutputPath),
      },
      ...metadata.linuxPngOutputPaths.map(({ size, path: pngPath }) => ({
        platform: "linux" as const,
        format: "png" as const,
        size,
        source: relativeSource(pngPath),
      })),
    ],
  };
  await fs.mkdir(manifestDirectory, { recursive: true });
  await fs.writeFile(
    metadata.manifestOutputPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

async function cacheMatches(
  file: string,
  expected: OpenTrayAppIconCacheMetadata
): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isCacheMetadata(parsed) || !sameCacheIdentity(parsed, expected))
      return false;
    await Promise.all([
      fs.access(expected.outputPath),
      fs.access(expected.icnsOutputPath),
      fs.access(expected.icoOutputPath),
      fs.access(expected.manifestOutputPath),
      ...expected.linuxPngOutputPaths.map(({ path: outputPath }) =>
        fs.access(outputPath)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

function sameCacheIdentity(
  actual: OpenTrayAppIconCacheMetadata,
  expected: OpenTrayAppIconCacheMetadata
): boolean {
  return (
    actual.schemaVersion === expected.schemaVersion &&
    actual.sourceSha256 === expected.sourceSha256 &&
    actual.macosSourceSha256 === expected.macosSourceSha256 &&
    actual.composed === expected.composed &&
    actual.sourceImplementationSha256 === expected.sourceImplementationSha256 &&
    actual.implementationSha256 === expected.implementationSha256 &&
    actual.recipeVersion === expected.recipeVersion &&
    actual.jsquashPngVersion === expected.jsquashPngVersion &&
    actual.jsquashResizeVersion === expected.jsquashResizeVersion &&
    actual.resvgVersion === expected.resvgVersion &&
    actual.iconEncoderVersion === expected.iconEncoderVersion &&
    actual.figmaSquircleVersion === expected.figmaSquircleVersion &&
    actual.exifrVersion === expected.exifrVersion &&
    actual.outputPath === expected.outputPath &&
    actual.icnsOutputPath === expected.icnsOutputPath &&
    actual.icoOutputPath === expected.icoOutputPath &&
    actual.manifestOutputPath === expected.manifestOutputPath &&
    JSON.stringify(actual.linuxPngOutputPaths) ===
      JSON.stringify(expected.linuxPngOutputPaths) &&
    JSON.stringify(actual.appIcon) === JSON.stringify(expected.appIcon)
  );
}

function isCacheMetadata(
  value: unknown
): value is OpenTrayAppIconCacheMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.schemaVersion === "number" &&
    typeof record.sourceSha256 === "string" &&
    (record.macosSourceSha256 === undefined ||
      typeof record.macosSourceSha256 === "string") &&
    (record.composed === undefined || typeof record.composed === "boolean") &&
    (record.sourceImplementationSha256 === null ||
      typeof record.sourceImplementationSha256 === "string") &&
    typeof record.implementationSha256 === "string" &&
    typeof record.recipeVersion === "string" &&
    typeof record.jsquashPngVersion === "string" &&
    typeof record.jsquashResizeVersion === "string" &&
    typeof record.resvgVersion === "string" &&
    typeof record.iconEncoderVersion === "string" &&
    typeof record.figmaSquircleVersion === "string" &&
    typeof record.exifrVersion === "string" &&
    typeof record.outputPath === "string" &&
    typeof record.icnsOutputPath === "string" &&
    typeof record.icoOutputPath === "string" &&
    Array.isArray(record.linuxPngOutputPaths) &&
    typeof record.manifestOutputPath === "string" &&
    Array.isArray(record.appIcon)
  );
}

async function resolveSourceImplementationPath(
  implementationPath: string
): Promise<string | null> {
  if (implementationPath.endsWith(`${path.sep}src${path.sep}generate.ts`)) {
    return implementationPath;
  }
  const candidate = path.join(
    path.dirname(path.dirname(implementationPath)),
    "src",
    "generate.ts"
  );
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export async function packageVersion(packageName: string): Promise<string> {
  const entryPath = require.resolve(packageName);
  let directory = path.dirname(entryPath);
  while (true) {
    const packagePath = path.join(directory, "package.json");
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(packagePath, "utf8")
      );
      if (isPackageMetadata(parsed, packageName)) return parsed.version;
    } catch {
      // Continue towards the package root; package exports may hide package.json.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to resolve ${packageName} package version`);
}

function isPackageMetadata(
  value: unknown,
  packageName: string
): value is { name: string; version: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === packageName &&
    "version" in value &&
    typeof value.version === "string"
  );
}

async function sha256(file: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}
