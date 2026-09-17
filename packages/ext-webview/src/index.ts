// Orthogonal intents (2026-07-21; original user request: Chrome-PWA-like Windows overlay controls
// and a running app-mode Dock click that restores the latest retained window):
// 1. Expose typed WebView extension contracts, including Windows overlay-control colors and appMode.
// 2. Provide tray-scoped window handles and capability facades.
// 3. Re-export placement, responsive, style, and permission helpers.
// 4. Declare common chrome-derived resize and native blur auto-hide intent.
// 5. Keep host-side native event polling single-flight and terminal after transport failure.
// Compromise: this established public entrypoint aggregates more than five API families; splitting
// it would be a separate package-surface change and is outside this repair.

import type {
  ExtensionEnvelope,
  Icon,
  Rect,
  TrayBoundsResult,
} from "@opentray/spec";
import type {
  NativeExtensionArtifact,
  TrayExtension,
  TrayExtensionContext,
  TrayHandle,
} from "opentray";
import {
  getAppReopenCoordinator,
  type AppReopenCoordinator,
} from "./app-reopen";
import { WEBVIEW_NATIVE_ARTIFACT } from "./native-artifact";
import {
  DEFAULT_WEBVIEW_WINDOW_ID,
  createWebviewOrchestration,
  type ChannelEndpoint,
  type ChannelEndpointCloseNotice,
  type WebviewChannelCreatedNotice,
  type WebviewChildHandle,
  type WebviewChildSpec,
  type WebviewFocusedPush,
  type WebviewGeometryChangePush,
  type WebviewLayoutTreeInput,
  type WebviewOrchestrationPort,
  type WebviewTitleChangePush,
  type WebviewUrlChangePush,
} from "./orchestration";
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
import {
  type ChannelCloseReason,
  type ChannelId,
  type ChannelListEntry,
  type ViewId,
  type WebviewListEntry,
  type WebviewLayoutNodePatch,
} from "@opentray/spec";
import { createAppScopedWebviewPermissionStore } from "./permission-store";

export * from "./orchestration";
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
  /**
   * Owning broker session identity (D18 owner tuple), extracted by the
   * facade from the connection's Ready frame. Omitted by legacy transports;
   * the native side keeps the transitional unattributed cleanup rule for
   * those clients.
   */
  sessionId?: string;
  /** Window-session id to bind (the native default is `default`). */
  windowId?: string;
  /** Create the window session without a primary webview; orchestration
   *  `create-webview` commands populate it (3.3 friction #2). */
  windowOnly?: boolean;
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

/**
 * Facade-only orchestration declarations on `createWebviewWindow`: the
 * children to create after a `windowOnly` bootstrap show, and an optional
 * first layout document to commit after them. They never reach the wire
 * inside the `show` frame itself.
 */
export interface WebviewWindowOrchestrationOptions {
  webviews?: readonly WebviewChildSpec[];
  layout?: WebviewLayoutTreeInput;
}

export type WebviewWindowOptions = Omit<WebviewShowCommand, "type"> &
  WebviewWindowOrchestrationOptions;

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
}

export interface WebviewWindowPlatformStyle {
  macos?: WebviewMacosWindowStyle;
  windows?: WebviewWindowsWindowStyle;
  linux?: Record<string, never>;
}

export interface WebviewWindowStyle {
  /** Whether the window behaves as a normal application surface in the platform Shell. */
  appMode: boolean;
  frameless: boolean;
  /** Whether the operator can resize the native window with pointer input. */
  resizable: boolean;
  keepOnTop: boolean;
  /** Hide the retained tray surface after native focus loss unless it is kept on top. */
  autoHide: boolean;
  opacity: number;
  background: WebviewWindowBackground;
  platform: WebviewWindowPlatformStyle;
}

export interface WebviewWindowStylePatch {
  appMode?: boolean;
  frameless?: boolean;
  /** Explicitly overrides the chrome-derived user-resize default. */
  resizable?: boolean;
  keepOnTop?: boolean;
  /** Defaults to true; keepOnTop suppresses native auto-hide without changing this value. */
  autoHide?: boolean;
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
  focus: boolean;
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
  appMode: boolean;
  keepOnTop: boolean;
  autoHide: boolean;
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
  /** True only when the session is neither closed/hidden nor minimized. */
  visible: boolean;
}

export interface WebviewWindowVisibilityChange {
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
  visibleChange: WebviewWindowVisibilityChange;
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
  isClosed(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  toVisible(): Promise<void>;
  focus(): Promise<void>;
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
  | { type: "close" }
  | { type: "destroy" }
  | WebviewSetContentCommand
  | { type: "navigate"; url: string }
  | { type: "evaluate"; js: string }
  | { type: "postMessage"; payload: unknown }
  | { type: "moveTo"; x: number; y: number }
  | { type: "resizeTo"; width: number; height: number }
  | { type: "isClosed" }
  | { type: "isVisible" }
  | { type: "toVisible" }
  | { type: "focus" }
  | { type: "getBounds" }
  | { type: "getScreenDetails" }
  | { type: "drainIpcMessages" }
  | { type: "drainPermissionMessages" }
  | {
      type: "resolvePermissionMessage";
      id: number;
      result: WebviewPermissionState;
    }
  | { type: "subscribeWindowEvents"; events: string[] }
  | { type: "unsubscribeWindowEvents"; events: string[] }
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
  /** Window-session id this handle addresses (the native default `default`). */
  readonly windowId: string;
  show(command?: Partial<WebviewWindowOptions>): Promise<void>;
  /**
   * Projects a new window title through the compatible re-show update path
   * (`apply_reused_show_updates`): no dedicated set-title wire command
   * exists in the v1 frozen surface. The command-app service-window
   * `(detached)` marker is the canonical consumer.
   */
  setTitle(title: string): Promise<string>;
  hide(): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
  isClosed(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  toVisible(): Promise<void>;
  focus(): Promise<void>;
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
  // Multi-webview orchestration surface (add-webview-orchestration 2.4).
  createWebview(spec: WebviewChildSpec): Promise<WebviewChildHandle>;
  destroyWebview(webviewId: string): Promise<void>;
  listWebviews(): Promise<WebviewListEntry[]>;
  setLayout(tree: WebviewLayoutTreeInput): Promise<void>;
  readonly layout: {
    update(viewId: ViewId, patch: WebviewLayoutNodePatch): Promise<void>;
  };
  createMessageChannel(options: { target: string }): Promise<ChannelEndpoint>;
  listMessageChannels(): Promise<ChannelListEntry[]>;
  destroyMessageChannel(channelId: ChannelId): Promise<void>;
  onCreatedMessageChannel(
    handler: (notice: WebviewChannelCreatedNotice) => void
  ): () => void;
  /**
   * Terminal broker-connection-death state (D3,
   * harden-lifecycle-ownership): true once the connection died. Listener and
   * channel delivery has stopped, every later command/query rejects instead
   * of hanging, and best-effort failures are absorbed into the orchestration's
   * dead state.
   */
  readonly connectionDead: boolean;
  /** Terminal death notification; fires exactly once. */
  onConnectionDead(handler: (error: Error) => void): () => void;
}

export interface WebviewTrayCapability {
  createWebviewWindow(options: WebviewWindowOptions): WebviewWindowHandle;
  createWebviewHandle(): WebviewHandle;
  getScreenDetails(): Promise<WebviewScreenDetails>;
}

export interface WebviewExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  permissions?: WebviewPermissionRuntimeOptions;
}

export class WebviewExtensionLoadError extends Error {
  readonly code = "webview_extension_load_failed";
  readonly extensionName: string;
  readonly mountId: string;
  readonly cause: unknown;

  constructor(context: TrayExtensionContext, cause: unknown) {
    super(
      `WebView extension "${context.name}" could not be loaded for mount "${context.mountId}". Official @opentray/ext-webview native packages are published for macOS and Windows; Linux is unsupported for this extension. Provide an exact file artifact only when testing a custom native runtime.`
    );
    this.name = "WebviewExtensionLoadError";
    this.extensionName = context.name;
    this.mountId = context.mountId;
    this.cause = cause;
  }
}

const WEBVIEW_EXTENSION_NAME = "webview";
/** Permission-manager drain cadence. This 16 ms interval is deliberately
 * preserved: permission resolution is a separate request/reply mechanism
 * (design-reference D19 open-question ruling 8), not part of the retired
 * window-event polling family. */
const PERMISSION_POLL_INTERVAL_MS = 16;
/**
 * Frozen window-event push family (D19 batch C, contract-3): every member
 * the retired 16 ms `drainWindowEvents` poll could deliver. Producers push
 * through the EventPort in the same `{ type, ...payload }` wire shape, and
 * `listen()` interest drives native `subscribeWindowEvents` /
 * `unsubscribeWindowEvents` — no facade listener means no native observation
 * record. The list mirrors the native `WINDOW_EVENT_FAMILY` constant; both
 * change together under one contract fingerprint.
 */
const WINDOW_PUSH_EVENT_FAMILY = new Set([
  "focus",
  "blur",
  "visibleChange",
  "closed",
  "stylechange",
  "windowinteractionchange",
  "downloadstarted",
  "downloadprogress",
  "downloadcompleted",
  "downloadfailed",
  "downloadcanceled",
]);

export const WebviewExt = {
  name: WEBVIEW_EXTENSION_NAME,
  artifact: WEBVIEW_NATIVE_ARTIFACT,
  resolveMount(options) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(tray, context, options) {
    const endpoint = createWebviewEndpoint(tray, context);
    const appReopenEventSource = isAppReopenEventSourceTray(tray)
      ? tray
      : undefined;
    const appReopen = appReopenEventSource
      ? getAppReopenCoordinator(context.appId)
      : undefined;
    if (appReopen !== undefined && appReopenEventSource !== undefined) {
      appReopenEventSource.onAppReopenRequested(() => {
        void appReopen.reopen().catch((error: unknown) => {
          console.error("OpenTray WebView app reopen failed:", error);
        });
      });
    }
    return {
      getScreenDetails() {
        return endpoint.command<WebviewScreenDetails>({
          type: "getScreenDetails",
        } satisfies WebviewCommand);
      },
      createWebviewWindow(windowOptions) {
        return createWebviewWindowHandle(endpoint, windowOptions, {
          appId: context.appId,
          trayId: context.trayId,
          ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
          permissions: options?.permissions ?? {},
          ...(appReopen === undefined ? {} : { appReopen }),
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
  listen<TPayload = unknown>(
    event: string,
    handler: (event: WebviewWindowEvent<TPayload>) => void
  ): () => void;
  /**
   * Raw ext-command request resolving every response envelope (the first is
   * the command result; the broker mirrors the tray-scoped trailing pushes
   * into `ext-event` frames, which `onFrame` observes).
   */
  requestEnvelopes(data: unknown): Promise<ExtensionEnvelope[]>;
  /**
   * Taps every frame the mount pushes through `ext-event` mirrors. Returns
   * a no-op unlisten on non-eventful trays; pure pushes then stay
   * unobservable, matching the connection capabilities the caller supplied.
   */
  onFrame(handler: (frame: unknown) => void): () => void;
  /**
   * Terminal broker-connection-death tap (D3): no-op when the hosting tray
   * does not publish one, matching the other structural capability taps.
   */
  onConnectionDead(handler: (error: Error) => void): () => void;
}

type ExtensionEventSourceTray = TrayHandle & {
  listenExtension<TData = unknown>(
    ext: string,
    handler: (event: ExtensionEnvelope<TData>) => void
  ): () => void;
};

type AppReopenEventSourceTray = TrayHandle & {
  onAppReopenRequested(handler: () => void): () => void;
};

type ConnectionDeadEventSourceTray = TrayHandle & {
  onConnectionDead(handler: (error: Error) => void): () => void;
};

const isConnectionDeadEventSourceTray = (
  tray: TrayHandle
): tray is ConnectionDeadEventSourceTray =>
  "onConnectionDead" in tray && typeof tray.onConnectionDead === "function";

const createWebviewEndpoint = (
  tray: TrayHandle,
  context: TrayExtensionContext
): WebviewEndpoint => {
  return {
    async command<TResult = unknown>(
      command: WebviewCommand
    ): Promise<TResult> {
      try {
        await context.ensureLoaded();
      } catch (error) {
        throw new WebviewExtensionLoadError(context, error);
      }
      const result = await context.request(command);
      // WebView commands are immediate (V1 command surface): a deferred
      // terminal for this extension is a contract violation, not a value.
      if (result.kind !== "immediate") {
        throw new Error(
          `webview command ${command.type} settled with an unexpected deferred terminal`
        );
      }
      return result.events[0]?.data as TResult;
    },
    async requestEnvelopes(data: unknown): Promise<ExtensionEnvelope[]> {
      try {
        await context.ensureLoaded();
      } catch (error) {
        throw new WebviewExtensionLoadError(context, error);
      }
      const result = await context.request(data);
      if (result.kind !== "immediate") {
        throw new Error(
          "webview extension commands are immediate; a deferred terminal is unexpected"
        );
      }
      return result.events;
    },
    onFrame(handler: (frame: unknown) => void): () => void {
      if (!isExtensionEventSourceTray(tray)) {
        return () => {};
      }
      return tray.listenExtension(context.mountId, (envelope) => {
        handler(envelope.data);
      });
    },
    onConnectionDead(handler: (error: Error) => void): () => void {
      if (!isConnectionDeadEventSourceTray(tray)) {
        return () => {};
      }
      return tray.onConnectionDead(handler);
    },
    // D19 batch C: delivery is push-only — window events arrive as
    // ext-event frames matched on `data.type`; the retired drain's local
    // fan-out is gone with the poll.
    listen<TPayload = unknown>(
      event: string,
      handler: (event: WebviewWindowEvent<TPayload>) => void
    ): () => void {
      if (!isExtensionEventSourceTray(tray)) {
        return () => {};
      }
      return tray.listenExtension(context.mountId, (envelope) => {
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
      });
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
  trayId: string;
  /**
   * Broker session identity from the connection's Ready frame (3.3 friction
   * #1): rides the `show` data and every orchestration/channel owner tuple.
   * Undefined on transports that do not publish one (legacy attribution).
   */
  sessionId?: string;
  permissions: WebviewPermissionRuntimeOptions;
  appReopen?: AppReopenCoordinator;
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
  // Facade-only orchestration declarations never ride the `show` frame.
  const {
    webviews: declaredWebviews,
    layout: declaredLayout,
    ...wireOptions
  } = options;
  const orchestrationPort: WebviewOrchestrationPort = {
    owner: {
      appId: runtime.appId,
      trayId: runtime.trayId,
      sessionId: runtime.sessionId ?? "",
    },
    async request(data) {
      const envelopes = await endpoint.requestEnvelopes(data);
      const first = envelopes[0]?.data;
      if (first === undefined) {
        throw new Error("webview extension returned an empty response");
      }
      return first;
    },
    onFrame: (handler) => endpoint.onFrame(handler),
    onDead: (handler) => endpoint.onConnectionDead(handler),
  };
  const orchestrationWindowId = options.windowId ?? DEFAULT_WEBVIEW_WINDOW_ID;
  const orchestration = createWebviewOrchestration(orchestrationPort, orchestrationWindowId);
  let bootstrapped = false;
  const listenerCounts = new Map<string, number>();
  let permissionPoll: ReturnType<typeof setInterval> | undefined;
  const appReopenRegistration = runtime.appReopen?.register({
    toVisible() {
      return endpoint.command<void>({ type: "toVisible" });
    },
    focus() {
      return endpoint.command<void>({ type: "focus" });
    },
  });
  let stopAppReopenActivityTracking: (() => void) | undefined;

  // D19 batch C: the window-event family is push-only (contract-3). The
  // facade declares listener interest through the subscription commands;
  // producers then submit through the EventPort with no polling loop. A
  // failed subscription is reported once per attempt and never blocks the
  // listener surface — the events simply do not arrive on a host without
  // the push family.
  const sendWindowEventSubscription = (
    type: "subscribeWindowEvents" | "unsubscribeWindowEvents",
    event: string
  ): void => {
    endpoint
      .command<void>({ type, events: [event] } satisfies WebviewCommand)
      .catch((error: unknown) => {
        console.error(
          `WebView window event ${type} failed for ${event}:`,
          error
        );
      });
  };

  const resubscribeWindowEvents = (): void => {
    for (const event of listenerCounts.keys()) {
      sendWindowEventSubscription("subscribeWindowEvents", event);
    }
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
      }, PERMISSION_POLL_INTERVAL_MS);
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
    if (!WINDOW_PUSH_EVENT_FAMILY.has(event)) {
      return unlisten;
    }
    const count = (listenerCounts.get(event) ?? 0) + 1;
    listenerCounts.set(event, count);
    if (count === 1) {
      sendWindowEventSubscription("subscribeWindowEvents", event);
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      const remaining = (listenerCounts.get(event) ?? 1) - 1;
      if (remaining <= 0) {
        listenerCounts.delete(event);
        sendWindowEventSubscription("unsubscribeWindowEvents", event);
      } else {
        listenerCounts.set(event, remaining);
      }
      unlisten();
    };
  };

  const startAppReopenActivityTracking = (): void => {
    if (
      appReopenRegistration === undefined ||
      stopAppReopenActivityTracking !== undefined
    ) {
      return;
    }
    const stopFocus = trackWindowListener(
      "focus",
      endpoint.listen("focus", () => appReopenRegistration.markActive())
    );
    const stopStyle = trackWindowListener(
      "stylechange",
      endpoint.listen<WebviewWindowStyle>("stylechange", ({ payload }) => {
        appReopenRegistration.setAppMode(payload.appMode);
      })
    );
    stopAppReopenActivityTracking = () => {
      stopFocus();
      stopStyle();
      stopAppReopenActivityTracking = undefined;
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
    windowId: orchestrationWindowId,
    async show(command = {}) {
      const wasBootstrapped = bootstrapped;
      const {
        webviews: commandWebviews,
        layout: commandLayout,
        ...commandOverride
      } = command;
      const bootstrapChildren = !wasBootstrapped
        ? (commandWebviews ?? declaredWebviews ?? [])
        : [];
      const orchestrating = bootstrapChildren.length > 0;
      if (
        orchestrating &&
        (commandOverride.html !== undefined ||
          commandOverride.url !== undefined ||
          wireOptions.html !== undefined ||
          wireOptions.url !== undefined)
      ) {
        throw new Error(
          "webviews[] and html/url are exclusive: an orchestrated window declares its content per child webview"
        );
      }
      const showCommand = {
        type: "show",
        ...(bootstrapped ? {} : wireOptions),
        ...commandOverride,
        ...(runtime.sessionId === undefined
          ? {}
          : { sessionId: runtime.sessionId }),
        ...(orchestrating
          ? { windowOnly: true, windowId: orchestrationWindowId }
          : {}),
      } satisfies WebviewCommand;
      await endpoint.command<void>(showCommand);
      bootstrapped = true;
      appReopenRegistration?.setBootstrapped(true);
      if (!wasBootstrapped) {
        const initialStyle = command.style ?? options.style;
        appReopenRegistration?.setAppMode(initialStyle?.appMode ?? false);
        // Listeners registered before the native session existed could not
        // subscribe; the first successful show heals their declarations.
        resubscribeWindowEvents();
      } else if (command.style !== undefined) {
        appReopenRegistration?.setAppMode(command.style.appMode ?? false);
      }
      appReopenRegistration?.markActive();
      startAppReopenActivityTracking();
      if (!wasBootstrapped && orchestrating) {
        // 3.3 friction #2 formalized: the orchestrated window bootstrap is
        // show{windowOnly:true} followed by create-webview per child, then
        // the optional first layout commit — one facade sugar, wire-frozen
        // in fixtures/frames/facade-bridge-frames.json.
        for (const child of bootstrapChildren) {
          await orchestration.createWebview(child);
        }
        const bootstrapLayout = commandLayout ?? declaredLayout;
        if (bootstrapLayout !== undefined) {
          await orchestration.setLayout(bootstrapLayout);
        }
      }
    },
    async setTitle(title: string) {
      if (typeof title !== "string" || title.length === 0) {
        throw new Error("setTitle requires a non-empty title");
      }
      // The v1 frozen wire has no dedicated set-title command; a compatible
      // re-show projects the title natively (apply_reused_show_updates).
      // An orchestrated windowOnly session must repeat its bootstrap-immutable
      // windowOnly fact on every re-show (the same law the toolbar carrier's
      // title projection relies on).
      await this.show({
        title,
        // Only a window bootstrapped through the orchestrated sugar
        // (`webviews`) carries the windowOnly session fact; a plain window
        // re-shows without it (show cannot change windowOnly).
        ...(declaredWebviews !== undefined
          ? { windowOnly: true as const }
          : {}),
      });
      return title;
    },
    hide() {
      return endpoint.command<void>({ type: "hide" } satisfies WebviewCommand);
    },
    close() {
      return endpoint.command<void>({ type: "close" } satisfies WebviewCommand);
    },
    async destroy() {
      // Stop the internal MRU listeners before native session cleanup: their
      // unsubscribe declarations must reach the live session so no producer
      // keeps pushing for this facade after the destroy response.
      stopAppReopenActivityTracking?.();
      await endpoint.command<void>({
        type: "destroy",
      } satisfies WebviewCommand);
      // The destroy response flushes the session's channel.closed pushes;
      // local orchestration routing dies only after the wire caught up.
      orchestration.dispose();
      bootstrapped = false;
      appReopenRegistration?.setBootstrapped(false);
      if (permissionPoll !== undefined) {
        clearInterval(permissionPoll);
        permissionPoll = undefined;
      }
    },
    isClosed() {
      return endpoint.command<boolean>({
        type: "isClosed",
      } satisfies WebviewCommand);
    },
    isVisible() {
      return endpoint.command<boolean>({
        type: "isVisible",
      } satisfies WebviewCommand);
    },
    toVisible() {
      return endpoint.command<void>({
        type: "toVisible",
      } satisfies WebviewCommand);
    },
    focus() {
      return endpoint
        .command<void>({
          type: "focus",
        } satisfies WebviewCommand)
        .then(() => {
          appReopenRegistration?.markActive();
        });
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
      return endpoint
        .command<WebviewWindowStyle>({
          type: "setStyle",
          style,
        } satisfies WebviewCommand)
        .then((result) => {
          appReopenRegistration?.setAppMode(result.appMode);
          return result;
        });
    },
    setBackground(background, backgroundOptions) {
      return endpoint
        .command<WebviewWindowStyle>({
          type: "setStyle",
          style: {
            background: backgroundInputWithOptions(background, backgroundOptions),
          },
        } satisfies WebviewCommand)
        .then((result) => {
          appReopenRegistration?.setAppMode(result.appMode);
          return result;
        });
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
    createWebview(spec) {
      return orchestration.createWebview(spec);
    },
    destroyWebview(webviewId) {
      return orchestration.destroyWebview(webviewId);
    },
    listWebviews() {
      return orchestration.listWebviews();
    },
    setLayout(tree) {
      return orchestration.setLayout(tree);
    },
    layout: {
      update(viewId, patch) {
        return orchestration.updateLayout(viewId, patch);
      },
    },
    createMessageChannel(channelOptions) {
      return orchestration.createMessageChannel(channelOptions);
    },
    listMessageChannels() {
      return orchestration.listMessageChannels();
    },
    destroyMessageChannel(channelId) {
      return orchestration.destroyMessageChannel(channelId);
    },
    onCreatedMessageChannel(handler) {
      return orchestration.onCreatedMessageChannel(handler);
    },
    get connectionDead(): boolean {
      return orchestration.connectionDead;
    },
    onConnectionDead(handler: (error: Error) => void): () => void {
      return orchestration.onConnectionDead(handler);
    },
  };
};

const isExtensionEventSourceTray = (
  tray: TrayHandle
): tray is ExtensionEventSourceTray =>
  "listenExtension" in tray && typeof tray.listenExtension === "function";

const isAppReopenEventSourceTray = (
  tray: TrayHandle
): tray is AppReopenEventSourceTray =>
  "onAppReopenRequested" in tray &&
  typeof tray.onAppReopenRequested === "function";

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
