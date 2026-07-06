// Unified host <-> page IPC for examples that drive native behavior through
// host-side intents (placement, media-query, badge, tray-panel).
//
// Page -> host: navigator.opentray.ipc.postMessage(intent). The host launcher
//   drains these via panel.drainIpcMessages() and acts on the intent.
// Host -> page: panel.postMessage(state) arrives on the page as a standard
//   window "message" event; we filter by a discriminator field so unrelated
//   messages (evalute, bridge events) are ignored.

export interface IpcIntent {
  // Discriminator the host matches on. Each example uses its own value, e.g.
  // "placement", "mediaQuery", "badge", "trayPanel".
  type: string;
  [key: string]: unknown;
}

export interface IpcBridge {
  postMessage(payload: unknown): Promise<{ queued: true }> | void;
}

// Resolve the navigator.opentray namespace's ipc sub-object, if exposed.
export function resolveIpcBridge(): IpcBridge | undefined {
  if (typeof navigator === "undefined") return undefined;
  const opentray = (navigator as { opentray?: { ipc?: IpcBridge } }).opentray;
  return opentray?.ipc;
}

// Send an intent to the host. No-op if the ipc bridge is unavailable.
export function sendHostIntent(intent: IpcIntent): void {
  const ipc = resolveIpcBridge();
  if (!ipc) return;
  void ipc.postMessage(intent);
}

// Subscribe to host -> page messages that carry the given discriminator.
// Returns an unsubscribe function. The handler receives the full message data.
export function onHostMessage(
  discriminator: string,
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const listener = (event: MessageEvent): void => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if ((data as { type?: unknown }).type !== discriminator) return;
    handler(data as Record<string, unknown>);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// A reactive helper: track the latest host message of a given discriminator as
// Svelte 5 state, so components can $derive from it.
export function trackHostMessage(discriminator: string): {
  current: Record<string, unknown> | null;
  stop(): void;
} {
  let current = $state<Record<string, unknown> | null>(null);
  const stop = onHostMessage(discriminator, (data) => {
    current = { ...data };
  });
  return {
    get current() {
      return current;
    },
    stop,
  };
}
