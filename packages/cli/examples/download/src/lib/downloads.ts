export type PayloadSize = "small" | "medium" | "large";

export const PAYLOAD_SIZES: Record<
  PayloadSize,
  { label: string; bytes: number }
> = {
  small: { label: "Small (~1 KB)", bytes: 1 * 1024 },
  medium: { label: "Medium (~256 KB)", bytes: 256 * 1024 },
  large: { label: "Large (~4 MB)", bytes: 4 * 1024 * 1024 },
};

// The fixed filename used by the "collision" button: clicking it twice in a row
// produces `report.json` then `report (1).json`, while `suggestedFilename`
// stays `report.json` — the exact scenario the openspec change targets.
export const COLLISION_FILENAME = "report.json";

// Curated GitHub release assets for "real network" progress testing. These are
// stable, versioned, CDN-cached, and large enough to produce visible progress.
// The native runtime reports the pre-redirect URL, so the correlation key stays
// stable even though GitHub 302s to objects.githubusercontent.com.
export interface GitHubPreset {
  id: string;
  label: string;
  url: string;
  // Approximate size for display; the real Content-Length comes from the response.
  approxBytes: number;
}

export const GITHUB_PRESETS: readonly GitHubPreset[] = [
  {
    id: "node-source",
    label: "Node.js v20 source tarball (~95 MB)",
    url: "https://github.com/nodejs/node/archive/refs/tags/v20.18.0.tar.gz",
    approxBytes: 95 * 1024 * 1024,
  },
  {
    id: "yarn-source",
    label: "Yarn classic source (~1.5 MB)",
    url: "https://github.com/yarnpkg/yarn/archive/refs/tags/v1.22.22.tar.gz",
    approxBytes: 1.5 * 1024 * 1024,
  },
  {
    id: "rust-analyzer-source",
    label: "rust-analyzer source (~5 MB)",
    url: "https://github.com/rust-lang/rust-analyzer/archive/refs/tags/2024-09-30.tar.gz",
    approxBytes: 5 * 1024 * 1024,
  },
] as const;

let counter = 0;

export function uniqueFilename(prefix = "report"): string {
  counter += 1;
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return `${prefix}-${ts}-${counter}.json`;
}

function buildPayloadBytes(size: PayloadSize): number {
  return PAYLOAD_SIZES[size].bytes;
}

// Produce the JSON string body for the requested size (used for blob downloads).
export function buildPayloadBody(size: PayloadSize): string {
  const target = buildPayloadBytes(size);
  const header = {
    generatedBy: "opentray example:download",
    kind: "webview-download-smoke",
    size,
    createdAt: new Date().toISOString(),
  };
  const line = "0123456789abcdef".repeat(8) + "\n"; // 129 bytes
  const headerStr = JSON.stringify(header, null, 2) + "\n";
  const remaining = Math.max(0, target - headerStr.length);
  const repeats = Math.floor(remaining / line.length);
  return headerStr + line.repeat(repeats);
}

// Build a loopback slow-download URL served by the example's own Vite middleware.
// This is the recommended source for progress testing: stable, reproducible,
// offline, and tunable size/delay.
export function buildSlowDownloadUrl(options: {
  sizeBytes: number;
  chunkBytes?: number;
  delayMs?: number;
  filename?: string;
}): string {
  const params = new URLSearchParams({
    size: String(options.sizeBytes),
  });
  if (options.chunkBytes !== undefined) {
    params.set("chunk", String(options.chunkBytes));
  }
  if (options.delayMs !== undefined) {
    params.set("delay", String(options.delayMs));
  }
  if (options.filename) {
    params.set("filename", options.filename);
  }
  return `/slow-download?${params.toString()}`;
}

// Fire a download by navigating to a URL. The native handler intercepts it as a
// download (because of Content-Disposition: attachment on the slow endpoint, or
// the resource's native disposition for external URLs).
export function triggerUrlDownload(url: string, filename?: string): string {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return url;
}

// Fire a real blob download through the standard <a download> path.
// The native WKWebView/WebView2 download handler intercepts this and emits the
// lifecycle events. Returns the blob URL so callers can correlate events.
export function triggerDownload(filename: string, body: string): string {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on next microtask so the native handler has time to capture the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return url;
}

// Trigger N downloads concurrently with distinct filenames. Returns the
// (filename -> blobUrl) map so the UI can correlate started events.
export function triggerConcurrent(
  baseFilename: string,
  size: PayloadSize,
  count: number,
): Map<string, string> {
  const results = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const name = baseFilename.replace(/\.json$/, `-concurrent-${i + 1}.json`);
    const url = triggerDownload(name, buildPayloadBody(size));
    results.set(name, url);
  }
  return results;
}
