import type { ExtensionEnvelope, Icon, Rect, TrayBoundsResult } from "@opentray/spec";
import type { TrayExtension, TrayExtensionContext, TrayHandle } from "opentray";

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
  style?: WebviewWindowStylePatch;
  titleSync?: boolean | { documentToWindow?: boolean; windowToDocument?: boolean };
  iconSync?: boolean | { faviconToWindow?: boolean; windowToFavicon?: boolean };
  nativeApiPolicy?: WebviewNativeApiPolicy;
}

export type WebviewWindowOptions = Omit<WebviewShowCommand, "type">;

export interface WebviewSetContentCommand {
  type: "setContent";
  html?: string;
  url?: string;
}

export type WebviewBackgroundEffectState = "followsWindowActiveState" | "active" | "inactive";

export type WebviewBackgroundKeyword =
  | "default"
  | "opaque"
  | "transparent"
  | "blur"
  | "auto"
  | "mica"
  | "acrylic"
  | "tabbed"
  | "appearanceBased"
  | "sidebar"
  | "hudWindow"
  | "windowBackground"
  | "contentBackground"
  | "underWindowBackground";

export type WebviewWindowBackground =
  | { kind: "opaque" }
  | { kind: "transparent" }
  | { kind: "platformMaterial"; material: string; state?: WebviewBackgroundEffectState }
  | { kind: "semantic"; token: "blur"; state?: WebviewBackgroundEffectState };

export type WebviewWindowBackgroundInput = WebviewBackgroundKeyword | WebviewWindowBackground;

export interface WebviewBackgroundOptions {
  state?: WebviewBackgroundEffectState;
}

export interface WebviewMacosWindowStyle {
  cornerRadius: number | null;
}

export type WebviewWindowsCornerPreference = "default" | "doNotRound" | "round" | "roundSmall";

export interface WebviewWindowsWindowStyle {
  cornerPreference: WebviewWindowsCornerPreference | null;
}

export interface WebviewWindowPlatformStyle {
  macos?: WebviewMacosWindowStyle;
  windows?: WebviewWindowsWindowStyle;
  linux?: Record<string, never>;
}

export interface WebviewWindowStyle {
  frameless: boolean;
  keepOnTop: boolean;
  background: WebviewWindowBackground;
  platform: WebviewWindowPlatformStyle;
}

export interface WebviewWindowStylePatch {
  frameless?: boolean;
  keepOnTop?: boolean;
  background?: WebviewWindowBackgroundInput;
  platform?: {
    macos?: Partial<WebviewMacosWindowStyle>;
    windows?: Partial<WebviewWindowsWindowStyle>;
    linux?: Record<string, never>;
  };
}

export interface WebviewMacosWindowCapabilities {
  backgroundMaterials: string[];
  semanticBackgrounds: string[];
  backgroundStates: WebviewBackgroundEffectState[];
  cornerRadius: boolean;
}

export interface WebviewWindowsWindowCapabilities {
  backgroundMaterials: string[];
  semanticBackgrounds: string[];
  backgroundStates: WebviewBackgroundEffectState[];
  cornerPreference: boolean;
}

export interface WebviewLinuxWindowCapabilities {
  trayPlacementProbes: string[];
}

export interface WebviewWindowPlatformCapabilities {
  macos?: WebviewMacosWindowCapabilities;
  windows?: WebviewWindowsWindowCapabilities;
  linux?: WebviewLinuxWindowCapabilities;
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
  keepOnTop: boolean;
  title: boolean;
  icon: boolean;
  screen: boolean;
  tray: boolean;
  globalBindingsEnabled: boolean;
  globalBindingsSupported: boolean;
  screenBindingsEnabled: boolean;
  screenBindingsSupported: boolean;
  platform: string;
  background: boolean;
  platformCapabilities: WebviewWindowPlatformCapabilities;
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
  setStyle(style: WebviewWindowStylePatch): Promise<WebviewWindowStyle>;
  setBackground(
    background: WebviewWindowBackgroundInput,
    options?: WebviewBackgroundOptions,
  ): Promise<WebviewWindowStyle>;
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
  getBounds(): Promise<TrayBoundsResult>;
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

export interface WebviewWindowHandle {
  show(command?: Partial<WebviewWindowOptions>): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  setContent(command: Extract<WebviewCommand, { type: "setContent" }>): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(js: string): Promise<void>;
  postMessage(payload: unknown): Promise<void>;
}

export interface WebviewTrayCapability {
  createWebviewWindow(options: WebviewWindowOptions): WebviewWindowHandle;
  createWebviewHandle(): WebviewHandle;
}

export interface WebviewExtensionOptions {
  mountId?: string;
  path?: string;
}

export class WebviewExtensionLoadError extends Error {
  readonly code = "webview_extension_load_failed";
  readonly extensionName: string;
  readonly mountId: string;
  readonly cause: unknown;

  constructor(context: TrayExtensionContext, cause: unknown) {
    super(
      `WebView extension "${context.name}" could not be loaded for mount "${context.mountId}". Install the matching @opentray/ext-webview platform package or provide a resolvable extension path.`,
    );
    this.name = "WebviewExtensionLoadError";
    this.extensionName = context.name;
    this.mountId = context.mountId;
    this.cause = cause;
  }
}

const WEBVIEW_EXTENSION_NAME = "webview";
const WEBVIEW_EXTENSION_PACKAGE = "@opentray/ext-webview";

export const WebviewExt = {
  name: WEBVIEW_EXTENSION_NAME,
  path: WEBVIEW_EXTENSION_PACKAGE,
  resolveMount(options) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.path === undefined ? {} : { path: options.path }),
    };
  },
  extend(tray, context) {
    const endpoint = createWebviewEndpoint(tray, context);
    return {
      createWebviewWindow(options) {
        return createWebviewWindowHandle(endpoint, options);
      },
      createWebviewHandle() {
        return createLegacyWebviewHandle(endpoint);
      },
    };
  },
} satisfies TrayExtension<WebviewTrayCapability, WebviewExtensionOptions>;

export const attachWebview = (tray: TrayHandle, options?: WebviewExtensionOptions): WebviewHandle => {
  return tray
    .extend(WebviewExt, {
      ...options,
      mountId: options?.mountId ?? WEBVIEW_EXTENSION_NAME,
    })
    .createWebviewHandle();
};

const createWebviewEndpoint = (
  tray: TrayHandle,
  context: TrayExtensionContext,
): { command(command: WebviewCommand): Promise<void> } => ({
  async command(command) {
    try {
      await context.ensureLoaded();
    } catch (error) {
      throw new WebviewExtensionLoadError(context, error);
    }
    await tray.commandExtension(context.mountId, command);
  },
});

const createLegacyWebviewHandle = (endpoint: {
  command(command: WebviewCommand): Promise<void>;
}): WebviewHandle => ({
  show(command) {
    return endpoint.command(command);
  },
  hide() {
    return endpoint.command({ type: "hide" } satisfies WebviewCommand);
  },
  destroy() {
    return endpoint.command({ type: "destroy" } satisfies WebviewCommand);
  },
  setContent(command) {
    return endpoint.command(command);
  },
  navigate(url) {
    return endpoint.command({ type: "navigate", url } satisfies WebviewCommand);
  },
  evaluate(js) {
    return endpoint.command({ type: "evaluate", js } satisfies WebviewCommand);
  },
  postMessage(payload) {
    return endpoint.command({ type: "postMessage", payload } satisfies WebviewCommand);
  },
});

const createWebviewWindowHandle = (
  endpoint: { command(command: WebviewCommand): Promise<void> },
  options: WebviewWindowOptions,
): WebviewWindowHandle => ({
  show(command = {}) {
    return endpoint.command({ type: "show", ...options, ...command });
  },
  hide() {
    return endpoint.command({ type: "hide" } satisfies WebviewCommand);
  },
  destroy() {
    return endpoint.command({ type: "destroy" } satisfies WebviewCommand);
  },
  setContent(command) {
    return endpoint.command(command);
  },
  navigate(url) {
    return endpoint.command({ type: "navigate", url } satisfies WebviewCommand);
  },
  evaluate(js) {
    return endpoint.command({ type: "evaluate", js } satisfies WebviewCommand);
  },
  postMessage(payload) {
    return endpoint.command({ type: "postMessage", payload } satisfies WebviewCommand);
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
