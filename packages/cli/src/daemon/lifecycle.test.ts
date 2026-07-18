import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { BrokerArtifactIdentity } from "@opentray/spec";

import type { DaemonDriver } from "./lifecycle";
import {
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
  it("keeps broker stdio quiet by default and allows explicit inherit for debugging", () => {
    expect(resolveBrokerStdio(undefined)).toBe("ignore");
    expect(resolveBrokerStdio("quiet")).toBe("ignore");
    expect(resolveBrokerStdio("inherit")).toBe("inherit");
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

  it("reports broker exit before readiness instead of masking it as a timeout", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createExitedDriver();

    await expect(startDaemon({ paths, driver })).rejects.toThrow(
      "daemon broker exited before readiness",
    );
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
