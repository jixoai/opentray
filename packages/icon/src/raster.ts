/**
 * Raster foundation for the icon kernel (spike-verified): format-dispatched
 * WASM decoding, aspect-preserving resize with manual letterboxing, EXIF
 * orientation, SVG rasterization through the font ladder, and the raw pixel
 * operations (paste / contain / trim / dest-in clip) that the composition and
 * generation paths are built on.
 */
import { readFile } from "node:fs/promises";

import { GLYPH_FONT_FAMILY, glyphFontLadder } from "./fonts";
import { makeImage, type ImageDataLike } from "./types";
import { decodePng, encodePng, loadResize, loadResvg, readModule } from "./wasm";

export type { ImageDataLike };

const imageOf = (image: ImageDataLike): ImageDataLike =>
  makeImage(new Uint8ClampedArray(image.data), image.width, image.height);

export const emptyImageOf = (width: number, height: number): ImageDataLike =>
  makeImage(new Uint8ClampedArray(width * height * 4), width, height);

export const cloneImage = (image: ImageDataLike): ImageDataLike => imageOf(image);

/* ---------------------------------- decode --------------------------------- */

const sniffFormat = (bytes: Uint8Array): "png" | "jpeg" | "webp" | "avif" | "svg" | "unknown" => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45
  ) {
    return "webp";
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "avif";
  }
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 1024).filter((byte) => byte !== 0))
    .trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "svg";
  return "unknown";
};

/** JPEG EXIF orientation (1–8); non-JPEG and missing tags report 1. */
const exifOrientationOf = async (
  format: string,
  bytes: Uint8Array,
): Promise<number> => {
  if (format !== "jpeg") return 1;
  // exifr ships CJS; under Node ESM the callable lives on `default`, while
  // bundler-run tests also accept the named form — resolve both.
  const imported = await import("exifr");
  const orientation = (imported.default ?? imported).orientation;
  return (await orientation(bytes)) ?? 1;
};

/** Apply an EXIF orientation value to raw pixels. */
const applyOrientation = (
  image: ImageDataLike,
  orientation: number,
): ImageDataLike => {
  if (orientation <= 1 || orientation > 8) return image;
  const { width, height, data } = image;
  const swap = orientation >= 5;
  const out = emptyImageOf(swap ? height : width, swap ? width : height);
  const outW = out.width;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      let targetX = x;
      let targetY = y;
      switch (orientation) {
        case 2: targetX = width - 1 - x; break;
        case 3: targetX = width - 1 - x; targetY = height - 1 - y; break;
        case 4: targetY = height - 1 - y; break;
        case 5: targetX = y; targetY = x; break;
        case 6: targetX = y; targetY = width - 1 - x; break;
        case 7: targetX = height - 1 - y; targetY = x; break;
        case 8: targetX = height - 1 - y; targetY = width - 1 - x; break;
        default: break;
      }
      const target = (targetY * outW + targetX) * 4;
      out.data[target] = data[source]!;
      out.data[target + 1] = data[source + 1]!;
      out.data[target + 2] = data[source + 2]!;
      out.data[target + 3] = data[source + 3]!;
    }
  }
  return out;
};

/**
 * Decode an encoded raster image (PNG/JPEG/WebP/AVIF) or rasterize an SVG
 * (through the font ladder; text never silently drops) to RGBA pixels.
 * JPEG orientation is applied so phone-photo sources compose upright.
 */
export const decodeImage = async (bytes: Uint8Array): Promise<ImageDataLike> => {
  const format = sniffFormat(bytes);
  const decoded = await (async (): Promise<ImageDataLike> => {
    switch (format) {
      case "png":
        return decodePng(bytes);
      case "jpeg": {
        // The emscripten-generation `init` accepts a compiled module as its
        // first positional parameter (runtime-verified); its published d.ts
        // only types the overrides object, hence the targeted cast.
        const { init } = await import("@jsquash/jpeg/decode.js");
        await init(
          readModule("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm") as never,
        );
        const { decode } = await import("@jsquash/jpeg");
        return orThrow("JPEG", await decode(toExactBuffer(bytes)));
      }
      case "webp": {
        const { init } = await import("@jsquash/webp/decode.js");
        await init(
          readModule("@jsquash/webp/codec/dec/webp_dec.wasm") as never,
        );
        const { decode } = await import("@jsquash/webp");
        return orThrow("WebP", await decode(toExactBuffer(bytes)));
      }
      case "avif": {
        const { init } = await import("@jsquash/avif/decode.js");
        await init(
          readModule("@jsquash/avif/codec/dec/avif_dec.wasm") as never,
        );
        const { decode } = await import("@jsquash/avif");
        return orThrow("AVIF", await decode(toExactBuffer(bytes)));
      }
      case "svg":
        return rasterizeSvg(new TextDecoder().decode(bytes), 1024);
      default:
        throw new Error(
          "unsupported icon source format (expected PNG/JPEG/WebP/AVIF/SVG bytes)",
        );
    }
  })();
  return applyOrientation(decoded, await exifOrientationOf(format, bytes));
};

/** Copy into a standalone ArrayBuffer for codecs that demand exactly that. */
const toExactBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

const orThrow = (label: string, image: ImageDataLike | null): ImageDataLike => {
  if (image === null) throw new Error(`${label} decode failed`);
  return image;
};

export const decodeImageFile = async (path: string): Promise<ImageDataLike> =>
  decodeImage(new Uint8Array(await readFile(path)));

/** Rasterize an SVG string with the kernel font ladder attached. */
export const rasterizeSvg = async (
  svg: string,
  width: number,
): Promise<ImageDataLike> => {
  await loadResvg();
  const { Resvg } = await import("@resvg/resvg-wasm");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      loadSystemFonts: false,
      fontBuffers: [...(await glyphFontLadder())],
      defaultFontFamily: GLYPH_FONT_FAMILY,
    },
    background: "rgba(0,0,0,0)",
  });
  const rendered = resvg.render();
  return makeImage(
    new Uint8ClampedArray(rendered.pixels),
    rendered.width,
    rendered.height,
  );
};

export const encodeImagePng = (image: ImageDataLike): Promise<Uint8Array> =>
  encodePng(image);

/* ---------------------------------- resize --------------------------------- */

export type ResizeMethod = "lanczos3" | "nearest";

/**
 * Resize with a chosen sampling kernel. The WASM resize is an exact
 * width/height remap, so callers pass aspect-true targets.
 */
export const resizeImage = async (
  image: ImageDataLike,
  width: number,
  height: number,
  method: ResizeMethod = "lanczos3",
): Promise<ImageDataLike> => {
  if (image.width === width && image.height === height) return imageOf(image);
  const { default: resize } = await import("@jsquash/resize");
  await loadResize();
  if (method === "nearest") {
    return resizeNearest(image, width, height);
  }
  return resize(image, { width, height, method: "lanczos3" });
};

/** Point sampling for pixel-art sources (sharp `kernel: nearest` port). */
const resizeNearest = (
  image: ImageDataLike,
  width: number,
  height: number,
): ImageDataLike => {
  const out = emptyImageOf(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const s = (sourceY * image.width + sourceX) * 4;
      const t = (y * width + x) * 4;
      out.data[t] = image.data[s]!;
      out.data[t + 1] = image.data[s + 1]!;
      out.data[t + 2] = image.data[s + 2]!;
      out.data[t + 3] = image.data[s + 3]!;
    }
  }
  return out;
};

/**
 * Aspect-preserving scale to fit INSIDE a box without padding (sharp
 * `fit: "inside"` semantics) — analysis paths must not add letterbox pixels
 * that would dilute coverage statistics.
 */
export const insideImage = async (
  image: ImageDataLike,
  maxSize: number,
  method: ResizeMethod = "lanczos3",
): Promise<ImageDataLike> => {
  const scale = Math.min(maxSize / image.width, maxSize / image.height);
  return resizeImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
    method,
  );
};

/**
 * `fit: contain` with TRANSPARENT letterboxing — the sharp default padding is
 * opaque black, and the composition laws require transparency (create
 * round-12 defect note).
 */
export const containImage = async (
  image: ImageDataLike,
  width: number,
  height: number,
  method: ResizeMethod = "lanczos3",
): Promise<ImageDataLike> => {
  if (image.width === width && image.height === height) return imageOf(image);
  const scale = Math.min(width / image.width, height / image.height);
  const scaled = await resizeImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
    method,
  );
  const canvas = emptyImageOf(width, height);
  pasteImage(
    canvas,
    scaled,
    Math.round((width - scaled.width) / 2),
    Math.round((height - scaled.height) / 2),
  );
  return canvas;
};

/* ------------------------------ pixel operations ---------------------------- */

/** Source-over paste of `source` onto `target` at the given offset. */
export const pasteImage = (
  target: ImageDataLike,
  source: ImageDataLike,
  left: number,
  top: number,
): void => {
  for (let y = 0; y < source.height; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= target.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= target.width) continue;
      const s = (y * source.width + x) * 4;
      const t = (targetY * target.width + targetX) * 4;
      const alpha = source.data[s + 3]! / 255;
      const inverse = 1 - alpha;
      target.data[t] =
        source.data[s]! * alpha + target.data[t]! * inverse;
      target.data[t + 1] =
        source.data[s + 1]! * alpha + target.data[t + 1]! * inverse;
      target.data[t + 2] =
        source.data[s + 2]! * alpha + target.data[t + 2]! * inverse;
      target.data[t + 3] = Math.round(
        source.data[s + 3]! + target.data[t + 3]! * inverse,
      );
    }
  }
};

/**
 * Bounding box of pixels with alpha above `threshold`. Deliberate deviation
 * from sharp's `.trim()`, which keyed on the top-left pixel COLOR: opaque
 * letterboxed sources (e.g. a white-matte logo JPEG) no longer crop their
 * background — alpha is the honest content signal for icon foregrounds.
 */
export const trimBounds = (
  image: ImageDataLike,
  threshold = 0,
): { left: number; top: number; width: number; height: number } | null => {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

export const cropImage = (
  image: ImageDataLike,
  left: number,
  top: number,
  width: number,
  height: number,
): ImageDataLike => {
  const out = emptyImageOf(width, height);
  pasteImage(out, image, -left, -top);
  return out;
};

/** Fraction of pixels whose alpha exceeds `alphaThreshold` (0–1). */
export const opaqueCoverage = (
  image: ImageDataLike,
  alphaThreshold = 200,
): number => {
  let opaque = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i]! > alphaThreshold) opaque += 1;
  }
  return opaque / (image.width * image.height);
};

/** Fraction of near-white opaque pixels (0–1) — the glyph text-presence probe. */
export const brightPixelRatio = (
  image: ImageDataLike,
  alphaThreshold = 200,
  brightness = 230,
): number => {
  let bright = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3]! <= alphaThreshold) continue;
    if (
      image.data[i]! >= brightness &&
      image.data[i + 1]! >= brightness &&
      image.data[i + 2]! >= brightness
    ) {
      bright += 1;
    }
  }
  return bright / (image.width * image.height);
};
