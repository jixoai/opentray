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

    // The macOS variant renders its foreground at 824/1024 of the size.
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
    expect(Math.round(windowsSize)).toBeGreaterThanOrEqual(
      Math.round(MACOS_CONTENT_SIZE * 0.8) - 4,
    );
    expect(Math.round(macosSize)).toBeLessThan(windowsSize);
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
  });
});
