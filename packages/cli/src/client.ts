import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type ClientRequestFrame,
  type AppIdentity,
  type ExtensionEnvelope,
  type Icon,
  type Menu,
  type RequestId,
  type ServerFrame,
  type Tooltip,
  type TrayBoundsResult,
  type TrayEvent,
  type TrayId,
  type TrayOptions,
} from "@opentray/spec";
import { isNativeCapableAppIcon } from "./app-icon";

import {
  resolveNativeExtensionArtifact,
  type NativeExtensionArtifact,
} from "./native-extension-artifact";

export interface OpenTrayTransport {
  request(frame: ClientRequestFrame): Promise<ServerFrame>;
}

export type OpenTrayEventFrame = Extract<
  ServerFrame,
  { type: "event" | "ext-event" }
>;

export interface OpenTrayEventSource {
  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void;
}

export interface OpenTrayConnection
  extends OpenTrayTransport,
    OpenTrayEventSource {}

export interface OpenTrayClient {
  createTray(options: TrayOptions): Promise<TrayHandle>;
}

export interface OpenTrayEventfulClient extends OpenTrayClient {
  createTray(options: TrayOptions): Promise<EventfulTrayHandle>;
}

export interface TrayHandle {
  trayId: TrayId;
  app: AppHandle;
  getBounds(): Promise<TrayBoundsResult>;
  setMenu(menu: Menu): Promise<void>;
  setTooltip(tooltip: Tooltip): Promise<void>;
  setIcon(icon: Icon): Promise<void>;
  loadExtension(options: ExtensionLoadOptions): Promise<void>;
  commandExtension(ext: string, data: unknown): Promise<void>;
  requestExtension(ext: string, data: unknown): Promise<ExtensionEnvelope[]>;
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions
  ): TrayHandle & TCapability;
  destroy(): Promise<void>;
}

export interface AppHandle {
  readonly appId: string;
  getName(): Promise<string>;
  setName(name: string): Promise<string>;
  getIcon(): Promise<Icon | null>;
  setIcon(icon: Icon | null): Promise<Icon | null>;
}

export type TrayScopedEvent = Exclude<TrayEvent, { type: "ready" }>;
export type TrayEventType = TrayScopedEvent["type"];
export type TrayEventByType<TEvent extends TrayEventType> = Extract<
  TrayScopedEvent,
  { type: TEvent }
>;

export interface EventfulTrayHandle extends TrayHandle {
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions
  ): EventfulTrayHandle & TCapability;
  listenExtension<TData = unknown>(
    ext: string,
    handler: (event: ExtensionEnvelope<TData>) => void
  ): () => void;
  listen<TEvent extends TrayEventType>(
    event: TEvent,
    handler: (event: TrayEventByType<TEvent>) => void
  ): () => void;
  onMenuClick(
    handler: (event: TrayEventByType<"menuClick">) => void
  ): () => void;
  onTrayClick(
    handler: (event: TrayEventByType<"trayClick">) => void
  ): () => void;
  onTrayDoubleClick(
    handler: (event: TrayEventByType<"trayDoubleClick">) => void
  ): () => void;
}

export interface ExtensionLoadOptions {
  name: string;
  artifact: NativeExtensionArtifact;
  mountId?: string;
}

export interface TrayExtensionMountSpec {
  name?: string;
  artifact?: NativeExtensionArtifact;
  mountId?: string;
}

export interface TrayExtensionContext {
  readonly appId: string;
  readonly trayId: TrayId;
  readonly name: string;
  readonly artifact: NativeExtensionArtifact;
  readonly mountId: string;
  ensureLoaded(): Promise<void>;
  command(data: unknown): Promise<void>;
  request(data: unknown): Promise<ExtensionEnvelope[]>;
}

export interface TrayExtension<
  TCapability extends object,
  TOptions = undefined
> {
  readonly name: string;
  readonly artifact: NativeExtensionArtifact;
  resolveMount?(options: TOptions | undefined): TrayExtensionMountSpec;
  extend(
    tray: TrayHandle,
    context: TrayExtensionContext,
    options: TOptions | undefined
  ): TCapability;
}

export const createInitFrame = (clientVersion: string): ClientFrame => ({
  type: "init",
  protocolVersion: PROTOCOL_VERSION,
  clientVersion,
});

export interface CreateClientOptions {
  requestIdPrefix?: string;
  appOptions?: {
    name?: string;
    icon?: Icon;
  };
}

export function createClient(
  transport: OpenTrayConnection,
  options?: CreateClientOptions
): OpenTrayEventfulClient;
export function createClient(
  transport: OpenTrayTransport,
  options?: CreateClientOptions
): OpenTrayClient;
export function createClient(
  transport: OpenTrayTransport,
  options: CreateClientOptions = {}
): OpenTrayClient | OpenTrayEventfulClient {
  const nextRequestId = createRequestIdFactory(
    options.requestIdPrefix ?? "opentray"
  );
  let appPromise: Promise<{ app: { appId: string }; handle: AppHandle }> | undefined;

  const ensureApp = async (
    trayOptions: TrayOptions
  ): Promise<{ app: { appId: string }; handle: AppHandle }> => {
    appPromise ??= (async () => {
      const app = await resolveDefaultAppRef(transport, nextRequestId);
      const handle = createAppHandle(transport, app.appId, nextRequestId);
      const configured = options.appOptions;
      if (configured?.name !== undefined) {
        await handle.setName(configured.name);
      }
      if (configured?.icon !== undefined) {
        await handle.setIcon(configured.icon);
      } else if (
        trayOptions.icon !== undefined &&
        isNativeCapableAppIcon(trayOptions.icon) &&
        (await handle.getIcon()) === null
      ) {
        await handle.setIcon(trayOptions.icon);
      }
      return { app, handle };
    })().catch((error: unknown) => {
      appPromise = undefined;
      throw error;
    });
    return appPromise;
  };

  return {
    async createTray(options: TrayOptions): Promise<TrayHandle> {
      const { app } = await ensureApp(options);
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "create-tray",
        requestId,
        app,
        tray: options,
      });
      const frame = expectResponse(response, requestId, "tray-created");
      return createTrayHandle(
        transport,
        app.appId,
        frame.trayId ?? options.id,
        nextRequestId
      );
    },
  };
}

export function createTrayHandle(
  transport: OpenTrayConnection,
  appId: string,
  trayId: TrayId,
  nextRequestId?: () => RequestId
): EventfulTrayHandle;
export function createTrayHandle(
  transport: OpenTrayTransport,
  appId: string,
  trayId: TrayId,
  nextRequestId?: () => RequestId
): TrayHandle;
export function createTrayHandle(
  transport: OpenTrayTransport,
  appId: string,
  trayId: TrayId,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray")
): TrayHandle | EventfulTrayHandle {
  let nextMountOrdinal = 1;
  const nextMountId = (extensionName: string): string => {
    const mountId = `${formatMountIdComponent(
      extensionName
    )}.${formatMountIdComponent(trayId)}.${nextMountOrdinal}`;
    nextMountOrdinal += 1;
    return mountId;
  };
  const handle: TrayHandle = {
    trayId,
    app: createAppHandle(transport, appId, nextRequestId),
    async getBounds(): Promise<TrayBoundsResult> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "get-tray-bounds",
        requestId,
        appId,
        trayId,
      });
      return expectResponse(response, requestId, "tray-bounds").bounds;
    },
    async setMenu(menu: Menu): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-tray-menu",
        requestId,
        appId,
        trayId,
        menu,
      });
      expectResponse(response, requestId, "ack");
    },
    async setTooltip(tooltip: Tooltip): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-tray-tooltip",
        requestId,
        appId,
        trayId,
        tooltip,
      });
      expectResponse(response, requestId, "ack");
    },
    async setIcon(icon: Icon): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-tray-icon",
        requestId,
        appId,
        trayId,
        icon,
      });
      expectResponse(response, requestId, "ack");
    },
    async loadExtension(options): Promise<void> {
      const requestId = nextRequestId();
      const resolved = await resolveNativeExtensionArtifact(options.artifact);
      const response = await transport.request({
        type: "load-ext",
        requestId,
        appId,
        name: options.name,
        path: resolved.path,
        expectedIdentity: resolved.expectedIdentity,
        ...(options.mountId === undefined ? {} : { mountId: options.mountId }),
      });
      expectResponse(response, requestId, "ack");
    },
    async commandExtension(ext: string, data: unknown): Promise<void> {
      await this.requestExtension(ext, data);
    },
    async requestExtension(
      ext: string,
      data: unknown
    ): Promise<ExtensionEnvelope[]> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "ext-command",
        requestId,
        appId,
        trayId,
        ext,
        data,
      });
      if (response.type === "ack") {
        expectResponse(response, requestId, "ack");
        return [];
      }
      return expectResponse(response, requestId, "ext-command-result").events;
    },
    extend<TCapability extends object, TOptions = undefined>(
      extension: TrayExtension<TCapability, TOptions>,
      options?: TOptions
    ): TrayHandle & TCapability {
      const context = createTrayExtensionContext(
        handle,
        appId,
        extension,
        options,
        nextMountId
      );
      const capability = extension.extend(handle, context, options);
      return Object.assign({}, handle, capability);
    },
    async destroy(): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "destroy-tray",
        requestId,
        appId,
        trayId,
      });
      expectResponse(response, requestId, "ack");
    },
  };
  if (!isOpenTrayEventSource(transport)) {
    return handle;
  }
  return attachEventfulTrayHandle(handle, transport, appId, nextMountId);
}

const attachEventfulTrayHandle = (
  handle: TrayHandle,
  source: OpenTrayEventSource,
  appId: string,
  nextMountId: (extensionName: string) => string
): EventfulTrayHandle => {
  const listen: EventfulTrayHandle["listen"] = (event, handler) =>
    source.onEvent((frame) => {
      if (frame.type !== "event" || frame.event.type !== event) {
        return;
      }
      if (!isOwnedTrayEvent(frame.event, appId, handle.trayId)) {
        return;
      }
      handler(frame.event as TrayEventByType<typeof event>);
    });

  const eventful: EventfulTrayHandle = {
    ...handle,
    listenExtension<TData = unknown>(
      ext: string,
      handler: (event: ExtensionEnvelope<TData>) => void
    ) {
      return source.onEvent((frame) => {
        if (frame.type !== "ext-event" || frame.ext !== ext) {
          return;
        }
        if (frame.appId !== appId || frame.trayId !== handle.trayId) {
          return;
        }
        handler({
          scope: { appId: frame.appId, trayId: frame.trayId, ext: frame.ext },
          data: frame.data as TData,
        });
      });
    },
    listen,
    onMenuClick(handler) {
      return listen("menuClick", handler);
    },
    onTrayClick(handler) {
      return listen("trayClick", handler);
    },
    onTrayDoubleClick(handler) {
      return listen("trayDoubleClick", handler);
    },
    extend<TCapability extends object, TOptions = undefined>(
      extension: TrayExtension<TCapability, TOptions>,
      options?: TOptions
    ): EventfulTrayHandle & TCapability {
      const context = createTrayExtensionContext(
        eventful,
        appId,
        extension,
        options,
        nextMountId
      );
      const capability = extension.extend(eventful, context, options);
      return Object.assign({}, eventful, capability);
    },
  };
  return eventful;
};

const isOwnedTrayEvent = (
  event: TrayEvent,
  appId: string,
  trayId: string
): event is TrayScopedEvent =>
  event.type !== "ready" && event.appId === appId && event.trayId === trayId;

const isOpenTrayEventSource = (
  transport: OpenTrayTransport
): transport is OpenTrayConnection =>
  "onEvent" in transport && typeof transport.onEvent === "function";

const resolveDefaultAppRef = async (
  transport: OpenTrayTransport,
  nextRequestId: () => RequestId
): Promise<{ appId: string }> => {
  const requestId = nextRequestId();
  const response = await transport.request({
    type: "resolve-default-app",
    requestId,
  });
  return expectResponse(response, requestId, "default-app").app;
};

const createAppHandle = (
  transport: OpenTrayTransport,
  appId: string,
  nextRequestId: () => RequestId,
): AppHandle => {
  const requestIdentity = async (): Promise<AppIdentity> => {
    const requestId = nextRequestId();
    const response = await transport.request({
      type: "get-app-identity",
      requestId,
      appId,
    });
    return expectResponse(response, requestId, "app-identity").identity;
  };
  return {
    appId,
    async getName(): Promise<string> {
      return (await requestIdentity()).appName;
    },
    async setName(name: string): Promise<string> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-app-name",
        requestId,
        appId,
        name,
      });
      expectResponse(response, requestId, "ack");
      return (await requestIdentity()).appName;
    },
    async getIcon(): Promise<Icon | null> {
      return (await requestIdentity()).icon ?? null;
    },
    async setIcon(icon: Icon | null): Promise<Icon | null> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-app-icon",
        requestId,
        appId,
        icon,
      });
      expectResponse(response, requestId, "ack");
      return icon;
    },
  };
};

const createTrayExtensionContext = <TCapability extends object, TOptions>(
  tray: TrayHandle,
  appId: string,
  extension: TrayExtension<TCapability, TOptions>,
  options: TOptions | undefined,
  nextMountId: (extensionName: string) => string
): TrayExtensionContext => {
  const mount = extension.resolveMount?.(options) ?? {};
  const name = mount.name ?? extension.name;
  const artifact = mount.artifact ?? extension.artifact;
  const mountId = mount.mountId ?? nextMountId(name);
  let loadPromise: Promise<void> | undefined;

  const ensureLoaded = async (): Promise<void> => {
    if (loadPromise === undefined) {
      // Package-manager resolution stays in Node; the broker receives one exact file.
      loadPromise = tray
        .loadExtension({ name, artifact, mountId })
        .catch((error: unknown) => {
          loadPromise = undefined;
          throw error;
        });
    }
    await loadPromise;
  };

  return {
    appId,
    trayId: tray.trayId,
    name,
    artifact,
    mountId,
    ensureLoaded,
    async command(data: unknown): Promise<void> {
      await ensureLoaded();
      await tray.commandExtension(mountId, data);
    },
    async request(data: unknown): Promise<ExtensionEnvelope[]> {
      await ensureLoaded();
      return tray.requestExtension(mountId, data);
    },
  };
};

const formatMountIdComponent = (value: string): string => {
  const formatted = value.replaceAll(/[^a-zA-Z0-9._+-]/g, "_");
  return formatted.length > 0 ? formatted : "ext";
};

const createRequestIdFactory = (prefix: string): (() => RequestId) => {
  let next = 1;
  return () => {
    const requestId = `${prefix}-${next}`;
    next += 1;
    return requestId;
  };
};

const expectResponse = <TType extends ServerFrame["type"]>(
  frame: ServerFrame,
  requestId: RequestId,
  type: TType
): Extract<ServerFrame, { type: TType }> => {
  if (frame.type === "error") {
    throw new Error(`${frame.code}: ${frame.message}`);
  }
  if (frame.type !== type) {
    throw new Error(
      `expected ${type} for ${requestId}, received ${frame.type}`
    );
  }
  if (requestIdOf(frame) !== requestId) {
    throw new Error(
      `expected response for ${requestId}, received ${
        requestIdOf(frame) ?? "none"
      }`
    );
  }
  return frame as Extract<ServerFrame, { type: TType }>;
};

const requestIdOf = (frame: ServerFrame): RequestId | undefined => {
  switch (frame.type) {
    case "app-created":
    case "default-app":
    case "app-identity":
    case "tray-created":
    case "tray-bounds":
    case "ack":
    case "ext-command-result":
    case "runtime-host-health":
      return frame.requestId;
    case "error":
      return frame.requestId;
    case "ready":
    case "event":
    case "ext-event":
      return undefined;
  }
};
