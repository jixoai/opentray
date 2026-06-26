import type { TrayOptions } from "@opentray/spec";

import { createClient, type EventfulTrayHandle } from "./client";
import { connectLocalBroker } from "./local-broker";
import type { OpenTrayRuntimeBinding } from "./native-runtime";
import { createRuntimeBindingTransport } from "./runtime-binding-transport";

export type OpenTrayRuntimeMode =
  | "visible-binding"
  | "local-broker"
  | "headless-binding";

export interface OpenTrayRuntimeOptions {
  runtime?: OpenTrayRuntimeMode;
  endpoint?: string;
  homeDir?: string;
  packageVersion?: string;
  protocolVersion?: number;
  clientVersion?: string;
  appId?: string;
  appName?: string;
  autoStart?: boolean;
  binding?: OpenTrayRuntimeBinding;
}

export const createTray = async (
  options: TrayOptions,
  runtimeOptions: OpenTrayRuntimeOptions = {}
): Promise<EventfulTrayHandle> => {
  const bindingTransportOptions = {
    ...(runtimeOptions.binding === undefined
      ? {}
      : { binding: runtimeOptions.binding }),
    ...(runtimeOptions.packageVersion === undefined
      ? {}
      : { packageVersion: runtimeOptions.packageVersion }),
    ...(runtimeOptions.clientVersion === undefined
      ? {}
      : { clientVersion: runtimeOptions.clientVersion }),
    ...(runtimeOptions.protocolVersion === undefined
      ? {}
      : { protocolVersion: runtimeOptions.protocolVersion }),
    ...(runtimeOptions.appId === undefined
      ? {}
      : { appId: runtimeOptions.appId }),
    ...(runtimeOptions.appName === undefined
      ? {}
      : { appName: runtimeOptions.appName }),
  };
  const runtime = runtimeOptions.runtime ?? "visible-binding";
  const connection =
    runtime === "local-broker"
      ? await connectLocalBroker(runtimeOptions)
      : await createRuntimeBindingTransport({
          ...bindingTransportOptions,
          kind: runtime === "headless-binding" ? "headless" : "visible",
        });
  return createClient(connection).createTray(options);
};
