/**
 * Glyph icon construction (plan D4): the first character of the application
 * name on the continuous-curvature squircle tile — the same tiling parameters
 * as the kernel's brand path (figma-squircle, cornerSmoothing 1), replacing
 * the earlier plain `rx` rounded rectangle fallback.
 */
import { getSvgPath } from "figma-squircle";

import { GLYPH_FONT_FAMILY } from "./fonts";

export const GLYPH_ACCENT_DEFAULT = "#0A84FF";

/** Canvas geometry aligned with the brand tile: 1024 canvas, 64 inset. */
export const GLYPH_CANVAS = 1024;
export const GLYPH_TILE_INSET = 64;
export const GLYPH_TILE_SIZE = GLYPH_CANVAS - GLYPH_TILE_INSET * 2;
export const GLYPH_TILE_RADIUS = 196;
export const GLYPH_TILE_SMOOTHING = 1;
export const GLYPH_LETTER_SIZE = 476;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** First Unicode code point of the trimmed name; "A" when effectively empty. */
export const glyphLetterOf = (appName: string): string => {
  const characters = Array.from(appName.trim());
  return characters[0] ?? "A";
};

/**
 * Neutral fallback when neither the embedded font nor the discovered ladder
 * covers the name's first character: the first ASCII letter or digit, upper
 * case; null when the name has none.
 */
export const neutralGlyphLetterOf = (appName: string): string | null => {
  for (const character of appName.trim()) {
    if (/[a-z0-9]/i.test(character)) {
      return character.toUpperCase();
    }
  }
  return null;
};

/**
 * The glyph icon SVG. The tile path is emitted with explicit continuous
 * curvature so the rasterized shape matches the brand-icon standard exactly;
 * the letter is a text layer resolved through the font ladder at raster time
 * (never `loadSystemFonts`, which silently drops text under WASM).
 */
export const buildGlyphIconSvg = (
  appName: string,
  accent: string = GLYPH_ACCENT_DEFAULT,
  letterOverride?: string,
): string => {
  const letter = escapeXml(letterOverride ?? glyphLetterOf(appName));
  const tilePath = getSvgPath({
    width: GLYPH_TILE_SIZE,
    height: GLYPH_TILE_SIZE,
    cornerRadius: GLYPH_TILE_RADIUS,
    cornerSmoothing: GLYPH_TILE_SMOOTHING,
    preserveSmoothing: true,
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GLYPH_CANVAS}" height="${GLYPH_CANVAS}" viewBox="0 0 ${GLYPH_CANVAS} ${GLYPH_CANVAS}">`,
    `<path transform="translate(${GLYPH_TILE_INSET} ${GLYPH_TILE_INSET})" d="${tilePath}" fill="${accent}"/>`,
    `<text x="${GLYPH_CANVAS / 2}" y="${GLYPH_CANVAS / 2}" font-family="${GLYPH_FONT_FAMILY}" font-size="${GLYPH_LETTER_SIZE}" font-weight="600" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${letter}</text>`,
    `</svg>`,
  ].join("");
};
