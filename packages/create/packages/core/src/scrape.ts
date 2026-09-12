// Orthogonal intents (maintained 2026-08-16; original user request: scrape the
// service favicon and title as default identity, switching services rescrapes;
// round-8 acceptance: collect EVERY icon candidate the page declares — SVG,
// apple-touch-icon, sized PNG sets, /favicon.ico — measure true clarity,
// dedupe near-identical images, and expose them as ranked clickable
// candidates):
// 1. Fetch the service root with proxy-free loopback semantics.
// 2. Download all declared candidates (capped), never skipping SVG.
// 3. Decode true pixel dimensions (WASM raster stack; ICO via directory/
//    PNG-payload/DIB extraction) and a perceptual hash; rank by clarity,
//    hide near-duplicates.
// 4. Keep scrape failures non-fatal with an empty result and a glyph fallback source.
// 5. URL-mode creation presets (add-create-url-apps D10): scrape an arbitrary
//    http(s) address once and adopt title + best favicon as DEFAULTS — a URL
//    app knows its address up front, unlike a command that must run first.

import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "node-html-parser";

import {
  buildGlyphIconSvg,
  containImage,
  decodeImage,
  decodeImageFile,
  emptyImageOf,
  encodeImagePng,
  resizeImage,
} from "@opentray/icon";

import { ensureLoopbackNoProxy, serviceUrl } from "./port-scan";

/** Tolerant HTML parsing (node-html-parser): unquoted attrs, case, malformation. */
const parseHtml = (html: string) => parse(html, { blockTextElements: { script: true, style: true } });

/** Variant tag: the original art, a solid-color silhouette derived from it,
 * or an AI subject-extraction derived by the wizard's browser client. */
export type IconVariant = "original" | "solid-black" | "solid-white" | "subject";

/** One scraped icon candidate, ranked and deduplicated. */
export interface ScrapedIcon {
  /** Index within the candidate list (stable for /api/icon-data/:port/:index). */
  readonly index: number;
  /** Absolute URL the bytes came from (variants inherit their source URL). */
  readonly url: string;
  /** Absolute temp file holding the icon bytes. */
  readonly path: string;
  /** True pixel clarity (largest dimension; SVG uses intrinsic or 512). */
  readonly width: number;
  readonly height: number;
  /** png | svg | jpeg | webp | gif | ico (ico payloads are extracted to png). */
  readonly format: string;
  /** Which art this entry carries (originals feed the app-icon picker; the
   *  advanced tray picker also shows solid variants). */
  readonly variant: IconVariant;
  /** Index of the original candidate a variant was derived from. */
  readonly variantOf?: number;
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
  const root = parseHtml(html);
  const title = root.querySelector("title")?.text;
  if (title === undefined) {
    return undefined;
  }
  // node-html-parser decodes entities fully (numeric + named).
  const trimmed = title.replace(/\s+/gu, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Extract `<link rel=... href=...>` favicon candidates from HTML head. */
export const extractFaviconCandidates = (html: string): readonly FaviconCandidate[] => {
  const root = parseHtml(html);
  const candidates: FaviconCandidate[] = [];
  for (const link of root.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").trim().toLowerCase();
    // A tolerant HTML parser handles unquoted attributes (REL=icon
    // HREF=/favicon.ico), uppercase tags, and malformed markup — a regex
    // over quoted-attribute forms silently dropped all of those.
    if (!rel.includes("icon") || rel.includes("mask")) {
      continue;
    }
    const href = (link.getAttribute("href") ?? "").trim();
    if (href.length === 0) {
      continue;
    }
    const sizes = link.getAttribute("sizes");
    candidates.push({
      href,
      rel,
      ...(sizes === undefined || sizes.length === 0 ? {} : { sizes }),
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
      return { ok: false, status: 0, body: "" };
    }
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
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
 * Scrape title and ALL icon candidates from an arbitrary http(s) URL.
 * Never throws: failures return `ok: false` with whatever partial identity
 * was found. (`scrapeService` is the loopback-port wrapper over this.)
 */
export const scrapeUrl = async (
  url: string,
  options: { fetch?: ScrapeFetch; tempDir?: string } = {},
): Promise<ScrapeResult> => {
  const fetchImpl = options.fetch ?? defaultFetch;
  const origin = url;
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
  // The root /favicon.ico fallback is resolved against the ORIGIN (not the
  // full address): a deep link like /app must still probe the site root.
  const orderedUrls = [
    ...candidates.map((candidate) => resolveFaviconUrl(candidate.href, origin)),
    resolveFaviconUrl("/favicon.ico", origin),
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
  collected.sort((a, b) => b.width * a.height === a.width * b.height ? 0 : b.width * b.height - a.width * a.height);
  const originals = collected.map((c, order) => ({ ...c, order }));

  // Solid tray-template silhouettes are NO LONGER derived here: the alpha
  // mask of an opaque white-pad favicon is a full square, which produced
  // useless solid tiles. They are now derived server-side from the
  // browser-extracted SUBJECT (see wizard addIconCandidate / D17).

  const icons: ScrapedIcon[] = originals.map<ScrapedIcon>((c) => ({
    index: c.order,
    url: c.url,
    path: c.path,
    width: c.width,
    height: c.height,
    format: c.format,
    variant: "original",
  }));

  return {
    ok: true,
    title,
    iconPath: originals[0]?.path,
    ...(originals[0] === undefined ? {} : { iconUrl: originals[0].url }),
    icons,
  };
}

/**
 * Scrape title and ALL icon candidates from a service port. Never throws:
 * failures return `ok: false` with whatever partial identity was found.
 */
export const scrapeService = (
  port: number,
  options: { fetch?: ScrapeFetch; tempDir?: string } = {},
): Promise<ScrapeResult> => scrapeUrl(serviceUrl(port), options);

// URL-mode creation presets (add-create-url-apps D10, 2026-09-09; owner
// acceptance round): unlike a command app — which must RUN before anything
// can be scraped — a URL app knows its address up front, so creation may
// adopt the page title and best favicon as DEFAULTS. The favicon flows as
// the scrape pipeline's already-normalized temp file (ICO frames cracked,
// SVG densified), feeding the same importResource snapshot path the wizard
// uses. Every failure path degrades to {} — enrichment never blocks or
// fails creation.
// add-webview-orchestration D14 (2026-09-11): the embedding-policy probe is
// RETIRED — the multi-webview toolbar carrier loads the target as a
// top-level browsing context, so embedding policy is constructively
// irrelevant and no feasibility signal is derived or transported.
export interface UrlPresets {
  /** Page `<title>` (whitespace-normalized, length-capped) or undefined. */
  readonly appName?: string;
  /** Normalized temp-file icon source for the app icon, or undefined. */
  readonly appIconPath?: string;
}

/** Upper bound for an adopted page title (display names stay sane). */
const PRESET_TITLE_MAX = 80;

export const deriveUrlPresets = async (
  url: string,
  options: { fetch?: ScrapeFetch; tempDir?: string } = {},
): Promise<UrlPresets> => {
  const scraped = await scrapeUrl(url, options);
  if (!scraped.ok) {
    return {};
  }
  const title = scraped.title?.trim();
  const appName =
    title !== undefined && title.length > 0
      ? (title.length > PRESET_TITLE_MAX ? `${title.slice(0, PRESET_TITLE_MAX - 1).trimEnd()}…` : title)
      : undefined;
  return {
    ...(appName === undefined ? {} : { appName }),
    ...(scraped.iconPath === undefined ? {} : { appIconPath: scraped.iconPath }),
  };
};

/** Tray-template silhouette render size (tray projections are ≤ 64pt). */
export const SOLID_SIZE = 128;

/**
 * Render a solid-color silhouette from an icon's alpha mask (RGB discarded,
 * alpha kept) — the shape language macOS tray templates want. Called on the
 * browser-extracted SUBJECT (its alpha mask IS the subject shape); returns
 * undefined for non-decodable sources instead of failing the caller.
 */
export const renderSolidSilhouette = async (
  sourcePath: string,
  color: { r: number; g: number; b: number },
): Promise<Buffer | undefined> => {
  try {
    const image = await containImage(
      await decodeImageFile(sourcePath),
      SOLID_SIZE,
      SOLID_SIZE,
    );
    // RGB discarded (repainted in the solid color), alpha kept: the shape
    // language macOS tray templates want.
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = color.r;
      image.data[i + 1] = color.g;
      image.data[i + 2] = color.b;
    }
    return Buffer.from(await encodeImagePng(image));
  } catch {
    return undefined;
  }
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
 * verbatim, BMP DIB rows converted to PNG) because the raster stack cannot
 * read ICO containers.
 */
const prepareIconBytes = async (
  bytes: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; format: string } | undefined> => {
  if (looksLikeSvg(bytes, contentType)) {
    return { bytes: await densifySvg(bytes), format: "svg" };
  }
  // ICO first: its magic overlaps the generic raster check, but the raster
  // stack cannot read ICO — crack the container to its largest frame.
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

/**
 * Rewrite an SVG so it rasterizes at high resolution. The rasterizer renders
 * at the declared width/height, ignoring density attributes. Scraped
 * favicons declare small intrinsic sizes (often just 16–50px), so the
 * rasterized base bitmap is tiny and every later upscale (icon catalog,
 * tray, candidates) is blurry. Rewriting the root <svg> width/height to a
 * large target — viewBox untouched, so vector geometry scales cleanly —
 * gives every downstream consumer a crisp base.
 */
export const SVG_RASTER_TARGET = 1024;

const densifySvg = async (bytes: Buffer): Promise<Buffer> => {
  const text = bytes.toString("utf8");
  const svgOpen = text.indexOf("<svg");
  if (svgOpen === -1) {
    return bytes;
  }
  const tagEnd = text.indexOf(">", svgOpen);
  if (tagEnd === -1) {
    return bytes;
  }
  const openTag = text.slice(svgOpen, tagEnd + 1);
  let next = openTag;
  if (/\swidth=/u.test(next)) {
    next = next.replace(/\swidth="[^"]*"/u, ` width="${SVG_RASTER_TARGET}"`);
  } else {
    next = next.replace("<svg", `<svg width="${SVG_RASTER_TARGET}"`);
  }
  if (/\sheight=/u.test(next)) {
    next = next.replace(/\sheight="[^"]*"/u, ` height="${SVG_RASTER_TARGET}"`);
  } else {
    next = next.replace("<svg", `<svg height="${SVG_RASTER_TARGET}"`);
  }
  if (next === openTag) {
    return bytes;
  }
  return Buffer.from(text.slice(0, svgOpen) + next + text.slice(tagEnd + 1), "utf8");
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
  // BM magic: accepted by the signature gate (line ~408) but previously
  // missing here — BMP candidates were recognized then silently dropped.
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return undefined;
};

const isIcoContainer = (bytes: Buffer): boolean =>
  bytes.length >= 8 &&
  bytes[0] === 0x00 && bytes[1] === 0x00 &&
  bytes[2] === 0x01 && bytes[3] === 0x00;

/**
 * Crack an ICO open with decode-ico (palette/row-alignment/AND-mask/
 * BITFIELDS coverage the hand-rolled DIB reader lacked): pick the largest
 * frame by area; PNG frames pass through verbatim, BMP frames re-encode
 * from the decoder's RGBA through the shared kernel encoder.
 */
const extractLargestIcoFrame = async (ico: Buffer): Promise<Buffer | undefined> => {
  const decodeIco = (await import("decode-ico")).default;
  const { toPngBuffer } = await import("./icon-codec");
  let best:
    | { width: number; height: number; data: Uint8Array; png: boolean }
    | undefined;
  for (const frame of decodeIco(ico)) {
    const width = frame.width;
    const height = frame.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      continue;
    }
    if (best === undefined || width * height > best.width * best.height) {
      const isPng = frame.type === "png";
      const data: Uint8Array = frame.type === "png" ? frame.data : new Uint8Array(frame.data);
      best = { width, height, data, png: isPng };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  if (best.png) {
    return Buffer.from(best.data);
  }
  return toPngBuffer(Buffer.from(best.data), best.width, best.height, 4);
};

/**
 * True pixel dimensions; SVG uses intrinsic attrs, else viewBox, else 512.
 * Rasters decode through the kernel (the sharp metadata()-style header probe
 * is gone): favicon candidates are small, and only URL-mode scrapes can meet
 * larger photos — bounded by the scrape's own fetch limits.
 */
const iconDimensions = async (
  bytes: Buffer,
  format: string,
): Promise<{ width: number; height: number } | undefined> => {
  if (format === "svg") {
    return svgDimensions(bytes) ?? { width: 512, height: 512 };
  }
  try {
    const image = await decodeImage(new Uint8Array(bytes));
    if (image.width > 0 && image.height > 0) {
      return { width: image.width, height: image.height };
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
    // Flatten over white at FULL resolution BEFORE the downscale: the WASM
    // resize premultiplies alpha, and hashing the premultiplied thumb lets a
    // solid-white silhouette's letterbox ringing mimic a solid-black shape —
    // the two color variants would collide and dedupe each other away.
    const decoded = await decodeImage(new Uint8Array(bytes));
    const flattened = emptyImageOf(decoded.width, decoded.height);
    for (let i = 0; i < decoded.data.length; i += 4) {
      const alpha = (decoded.data[i + 3] ?? 0) / 255;
      flattened.data[i] = Math.round((decoded.data[i] ?? 0) * alpha + 255 * (1 - alpha));
      flattened.data[i + 1] = Math.round(
        (decoded.data[i + 1] ?? 0) * alpha + 255 * (1 - alpha),
      );
      flattened.data[i + 2] = Math.round(
        (decoded.data[i + 2] ?? 0) * alpha + 255 * (1 - alpha),
      );
      flattened.data[i + 3] = 255;
    }
    const image = await resizeImage(flattened, 8, 8, "lanczos3");
    if (image.data.length < 64 * 4) {
      return undefined;
    }
    // Luma follows BT.601, like the former sharp grayscale chain.
    const luma: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      const o = i * 4;
      luma.push(
        0.299 * (image.data[o] ?? 0) +
          0.587 * (image.data[o + 1] ?? 0) +
          0.114 * (image.data[o + 2] ?? 0),
      );
    }
    const mean = luma.reduce((sum, value) => sum + value, 0) / 64;
    let hash = "";
    for (const value of luma) {
      hash += value >= mean ? "1" : "0";
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
 * Persist the glyph fallback SVG (the shared kernel's first-letter tile) as
 * a temp icon source.
 */
export const writeGlyphIconTemp = async (
  appName: string,
  tempDir: string,
): Promise<string> => {
  const path = join(tempDir, "glyph.svg");
  await writeFile(path, buildGlyphIconSvg(appName), "utf8");
  return path;
};
