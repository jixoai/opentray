import type { ExtensionEnvelope, Rect } from "@opentray/spec";
import type { TrayHandle } from "opentray";

export type WebviewCommand =
  | { type: "show"; html?: string; url?: string; width: number; height: number; fallbackRect?: Rect }
  | { type: "hide" }
  | { type: "navigate"; url: string }
  | { type: "evaluate"; js: string }
  | { type: "postMessage"; payload: unknown };

export type WebviewEvent =
  | { type: "shown" }
  | { type: "hidden" }
  | { type: "message"; payload: unknown }
  | { type: "positionFallback"; strategy: "cursor" | "platformDefault" };

export interface WebviewHandle {
  show(command: Extract<WebviewCommand, { type: "show" }>): Promise<void>;
  hide(): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(js: string): Promise<void>;
  postMessage(payload: unknown): Promise<void>;
}

export const attachWebview = (tray: TrayHandle): WebviewHandle => ({
  show(command) {
    return tray.commandExtension("webview", command);
  },
  hide() {
    return tray.commandExtension("webview", { type: "hide" } satisfies WebviewCommand);
  },
  navigate(url) {
    return tray.commandExtension("webview", { type: "navigate", url } satisfies WebviewCommand);
  },
  evaluate(js) {
    return tray.commandExtension("webview", { type: "evaluate", js } satisfies WebviewCommand);
  },
  postMessage(payload) {
    return tray.commandExtension("webview", { type: "postMessage", payload } satisfies WebviewCommand);
  },
});

export const isWebviewEvent = (event: ExtensionEnvelope): event is ExtensionEnvelope<WebviewEvent> =>
  event.scope.ext === "webview" &&
  typeof event.data === "object" &&
  event.data !== null &&
  "type" in event.data;
