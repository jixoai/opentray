/**
 * Glyph font ladder (plan D5; spike-verified): the WASM rasterizer cannot
 * autoload system fonts, and `loadSystemFonts: true` silently drops text, so
 * every render must pass explicit `fontBuffers`:
 *
 *   1. the embedded OFL subset (deterministic Latin rendering everywhere), then
 *   2. a bounded, ranked scan of well-known OS font directories (CJK and other
 *      scripts beyond the embedded subset).
 *
 * Rendering quality is verified empirically downstream (text-presence pixel
 * check in default-icon.ts) — the ladder never silently accepts a blank tile.
 */
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { assetsDirectory } from "./assets";

/** Family name referenced by generated glyph SVG text elements. */
export const GLYPH_FONT_FAMILY = "OpenTray Glyph";

/**
 * Preferred font basenames, highest priority first. CJK-capable fonts lead:
 * the embedded subset already covers Latin, so discovery exists for wider
 * scripts. UI fonts follow so headless Linux still finds a fallback.
 */
const PREFERRED_PATTERNS: readonly RegExp[] = [
  /pingfang|stheiti|hiragino|songti|heiti|kaiti|yuanti/i,
  /sourcehan|source-han|noto.{0,12}(cjk|sc|tc|jp|kr)|wqy|droidsansfallback/i,
  /msyh|msjh|simsun|simhei|simkai|simfang|deng/i,
  /segoeui|arial|helvetica|liberationsans|dejavusans|roboto-regular|ubuntu-regular/i,
];

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);
/** Discovery caps: glyph generation reads fonts once per cache miss. */
const MAX_FONT_FILES = 10;
const MAX_TOTAL_BYTES = 192 * 1024 * 1024;

const systemFontDirectories = (): readonly string[] => {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return [
        "/System/Library/Fonts",
        "/System/Library/Fonts/Supplemental",
        "/Library/Fonts",
        join(home, "Library", "Fonts"),
      ];
    case "win32":
      return [
        join(process.env.SystemRoot ?? "C:\\Windows", "Fonts"),
        join(
          process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
          "Microsoft",
          "Windows",
          "Fonts",
        ),
      ];
    default:
      return [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        join(home, ".local", "share", "fonts"),
        join(home, ".fonts"),
      ];
  }
};

const listFontFiles = async (
  directory: string,
  depth = 2,
): Promise<readonly string[]> => {
  const found: string[] = [];
  let entries: readonly Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory() && depth > 0) {
      found.push(...(await listFontFiles(entryPath, depth - 1)));
    } else if (entry.isFile() && FONT_EXTENSIONS.has(extOf(entry.name))) {
      found.push(entryPath);
    }
  }
  return found;
};

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

const priorityOf = (path: string): number => {
  for (let index = 0; index < PREFERRED_PATTERNS.length; index += 1) {
    if (PREFERRED_PATTERNS[index]!.test(path)) return index;
  }
  return PREFERRED_PATTERNS.length;
};

const cache = new Map<string, Uint8Array>();

/** Embedded OFL subset bytes (Inter SemiBold, latin; see assets/*.OFL.txt). */
export const embeddedGlyphFont = async (): Promise<Uint8Array> => {
  const path = join(assetsDirectory(), "inter-glyph.ttf");
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const bytes = new Uint8Array(await readFile(path));
  cache.set(path, bytes);
  return bytes;
};

let ladderPromise: Promise<readonly Uint8Array[]> | undefined;
let ladderFingerprintPromise: Promise<string> | undefined;

/**
 * Stable identity of the discovered ladder (path + byte length pairs): OS
 * font changes invalidate generated-icon caches without hashing font bytes.
 */
export const glyphLadderFingerprint = (): Promise<string> => {
  ladderFingerprintPromise ??= (async () => {
    const parts: string[] = [];
    for (const buffer of await glyphFontLadder()) {
      parts.push(`${buffer.byteLength}`);
    }
    return parts.join(",");
  })();
  return ladderFingerprintPromise;
};

/**
 * The full font ladder for resvg `fontBuffers`: embedded subset first, then a
 * bounded ranked selection from the OS. Deterministic order, memoized.
 */
export const glyphFontLadder = (): Promise<readonly Uint8Array[]> => {
  ladderPromise ??= (async () => {
    const embedded = await embeddedGlyphFont();
    const candidates: { path: string; priority: number }[] = [];
    for (const directory of systemFontDirectories()) {
      for (const path of await listFontFiles(directory)) {
        candidates.push({ path, priority: priorityOf(path) });
      }
    }
    candidates.sort(
      (a, b) => a.priority - b.priority || (a.path < b.path ? -1 : 1),
    );
    const buffers: Uint8Array[] = [embedded];
    let total = embedded.byteLength;
    for (const { path } of candidates) {
      if (buffers.length >= MAX_FONT_FILES || total >= MAX_TOTAL_BYTES) break;
      const cached = cache.get(path);
      if (cached !== undefined) {
        buffers.push(cached);
        total += cached.byteLength;
        continue;
      }
      try {
        const bytes = new Uint8Array(await readFile(path));
        cache.set(path, bytes);
        buffers.push(bytes);
        total += bytes.byteLength;
      } catch {
        // Unreadable font files are skipped; the ladder degrades gracefully.
      }
    }
    return buffers;
  })();
  return ladderPromise;
};

/** Test hook: forget memoized font state. */
export const resetGlyphFontCache = (): void => {
  cache.clear();
  ladderPromise = undefined;
};
