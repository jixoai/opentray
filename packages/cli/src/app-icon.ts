// Orthogonal intents (maintained 2026-07-20; original user request: appIcon
// must be a strict platform-standard asset array distinct from trayIcon):
// 1. Validate platform coverage and uniqueness before broker startup.
// 2. Prove declared native formats against source bytes.
// 3. Reject every tray-oriented, remote, text, template, and raw RGBA shape.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AppIcon,
  AppIconSource,
  AppIconVariant,
} from "@opentray/spec";

export type AppIconPlatform = "darwin" | "windows" | "linux";
export const DEFAULT_APP_ICON_VARIANT = "default" as const;
const APP_ICON_VARIANT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export class InvalidAppIconError extends Error {
  readonly code = "OPENTRAY_INVALID_APP_ICON";
  readonly reason: string;

  constructor(reason: string, platform: NodeJS.Platform = process.platform) {
    super(`invalid appIcon for ${platform}: ${reason}`);
    this.name = "InvalidAppIconError";
    this.reason = reason;
  }
}

export class AppIconVariantNotFoundError extends Error {
  readonly code = "OPENTRAY_APP_ICON_VARIANT_NOT_FOUND";
  readonly variant: string;

  constructor(variant: string, platform: NodeJS.Platform = process.platform) {
    super(`appIcon variant ${variant} is unavailable for ${platform}`);
    this.name = "AppIconVariantNotFoundError";
    this.variant = variant;
  }
}

/** Validate an explicit AppIcon, including native file signatures, before broker startup. */
export const validateAppIcon = async (
  icon: unknown,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  if (!Array.isArray(icon) || icon.length === 0) {
    throw new InvalidAppIconError(
      "the asset array must not be empty",
      platform
    );
  }

  const variantPlatforms = new Map<string, Set<AppIconPlatform>>();
  const seenDarwin = new Set<string>();
  const seenWindows = new Set<string>();
  const seenLinuxPngSizes = new Set<string>();
  const seenLinuxSvg = new Set<string>();
  for (const asset of icon) {
    if (!isRecord(asset)) {
      throw new InvalidAppIconError("asset must be an object", platform);
    }
    const assetPlatform = asset.platform;
    const format = asset.format;
    const variants = validateVariantNames(asset.variant, platform);
    if (assetPlatform === "darwin" && format === "icns") {
      assertExactKeys(
        asset,
        ["platform", "format", "source"],
        platform,
        ["variant"]
      );
      rejectDuplicateVariants(seenDarwin, variants, "darwin", platform);
      await validateSource(asset.source, "icns", platform);
      recordVariantPlatforms(variantPlatforms, variants, "darwin");
      continue;
    }
    if (assetPlatform === "windows" && format === "ico") {
      assertExactKeys(
        asset,
        ["platform", "format", "source"],
        platform,
        ["variant"]
      );
      rejectDuplicateVariants(seenWindows, variants, "windows", platform);
      await validateSource(asset.source, "ico", platform);
      recordVariantPlatforms(variantPlatforms, variants, "windows");
      continue;
    }
    if (assetPlatform === "linux" && format === "png") {
      assertExactKeys(
        asset,
        ["platform", "format", "size", "source"],
        platform,
        ["variant"]
      );
      if (
        !Number.isInteger(asset.size) ||
        typeof asset.size !== "number" ||
        asset.size <= 0
      ) {
        throw new InvalidAppIconError(
          "Linux PNG assets require a positive integer size",
          platform
        );
      }
      for (const variant of variants) {
        const key = `${variant}\0${asset.size}`;
        if (seenLinuxPngSizes.has(key)) {
          throw new InvalidAppIconError(
            `duplicate Linux PNG size ${asset.size} for variant ${variant}`,
            platform
          );
        }
        seenLinuxPngSizes.add(key);
      }
      await validateSource(asset.source, "png", platform);
      recordVariantPlatforms(variantPlatforms, variants, "linux");
      continue;
    }
    if (assetPlatform === "linux" && format === "svg") {
      assertExactKeys(
        asset,
        ["platform", "format", "source"],
        platform,
        ["variant"]
      );
      rejectDuplicateVariants(seenLinuxSvg, variants, "Linux SVG", platform);
      await validateSource(asset.source, "svg", platform);
      recordVariantPlatforms(variantPlatforms, variants, "linux");
      continue;
    }
    throw new InvalidAppIconError(
      `unsupported platform/format pair ${String(assetPlatform)}/${String(
        format
      )}`,
      platform
    );
  }

  const currentPlatform = normalizePlatform(platform);
  if (currentPlatform !== undefined) {
    if (!variantPlatforms.get(DEFAULT_APP_ICON_VARIANT)?.has(currentPlatform)) {
      throw new InvalidAppIconError(
        `no ${currentPlatform} ${DEFAULT_APP_ICON_VARIANT} asset was provided`,
        platform
      );
    }
    for (const [variant, platforms] of variantPlatforms) {
      if (!platforms.has(currentPlatform)) {
        throw new InvalidAppIconError(
          `variant ${variant} has no ${currentPlatform} asset`,
          platform
        );
      }
    }
  }
};

/** Normalize encoded sources into JSON array bytes for the Rust wire protocol. */
export const normalizeAppIcon = (icon: AppIcon): AppIcon =>
  icon.map((asset) => {
    const source = normalizeSource(asset.source);
    const variant = normalizeVariant(asset.variant);
    if (asset.platform === "darwin") return { ...asset, variant, source };
    if (asset.platform === "windows") return { ...asset, variant, source };
    if (asset.format === "png") return { ...asset, variant, source };
    return { ...asset, variant, source };
  });

/** Select one semantic variant while retaining every platform's matching native asset. */
export const selectAppIconVariant = (
  icon: AppIcon,
  variant: string,
  platform: NodeJS.Platform = process.platform
): AppIcon => {
  validateVariantName(variant, platform);
  const selected = icon.filter((asset) =>
    normalizedVariantNames(asset.variant).includes(variant)
  );
  const currentPlatform = normalizePlatform(platform);
  if (
    selected.length === 0 ||
    (currentPlatform !== undefined &&
      !selected.some((asset) => asset.platform === currentPlatform))
  ) {
    throw new AppIconVariantNotFoundError(variant, platform);
  }
  return selected;
};

const normalizeSource = (source: AppIconSource): AppIconSource =>
  source.type === "encoded"
    ? { type: "encoded", data: Array.from(source.data) }
    : { type: "file", path: resolve(source.path) };

const normalizeVariant = (
  variant: AppIconVariant | undefined
): AppIconVariant =>
  variant === undefined
    ? DEFAULT_APP_ICON_VARIANT
    : typeof variant === "string"
      ? variant
      : [...variant];

const normalizedVariantNames = (
  variant: AppIconVariant | undefined
): readonly string[] =>
  variant === undefined
    ? [DEFAULT_APP_ICON_VARIANT]
    : typeof variant === "string"
      ? [variant]
      : variant;

const validateVariantNames = (
  variant: unknown,
  platform: NodeJS.Platform
): readonly string[] => {
  const names =
    variant === undefined
      ? [DEFAULT_APP_ICON_VARIANT]
      : typeof variant === "string"
        ? [variant]
        : Array.isArray(variant)
          ? variant
          : [];
  if (names.length === 0) {
    throw new InvalidAppIconError(
      "variant must be a name or non-empty name array",
      platform
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    validateVariantName(name, platform);
    if (seen.has(name)) {
      throw new InvalidAppIconError(
        `duplicate variant name ${name} on one asset`,
        platform
      );
    }
    seen.add(name);
  }
  return names;
};

function validateVariantName(
  variant: unknown,
  platform: NodeJS.Platform
): asserts variant is string {
  if (typeof variant !== "string" || !APP_ICON_VARIANT_PATTERN.test(variant)) {
    throw new InvalidAppIconError(
      `variant must match ${APP_ICON_VARIANT_PATTERN}`,
      platform
    );
  }
}

const rejectDuplicateVariants = (
  seen: Set<string>,
  variants: readonly string[],
  label: string,
  hostPlatform: NodeJS.Platform
): void => {
  for (const variant of variants) {
    if (seen.has(variant)) {
      throw new InvalidAppIconError(
        `duplicate ${label} asset for variant ${variant}`,
        hostPlatform
      );
    }
    seen.add(variant);
  }
};

const recordVariantPlatforms = (
  variants: Map<string, Set<AppIconPlatform>>,
  names: readonly string[],
  platform: AppIconPlatform
): void => {
  for (const name of names) {
    const platforms = variants.get(name) ?? new Set<AppIconPlatform>();
    platforms.add(platform);
    variants.set(name, platforms);
  }
};

const validateSource = async (
  source: unknown,
  format: "icns" | "ico" | "png" | "svg",
  platform: NodeJS.Platform
): Promise<void> => {
  if (!isRecord(source)) {
    throw new InvalidAppIconError(
      "asset source must be a file or encoded payload",
      platform
    );
  }
  let bytes: Uint8Array;
  if (source.type === "file") {
    assertExactKeys(source, ["type", "path"], platform);
    if (typeof source.path !== "string" || source.path.trim().length === 0) {
      throw new InvalidAppIconError(
        "file source path must not be empty",
        platform
      );
    }
    try {
      bytes = await readFile(source.path);
    } catch (error) {
      throw new InvalidAppIconError(
        `unable to read ${source.path}: ${errorMessage(error)}`,
        platform
      );
    }
  } else if (source.type === "encoded") {
    assertExactKeys(source, ["type", "data"], platform);
    bytes = encodedBytes(source.data, platform);
  } else {
    throw new InvalidAppIconError("unsupported app icon source type", platform);
  }
  if (!matchesFormat(bytes, format)) {
    throw new InvalidAppIconError(
      `source bytes do not contain a valid ${format.toUpperCase()} asset`,
      platform
    );
  }
};

const encodedBytes = (data: unknown, platform: NodeJS.Platform): Uint8Array => {
  if (data instanceof Uint8Array && data.byteLength > 0) return data;
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  ) {
    return Uint8Array.from(data);
  }
  throw new InvalidAppIconError(
    "encoded source must contain one or more bytes in the range 0..255",
    platform
  );
};

const matchesFormat = (
  bytes: Uint8Array,
  format: "icns" | "ico" | "png" | "svg"
): boolean => {
  if (format === "icns") return hasPrefix(bytes, [0x69, 0x63, 0x6e, 0x73]);
  if (format === "ico") {
    return (
      bytes.length >= 6 && hasPrefix(bytes, [0, 0, 1, 0]) && bytes[4] !== 0
    );
  }
  if (format === "png") {
    return hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  const source = new TextDecoder()
    .decode(bytes.subarray(0, 4096))
    .replace(/^\uFEFF/, "");
  return /<(?:\?xml[^>]*>\s*)?(?:!--[\s\S]*?-->\s*)*svg(?:\s|>)/i.test(
    source.trimStart()
  );
};

const hasPrefix = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length &&
  prefix.every((byte, index) => bytes[index] === byte);

const assertExactKeys = (
  record: Record<string, unknown>,
  expected: readonly string[],
  platform: NodeJS.Platform,
  optional: readonly string[] = []
): void => {
  const actual = Object.keys(record);
  const allowed = new Set([...expected, ...optional]);
  const unexpected = actual.find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new InvalidAppIconError(
      `unexpected asset field ${unexpected}`,
      platform
    );
  }
  const missing = expected.find((key) => !(key in record));
  if (missing !== undefined) {
    throw new InvalidAppIconError(`missing asset field ${missing}`, platform);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizePlatform = (
  platform: NodeJS.Platform
): AppIconPlatform | undefined => {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return undefined;
};
