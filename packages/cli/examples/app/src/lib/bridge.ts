import type {
  DownloadEventName,
  DownloadEventPayloadMap,
  NavigatorWindow,
  WebviewBridge,
  WebviewWindowEvent,
} from "./types";

// The native extension exposes the bridge as `navigator.opentrayWindow` and,
// when `bindWindowGlobals` is on, also as `navigator.window`. Both point at the
// same full navigator window surface; prefer the opentray-prefixed name.
export function resolveBridge(): NavigatorWindow | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    opentrayWindow?: NavigatorWindow;
    window?: NavigatorWindow;
  };
  return nav.opentrayWindow ?? nav.window;
}

// Screen API surfaced via navigator.opentrayScreen / navigator.screen when
// nativeScreenApi / bindScreenGlobals is enabled.
export interface ScreenApi {
  getScreenDetails(): Promise<unknown>;
}

// The opentray namespace (navigator.opentray) exposes ipc + tray + screen +
// permissions sub-objects when the corresponding native APIs are enabled.
export interface WebviewNamespace {
  ipc?: { postMessage(payload: unknown): Promise<{ queued: true }> };
  tray?: { getBounds(): Promise<unknown> };
  screen?: { getScreenDetails(): Promise<unknown> };
  permissions?: unknown;
  execCommand(command: string): void;
}

export function resolveNamespace(): WebviewNamespace | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & { opentray?: WebviewNamespace };
  return nav.opentray;
}

export type Unlisten = () => void;

// Subscribe to one download event with a typed payload.
export function listenDownload<K extends DownloadEventName>(
  bridge: WebviewBridge,
  event: K,
  handler: (payload: DownloadEventPayloadMap[K], raw: WebviewWindowEvent) => void,
): Unlisten {
  const wrapped = (raw: WebviewWindowEvent) => {
    handler(raw.payload as DownloadEventPayloadMap[K], raw);
  };
  const stop = bridge.listen(event, wrapped);
  return () => {
    void Promise.resolve(stop).then((fn) => fn?.());
  };
}

// Subscribe to any bridge event with an untyped payload.
export function listenEvent(
  bridge: WebviewBridge,
  event: string,
  handler: (payload: unknown, raw: WebviewWindowEvent) => void,
): Unlisten {
  const wrapped = (raw: WebviewWindowEvent) => {
    handler(raw.payload, raw);
  };
  const stop = bridge.listen(event, wrapped);
  return () => {
    void Promise.resolve(stop).then((fn) => fn?.());
  };
}

export const DOWNLOAD_EVENT_NAMES: readonly DownloadEventName[] = [
  "downloadstarted",
  "downloadprogress",
  "downloadcompleted",
  "downloadfailed",
  "downloadcanceled",
] as const;
