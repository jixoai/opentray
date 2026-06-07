import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

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

  it("reports broker exit before readiness instead of masking it as a timeout", async () => {
    const homeDir = await makeTempHome();
    const paths = resolveDaemonPaths({ homeDir, packageVersion: "0.1.0" });
    const driver = createExitedDriver();

    await expect(startDaemon({ paths, driver })).rejects.toThrow("daemon broker exited before readiness");
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

const createFakeDriver = (spawnDelayMs = 0): DaemonDriver & { readonly spawned: number[] } => {
  const alive = new Set<number>();
  const spawned: number[] = [];
  let nextPid = 10_000;

  return {
    spawned,
    async isAlive(pid) {
      return alive.has(pid);
    },
    async spawnBroker(paths) {
      if (spawnDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, spawnDelayMs));
      }
      const pid = nextPid;
      nextPid += 1;
      alive.add(pid);
      spawned.push(pid);
      await writeFile(paths.readyFile, `${JSON.stringify({ pid })}\n`, "utf8");
      return pid;
    },
    async stop(pid) {
      alive.delete(pid);
    },
  };
};

const createExitedDriver = (): DaemonDriver => ({
  async isAlive() {
    return false;
  },
  async spawnBroker() {
    return 40_000;
  },
  async stop() {},
});
