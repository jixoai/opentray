import type { ExtensionEnvelope } from "@opentray/spec";
import type { TrayHandle } from "opentray";

export interface LynxShowCommand {
  type: "show";
  bundlePath: string;
}

export type LynxCommand = LynxShowCommand | { type: "hide" };

export type LynxEvent =
  | {
      type: "shown";
      bundlePath: string;
      launchUrl: string;
      pid: number;
      runtimeZip: string;
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
