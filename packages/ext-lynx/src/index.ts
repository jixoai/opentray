import type { ExtensionEnvelope, Icon, Rect } from "@opentray/spec";
import type { TrayHandle } from "opentray";

export type LynxWindowIcon = Icon | { type: "href"; href: string };

export interface LynxWindowStyle {
  frameless: boolean;
  transparent: boolean;
  backgroundEffect: string | null;
}

export interface LynxWindowCapabilities {
  close: boolean;
  move: boolean;
  resize: boolean;
  title: boolean;
  icon: boolean;
  screen: boolean;
  frameless: boolean;
  transparent: boolean;
  backgroundEffects: string[];
  globalBindingsEnabled: boolean;
  globalBindingsSupported: boolean;
  screenBindingsEnabled: boolean;
  screenBindingsSupported: boolean;
  fitContentSize: boolean;
  platform: string;
}

export interface LynxScreenDetail {
  id: string;
  label: string;
  isPrimary: boolean;
  frame: Rect;
  visibleFrame: Rect;
  scaleFactor: number;
}

export interface LynxScreenDetails {
  currentScreen: LynxScreenDetail | null;
  screens: LynxScreenDetail[];
  isExtended: boolean;
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
  nativeScreenApi?: boolean;
  bindScreenGlobals?: boolean;
  title?: string;
  icon?: LynxWindowIcon;
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
