// Orthogonal intents (maintained 2026-07-20; original user request: move the
// skill-creator-v2 app-icon build chain into OpenTray's Vite plugin):
// 1. Normalize a brand source image into a readable application icon with a
//    white safe-area tile and a transparent outer margin.
// 2. Produce standard macOS ICNS, Windows ICO, and Linux theme PNG assets.
// 3. Cache the output by source, source implementation, bundled implementation,
//    recipe, encoder, and output identity so stale generated assets cannot leak
//    into a dev runtime.
// Compromise: published packages do not ship TypeScript sources, so their cache
//    uses a null source hash and the bundled plugin hash as the implementation
//    authority; linked consumers hash both layers.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { getSvgPath } from "figma-squircle";
import sharp from "sharp";
import type { Plugin } from "vite";

import type { AppIcon } from "@opentray/spec";
import { IconIcns, IconIco } from "@shockpkg/icon-encoder";

const ICON_SIZE = 1024;
const TILE_INSET = 64;
const TILE_SIZE = ICON_SIZE - TILE_INSET * 2;
const TILE_RADIUS = 196;
const TILE_SMOOTHING = 1;
const SYMBOL_SIZE = 704;
const APP_ICON_DENSITY = 72;
const CACHE_SCHEMA_VERSION = 6;
const RECIPE_VERSION = `squircle-v3:${ICON_SIZE}:${TILE_INSET}:${TILE_RADIUS}:${TILE_SMOOTHING}:${SYMBOL_SIZE}:${APP_ICON_DENSITY}dpi:icns-tagged`;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;
const ICNS_REPRESENTATIONS = [
  { tag: "ic12", size: 64 },
  { tag: "ic07", size: 128 },
  { tag: "ic13", size: 256 },
  { tag: "ic08", size: 256 },
  { tag: "ic04", size: 16 },
  { tag: "ic14", size: 512 },
  { tag: "ic09", size: 512 },
  { tag: "ic05", size: 32 },
  { tag: "ic10", size: 1024 },
  { tag: "ic11", size: 32 },
] as const;

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
  readonly sourceImplementationSha256: string | null;
  readonly implementationSha256: string;
  readonly recipeVersion: string;
  readonly sharpVersion: string;
  readonly iconEncoderVersion: string;
  readonly figmaSquircleVersion: string;
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

export interface OpenTrayAppIconPluginOptions {
  /** Brand source image. This is intentionally explicit so the plugin is app-agnostic. */
  readonly sourcePath: string;
  /**
   * Pre-composed source: the image already carries its background and
   * squircle mask, so glyph re-tiling (trim → symbol → white tile) is
   * skipped and the pixels pass through verbatim.
   */
  readonly composed?: boolean;
  /**
   * Separate macOS content source (e.g. the best-practice 824-in-1024
   * variant): ICNS encodes from this while ICO/Linux use sourcePath.
   */
  readonly macosSourcePath?: string;
  readonly outputPath?: string;
  readonly icnsOutputPath?: string;
  readonly icoOutputPath?: string;
  readonly linuxOutputDirectory?: string;
  readonly manifestOutputPath?: string;
  readonly cachePath?: string;
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

  const rendered = await renderAppIcon(options.sourcePath, options.composed === true);
  const macosRendered =
    options.macosSourcePath === undefined || options.macosSourcePath === options.sourcePath
      ? rendered
      : await renderAppIcon(options.macosSourcePath, options.composed === true);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(icnsOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(icoOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(outputPath, rendered);
  await encodeNativeIcons(rendered, macosRendered, icnsOutputPath, icoOutputPath);
  await writeLinuxIcons(rendered, metadata.linuxPngOutputPaths);
  await writeManifest(metadata);
  await fs.writeFile(
    cachePath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
  return metadata;
}

/** Create the Vite plugin used by both serve and build modes. */
export function openTrayAppIconPlugin(
  options: OpenTrayAppIconPluginOptions
): Plugin {
  let generation: Promise<OpenTrayAppIconCacheMetadata> | undefined;

  return {
    name: "opentray/app-icon",
    enforce: "pre",
    async configResolved(config) {
      const outputPath =
        options.outputPath ??
        path.resolve(config.root, "static/icons/app-icon.png");
      const icnsOutputPath =
        options.icnsOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.icns");
      const icoOutputPath =
        options.icoOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.ico");
      const linuxOutputDirectory =
        options.linuxOutputDirectory ??
        path.resolve(config.root, "static/icons/linux");
      const manifestOutputPath =
        options.manifestOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.json");
      const cachePath =
        options.cachePath ?? path.resolve(config.root, ".cache/app-icon.json");
      generation ??= generateOpenTrayAppIcon({
        sourcePath: path.resolve(options.sourcePath),
        outputPath,
        icnsOutputPath,
        icoOutputPath,
        linuxOutputDirectory,
        manifestOutputPath,
        cachePath,
      });
      await generation;
    },
  };
}

async function createCacheMetadata(options: {
  sourcePath: string;
  implementationPath: string;
  implementationSourcePath?: string;
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
    sourceImplementationSha256:
      sourceImplementationPath === null
        ? null
        : await sha256(sourceImplementationPath),
    implementationSha256: await sha256(options.implementationPath),
    recipeVersion: RECIPE_VERSION,
    sharpVersion: await packageVersion("sharp"),
    iconEncoderVersion: await packageVersion("@shockpkg/icon-encoder"),
    figmaSquircleVersion: await packageVersion("figma-squircle"),
    outputPath: path.resolve(options.outputPath),
    icnsOutputPath,
    icoOutputPath,
    linuxPngOutputPaths,
    manifestOutputPath: path.resolve(options.manifestOutputPath),
    appIcon,
  };
}

async function renderAppIcon(sourcePath: string, composed = false): Promise<Buffer> {
  if (composed) {
    // Pre-composed art: normalize to the 1024 canvas and pass through —
    // the background and squircle mask are already baked in.
    return sharp(sourcePath, { failOn: "none" })
      .resize(ICON_SIZE, ICON_SIZE, { fit: "contain", kernel: sharp.kernel.lanczos3 })
      .withMetadata({ density: APP_ICON_DENSITY })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  const symbol = await sharp(sourcePath)
    .trim({ threshold: 0 })
    .resize(SYMBOL_SIZE, SYMBOL_SIZE, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const symbolLeft = Math.round((ICON_SIZE - symbol.info.width) / 2);
  const symbolTop = Math.round((ICON_SIZE - symbol.info.height) / 2);
  const squirclePath = getSvgPath({
    width: TILE_SIZE,
    height: TILE_SIZE,
    cornerRadius: TILE_RADIUS,
    cornerSmoothing: TILE_SMOOTHING,
    preserveSmoothing: true,
  });
  const whiteTile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}"><path d="${squirclePath}" fill="#fff"/></svg>`
  );
  return sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: whiteTile, top: TILE_INSET, left: TILE_INSET },
      { input: symbol.data, top: symbolTop, left: symbolLeft },
    ])
    .withMetadata({ density: APP_ICON_DENSITY })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function encodeNativeIcons(
  rendered: Buffer,
  macosRendered: Buffer,
  icnsOutputPath: string,
  icoOutputPath: string
): Promise<void> {
  const cacheFor = (source: Buffer): {
    pngAt(size: number): Promise<Buffer>;
  } => {
    const bySize = new Map<number, Buffer>();
    return {
      async pngAt(size: number): Promise<Buffer> {
        const cached = bySize.get(size);
        if (cached !== undefined) return cached;
        const png = await sharp(source)
          .resize(size, size, { fit: "contain" })
          .withMetadata({ density: APP_ICON_DENSITY })
          .png({ compressionLevel: 9 })
          .toBuffer();
        bySize.set(size, png);
        return png;
      },
    };
  };
  const windows = cacheFor(rendered);
  const macos = cacheFor(macosRendered);

  const icns = new IconIcns();
  icns.toc = true;
  for (const { tag, size } of ICNS_REPRESENTATIONS) {
    await icns.addFromPng(await macos.pngAt(size), [tag], false);
  }
  await fs.writeFile(icnsOutputPath, icns.encode());

  const ico = new IconIco();
  for (const size of ICO_SIZES) {
    await ico.addFromPng(await windows.pngAt(size), null, false);
  }
  await fs.writeFile(icoOutputPath, ico.encode());
}

async function writeLinuxIcons(
  rendered: Buffer,
  outputs: OpenTrayAppIconCacheMetadata["linuxPngOutputPaths"]
): Promise<void> {
  await Promise.all(
    outputs.map(async ({ size, path: outputPath }) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(rendered)
        .resize(size, size, { fit: "contain" })
        .withMetadata({ density: APP_ICON_DENSITY })
        .png({ compressionLevel: 9 })
        .toFile(outputPath);
    })
  );
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
    actual.sourceImplementationSha256 === expected.sourceImplementationSha256 &&
    actual.implementationSha256 === expected.implementationSha256 &&
    actual.recipeVersion === expected.recipeVersion &&
    actual.sharpVersion === expected.sharpVersion &&
    actual.iconEncoderVersion === expected.iconEncoderVersion &&
    actual.figmaSquircleVersion === expected.figmaSquircleVersion &&
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
    (record.sourceImplementationSha256 === null ||
      typeof record.sourceImplementationSha256 === "string") &&
    typeof record.implementationSha256 === "string" &&
    typeof record.recipeVersion === "string" &&
    typeof record.sharpVersion === "string" &&
    typeof record.iconEncoderVersion === "string" &&
    typeof record.figmaSquircleVersion === "string" &&
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
  if (implementationPath.endsWith(`${path.sep}src${path.sep}app-icon.ts`)) {
    return implementationPath;
  }
  const candidate = path.join(
    path.dirname(path.dirname(implementationPath)),
    "src",
    "app-icon.ts"
  );
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function packageVersion(packageName: string): Promise<string> {
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
