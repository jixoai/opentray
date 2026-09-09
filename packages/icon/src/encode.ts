/**
 * Platform encoders. PNG payloads carry explicit 72 DPI density: the WASM PNG
 * encoder emits no `pHYs` chunk (spike-verified), so density is injected with
 * a minimal chunk surgery (insert/replace after IHDR, CRC32 over type+data).
 * ICNS keeps the ten-tag explicit representation set; ICO and Linux PNGs keep
 * their ladders. All encoders consume PNG bytes so the density law applies to
 * every emitted pixel payload.
 */
import { IconIcns, IconIco } from "@shockpkg/icon-encoder";

import { encodeImagePng, type ImageDataLike } from "./raster";

/** Pixels per metre for 72 DPI (72 × 39.3701 ≈ 2834.65, the Apple value). */
const PIXELS_PER_METRE_72DPI = 2835;

export const ICNS_REPRESENTATIONS = [
  { tag: "ic12", size: 64 },
  { tag: "ic07", size: 128 },
  { tag: "ic13", size: 256 },
  { tag: "ic08", size: 256 },
  { tag: "ic04", size: 16 },
  { tag: "ic14", size: 512 },
  { tag: "ic09", size: 512 },
  { tag: "ic05", size: 32 },
  { tag: "ic10", size: 1024 },
  { tag: "ic11", size: 32 },
] as const;

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
export const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;

/* ---------------------------------- CRC32 ---------------------------------- */

const CRC_TABLE: readonly number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/* ------------------------------ PNG chunk surgery --------------------------- */

const chunkLength = (view: DataView, offset: number): number =>
  view.getUint32(offset);

const chunkType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );

const PHYS_DATA = (() => {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, PIXELS_PER_METRE_72DPI);
  view.setUint32(4, PIXELS_PER_METRE_72DPI);
  data[8] = 1; // unit: metre
  return data;
})();

/**
 * Ensure a PNG carries exactly one `pHYs` chunk at 72 DPI, inserted after
 * IHDR. Every pre-existing `pHYs` chunk (however many a malformed input
 * carried) is dropped so the emitted density cannot drift.
 */
export const pngWithDensity = (png: Uint8Array): Uint8Array => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // Walk chunks; the IHDR/IEND pair bounds the file in any valid PNG.
  let offset = 8; // signature
  let ihdrEnd = -1;
  const segments: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = chunkLength(view, offset);
    const type = chunkType(png, offset + 4);
    const chunkEnd = offset + 12 + length;
    if (type === "IHDR") {
      ihdrEnd = chunkEnd;
      segments.push(png.subarray(offset, chunkEnd));
    } else if (type !== "pHYs") {
      (ihdrEnd === -1 ? segments : tail).push(png.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  if (ihdrEnd === -1) throw new Error("pngWithDensity: IHDR chunk not found");

  const chunk = new Uint8Array(12 + PHYS_DATA.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, PHYS_DATA.length);
  chunk.set(
    new TextEncoder().encode("pHYs"),
    4,
  );
  chunk.set(PHYS_DATA, 8);
  chunkView.setUint32(
    8 + PHYS_DATA.length,
    crc32(chunk.subarray(4, 8 + PHYS_DATA.length)),
  );

  return concat(
    png.subarray(0, 8),
    ...segments,
    chunk,
    ...tail,
  );
};

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

/* ------------------------------- icon encoders ------------------------------ */

/** Encode RGBA pixels to a density-carrying PNG. */
export const encodeDensePng = async (
  image: ImageDataLike,
): Promise<Uint8Array> => pngWithDensity(await encodeImagePng(image));

/** Encode the ten-tag ICNS from per-size PNG payloads (macOS variant source). */
export const encodeIcns = async (
  pngAt: (size: number) => Promise<Uint8Array>,
): Promise<Uint8Array> => {
  const icns = new IconIcns();
  icns.toc = true;
  for (const { tag, size } of ICNS_REPRESENTATIONS) {
    await icns.addFromPng(await pngAt(size), [tag], false);
  }
  return icns.encode();
};

/** Encode the ICO ladder from per-size PNG payloads (Windows variant source). */
export const encodeIco = async (
  pngAt: (size: number) => Promise<Uint8Array>,
): Promise<Uint8Array> => {
  const ico = new IconIco();
  for (const size of ICO_SIZES) {
    await ico.addFromPng(await pngAt(size), null, false);
  }
  return ico.encode();
};
