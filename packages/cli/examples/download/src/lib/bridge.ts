import type {
  DownloadEventName,
  DownloadEventPayloadMap,
  WebviewBridge,
  WebviewWindowEvent,
} from "./types";

// The native extension exposes the bridge as `navigator.opentrayWindow` and,
// when `bindWindowGlobals` is on, also as `navigator.window`. Both point at the
// same object; prefer the opentray-prefixed name and fall back to the global.
export function resolveBridge(): WebviewBridge | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    opentrayWindow?: WebviewBridge;
    window?: WebviewBridge;
  };
  return nav.opentrayWindow ?? nav.window;
}

export type DownloadUnlisten = () => void;

// Subscribe to one download event with a typed payload.
export function listenDownload<K extends DownloadEventName>(
  bridge: WebviewBridge,
  event: K,
  handler: (payload: DownloadEventPayloadMap[K], raw: WebviewWindowEvent) => void,
): DownloadUnlisten {
  const wrapped = (raw: WebviewWindowEvent) => {
    handler(raw.payload as DownloadEventPayloadMap[K], raw);
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
