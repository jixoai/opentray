import type { SpaceOptions, SpaceRef, TrayOptions } from "@opentray/spec";

import {
  createClient,
  createSpaceHandle,
  type EventfulSpaceHandle,
  type EventfulTrayHandle,
  type SurfaceHandle,
} from "./client";
import { connectLocalBroker } from "./local-broker";

export interface BrokerConnectOptions {
  endpoint?: string;
  homeDir?: string;
  packageVersion?: string;
  protocolVersion?: number;
  clientVersion?: string;
  autoStart?: boolean;
}

export interface CreateTrayOptions extends BrokerConnectOptions {
  space?: SpaceRef;
}

export const createSpace = async (
  options: SpaceOptions,
  brokerOptions: BrokerConnectOptions = {},
): Promise<EventfulSpaceHandle> => {
  const connection = await connectLocalBroker(brokerOptions);
  return createClient(connection).createSpace(options);
};

/** @deprecated Use `createSpace`. */
export const createSurface = async (
  options: SpaceOptions,
  brokerOptions: BrokerConnectOptions = {},
): Promise<SurfaceHandle> => createSpace(options, brokerOptions);

export const resolveDefaultSpace = async (
  brokerOptions: BrokerConnectOptions = {},
): Promise<EventfulSpaceHandle> => {
  const connection = await connectLocalBroker(brokerOptions);
  return createClient(connection).resolveDefaultSpace();
};

export const createTray = async (
  options: TrayOptions,
  brokerOptions: CreateTrayOptions = {},
): Promise<EventfulTrayHandle> => {
  const { space, ...connectOptions } = brokerOptions;
  const connection = await connectLocalBroker(connectOptions);
  const spaceHandle = space ? createSpaceHandle(connection, space) : await createClient(connection).resolveDefaultSpace();
  return spaceHandle.createTray(options);
};
