export {
  createClient,
  createInitFrame,
  createSpaceHandle,
  createSurfaceHandle,
  createTrayHandle,
  type CreateClientOptions,
  type ExtensionLoadOptions,
  type OpenTrayClient,
  type OpenTrayTransport,
  type SpaceHandle,
  type SurfaceHandle,
  type TrayExtension,
  type TrayExtensionContext,
  type TrayExtensionMountSpec,
  type TrayHandle,
} from "./client";
export { createSpace, createSurface, createTray, resolveDefaultSpace, type BrokerConnectOptions, type CreateTrayOptions } from "./sdk";
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
