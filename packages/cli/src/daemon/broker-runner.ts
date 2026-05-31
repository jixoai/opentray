import { createServer, type Server } from "node:net";
import { rm, writeFile } from "node:fs/promises";

import { PROTOCOL_VERSION } from "@opentray/spec";

import type { DaemonPaths } from "./paths";

export interface BrokerReadyFile {
  pid: number;
  endpoint: string;
  packageVersion: string;
  protocolVersion: number;
}

export const runBrokerUntilSignal = async (paths: DaemonPaths): Promise<void> => {
  if (process.platform !== "win32") {
    await rm(paths.endpoint, { force: true });
  }

  const server = createServer((socket) => {
    socket.end(
      `${JSON.stringify({
        type: "ready",
        protocolVersion: PROTOCOL_VERSION,
        brokerVersion: paths.packageVersion,
      })}\n`,
    );
  });

  await listen(server, paths.endpoint);
  await writeReadyFile(paths);
  await waitForShutdown(server);
};

const listen = (server: Server, endpoint: string): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });

const writeReadyFile = async (paths: DaemonPaths): Promise<void> => {
  const ready: BrokerReadyFile = {
    pid: process.pid,
    endpoint: paths.endpoint,
    packageVersion: paths.packageVersion,
    protocolVersion: paths.protocolVersion,
  };

  await writeFile(paths.readyFile, `${JSON.stringify(ready, null, 2)}\n`, "utf8");
};

const waitForShutdown = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };

    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
