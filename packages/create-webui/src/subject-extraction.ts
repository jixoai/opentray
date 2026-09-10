/**
 * Browser-side AI subject extraction for scraped icon candidates
 * (@imgly/background-removal, ONNX Runtime Web). The ML runtime is lazily
 * dynamic-imported so the wizard bundle never pays for it until candidates
 * actually exist.
 *
 * Model assets load through the wizard server's proxy route
 * (/imgly-data/<version>/…): the wizard rebinds a random port every launch,
 * so browser-side caches are useless across sessions — the BACKEND owns the
 * vendor-CDN download and the persistent disk cache (owner round-8). The
 * version pin must track the installed @imgly/background-removal (guarded by
 * scripts/check-imgly-version.mjs). This is an enhancement, never a gate:
 * every failure path resolves to undefined and the wizard keeps its scraped
 * candidates.
 */

export type SubjectModel = "isnet_fp16" | "isnet_quint8" | "isnet";

/** User-tunable extraction knobs (owner round-10 advanced settings). */
export interface SubjectExtractionSettings {
  /** Model precision: fp16 default; isnet = fp32 (best, largest); quint8 fast/rough. */
  readonly model: SubjectModel;
  /** Drop pixels whose alpha is below this (0–128, 0 = off) — cleans faint
   * pad residue around the subject without touching solid interior pixels. */
  readonly alphaThreshold: number;
  /** Erode the subject edge by N pixels (0–6, 0 = off) — cuts halos/fringes. */
  readonly shrink: number;
}

export const DEFAULT_SUBJECT_SETTINGS: SubjectExtractionSettings = {
  model: "isnet_fp16",
  alphaThreshold: 0,
  shrink: 0,
};

type RemoveBackgroundConfig = {
  readonly model?: SubjectModel;
  readonly device?: "cpu" | "gpu";
  readonly publicPath?: string;
  readonly progress?: (key: string, current: number, total: number) => void;
};
type RemoveBackground = (input: Blob, config?: RemoveBackgroundConfig) => Promise<Blob>;

/** Keep in sync with the installed @imgly/background-removal (test-guarded). */
export const IMGLY_DATA_VERSION = "1.7.0";

let removeBackgroundRef: RemoveBackground | undefined;

const loadRemoveBackground = async (): Promise<RemoveBackground> => {
  if (removeBackgroundRef !== undefined) {
    return removeBackgroundRef;
  }
  const module = await import("@imgly/background-removal");
  removeBackgroundRef = module.removeBackground;
  return removeBackgroundRef;
};

/** Wizard's proxy route: backend-cached model assets on this origin. */
const wizardModelPublicPath = (): string =>
  new URL(`/imgly-data/${IMGLY_DATA_VERSION}/`, window.location.origin).toString();

export interface ExtractedSubject {
  readonly bytes: Blob;
  readonly width: number;
  readonly height: number;
}

/**
 * Structured extraction progress: `download` carries the model-asset download
 * percentage, `infer` marks the inference phase. UI layers map this to their
 * own localized spinner labels.
 */
export type SubjectExtractionStage =
  | { kind: "download"; percent: number }
  | { kind: "infer" };

/** Structural pixel buffer (ImageData-compatible) for canvas-free tests. */
export interface SubjectPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Post-process an extracted subject's pixels. Pure (no canvas/ImageData
 * dependency) so the threshold/erode semantics stay unit-testable: threshold
 * zeroes low-alpha residue; shrink runs N 3×3 alpha erosions to pull the
 * edge in.
 */
export const postProcessSubject = (
  image: SubjectPixels,
  settings: SubjectExtractionSettings,
): SubjectPixels => {
  if (settings.alphaThreshold <= 0 && settings.shrink <= 0) {
    return image;
  }
  const { width, height } = image;
  let alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) {
    const a = image.data[i * 4 + 3] ?? 0;
    alpha[i] = settings.alphaThreshold > 0 && a < settings.alphaThreshold ? 0 : a;
  }
  for (let iteration = 0; iteration < settings.shrink; iteration += 1) {
    const eroded = new Uint8ClampedArray(alpha.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let minimum = alpha[y * width + x] ?? 0;
        for (let dy = -1; dy <= 1 && minimum > 0; dy += 1) {
          for (let dx = -1; dx <= 1 && minimum > 0; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            const neighbor =
              ny < 0 || ny >= height || nx < 0 || nx >= width ? 0 : alpha[ny * width + nx] ?? 0;
            if (neighbor < minimum) {
              minimum = neighbor;
            }
          }
        }
        eroded[y * width + x] = minimum;
      }
    }
    alpha = eroded;
  }
  const result = { data: new Uint8ClampedArray(image.data), width, height };
  for (let i = 0; i < alpha.length; i += 1) {
    result.data[i * 4 + 3] = alpha[i] ?? 0;
  }
  return result;
};

/**
 * Extract the subject of an icon (background removed); undefined on failure.
 * `onStage` receives the structured progress stage for the spinner (the
 * backend's first-run CDN download is a multi-second wait).
 */
export const extractSubject = async (
  source: Blob,
  settings: SubjectExtractionSettings = DEFAULT_SUBJECT_SETTINGS,
  onStage?: (stage: SubjectExtractionStage) => void,
): Promise<ExtractedSubject | undefined> => {
  try {
    const removeBackground = await loadRemoveBackground();
    const progress = (key: string, current: number, total: number): void => {
      if (total <= 0) return;
      const percent = Math.min(100, Math.round((current / total) * 100));
      onStage?.(
        key.startsWith("fetch:") ? { kind: "download", percent } : { kind: "infer" },
      );
    };
    // device "gpu" falls back to CPU WASM when WebGPU is unavailable — that
    // path is slow without cross-origin isolation, hence the progress label.
    const raw = await removeBackground(source, {
      model: settings.model,
      device: "gpu",
      publicPath: wizardModelPublicPath(),
      progress,
    });
    let bytes = raw;
    const bitmap = await createImageBitmap(raw);
    try {
      if (settings.alphaThreshold > 0 || settings.shrink > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (context !== null) {
          context.drawImage(bitmap, 0, 0);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const processed = postProcessSubject(frame, settings);
          frame.data.set(processed.data);
          context.putImageData(frame, 0, 0);
          const encoded = await new Promise<Blob | null>((resolvePromise) =>
            canvas.toBlob(resolvePromise, "image/png"),
          );
          if (encoded !== null) {
            bytes = encoded;
          }
        }
      }
      return { bytes, width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
};
