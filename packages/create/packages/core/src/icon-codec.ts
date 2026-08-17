// Thin image-encoding seam (raw pixels → PNG via sharp). Kept as its own
// module so tests can stub encoding without stubbing all of sharp.
export const toPngBuffer = async (
  rgba: Buffer,
  width: number,
  height: number,
  channels: 3 | 4,
): Promise<Buffer> => {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  return sharp(rgba, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();
};
