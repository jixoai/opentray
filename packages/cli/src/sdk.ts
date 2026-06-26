import type { TrayOptions } from "@opentray/spec";

import { createClient, type EventfulTrayHandle } from "./client";
import { connectLocalBroker } from "./local-broker";

export interface OpenTrayRuntimeOptions {
  endpoint?: string;
  homeDir?: string;
  packageVersion?: string;
  protocolVersion?: number;
  clientVersion?: string;
  autoStart?: boolean;
}

export const createTray = async (
  options: TrayOptions,
  runtimeOptions: OpenTrayRuntimeOptions = {},
): Promise<EventfulTrayHandle> => {
  const connection = await connectLocalBroker(runtimeOptions);
  return createClient(connection).createTray(options);
};
