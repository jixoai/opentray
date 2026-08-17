import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  APP_ICON_CANVAS,
  MACOS_CONTENT_SIZE,
  autoBackground,
  composeAppIcon,
  foregroundCoverage,
  foregroundLuminance,
} from "./icon-compose";

const svg = (fill: string): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="${fill}"/></svg>`,
  );

const writeTemp = async (name: string, bytes: Buffer): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "icon-compose-"));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

describe("foreground analysis", () => {
  it("measures alpha-weighted luminance of light artwork", async () => {
    const path = await writeTemp("light.svg", svg("#ffffff"));
    expect(await foregroundLuminance(path)).toBeCloseTo(1, 1);
  });

  it("measures alpha-weighted luminance of dark artwork", async () => {
    const path = await writeTemp("dark.svg", svg("#111111"));
    expect(await foregroundLuminance(path)).toBeLessThan(0.2);
  });

  it("measures opaque coverage", async () => {
    const opaque = await writeTemp(
      "opaque.png",
      await sharp({
        create: { width: 64, height: 64, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 255 } },
      })
        .png()
        .toBuffer(),
    );
    expect(await foregroundCoverage(opaque)).toBeGreaterThanOrEqual(0.985);

    const line = await writeTemp("line.svg", svg("#000000"));
    expect(await foregroundCoverage(line)).toBeLessThan(0.9);
  });
});

describe("autoBackground (owner rule)", () => {
  it("light artwork composes onto the black background", () => {
    expect(autoBackground({ luminance: 0.95, coverage: 0.3 })).toBe("black");
  });

  it("dark artwork composes onto the white background", () => {
    expect(autoBackground({ luminance: 0.08, coverage: 0.4 })).toBe("white");
  });

  it("fully opaque artwork passes through on the transparent background", () => {
    expect(autoBackground({ luminance: 0.5, coverage: 1 })).toBe("transparent");
  });

  it("unanalyzable artwork falls back to white", () => {
    expect(autoBackground({ luminance: undefined, coverage: 0 })).toBe("white");
  });
});

describe("composeAppIcon", () => {
  it("emits 1024 + macOS-824 variants with the squircle mask baked in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
    const foreground = await writeTemp("dark.svg", svg("#111111"));
    const result = await composeAppIcon({
      foregroundPath: foreground,
      background: "white",
      outputDir: dir,
    });

    for (const [label, path] of [
      ["windows", result.compositePath],
      ["macos", result.macOSPath],
    ] as const) {
      const meta = await sharp(path).metadata();
      expect(meta.width, `${label} width`).toBe(APP_ICON_CANVAS);
      expect(meta.height, `${label} height`).toBe(APP_ICON_CANVAS);
      // The bundled backgrounds carry the squircle alpha mask: corners are
      // transparent, which is what rounds the composite on macOS.
      const { data } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
      const cornerAlpha = data[(2 * APP_ICON_CANVAS + 2) * 4 + 3] ?? -1;
      expect(cornerAlpha, `${label} corner alpha`).toBe(0);
    }

    // The macOS variant renders its foreground at 824/1024 of the windows
    // variant's size. The circle spans 48/64 of the fg box, so the expected
    // widths follow from geometry (canvas * scale * 0.75).
    const fgBox = async (path: string): Promise<number> => {
      const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < info.height; y += 2) {
        for (let x = 0; x < info.width; x += 2) {
          const i = (y * info.width + x) * 4;
          if (data[i + 3]! < 200) continue;
          if (data[i]! < 200 && data[i + 1]! < 200) {
            min = Math.min(min, x);
            max = Math.max(max, x);
          }
        }
      }
      return max - min + 1;
    };
    const windowsSize = await fgBox(result.compositePath);
    const macosSize = await fgBox(result.macOSPath);
    expect(windowsSize).toBeCloseTo(APP_ICON_CANVAS * 0.8 * 0.75, -1);
    expect(macosSize).toBeCloseTo(MACOS_CONTENT_SIZE * 0.8 * 0.75, -1);
    expect(macosSize / windowsSize).toBeCloseTo(MACOS_CONTENT_SIZE / APP_ICON_CANVAS, 2);

    // ORIGINAL pixels are preserved: the dark circle stays dark on the white
    // background (no silhouette recolor), and the surrounding background is
    // the bundled white tile.
    const { data } = await sharp(result.compositePath).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number): readonly number[] => {
      const i = (y * APP_ICON_CANVAS + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    };
    expect(px(512, 512)[0]).toBeLessThan(80); // art
    expect(px(512, 120)[0]).toBeGreaterThan(200); // white bg above the art
  });

  it("renders the WHOLE tile at 824-in-1024 for macOS (not just the art)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
    const foreground = await writeTemp("dark.svg", svg("#111111"));
    const result = await composeAppIcon({
      foregroundPath: foreground,
      background: "white",
      outputDir: dir,
    });
    // Opaque-tile bounding box per variant: columns whose alpha > 0.
    const tileBox = async (path: string): Promise<{ left: number; width: number }> => {
      const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
      let left = Infinity;
      let right = -Infinity;
      for (let x = 0; x < info.width; x += 1) {
        let opaque = false;
        for (let y = 0; y < info.height && !opaque; y += 4) {
          if ((data[(y * info.width + x) * 4 + 3] ?? 0) > 16) opaque = true;
        }
        if (opaque) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      return { left, width: right - left + 1 };
    };
    const windows = await tileBox(result.compositePath);
    const macos = await tileBox(result.macOSPath);
    // Windows/Linux form: the tile fills the canvas edge-to-edge.
    expect(windows.left).toBeLessThanOrEqual(4);
    expect(windows.width).toBeGreaterThanOrEqual(APP_ICON_CANVAS - 8);
    // macOS form: the WHOLE tile scales to 824, centered with transparent
    // margins — the defect scaled only the art and left the tile full-bleed.
    expect(macos.width).toBeCloseTo(MACOS_CONTENT_SIZE, -1);
    expect(macos.left).toBeCloseTo((APP_ICON_CANVAS - MACOS_CONTENT_SIZE) / 2, -1);
  });

  it("does not letterbox non-square WHITE art into a dark reading (round-12 defect)", async () => {
    // A wide white logo previously hit sharp's default OPAQUE BLACK contain
    // padding in the analysis downscale, measuring ~0.3 and suggesting the
    // WHITE background for WHITE art.
    const wide = await writeTemp(
      "wide-white.svg",
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect x="5" y="5" width="90" height="30" fill="#ffffff"/></svg>`,
      ),
    );
    expect(await foregroundLuminance(wide)).toBeGreaterThan(0.95);
    expect(autoBackground({ luminance: await foregroundLuminance(wide), coverage: await foregroundCoverage(wide) })).toBe(
      "black",
    );
  });

  it("keeps WHITE artwork white on the auto (black) background", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
    const foreground = await writeTemp("white.svg", svg("#ffffff"));
    const result = await composeAppIcon({
      foregroundPath: foreground,
      background: "black",
      outputDir: dir,
    });
    const { data } = await sharp(result.compositePath).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number): readonly number[] => {
      const i = (y * APP_ICON_CANVAS + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    };
    // The white circle stays WHITE (round-12 defect: it was painted black).
    expect(px(512, 512)[0]).toBeGreaterThan(230);
    // Outside the art: the bundled dark tile.
    expect(px(512, 100)[0]).toBeLessThan(80);
  });

  it("passes original pixels through on the transparent background", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
    const foreground = await writeTemp(
      "color.png",
      await sharp({
        create: { width: 96, height: 96, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 255 } },
      })
        .png()
        .toBuffer(),
    );
    const result = await composeAppIcon({
      foregroundPath: foreground,
      background: "transparent",
      scale: 0.9,
      outputDir: dir,
    });
    // Center pixel keeps the original hue (no black/white flattening).
    const { data } = await sharp(result.compositePath).raw().toBuffer({ resolveWithObject: true });
    const i = (512 * APP_ICON_CANVAS + 512) * 4;
    expect(data[i]!).toBeGreaterThan(150);
    expect(data[i]!).toBeLessThan(255); // resized, but red channel dominates
    expect(data[i]! > data[i + 1]!).toBe(true);
    // The transparent background is still clipped to the squircle: an
    // opaque square source would otherwise render un-rounded on macOS.
    const corner = (60 * APP_ICON_CANVAS + 60) * 4;
    expect(data[corner + 3]!).toBe(0);
  });
});
