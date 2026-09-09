/**
 * Shared value types for the icon kernel.
 *
 * `ImageData` (the one browser type the WASM codecs exchange) resolves from
 * the DOM lib that the codec `.d.ts` files pull into the program; at RUNTIME
 * Node has no global `ImageData` constructor until a codec's glue polyfills
 * it. The kernel therefore never calls the constructor — it builds plain
 * structural objects through `makeImage`, which satisfies the same interface
 * on every runtime (Node, Bun, browsers).
 */
export type ImageDataLike = ImageData;

export const makeImage = (
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): ImageDataLike => ({ data, width, height, colorSpace: "srgb" });
