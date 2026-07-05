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

// Window state returned by getWindowState / windowstatechange events.
export interface WindowState {
  state?: "normal" | "minimized" | "maximized";
  minimized?: boolean;
  maximized?: boolean;
  visible?: boolean;
}

// Window style patches used by setStyle/setBackground.
export type StylePatch = Record<string, unknown>;

// Full navigator.window bridge surface (the opentrayWindow / window object).
// Covers everything webview-control exercises; pages that only need listen()
// can use the narrower WebviewBridge type.
export interface NavigatorWindow extends WebviewBridge {
  getCapabilities(): Promise<Record<string, unknown>>;
  getStyle(): Promise<Record<string, unknown>>;
  setStyle(style: StylePatch): Promise<Record<string, unknown>>;
  setBackground(
    background: unknown,
    options?: unknown,
  ): Promise<Record<string, unknown>>;
  getWindowState(): Promise<WindowState>;
  isMaximized(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  close(): Promise<void>;
  show(): Promise<WindowState>;
  hide(): Promise<WindowState>;
  minimize(): Promise<WindowState>;
  maximize(): Promise<WindowState>;
  restore(): Promise<WindowState>;
  moveTo(x: number, y: number): Promise<{ x: number; y: number }>;
  resizeTo(width: number, height: number): Promise<{ width: number; height: number }>;
  getBounds(): Promise<unknown>;
  getTitle(): Promise<string>;
  setTitle(title: string): Promise<string>;
  getIcon(): Promise<unknown>;
  setIcon(icon: unknown): Promise<unknown>;
  startAppRegionDrag(options?: {
    x?: number;
    y?: number;
    pointerId?: number;
  }): Promise<{ active: boolean }>;
  stopAppRegionDrag(): Promise<{ active: boolean }>;
  readonly overlay?: {
    getTitlebarAreaRect(): Promise<unknown>;
    listen(
      event: "geometrychange",
      handler: (event: unknown) => void,
    ): Promise<() => Promise<void>>;
  };
}

// Correlation key: blob: URLs carry the trigger identity even when the final
// saved filename has been deduped to `name (n).ext`.
export type DownloadCorrelationKey = string;
