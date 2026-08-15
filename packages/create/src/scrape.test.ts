import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createGlyphIconSvg,
  extractFaviconCandidates,
  extractTitle,
  faviconCandidateSize,
  rankFaviconCandidates,
  resolveFaviconUrl,
  scrapeService,
  writeGlyphIconTemp,
  type ScrapeFetch,
} from "./scrape";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128, 7),
]);

describe("extractTitle", () => {
  it("extracts and decodes the title", () => {
    expect(extractTitle("<html><head><title>My &amp; App</title></head></html>")).toBe(
      "My & App",
    );
  });

  it("normalizes whitespace and returns undefined when absent", () => {
    expect(extractTitle("<title>  Hello   World </title>")).toBe("Hello World");
    expect(extractTitle("<html></html>")).toBeUndefined();
  });
});

describe("extractFaviconCandidates", () => {
  it("collects icon links with sizes", () => {
    const html = [
      `<head>`,
      `<link rel="icon" href="/favicon-16.png" sizes="16x16">`,
      `<link rel="icon" type="image/png" href="/favicon-192.png" sizes="192x192">`,
      `<link rel="apple-touch-icon" href="/touch.png">`,
      `<link rel="stylesheet" href="/a.css">`,
      `</head>`,
    ].join("");
    const candidates = extractFaviconCandidates(html);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toEqual({ href: "/favicon-16.png", rel: "icon", sizes: "16x16" });
  });

  it("skips mask icons", () => {
    const html = `<link rel="mask-icon" href="/m.svg" color="#000">`;
    expect(extractFaviconCandidates(html)).toEqual([]);
  });
});

describe("favicon ranking", () => {
  it("prefers larger declared sizes, then apple-touch-icon", () => {
    const ranked = rankFaviconCandidates([
      { href: "/16.png", rel: "icon", sizes: "16x16" },
      { href: "/touch.png", rel: "apple-touch-icon" },
      { href: "/512.png", rel: "icon", sizes: "512x512" },
      { href: "/none.png", rel: "icon" },
    ]);
    expect(ranked.map((candidate) => candidate.href)).toEqual([
      "/512.png",
      "/touch.png",
      "/16.png",
      "/none.png",
    ]);
  });

  it("parses sizes attributes", () => {
    expect(faviconCandidateSize({ href: "/a", rel: "icon", sizes: "32x64" })).toBe(64);
    expect(faviconCandidateSize({ href: "/a", rel: "icon", sizes: "any" })).toBe(0);
    expect(faviconCandidateSize({ href: "/a", rel: "icon" })).toBe(0);
  });

  it("resolves relative and absolute hrefs", () => {
    expect(resolveFaviconUrl("/x.png", "http://127.0.0.1:19080")).toBe(
      "http://127.0.0.1:19080/x.png",
    );
    expect(resolveFaviconUrl("http://cdn.example/y.png", "http://127.0.0.1:1")).toBe(
      "http://cdn.example/y.png",
    );
  });
});

describe("scrapeService", () => {
  const html = (title: string): string =>
    `<html><head><title>${title}</title>` +
    `<link rel="icon" href="/small.png" sizes="16x16">` +
    `<link rel="icon" href="/big.png" sizes="256x256">` +
    `</head><body>ok</body></html>`;

  const fetchMock = (options: {
    pageHtml?: string;
    pageOk?: boolean;
    iconBytes?: Map<string, Buffer>;
  }): ScrapeFetch => ({
    async page(url) {
      if (options.pageOk === false) {
        return { ok: false, status: 0, body: "", headers: {} };
      }
      return { ok: true, status: 200, body: options.pageHtml ?? html("Scraped Title"), headers: {} };
    },
    async bytes(url) {
      const bytes = options.iconBytes?.get(url);
      if (bytes === undefined) {
        return { ok: false, status: 404, bytes: Buffer.alloc(0), contentType: "" };
      }
      return { ok: true, status: 200, bytes, contentType: "image/png" };
    },
  });

  it("scrapes the title and the largest favicon to a temp file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "scrape-test-"));
    const iconBytes = new Map([
      ["http://127.0.0.1:19080/big.png", PNG_BYTES],
    ]);
    const result = await scrapeService(19080, {
      fetch: fetchMock({ iconBytes }),
      tempDir,
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe("Scraped Title");
    expect(result.iconUrl).toBe("http://127.0.0.1:19080/big.png");
    expect(await readFile(result.iconPath!)).toEqual(PNG_BYTES);
  });

  it("falls back to /favicon.ico when no link candidate downloads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "scrape-test-"));
    const iconBytes = new Map([
      ["http://127.0.0.1:19081/favicon.ico", PNG_BYTES],
    ]);
    const result = await scrapeService(19081, {
      fetch: fetchMock({ iconBytes }),
      tempDir,
    });
    expect(result.iconUrl).toBe("http://127.0.0.1:19081/favicon.ico");
  });

  it("returns ok with partial identity when nothing downloads", async () => {
    const result = await scrapeService(19082, {
      fetch: fetchMock({}),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe("Scraped Title");
    expect(result.iconPath).toBeUndefined();
  });

  it("returns ok false when the page fetch fails", async () => {
    const result = await scrapeService(19083, {
      fetch: fetchMock({ pageOk: false }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    expect(result.ok).toBe(false);
  });
});

describe("glyph fallback", () => {
  it("renders a letter into an SVG", () => {
    const svg = createGlyphIconSvg("Vite", "#123456");
    expect(svg).toContain(">V<");
    expect(svg).toContain("#123456");
  });

  it("escapes markup in the glyph letter", () => {
    const svg = createGlyphIconSvg("<x>");
    expect(svg).not.toContain("<x>");
  });

  it("writes the glyph SVG to a temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glyph-test-"));
    const path = await writeGlyphIconTemp("Dev", dir);
    expect(await readFile(path, "utf8")).toContain(">D<");
  });
});
