import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type ClientRequestFrame,
  type RequestId,
  type ServerFrame,
  type SpaceOptions,
  type SpaceRef,
  type TrayBoundsResult,
  type TrayId,
  type TrayOptions,
} from "@opentray/spec";

export interface OpenTrayTransport {
  request(frame: ClientRequestFrame): Promise<ServerFrame>;
}

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

/** @deprecated Use `SpaceHandle`. */
export type SurfaceHandle = SpaceHandle;

export interface TrayHandle {
  space: SpaceRef;
  trayId: TrayId;
  getBounds(): Promise<TrayBoundsResult>;
  loadExtension(options: ExtensionLoadOptions): Promise<void>;
  commandExtension(ext: string, data: unknown): Promise<void>;
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions,
  ): TrayHandle & TCapability;
  destroy(): Promise<void>;
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

export const createClient = (
  transport: OpenTrayTransport,
  options: CreateClientOptions = {},
): OpenTrayClient => {
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

export const createSpaceHandle = (
  transport: OpenTrayTransport,
  space: SpaceRef,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): SpaceHandle => ({
  space,
  async createTray(options: TrayOptions): Promise<TrayHandle> {
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
});

/** @deprecated Use `createSpaceHandle`. */
export const createSurfaceHandle = createSpaceHandle;

export const createTrayHandle = (
  transport: OpenTrayTransport,
  space: SpaceRef,
  trayId: TrayId,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): TrayHandle => {
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
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "ext-command",
        requestId,
        spaceId: space.spaceId,
        trayId,
        ext,
        data,
      });
      expectResponse(response, requestId, "ack");
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
  return handle;
};

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
