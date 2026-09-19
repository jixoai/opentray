// Orthogonal intents (2026-07-21; original user requests: persist the latest
// Darwin app launch command, converge stale Dock identities, and ship one
// coherent broker/runtime graph):
// 1. Verify caller-scoped broker startup and artifact identity handshakes.
// 2. Verify Darwin app-bundle mutation only after a successful handshake.
// 3. Verify request routing and deterministic connection teardown.

import { createServer, type Server, type Socket } from "node:net";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  type BrokerArtifactIdentity,
  type ClientFrame,
  type ServerFrame,
} from "@opentray/spec";
import { readDarwinAppLaunchDescriptor } from "@opentray/packaging";

import {
  BrokerProtocolVersionError,
  EXTENSION_TRANSPORT_CLOSED_CODE,
  ExtensionOperationError,
  LocalBrokerConnection,
  connectLocalBroker,
  type BrokerSocket,
  type TransportDeadlineExpiry,
} from "./local-broker";
import {
  BOOTSTRAP_CALL_DEADLINE_MS,
  BrokerServerError,
  TEARDOWN_CALL_DEADLINE_MS,
  TransportTimeoutError,
  createTrayHandle,
} from "./client";
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
    // Runtime-portable form: Node's access resolves undefined and Bun's
    // resolves null; only rejection carries meaning here.
    await access(staleBundle);
  });

  it("rejects a ready frame with a wrong protocol version before accepting the session", async () => {
    const homeDir = await makeTempHome();
    // Structurally valid Ready frame, but the broker announces protocol 1
    // while the client sent 2: a direct connection has no daemon-readiness
    // metadata protecting it, so init itself must reject.
    const driver = createSocketBrokerDriver(undefined, undefined, 1);
    cleanup.push(driver.close);

    const rejection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    }).then(
      () => {
        throw new Error("expected a rejection");
      },
      (error: unknown) => error
    );
    expect(rejection).toBeInstanceOf(BrokerProtocolVersionError);
    expect(rejection).toBeInstanceOf(Error);
    const typed = rejection as BrokerProtocolVersionError;
    expect(typed.clientProtocolVersion).toBe(2);
    expect(typed.brokerProtocolVersion).toBe(1);
    expect(typed.message).toContain("client=2");
    expect(typed.message).toContain("broker=1");
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

describe("local broker client deferred operations (pending-until-final)", () => {
  const writeFrame = (socket: Socket, frame: ServerFrame): void => {
    socket.write(`${JSON.stringify(frame)}\n`);
  };

  const writeAccepted = (socket: Socket, requestId: string, operationId: string): void => {
    writeFrame(socket, { type: "ext-command-accepted", requestId, operationId });
  };

  const writeTerminal = (
    socket: Socket,
    operationId: string,
    payload: Extract<ServerFrame, { type: "ext-operation-terminal" }>["payload"]
  ): void => {
    writeFrame(socket, { type: "ext-operation-terminal", operationId, payload });
  };

  const boundsFrame = (
    frame: Extract<ClientFrame, { type: "get-tray-bounds" }>
  ): ServerFrame => ({
    type: "tray-bounds",
    requestId: frame.requestId,
    appId: frame.appId,
    trayId: frame.trayId,
    bounds: {
      kind: "native",
      source: "backend.nativeTrayBounds",
      rect: { x: 1, y: 2, width: 24, height: 24 },
    },
  });

  it("sends init with protocol version 2 (v2 matrix, Rust parity)", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });

    expect(driver.initFrames).toHaveLength(1);
    expect(driver.initFrames[0]).toMatchObject({
      type: "init",
      clientVersion: "test-client",
    });
    expect(
      (driver.initFrames[0] as Extract<ClientFrame, { type: "init" }>).protocolVersion
    ).toBe(2);
    expect((driver.initFrames[0] as Extract<ClientFrame, { type: "init" }>).protocolVersion).toBe(
      PROTOCOL_VERSION
    );
    await connection.close();
  });

  it("keeps a deferred command pending on acceptance, settles once on the terminal, and drops duplicate terminals", async () => {
    const homeDir = await makeTempHome();
    const operationId = "000000000000000f";
    let serverSocket: Socket | undefined;
    const driver = createSocketBrokerDriver((frame, socket) => {
      serverSocket = socket;
      if (frame.type === "ext-command") {
        writeAccepted(socket, frame.requestId, operationId);
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });

    const ordinaryA = connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-a",
      appId: "app-1",
      trayId: "tray-1",
    });
    const deferred = connection.request({
      type: "ext-command",
      requestId: "ext-deferred",
      appId: "app-1",
      trayId: "tray-1",
      ext: "dialog",
      data: { type: "show" },
    });
    // Socket ordering: bounds-b's response is written after the acceptance,
    // so resolving it proves the acceptance was consumed while the deferred
    // request stayed pending.
    const ordinaryB = connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-b",
      appId: "app-1",
      trayId: "tray-1",
    });

    await expect(ordinaryA).resolves.toMatchObject({
      type: "tray-bounds",
      requestId: "bounds-a",
    });
    await expect(ordinaryB).resolves.toMatchObject({
      type: "tray-bounds",
      requestId: "bounds-b",
    });
    const pendingProbe = await Promise.race([
      deferred.then(() => "settled"),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("pending"), 25);
      }),
    ]);
    expect(pendingProbe).toBe("pending");

    if (serverSocket === undefined) {
      throw new Error("server socket was not captured");
    }
    writeTerminal(serverSocket, operationId, {
      kind: "result",
      value: { response: 1, suppressed: false },
    });
    const terminal = (await deferred) as Extract<
      ServerFrame,
      { type: "ext-operation-terminal" }
    >;
    expect(terminal).toEqual({
      type: "ext-operation-terminal",
      operationId,
      payload: { kind: "result", value: { response: 1, suppressed: false } },
    });

    // Duplicate terminal, terminal for an unknown operationId, and an
    // acceptance for an unknown requestId are all dropped statelessly: the
    // connection stays alive and ordinary traffic keeps flowing.
    writeTerminal(serverSocket, operationId, {
      kind: "result",
      value: { response: 2, suppressed: false },
    });
    writeTerminal(serverSocket, "000000000000000e", {
      kind: "error",
      error: { code: "dialog_session_busy", message: "foreign" },
    });
    writeAccepted(serverSocket, "request-never-issued", "000000000000000a");
    const after = await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-after",
      appId: "app-1",
      trayId: "tray-1",
    });
    expect(after).toMatchObject({ type: "tray-bounds", requestId: "bounds-after" });
    expect(connection.connectionDead).toBe(false);
    await connection.close();
  });

  it("rejects the deferred promise with the typed wire error payload", async () => {
    const homeDir = await makeTempHome();
    const operationId = "000000000000001e";
    let serverSocket: Socket | undefined;
    const driver = createSocketBrokerDriver((frame, socket) => {
      serverSocket = socket;
      if (frame.type === "ext-command") {
        writeAccepted(socket, frame.requestId, operationId);
        // Socket ordering: the terminal is written after the acceptance.
        writeTerminal(socket, operationId, {
          kind: "error",
          error: {
            code: "dialog_dismissal_unavailable",
            message: "platform cannot observe the dismissal reason",
            details: { kind: "dismissal" },
          },
        });
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const deferred = connection.request({
      type: "ext-command",
      requestId: "ext-error",
      appId: "app-1",
      trayId: "tray-1",
      ext: "dialog",
      data: { type: "show" },
    });

    const error = await deferred.then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(error).toBeInstanceOf(ExtensionOperationError);
    expect(error).toBeInstanceOf(Error);
    const typed = error as ExtensionOperationError;
    expect(typed.code).toBe("dialog_dismissal_unavailable");
    expect(typed.message).toBe("platform cannot observe the dismissal reason");
    expect(typed.details).toEqual({ kind: "dismissal" });
    await connection.close();
  });

  it("rejects accepted operations with the generic typed transport-close error on death (sentinel for ordinary requests)", async () => {
    const homeDir = await makeTempHome();
    const operationId = "000000000000002d";
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "ext-command") {
        writeAccepted(socket, frame.requestId, operationId);
        return;
      }
      // `bounds-death` is deliberately never answered: it stays pending until
      // the transport dies and must reject with the plain sentinel.
      if (frame.type === "get-tray-bounds" && frame.requestId !== "bounds-death") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const terminalErrors: Error[] = [];
    connection.onConnectionDead((error) => terminalErrors.push(error));

    // Never answered: stays pending until the transport dies.
    const ordinary = connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-death",
      appId: "app-1",
      trayId: "tray-1",
    });
    const deferred = connection.request({
      type: "ext-command",
      requestId: "ext-death",
      appId: "app-1",
      trayId: "tray-1",
      ext: "dialog",
      data: { type: "show" },
    });
    // Wait for the acceptance to be consumed before simulating death.
    await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-probe",
      appId: "app-1",
      trayId: "tray-1",
    });

    driver.killConnections();

    const typedError = await deferred.then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(typedError).toBeInstanceOf(ExtensionOperationError);
    expect(typedError).toBeInstanceOf(Error);
    expect((typedError as ExtensionOperationError).code).toBe(EXTENSION_TRANSPORT_CLOSED_CODE);
    expect((typedError as ExtensionOperationError).code).toBe("extension_transport_closed");

    await expect(ordinary).rejects.toThrow("broker connection closed");
    const ordinaryError = await ordinary.then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(ordinaryError).not.toBeInstanceOf(ExtensionOperationError);
    expect(ordinaryError).toBeInstanceOf(Error);

    expect(connection.connectionDead).toBe(true);
    expect(terminalErrors).toHaveLength(1);
    expect(terminalErrors[0]?.message).toBe("broker connection closed");
    await connection.close();
  });

  it("rejects a correlated synchronous server error with the typed error contract", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "ext-command") {
        writeFrame(socket, {
          type: "error",
          requestId: frame.requestId,
          code: "dialog_presentation_failed",
          message: "worker did not reach the native modal call",
          details: { worker: "owner-1", phase: "enter-modal" },
        });
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const error = await connection
      .request({
        type: "ext-command",
        requestId: "ext-sync-error",
        appId: "app-1",
        trayId: "tray-1",
        ext: "dialog",
        data: { type: "show" },
      })
      .then(
        () => {
          throw new Error("expected a rejection");
        },
        (rejection: unknown) => rejection
      );

    expect(error).toBeInstanceOf(BrokerServerError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ExtensionOperationError);
    const typed = error as BrokerServerError;
    expect(typed.name).toBe("BrokerServerError");
    expect(typed.code).toBe("dialog_presentation_failed");
    expect(typed.message).toBe("worker did not reach the native modal call");
    expect(typed.details).toEqual({ worker: "owner-1", phase: "enter-modal" });

    // The typed synchronous rejection leaves the connection alive.
    const after = await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-after-sync-error",
      appId: "app-1",
      trayId: "tray-1",
    });
    expect(after).toMatchObject({
      type: "tray-bounds",
      requestId: "bounds-after-sync-error",
    });
    await connection.close();
  });

  it("rejects a not-yet-accepted ext-command like any ordinary pending request on death", async () => {
    const homeDir = await makeTempHome();
    // The server never accepts: the command is an ordinary pending request.
    const driver = createSocketBrokerDriver();
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const deferred = connection.request({
      type: "ext-command",
      requestId: "ext-pre-accept",
      appId: "app-1",
      trayId: "tray-1",
      ext: "dialog",
      data: { type: "show" },
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    driver.killConnections();

    const error = await deferred.then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );
    expect(error).not.toBeInstanceOf(ExtensionOperationError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("broker connection closed");
    await connection.close();
  });
});

describe("local broker client per-call deadlines and bounded teardown (W1/W3)", () => {
  const writeFrame = (socket: Socket, frame: ServerFrame): void => {
    socket.write(`${JSON.stringify(frame)}\n`);
  };

  const boundsFrame = (
    frame: Extract<ClientFrame, { type: "get-tray-bounds" }>
  ): ServerFrame => ({
    type: "tray-bounds",
    requestId: frame.requestId,
    appId: frame.appId,
    trayId: frame.trayId,
    bounds: {
      kind: "native",
      source: "backend.nativeTrayBounds",
      rect: { x: 3, y: 4, width: 24, height: 24 },
    },
  });

  it("rejects a never-answered interactive request in budget, without declaring death (W1)", async () => {
    const homeDir = await makeTempHome();
    // Half-open shape: the broker answers ordinary traffic but the wedged
    // requestId is never answered.
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "get-tray-bounds" && frame.requestId === "bounds-wedge") {
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const terminalErrors: Error[] = [];
    connection.onConnectionDead((error) => terminalErrors.push(error));
    const expiries: TransportDeadlineExpiry[] = [];
    connection.onDeadlineExpiry((expiry) => expiries.push(expiry));

    const error = await connection
      .request(
        {
          type: "get-tray-bounds",
          requestId: "bounds-wedge",
          appId: "app-1",
          trayId: "tray-1",
        },
        { deadlineMs: 60 },
      )
      .then(
        () => {
          throw new Error("expected a rejection");
        },
        (rejection: unknown) => rejection
      );

    expect(error).toBeInstanceOf(TransportTimeoutError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BrokerServerError);
    expect(error).not.toBeInstanceOf(ExtensionOperationError);
    const typed = error as TransportTimeoutError;
    expect(typed.requestId).toBe("bounds-wedge");
    expect(typed.deadlineMs).toBe(60);

    // A timeout settles one call; it is never a death verdict (W1 law: the
    // expiry only feeds the later heartbeat's failure classification).
    expect(connection.connectionDead).toBe(false);
    expect(terminalErrors).toHaveLength(0);
    expect(expiries).toEqual([{ requestId: "bounds-wedge", deadlineMs: 60 }]);

    const after = await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-after-wedge",
      appId: "app-1",
      trayId: "tray-1",
    });
    expect(after).toMatchObject({
      type: "tray-bounds",
      requestId: "bounds-after-wedge",
    });
    await connection.close();
  });

  it("discards a late reply after its deadline without settling anything or throwing (W1)", async () => {
    const homeDir = await makeTempHome();
    let serverSocket: Socket | undefined;
    const driver = createSocketBrokerDriver((frame, socket) => {
      serverSocket = socket;
      if (frame.type === "get-tray-bounds" && frame.requestId === "bounds-late") {
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });

    const error = await connection
      .request(
        {
          type: "get-tray-bounds",
          requestId: "bounds-late",
          appId: "app-1",
          trayId: "tray-1",
        },
        { deadlineMs: 40 },
      )
      .then(
        () => {
          throw new Error("expected a rejection");
        },
        (rejection: unknown) => rejection
      );
    expect(error).toBeInstanceOf(TransportTimeoutError);

    if (serverSocket === undefined) {
      throw new Error("server socket was not captured");
    }
    // The reply arrives after its budget: the pending entry is gone, so the
    // transport drops it statelessly — no second settlement, no throw.
    writeFrame(serverSocket, {
      type: "tray-bounds",
      requestId: "bounds-late",
      appId: "app-1",
      trayId: "tray-1",
      bounds: {
        kind: "native",
        source: "backend.nativeTrayBounds",
        rect: { x: 9, y: 9, width: 24, height: 24 },
      },
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    expect(connection.connectionDead).toBe(false);
    const after = await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-after-late",
      appId: "app-1",
      trayId: "tray-1",
    });
    expect(after).toMatchObject({ type: "tray-bounds", requestId: "bounds-after-late" });
    await connection.close();
  });

  it("keeps healthy round-trips free of timeout observables (W1 happy path)", async () => {
    const homeDir = await makeTempHome();
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const expiries: TransportDeadlineExpiry[] = [];
    connection.onDeadlineExpiry((expiry) => expiries.push(expiry));

    const responses = await Promise.all(
      ["bounds-happy-1", "bounds-happy-2", "bounds-happy-3"].map((requestId) =>
        connection.request({
          type: "get-tray-bounds",
          requestId,
          appId: "app-1",
          trayId: "tray-1",
        }),
      ),
    );
    expect(
      responses.map((frame) =>
        frame.type === "tray-bounds" ? frame.requestId : `unexpected-${frame.type}`
      )
    ).toEqual(["bounds-happy-1", "bounds-happy-2", "bounds-happy-3"]);
    expect(expiries).toEqual([]);
    expect(connection.connectionDead).toBe(false);
    await connection.close();
  });

  it("keeps an accepted deferred operation past its dispatch deadline and settles once on its terminal (W1 two-phase law)", async () => {
    const homeDir = await makeTempHome();
    const operationId = "000000000000003c";
    let serverSocket: Socket | undefined;
    const driver = createSocketBrokerDriver((frame, socket) => {
      serverSocket = socket;
      if (frame.type === "ext-command") {
        writeFrame(socket, {
          type: "ext-command-accepted",
          requestId: frame.requestId,
          operationId,
        });
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const expiries: TransportDeadlineExpiry[] = [];
    connection.onDeadlineExpiry((expiry) => expiries.push(expiry));

    const deferred = connection.request(
      {
        type: "ext-command",
        requestId: "ext-deferred-held",
        appId: "app-1",
        trayId: "tray-1",
        ext: "dialog",
        data: { type: "show" },
      },
      // The dispatch budget expires well before the user-paced terminal: a
      // held modal dialog must never be settled by a transport deadline.
      { deadlineMs: 50 },
    );
    let settled = false;
    void deferred.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 90);
    });
    expect(settled).toBe(false);
    expect(expiries).toEqual([]);

    if (serverSocket === undefined) {
      throw new Error("server socket was not captured");
    }
    writeFrame(serverSocket, {
      type: "ext-operation-terminal",
      operationId,
      payload: { kind: "result", value: { userClosed: true } },
    });
    const terminal = await deferred;
    expect(terminal).toMatchObject({
      type: "ext-operation-terminal",
      operationId,
    });
    expect(connection.connectionDead).toBe(false);
    await connection.close();
  });

  it("times out an unaccepted deferred dispatch with the timeout class and drops its late acceptance (W1)", async () => {
    const homeDir = await makeTempHome();
    const operationId = "000000000000003d";
    let serverSocket: Socket | undefined;
    const driver = createSocketBrokerDriver((frame, socket) => {
      serverSocket = socket;
      // The wedge shape: no acceptance is ever sent for the ext-command —
      // this is the dispatch phase the deadline owns.
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const expiries: TransportDeadlineExpiry[] = [];
    connection.onDeadlineExpiry((expiry) => expiries.push(expiry));

    const error = await connection
      .request(
        {
          type: "ext-command",
          requestId: "ext-deferred-wedge",
          appId: "app-1",
          trayId: "tray-1",
          ext: "dialog",
          data: { type: "show" },
        },
        { deadlineMs: 50 },
      )
      .then(
        () => {
          throw new Error("expected a rejection");
        },
        (rejection: unknown) => rejection
      );

    // The timeout is the third class: it is neither the frozen
    // extension_transport_closed transport-death mapping (add-ext-dialog 5.1)
    // nor a broker wire error.
    expect(error).toBeInstanceOf(TransportTimeoutError);
    expect(error).not.toBeInstanceOf(ExtensionOperationError);
    expect((error as TransportTimeoutError).requestId).toBe("ext-deferred-wedge");
    expect(expiries).toEqual([
      { requestId: "ext-deferred-wedge", deadlineMs: 50 },
    ]);

    if (serverSocket === undefined) {
      throw new Error("server socket was not captured");
    }
    // Late acceptance and terminal for the expired dispatch both find no
    // owner and settle nothing.
    writeFrame(serverSocket, {
      type: "ext-command-accepted",
      requestId: "ext-deferred-wedge",
      operationId,
    });
    writeFrame(serverSocket, {
      type: "ext-operation-terminal",
      operationId,
      payload: { kind: "result", value: { late: true } },
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    expect(connection.connectionDead).toBe(false);
    const after = await connection.request({
      type: "get-tray-bounds",
      requestId: "bounds-after-deferred-wedge",
      appId: "app-1",
      trayId: "tray-1",
    });
    expect(after).toMatchObject({
      type: "tray-bounds",
      requestId: "bounds-after-deferred-wedge",
    });
    await connection.close();
  });

  it("settles a wedged handle destroy within the teardown budget while still issuing the native destroy (W3)", async () => {
    const homeDir = await makeTempHome();
    let destroySeen = false;
    const driver = createSocketBrokerDriver((frame, socket) => {
      if (frame.type === "destroy-tray") {
        destroySeen = true;
        return;
      }
      if (frame.type === "get-tray-bounds") {
        writeFrame(socket, boundsFrame(frame));
      }
    });
    cleanup.push(driver.close);

    const connection = await connectLocalBroker({
      homeDir,
      packageVersion: "0.1.0",
      clientVersion: "test-client",
      daemonDriver: driver,
    });
    const terminalErrors: Error[] = [];
    connection.onConnectionDead((error) => terminalErrors.push(error));

    const handle = createTrayHandle(connection, "app-1", "tray-1");
    const startedAt = Date.now();
    const error = await handle.destroy().then(
      () => {
        throw new Error("expected a rejection");
      },
      (rejection: unknown) => rejection
    );

    // The teardown-class transport deadline bounds the wedged round-trip
    // (scenario shape from the pnpm-pub incident compensation): the promise
    // settles inside the budget and the native destroy frame was still sent.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(error).toBeInstanceOf(TransportTimeoutError);
    expect((error as TransportTimeoutError).deadlineMs).toBe(TEARDOWN_CALL_DEADLINE_MS);
    expect(destroySeen).toBe(true);
    // Caller-initiated teardown never declares death and never feeds recovery:
    // the expiry settled one call, the connection stays open until close().
    expect(connection.connectionDead).toBe(false);
    expect(terminalErrors).toHaveLength(0);
    await connection.close();
  });

  it("rejects init within the bootstrap budget when the broker never answers (W1)", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeBrokerSocket();
      const connection = new LocalBrokerConnection(socket, "fake-endpoint", "test-label");
      const expiries: TransportDeadlineExpiry[] = [];
      connection.onDeadlineExpiry((expiry) => expiries.push(expiry));

      const rejection = connection
        .init("test-client", PROTOCOL_VERSION, brokerIdentity("a"))
        .then(
          () => {
            throw new Error("expected a rejection");
          },
          (error: unknown) => error
        );
      await vi.advanceTimersByTimeAsync(BOOTSTRAP_CALL_DEADLINE_MS);
      const error = await rejection;

      expect(error).toBeInstanceOf(TransportTimeoutError);
      const typed = error as TransportTimeoutError;
      expect(typed.requestId).toBe("init");
      expect(typed.deadlineMs).toBe(BOOTSTRAP_CALL_DEADLINE_MS);
      expect(connection.connectionDead).toBe(false);
      expect(expiries).toEqual([
        { requestId: "init", deadlineMs: BOOTSTRAP_CALL_DEADLINE_MS },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades close() to socket destroy when the graceful end wedges (W3)", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeBrokerSocket();
      const connection = new LocalBrokerConnection(socket, "fake-endpoint", "test-label");
      const artifactIdentity = brokerIdentity("a");
      const initPromise = connection.init("test-client", PROTOCOL_VERSION, artifactIdentity);
      socket.receive(
        `${JSON.stringify({
          type: "ready",
          protocolVersion: PROTOCOL_VERSION,
          brokerVersion: "0.1.0",
          brokerArtifactIdentity: artifactIdentity,
          sessionId: "session-fake",
        })}\n`,
      );
      await initPromise;
      expect(connection.sessionId).toBe("session-fake");

      // The wedged socket accepts end() but never completes it; close() must
      // still resolve — degrading to destroy, never rejecting with a timeout.
      const settled = connection.close().then(() => "resolved" as const);
      await vi.advanceTimersByTimeAsync(TEARDOWN_CALL_DEADLINE_MS);
      expect(await settled).toBe("resolved");
      expect(socket.destroyed).toBe(true);
      expect(socket.written.some((line) => line.includes('"exit"'))).toBe(true);
      // The forced destroy reports through the existing death path, keeping
      // the terminal surface coherent after degraded teardown.
      expect(connection.connectionDead).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

const makeTempHome = async (): Promise<string> => {
  const dir = await mkdtemp("/tmp/ot-lb-");
  tempDirs.push(dir);
  return dir;
};

/**
 * Deterministic in-memory BrokerSocket for the deadline paths whose real
 * budget constants (bootstrap 10 s, teardown 2 s) would make live-socket
 * tests needlessly slow: a never-answering broker for init, and a wedged
 * graceful end for close() degradation. Everything is driven by
 * `receive`/`destroy` and vitest fake timers; no real I/O exists.
 */
class FakeBrokerSocket implements BrokerSocket {
  readonly written: string[] = [];
  ended = false;
  destroyed = false;
  private readonly dataListeners = new Set<(chunk: Buffer | string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<() => void>();
  private endCallback: (() => void) | undefined;

  setEncoding(_encoding: BufferEncoding): void {}

  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    if (event === "data") {
      this.dataListeners.add(listener as (chunk: Buffer | string) => void);
      return;
    }
    if (event === "error") {
      this.errorListeners.add(listener as (error: Error) => void);
      return;
    }
    this.closeListeners.add(listener as () => void);
  }

  once(event: "connect", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: string, listener: (...args: never[]) => void): void {
    if (event === "connect") {
      (listener as () => void)();
      return;
    }
    this.errorListeners.add(listener as (error: Error) => void);
  }

  off(event: "error", listener: (error: Error) => void): void {
    this.errorListeners.delete(listener);
  }

  write(data: string): void {
    this.written.push(data);
  }

  end(callback: () => void): void {
    // Wedged by design: the half-close is accepted but its completion is
    // never delivered until destroy() runs.
    this.ended = true;
    this.endCallback = callback;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.endCallback = undefined;
    for (const listener of [...this.closeListeners]) {
      listener();
    }
  }

  /** Delivers one received line exactly as the real socket's "data" event would. */
  receive(line: string): void {
    for (const listener of [...this.dataListeners]) {
      listener(line);
    }
  }
}

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
  readyProtocolVersion?: number
): DaemonDriver & {
  readonly spawned: number;
  readonly spawnedPaths: DaemonPaths[];
  readonly initFrames: ClientFrame[];
  killConnections(): void;
  close(): Promise<void>;
} => {
  const pid = 20_000;
  let spawned = 0;
  const spawnedPaths: DaemonPaths[] = [];
  const initFrames: ClientFrame[] = [];
  const sockets = new Set<Socket>();
  let server: Server | undefined;

  return {
    get spawned() {
      return spawned;
    },
    spawnedPaths,
    initFrames,
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
      server = createReadyServer(
        paths,
        readyFrameIdentity ?? broker.artifactIdentity,
        onFrame,
        sockets,
        initFrames,
        readyProtocolVersion
      );
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
  initFrames?: ClientFrame[],
  readyProtocolVersion?: number
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
          initFrames?.push(frame);
          writeReadyFrame(socket, paths, brokerArtifactIdentity, readyProtocolVersion);
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
  readyProtocolVersion?: number
): void => {
  socket.write(
    `${JSON.stringify({
      type: "ready",
      protocolVersion: readyProtocolVersion ?? PROTOCOL_VERSION,
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
