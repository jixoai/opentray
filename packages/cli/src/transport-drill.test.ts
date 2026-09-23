// Orthogonal intents (2026-09-20; harden-transport-robustness Phase E/W8):
// 1. Keep the kill -9 drill as a permanently green gate: a minimal consumer
//    using only `createTray` survives real broker SIGKILL with zero
//    consumer recovery code.
// 2. Keep the deterministic-bug leg in the same gate: budget exhaustion
//    degrades to fail-fast + `abandoned`, never a hang, never a loop.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";

import { createTray } from "./sdk";
import {
  BROKER_CONNECTION_CLOSED_MESSAGE,
  type LocalBrokerClient,
} from "./local-broker";
import {
  TransportAbandonedError,
  createTransportSupervisor,
} from "./transport-supervision";
import { resolveDaemonPaths } from "./daemon/paths";
import { resolveCallerLabel } from "./daemon/caller-label";
import type { TransportState } from "./client";
import type { ServerFrame } from "@opentray/spec";

/**
 * Broker binary for the kill drill, resolved without touching any caller's
 * environment: an explicit drill override, then the cargo build outputs of
 * this checkout (debug first — the artifacts the Rust suite just exercised).
 * Absent everywhere, the kill leg skips loudly: the deterministic-exhaustion
 * leg still runs, and building the broker (`cargo build -p opentray-bin`)
 * re-enables the kill leg.
 */
const resolveDrillBrokerBinary = (): string | undefined => {
  // Cargo names Windows outputs `opentray.exe`; without the suffix the kill
  // leg silently never resolves a binary on win32.
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    process.env.OPENTRAY_DRILL_BROKER_BIN,
    resolve(__dirname, `../../../target/debug/opentray${exeSuffix}`),
    resolve(__dirname, `../../../target/release/opentray${exeSuffix}`),
  ].filter((candidate): candidate is string => typeof candidate === "string");
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};

const waitFor = async (
  budgetMs: number,
  probe: () => Promise<boolean> | boolean,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await probe()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`drill waiting for ${label} exceeded ${budgetMs}ms`);
    }
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 50);
    });
  }
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readPidFile = async (pidFile: string): Promise<number | undefined> => {
  try {
    const raw = await readFile(pidFile, "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
};

const cliPackageVersion = async (): Promise<string> => {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
};

const drillBinary = resolveDrillBrokerBinary();

describe("transport robustness drill (W8 permanent gate)", () => {
  let homeDir: string | undefined;
  let previousBrokerBin: string | undefined;
  let hadBrokerBin = false;
  let brokerPid: number | undefined;
  /** pid file of the current test's drill home, captured before createTray. */
  let drillPidFile: string | undefined;

  beforeAll(async () => {
    // AGENTS socket-path law: the complete macOS/Linux Unix socket path must
    // stay below the native sun_path byte limit. The default os.tmpdir() on
    // macOS (/var/folders/...) is deep enough to exhaust the budget before
    // the version/label segments, so the drill homes under a short POSIX
    // root; named pipes on Windows have no such limit.
    const drillRoot = process.platform === "win32" ? tmpdir() : "/tmp";
    homeDir = await mkdtemp(join(drillRoot, "otd-"));
    if (drillBinary !== undefined) {
      previousBrokerBin = process.env.OPENTRAY_BROKER_BIN;
      hadBrokerBin = Object.prototype.hasOwnProperty.call(process.env, "OPENTRAY_BROKER_BIN");
      process.env.OPENTRAY_BROKER_BIN = drillBinary;
    }
  });

  afterAll(async () => {
    if (drillBinary !== undefined) {
      if (hadBrokerBin) {
        process.env.OPENTRAY_BROKER_BIN = previousBrokerBin;
      } else {
        delete process.env.OPENTRAY_BROKER_BIN;
      }
    }
  });

  afterEach(async () => {
    // Scoped to THIS drill's temp home only: never touch any other broker
    // (a user's real app keeps running unaffected). The pid file is re-read
    // best-effort so a failure between broker spawn and the test's own pid
    // capture cannot leak the spawned process.
    if (drillPidFile !== undefined) {
      const leaked = await readPidFile(drillPidFile);
      if (leaked !== undefined && isPidAlive(leaked)) {
        try {
          process.kill(leaked, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    if (brokerPid !== undefined && isPidAlive(brokerPid)) {
      try {
        process.kill(brokerPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    brokerPid = undefined;
    drillPidFile = undefined;
    if (homeDir !== undefined) {
      await rm(homeDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  const drillAppIdentity = () => {
    // Short per-invocation token (AGENTS socket-path law): the complete
    // macOS Unix socket path must stay below the native sun_path byte
    // limit, so the unique suffix is one compact base-36 token.
    const unique = Math.random().toString(36).slice(2, 8);
    return { appId: `d${unique}`, appName: "OpenTray Drill" };
  };

  (drillBinary === undefined ? it.skip : it)(
    "a ~5-line createTray consumer survives broker kill -9 with zero recovery code",
    async () => {
      const { appId, appName } = drillAppIdentity();
      const packageVersion = await cliPackageVersion();
      const paths = resolveDaemonPaths({
        homeDir: homeDir as string,
        packageVersion,
        callerLabel: resolveCallerLabel({ appId }),
        appId,
        appName,
      });
      // Captured before createTray so afterEach can find and kill the
      // spawned broker even when a later step in this test throws.
      drillPidFile = paths.pidFile;

      // THE consumer, in full (issue #11 acceptance criterion 1):
      const tray = await createTray(
        { id: "drill", tooltip: { title: "transport drill", description: "W8 kill -9 drill" } },
        { homeDir: homeDir as string, appId, appName },
      );
      const states: TransportState[] = [];
      tray.onTransportStateChange?.((state) => {
        states.push(state);
      });

      brokerPid = await readPidFile(paths.pidFile);
      expect(brokerPid).toBeDefined();
      expect(isPidAlive(brokerPid as number)).toBe(true);

      // The drill: uncatchable process death of the real broker.
      process.kill(brokerPid as number, "SIGKILL");
      await waitFor(
        15_000,
        () => states.includes("recovering"),
        "recovering state after kill -9",
      );
      await waitFor(
        45_000,
        () => states.includes("healthy"),
        "healthy state after automatic recovery",
      );
      expect(isPidAlive(brokerPid as number)).toBe(false);

      // The recovered generation serves ordinary calls; no consumer code
      // was involved beyond createTray and one event subscription.
      await tray.setTooltip({ title: "post-recovery", description: "recovered generation serves calls" });

      // Graceful teardown stays clean and never triggers recovery.
      await tray.destroy();
      await waitFor(
        15_000,
        () => !isPidAlive(brokerPid as number),
        "broker exit after final session close",
      );
    },
    90_000,
  );

  (drillBinary === undefined ? it.skip : it)(
    "a bare consumer process with no loop holder of its own survives the recovery window",
    async () => {
      const { appId, appName } = drillAppIdentity();
      const packageVersion = await cliPackageVersion();
      const paths = resolveDaemonPaths({
        homeDir: homeDir as string,
        packageVersion,
        callerLabel: resolveCallerLabel({ appId }),
        appId,
        appName,
      });
      drillPidFile = paths.pidFile;
      // A prior leg's afterEach removed the shared home; this leg's child
      // script (and its broker home) need it back.
      await mkdir(homeDir as string, { recursive: true });

      // The regression specimen (real-machine Windows evidence 2026-09-22):
      // a bare bun process whose ONLY loop holder is the supervised broker
      // connection. Every supervision timer is unref'd, so before the
      // keepalive fix this process drained its event loop during the
      // death→reconnect window and exited cleanly mid-recovery.
      const sdkUrl = pathToFileURL(resolve(__dirname, "./sdk.ts")).href;
      const childScript = join(homeDir as string, "bare-child.ts");
      await writeFile(
        childScript,
        `import { createTray } from ${JSON.stringify(sdkUrl)};

const tray = await createTray(
  {
    id: "drill-bare-child",
    tooltip: { title: "bare child drill", description: "W8 bare child leg" },
  },
  {
    homeDir: process.env.DRILL_HOME,
    appId: process.env.DRILL_APP_ID,
    appName: "OpenTray Drill",
  },
);
tray.onTransportStateChange?.((state) => {
  console.log(\`state=\${state}\`);
  if (state === "healthy") {
    console.log("recovered");
    void tray.destroy().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  }
});
console.log("ready");
// No timers, no servers, no stdin reads: the supervised connection is the
// only thing allowed to keep this process alive through the kill.
`,
        "utf8",
      );

      const child = spawn("bun", [childScript], {
        cwd: __dirname,
        env: {
          ...process.env,
          DRILL_HOME: homeDir,
          DRILL_APP_ID: appId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines: string[] = [];
      let childExit: number | undefined;
      let childExited = false;
      let spawnError: string | undefined;
      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (line.length > 0) {
            lines.push(line);
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[bare-child] ${chunk.toString("utf8")}`);
      });
      child.on("error", (error: Error) => {
        spawnError = String(error);
        childExited = true;
        childExit = -2;
      });
      child.on("exit", (code) => {
        childExited = true;
        childExit = code ?? -1;
      });

      try {
        await waitFor(
          30_000,
          () => lines.includes("ready") || spawnError !== undefined,
          "bare child ready",
        );
        expect(spawnError).toBeUndefined();
        // Aliveness before the kill: the hold must exist from connect on.
        await new Promise((resolveSleep) => {
          setTimeout(resolveSleep, 1_200);
        });
        expect(childExited).toBe(false);

        brokerPid = await readPidFile(paths.pidFile);
        expect(brokerPid).toBeDefined();
        process.kill(brokerPid as number, "SIGKILL");

        await waitFor(
          15_000,
          () => lines.includes("state=recovering"),
          "child-observed recovering state",
        );
        // THE regression assertion: the bare process must still be alive
        // inside the death→reconnect window, held only by supervision.
        expect(childExited).toBe(false);
        await waitFor(
          45_000,
          () => lines.includes("recovered"),
          "child-observed healthy recovery inside the same bare process",
        );
        await waitFor(
          15_000,
          () => childExited && childExit === 0,
          "bare child clean exit after recovery",
        );
      } finally {
        if (!childExited) {
          child.kill();
          await new Promise((resolveKill) => {
            child.once("exit", resolveKill);
            const killBudget = setTimeout(resolveKill, 5_000);
            killBudget.unref();
          });
        }
      }
    },
    120_000,
  );

  it(
    "a deterministic respawn failure exhausts the budget into fail-fast + abandoned (no hang, no loop)",
    async () => {
      const states: TransportState[] = [];
      const deadListeners = new Set<(error: Error) => void>();
      let died = false;
      const firstGeneration: LocalBrokerClient = {
        endpoint: "drill-fake",
        callerLabel: "drill",
        sessionId: "drill-session-1",
        get connectionDead() {
          return died;
        },
        onConnectionDead(listener) {
          deadListeners.add(listener);
          return () => {
            deadListeners.delete(listener);
          };
        },
        onDeadlineExpiry() {
          return () => {};
        },
        onEvent() {
          return () => {};
        },
        async close() {},
        async request(): Promise<ServerFrame> {
          // Wedged shape; never called on this leg before death. The
          // unreachable throw only satisfies the declared return type.
          await new Promise<void>(() => {});
          throw new Error("unreachable: wedged request never settles");
        },
      };
      let connectCalls = 0;
      const supervisor = createTransportSupervisor({
        connect: async () => {
          connectCalls += 1;
          if (connectCalls === 1) {
            return firstGeneration;
          }
          // Deterministic bug: every respawn attempt fails.
          throw new Error("deterministic respawn failure");
        },
        recovery: { cooldownMs: 5, maxRestarts: 3, windowMs: 600_000 },
      });
      supervisor.onTransportStateChange((state) => {
        states.push(state);
      });
      await supervisor.connect();

      died = true;
      for (const listener of [...deadListeners]) {
        listener(new Error(BROKER_CONNECTION_CLOSED_MESSAGE));
      }

      await waitFor(
        10_000,
        () => supervisor.transportState === "abandoned",
        "terminal abandoned state",
      );
      expect(states).toEqual(["recovering", "abandoned"]);
      // 1 initial connect + exactly `maxRestarts` attempts: the loop stopped.
      expect(connectCalls).toBe(4);

      await expect(
        supervisor.request({ type: "health", requestId: "drill-exhausted" }),
      ).rejects.toBeInstanceOf(TransportAbandonedError);
      await supervisor.shutdown();
    },
    20_000,
  );
});
