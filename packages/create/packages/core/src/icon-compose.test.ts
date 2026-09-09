// Create-side composition scenarios over the shared @opentray/icon kernel.
// Kernel-internal behavior (squircle clip, variant emission, stats basics)
// is covered by packages/icon/src/icon.test.ts; this suite keeps the
// create-specific regressions: whole-tile macOS geometry, original-pixel
// preservation per background, and the round-12 luminance defect.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_ICON_CANVAS,
  MACOS_CONTENT_SIZE,
  autoBackground,
  composeAppIcon,
  decodeImageFile,
  emptyImageOf,
  encodeImagePng,
  foregroundCoverage,
  foregroundLuminance,
} from "@opentray/icon";

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

describe("composeAppIcon (create scenarios)", () => {
  it(
    "renders the WHOLE tile at 824-in-1024 for macOS (not just the art)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
      const foreground = await writeTemp("dark.svg", svg("#111111"));
      const result = await composeAppIcon({
        foregroundPath: foreground,
        background: "white",
        outputDir: dir,
      });
      // Opaque-tile bounding box per variant: columns whose alpha > 0.
      const tileBox = async (path: string): Promise<{ left: number; width: number }> => {
        const image = await decodeImageFile(path);
        let left = Infinity;
        let right = -Infinity;
        for (let x = 0; x < image.width; x += 1) {
          let opaque = false;
          for (let y = 0; y < image.height && !opaque; y += 4) {
            if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 16) opaque = true;
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
    },
    120_000,
  );

  it(
    "keeps WHITE artwork white on the auto (black) background",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
      const foreground = await writeTemp("white.svg", svg("#ffffff"));
      const result = await composeAppIcon({
        foregroundPath: foreground,
        background: "black",
        outputDir: dir,
      });
      const image = await decodeImageFile(result.compositePath);
      const px = (x: number, y: number): readonly number[] => {
        const i = (y * APP_ICON_CANVAS + x) * 4;
        return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!, image.data[i + 3]!];
      };
      // The white circle stays WHITE (round-12 defect: it was painted black).
      expect(px(512, 512)[0]).toBeGreaterThan(230);
      // Outside the art: the bundled dark tile.
      expect(px(512, 100)[0]).toBeLessThan(80);
    },
    120_000,
  );

  it(
    "passes original pixels through on the transparent background",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "icon-compose-out-"));
      const color = emptyImageOf(96, 96);
      for (let i = 0; i < 96 * 96; i += 1) {
        color.data[i * 4] = 200;
        color.data[i * 4 + 1] = 40;
        color.data[i * 4 + 2] = 90;
        color.data[i * 4 + 3] = 255;
      }
      const foreground = await writeTemp("color.png", Buffer.from(await encodeImagePng(color)));
      const result = await composeAppIcon({
        foregroundPath: foreground,
        background: "transparent",
        scale: 0.9,
        outputDir: dir,
      });
      // Center pixel keeps the original hue (no black/white flattening).
      const image = await decodeImageFile(result.compositePath);
      const i = (512 * APP_ICON_CANVAS + 512) * 4;
      expect(image.data[i]!).toBeGreaterThan(150);
      expect(image.data[i]!).toBeLessThan(255); // resized, but red channel dominates
      expect(image.data[i]! > image.data[i + 1]!).toBe(true);
      // The transparent background is still clipped to the squircle: an
      // opaque square source would otherwise render un-rounded on macOS.
      const corner = (60 * APP_ICON_CANVAS + 60) * 4;
      expect(image.data[corner + 3]!).toBe(0);
    },
    120_000,
  );

  it("does not letterbox non-square WHITE art into a dark reading (round-12 defect)", async () => {
    // A wide white logo previously hit OPAQUE BLACK contain padding in the
    // analysis downscale, measuring ~0.3 and suggesting the WHITE background
    // for WHITE art.
    const wide = await writeTemp(
      "wide-white.svg",
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect x="5" y="5" width="90" height="30" fill="#ffffff"/></svg>`,
      ),
    );
    expect(await foregroundLuminance(wide)).toBeGreaterThan(0.95);
    expect(
      autoBackground({
        luminance: await foregroundLuminance(wide),
        coverage: await foregroundCoverage(wide),
      }),
    ).toBe("black");
  }, 120_000);
});
