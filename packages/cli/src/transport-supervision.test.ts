// Orthogonal intents (2026-09-20; harden-transport-robustness Phase C/D):
// 1. Verify idle-gated heartbeat death detection (wedged probes, busy
//    transports, socket close) inside the bounded detection window.
// 2. Verify recovery: reconnect, declarative journal replay (identity
//    injection, last-write-wins, mount order), facade rebuild callbacks,
//    and the healthy -> recovering -> healthy state edges.
// 3. Verify budget exhaustion (no loop, typed fail-fast) and the Tier 2
//    restartApp hand-over (exactly once, no reconnect).
// 4. Verify caller-initiated teardown never triggers recovery.
// 5. Verify consumer event subscriptions survive generation changes while
//    dead generations stop delivering.

import { createServer, type Server, type Socket } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  type BrokerArtifactIdentity,
  type ClientFrame,
  type RequestId,
  type ServerFrame,
} from "@opentray/spec";

import {
  BROKER_CONNECTION_CLOSED_MESSAGE,
  connectLocalBroker,
  type LocalBrokerClient,
  type LocalRuntimeEventFrame,
} from "./local-broker";
import { TEARDOWN_CALL_DEADLINE_MS, TransportTimeoutError } from "./client";
import {
  TransportAbandonedError,
  createTransportSupervisor,
  type CreateTransportSupervisorOptions,
  type SupervisedLocalBrokerConnection,
  type TransportRecoveryOptions,
} from "./transport-supervision";
import type { DaemonDriver } from "./daemon/lifecycle";

// Every test drives in-process fake generations (or an in-process socket
// driver) — never a real broker process. The real kill -9 drill is Phase E.
const SHORT_HEARTBEAT = {
  heartbeatIntervalMs: 30,
  probeDeadlineMs: 20,
  heartbeatFailureThreshold: 2,
} as const;

const FAST_RECOVERY: TransportRecoveryOptions = {
  maxRestarts: 3,
  windowMs: 60_000,
  cooldownMs: 1,
};

const tempDirs: string[] = [];
const supervisorTeardown: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(
    supervisorTeardown
      .splice(0)
      .map((shutdown) => shutdown().catch(() => undefined)),
  );
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

const eventually = async (
  read: () => boolean,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(read()).toBe(true);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Strict-indexed access: every poll-ordered fixture element must exist. */
const at = <T>(list: readonly T[], index: number): T => {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`expected element ${index} to exist`);
  }
  return value;
};

/** Recorded request frame plus the per-call deadline the supervisor forwarded. */
interface RecordedRequest {
  frame: ClientFrame & { requestId: RequestId };
  deadlineMs: number | undefined;
}

/**
 * Deterministic in-process broker connection: answers frame classes the way
 * the real local broker does, honors per-call deadlines (Phase A behavior)
 * including the expiry seam, and can be killed or wedged per test.
 */
class FakeGeneration implements LocalBrokerClient {
  readonly endpoint = "fake-endpoint";
  readonly callerLabel = "test-label";
  readonly frames: RecordedRequest[] = [];
  sessionId: string;
  dead = false;
  closeCount = 0;
  /** Health probe behavior: `wedge` never answers (half-open transport). */
  probeBehavior: "answer" | "wedge" = "answer";
  /** Frame types that never settle (deadline expiry + typed rejection). */
  readonly wedgeTypes = new Set<string>();
  /** Response appId for resolve-default-app (drives replay rewrites). */
  defaultAppId = "app-default";
  private readonly deadListeners = new Set<(error: Error) => void>();
  private readonly expiryListeners = new Set<(expiry: {
    requestId: RequestId;
    deadlineMs: number;
  }) => void>();
  private readonly eventListeners = new Set<(frame: LocalRuntimeEventFrame) => void>();

  constructor(
    readonly id: number,
    sessionId = `session-${id}`,
  ) {
    this.sessionId = sessionId;
  }

  get connectionDead(): boolean {
    return this.dead;
  }

  onConnectionDead(listener: (error: Error) => void): () => void {
    this.deadListeners.add(listener);
    return () => {
      this.deadListeners.delete(listener);
    };
  }

  onDeadlineExpiry(
    listener: (expiry: { requestId: RequestId; deadlineMs: number }) => void,
  ): () => void {
    this.expiryListeners.add(listener);
    return () => {
      this.expiryListeners.delete(listener);
    };
  }

  onEvent(listener: (frame: LocalRuntimeEventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  emitEvent(frame: LocalRuntimeEventFrame): void {
    for (const listener of [...this.eventListeners]) {
      listener(frame);
    }
  }

  kill(): void {
    if (this.dead) {
      return;
    }
    this.dead = true;
    const error = new Error(BROKER_CONNECTION_CLOSED_MESSAGE);
    for (const listener of [...this.deadListeners]) {
      listener(error);
    }
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    if (!this.dead) {
      // Real socket semantics: the close event is asynchronous, not part of
      // the close() call stack.
      await new Promise((resolve) => setImmediate(resolve));
      this.kill();
    }
  }

  async request(
    frame: ClientFrame & { requestId: RequestId },
    options: { deadlineMs?: number } = {},
  ): Promise<ServerFrame> {
    this.frames.push({ frame, deadlineMs: options.deadlineMs });
    if (this.dead) {
      throw new Error(BROKER_CONNECTION_CLOSED_MESSAGE);
    }
    const deadlineMs = options.deadlineMs ?? 5_000;
    if (
      this.wedgeTypes.has(frame.type) ||
      (frame.type === "health" && this.probeBehavior === "wedge")
    ) {
      return this.wedge(frame.requestId, deadlineMs);
    }
    switch (frame.type) {
      case "resolve-default-app":
        return {
          type: "default-app",
          requestId: frame.requestId,
          app: { appId: this.defaultAppId },
        };
      case "create-tray":
        return {
          type: "tray-created",
          requestId: frame.requestId,
          appId: frame.app.appId,
          trayId: frame.tray.id,
        };
      case "get-tray-bounds":
        return {
          type: "tray-bounds",
          requestId: frame.requestId,
          appId: frame.appId,
          trayId: frame.trayId,
          bounds: {
            kind: "native",
            source: "test",
            rect: { x: 0, y: 0, width: 1, height: 1 },
          },
        };
      case "health":
        return {
          type: "runtime-host-health",
          requestId: frame.requestId,
          health: {
            pid: 1,
            packageVersion: "0.0.0",
            protocolVersion: PROTOCOL_VERSION,
            endpoint: this.endpoint,
            appId: "app-default",
            appName: "Test",
            callerLabel: this.callerLabel,
            sessionCount: 0,
            sessions: [],
          },
        };
      default:
        return { type: "ack", requestId: frame.requestId };
    }
  }

  private wedge(requestId: RequestId, deadlineMs: number): Promise<ServerFrame> {
    return new Promise((_, reject) => {
      const timer = setTimeout(() => {
        for (const listener of [...this.expiryListeners]) {
          listener({ requestId, deadlineMs });
        }
        reject(new TransportTimeoutError(requestId, deadlineMs));
      }, deadlineMs);
      timer.unref();
    });
  }
}

interface Harness {
  readonly supervisor: SupervisedLocalBrokerConnection;
  readonly generations: FakeGeneration[];
  readonly connectCalls: () => number;
}

const createHarness = (
  overrides: Partial<CreateTransportSupervisorOptions> = {},
  behavior: {
    /** Thrown for every respawn attempt (ordinal > 1), simulating a dead spawner. */
    connectErrorFactory?: (ordinal: number) => Error;
    /** Applied to each generation at creation, before the supervisor sees it. */
    configureGeneration?: (generation: FakeGeneration, ordinal: number) => void;
  } = {},
): Harness => {
  const generations: FakeGeneration[] = [];
  const factory = vi.fn(async (): Promise<LocalBrokerClient> => {
    const ordinal = generations.length + 1;
    if (behavior.connectErrorFactory !== undefined && ordinal > 1) {
      throw behavior.connectErrorFactory(ordinal);
    }
    const generation = new FakeGeneration(ordinal);
    behavior.configureGeneration?.(generation, ordinal);
    generations.push(generation);
    return generation;
  });
  const supervisor = createTransportSupervisor({
    connect: () => factory(),
    ...SHORT_HEARTBEAT,
    recovery: FAST_RECOVERY,
    ...overrides,
  });
  supervisorTeardown.push(() => supervisor.shutdown());
  return {
    supervisor,
    generations,
    connectCalls: () => factory.mock.calls.length,
  };
};

describe("transport supervision heartbeat (W2)", () => {
  it("declares death within the bounded window when probes wedge", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    at(generations, 0).probeBehavior = "wedge";
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));
    const deaths: Error[] = [];
    supervisor.onConnectionDead((error) => deaths.push(error));

    // Await the stable post-recovery state rather than the transient
    // `recovering` edge (cooldown is 1 ms here); the captured edge sequence
    // proves the death transition fired inside the bounded window.
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );

    expect(deaths).toHaveLength(1);
    expect(at(deaths, 0).message).toBe(BROKER_CONNECTION_CLOSED_MESSAGE);
    expect(states).toEqual(["recovering", "healthy"]);
    // The half-open generation was torn down (bounded close) so its pending
    // entries reject through the socket-close path.
    expect(at(generations, 0).closeCount).toBe(1);
  });

  it("sends zero probes while the transport keeps settling requests", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    // Busy window: a successful settlement every 10 ms against a 30 ms
    // interval proves liveness, so no probe budget is spent.
    for (let index = 0; index < 12; index += 1) {
      await supervisor.request({
        type: "get-tray-bounds",
        requestId: `busy-${index}`,
        appId: "app-default",
        trayId: "status",
      });
      await sleep(10);
    }
    expect(
      at(generations, 0).frames.filter(({ frame }) => frame.type === "health"),
    ).toHaveLength(0);
    expect(supervisor.transportState).toBe("healthy");
    // Silence resumes probing: after an idle interval a probe appears.
    await eventually(() =>
      at(generations, 0).frames.some(({ frame }) => frame.type === "health"),
    );
    expect(supervisor.transportState).toBe("healthy");
  });

  it("declares death immediately on socket close without a heartbeat cycle", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    at(generations, 0).kill();
    // Stable post-recovery condition (see the wedged-probe test).
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );

    // No health probes were needed at all.
    expect(
      at(generations, 0).frames.filter(({ frame }) => frame.type === "health"),
    ).toHaveLength(0);
    expect(states).toEqual(["recovering", "healthy"]);
  });

  it("counts non-probe deadline expiries as consecutive liveness failures", async () => {
    // A wide heartbeat interval isolates the expiry path: with probes silent,
    // only the interactive calls' deadline expiries feed the failure streak.
    // (When probes CAN answer between expiries they legitimately reset the
    // streak — a health-answering broker is alive.)
    const { supervisor, generations } = createHarness({
      heartbeatIntervalMs: 5_000,
    });
    await supervisor.connect();
    at(generations, 0).wedgeTypes.add("get-tray-bounds");

    // Two wedged interactive calls (threshold 2): each expiry is one
    // liveness failure; the streak declares death. A single expiry alone
    // never does (W1 law).
    await expect(
      supervisor.request(
        {
          type: "get-tray-bounds",
          requestId: "wedge-1",
          appId: "app-default",
          trayId: "status",
        },
        { deadlineMs: 20 },
      ),
    ).rejects.toBeInstanceOf(TransportTimeoutError);
    expect(supervisor.transportState).toBe("healthy");
    await expect(
      supervisor.request(
        {
          type: "get-tray-bounds",
          requestId: "wedge-2",
          appId: "app-default",
          trayId: "status",
        },
        { deadlineMs: 20 },
      ),
    ).rejects.toBeInstanceOf(TransportTimeoutError);

    // Stable post-recovery condition (see the wedged-probe test).
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    expect(at(generations, 0).closeCount).toBe(1);
  });
});

describe("transport supervision recovery (W4)", () => {
  const menuA = { items: [{ type: "item" as const, id: 1, title: "A" }] };
  const menuB = { items: [{ type: "item" as const, id: 2, title: "B" }] };
  const trayIcon = {
    type: "rgba" as const,
    data: [1, 2, 3, 4],
    width: 1,
    height: 1,
  };
  const webviewIdentity = {
    extensionName: "webview",
    artifactSetVersion: "test",
    contractFingerprint: "test-contract",
    target: { os: "darwin", arch: "arm64" },
  };

  const driveDeclarativeTraffic = async (
    supervisor: SupervisedLocalBrokerConnection,
  ): Promise<void> => {
    await supervisor.request({ type: "resolve-default-app", requestId: "c-1" });
    await supervisor.request({
      type: "create-tray",
      requestId: "c-2",
      app: { appId: "app-default" },
      tray: { id: "status", tooltip: { title: "t", description: "d" } },
    });
    await supervisor.request({
      type: "set-tray-menu",
      requestId: "c-3",
      appId: "app-default",
      trayId: "status",
      menu: menuA,
    });
    await supervisor.request({
      type: "set-tray-menu",
      requestId: "c-4",
      appId: "app-default",
      trayId: "status",
      menu: menuB,
    });
    await supervisor.request({
      type: "set-tray-icon",
      requestId: "c-5",
      appId: "app-default",
      trayId: "status",
      icon: trayIcon,
    });
    await supervisor.request({
      type: "set-app-name",
      requestId: "c-6",
      appId: "app-default",
      name: "App",
    });
    await supervisor.request({
      type: "load-ext",
      requestId: "c-7",
      appId: "app-default",
      name: "webview",
      path: "/lib/webview.dylib",
      expectedIdentity: webviewIdentity,
      mountId: "webview.1",
    });
    await supervisor.request({
      type: "load-ext",
      requestId: "c-8",
      appId: "app-default",
      name: "badge",
      path: "/lib/badge.dylib",
      expectedIdentity: webviewIdentity,
      mountId: "badge.1",
    });
  };

  it("recovers, replays the declarative journal in order, and re-runs rebuild callbacks", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    await driveDeclarativeTraffic(supervisor);
    const rebuildGenerations: number[] = [];
    supervisor.registerTransportRebuild(async ({ generation }) => {
      rebuildGenerations.push(generation);
    });
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );

    expect(states).toEqual(["recovering", "healthy"]);
    expect(rebuildGenerations).toEqual([1]);

    const replay = at(generations, 1).frames.map(({ frame }) => frame.type);
    expect(replay).toEqual([
      "resolve-default-app",
      "create-tray",
      "set-tray-menu",
      "set-tray-icon",
      "set-app-name",
      "load-ext",
      "load-ext",
    ]);
    // Replay carries fresh request ids under the bootstrap deadline class.
    for (const { frame, deadlineMs } of at(generations, 1).frames) {
      expect(frame.requestId).toMatch(/^supervisor-replay-1-\d+$/);
      expect(deadlineMs).toBe(10_000);
    }
    // Last-write-wins: only menu B survives.
    const menuReplay = at(generations, 1).frames.filter(
      ({ frame }) => frame.type === "set-tray-menu",
    );
    expect(menuReplay).toHaveLength(1);
    const menuFrame = at(menuReplay, 0).frame;
    expect(menuFrame.type === "set-tray-menu" ? menuFrame.menu : undefined).toEqual(
      menuB,
    );
    // Mount order is preserved.
    const mountReplay = at(generations, 1).frames
      .filter(({ frame }) => frame.type === "load-ext")
      .map(({ frame }) => (frame.type === "load-ext" ? frame.mountId : undefined));
    expect(mountReplay).toEqual(["webview.1", "badge.1"]);
    // The tray identity is injected so handles stay stable across generations.
    const createReplay = at(generations, 1).frames.find(
      ({ frame }) => frame.type === "create-tray",
    );
    expect(
      createReplay?.frame.type === "create-tray" ? createReplay.frame.tray : undefined,
    ).toEqual({ id: "status", tooltip: { title: "t", description: "d" } });
    // Consumer traffic after recovery flows to the new generation.
    await supervisor.request({
      type: "get-tray-bounds",
      requestId: "post-1",
      appId: "app-default",
      trayId: "status",
    });
    expect(
      at(generations, 1).frames.some(({ frame }) => frame.requestId === "post-1"),
    ).toBe(true);
  });

  it("injects the broker-assigned trayId when the caller omitted a tray id", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    // Simulates a protocol-level caller that omitted `tray.id` on the wire
    // and the first broker assigned one: the replayed create-tray must pin
    // the assigned id so handle identity survives generations.
    const assignedTrayId = "generated-42";
    await supervisor.request({
      type: "create-tray",
      requestId: "c-2",
      app: { appId: "app-default" },
      tray: { id: assignedTrayId },
    });
    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    const createReplay = at(generations, 1).frames.find(
      ({ frame }) => frame.type === "create-tray",
    );
    expect(
      createReplay?.frame.type === "create-tray" ? createReplay.frame.tray.id : undefined,
    ).toBe(assignedTrayId);
  });

  it("rewrites replayed frames onto the fresh generation's default app id", async () => {
    const { supervisor, generations } = createHarness({
      recovery: FAST_RECOVERY,
    }, {
      configureGeneration: (generation, ordinal) => {
        if (ordinal > 1) {
          generation.defaultAppId = "app-fresh";
        }
      },
    });
    await supervisor.connect();
    await supervisor.request({ type: "resolve-default-app", requestId: "c-1" });
    await supervisor.request({
      type: "create-tray",
      requestId: "c-2",
      app: { appId: "app-default" },
      tray: { id: "status" },
    });

    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    const createReplay = at(generations, 1).frames.find(
      ({ frame }) => frame.type === "create-tray",
    );
    expect(
      createReplay?.frame.type === "create-tray" ? createReplay.frame.app : undefined,
    ).toEqual({ appId: "app-fresh" });
  });

  it("does not resurrect a tray destroyed before the transport died", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    await supervisor.request({
      type: "create-tray",
      requestId: "c-2",
      app: { appId: "app-default" },
      tray: { id: "doomed" },
    });
    await supervisor.request({
      type: "destroy-tray",
      requestId: "c-3",
      appId: "app-default",
      trayId: "doomed",
    });
    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    expect(
      at(generations, 1).frames.some(({ frame }) => frame.type === "create-tray"),
    ).toBe(false);
  });

  it("fails the attempt when replay is rejected and retries within the budget", async () => {
    const { supervisor, generations } = createHarness(
      { recovery: { ...FAST_RECOVERY, maxRestarts: 2 } },
      {
        configureGeneration: (generation, ordinal) => {
          if (ordinal !== 2) {
            return;
          }
          // The second generation rejects the replayed create-tray: the
          // whole attempt fails and the supervisor retries inside the
          // remaining budget against a third generation.
          const originalRequest = generation.request.bind(generation);
          generation.request = async (frame, options) => {
            const response = await originalRequest(frame, options);
            if (frame.type === "create-tray") {
              return {
                type: "error",
                requestId: frame.requestId,
                code: "failed_create_tray",
                message: "replay rejected",
              };
            }
            return response;
          };
        },
      },
    );
    await supervisor.connect();
    await supervisor.request({
      type: "create-tray",
      requestId: "c-2",
      app: { appId: "app-default" },
      tray: { id: "status" },
    });

    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 3,
    );

    expect(
      at(generations, 1).frames.some(({ frame }) => frame.type === "create-tray"),
    ).toBe(true);
    expect(
      at(generations, 2).frames.some(({ frame }) => frame.type === "create-tray"),
    ).toBe(true);
    // The failed candidate was torn down (bounded close), not adopted.
    expect(at(generations, 1).closeCount).toBe(1);
  });
});

describe("transport supervision budget and hooks (W5/W6)", () => {
  it("abandons after the budget is exhausted and never loops", async () => {
    const { supervisor, generations, connectCalls } = createHarness(
      { recovery: { ...FAST_RECOVERY, maxRestarts: 3 } },
      { connectErrorFactory: () => new Error("respawn failed") },
    );
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    at(generations, 0).kill();
    await eventually(() => supervisor.transportState === "abandoned");

    expect(states).toEqual(["recovering", "abandoned"]);
    // One initial connect + exactly three respawn attempts, then silence.
    expect(connectCalls()).toBe(4);
    await sleep(50);
    expect(connectCalls()).toBe(4);
    // Every later call fails fast with the typed abandonment rejection.
    const error = await supervisor
      .request({
        type: "get-tray-bounds",
        requestId: "post-abandoned",
        appId: "app-default",
        trayId: "status",
      })
      .then(
        () => {
          throw new Error("expected a rejection");
        },
        (rejection: unknown) => rejection,
      );
    expect(error).toBeInstanceOf(TransportAbandonedError);
    const typed = error as TransportAbandonedError;
    expect(typed.code).toBe("transport_abandoned");
    expect(typed.details).toEqual({ recoveries: 3, windowMs: 60_000 });
  });

  it("hands over to recovery.restartApp exactly once without reconnecting (Tier 2)", async () => {
    const restartApp = vi.fn(async (): Promise<void> => {});
    const { supervisor, generations, connectCalls } = createHarness({
      recovery: { ...FAST_RECOVERY, restartApp },
    });
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    at(generations, 0).kill();
    await eventually(() => supervisor.transportState === "abandoned");

    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(connectCalls()).toBe(1);
    expect(states).toEqual(["recovering", "abandoned"]);
    await expect(
      supervisor.request({
        type: "get-tray-bounds",
        requestId: "post-handover",
        appId: "app-default",
        trayId: "status",
      }),
    ).rejects.toBeInstanceOf(TransportAbandonedError);
  });

  it("never recovers on graceful shutdown", async () => {
    const { supervisor, generations, connectCalls } = createHarness();
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    await supervisor.shutdown();
    await sleep(60);

    expect(at(generations, 0).closeCount).toBe(1);
    expect(connectCalls()).toBe(1);
    expect(states).toEqual([]);
    // A late death of the closed generation stays inert.
    at(generations, 0).kill();
    await sleep(60);
    expect(connectCalls()).toBe(1);
    expect(states).toEqual([]);
  });

  it("never recovers when a teardown-class destroy frame marked the teardown", async () => {
    const { supervisor, generations, connectCalls } = createHarness();
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    // The destroy frame carries the teardown budget class (Phase A's
    // caller-intent marker): the supervisor must treat the following socket
    // death as caller-initiated, not uninvited.
    await supervisor.request(
      {
        type: "destroy-tray",
        requestId: "destroy-1",
        appId: "app-default",
        trayId: "status",
      },
      { deadlineMs: TEARDOWN_CALL_DEADLINE_MS },
    );
    at(generations, 0).kill();
    await sleep(80);

    expect(connectCalls()).toBe(1);
    expect(states).toEqual([]);
  });

  it("keeps recovery disabled behavior fail-fast without state transitions", async () => {
    const { supervisor, generations, connectCalls } = createHarness({
      recovery: { ...FAST_RECOVERY, enabled: false },
    });
    await supervisor.connect();
    const states: string[] = [];
    supervisor.onTransportStateChange((state) => states.push(state));

    at(generations, 0).kill();
    await sleep(80);

    expect(connectCalls()).toBe(1);
    expect(states).toEqual([]);
    expect(supervisor.transportState).toBe("healthy");
    await expect(
      supervisor.request({
        type: "get-tray-bounds",
        requestId: "post-death",
        appId: "app-default",
        trayId: "status",
      }),
    ).rejects.toMatchObject({ message: BROKER_CONNECTION_CLOSED_MESSAGE });
  });
});

describe("transport supervision event fanout", () => {
  it("keeps consumer event subscriptions alive across generations", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    const received: string[] = [];
    supervisor.onEvent((frame) => {
      received.push(
        frame.type === "event" ? frame.event.type : `other:${frame.type}`,
      );
    });

    const clickEvent: LocalRuntimeEventFrame = {
      type: "event",
      event: {
        type: "trayClick",
        appId: "app-default",
        trayId: "status",
        button: "left",
        x: 0,
        y: 0,
      },
    };
    at(generations, 0).emitEvent(clickEvent);
    expect(received).toEqual(["trayClick"]);

    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    // The dead generation no longer delivers after its death unwired it.
    at(generations, 0).emitEvent(clickEvent);
    at(generations, 1).emitEvent(clickEvent);
    expect(received).toEqual(["trayClick", "trayClick"]);
  });

  it("forwards per-connection death for every generation", async () => {
    const { supervisor, generations } = createHarness();
    await supervisor.connect();
    const deaths: number[] = [];
    supervisor.onConnectionDead(() => deaths.push(deaths.length));

    at(generations, 0).kill();
    await eventually(
      () => supervisor.transportState === "healthy" && generations.length === 2,
    );
    at(generations, 1).kill();
    await eventually(() => deaths.length === 2);
    expect(deaths).toHaveLength(2);
  });

  it("propagates the first connect failure unchanged", async () => {
    const factory = vi.fn(async (): Promise<LocalBrokerClient> => {
      throw new Error("initial connect failed");
    });
    const supervisor = createTransportSupervisor({
      connect: () => factory(),
      ...SHORT_HEARTBEAT,
      recovery: FAST_RECOVERY,
    });
    supervisorTeardown.push(() => supervisor.shutdown());
    await expect(supervisor.connect()).rejects.toThrow("initial connect failed");
  });
});

describe("transport supervision against connectLocalBroker (respawn mechanics)", () => {
  it("respawns through the daemon driver identity gates and replays the journal", async () => {
    const homeDir = await mkdtemp("/tmp/ot-sup-");
    tempDirs.push(homeDir);
    const driver = createSocketSupervisionDriver();
    const supervisor = createTransportSupervisor({
      connect: () =>
        connectLocalBroker({
          homeDir,
          packageVersion: "0.1.0",
          clientVersion: "test-client",
          daemonDriver: driver,
        }),
      ...SHORT_HEARTBEAT,
      // Slightly wider cooldown than the fake-generation suites: the
      // in-process socket server must fully close before the respawn
      // re-listens on the same endpoint.
      recovery: { ...FAST_RECOVERY, cooldownMs: 25 },
    });
    supervisorTeardown.push(() => supervisor.shutdown());
    supervisorTeardown.push(async () => {
      await driver.close();
    });
    await supervisor.connect();
    await supervisor.request({
      type: "create-tray",
      requestId: "c-1",
      app: { appId: "app-default" },
      tray: { id: "status" },
    });
    expect(driver.spawned).toBe(1);
    const framesBeforeDeath = driver.frames.length;

    await driver.killBroker();
    await eventually(
      () => supervisor.transportState === "healthy" && driver.spawned === 2,
    );

    const replayFrames = driver.frames
      .slice(framesBeforeDeath)
      .filter(
        (frame): frame is Extract<ClientFrame, { type: "create-tray" }> =>
          frame.type === "create-tray",
      );
    expect(replayFrames).toHaveLength(1);
    expect(at(replayFrames, 0).tray).toEqual({ id: "status" });
    expect(at(replayFrames, 0).requestId).toMatch(/^supervisor-replay-1-\d+$/);
    expect(supervisor.sessionId.length).toBeGreaterThan(0);
  });
});

/**
 * Compact socket-level broker fake (Phase A's createSocketBrokerDriver
 * pattern, reduced to this suite's needs): a real net server per spawn so
 * connectLocalBroker's startDaemon path — lock, pid liveness, ready-file
 * identity gates — exercises its real logic against in-process fakes only.
 */
const createSocketSupervisionDriver = (): DaemonDriver & {
  readonly spawned: number;
  readonly frames: ClientFrame[];
  killBroker(): Promise<void>;
  close(): Promise<void>;
} => {
  const pid = 21_000;
  let spawned = 0;
  let server: Server | undefined;
  let alive = false;
  const sockets = new Set<Socket>();
  const frames: ClientFrame[] = [];

  const respond = (frame: ClientFrame, socket: Socket): void => {
    frames.push(frame);
    switch (frame.type) {
      case "create-tray":
        socket.write(
          `${JSON.stringify({
            type: "tray-created",
            requestId: frame.requestId,
            appId: frame.app.appId,
            trayId: frame.tray.id,
          })}\n`,
        );
        return;
      case "get-tray-bounds":
        socket.write(
          `${JSON.stringify({
            type: "tray-bounds",
            requestId: frame.requestId,
            appId: frame.appId,
            trayId: frame.trayId,
            bounds: {
              kind: "native",
              source: "test",
              rect: { x: 0, y: 0, width: 1, height: 1 },
            },
          })}\n`,
        );
        return;
      case "health":
        socket.write(
          `${JSON.stringify({
            type: "runtime-host-health",
            requestId: frame.requestId,
            health: {
              pid,
              packageVersion: "0.1.0",
              protocolVersion: PROTOCOL_VERSION,
              endpoint: "test",
              appId: "app-default",
              appName: "Test",
              callerLabel: "test",
              sessionCount: 0,
              sessions: [],
            },
          })}\n`,
        );
        return;
      case "resolve-default-app":
        socket.write(
          `${JSON.stringify({
            type: "default-app",
            requestId: frame.requestId,
            app: { appId: "app-default" },
          })}\n`,
        );
        return;
      case "init":
      case "exit":
        // Handshake and teardown frames are never request-reply; the
        // initialized branch already answered init, and exit needs no reply.
        return;
      default:
        socket.write(
          `${JSON.stringify({ type: "ack", requestId: frame.requestId })}\n`,
        );
    }
  };

  const closeServer = async (): Promise<void> => {
    const current = server;
    server = undefined;
    alive = false;
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    if (current === undefined || !current.listening) {
      return;
    }
    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });
  };

  return {
    get spawned() {
      return spawned;
    },
    get frames() {
      return frames;
    },
    async killBroker() {
      await closeServer();
    },
    async resolveBroker(paths) {
      return {
        command: "/fake/opentray",
        args: [],
        executablePath: "/fake/opentray",
        artifactIdentity: {
          ...brokerIdentity("a"),
          packageVersion: paths.packageVersion,
        },
      };
    },
    async isAlive(checkPid) {
      return checkPid === pid && alive;
    },
    async spawnBroker(paths, broker) {
      spawned += 1;
      const nextServer = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
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
              socket.write(
                `${JSON.stringify({
                  type: "ready",
                  protocolVersion: PROTOCOL_VERSION,
                  brokerVersion: paths.packageVersion,
                  brokerArtifactIdentity: broker.artifactIdentity,
                  sessionId: `session-driver-${spawned}`,
                })}\n`,
              );
              continue;
            }
            respond(frame, socket);
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        nextServer.once("error", reject);
        nextServer.listen(paths.endpoint, () => {
          nextServer.off("error", reject);
          resolve();
        });
      });
      server = nextServer;
      alive = true;
      await mkdir(dirname(paths.readyFile), { recursive: true });
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
          brokerArtifactIdentity: broker.artifactIdentity,
        })}\n`,
        "utf8",
      );
      return pid;
    },
    async stop() {
      await closeServer();
    },
    async close() {
      await closeServer();
    },
  };
};

const brokerIdentity = (seed: string): BrokerArtifactIdentity => ({
  packageVersion: "0.1.0",
  target: { os: "darwin", arch: "arm64" },
  executableHash: seed.repeat(64),
  buildIdentity: `sha256:${seed.repeat(16)}`,
});
