import { constants } from "node:fs";
import { mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { resolveBrokerCommand } from "./broker-command";
import type { DaemonPaths } from "./paths";

const DAEMON_STDIO_ENV = "OPENTRAY_DAEMON_STDIO";

export type DaemonStartResult =
  | { status: "started"; pid: number; paths: DaemonPaths }
  | { status: "already-running"; pid: number; paths: DaemonPaths };

export type DaemonStopResult =
  | { status: "stopped"; pid: number; paths: DaemonPaths }
  | { status: "not-running"; paths: DaemonPaths };

export type DaemonInspectResult =
  | { status: "running"; pid: number; paths: DaemonPaths }
  | { status: "not-running"; paths: DaemonPaths; stalePid?: number };

export interface DaemonDriver {
  isAlive(pid: number): Promise<boolean>;
  spawnBroker(paths: DaemonPaths): Promise<number>;
  stop(pid: number): Promise<void>;
}

export interface StartDaemonOptions {
  paths: DaemonPaths;
  driver: DaemonDriver;
  lockTimeoutMs?: number;
}

export interface StopDaemonOptions {
  paths: DaemonPaths;
  driver: DaemonDriver;
}

export interface InspectDaemonOptions {
  paths: DaemonPaths;
  driver: DaemonDriver;
}

export const createNodeDaemonDriver = (cliEntrypoint: string): DaemonDriver => ({
  async isAlive(pid) {
    return isProcessAlive(pid);
  },
  async spawnBroker(paths) {
    const broker = await resolveBrokerCommand(paths);
    const child = spawn(broker.command, broker.args, {
      cwd: broker.cwd,
      detached: true,
      env: {
        ...process.env,
        OPENTRAY_DAEMON_HOME: paths.homeDir,
        OPENTRAY_DAEMON_PACKAGE_VERSION: paths.packageVersion,
        OPENTRAY_DAEMON_CLI_ENTRYPOINT: cliEntrypoint,
      },
      stdio: resolveBrokerStdio(process.env[DAEMON_STDIO_ENV]),
    });

    child.unref();
    return child.pid ?? 0;
  },
  async stop(pid) {
    process.kill(pid, "SIGTERM");
  },
});

export const resolveBrokerStdio = (
  value: string | undefined,
): "ignore" | "inherit" => {
  return value === "inherit" ? "inherit" : "ignore";
};

export const startDaemon = async ({
  paths,
  driver,
  lockTimeoutMs = 1_000,
}: StartDaemonOptions): Promise<DaemonStartResult> => {
  await mkdir(paths.runtimeDir, { recursive: true });

  const lock = await acquireLock(paths.lockFile, lockTimeoutMs);
  try {
    const existingPid = await readPid(paths.pidFile);
    if (existingPid !== undefined && (await driver.isAlive(existingPid))) {
      return { status: "already-running", pid: existingPid, paths };
    }

    await cleanupRuntimeFiles(paths);
    const pid = await driver.spawnBroker(paths);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error("daemon broker process did not expose a valid pid");
    }
    await writeFile(paths.pidFile, `${pid}\n`, "utf8");
    await waitForReadyFile(paths.readyFile, driver, pid);
    return { status: "started", pid, paths };
  } finally {
    await lock.release();
  }
};

export const stopDaemon = async ({ paths, driver }: StopDaemonOptions): Promise<DaemonStopResult> => {
  const pid = await readPid(paths.pidFile);
  if (pid === undefined || !(await driver.isAlive(pid))) {
    await cleanupRuntimeFiles(paths);
    return { status: "not-running", paths };
  }

  await driver.stop(pid);
  await waitUntilStopped(driver, pid);
  await cleanupRuntimeFiles(paths);
  return { status: "stopped", pid, paths };
};

export const restartDaemon = async (options: StartDaemonOptions): Promise<DaemonStartResult> => {
  await stopDaemon({ paths: options.paths, driver: options.driver });
  return startDaemon(options);
};

export const inspectDaemon = async ({ paths, driver }: InspectDaemonOptions): Promise<DaemonInspectResult> => {
  const pid = await readPid(paths.pidFile);
  if (pid !== undefined && (await driver.isAlive(pid))) {
    return { status: "running", pid, paths };
  }

  await cleanupRuntimeFiles(paths);
  return pid === undefined
    ? { status: "not-running", paths }
    : { status: "not-running", paths, stalePid: pid };
};

const readPid = async (pidFile: string): Promise<number | undefined> => {
  try {
    const content = await readFile(pidFile, "utf8");
    const pid = Number.parseInt(content.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const cleanupRuntimeFiles = async (paths: DaemonPaths): Promise<void> => {
  await rm(paths.readyFile, { force: true });
  await rm(paths.pidFile, { force: true });
  if (process.platform !== "win32") {
    await rm(paths.endpoint, { force: true });
  }
};

const waitUntilStopped = async (driver: DaemonDriver, pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await driver.isAlive(pid))) {
      return;
    }
    await sleep(50);
  }
};

const waitForReadyFile = async (
  readyFile: string,
  driver: DaemonDriver,
  pid: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await readFile(readyFile, "utf8");
      return;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      if (!(await driver.isAlive(pid))) {
        throw new Error(
          `daemon broker exited before readiness: pid=${pid}; readyFile=${readyFile}; set ${DAEMON_STDIO_ENV}=inherit to inspect broker stderr`,
        );
      }
      await sleep(50);
    }
  }

  throw new Error(`timed out waiting for daemon readiness: ${readyFile}`);
};

const acquireLock = async (
  lockFile: string,
  timeoutMs: number,
): Promise<{
  release(): Promise<void>;
}> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      return {
        async release() {
          await handle.close();
          await unlink(lockFile).catch((error: unknown) => {
            if (!isNodeError(error) || error.code !== "ENOENT") {
              throw error;
            }
          });
        },
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        await sleep(25);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`timed out acquiring daemon lock: ${lockFile}`);
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
