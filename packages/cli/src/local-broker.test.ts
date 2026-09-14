// Orthogonal intents (2026-07-21; original user requests: persist the latest
// Darwin app launch command, converge stale Dock identities, and ship one
// coherent broker/runtime graph):
// 1. Verify caller-scoped broker startup and artifact identity handshakes.
// 2. Verify Darwin app-bundle mutation only after a successful handshake.
// 3. Verify request routing and deterministic connection teardown.

import { createServer, type Server, type Socket } from "node:net";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  type BrokerArtifactIdentity,
  type ClientFrame,
  type ServerFrame,
} from "@opentray/spec";
import { readDarwinAppLaunchDescriptor } from "@opentray/packaging";

import { connectLocalBroker } from "./local-broker";
import { resolveCallerLabel } from "./daemon/caller-label";
import type { DaemonDriver } from "./daemon/lifecycle";
import type { DaemonPaths } from "./daemon/paths";
import { resolveDaemonPaths } from "./daemon/paths";

const tempDirs: string[] = [];
const cleanup: Array<() => Promise<void>> = [];
const itOnDarwin = process.platform === "darwin" ? it : it.skip;

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

    await connection.close();
  });

  it("derives the caller label from the appId slug, never the display name (D4)", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      appId: "com.example.build",
      appName: "Example Build, 実験",
      daemonDriver: driver,
    });

    expect(driver.spawnedPaths[0]).toMatchObject({
      callerLabel: "com-example-build",
      appId: "com.example.build",
      appName: "Example Build, 実験",
    });
    expect(connection.callerLabel).toBe("com-example-build");

    await connection.close();
  });

  it("keeps display names out of the label chain when no appId exists (D4)", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      appName: "Example Build",
      daemonDriver: driver,
    });

    // No appId: the tool fallback chain owns the label; the display name
    // must not leak into any endpoint segment.
    expect(connection.callerLabel).not.toBe("example-build");
    expect(connection.callerLabel).toBe(resolveCallerLabel());

    await connection.close();
  });

  itOnDarwin("commits the latest app launch descriptor when a compatible broker is reused", async () => {
    const homeDir = await makeTempHome();
    await writeFile(join(homeDir, "package.json"), JSON.stringify({ name: "@example/app" }));
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);
    const bundlePath = join(homeDir, ".opentray/apps/@example+app/Example App.app");
    const staleBundle = join(homeDir, ".opentray/apps/webui/Example App.app");
    const legacyBundle = join(
      homeDir,
      ".opentray/0.1.0/com-example-reuse/runtime/darwin-carrier/OpenTray.app",
    );
    await Promise.all([
      prepareBundle(bundlePath, "com.example.reuse"),
      prepareBundle(staleBundle, "com.example.reuse"),
      prepareLegacyBundle(legacyBundle, "com.example.reuse"),
    ]);

    const first = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      appId: "com.example.reuse",
      appName: "Example App",
      packageName: "@example/app",
      packageRoot: homeDir,
      appLaunch: {
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: ["/tmp/first.mjs"],
        cwd: "/tmp/first",
      },
      daemonDriver: driver,
    });
    await first.close();

    const second = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      appId: "com.example.reuse",
      appName: "Example App",
      packageName: "@example/app",
      packageRoot: homeDir,
      appLaunch: {
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: ["/tmp/latest.mjs", "--dev"],
        cwd: "/tmp/latest",
      },
      daemonDriver: driver,
    });

    try {
      expect(driver.spawned).toBe(1);
      await expect(access(staleBundle)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(legacyBundle)).rejects.toMatchObject({ code: "ENOENT" });
      const brokerLog = join(
        homeDir,
        ".opentray/0.1.0/com-example-reuse/runtime/broker.log",
      );
      expect(await readFile(brokerLog, "utf8")).toContain("bundle-identity-convergence");
      expect(await readDarwinAppLaunchDescriptor(bundlePath)).toEqual({
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: ["/tmp/latest.mjs", "--dev"],
        cwd: "/tmp/latest",
      });
    } finally {
      await second.close();
    }
  });

  it("does not mutate a local app bundle through a successful external connection", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);
    const broker = await driver.resolveBroker(paths);
    await Promise.all([
      mkdir(dirname(paths.endpoint), { recursive: true }),
      mkdir(dirname(paths.readyFile), { recursive: true }),
    ]);
    await driver.spawnBroker(paths, broker);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      endpoint: paths.endpoint,
      autoStart: false,
      appBundle: { path: join(homeDir, "Ignored.app") },
      appLaunch: {
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: ["/tmp/app.mjs"],
        cwd: "/tmp",
      },
      daemonDriver: driver,
    });

    expect(driver.spawned).toBe(1);
    await expect(readDarwinAppLaunchDescriptor(join(homeDir, "Ignored.app"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    await connection.close();
  });

  it("rejects a ready frame from a broker with another artifact identity", async () => {
    const homeDir = await makeTempHome();
    await writeFile(join(homeDir, "package.json"), JSON.stringify({ name: "@example/app" }));
    const bundlePath = join(homeDir, ".opentray/apps/@example+app/Example App.app");
    const staleBundle = join(homeDir, ".opentray/apps/webui/Example App.app");
    await Promise.all([
      prepareBundle(bundlePath, "example-app"),
      prepareBundle(staleBundle, "example-app"),
    ]);
    await writeFile(
      join(bundlePath, "Contents/Resources/opentray-launch.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: ["/tmp/previous.mjs"],
        cwd: "/tmp/previous",
      })}\n`,
    );
    const driver = createSocketBrokerDriver(undefined, brokerIdentity("b"));
    cleanup.push(driver.close);

    await expect(
      connectLocalBroker({
        homeDir,
        packageVersion: "0.1.0",
        appName: "Example App",
        packageName: "@example/app",
        packageRoot: homeDir,
        appLaunch: {
          schemaVersion: 1,
          command: "/usr/bin/node",
          args: ["/tmp/must-not-commit.mjs"],
          cwd: "/tmp/new",
        },
        daemonDriver: driver,
      }),
    ).rejects.toThrow(/broker artifact identity mismatch/);
    expect(await readDarwinAppLaunchDescriptor(bundlePath)).toEqual({
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["/tmp/previous.mjs"],
      cwd: "/tmp/previous",
    });
    await expect(access(staleBundle)).resolves.toBeUndefined();
  });

  it("routes tray-bounds responses back to the pending request", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "get-tray-bounds") {
        socket.write(
          `${JSON.stringify({
            type: "tray-bounds",
            requestId: frame.requestId,
            appId: frame.appId,
            trayId: frame.trayId,
            bounds: {
              kind: "native",
              source: "backend.nativeTrayBounds",
              rect: { x: 10, y: 20, width: 24, height: 24 },
            },
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
      appId: "space-a",
      trayId: "tray-a",
    })) as Extract<ServerFrame, { type: "tray-bounds" }>;

    expect(frame.bounds).toEqual({
      kind: "native",
      source: "backend.nativeTrayBounds",
      rect: { x: 10, y: 20, width: 24, height: 24 },
    });
    await connection.close();
  });

  it("rejects in-flight and post-death requests and reports the terminal state when the broker dies (D3)", async () => {
    const homeDir = await makeTempHome();
    // get-tray-bounds is never answered: the request stays pending until death.
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });

    const terminalErrors: Error[] = [];
    connection.onConnectionDead((error) => terminalErrors.push(error));

    const inflight = connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-death",
      appId: "space-a",
      trayId: "tray-a",
    });
    driver.killConnections();
    await expect(inflight).rejects.toThrow("broker connection closed");

    expect(connection.connectionDead).toBe(true);
    expect(terminalErrors).toHaveLength(1);
    expect(terminalErrors[0]?.message).toBe("broker connection closed");

    // A request issued after death rejects immediately instead of hanging
    // on a destroyed socket (F2 zombie-entry root mechanics).
    await expect(
      connection.request({
        type: "get-tray-bounds",
        requestId: "bounds-post-death",
        appId: "space-a",
        trayId: "tray-a",
      }),
    ).rejects.toThrow("broker connection closed");

    // Explicit teardown after death stays finite.
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it("kills only its own broker-side sockets when simulating death (D3 harness)", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    expect(connection.sessionId).toBe("session-test");

    driver.killConnections();
    // Let the client socket observe the close so the terminal state settles
    // before the post-death request classifies against the sentinel.
    await new Promise((resolve) => setTimeout(resolve, 25));

    await expect(
      connection.request({
        type: "get-tray-bounds",
        requestId: "bounds-after-kill",
        appId: "space-a",
        trayId: "tray-a",
      }),
    ).rejects.toThrow("broker connection closed");
    expect(connection.connectionDead).toBe(true);
  });
});

const makeTempHome = async (): Promise<string> => {
  const dir = await mkdtemp("/tmp/ot-lb-");
  tempDirs.push(dir);
  return dir;
};

const prepareBundle = async (bundlePath: string, appId?: string): Promise<void> => {
  const resources = join(bundlePath, "Contents/Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    join(resources, "opentray-app-bundle.json"),
    `${JSON.stringify(appId === undefined ? {} : { schemaVersion: 1, appId })}\n`,
  );
};

const prepareLegacyBundle = async (bundlePath: string, appId: string): Promise<void> => {
  await mkdir(join(bundlePath, "Contents/Resources"), { recursive: true });
  await mkdir(join(bundlePath, "Contents/MacOS"), { recursive: true });
  await writeFile(join(bundlePath, "Contents/MacOS/opentray"), "broker");
  await writeFile(
    join(bundlePath, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>opentray</string><key>CFBundleIdentifier</key><string>${appId}</string></dict></plist>\n`,
  );
};

const createSocketBrokerDriver = (
  onFrame?: (frame: ClientFrame, socket: Socket) => void,
  readyFrameIdentity?: BrokerArtifactIdentity,
): DaemonDriver & {
  readonly spawned: number;
  readonly spawnedPaths: DaemonPaths[];
  killConnections(): void;
  close(): Promise<void>;
} => {
  const pid = 20_000;
  let spawned = 0;
  const spawnedPaths: DaemonPaths[] = [];
  const sockets = new Set<Socket>();
  let server: Server | undefined;

  return {
    get spawned() {
      return spawned;
    },
    spawnedPaths,
    killConnections() {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
    },
    async resolveBroker(paths) {
      return resolvedBroker(paths);
    },
    async isAlive(checkPid) {
      return checkPid === pid && server !== undefined;
    },
    async spawnBroker(paths, broker) {
      spawned += 1;
      spawnedPaths.push(paths);
      server = createReadyServer(paths, readyFrameIdentity ?? broker.artifactIdentity, onFrame, sockets);
      await listen(server, paths.endpoint);
      await writeReadyMetadata(paths, pid, broker.artifactIdentity);
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

const createReadyServer = (
  paths: DaemonPaths,
  brokerArtifactIdentity: BrokerArtifactIdentity,
  onFrame?: (frame: ClientFrame, socket: Socket) => void,
  sockets?: Set<Socket>,
): Server =>
  createServer((socket) => {
    sockets?.add(socket);
    socket.on("close", () => {
      sockets?.delete(socket);
    });
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
          writeReadyFrame(socket, paths, brokerArtifactIdentity);
          continue;
        }
        onFrame?.(frame, socket);
      }
    });
  });

const writeReadyFrame = (
  socket: Socket,
  paths: DaemonPaths,
  brokerArtifactIdentity: BrokerArtifactIdentity,
): void => {
  socket.write(
    `${JSON.stringify({
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      brokerVersion: paths.packageVersion,
      brokerArtifactIdentity,
      sessionId: "session-test",
    })}\n`,
  );
};

const brokerIdentity = (seed: string): BrokerArtifactIdentity => ({
  packageVersion: "0.1.0",
  target: { os: "darwin", arch: "arm64" },
  executableHash: seed.repeat(64),
  buildIdentity: `sha256:${seed.repeat(16)}`,
});

const resolvedBroker = (paths: DaemonPaths) => ({
  command: "/fake/opentray",
  args: [],
  executablePath: "/fake/opentray",
  artifactIdentity: {
    ...brokerIdentity("a"),
    packageVersion: paths.packageVersion,
  },
});

const writeReadyMetadata = async (
  paths: DaemonPaths,
  pid: number,
  brokerArtifactIdentity: BrokerArtifactIdentity,
): Promise<void> => {
  await writeFile(
    paths.readyFile,
    `${JSON.stringify({
      pid,
      endpoint: paths.endpoint,
      packageVersion: paths.packageVersion,
      protocolVersion: paths.protocolVersion,
      appId: paths.appId,
      appName: paths.appName,
      callerLabel: paths.callerLabel,
      executablePath: "/fake/opentray",
      brokerArtifactIdentity,
    })}\n`,
    "utf8",
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
