export {
  createClient,
  createInitFrame,
  createSurfaceHandle,
  createTrayHandle,
  type CreateClientOptions,
  type OpenTrayClient,
  type OpenTrayTransport,
  type SurfaceHandle,
  type TrayHandle,
} from "./client";
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
