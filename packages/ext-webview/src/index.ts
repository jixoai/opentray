// Orthogonal intents (2026-07-14; original user request: Chrome-PWA-like Windows overlay controls):
// 1. Expose typed WebView extension contracts, including Windows overlay-control colors and showInSwitchers.
// 2. Provide tray-scoped window handles and capability facades.
// 3. Re-export placement, responsive, style, and permission helpers.
// 4. Declare common chrome-derived user-resize intent without page-managed resize loops.
// Compromise: this established public entrypoint aggregates more than five API families; splitting
// it would be a separate package-surface change and is outside this repair.

import type {
  ExtensionEnvelope,
  Icon,
  Rect,
  TrayBoundsResult,
} from "@opentray/spec";
import type { TrayExtension, TrayExtensionContext, TrayHandle } from "opentray";
import type {
  WebviewBrowserPermissionFamily,
  WebviewBrowserPermissionPolicy,
  WebviewPermissionPromptDecision,
  WebviewPermissionManagerPolicy,
  WebviewPermissionRequest,
  WebviewPermissionSource,
  WebviewPermissionState,
  WebviewPermissionStore,
} from "./permission-store";
import { createAppScopedWebviewPermissionStore } from "./permission-store";

export * from "./permission-store";

export type WebviewWindowIcon = Icon | { type: "href"; href: string };
export type WebviewNativeApiSource =
  | "*"
  | "'none'"
  | "'local'"
  | "'remote'"
  | `http://${string}`
  | `https://${string}`;

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

export interface WebviewDownloadOptions {
  enabled?: boolean;
  saveAs?: boolean;
}

/** An opaque RGB color accepted by native Windows overlay caption controls. */
export type WebviewWindowControlsOverlayColor = `#${string}`;

/** Native caption-control colors for a Windows window-controls overlay. */
export interface WebviewWindowControlsOverlayOptions {
  /** Opaque `#RRGGBB` background for native minimize, maximize, and close controls. */
  backgroundColor?: WebviewWindowControlsOverlayColor;
  /** Opaque `#RRGGBB` symbol color for native minimize, maximize, and close controls. */
  symbolColor?: WebviewWindowControlsOverlayColor;
}

export type WebviewWindowControlsOverlay =
  | boolean
  | WebviewWindowControlsOverlayOptions;

export interface WebviewShowCommand {
  type: "show";
  html?: string;
  url?: string;
  width?: number;
  height?: number;
  fallbackRect?: Rect;
  nativeWindowApi?: boolean;
  bindWindowGlobals?: boolean;
  nativeScreenApi?: boolean;
  bindScreenGlobals?: boolean;
  nativeTrayApi?: boolean;
  windowControlsOverlay?: WebviewWindowControlsOverlay;
  title?: string;
  icon?: WebviewWindowIcon;
  style?: WebviewWindowStylePatch;
  titleSync?:
    | boolean
    | { documentToWindow?: boolean; windowToDocument?: boolean };
  iconSync?: boolean | { faviconToWindow?: boolean; windowToFavicon?: boolean };
  nativeApiPolicy?: WebviewNativeApiPolicy;
  browserPermissionPolicy?: WebviewBrowserPermissionPolicy;
  permissionManagerPolicy?: WebviewPermissionManagerPolicy;
  download?: WebviewDownloadOptions;
  devtools?: boolean;
}

export type WebviewWindowOptions = Omit<WebviewShowCommand, "type">;

export interface WebviewSetContentCommand {
  type: "setContent";
  html?: string;
  url?: string;
}

export type WebviewBackgroundEffectState =
  | "followsWindowActiveState"
  | "active"
  | "inactive";

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
  | {
      kind: "platformMaterial";
      material: string;
      state?: WebviewBackgroundEffectState;
    }
  | { kind: "semantic"; token: "blur"; state?: WebviewBackgroundEffectState };

export type WebviewWindowBackgroundInput =
  | WebviewBackgroundKeyword
  | WebviewWindowBackground;

export interface WebviewBackgroundOptions {
  state?: WebviewBackgroundEffectState;
}

export interface WebviewMacosWindowStyle {
  cornerRadius: number | null;
}

export type WebviewWindowsCornerPreference =
  | "default"
  | "doNotRound"
  | "round"
  | "roundSmall";

export interface WebviewWindowsWindowStyle {
  cornerPreference: WebviewWindowsCornerPreference | null;
  /** Whether the native window participates in the Windows taskbar and Alt+Tab switcher. */
  showInSwitchers: boolean;
}

export interface WebviewWindowPlatformStyle {
  macos?: WebviewMacosWindowStyle;
  windows?: WebviewWindowsWindowStyle;
  linux?: Record<string, never>;
}

export interface WebviewWindowStyle {
  frameless: boolean;
  /** Whether the operator can resize the native window with pointer input. */
  resizable: boolean;
  keepOnTop: boolean;
  opacity: number;
  background: WebviewWindowBackground;
  platform: WebviewWindowPlatformStyle;
}

export interface WebviewWindowStylePatch {
  frameless?: boolean;
  /** Explicitly overrides the chrome-derived user-resize default. */
  resizable?: boolean;
  keepOnTop?: boolean;
  opacity?: number;
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
  showInSwitchers: boolean;
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
  resizable: boolean;
  maximize: boolean;
  minimize: boolean;
  restore: boolean;
  windowState: boolean;
  overlay: boolean;
  appRegionDrag: boolean;
  frameless: boolean;
  keepOnTop: boolean;
  opacity: boolean;
  title: boolean;
  icon: boolean;
  devtools: boolean;
  devtoolsClosable: boolean;
  devtoolsStateQueryable: boolean;
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

export interface WebviewPermissionRuntimeOptions {
  store?: WebviewPermissionStore;
  prompt?: (
    request: WebviewPermissionRequest
  ) => Promise<WebviewPermissionPromptDecision>;
}

export type WebviewWindowStateKind = "normal" | "minimized" | "maximized";

export interface WebviewWindowState {
  state: WebviewWindowStateKind;
  minimized: boolean;
  maximized: boolean;
  visible: boolean;
}

export interface WebviewWindowInteractionChange {
  active: boolean;
}

export interface WebviewWindowFocusChange {}

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

export type WebviewWindowSizeConstraintValue = number | null;

export type WebviewExecCommand = "clearWhiteBlock" | (string & {});

export interface WebviewWindowSizeConstraintPatch {
  width?: WebviewWindowSizeConstraintValue;
  height?: WebviewWindowSizeConstraintValue;
}

export interface WebviewWindowOverlayGeometry {
  titlebarAreaRect: Rect;
}

export interface WebviewDownloadStarted {
  url: string;
  filename: string;
  suggestedFilename: string | null;
}

export interface WebviewDownloadProgress extends WebviewDownloadStarted {
  receivedBytes: number;
  totalBytes: number | null;
}

export interface WebviewDownloadCompleted extends WebviewDownloadStarted {
  success: boolean;
}

export interface WebviewWindowEventMap {
  closed: { visible: false };
  focus: WebviewWindowFocusChange;
  blur: WebviewWindowFocusChange;
  moved: WebviewWindowPositionChange;
  resized: WebviewWindowSizeChange;
  windowinteractionchange: WebviewWindowInteractionChange;
  stylechange: WebviewWindowStyle;
  titlechange: WebviewWindowTitleChange;
  iconchange: WebviewWindowIconChange;
  windowstatechange: WebviewWindowState;
  "overlay.geometrychange": WebviewWindowOverlayGeometry;
  downloadstarted: WebviewDownloadStarted;
  downloadprogress: WebviewDownloadProgress;
  downloadcompleted: WebviewDownloadCompleted;
  downloadfailed: WebviewDownloadStarted;
  downloadcanceled: WebviewDownloadStarted;
}

export interface WebviewWindowOverlay {
  readonly visible: boolean;
  getTitlebarAreaRect(): Promise<Rect>;
  listen(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void
  ): Promise<() => Promise<void>>;
  once(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void
  ): Promise<() => Promise<void>>;
  addEventListener(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void
  ): void;
  removeEventListener(
    event: "geometrychange",
    handler: (event: WebviewWindowOverlayGeometry) => void
  ): void;
}

export interface WebviewWindowDevtools {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): Promise<boolean>;
}

export interface WebviewNavigatorWindow {
  readonly overlay?: WebviewWindowOverlay;
  readonly devtools: WebviewWindowDevtools;
  invoke<TResponse = unknown>(
    cmd: string,
    payload?: unknown,
    options?: unknown
  ): Promise<TResponse>;
  close(): Promise<void>;
  show(): Promise<WebviewWindowState>;
  hide(): Promise<WebviewWindowState>;
  minimize(): Promise<WebviewWindowState>;
  maximize(): Promise<WebviewWindowState>;
  restore(): Promise<WebviewWindowState>;
  getWindowState(): Promise<WebviewWindowState>;
  isMaximized(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  moveTo(x: number, y: number): Promise<{ x: number; y: number }>;
  resizeTo(
    width: number,
    height: number
  ): Promise<{ width: number; height: number }>;
  getBounds(): Promise<Rect>;
  setMinimumWidth(width: WebviewWindowSizeConstraintValue): Promise<void>;
  setMinimumHeight(height: WebviewWindowSizeConstraintValue): Promise<void>;
  setMinimumSize(
    width?: WebviewWindowSizeConstraintValue,
    height?: WebviewWindowSizeConstraintValue
  ): Promise<void>;
  setMaximumWidth(width: WebviewWindowSizeConstraintValue): Promise<void>;
  setMaximumHeight(height: WebviewWindowSizeConstraintValue): Promise<void>;
  setMaximumSize(
    width?: WebviewWindowSizeConstraintValue,
    height?: WebviewWindowSizeConstraintValue
  ): Promise<void>;
  startAppRegionDrag(options?: {
    x?: number;
    y?: number;
    pointerId?: number;
  }): Promise<{ active: boolean }>;
  stopAppRegionDrag(): Promise<{ active: boolean }>;
  getStyle(): Promise<WebviewWindowStyle>;
  setStyle(style: WebviewWindowStylePatch): Promise<WebviewWindowStyle>;
  setBackground(
    background: WebviewWindowBackgroundInput,
    options?: WebviewBackgroundOptions
  ): Promise<WebviewWindowStyle>;
  getCapabilities(): Promise<WebviewWindowCapabilities>;
  getTitle(): Promise<string>;
  setTitle(title: string): Promise<string>;
  getIcon(): Promise<WebviewWindowIcon | null>;
  setIcon(icon: WebviewWindowIcon | null): Promise<WebviewWindowIcon | null>;
  listen<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void
  ): Promise<() => Promise<void>>;
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): Promise<() => Promise<void>>;
  once<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void
  ): Promise<() => Promise<void>>;
  once<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): Promise<() => Promise<void>>;
  addEventListener<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void
  ): void;
  addEventListener<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): void;
  removeEventListener<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void
  ): void;
  removeEventListener<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
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
  coordinateOrigin?: "topLeft" | "bottomLeft";
}

export interface WebviewNavigatorScreen {
  getScreenDetails(): Promise<WebviewScreenDetails>;
}

export interface WebviewNavigatorTray {
  getBounds(): Promise<TrayBoundsResult>;
}

export interface WebviewNavigatorPermissions {
  query(
    family: WebviewBrowserPermissionFamily
  ): Promise<WebviewPermissionState>;
  request(
    family: WebviewBrowserPermissionFamily
  ): Promise<WebviewPermissionState>;
  set(
    family: WebviewBrowserPermissionFamily,
    decision: "allow" | "deny"
  ): Promise<WebviewPermissionState>;
  clear(
    family: WebviewBrowserPermissionFamily
  ): Promise<WebviewPermissionState>;
}

export interface WebviewNavigatorNamespace {
  readonly window?: WebviewNavigatorWindow;
  readonly screen?: WebviewNavigatorScreen;
  readonly tray?: WebviewNavigatorTray;
  readonly ipc?: WebviewNavigatorIpc;
  readonly permissions?: WebviewNavigatorPermissions;
  execCommand(command: WebviewExecCommand): void;
}

export interface WebviewNavigatorIpc {
  postMessage(payload: unknown): Promise<{ queued: true }>;
}

export type WebviewCommand =
  | WebviewShowCommand
  | { type: "hide" }
  | { type: "destroy" }
  | WebviewSetContentCommand
  | { type: "navigate"; url: string }
  | { type: "evaluate"; js: string }
  | { type: "postMessage"; payload: unknown }
  | { type: "moveTo"; x: number; y: number }
  | { type: "resizeTo"; width: number; height: number }
  | { type: "getBounds" }
  | { type: "getScreenDetails" }
  | { type: "drainIpcMessages" }
  | { type: "drainPermissionMessages" }
  | {
      type: "resolvePermissionMessage";
      id: number;
      result: WebviewPermissionState;
    }
  | { type: "drainWindowEvents" }
  | { type: "openDevtools" }
  | { type: "closeDevtools" }
  | { type: "isDevtoolsOpen" }
  | { type: "setStyle"; style: WebviewWindowStylePatch }
  | {
      type: "setMinimumSize";
      width?: WebviewWindowSizeConstraintValue;
      height?: WebviewWindowSizeConstraintValue;
    }
  | {
      type: "setMaximumSize";
      width?: WebviewWindowSizeConstraintValue;
      height?: WebviewWindowSizeConstraintValue;
    };

export type WebviewEvent =
  | { type: "shown" }
  | { type: "hidden" }
  | ({ type: "moved" } & WebviewWindowPositionChange)
  | ({ type: "resized" } & WebviewWindowSizeChange)
  | { type: "ipcMessages"; messages: WebviewIpcMessage[] }
  | { type: "permissionMessages"; messages: WebviewPermissionIpcMessage[] }
  | { type: "permissionMessageResolved"; id: number }
  | { type: "windowEvents"; events: WebviewHostWindowEvent[] }
  | { type: "message"; payload: unknown }
  | { type: "positionFallback"; strategy: "cursor" | "platformDefault" };

export interface WebviewIpcMessage {
  id: number;
  source: "page" | "native";
  payload: unknown;
}

export interface WebviewPermissionIpcMessage {
  id: number;
  source: "page";
  action: "query" | "request" | "set" | "clear" | "list";
  sourceScope: WebviewPermissionSource;
  family?: WebviewBrowserPermissionFamily;
  decision?: "allow" | "deny";
  sourceAction?: string;
}

export type WebviewHostWindowEvent =
  | { type: "focus" }
  | { type: "blur" }
  | ({ type: "windowinteractionchange" } & WebviewWindowInteractionChange)
  | ({ type: string } & Record<string, unknown>);

export interface WebviewHandle {
  show(command: Extract<WebviewCommand, { type: "show" }>): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  setContent(
    command: Extract<WebviewCommand, { type: "setContent" }>
  ): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(js: string): Promise<void>;
  postMessage(payload: unknown): Promise<void>;
}

export interface WebviewWindowHandle {
  readonly devtools: WebviewWindowDevtools;
  show(command?: Partial<WebviewWindowOptions>): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  moveTo(x: number, y: number): Promise<void>;
  resizeTo(width: number, height: number): Promise<void>;
  getBounds(): Promise<Rect>;
  setMinimumWidth(width: WebviewWindowSizeConstraintValue): Promise<void>;
  setMinimumHeight(height: WebviewWindowSizeConstraintValue): Promise<void>;
  setMinimumSize(
    width?: WebviewWindowSizeConstraintValue,
    height?: WebviewWindowSizeConstraintValue
  ): Promise<void>;
  setMaximumWidth(width: WebviewWindowSizeConstraintValue): Promise<void>;
  setMaximumHeight(height: WebviewWindowSizeConstraintValue): Promise<void>;
  setMaximumSize(
    width?: WebviewWindowSizeConstraintValue,
    height?: WebviewWindowSizeConstraintValue
  ): Promise<void>;
  setStyle(style: WebviewWindowStylePatch): Promise<WebviewWindowStyle>;
  setBackground(
    background: WebviewWindowBackgroundInput,
    options?: WebviewBackgroundOptions
  ): Promise<WebviewWindowStyle>;
  listen<TEvent extends keyof WebviewWindowEventMap>(
    event: TEvent,
    handler: (event: WebviewWindowEvent<WebviewWindowEventMap[TEvent]>) => void
  ): () => void;
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): () => void;
  setContent(
    command: Extract<WebviewCommand, { type: "setContent" }>
  ): Promise<void>;
  navigate(url: string): Promise<void>;
  evaluate(js: string): Promise<void>;
  postMessage(payload: unknown): Promise<void>;
  drainIpcMessages(): Promise<WebviewIpcMessage[]>;
  drainPermissionMessages(): Promise<WebviewPermissionIpcMessage[]>;
  startPermissionManager(): () => void;
}

export interface WebviewTrayCapability {
  createWebviewWindow(options: WebviewWindowOptions): WebviewWindowHandle;
  createWebviewHandle(): WebviewHandle;
  getScreenDetails(): Promise<WebviewScreenDetails>;
}

export interface WebviewExtensionOptions {
  mountId?: string;
  path?: string;
  permissions?: WebviewPermissionRuntimeOptions;
}

export class WebviewExtensionLoadError extends Error {
  readonly code = "webview_extension_load_failed";
  readonly extensionName: string;
  readonly mountId: string;
  readonly cause: unknown;

  constructor(context: TrayExtensionContext, cause: unknown) {
    super(
      `WebView extension "${context.name}" could not be loaded for mount "${context.mountId}". Official @opentray/ext-webview native packages are published for macOS and Windows; Linux is unsupported for this extension. Provide a resolvable extension path only when testing a custom native runtime.`
    );
    this.name = "WebviewExtensionLoadError";
    this.extensionName = context.name;
    this.mountId = context.mountId;
    this.cause = cause;
  }
}

const WEBVIEW_EXTENSION_NAME = "webview";
const WEBVIEW_EXTENSION_PACKAGE = "@opentray/ext-webview";
const WINDOW_EVENT_POLL_INTERVAL_MS = 16;
const POLLED_WINDOW_EVENTS = new Set([
  "focus",
  "blur",
  "windowinteractionchange",
  "downloadstarted",
  "downloadprogress",
  "downloadcompleted",
  "downloadfailed",
  "downloadcanceled",
]);

export const WebviewExt = {
  name: WEBVIEW_EXTENSION_NAME,
  path: WEBVIEW_EXTENSION_PACKAGE,
  resolveMount(options) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.path === undefined ? {} : { path: options.path }),
    };
  },
  extend(tray, context, options) {
    const endpoint = createWebviewEndpoint(tray, context);
    return {
      getScreenDetails() {
        return endpoint.command<WebviewScreenDetails>({
          type: "getScreenDetails",
        } satisfies WebviewCommand);
      },
      createWebviewWindow(windowOptions) {
        return createWebviewWindowHandle(endpoint, windowOptions, {
          appId: context.appId,
          permissions: options?.permissions ?? {},
        });
      },
      createWebviewHandle() {
        return createLegacyWebviewHandle(endpoint);
      },
    };
  },
} satisfies TrayExtension<WebviewTrayCapability, WebviewExtensionOptions>;

export const attachWebview = (
  tray: TrayHandle,
  options?: WebviewExtensionOptions
): WebviewHandle => {
  return tray
    .extend(WebviewExt, {
      ...options,
      mountId: options?.mountId ?? WEBVIEW_EXTENSION_NAME,
    })
    .createWebviewHandle();
};

interface WebviewEndpoint {
  command<TResult = unknown>(command: WebviewCommand): Promise<TResult>;
  emit<TPayload = unknown>(
    event: string,
    payload: WebviewWindowEvent<TPayload>["payload"]
  ): void;
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): () => void;
}

type ExtensionEventSourceTray = TrayHandle & {
  listenExtension<TData = unknown>(
    ext: string,
    handler: (event: ExtensionEnvelope<TData>) => void
  ): () => void;
};

const createWebviewEndpoint = (
  tray: TrayHandle,
  context: TrayExtensionContext
): WebviewEndpoint => {
  const localListeners = new Map<
    string,
    Set<(event: WebviewWindowEvent<unknown>) => void>
  >();

  const emit = <TPayload = unknown>(
    event: string,
    payload: WebviewWindowEvent<TPayload>["payload"]
  ): void => {
    for (const handler of localListeners.get(event) ?? []) {
      handler({ event, id: 0, payload });
    }
  };

  const listenLocal = <TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): (() => void) => {
    const handlers = localListeners.get(event) ?? new Set();
    handlers.add(handler as (event: WebviewWindowEvent<unknown>) => void);
    localListeners.set(event, handlers);
    return () => {
      handlers.delete(handler as (event: WebviewWindowEvent<unknown>) => void);
      if (handlers.size === 0) {
        localListeners.delete(event);
      }
    };
  };

  return {
    async command<TResult = unknown>(
      command: WebviewCommand
    ): Promise<TResult> {
      try {
        await context.ensureLoaded();
      } catch (error) {
        throw new WebviewExtensionLoadError(context, error);
      }
      const events = await context.request(command);
      return events[0]?.data as TResult;
    },
    emit,
    listen<TPayload = unknown>(
      event: string,
      handler: (event: WebviewWindowEvent<TPayload>) => void
    ): () => void {
      const unlistenLocal = listenLocal(event, handler);
      if (!isExtensionEventSourceTray(tray)) {
        return unlistenLocal;
      }
      const unlistenExtension = tray.listenExtension(
        context.mountId,
        (envelope) => {
          const data = envelope.data;
          if (!isRecord(data) || data.type !== event) {
            return;
          }
          handler({
            event,
            id: 0,
            payload: eventPayload(data) as Parameters<
              typeof handler
            >[0]["payload"],
          });
        }
      );
      return () => {
        unlistenLocal();
        unlistenExtension();
      };
    },
  };
};

const createLegacyWebviewHandle = (endpoint: {
  command<TResult = unknown>(command: WebviewCommand): Promise<TResult>;
}): WebviewHandle => ({
  show(command) {
    return endpoint.command<void>(command);
  },
  hide() {
    return endpoint.command<void>({ type: "hide" } satisfies WebviewCommand);
  },
  destroy() {
    return endpoint.command<void>({ type: "destroy" } satisfies WebviewCommand);
  },
  setContent(command) {
    return endpoint.command<void>(command);
  },
  navigate(url) {
    return endpoint.command<void>({
      type: "navigate",
      url,
    } satisfies WebviewCommand);
  },
  evaluate(js) {
    return endpoint.command<void>({
      type: "evaluate",
      js,
    } satisfies WebviewCommand);
  },
  postMessage(payload) {
    return endpoint.command<void>({
      type: "postMessage",
      payload,
    } satisfies WebviewCommand);
  },
});

interface WebviewWindowRuntimeContext {
  appId: string;
  permissions: WebviewPermissionRuntimeOptions;
}

const createWebviewWindowHandle = (
  endpoint: WebviewEndpoint,
  options: WebviewWindowOptions,
  runtime: WebviewWindowRuntimeContext
): WebviewWindowHandle => {
  const permissions: WebviewPermissionRuntimeOptions = {
    store:
      runtime.permissions.store ??
      createAppScopedWebviewPermissionStore({ appId: runtime.appId }),
    ...(runtime.permissions.prompt === undefined
      ? {}
      : { prompt: runtime.permissions.prompt }),
  };
  let bootstrapped = false;
  const listenerCounts = new Map<string, number>();
  let windowEventPoll: ReturnType<typeof setInterval> | undefined;
  let permissionPoll: ReturnType<typeof setInterval> | undefined;

  const drainWindowEvents = async (): Promise<void> => {
    const response = await endpoint.command<
      Extract<WebviewEvent, { type: "windowEvents" }>
    >({
      type: "drainWindowEvents",
    } satisfies WebviewCommand);
    for (const event of response.events) {
      const { type, ...payload } = event;
      endpoint.emit(type, payload);
    }
  };

  const startWindowEventPoll = (): void => {
    if (windowEventPoll !== undefined) {
      return;
    }
    void drainWindowEvents().catch((error: unknown) => {
      console.error("WebView window event polling failed:", error);
    });
    windowEventPoll = setInterval(() => {
      void drainWindowEvents().catch((error: unknown) => {
        console.error("WebView window event polling failed:", error);
      });
    }, WINDOW_EVENT_POLL_INTERVAL_MS);
  };

  const stopWindowEventPollIfIdle = (): void => {
    if (windowEventPoll === undefined || listenerCounts.size > 0) {
      return;
    }
    clearInterval(windowEventPoll);
    windowEventPoll = undefined;
  };

  const drainPermissionMessages = async (): Promise<
    WebviewPermissionIpcMessage[]
  > => {
    const response = await endpoint.command<
      Extract<WebviewEvent, { type: "permissionMessages" }>
    >({
      type: "drainPermissionMessages",
    } satisfies WebviewCommand);
    return response.messages;
  };

  const resolvePermissionMessages = async (): Promise<void> => {
    const messages = await drainPermissionMessages();
    for (const message of messages) {
      const result = await resolvePermissionMessage(permissions, message);
      await endpoint.command<void>({
        type: "resolvePermissionMessage",
        id: message.id,
        result,
      } satisfies WebviewCommand);
    }
  };

  const startPermissionManager = (): (() => void) => {
    if (permissionPoll === undefined) {
      void resolvePermissionMessages().catch((error: unknown) => {
        console.error("WebView permission manager failed:", error);
      });
      permissionPoll = setInterval(() => {
        void resolvePermissionMessages().catch((error: unknown) => {
          console.error("WebView permission manager failed:", error);
        });
      }, WINDOW_EVENT_POLL_INTERVAL_MS);
    }
    return () => {
      if (permissionPoll === undefined) {
        return;
      }
      clearInterval(permissionPoll);
      permissionPoll = undefined;
    };
  };

  const trackWindowListener = (
    event: string,
    unlisten: () => void
  ): (() => void) => {
    if (POLLED_WINDOW_EVENTS.has(event)) {
      listenerCounts.set(event, (listenerCounts.get(event) ?? 0) + 1);
      startWindowEventPoll();
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      if (POLLED_WINDOW_EVENTS.has(event)) {
        const count = listenerCounts.get(event) ?? 0;
        if (count <= 1) {
          listenerCounts.delete(event);
        } else {
          listenerCounts.set(event, count - 1);
        }
      }
      unlisten();
      stopWindowEventPollIfIdle();
    };
  };

  return {
    devtools: {
      open() {
        return endpoint.command<void>({
          type: "openDevtools",
        } satisfies WebviewCommand);
      },
      close() {
        return endpoint.command<void>({
          type: "closeDevtools",
        } satisfies WebviewCommand);
      },
      isOpen() {
        return endpoint.command<boolean>({
          type: "isDevtoolsOpen",
        } satisfies WebviewCommand);
      },
    },
    async show(command = {}) {
      const showCommand = {
        type: "show",
        ...(bootstrapped ? {} : options),
        ...command,
      } satisfies WebviewCommand;
      await endpoint.command<void>(showCommand);
      bootstrapped = true;
    },
    hide() {
      return endpoint.command<void>({ type: "hide" } satisfies WebviewCommand);
    },
    async destroy() {
      await endpoint.command<void>({
        type: "destroy",
      } satisfies WebviewCommand);
      bootstrapped = false;
      if (permissionPoll !== undefined) {
        clearInterval(permissionPoll);
        permissionPoll = undefined;
      }
    },
    moveTo(x, y) {
      return endpoint.command<void>({
        type: "moveTo",
        x,
        y,
      } satisfies WebviewCommand);
    },
    resizeTo(width, height) {
      return endpoint.command<void>({
        type: "resizeTo",
        width,
        height,
      } satisfies WebviewCommand);
    },
    getBounds() {
      return endpoint.command<Rect>({
        type: "getBounds",
      } satisfies WebviewCommand);
    },
    setMinimumWidth(width) {
      return endpoint.command<void>({
        type: "setMinimumSize",
        width,
      } satisfies WebviewCommand);
    },
    setMinimumHeight(height) {
      return endpoint.command<void>({
        type: "setMinimumSize",
        height,
      } satisfies WebviewCommand);
    },
    setMinimumSize(width, height) {
      return endpoint.command<void>(
        createSizeConstraintCommand("setMinimumSize", width, height)
      );
    },
    setMaximumWidth(width) {
      return endpoint.command<void>({
        type: "setMaximumSize",
        width,
      } satisfies WebviewCommand);
    },
    setMaximumHeight(height) {
      return endpoint.command<void>({
        type: "setMaximumSize",
        height,
      } satisfies WebviewCommand);
    },
    setMaximumSize(width, height) {
      return endpoint.command<void>(
        createSizeConstraintCommand("setMaximumSize", width, height)
      );
    },
    setStyle(style) {
      return endpoint.command<WebviewWindowStyle>({
        type: "setStyle",
        style,
      } satisfies WebviewCommand);
    },
    setBackground(background, backgroundOptions) {
      return endpoint.command<WebviewWindowStyle>({
        type: "setStyle",
        style: {
          background: backgroundInputWithOptions(background, backgroundOptions),
        },
      } satisfies WebviewCommand);
    },
    listen<TPayload = unknown>(
      event: string,
      handler: (event: WebviewWindowEvent<TPayload>) => void
    ): () => void {
      return trackWindowListener(event, endpoint.listen(event, handler));
    },
    setContent(command) {
      return endpoint.command<void>(command);
    },
    navigate(url) {
      return endpoint.command<void>({
        type: "navigate",
        url,
      } satisfies WebviewCommand);
    },
    evaluate(js) {
      return endpoint.command<void>({
        type: "evaluate",
        js,
      } satisfies WebviewCommand);
    },
    postMessage(payload) {
      return endpoint.command<void>({
        type: "postMessage",
        payload,
      } satisfies WebviewCommand);
    },
    async drainIpcMessages() {
      const response = await endpoint.command<
        Extract<WebviewEvent, { type: "ipcMessages" }>
      >({
        type: "drainIpcMessages",
      } satisfies WebviewCommand);
      return response.messages;
    },
    drainPermissionMessages,
    startPermissionManager,
  };
};

const isExtensionEventSourceTray = (
  tray: TrayHandle
): tray is ExtensionEventSourceTray =>
  "listenExtension" in tray && typeof tray.listenExtension === "function";

const resolvePermissionMessage = async (
  permissions: WebviewPermissionRuntimeOptions,
  message: WebviewPermissionIpcMessage
): Promise<WebviewPermissionState> => {
  const store = permissions.store;
  const family = message.family;
  if (family === undefined) {
    return permissionState(message.sourceScope, "camera", "unsupported");
  }
  if (store === undefined) {
    return permissionState(message.sourceScope, family, "unsupported");
  }
  if (message.action === "clear") {
    await store.clear(message.sourceScope, family);
    return permissionState(message.sourceScope, family, "prompt");
  }
  if (message.action === "set") {
    if (message.decision === undefined) {
      return permissionState(message.sourceScope, family, "unsupported");
    }
    const record = await store.set({
      source: message.sourceScope,
      family,
      decision: message.decision,
      sourceAction: message.sourceAction ?? "opentrayPermissions.set",
    });
    return {
      source: message.sourceScope,
      family,
      decision: record.decision,
      durable: record,
    };
  }
  const durable = await store.get(message.sourceScope, family);
  if (durable !== undefined) {
    return {
      source: message.sourceScope,
      family,
      decision: durable.decision,
      durable,
    };
  }
  if (message.action === "request") {
    const prompt = permissions.prompt;
    if (prompt === undefined) {
      return permissionState(message.sourceScope, family, "unsupported");
    }
    const decision = await prompt({
      source: message.sourceScope,
      family,
      sourceAction: message.sourceAction ?? "opentrayPermissions.request",
    });
    if (decision === "allow" || decision === "deny") {
      const record = await store.set({
        source: message.sourceScope,
        family,
        decision,
        sourceAction: message.sourceAction ?? "opentrayPermissions.request",
      });
      return {
        source: message.sourceScope,
        family,
        decision,
        durable: record,
      };
    }
    return permissionState(message.sourceScope, family, decision);
  }
  return permissionState(message.sourceScope, family, "prompt");
};

const permissionState = (
  source: WebviewPermissionSource,
  family: WebviewBrowserPermissionFamily,
  decision: WebviewPermissionPromptDecision
): WebviewPermissionState => ({
  source,
  family,
  decision,
  ...(decision === "unsupported" ? { unsupported: true } : {}),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventPayload = (data: Record<string, unknown>): unknown => {
  if ("payload" in data) {
    return data.payload;
  }
  const { type: _type, ...payload } = data;
  return payload;
};

const createSizeConstraintCommand = (
  type: "setMinimumSize" | "setMaximumSize",
  width: WebviewWindowSizeConstraintValue | undefined,
  height: WebviewWindowSizeConstraintValue | undefined
): Extract<WebviewCommand, { type: "setMinimumSize" | "setMaximumSize" }> => ({
  type,
  ...(width === undefined ? {} : { width }),
  ...(height === undefined ? {} : { height }),
});

const backgroundInputWithOptions = (
  background: WebviewWindowBackgroundInput,
  options: WebviewBackgroundOptions | undefined
): WebviewWindowBackgroundInput => {
  if (options?.state === undefined || typeof background !== "string") {
    return background;
  }
  if (background === "blur") {
    return { kind: "semantic", token: "blur", state: options.state };
  }
  if (
    background === "mica" ||
    background === "acrylic" ||
    background === "tabbed" ||
    background === "auto"
  ) {
    return {
      kind: "platformMaterial",
      material: background,
      state: options.state,
    };
  }
  return background;
};

export const isWebviewEvent = (
  event: ExtensionEnvelope
): event is ExtensionEnvelope<WebviewEvent> =>
  event.scope.ext === "webview" &&
  typeof event.data === "object" &&
  event.data !== null &&
  "type" in event.data;

export {
  WebviewPlacementKit,
  type WebviewPlacement,
  type WebviewPlacementCursorAuthority,
  type WebviewPlacementKitDependencies,
  type WebviewPlacementOptions,
  type WebviewPlacementPoint,
  type WebviewPlacementResult,
  type WebviewPlacementResultKind,
  type WebviewPlacementScreenAuthority,
  type WebviewPlacementScreenDetail,
  type WebviewPlacementScreenDetails,
  type WebviewPlacementTarget,
  type WebviewPlacementTrayAuthority,
} from "./placement";

export {
  WINDOW_GEOMETRY_UNIT,
  windowGeometryKit,
  type WebviewWindowGeometryApplyOptions,
  type WebviewWindowGeometryCoordinateOrigin,
  type WebviewWindowGeometryPoint,
  type WebviewWindowGeometryScreenDetail,
  type WebviewWindowGeometryScreenDetails,
  type WebviewWindowGeometrySize,
  type WebviewWindowGeometryTarget,
} from "./window-geometry";

export {
  mediaQueryKit,
  styleKit,
  type WebviewMediaQuery,
  type WebviewMediaQueryCallback,
  type WebviewMediaQueryContext,
  type WebviewMediaQueryInput,
  type WebviewMediaQueryRule,
  type WebviewMediaQueryTarget,
  type WebviewMediaQueryWatch,
  type WebviewStyleKitTarget,
  type WebviewWindowStyleRecipe,
} from "./responsive";

declare global {
  interface Navigator {
    window?: WebviewNavigatorWindow;
    opentrayWindow?: WebviewNavigatorWindow;
    opentrayScreen?: WebviewNavigatorScreen;
    opentrayPermissions?: WebviewNavigatorPermissions;
    opentray?: WebviewNavigatorNamespace;
  }

  interface Screen {
    getScreenDetails?: WebviewNavigatorScreen["getScreenDetails"];
  }

  interface Window {
    getScreenDetails?: WebviewNavigatorScreen["getScreenDetails"];
  }
}
