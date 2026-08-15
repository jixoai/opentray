// Orthogonal intents (maintained 2026-07-22; original user request: scrape the
// service favicon and title as default identity, switching services rescrapes):
// 1. Fetch the service root with proxy-free loopback semantics.
// 2. Rank favicon candidates by declared sizes, then apple-touch-icon, then /favicon.ico.
// 3. Keep scrape failures non-fatal with an empty result and a glyph fallback source.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureLoopbackNoProxy, serviceUrl } from "./port-scan";

export interface ScrapeResult {
  readonly ok: boolean;
  readonly title: string | undefined;
  /** Absolute temp file holding the chosen favicon bytes, when found. */
  readonly iconPath: string | undefined;
  readonly iconUrl: string | undefined;
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

/**
 * Scrape title and favicon from a service port. Never throws: failures return
 * `ok: false` with whatever partial identity was found.
 */
export const scrapeService = async (
  port: number,
  options: { fetch?: ScrapeFetch; tempDir?: string } = {},
): Promise<ScrapeResult> => {
  const fetchImpl = options.fetch ?? defaultFetch;
  const origin = serviceUrl(port);
  const page = await fetchImpl.page(origin);
  if (!page.ok) {
    return { ok: false, title: undefined, iconPath: undefined, iconUrl: undefined };
  }

  const title = extractTitle(page.body);
  const candidates = rankFaviconCandidates(extractFaviconCandidates(page.body));
  const orderedUrls = [
    ...candidates.map((candidate) => resolveFaviconUrl(candidate.href, origin)),
    `${origin}/favicon.ico`,
  ].filter((url): url is string => url !== undefined);

  for (const url of orderedUrls) {
    const icon = await fetchImpl.bytes(url);
    if (!icon.ok || icon.bytes.length < 64) {
      continue;
    }
    // HTML means an SPA fallback route, not an icon. SVG favicons are skipped
    // in favor of raster candidates (PNG decodes deterministically in sharp).
    if (icon.contentType.includes("text/html") || icon.contentType.includes("image/svg")) {
      continue;
    }
    const iconPath = await writeIconTemp(icon.bytes, options.tempDir);
    return { ok: true, title, iconPath, iconUrl: url };
  }

  return { ok: true, title, iconPath: undefined, iconUrl: undefined };
};

const writeIconTemp = async (bytes: Buffer, tempDir?: string): Promise<string> => {
  const dir = tempDir ?? (await mkdtemp(join(tmpdir(), "create-opentray-icon-")));
  const path = join(dir, "favicon.bin");
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
