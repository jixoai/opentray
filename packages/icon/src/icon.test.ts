import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import zlib from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildGlyphIconSvg,
  composeAppIcon,
  autoBackground,
  foregroundStats,
  generateDefaultAppIcon,
  glyphLetterOf,
  neutralGlyphLetterOf,
  pngWithDensity,
  GLYPH_TILE_RADIUS,
  GLYPH_TILE_SIZE,
} from "./index";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const assetsDirectory = join(moduleDirectory, "..", "assets");
const templatePath = join(
  assetsDirectory,
  "create-openspec-template-iOS-Default-1024@1x.png",
);

const icnsTagsOf = (bytes: Uint8Array): readonly string[] => {
  const tags: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== "icns") throw new Error("not an icns");
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    tags.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
    offset += view.getUint32(offset + 4);
  }
  return tags;
};

// The kernel is a no-sharp stack (jsquash WASM); fixtures are hand-encoded
// PNGs so tests never gain a native dependency.
const CRC_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  }),
);
const crc32Of = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Of(body));
  return Buffer.concat([length, body, crc]);
};
const encodeRgbaPng = (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => readonly [number, number, number, number],
): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

describe("glyph construction", () => {
  it("uses the continuous-curvature squircle standard shared with the brand path", () => {
    const svg = buildGlyphIconSvg("Notes");
    expect(svg).toContain("<svg");
    // figma-squircle emits relative cubic + arc segments; a plain rx rounded
    // rect path would not carry this many curve commands for the tile.
    const curves = svg.match(/[cC] /g)?.length ?? 0;
    expect(curves).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('fill="#0A84FF"');
    expect(svg).toContain("Notes".charAt(0));
  });

  it("letter ladder: first code point, then first ASCII alnum", () => {
    expect(glyphLetterOf("笔记工具")).toBe("笔");
    expect(glyphLetterOf("  spaced  ")).toBe("s");
    expect(glyphLetterOf("")).toBe("A");
    expect(neutralGlyphLetterOf("笔记工具")).toBeNull();
    expect(neutralGlyphLetterOf("1密码")).toBe("1");
  });
});

describe("pngWithDensity", () => {
  it("injects exactly one pHYs chunk at 72 dpi after IHDR", async () => {
    const dir = join(tmpdir(), `opentray-icon-phys-${process.pid}`);
    const result = await generateDefaultAppIcon({
      appName: "Phys",
      outputDir: dir,
    });
    const png = new Uint8Array(await readFile(result.fullPngPath));
    const withDensity = pngWithDensity(png);
    const asBuffer = Buffer.from(withDensity);
    const physCount = asBuffer.toString("latin1").match(/pHYs/g)?.length ?? 0;
    expect(physCount).toBe(1);
    const phys = asBuffer.indexOf("pHYs");
    const ihdr = asBuffer.indexOf("IHDR");
    expect(phys).toBeGreaterThan(ihdr);
    // 72 dpi = 2835 pixels per metre, unit metre.
    expect(asBuffer.readUInt32BE(phys + 4)).toBe(2835);
    expect(asBuffer.readUInt32BE(phys + 8)).toBe(2835);
    expect(asBuffer[phys + 12]).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("generateDefaultAppIcon", () => {
  it("emits a valid ten-tag ICNS, ICO ladder, Linux PNGs, and reuses cache", async () => {
    const dir = join(tmpdir(), `opentray-icon-default-${process.pid}`);
    const first = await generateDefaultAppIcon({
      appName: "Kernel Test",
      outputDir: dir,
    });
    const icns = new Uint8Array(await readFile(first.icnsPath));
    const tags = icnsTagsOf(icns);
    for (const tag of ["ic04", "ic05", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]) {
      expect(tags, `ICNS tag ${tag}`).toContain(tag);
    }
    const ico = new Uint8Array(await readFile(first.icoPath));
    expect(String.fromCharCode(...ico.subarray(0, 4))).toBe("\x00\x00\x01\x00");
    for (const { path } of first.linuxPngPaths) {
      const png = new Uint8Array(await readFile(path));
      expect(String.fromCharCode(...png.subarray(1, 4))).toBe("PNG");
    }

    const before = await stat(first.icnsPath);
    const second = await generateDefaultAppIcon({
      appName: "Kernel Test",
      outputDir: dir,
    });
    const after = await stat(first.icnsPath);
    expect(second.cacheIdentity).toBe(first.cacheIdentity);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it(
    "renders the CJK first character through the font ladder",
    async () => {
      const dir = join(tmpdir(), `opentray-icon-cjk-${process.pid}`);
      const result = await generateDefaultAppIcon({
        appName: "笔记工具",
        outputDir: dir,
      });
      const icns = new Uint8Array(await readFile(result.icnsPath));
      expect(icnsTagsOf(icns)).toContain("ic10");
      // Text-presence law: the generator throws rather than emitting a blank
      // tile, so reaching here means 笔 rasterized.
      await rm(dir, { recursive: true, force: true });
    },
    120_000,
  );
});

describe("composition semantics (create round-12 port)", () => {
  it("auto background: opaque art → transparent; light art → black; dark art → white", () => {
    expect(autoBackground({ luminance: 0.9, coverage: 1 })).toBe("transparent");
    expect(autoBackground({ luminance: undefined, coverage: 0.5 })).toBe("white");
    expect(autoBackground({ luminance: 0.8, coverage: 0.5 })).toBe("black");
    expect(autoBackground({ luminance: 0.2, coverage: 0.5 })).toBe("white");
  });

  it("auto background: a solid opaque border ring means the art carries its own backdrop — match it", () => {
    // 白底黑字（维基百科类）：满幅 + 纯白边框环 → 白底（owner 2026-09-10）。
    expect(
      autoBackground({
        luminance: 0.9,
        coverage: 1,
        edge: { opaque: 1, luminance: 0.97, uniform: true },
      }),
    ).toBe("white");
    // 黑底亮字：纯黑边框环 → 黑底。
    expect(
      autoBackground({
        luminance: 0.3,
        coverage: 1,
        edge: { opaque: 1, luminance: 0.05, uniform: true },
      }),
    ).toBe("black");
    // 满幅但边框杂色（照片/满幅艺术）→ 保持透明透传。
    expect(
      autoBackground({
        luminance: 0.6,
        coverage: 1,
        edge: { opaque: 1, luminance: 0.5, uniform: false },
      }),
    ).toBe("transparent");
    // 环不连续（边缘半透明缺口）→ 不是自带底，保持透明。
    expect(
      autoBackground({
        luminance: 0.6,
        coverage: 1,
        edge: { opaque: 0.8, luminance: 0.97, uniform: true },
      }),
    ).toBe("transparent");
  });

  it("foregroundStats derives the border ring from a solid-pad foreground", async () => {
    // 白底黑字 fixture（手工 PNG，kernel 无 sharp 依赖）：边缘环应 uniform
    // 且高亮度，走白底建议。
    const dir = join(tmpdir(), `opentray-icon-edge-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const solidPath = join(dir, "white-pad.png");
    const radius = 90;
    const whitePad = encodeRgbaPng(400, 400, (x, y) => {
      const dx = x - 200;
      const dy = y - 200;
      return dx * dx + dy * dy <= radius * radius ? [17, 17, 17, 255] : [255, 255, 255, 255];
    });
    await writeFile(solidPath, whitePad);
    const stats = await foregroundStats(solidPath);
    expect(stats.coverage).toBeGreaterThanOrEqual(0.985);
    expect(stats.edge).toBeDefined();
    expect(stats.edge!.uniform).toBe(true);
    expect(stats.edge!.opaque).toBeGreaterThanOrEqual(0.98);
    expect(stats.edge!.luminance).toBeGreaterThan(0.5);
    expect(autoBackground(stats)).toBe("white");
    await rm(dir, { recursive: true, force: true });
  });

  it("foregroundStats reads luminance and coverage from a real foreground", async () => {
    // The white background template is a white squircle on transparency: the
    // tile carries its own alpha mask (~96% of the canvas), so coverage sits
    // just under 1 and luminance is high.
    const stats = await foregroundStats(templatePath);
    expect(stats.coverage).toBeGreaterThan(0.9);
    expect(stats.coverage).toBeLessThan(0.99);
    expect(stats.luminance).toBeDefined();
    expect(stats.luminance!).toBeGreaterThan(0.5);
  });

  it("composeAppIcon clips every background to the squircle and emits the macOS variant", async () => {
    const dir = join(tmpdir(), `opentray-icon-compose-${process.pid}`);
    const template = templatePath;
    const composed = await composeAppIcon({
      foregroundPath: template,
      background: "transparent",
      outputDir: dir,
    });
    const { decodeImageFile, opaqueCoverage } = await import("./index");
    const full = await decodeImageFile(composed.compositePath);
    expect(full.width).toBe(1024);
    // Squircle-clipped tile at the default 0.8 foreground scale over a
    // transparent background: opaque area ≈ 0.8² × tile fill ≈ 0.6.
    expect(opaqueCoverage(full)).toBeLessThan(0.7);
    expect(opaqueCoverage(full)).toBeGreaterThan(0.5);
    const macOS = await decodeImageFile(composed.macOSPath);
    expect(macOS.width).toBe(1024);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);
});

describe("jpeg decode (exifr interop regression)", () => {
  it("decodes a JPEG without the CJS/ESM named-export trap", async () => {
    // 1x1 grayscale JPEG. The original bug: `import("exifr")` under Node ESM
    // exposes the callable on `default`, so `orientation` was undefined and
    // EVERY jpeg decode threw after the pixels were already decoded.
    const b64 =
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { decodeImage } = await import("./index");
    const image = await decodeImage(bytes);
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
  });
});

describe("png chunk integrity", () => {
  const allChunkCrcsValid = (png: Uint8Array): boolean => {
    const buffer = Buffer.from(png);
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8);
      const expected = buffer.readUInt32BE(offset + 8 + length);
      const actual = zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length)) >>> 0;
      if (expected !== actual) return false;
      offset += 12 + length;
      if (type.toString("ascii") === "IEND") break;
    }
    return true;
  };

  it("every emitted chunk carries a spec-valid CRC (incl. injected pHYs)", async () => {
    const dir = join(tmpdir(), `opentray-icon-crc-${process.pid}`);
    const result = await generateDefaultAppIcon({ appName: "Crc", outputDir: dir });
    for (const path of [result.fullPngPath, result.macOSPngPath, ...result.linuxPngPaths.map((p) => p.path)]) {
      expect(allChunkCrcsValid(new Uint8Array(await readFile(path)))).toBe(true);
    }
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

});

describe("default icon cache completeness", () => {
  it("regenerates when the macOS variant file is missing", async () => {
    const dir = join(tmpdir(), `opentray-icon-macosmiss-${process.pid}`);
    const first = await generateDefaultAppIcon({ appName: "Miss", outputDir: dir });
    await rm(first.macOSPngPath, { force: true });
    const second = await generateDefaultAppIcon({ appName: "Miss", outputDir: dir });
    const after = await stat(second.macOSPngPath);
    expect(after.size).toBeGreaterThan(0);
    await rm(dir, { recursive: true, force: true });
  }, 120_000);

  it("fileStem relocates outputs without changing bytes (create ↔ runtime parity)", async () => {
    const dir = join(tmpdir(), `opentray-icon-stem-${process.pid}`);
    const a = await generateDefaultAppIcon({ appName: "Parity", outputDir: join(dir, "a") });
    const b = await generateDefaultAppIcon({
      appName: "Parity",
      outputDir: join(dir, "b"),
      fileStem: "app-icon",
    });
    expect(b.icnsPath.endsWith("app-icon.icns")).toBe(true);
    expect(await readFile(b.icnsPath)).toEqual(await readFile(a.icnsPath));
    await rm(dir, { recursive: true, force: true });
  }, 120_000);
});

describe("glyph geometry constants", () => {
  it("keeps the brand tile parameters", () => {
    expect(GLYPH_TILE_SIZE).toBe(896);
    expect(GLYPH_TILE_RADIUS).toBe(196);
  });
});
