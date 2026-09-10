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
 * subject-extraction.test.ts). fp16 over the quantized quint8 run: quint8
 * left pad residue on flat white/black favicons. This is an enhancement,
 * never a gate: every failure path resolves to undefined and the wizard
 * keeps its scraped candidates.
 */

type RemoveBackgroundConfig = {
  readonly model?: "isnet" | "isnet_fp16" | "isnet_quint8";
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
 * Extract the subject of an icon (background removed); undefined on failure.
 * `onStage` receives a short human-readable progress label for the spinner
 * (the backend's first-run CDN download is a multi-second wait).
 */
export const extractSubject = async (
  source: Blob,
  onStage?: (label: string) => void,
): Promise<ExtractedSubject | undefined> => {
  try {
    const removeBackground = await loadRemoveBackground();
    const progress = (key: string, current: number, total: number): void => {
      if (total <= 0) return;
      const percent = Math.min(100, Math.round((current / total) * 100));
      onStage?.(
        key.startsWith("fetch:")
          ? `AI 提取主体中（下载模型 ${percent}%）`
          : "AI 提取主体中（推理中）",
      );
    };
    // device "gpu" falls back to CPU WASM when WebGPU is unavailable — that
    // path is slow without cross-origin isolation, hence the progress label.
    const result = await removeBackground(source, {
      model: "isnet_fp16",
      device: "gpu",
      publicPath: wizardModelPublicPath(),
      progress,
    });
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
