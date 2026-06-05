import type { Icon, Rect } from "@opentray/spec";

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
  windowApiEnabled: boolean;
  globalBindingsEnabled: boolean;
  globalBindingsSupported: boolean;
  screenApiEnabled: boolean;
  screenBindingsEnabled: boolean;
  screenBindingsSupported: boolean;
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

export interface OpenTrayWindowError {
  code: string;
  message: string;
}

export interface OpenTrayScreenApi {
  getScreenDetails(): Promise<LynxScreenDetails>;
}

export interface OpenTrayWindowApi {
  addEventListener(event: string, handler: (event: unknown) => void): void;
  close(): Promise<void>;
  getCapabilities(): Promise<LynxWindowCapabilities>;
  getIcon(): Promise<LynxWindowIcon | null>;
  getStyle(): Promise<LynxWindowStyle>;
  getTitle(): Promise<string>;
  invoke<Result = unknown>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<Result>;
  listen<EventPayload = unknown>(
    event: string,
    handler: (event: EventPayload) => void,
  ): Promise<() => Promise<void>>;
  move(x: number, y: number): Promise<unknown>;
  moveTo(x: number, y: number): Promise<unknown>;
  once<EventPayload = unknown>(
    event: string,
    handler: (event: EventPayload) => void,
  ): Promise<() => Promise<void>>;
  removeEventListener(event: string, handler: (event: unknown) => void): void;
  resize(width: number, height: number): Promise<unknown>;
  resizeTo(width: number, height: number): Promise<unknown>;
  setIcon(icon: LynxWindowIcon | null): Promise<LynxWindowIcon | null>;
  setStyle(style: Partial<LynxWindowStyle>): Promise<LynxWindowStyle>;
  setTitle(title: string): Promise<string>;
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
      nativeWindowApi: boolean;
    }
  | { type: "hidden" };
