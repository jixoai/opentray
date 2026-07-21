// Orthogonal intents (updated 2026-07-21; original user request: interrupted
// starts must not leave Skill Creator permanently unable to mount its tray):
// 1. Prove broker start, reuse, replacement, stop, restart, and inspection.
// 2. Prove exact artifact readiness and bounded native cold-start behavior.
// 3. Prove caller lock serialization, stale-owner recovery, and owner-safe release.
// 4. Prove detached broker diagnostics and cross-platform executable identity.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrokerArtifactIdentity } from "@opentray/spec";

import type { ResolvedBrokerArtifact } from "./broker-command";
import type { DaemonDriver } from "./lifecycle";
import {
  acquireDaemonLock,
  createNodeDaemonDriver,
  executablePathsEqual,
  inspectDaemon,
  resolveBrokerStdio,
  restartDaemon,
  startDaemon,
  stopDaemon,
} from "./lifecycle";
import { resolveDaemonPaths } from "./paths";

const tempDirs: string[] = [];

const makeTempHome = async (): Promise<string> => {
  const dir = await mkdtemp(`${tmpdir()}/opentray-daemon-test-`);
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("daemon lifecycle", () => {
  it("treats Windows verbatim and regular executable paths as the same file", () => {
    expect(
      executablePathsEqual(
        "\\\\?\\C:\\Users\\runner\\opentray.exe",
        "c:/Users/runner/opentray.exe",
        "win32",
      ),
    ).toBe(true);
  });

  it("persists broker stdio by default and keeps explicit inherit/ignore overrides", () => {
    expect(resolveBrokerStdio(undefined)).toBe("log");
    expect(resolveBrokerStdio("quiet")).toBe("log");
    expect(resolveBrokerStdio("inherit")).toBe("inherit");
    expect(resolveBrokerStdio("ignore")).toBe("ignore");
  });

  it("appends detached broker stderr to the caller runtime log", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createNodeDaemonDriver("/fixture/cli.mjs", { env: {} });
    const broker = {
      command: process.execPath,
      args: ["-e", "console.error('native broker diagnostic')"],
      executablePath: process.execPath,
      artifactIdentity: brokerIdentity("log-child"),
    } satisfies ResolvedBrokerArtifact;

    await driver.spawnBroker(paths, broker);
    await waitForLog(paths.brokerLog, "native broker diagnostic");

    expect(await readFile(paths.brokerLog, "utf8")).toContain("native broker diagnostic");
  });

  it("records a detached broker exit before readiness", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createNodeDaemonDriver("/fixture/cli.mjs", { env: {} });
    const broker = {
      command: process.execPath,
      args: ["-e", "process.exit(17)"],
      executablePath: process.execPath,
      artifactIdentity: brokerIdentity("exit-child"),
    } satisfies ResolvedBrokerArtifact;

    await driver.spawnBroker(paths, broker);
    await waitForLog(paths.brokerLog, '"event":"broker-exit"');

    const log = await readFile(paths.brokerLog, "utf8");
    expect(log).toContain('"code":17');
    expect(log).toContain('"signal":null');
  });

  it("records the exact detached broker spawn error", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createNodeDaemonDriver("/fixture/cli.mjs", { env: {} });
    const broker = {
      command: join(homeDir, "missing-opentray"),
      args: [],
      executablePath: join(homeDir, "missing-opentray"),
      artifactIdentity: brokerIdentity("missing-child"),
    } satisfies ResolvedBrokerArtifact;

    await expect(driver.spawnBroker(paths, broker)).resolves.toBe(0);
    await waitForLog(paths.brokerLog, "broker-spawn-error");
    const log = await readFile(paths.brokerLog, "utf8");
    expect(log).toContain("broker-spawn-error");
    expect(log).toContain("ENOENT");
    expect(log).toContain(broker.command);
  });

  it("starts once and reuses the healthy same-version broker", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();

    const first = await startDaemon({ paths, driver });
    const second = await startDaemon({ paths, driver });

    expect(first.status).toBe("started");
    expect(second.status).toBe("already-running");
    expect(first.pid).toBe(second.pid);
    expect(driver.spawned).toEqual([first.pid]);
  });

  it("replaces a live broker whose ready metadata has no artifact identity", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();
    const first = await startDaemon({ paths, driver });
    await writeFile(paths.readyFile, `${JSON.stringify({ pid: first.pid })}\n`, "utf8");

    const replacement = await startDaemon({ paths, driver });

    expect(replacement.status).toBe("started");
    expect(replacement.pid).not.toBe(first.pid);
    expect(driver.spawned).toEqual([first.pid, replacement.pid]);
  });

  it("replaces a live broker whose ready artifact identity is different", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();
    const first = await startDaemon({ paths, driver });
    await writeReadyFile(paths, first.pid, brokerIdentity("old"));

    const replacement = await startDaemon({ paths, driver });

    expect(replacement.status).toBe("started");
    expect(replacement.pid).not.toBe(first.pid);
  });

  it("does not start a competing broker when incompatible PID shutdown is not bounded", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver(0, false);
    const first = await startDaemon({ paths, driver });
    await writeReadyFile(paths, first.pid, brokerIdentity("old"));

    await expect(startDaemon({ paths, driver })).rejects.toThrow(
      /incompatible daemon broker did not stop/,
    );
    expect(driver.spawned).toEqual([first.pid]);
  });

  it("stops only the current version runtime", async () => {
    const homeDir = await makeTempHome();
    const current = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const other = resolveDaemonPaths({ homeDir, packageVersion: "0.2.0" });
    const driver = createFakeDriver();

    const currentStart = await startDaemon({ paths: current, driver });
    const otherStart = await startDaemon({ paths: other, driver });
    const stopped = await stopDaemon({ paths: current, driver });

    expect(stopped).toMatchObject({ status: "stopped", pid: currentStart.pid });
    expect(await driver.isAlive(currentStart.pid)).toBe(false);
    expect(await driver.isAlive(otherStart.pid)).toBe(true);
  });

  it("serializes concurrent starts through the runtime lock", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver(25);

    const [first, second] = await Promise.all([
      startDaemon({ paths, driver }),
      startDaemon({ paths, driver }),
    ]);

    expect(new Set([first.pid, second.pid]).size).toBe(1);
    expect(driver.spawned).toHaveLength(1);
  });

  it.each([
    ["legacy PID-only", "2147483647\n"],
    ["tokenized", `${JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" })}\n`],
  ])("recovers a %s runtime lock owned by a dead caller", async (_kind, source) => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeFile(paths.lockFile, source, "utf8");

    const started = await startDaemon({ paths, driver, lockTimeoutMs: 100 });

    expect(started.status).toBe("started");
    expect(driver.spawned).toEqual([started.pid]);
  });

  it("does not remove a replacement caller lock during delayed release", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    await mkdir(paths.runtimeDir, { recursive: true });
    const lock = await acquireDaemonLock(paths.lockFile, 100);
    const replacement = `${JSON.stringify({ pid: process.pid, token: "replacement" })}\n`;
    await rm(paths.lockFile, { force: true });
    await writeFile(paths.lockFile, replacement, "utf8");

    await lock.release();

    expect(await readFile(paths.lockFile, "utf8")).toBe(replacement);
  });

  it("serializes concurrent recovery of the same dead caller lock", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver(25);
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeFile(paths.lockFile, "2147483647\n", "utf8");

    const [first, second] = await Promise.all([
      startDaemon({ paths, driver, lockTimeoutMs: 500 }),
      startDaemon({ paths, driver, lockTimeoutMs: 500 }),
    ]);

    expect(new Set([first.pid, second.pid]).size).toBe(1);
    expect(driver.spawned).toHaveLength(1);
  });

  it("waits longer than readiness polling before a concurrent start reuses the winner", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver(1_100);

    const [first, second] = await Promise.all([
      startDaemon({ paths, driver }),
      startDaemon({ paths, driver }),
    ]);

    expect(new Set([first.pid, second.pid]).size).toBe(1);
    expect(driver.spawned).toHaveLength(1);
    expect([first.status, second.status].sort()).toEqual(["already-running", "started"]);
  });

  it("allows a healthy Darwin broker more than two seconds to publish readiness", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createDelayedReadyDriver(2_200);

    const started = await startDaemon({ paths, driver });

    expect(started.status).toBe("started");
    expect(driver.stopped).toEqual([]);
  });

  it("stops and cleans a broker that exceeds the configured readiness budget", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createDelayedReadyDriver(1_000);

    await expect(startDaemon({ paths, driver, readinessTimeoutMs: 25 })).rejects.toThrow(
      `after 25ms: pid=50000; readyFile=${paths.readyFile}; brokerLog=${paths.brokerLog}`,
    );

    expect(driver.stopped).toEqual([50_000]);
    await expect(readFile(paths.pidFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(paths.readyFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports broker exit before readiness instead of masking it as a timeout", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createExitedDriver();

    await expect(startDaemon({ paths, driver })).rejects.toThrow(`brokerLog=${paths.brokerLog}`);
  });

  it("restarts by stopping and starting the same version endpoint", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();

    const first = await startDaemon({ paths, driver });
    const restarted = await restartDaemon({ paths, driver });

    expect(await driver.isAlive(first.pid)).toBe(false);
    expect(restarted.status).toBe("started");
    expect(restarted.pid).not.toBe(first.pid);
  });

  it("inspects a running daemon without spawning", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();
    const started = await startDaemon({ paths, driver });

    const inspected = await inspectDaemon({ paths, driver });

    expect(inspected).toEqual({ status: "running", pid: started.pid, paths });
    expect(driver.spawned).toEqual([started.pid]);
  });

  it("inspects stale runtime files as not running", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createFakeDriver();
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeFile(paths.pidFile, "12345\n", "utf8");

    const inspected = await inspectDaemon({ paths, driver });

    expect(inspected).toEqual({ status: "not-running", paths, stalePid: 12345 });
    expect(driver.spawned).toEqual([]);
  });
});

const createFakeDriver = (
  spawnDelayMs = 0,
  stopSucceeds = true,
): DaemonDriver & { readonly spawned: number[] } => {
  const alive = new Set<number>();
  const spawned: number[] = [];
  let nextPid = 10_000;

  return {
    spawned,
    async resolveBroker(paths) {
      return resolvedBroker(paths);
    },
    async isAlive(pid) {
      return alive.has(pid);
    },
    async spawnBroker(paths, broker) {
      if (spawnDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, spawnDelayMs));
      }
      const pid = nextPid;
      nextPid += 1;
      alive.add(pid);
      spawned.push(pid);
      await writeReadyFile(paths, pid, broker.artifactIdentity);
      return pid;
    },
    async stop(pid) {
      if (stopSucceeds) {
        alive.delete(pid);
      }
    },
  };
};

const brokerIdentity = (seed: string, packageVersion = "0.1.0"): BrokerArtifactIdentity => {
  const executableHash = createHash("sha256").update(seed).digest("hex");
  return {
    packageVersion,
    target: { os: "darwin", arch: "arm64" },
    executableHash,
    buildIdentity: `sha256:${executableHash.slice(0, 16)}`,
  };
};

const resolvedBroker = (paths: ReturnType<typeof resolveDaemonPaths>) => ({
  command: "/fake/opentray",
  args: [],
  executablePath: "/fake/opentray",
  artifactIdentity: brokerIdentity("current", paths.packageVersion),
});

const writeReadyFile = async (
  paths: ReturnType<typeof resolveDaemonPaths>,
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

const createExitedDriver = (): DaemonDriver => ({
  async resolveBroker(paths) {
    return resolvedBroker(paths);
  },
  async isAlive() {
    return false;
  },
  async spawnBroker() {
    return 40_000;
  },
  async stop() {},
});

const createDelayedReadyDriver = (
  readyDelayMs: number,
): DaemonDriver & { readonly stopped: number[] } => {
  const alive = new Set<number>();
  const stopped: number[] = [];

  return {
    stopped,
    async resolveBroker(paths) {
      return resolvedBroker(paths);
    },
    async isAlive(pid) {
      return alive.has(pid);
    },
    async spawnBroker(paths, broker) {
      const pid = 50_000;
      alive.add(pid);
      setTimeout(() => {
        void writeReadyFile(paths, pid, broker.artifactIdentity).catch(() => undefined);
      }, readyDelayMs);
      return pid;
    },
    async stop(pid) {
      stopped.push(pid);
      alive.delete(pid);
    },
  };
};

const waitForLog = async (path: string, expected: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await readFile(path, "utf8")).includes(expected)) return;
    } catch {
      // The detached process may not have opened the file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${expected} in ${path}`);
};
