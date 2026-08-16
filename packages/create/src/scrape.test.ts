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
  // IHDR chunk: length 13, type, 1x1 8-bit RGBA, CRC.
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from("IHDR", "latin1"),
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00]),
  Buffer.from([0x1f, 0x15, 0xc4, 0x89]),
  Buffer.alloc(64, 7),
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

const html = (title: string): string =>
  `<html><head><title>${title}</title>` +
  `<link rel="icon" href="/small.png" sizes="16x16">` +
  `<link rel="icon" href="/big.png" sizes="256x256">` +
  `</head><body>ok</body></html>`;

describe("scrapeService", () => {


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

  it("rejects a corrupt PNG favicon and falls back to no icon", async () => {
    // Signature followed by garbage (no IHDR chunk) — decoders reject it, and
    // materialization must never inherit such a file.
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256, 0),
    ]);
    const result = await scrapeService(19084, {
      fetch: fetchMock({
        pageHtml:
          '<html><head><title>Corrupt Icon</title><link rel="icon" href="/bad.png" sizes="128x128"></head><body></body></html>',
        iconBytes: new Map([["http://127.0.0.1:19084/bad.png", corrupt]]),
      }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe("Corrupt Icon");
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

describe("icon candidate collection", () => {
  /** Distinct art patterns: aHash must tell them apart at any size. */
  const patternPng = async (size: number, pattern: "checker" | "gradient" | "stripes"): Promise<Buffer> => {
    const sharpModule = await import("sharp");
    const raw = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const idx = (y * size + x) * 3;
        let shade: number;
        if (pattern === "checker") {
          shade = (Math.floor(x / Math.max(1, size / 8)) + Math.floor(y / Math.max(1, size / 8))) % 2 === 0 ? 230 : 20;
        } else if (pattern === "gradient") {
          shade = Math.floor((x / size) * 255);
        } else {
          shade = y % 2 === 0 ? 240 : 40;
        }
        raw[idx] = shade;
        raw[idx + 1] = shade;
        raw[idx + 2] = shade;
      }
    }
    return sharpModule.default(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  };

  it("collects an SVG favicon instead of skipping it", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
    );
    const result = await scrapeService(19085, {
      fetch: fetchMock({
        pageHtml:
          '<html><head><title>SVG Site</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"></head><body></body></html>',
        iconBytes: new Map([["http://127.0.0.1:19085/favicon.svg", svg]]),
      }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    expect(result.ok).toBe(true);
    expect(result.title).toBe("SVG Site");
    const originals = result.icons.filter((i) => i.variant === "original");
    expect(originals).toHaveLength(1);
    expect(originals[0]?.format).toBe("svg");
    // viewBox-driven clarity ranks it as a large scalable source.
    expect(originals[0]?.width).toBe(24);
    expect(result.iconPath).toBe(originals[0]?.path);
    // Solid silhouettes derived from the SVG join the candidate list.
    const solids = result.icons.filter((i) => i.variant !== "original");
    expect(solids.map((s) => s.variant).sort()).toEqual(["solid-black", "solid-white"]);
  });

  it("collects multiple candidates ranked by true pixel clarity", async () => {
    const small = await patternPng(16, "stripes");
    const large = await patternPng(256, "gradient");
    const result = await scrapeService(19086, {
      fetch: fetchMock({
        pageHtml:
          '<html><head><title>Multi</title>' +
          '<link rel="icon" href="/small.png" sizes="16x16">' +
          '<link rel="apple-touch-icon" href="/large.png">' +
          '</head><body></body></html>',
        iconBytes: new Map([
          ["http://127.0.0.1:19086/small.png", small],
          ["http://127.0.0.1:19086/large.png", large],
        ]),
      }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    const originals = result.icons.filter((i) => i.variant === "original");
    expect(originals).toHaveLength(2);
    expect(originals[0]?.url).toBe("http://127.0.0.1:19086/large.png");
    expect(originals[0]?.width).toBe(256);
    expect(originals[1]?.width).toBe(16);
  });

  it("hides near-duplicate images (same art, other size)", async () => {
    const small = await patternPng(32, "checker"); // same art as `large`…
    const large = await patternPng(512, "checker"); // …scaled up → duplicate
    const distinct = await patternPng(64, "gradient");
    const result = await scrapeService(19087, {
      fetch: fetchMock({
        pageHtml:
          '<html><head><title>Dedupe</title>' +
          '<link rel="icon" href="/a.png" sizes="32x32">' +
          '<link rel="icon" href="/b.png" sizes="512x512">' +
          '<link rel="icon" href="/c.png" sizes="64x64">' +
          '</head><body></body></html>',
        iconBytes: new Map([
          ["http://127.0.0.1:19087/a.png", small],
          ["http://127.0.0.1:19087/b.png", large],
          ["http://127.0.0.1:19087/c.png", distinct],
        ]),
      }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    const originals = result.icons.filter((i) => i.variant === "original");
    expect(originals).toHaveLength(2);
    // The clearest surviving copy of the duplicate pair wins.
    expect(originals[0]?.url).toBe("http://127.0.0.1:19087/b.png");
    expect(originals.map((i) => i.url)).not.toContain("http://127.0.0.1:19087/a.png");
  });

  it("cracks an ICO container to its largest frame", async () => {
    const pngFrame = await patternPng(256, "stripes");
    // ICONDIR + one directory entry pointing at the PNG payload.
    const header = Buffer.alloc(6 + 16);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type icon
    header.writeUInt16LE(1, 4); // count
    header[6] = 0; // width 256
    header[7] = 0; // height 256
    header.writeUInt16LE(1, 8); // colors
    header.writeUInt16LE(32, 12); // bpp
    header.writeUInt32LE(pngFrame.length, 14);
    header.writeUInt32LE(6 + 16, 18);
    const ico = Buffer.concat([header, pngFrame]);
    const result = await scrapeService(19088, {
      fetch: fetchMock({
        pageHtml:
          '<html><head><title>ICO Site</title></head><body></body></html>',
        iconBytes: new Map([["http://127.0.0.1:19088/favicon.ico", ico]]),
      }),
      tempDir: await mkdtemp(join(tmpdir(), "scrape-test-")),
    });
    const originals = result.icons.filter((i) => i.variant === "original");
    expect(originals).toHaveLength(1);
    expect(originals[0]?.format).toBe("png");
    expect(originals[0]?.width).toBe(256);
  });
});
