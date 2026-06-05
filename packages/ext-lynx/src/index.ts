import type { ExtensionEnvelope } from "@opentray/spec";
import type { TrayHandle } from "opentray";

import type { LynxCommand, LynxEvent, LynxShowCommand } from "./shared";

export type * from "./shared";

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
