import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type ClientFrame, type ServerFrame } from "@opentray/spec";

import { connectLocalBroker } from "./local-broker";
import type { DaemonDriver } from "./daemon/lifecycle";
import type { DaemonPaths } from "./daemon/paths";
import { resolveDaemonPaths } from "./daemon/paths";

const tempDirs: string[] = [];
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("local broker client", () => {
  it("auto-starts the same-version daemon before connecting", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });

    expect(driver.spawned).toBe(1);
    expect(connection.sessionId).toBe("session-test");
    expect(connection.leaseId).toBe("session-test");

    await connection.close();
  });

  it("does not auto-start when explicit endpoint opts out", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createCountingDriver();

    await expect(
      connectLocalBroker({
        homeDir,
        packageVersion: "0.1.0",
        endpoint: paths.endpoint,
        autoStart: false,
        daemonDriver: driver,
      }),
    ).rejects.toThrow();

    expect(driver.spawned).toBe(0);
  });

  it("routes tray-bounds responses back to the pending request", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "get-tray-bounds") {
        socket.write(
          `${JSON.stringify({
            type: "tray-bounds",
            requestId: frame.requestId,
            spaceId: frame.spaceId,
            trayId: frame.trayId,
            bounds: { x: 10, y: 20, width: 24, height: 24 },
          })}\n`,
        );
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const frame = (await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-1",
      spaceId: "space-a",
      trayId: "tray-a",
    })) as Extract<ServerFrame, { type: "tray-bounds" }>;

    expect(frame.bounds).toEqual({ x: 10, y: 20, width: 24, height: 24 });
    await connection.close();
  });
});

const makeTempHome = async (): Promise<string> => {
  const dir = await mkdtemp("/tmp/ot-lb-");
  tempDirs.push(dir);
  return dir;
};

const createSocketBrokerDriver = (
  onFrame?: (frame: ClientFrame, socket: Socket) => void,
): DaemonDriver & {
  readonly spawned: number;
  close(): Promise<void>;
} => {
  const pid = 20_000;
  let spawned = 0;
  let server: Server | undefined;

  return {
    get spawned() {
      return spawned;
    },
    async isAlive(checkPid) {
      return checkPid === pid && server !== undefined;
    },
    async spawnBroker(paths) {
      spawned += 1;
      server = createReadyServer(paths, onFrame);
      await listen(server, paths.endpoint);
      await writeFile(paths.readyFile, `${JSON.stringify({ pid })}\n`, "utf8");
      return pid;
    },
    async stop() {
      await closeServer(server);
      server = undefined;
    },
    async close() {
      await closeServer(server);
      server = undefined;
    },
  };
};

const createCountingDriver = (): DaemonDriver & { readonly spawned: number } => {
  let spawned = 0;

  return {
    get spawned() {
      return spawned;
    },
    async isAlive() {
      return false;
    },
    async spawnBroker(paths) {
      spawned += 1;
      await writeFile(paths.readyFile, `${JSON.stringify({ pid: 30_000 })}\n`, "utf8");
      return 30_000;
    },
    async stop() {},
  };
};

const createReadyServer = (
  paths: DaemonPaths,
  onFrame?: (frame: ClientFrame, socket: Socket) => void,
): Server =>
  createServer((socket) => {
    socket.setEncoding("utf8");
    let initialized = false;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          return;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) {
          continue;
        }
        const frame = JSON.parse(line) as ClientFrame;
        if (!initialized) {
          initialized = true;
          writeReadyFrame(socket, paths);
          continue;
        }
        onFrame?.(frame, socket);
      }
    });
  });

const writeReadyFrame = (socket: Socket, paths: DaemonPaths): void => {
  socket.write(
    `${JSON.stringify({
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      brokerVersion: paths.packageVersion,
      sessionId: "session-test",
    })}\n`,
  );
};

const listen = (server: Server, endpoint: string): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });

const closeServer = (server: Server | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
