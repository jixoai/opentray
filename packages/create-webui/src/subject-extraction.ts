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

type RemoveBackground = (input: Blob, config?: { publicPath?: string }) => Promise<Blob>;

let removeBackgroundRef: RemoveBackground | undefined;

const loadRemoveBackground = async (): Promise<RemoveBackground> => {
  if (removeBackgroundRef !== undefined) {
    return removeBackgroundRef;
  }
  const module = await import("@imgly/background-removal");
  const loaded = module.removeBackground;
  // isnet_quint8 (~42 MB) is plenty for favicon-sized art and halves the
  // payload; device "gpu" falls back to CPU WASM when WebGPU is unavailable.
  removeBackgroundRef = (input, config) =>
    // The vendored copy ships with the wizard (dist/imgly-data, served at
    // /imgly-data/) — offline and CDN-outage safe; the absolute URL is
    // required by the runtime's new URL(..., publicPath) resolution.
    loaded(input, {
      model: "isnet_quint8",
      device: "gpu",
      ...(config === undefined ? {} : { publicPath: config.publicPath }),
    });
  return removeBackgroundRef;
};

/** Wizard-local vendored model assets (owner decision: ship inline). */
const localPublicPath = (): string =>
  new URL("/imgly-data/", window.location.origin).toString();

export interface ExtractedSubject {
  readonly bytes: Blob;
  readonly width: number;
  readonly height: number;
}

/** Extract the subject of an icon (background removed); undefined on failure. */
export const extractSubject = async (source: Blob): Promise<ExtractedSubject | undefined> => {
  try {
    const removeBackground = await loadRemoveBackground();
    // Vendored assets first (offline, no CDN dependency); fall back to the
    // package default CDN when the local copy is absent (dev builds without
    // the vendor step). Both failures are silent enhancement degradation.
    let result: Blob;
    try {
      result = await removeBackground(source, { publicPath: localPublicPath() });
    } catch {
      result = await removeBackground(source);
    }
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
