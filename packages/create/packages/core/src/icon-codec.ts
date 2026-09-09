// Thin image-encoding seam (raw pixels → PNG through the shared icon
// kernel). Kept as its own module so tests can stub encoding without
// stubbing the rest of the kernel.
import { emptyImageOf, encodeImagePng } from "@opentray/icon";

export const toPngBuffer = async (
  rgba: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
): Promise<Buffer> => {
  const pixels = width * height;
  const image = emptyImageOf(width, height);
  if (channels === 3) {
    for (let i = 0; i < pixels; i += 1) {
      image.data[i * 4] = rgba[i * 3] ?? 0;
      image.data[i * 4 + 1] = rgba[i * 3 + 1] ?? 0;
      image.data[i * 4 + 2] = rgba[i * 3 + 2] ?? 0;
      image.data[i * 4 + 3] = 255;
    }
  } else {
    image.data.set(rgba.subarray(0, pixels * 4));
  }
  return Buffer.from(await encodeImagePng(image));
};
