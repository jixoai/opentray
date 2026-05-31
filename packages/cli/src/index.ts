import { PROTOCOL_VERSION, type ClientFrame, type SurfaceOptions, type SurfaceRef, type TrayId, type TrayOptions } from "@opentray/spec";

export {
  createBrokerEndpointIdentity,
  formatBrokerEndpointName,
  formatBrokerStateRoot,
  formatUnixSocketPath,
  formatWindowsPipeName,
  isSupportedProtocolVersion,
  PROTOCOL_VERSION,
  type BrokerEndpointIdentity,
  type BrokerEndpointIdentityOptions,
} from "@opentray/spec";

export interface OpenTrayTransport {
  send(frame: ClientFrame): Promise<void>;
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

export const createClient = (transport: OpenTrayTransport) => ({
  async createSurface(options: SurfaceOptions): Promise<SurfaceHandle> {
    await transport.send({ type: "create-surface", ...options });
    const surface: SurfaceRef = {
      surfaceId: `pending:${options.appId}`,
      appId: options.appId,
    };
    return createSurfaceHandle(transport, surface);
  },
});

export const createSurfaceHandle = (transport: OpenTrayTransport, surface: SurfaceRef): SurfaceHandle => ({
  surface,
  async createTray(options: TrayOptions): Promise<TrayHandle> {
    await transport.send({ type: "create-tray", surface, tray: options });
    return createTrayHandle(transport, surface, options.trayId ?? "pending");
  },
});

export const createTrayHandle = (
  transport: OpenTrayTransport,
  surface: SurfaceRef,
  trayId: TrayId,
): TrayHandle => ({
  surface,
  trayId,
  async commandExtension(ext: string, data: unknown): Promise<void> {
    await transport.send({
      type: "ext-command",
      surfaceId: surface.surfaceId,
      trayId,
      ext,
      data,
    });
  },
  async destroy(): Promise<void> {
    await transport.send({
      type: "destroy-tray",
      surfaceId: surface.surfaceId,
      trayId,
    });
  },
});
