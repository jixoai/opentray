import type { ExtensionEnvelope } from "@opentray/spec";
import type { TrayHandle } from "opentray";

export interface LynxWindowStyle {
  frameless: boolean;
  transparent: boolean;
  backgroundEffect: string | null;
}

export interface LynxWindowCapabilities {
  close: boolean;
  move: boolean;
  resize: boolean;
  frameless: boolean;
  transparent: boolean;
  backgroundEffects: string[];
  globalBindingsEnabled: boolean;
  globalBindingsSupported: boolean;
  fitContentSize: boolean;
  platform: string;
}

export interface LynxShowCommand {
  type: "show";
  bundlePath: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  fitContentSize?: boolean;
  nativeWindowApi?: boolean;
  bindWindowGlobals?: boolean;
  style?: Partial<Pick<LynxWindowStyle, "frameless">>;
}

export type LynxCommand = LynxShowCommand | { type: "hide" };

export type LynxEvent =
  | {
      type: "shown";
      bundlePath: string;
      launchUrl: string;
      pid: number;
      runtimeZip: string;
      fitContentSize: boolean;
      nativeWindowApi: boolean;
    }
  | { type: "hidden" };

export interface LynxHandle {
  show(command: LynxShowCommand): Promise<void>;
  hide(): Promise<void>;
}

export const attachLynx = (tray: TrayHandle): LynxHandle => ({
  show(command) {
    return tray.commandExtension("lynx", command);
  },
  hide() {
    return tray.commandExtension("lynx", { type: "hide" } satisfies LynxCommand);
  },
});

export const isLynxEvent = (event: ExtensionEnvelope): event is ExtensionEnvelope<LynxEvent> =>
  event.scope.ext === "lynx" &&
  typeof event.data === "object" &&
  event.data !== null &&
  "type" in event.data;
