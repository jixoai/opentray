import type { ExtensionEnvelope, Icon, Rect } from "@opentray/spec";
import type { TrayHandle } from "opentray";

export type WebviewWindowIcon = Icon | { type: "href"; href: string };
export type WebviewNativeApiSource = "*" | "'none'" | "'local'" | "'remote'" | `http://${string}` | `https://${string}`;

export interface WebviewNativeApiPolicy {
  defaultSrc?: WebviewNativeApiSource[];
  window?: WebviewNativeApiSource[];
  screen?: WebviewNativeApiSource[];
  tray?: WebviewNativeApiSource[];
  windowGlobals?: WebviewNativeApiSource[];
  screenGlobals?: WebviewNativeApiSource[];
  titleSync?: WebviewNativeApiSource[];
  iconSync?: WebviewNativeApiSource[];
}

export interface WebviewShowCommand {
  type: "show";
  html?: string;
  url?: string;
  width: number;
  height: number;
  fallbackRect?: Rect;
  nativeWindowApi?: boolean;
  bindWindowGlobals?: boolean;
  nativeScreenApi?: boolean;
  bindScreenGlobals?: boolean;
  nativeTrayApi?: boolean;
  windowControlsOverlay?: boolean;
  title?: string;
  icon?: WebviewWindowIcon;
  style?: Partial<WebviewWindowStyle>;
  titleSync?: boolean | { documentToWindow?: boolean; windowToDocument?: boolean };
  iconSync?: boolean | { faviconToWindow?: boolean; windowToFavicon?: boolean };
  nativeApiPolicy?: WebviewNativeApiPolicy;
}

export interface WebviewSetContentCommand {
  type: "setContent";
  html?: string;
  url?: string;
}

export type WebviewBackgroundEffectState = "followsWindowActiveState" | "active" | "inactive";

export interface WebviewWindowStyle {
  frameless: boolean;
  transparent: boolean;
  keepOnTop: boolean;
  backgroundEffect: string | null;
  backgroundEffectState: WebviewBackgroundEffectState;
  cornerRadius: number | null;
}

export interface WebviewWindowCapabilities {
  close: boolean;
  move: boolean;
  resize: boolean;
  maximize: boolean;
  minimize: boolean;
  restore: boolean;
  windowState: boolean;
  overlay: boolean;
  appRegionDrag: boolean;
  frameless: boolean;
  transparent: boolean;
  keepOnTop: boolean;
  cornerRadius: boolean;
  title: boolean;
  icon: boolean;
  screen: boolean;
  tray: boolean;
  backgroundEffects: string[];
  globalBindingsEnabled: boolean;
  globalBindingsSupported: boolean;
  screenBindingsEnabled: boolean;
  screenBindingsSupported: boolean;
  platform: string;
}

export type WebviewWindowStateKind = "normal" | "minimized" | "maximized";

export interface WebviewWindowState {
  state: WebviewWindowStateKind;
  minimized: boolean;
  maximized: boolean;
  visible: boolean;
}

export interface WebviewWindowEvent<TPayload = unknown> {
  event: string;
  id: number;
  payload: TPayload;
}

export interface WebviewWindowTitleChange {
  title: string;
}

export interface WebviewWindowIconChange {
  icon: WebviewWindowIcon | null;
}

export interface WebviewWindowPositionChange {
  x: number;
  y: number;
}

export interface WebviewWindowSizeChange {
  width: number;
  height: number;
}

export interface WebviewWindowOverlayGeometry {
  titlebarAreaRect: Rect;
}

export interface WebviewWindowEventMap {
  closed: { visible: false };
  moved: WebviewWindowPositionChange;
  resized: WebviewWindowSizeChange;
  stylechange: WebviewWindowStyle;
  titlechange: WebviewWindowTitleChange;
  iconchange: WebviewWindowIconChange;
  windowstatechange: WebviewWindowState;
  "overlay.geometrychange": WebviewWindowOverlayGeometry;
}

export interface WebviewWindowOverlay {
  readonly visible: boolean;
  getTitlebarAreaRect(): Promise<Rect>;
  listen(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void,
  ): Promise<() => Promise<void>>;
  once(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void,
  ): Promise<() => Promise<void>>;
  addEventListener(event: "geometrychange", handler: (event: WebviewWindowOverlayGeometry) => void): void;
  removeEventListener(event: "geometrychange", handler: (event: WebviewWindowOverlayGeometry) => void): void;
}

export interface WebviewNavigatorWindow {
  readonly overlay?: WebviewWindowOverlay;
  invoke<TResponse = unknown>(cmd: string, payload?: unknown, options?: unknown): Promise<TResponse>;
  close(): Promise<void>;
  minimize(): Promise<WebviewWindowState>;
  maximize(): Promise<WebviewWindowState>;
  restore(): Promise<WebviewWindowState>;
  getWindowState(): Promise<WebviewWindowState>;
  isMaximized(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  moveTo(x: number, y: number): Promise<{ x: number; y: number }>;
  resizeTo(width: number, height: number): Promise<{ width: number; height: number }>;
  startAppRegionDrag(options?: { x?: number; y?: number; pointerId?: number }): Promise<{ active: boolean }>;
  stopAppRegionDrag(): Promise<{ active: boolean }>;
  getStyle(): Promise<WebviewWindowStyle>;
  setStyle(style: Partial<WebviewWindowStyle>): Promise<WebviewWindowStyle>;
  getCapabilities(): Promise<WebviewWindowCapabilities>;
  getTitle(): Promise<string>;
  setTitle(title: string): Promise<string>;
  getIcon(): Promise<WebviewWindowIcon | null>;
  setIcon(icon: WebviewWindowIcon | null): Promise<WebviewWindowIcon | null>;
  listen<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void,
  ): Promise<() => Promise<void>>;
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void,
  ): Promise<() => Promise<void>>;
  once<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void,
  ): Promise<() => Promise<void>>;
  once<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void,
  ): Promise<() => Promise<void>>;
  addEventListener<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void,
  ): void;
  addEventListener<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void,
  ): void;
  removeEventListener<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void,
  ): void;
  removeEventListener<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void,
  ): void;
}

export interface WebviewScreenDetail {
  id: string;
  label: string;
  isPrimary: boolean;
  frame: Rect;
  visibleFrame: Rect;
  scaleFactor: number;
}

export interface WebviewScreenDetails {
  currentScreen: WebviewScreenDetail | null;
  screens: WebviewScreenDetail[];
  isExtended: boolean;
}

export interface WebviewNavigatorScreen {
  getScreenDetails(): Promise<WebviewScreenDetails>;
}

export interface WebviewNavigatorTray {
  getBounds(): Promise<Rect | null>;
}

export interface WebviewNavigatorNamespace {
  readonly window?: WebviewNavigatorWindow;
  readonly screen?: WebviewNavigatorScreen;
  readonly tray?: WebviewNavigatorTray;
}

export type WebviewCommand =
  | WebviewShowCommand
  | { type: "hide" }
  | { type: "destroy" }
  | WebviewSetContentCommand
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
  destroy(): Promise<void>;
  setContent(command: Extract<WebviewCommand, { type: "setContent" }>): Promise<void>;
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
  destroy() {
    return tray.commandExtension("webview", { type: "destroy" } satisfies WebviewCommand);
  },
  setContent(command) {
    return tray.commandExtension("webview", command);
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

declare global {
  interface Navigator {
    window?: WebviewNavigatorWindow;
    opentrayWindow?: WebviewNavigatorWindow;
    opentrayScreen?: WebviewNavigatorScreen;
    opentray?: WebviewNavigatorNamespace;
  }

  interface Screen {
    getScreenDetails?: WebviewNavigatorScreen["getScreenDetails"];
  }

  interface Window {
    getScreenDetails?: WebviewNavigatorScreen["getScreenDetails"];
  }
}
