import type { ExtensionEnvelope } from "@opentray/spec";
import type { NativeExtensionArtifact, TrayHandle } from "opentray";

import { LYNX_NATIVE_ARTIFACT } from "./native-artifact";
import type { LynxCommand, LynxEvent, LynxShowCommand } from "./shared";

export type * from "./shared";

export interface LynxHandle {
  show(command: LynxShowCommand): Promise<void>;
  hide(): Promise<void>;
}

export interface LynxExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
}

export const LynxExt = {
  name: "lynx",
  artifact: LYNX_NATIVE_ARTIFACT,
  resolveMount(options: LynxExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(tray: TrayHandle, context): LynxHandle {
    return {
      async show(command) {
        await context.ensureLoaded();
        await tray.commandExtension(context.mountId, command);
      },
      async hide() {
        await context.ensureLoaded();
        await tray.commandExtension(
          context.mountId,
          { type: "hide" } satisfies LynxCommand
        );
      },
    };
  },
} satisfies import("opentray").TrayExtension<LynxHandle, LynxExtensionOptions>;

export const attachLynx = (
  tray: TrayHandle,
  options?: LynxExtensionOptions
): LynxHandle => tray.extend(LynxExt, options);

export const isLynxEvent = (event: ExtensionEnvelope): event is ExtensionEnvelope<LynxEvent> =>
  event.scope.ext === "lynx" &&
  typeof event.data === "object" &&
  event.data !== null &&
  "type" in event.data;
