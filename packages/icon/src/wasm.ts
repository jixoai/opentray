/**
 * Lazy WASM bootstrap for the kernel's image stack (spike-verified
 * 2026-09-09, demos/wasm-spike):
 *
 * - jsquash v3 codecs auto-`init()` through `fetch(new URL(...))` which Node
 *   rejects for file URLs. The only reliable Node path is pre-initializing
 *   with the wasm bytes read from disk, via each codec's subpath export.
 * - `@resvg/resvg-wasm` cannot load system fonts in a WASM environment; text
 *   must arrive as explicit `fontBuffers` (see fonts.ts). `loadSystemFonts`
 *   stays false everywhere — with it true, resvg silently drops text.
 *
 * Every loader is a memoized singleton so repeated generation calls pay the
 * wasm handshake once per process. Initialization failure throws a typed
 * error; callers (runtime daemon, build tools) decide their own fallback.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { ImageDataLike } from "./types";

const require = createRequire(import.meta.url);

/**
 * Exact-typed wasm bytes (TS 5.7 typed-array variance: a fresh copy over a
 * plain `ArrayBuffer` keeps codec signatures satisfied without casts).
 */
const readWasm = (request: string): Uint8Array<ArrayBuffer> => {
  const bytes = readFileSync(require.resolve(request));
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
};

/**
 * Compiled module for the emscripten-generation codecs (jpeg/webp/avif),
 * whose `init` accepts a `WebAssembly.Module` positionally (typing gap in
 * their d.ts); the wasm-bindgen generation (png v3, resize, resvg) takes raw
 * bytes instead.
 */
const readModule = (request: string): WebAssembly.Module =>
  new WebAssembly.Module(readWasm(request));

export { readWasm, readModule };

let pngReady: Promise<void> | undefined;
let resizeReady: Promise<void> | undefined;
let resvgReady: Promise<void> | undefined;

/** PNG decode/encode (shared wasm instance between decode and encode). */
export const loadPng = (): Promise<void> => {
  pngReady ??= (async () => {
    const { init } = await import("@jsquash/png/decode.js");
    await init(readWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
  })();
  return pngReady;
};

/** Lanczos/other resize kernels. */
export const loadResize = (): Promise<void> => {
  resizeReady ??= (async () => {
    const { initResize } = await import("@jsquash/resize");
    await initResize(
      readWasm("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm"),
    );
  })();
  return resizeReady;
};

/** SVG rasterizer. */
export const loadResvg = (): Promise<void> => {
  resvgReady ??= (async () => {
    const { initWasm } = await import("@resvg/resvg-wasm");
    await initWasm(readWasm("@resvg/resvg-wasm/index_bg.wasm"));
  })();
  return resvgReady;
};

/** Decode a PNG to RGBA pixels. */
export const decodePng = async (bytes: Uint8Array): Promise<ImageDataLike> => {
  await loadPng();
  const { decode } = await import("@jsquash/png");
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const decoded = await decode(buffer);
  if (decoded === null) throw new Error("PNG decode failed");
  return decoded;
};

/** Encode RGBA pixels to PNG bytes (no density metadata; see encode.ts pHYs). */
export const encodePng = async (image: ImageDataLike): Promise<Uint8Array> => {
  await loadPng();
  const { encode } = await import("@jsquash/png");
  return new Uint8Array(await encode(image));
};

export class IconKernelInitError extends Error {
  constructor(
    readonly stage: string,
    readonly cause: unknown,
  ) {
    super(`icon kernel wasm initialization failed at ${stage}: ${String(cause)}`);
    this.name = "IconKernelInitError";
  }
}
