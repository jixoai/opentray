// Mirrors the public download payload contract in @opentray/ext-webview
// (WebviewWindowEventMap). Kept inline so the example stays self-contained,
// but every field name matches the public types 1:1.

export interface DownloadStartedPayload {
  url: string;
  filename: string;
  suggestedFilename: string | null;
}

export interface DownloadProgressPayload extends DownloadStartedPayload {
  receivedBytes: number;
  totalBytes: number | null;
}

export interface DownloadCompletedPayload extends DownloadStartedPayload {
  success: boolean;
}

export type DownloadEventName =
  | "downloadstarted"
  | "downloadprogress"
  | "downloadcompleted"
  | "downloadfailed"
  | "downloadcanceled";

export interface WebviewWindowEvent<TPayload = unknown> {
  event: string;
  id: number;
  payload: TPayload;
}

export type DownloadEventPayloadMap = {
  downloadstarted: DownloadStartedPayload;
  downloadprogress: DownloadProgressPayload;
  downloadcompleted: DownloadCompletedPayload;
  downloadfailed: DownloadStartedPayload;
  downloadcanceled: DownloadStartedPayload;
};

// The minimal navigator.window bridge surface we use from the page.
export interface WebviewBridge {
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void,
  ): () => Promise<void> | void;
}

// Correlation key: blob: URLs carry the trigger identity even when the final
// saved filename has been deduped to `name (n).ext`.
export type DownloadCorrelationKey = string;
