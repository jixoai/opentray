import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type ClientRequestFrame,
  type ExtensionEnvelope,
  type Icon,
  type Menu,
  type RequestId,
  type ServerFrame,
  type SpaceOptions,
  type SpaceRef,
  type Tooltip,
  type TrayBoundsResult,
  type TrayEvent,
  type TrayId,
  type TrayOptions,
} from "@opentray/spec";

export interface OpenTrayTransport {
  request(frame: ClientRequestFrame): Promise<ServerFrame>;
}

export type BrokerEventFrame = Extract<ServerFrame, { type: "event" | "ext-event" }>;

export interface OpenTrayEventSource {
  onEvent(listener: (frame: BrokerEventFrame) => void): () => void;
}

export interface OpenTrayConnection extends OpenTrayTransport, OpenTrayEventSource {}

export interface OpenTrayClient {
  createSpace(options: SpaceOptions): Promise<SpaceHandle>;
  resolveDefaultSpace(): Promise<SpaceHandle>;
  /** @deprecated Use `createSpace`. */
  createSurface(options: SpaceOptions): Promise<SpaceHandle>;
}

export interface SpaceHandle {
  space: SpaceRef;
  createTray(options: TrayOptions): Promise<TrayHandle>;
}

export interface EventfulSpaceHandle extends Omit<SpaceHandle, "createTray"> {
  createTray(options: TrayOptions): Promise<EventfulTrayHandle>;
}

/** @deprecated Use `SpaceHandle`. */
export type SurfaceHandle = SpaceHandle;

export interface TrayHandle {
  space: SpaceRef;
  trayId: TrayId;
  getBounds(): Promise<TrayBoundsResult>;
  setMenu(menu: Menu): Promise<void>;
  setTooltip(tooltip: Tooltip): Promise<void>;
  setIcon(icon: Icon): Promise<void>;
  setTitle(title: string): Promise<void>;
  loadExtension(options: ExtensionLoadOptions): Promise<void>;
  commandExtension(ext: string, data: unknown): Promise<void>;
  requestExtension(ext: string, data: unknown): Promise<ExtensionEnvelope[]>;
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions,
  ): TrayHandle & TCapability;
  destroy(): Promise<void>;
}

export type TrayScopedEvent = Exclude<TrayEvent, { type: "ready" }>;
export type TrayEventType = TrayScopedEvent["type"];
export type TrayEventByType<TEvent extends TrayEventType> = Extract<TrayScopedEvent, { type: TEvent }>;

export interface EventfulTrayHandle extends TrayHandle {
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions,
  ): EventfulTrayHandle & TCapability;
  listenExtension<TData = unknown>(
    ext: string,
    handler: (event: ExtensionEnvelope<TData>) => void,
  ): () => void;
  listen<TEvent extends TrayEventType>(
    event: TEvent,
    handler: (event: TrayEventByType<TEvent>) => void,
  ): () => void;
  onMenuClick(handler: (event: TrayEventByType<"menuClick">) => void): () => void;
  onTrayClick(handler: (event: TrayEventByType<"trayClick">) => void): () => void;
  onTrayDoubleClick(handler: (event: TrayEventByType<"trayDoubleClick">) => void): () => void;
}

export interface ExtensionLoadOptions {
  name: string;
  path: string;
  mountId?: string;
}

export interface TrayExtensionMountSpec {
  name?: string;
  path?: string;
  mountId?: string;
}

export interface TrayExtensionContext {
  readonly name: string;
  readonly path: string;
  readonly mountId: string;
  ensureLoaded(): Promise<void>;
  command(data: unknown): Promise<void>;
  request(data: unknown): Promise<ExtensionEnvelope[]>;
}

export interface TrayExtension<TCapability extends object, TOptions = undefined> {
  readonly name: string;
  readonly path: string;
  resolveMount?(options: TOptions | undefined): TrayExtensionMountSpec;
  extend(tray: TrayHandle, context: TrayExtensionContext, options: TOptions | undefined): TCapability;
}

export const createInitFrame = (clientVersion: string): ClientFrame => ({
  type: "init",
  protocolVersion: PROTOCOL_VERSION,
  clientVersion,
});

export interface CreateClientOptions {
  requestIdPrefix?: string;
}

export interface OpenTrayEventfulClient extends Omit<OpenTrayClient, "createSpace" | "resolveDefaultSpace" | "createSurface"> {
  createSpace(options: SpaceOptions): Promise<EventfulSpaceHandle>;
  resolveDefaultSpace(): Promise<EventfulSpaceHandle>;
  /** @deprecated Use `createSpace`. */
  createSurface(options: SpaceOptions): Promise<EventfulSpaceHandle>;
}

export function createClient(
  transport: OpenTrayConnection,
  options?: CreateClientOptions,
): OpenTrayEventfulClient;
export function createClient(transport: OpenTrayTransport, options?: CreateClientOptions): OpenTrayClient;
export function createClient(
  transport: OpenTrayTransport,
  options: CreateClientOptions = {},
): OpenTrayClient | OpenTrayEventfulClient {
  const nextRequestId = createRequestIdFactory(options.requestIdPrefix ?? "opentray");

  return {
    async createSpace(spaceOptions): Promise<SpaceHandle> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "create-space",
        requestId,
        ...spaceOptions,
      });
      const space = expectResponse(response, requestId, "space-created").space;
      return createSpaceHandle(transport, space, nextRequestId);
    },
    async resolveDefaultSpace(): Promise<SpaceHandle> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "resolve-default-space",
        requestId,
      });
      const space = expectResponse(response, requestId, "default-space").space;
      return createSpaceHandle(transport, space, nextRequestId);
    },
    async createSurface(spaceOptions): Promise<SpaceHandle> {
      return this.createSpace(spaceOptions);
    },
  };
};

export function createSpaceHandle(
  transport: OpenTrayConnection,
  space: SpaceRef,
  nextRequestId?: () => RequestId,
): EventfulSpaceHandle;
export function createSpaceHandle(
  transport: OpenTrayTransport,
  space: SpaceRef,
  nextRequestId?: () => RequestId,
): SpaceHandle;
export function createSpaceHandle(
  transport: OpenTrayTransport,
  space: SpaceRef,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): SpaceHandle | EventfulSpaceHandle {
  return {
    space,
    async createTray(options: TrayOptions): Promise<TrayHandle | EventfulTrayHandle> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "create-tray",
        requestId,
        space,
        tray: options,
      });
      const frame = expectResponse(response, requestId, "tray-created");
      return createTrayHandle(transport, space, frame.trayId, nextRequestId);
    },
  };
}

/** @deprecated Use `createSpaceHandle`. */
export const createSurfaceHandle = createSpaceHandle;

export function createTrayHandle(
  transport: OpenTrayConnection,
  space: SpaceRef,
  trayId: TrayId,
  nextRequestId?: () => RequestId,
): EventfulTrayHandle;
export function createTrayHandle(
  transport: OpenTrayTransport,
  space: SpaceRef,
  trayId: TrayId,
  nextRequestId?: () => RequestId,
): TrayHandle;
export function createTrayHandle(
  transport: OpenTrayTransport,
  space: SpaceRef,
  trayId: TrayId,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): TrayHandle | EventfulTrayHandle {
  let nextMountOrdinal = 1;
  const nextMountId = (extensionName: string): string => {
    const mountId = `${formatMountIdComponent(extensionName)}.${formatMountIdComponent(trayId)}.${nextMountOrdinal}`;
    nextMountOrdinal += 1;
    return mountId;
  };
  const handle: TrayHandle = {
    space,
    trayId,
    async getBounds(): Promise<TrayBoundsResult> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "get-tray-bounds",
        requestId,
        spaceId: space.spaceId,
        trayId,
      });
      return expectResponse(response, requestId, "tray-bounds").bounds;
    },
    async setMenu(menu: Menu): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-tray-menu",
        requestId,
        spaceId: space.spaceId,
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
        spaceId: space.spaceId,
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
        spaceId: space.spaceId,
        trayId,
        icon,
      });
      expectResponse(response, requestId, "ack");
    },
    async setTitle(title: string): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "set-tray-title",
        requestId,
        spaceId: space.spaceId,
        trayId,
        title,
      });
      expectResponse(response, requestId, "ack");
    },
    async loadExtension(options): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "load-ext",
        requestId,
        spaceId: space.spaceId,
        name: options.name,
        path: options.path,
        ...(options.mountId === undefined ? {} : { mountId: options.mountId }),
      });
      expectResponse(response, requestId, "ack");
    },
    async commandExtension(ext: string, data: unknown): Promise<void> {
      await this.requestExtension(ext, data);
    },
    async requestExtension(ext: string, data: unknown): Promise<ExtensionEnvelope[]> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "ext-command",
        requestId,
        spaceId: space.spaceId,
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
      options?: TOptions,
    ): TrayHandle & TCapability {
      const context = createTrayExtensionContext(handle, extension, options, nextMountId);
      const capability = extension.extend(handle, context, options);
      return Object.assign({}, handle, capability);
    },
    async destroy(): Promise<void> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "destroy-tray",
        requestId,
        spaceId: space.spaceId,
        trayId,
      });
      expectResponse(response, requestId, "ack");
    },
  };
  if (!isOpenTrayEventSource(transport)) {
    return handle;
  }
  return attachEventfulTrayHandle(handle, transport, nextMountId);
}

const attachEventfulTrayHandle = (
  handle: TrayHandle,
  source: OpenTrayEventSource,
  nextMountId: (extensionName: string) => string,
): EventfulTrayHandle => {
  const listen: EventfulTrayHandle["listen"] = (event, handler) =>
    source.onEvent((frame) => {
      if (frame.type !== "event" || frame.event.type !== event) {
        return;
      }
      if (!isOwnedTrayEvent(frame.event, handle.space.spaceId, handle.trayId)) {
        return;
      }
      handler(frame.event as TrayEventByType<typeof event>);
    });

  const eventful: EventfulTrayHandle = {
    ...handle,
    listenExtension<TData = unknown>(ext: string, handler: (event: ExtensionEnvelope<TData>) => void) {
      return source.onEvent((frame) => {
        if (frame.type !== "ext-event" || frame.ext !== ext) {
          return;
        }
        if (frame.spaceId !== handle.space.spaceId || frame.trayId !== handle.trayId) {
          return;
        }
        handler({
          scope: { spaceId: frame.spaceId, trayId: frame.trayId, ext: frame.ext },
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
      options?: TOptions,
    ): EventfulTrayHandle & TCapability {
      const context = createTrayExtensionContext(eventful, extension, options, nextMountId);
      const capability = extension.extend(eventful, context, options);
      return Object.assign({}, eventful, capability);
    },
  };
  return eventful;
};

const isOwnedTrayEvent = (event: TrayEvent, spaceId: string, trayId: string): event is TrayScopedEvent =>
  event.type !== "ready" && event.spaceId === spaceId && event.trayId === trayId;

const isOpenTrayEventSource = (transport: OpenTrayTransport): transport is OpenTrayConnection =>
  "onEvent" in transport && typeof transport.onEvent === "function";

const createTrayExtensionContext = <TCapability extends object, TOptions>(
  tray: TrayHandle,
  extension: TrayExtension<TCapability, TOptions>,
  options: TOptions | undefined,
  nextMountId: (extensionName: string) => string,
): TrayExtensionContext => {
  const mount = extension.resolveMount?.(options) ?? {};
  const name = mount.name ?? extension.name;
  const path = mount.path ?? extension.path;
  const mountId = mount.mountId ?? nextMountId(name);
  let loadPromise: Promise<void> | undefined;

  const ensureLoaded = async (): Promise<void> => {
    if (loadPromise === undefined) {
      loadPromise = tray.loadExtension({ name, path, mountId }).catch((error: unknown) => {
        loadPromise = undefined;
        throw error;
      });
    }
    await loadPromise;
  };

  return {
    name,
    path,
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
  type: TType,
): Extract<ServerFrame, { type: TType }> => {
  if (frame.type === "error") {
    throw new Error(`${frame.code}: ${frame.message}`);
  }
  if (frame.type !== type) {
    throw new Error(`expected ${type} for ${requestId}, received ${frame.type}`);
  }
  if (requestIdOf(frame) !== requestId) {
    throw new Error(`expected response for ${requestId}, received ${requestIdOf(frame) ?? "none"}`);
  }
  return frame as Extract<ServerFrame, { type: TType }>;
};

const requestIdOf = (frame: ServerFrame): RequestId | undefined => {
  switch (frame.type) {
    case "space-created":
    case "default-space":
    case "tray-created":
    case "tray-bounds":
    case "ack":
    case "ext-command-result":
    case "daemon-health":
      return frame.requestId;
    case "error":
      return frame.requestId;
    case "ready":
    case "event":
    case "ext-event":
      return undefined;
  }
};
