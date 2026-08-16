// Orthogonal intents (maintained 2026-08-16; original user request: scrape the
// service favicon and title as default identity, switching services rescrapes;
// round-8 acceptance: collect EVERY icon candidate the page declares — SVG,
// apple-touch-icon, sized PNG sets, /favicon.ico — measure true clarity,
// dedupe near-identical images, and expose them as ranked clickable
// candidates):
// 1. Fetch the service root with proxy-free loopback semantics.
// 2. Download all declared candidates (capped), never skipping SVG.
// 3. Decode true pixel dimensions (sharp; ICO via directory/PNG-payload/DIB
//    extraction) and a perceptual hash; rank by clarity, hide near-duplicates.
// 4. Keep scrape failures non-fatal with an empty result and a glyph fallback source.

import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureLoopbackNoProxy, serviceUrl } from "./port-scan";

/** One scraped icon candidate, ranked and deduplicated. */
export interface ScrapedIcon {
  /** Index within the candidate list (stable for /api/icon-data/:port/:index). */
  readonly index: number;
  /** Absolute URL the bytes came from. */
  readonly url: string;
  /** Absolute temp file holding the icon bytes. */
  readonly path: string;
  /** True pixel clarity (largest dimension; SVG uses intrinsic or 512). */
  readonly width: number;
  readonly height: number;
  /** png | svg | jpeg | webp | gif | ico (ico payloads are extracted to png). */
  readonly format: string;
}

export interface ScrapeResult {
  readonly ok: boolean;
  readonly title: string | undefined;
  /** Absolute temp file holding the chosen (clearest) favicon bytes, when found. */
  readonly iconPath: string | undefined;
  readonly iconUrl?: string;
  /** All viable candidates ranked by clarity, near-duplicates removed. */
  readonly icons: readonly ScrapedIcon[];
}

export interface FaviconCandidate {
  readonly href: string;
  readonly rel: string;
  readonly sizes?: string;
}

/** Extract `<title>` text from HTML. */
export const extractTitle = (html: string): string | undefined => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const decoded = match[1]
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
  const trimmed = decoded.replace(/\s+/gu, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Extract `<link rel=... href=...>` favicon candidates from HTML head. */
export const extractFaviconCandidates = (html: string): readonly FaviconCandidate[] => {
  const candidates: FaviconCandidate[] = [];
  const pattern = /<link\b[^>]*>/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const rel = /rel\s*=\s*("([^"]*)"|'([^']*)')/iu.exec(tag);
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/iu.exec(tag);
    if (rel === null || href === null) {
      continue;
    }
    const relValue = (rel[2] ?? rel[3] ?? "").trim().toLowerCase();
    if (!relValue.includes("icon") || relValue.includes("mask")) {
      continue;
    }
    const hrefValue = (href[2] ?? href[3] ?? "").trim();
    if (hrefValue.length === 0) {
      continue;
    }
    const sizesMatch = /sizes\s*=\s*("([^"]*)"|'([^']*)')/iu.exec(tag);
    const sizesValue = sizesMatch?.[2] ?? sizesMatch?.[3];
    candidates.push({
      href: hrefValue,
      rel: relValue,
      ...(sizesValue === undefined ? {} : { sizes: sizesValue }),
    });
  }
  return candidates;
};

/** Largest dimension of a `sizes` attribute value such as `32x32` or `any`. */
export const faviconCandidateSize = (candidate: FaviconCandidate): number => {
  if (candidate.sizes === undefined) {
    return 0;
  }
  const match = /(\d+)\s*x\s*(\d+)/iu.exec(candidate.sizes);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return 0;
  }
  return Math.max(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
};

/** Resolve a favicon href against the service origin. */
export const resolveFaviconUrl = (href: string, origin: string): string | undefined => {
  try {
    return new URL(href, origin).href;
  } catch {
    return undefined;
  }
};

/** Order candidates: declared-size icons descending, then apple-touch-icon, then others. */
export const rankFaviconCandidates = (
  candidates: readonly FaviconCandidate[],
): readonly FaviconCandidate[] => {
  const score = (candidate: FaviconCandidate): number => {
    const declared = faviconCandidateSize(candidate);
    if (declared > 0) {
      return declared;
    }
    if (candidate.rel.includes("apple-touch-icon")) {
      return 128;
    }
    return 1;
  };
  return [...candidates].sort((a, b) => score(b) - score(a));
};

export interface ScrapePage {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface ScrapeBytes {
  readonly ok: boolean;
  readonly status: number;
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface ScrapeFetch {
  page(url: string, timeoutMs?: number): Promise<ScrapePage>;
  bytes(url: string, timeoutMs?: number): Promise<ScrapeBytes>;
}

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<Response | undefined> => {
  ensureLoopbackNoProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept },
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

const defaultFetch: ScrapeFetch = {
  async page(url, timeoutMs = 5_000) {
    const response = await fetchWithTimeout(
      url,
      timeoutMs,
      "text/html,application/xhtml+xml",
    );
    if (response === undefined) {
      return { ok: false, status: 0, body: "", headers: {} };
    }
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { ok: response.ok, status: response.status, body, headers };
  },
  async bytes(url, timeoutMs = 5_000) {
    const response = await fetchWithTimeout(url, timeoutMs, "image/*,*/*;q=0.8");
    if (response === undefined) {
      return { ok: false, status: 0, bytes: Buffer.alloc(0), contentType: "" };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      bytes: buffer,
      contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
    };
  },
};

/** Cap on downloaded candidates per scrape. */
const MAX_ICON_DOWNLOADS = 8;

/**
 * Scrape title and ALL icon candidates from a service port. Never throws:
 * failures return `ok: false` with whatever partial identity was found.
 */
export const scrapeService = async (
  port: number,
  options: { fetch?: ScrapeFetch; tempDir?: string } = {},
): Promise<ScrapeResult> => {
  const fetchImpl = options.fetch ?? defaultFetch;
  const origin = serviceUrl(port);
  const page = await fetchImpl.page(origin);
  if (!page.ok) {
    return {
      ok: false,
      title: undefined,
      iconPath: undefined,
      icons: [],
    };
  }

  const title = extractTitle(page.body);
  const candidates = rankFaviconCandidates(extractFaviconCandidates(page.body));
  const orderedUrls = [
    ...candidates.map((candidate) => resolveFaviconUrl(candidate.href, origin)),
    `${origin}/favicon.ico`,
  ]
    .filter((url): url is string => url !== undefined)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, MAX_ICON_DOWNLOADS);

  const dir = await ensureTempIconDir(options.tempDir);
  const collected: { url: string; path: string; width: number; height: number; format: string; hash: string | undefined }[] = [];
  for (const url of orderedUrls) {
    if (collected.length >= MAX_ICON_DOWNLOADS) {
      break;
    }
    const icon = await fetchImpl.bytes(url);
    if (!icon.ok || icon.bytes.length < 64) {
      continue;
    }
    const prepared = await prepareIconBytes(icon.bytes, icon.contentType);
    if (prepared === undefined) {
      // HTML fallback routes, corrupt images, undecodable payloads: skip.
      continue;
    }
    const { bytes, format } = prepared;
    const meta = await iconDimensions(bytes, format);
    if (meta === undefined) {
      continue;
    }
    const hash = await iconPerceptualHash(bytes);
    // Near-duplicate clarity: same image at another size is redundant.
    if (hash !== undefined && collected.some((c) => c.hash !== undefined && hamming(hash, c.hash) <= 8)) {
      continue;
    }
    const path = await writeIconTemp(bytes, dir);
    collected.push({ url, path, ...meta, format, hash });
  }

  // Rank by true clarity: pixel area descending (SVG scales infinitely, so
  // intrinsic (or default 512) dimensions rank it with the clearest sources).
  collected.sort((a, b) => b.width * b.height - a.width * a.height);
  const icons: ScrapedIcon[] = collected.map((c, index) => ({
    index,
    url: c.url,
    path: c.path,
    width: c.width,
    height: c.height,
    format: c.format,
  }));

  return {
    ok: true,
    title,
    iconPath: icons[0]?.path,
    ...(icons[0] === undefined ? {} : { iconUrl: icons[0].url }),
    icons,
  };
};

/** Recognizable raster image signatures (PNG/JPEG/GIF/ICO/BMP/WebP). */
const hasRasterImageSignature = (bytes: Buffer): boolean => {
  if (bytes.length < 16) {
    return false;
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return true; // PNG with a well-formed leading IHDR chunk
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true; // JPEG
  }
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return true; // WebP
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return true; // ICO
  }
  if (bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")) {
    return true; // GIF
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return true; // BMP
  }
  return false;
};


const ensureTempIconDir = async (tempDir?: string): Promise<string | undefined> => {
  if (tempDir !== undefined) {
    return tempDir;
  }
  return mkdtemp(join(tmpdir(), "create-opentray-icon-"));
};

/**
 * Validate and normalize candidate bytes. Returns decodable image bytes plus a
 * format tag: raster signatures pass through, SVG text passes through, and ICO
 * containers are cracked open to their largest frame (PNG payload extracted
 * verbatim, BMP DIB rows converted to PNG) because sharp cannot read ICO.
 */
const prepareIconBytes = async (
  bytes: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; format: string } | undefined> => {
  if (looksLikeSvg(bytes, contentType)) {
    return { bytes, format: "svg" };
  }
  // ICO first: its magic overlaps the generic raster check, but sharp cannot
  // read ICO — crack the container to its largest frame.
  if (isIcoContainer(bytes)) {
    const extracted = await extractLargestIcoFrame(bytes);
    if (extracted !== undefined) {
      return { bytes: extracted, format: "png" };
    }
    return undefined;
  }
  if (hasRasterImageSignature(bytes)) {
    const format = rasterFormatOf(bytes);
    return format === undefined ? undefined : { bytes, format };
  }
  return undefined;
};

const looksLikeSvg = (bytes: Buffer, contentType: string): boolean => {
  if (contentType.includes("image/svg")) {
    return true;
  }
  const head = bytes.subarray(0, 512).toString("utf8").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<svg") || head.includes("<svg");
};

const rasterFormatOf = (bytes: Buffer): string | undefined => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") return "webp";
  return undefined;
};

const isIcoContainer = (bytes: Buffer): boolean =>
  bytes.length >= 8 &&
  bytes[0] === 0x00 && bytes[1] === 0x00 &&
  bytes[2] === 0x01 && bytes[3] === 0x00;

/** Crack an ICO open: pick the largest frame; PNG payloads return verbatim, DIB rows become PNG. */
const extractLargestIcoFrame = async (ico: Buffer): Promise<Buffer | undefined> => {
  const count = ico.readUInt16LE(4);
  if (count === 0 || count > 64) {
    return undefined;
  }
  let best: { offset: number; size: number; width: number; height: number } | undefined;
  for (let i = 0; i < count; i += 1) {
    const base = 6 + i * 16;
    if (base + 16 > ico.length) {
      break;
    }
    const rawWidth = ico[base] ?? 0;
    const rawHeight = ico[base + 1] ?? 0;
    const width = rawWidth === 0 ? 256 : rawWidth;
    const height = rawHeight === 0 ? 256 : rawHeight;
    const size = ico.readUInt32LE(base + 8);
    const offset = ico.readUInt32LE(base + 12);
    if (offset + size > ico.length) {
      continue;
    }
    if (best === undefined || width * height > best.width * best.height) {
      best = { offset, size, width, height };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  const frame = ico.subarray(best.offset, best.offset + best.size);
  const b0 = frame[0];
  const b1 = frame[1];
  if (b0 === 0x89 && b1 === 0x50) {
    return frame; // PNG-compressed entry (modern 256px icons)
  }
  return dibToPng(frame, best.width, best.height);
};

/** Convert a bottom-up BGRA/BGR DIB (BITMAPINFOHEADER) frame to PNG bytes. */
const dibToPng = async (dib: Buffer, width: number, height: number): Promise<Buffer | undefined> => {
  if (dib.length < 40) {
    return undefined;
  }
  const declaredHeight = dib.readInt32LE(8);
  const bitCount = dib.readUInt16LE(14);
  const pixels = dib.subarray(40);
  const rowBytes = Math.ceil((width * bitCount) / 8);
  const rows = Math.abs(declaredHeight) / 2;
  if (rows === 0 || pixels.length < rowBytes * rows) {
    return undefined;
  }
  const channels = bitCount === 32 ? 4 : 3;
  const rgba = Buffer.alloc(width * rows * channels);
  for (let y = 0; y < rows; y += 1) {
    const src = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    const flipped = rows - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const srcIdx = x * channels;
      const dstIdx = (flipped * width + x) * channels;
      const b = src[srcIdx];
      const g = src[srcIdx + 1];
      const r = src[srcIdx + 2];
      if (b === undefined || g === undefined || r === undefined) {
        continue;
      }
      rgba[dstIdx] = r;
      rgba[dstIdx + 1] = g;
      rgba[dstIdx + 2] = b;
      if (channels === 4) {
        rgba[dstIdx + 3] = src[srcIdx + 3] ?? 255;
      }
    }
  }
  const { toPngBuffer } = await import("./icon-codec.js");
  return toPngBuffer(rgba, width, rows, channels);
};

/** True pixel dimensions; SVG uses intrinsic attrs, else viewBox, else 512. */
const iconDimensions = async (
  bytes: Buffer,
  format: string,
): Promise<{ width: number; height: number } | undefined> => {
  if (format === "svg") {
    return svgDimensions(bytes) ?? { width: 512, height: 512 };
  }
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    if (meta.width !== undefined && meta.height !== undefined && meta.width > 0) {
      return { width: meta.width, height: meta.height };
    }
  } catch {
    // fall through to raster header parsing
  }
  if (format === "png" && bytes.length >= 24) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width > 0) return { width, height };
  }
  return undefined;
};

const svgDimensions = (bytes: Buffer): { width: number; height: number } | undefined => {
  const head = bytes.subarray(0, 2048).toString("utf8");
  const num = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const width = num(/<svg[^>]*\bwidth\s*=\s*["']([\d.]+)/iu.exec(head)?.[1]);
  const height = num(/<svg[^>]*\bheight\s*=\s*["']([\d.]+)/iu.exec(head)?.[1]);
  if (width !== undefined && height !== undefined) {
    return { width, height };
  }
  const viewBox = /viewBox\s*=\s*["']\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/iu.exec(head);
  const vbWidthRaw = viewBox?.[3];
  const vbHeightRaw = viewBox?.[4];
  if (vbWidthRaw !== undefined && vbHeightRaw !== undefined) {
    const vbWidth = Number.parseFloat(vbWidthRaw);
    const vbHeight = Number.parseFloat(vbHeightRaw);
    if (Number.isFinite(vbWidth) && vbWidth > 0) {
      return { width: vbWidth, height: Number.isFinite(vbHeight) ? vbHeight : vbWidth };
    }
  }
  return undefined;
};

/** 64-bit average hash over an 8x8 grayscale normalization (perceptual dedupe). */
const iconPerceptualHash = async (bytes: Buffer): Promise<string | undefined> => {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const { data } = await sharp(bytes, { failOn: "none" })
      .removeAlpha()
      .flatten({ background: "#ffffff" })
      .resize(8, 8, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (data.length < 64) {
      return undefined;
    }
    let sum = 0;
    for (const value of data.subarray(0, 64)) {
      sum += value;
    }
    const mean = sum / 64;
    let hash = "";
    for (let i = 0; i < 64; i += 1) {
      const value = data[i];
      hash += value === undefined ? "0" : value >= mean ? "1" : "0";
    }
    return hash;
  } catch {
    return undefined;
  }
};

const hamming = (a: string, b: string): number => {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      distance += 1;
    }
  }
  return distance;
};

const writeIconTemp = async (bytes: Buffer, dir?: string): Promise<string> => {
  const targetDir = dir ?? (await mkdtemp(join(tmpdir(), "create-opentray-icon-")));
  // Unique per bytes: multiple candidates of one scrape live side by side.
  const name = `icon-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bin`;
  const path = join(targetDir, name);
  await writeFile(path, bytes);
  return path;
};

/**
 * First-letter glyph fallback source: a self-contained SVG that the icon
 * generator can rasterize when no favicon was usable.
 */
export const createGlyphIconSvg = (appName: string, accent = "#0A84FF"): string => {
  const letter = (appName.trim().charAt(0) || "A").toUpperCase();
  const escaped = letter.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`,
    `<rect width="512" height="512" rx="96" fill="${accent}"/>`,
    `<text x="256" y="256" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="280" font-weight="600" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${escaped}</text>`,
    `</svg>`,
  ].join("");
};

/** Persist the glyph fallback SVG as a temp icon source. */
export const writeGlyphIconTemp = async (
  appName: string,
  tempDir: string,
): Promise<string> => {
  const path = join(tempDir, "glyph.svg");
  await writeFile(path, createGlyphIconSvg(appName), "utf8");
  return path;
};
