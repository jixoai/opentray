import {
  PROTOCOL_VERSION,
  type ClientFrame,
  type ClientRequestFrame,
  type RequestId,
  type ServerFrame,
  type SurfaceOptions,
  type SurfaceRef,
  type TrayId,
  type TrayOptions,
} from "@opentray/spec";

export interface OpenTrayTransport {
  request(frame: ClientRequestFrame): Promise<ServerFrame>;
}

export interface OpenTrayClient {
  createSurface(options: SurfaceOptions): Promise<SurfaceHandle>;
}

export interface SurfaceHandle {
  surface: SurfaceRef;
  createTray(options: TrayOptions): Promise<TrayHandle>;
}

export interface TrayHandle {
  surface: SurfaceRef;
  trayId: TrayId;
  commandExtension(ext: string, data: unknown): Promise<void>;
  destroy(): Promise<void>;
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
    async createSurface(surfaceOptions): Promise<SurfaceHandle> {
      const requestId = nextRequestId();
      const response = await transport.request({
        type: "create-surface",
        requestId,
        ...surfaceOptions,
      });
      const surface = expectResponse(response, requestId, "surface-created").surface;
      return createSurfaceHandle(transport, surface, nextRequestId);
    },
  };
};

export const createSurfaceHandle = (
  transport: OpenTrayTransport,
  surface: SurfaceRef,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): SurfaceHandle => ({
  surface,
  async createTray(options: TrayOptions): Promise<TrayHandle> {
    const requestId = nextRequestId();
    const response = await transport.request({
      type: "create-tray",
      requestId,
      surface,
      tray: options,
    });
    const frame = expectResponse(response, requestId, "tray-created");
    return createTrayHandle(transport, surface, frame.trayId, nextRequestId);
  },
});

export const createTrayHandle = (
  transport: OpenTrayTransport,
  surface: SurfaceRef,
  trayId: TrayId,
  nextRequestId: () => RequestId = createRequestIdFactory("opentray"),
): TrayHandle => ({
  surface,
  trayId,
  async commandExtension(ext: string, data: unknown): Promise<void> {
    const requestId = nextRequestId();
    const response = await transport.request({
      type: "ext-command",
      requestId,
      surfaceId: surface.surfaceId,
      trayId,
      ext,
      data,
    });
    expectResponse(response, requestId, "ack");
  },
  async destroy(): Promise<void> {
    const requestId = nextRequestId();
    const response = await transport.request({
      type: "destroy-tray",
      requestId,
      surfaceId: surface.surfaceId,
      trayId,
    });
    expectResponse(response, requestId, "ack");
  },
});

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
    case "surface-created":
    case "default-surface":
    case "tray-created":
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
