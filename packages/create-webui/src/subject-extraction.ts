/**
 * Browser-side AI subject extraction for scraped icon candidates
 * (@imgly/background-removal, ONNX Runtime Web). The ML runtime is lazily
 * dynamic-imported so the wizard bundle never pays for it until candidates
 * actually exist; the package fetches its model assets on first use.
 *
 * This is an enhancement, never a gate: every failure path (model download,
 * unsupported runtime, decode failure) resolves to undefined and the wizard
 * keeps its scraped candidates untouched.
 */

type RemoveBackground = (input: Blob) => Promise<Blob>;

let removeBackgroundRef: RemoveBackground | undefined;

const loadRemoveBackground = async (): Promise<RemoveBackground> => {
  if (removeBackgroundRef !== undefined) {
    return removeBackgroundRef;
  }
  const module = await import("@imgly/background-removal");
  const loaded = module.removeBackground;
  // isnet_quint8 (~42 MB) is plenty for favicon-sized art and halves the
  // first-use download; device "gpu" falls back to CPU WASM when WebGPU is
  // unavailable. Model assets stream from the vendor CDN.
  removeBackgroundRef = (input) => loaded(input, { model: "isnet_quint8", device: "gpu" });
  return removeBackgroundRef;
};

export interface ExtractedSubject {
  readonly bytes: Blob;
  readonly width: number;
  readonly height: number;
}

/** Extract the subject of an icon (background removed); undefined on failure. */
export const extractSubject = async (source: Blob): Promise<ExtractedSubject | undefined> => {
  try {
    const removeBackground = await loadRemoveBackground();
    const result = await removeBackground(source);
    const bitmap = await createImageBitmap(result);
    try {
      return { bytes: result, width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
};
