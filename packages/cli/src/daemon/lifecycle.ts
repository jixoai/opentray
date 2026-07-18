import { constants } from "node:fs";
import { mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import {
  brokerArtifactIdentityEquals,
  isBrokerArtifactIdentity,
  type BrokerReadyMetadata,
} from "@opentray/spec";

import {
  resolveBrokerArtifact,
  type ResolvedBrokerArtifact,
} from "./broker-command";
import type { DaemonPaths } from "./paths";

const DAEMON_STDIO_ENV = "OPENTRAY_DAEMON_STDIO";

export type DaemonStartResult =
  | {
      status: "started";
      pid: number;
      paths: DaemonPaths;
      broker: ResolvedBrokerArtifact;
    }
  | {
      status: "already-running";
      pid: number;
      paths: DaemonPaths;
      broker: ResolvedBrokerArtifact;
    };

export type DaemonStopResult =
  | { status: "stopped"; pid: number; paths: DaemonPaths }
  | { status: "not-running"; paths: DaemonPaths };

export type DaemonInspectResult =
  | { status: "running"; pid: number; paths: DaemonPaths }
  | { status: "not-running"; paths: DaemonPaths; stalePid?: number };

export interface DaemonDriver {
  resolveBroker(paths: DaemonPaths): Promise<ResolvedBrokerArtifact>;
  isAlive(pid: number): Promise<boolean>;
  spawnBroker(
    paths: DaemonPaths,
    broker: ResolvedBrokerArtifact,
  ): Promise<number>;
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

export const createNodeDaemonDriver = (
  cliEntrypoint: string,
): DaemonDriver => ({
  async resolveBroker(paths) {
    return resolveBrokerArtifact(paths);
  },
  async isAlive(pid) {
    return isProcessAlive(pid);
  },
  async spawnBroker(paths, broker) {
    // The caller label flows to the broker via both a CLI flag and an env var.
    // The broker uses it to bind the per-caller endpoint and to set its own
    // process title so task managers show the owning application.
    const child = spawn(broker.command, broker.args, {
      cwd: broker.cwd,
      detached: true,
      env: {
        ...process.env,
        OPENTRAY_DAEMON_HOME: paths.homeDir,
        OPENTRAY_DAEMON_PACKAGE_VERSION: paths.packageVersion,
        OPENTRAY_DAEMON_CLI_ENTRYPOINT: cliEntrypoint,
        OPENTRAY_DAEMON_APP_ID: paths.appId,
        OPENTRAY_DAEMON_APP_NAME: paths.appName,
        OPENTRAY_DAEMON_CALLER_LABEL: paths.callerLabel,
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
  const broker = await driver.resolveBroker(paths);
  await mkdir(paths.runtimeDir, { recursive: true });

  const lock = await acquireLock(paths.lockFile, lockTimeoutMs);
  try {
    const existingPid = await readPid(paths.pidFile);
    if (existingPid !== undefined && (await driver.isAlive(existingPid))) {
      const ready = await readReadyMetadata(paths.readyFile);
      // Liveness is not compatibility: only the exact resolved executable may win reuse.
      if (readyMatchesBroker(ready, paths, existingPid, broker)) {
        return {
          status: "already-running",
          pid: existingPid,
          paths,
          broker,
        };
      }
      await driver.stop(existingPid);
      if (!(await waitUntilStopped(driver, existingPid))) {
        throw new Error(
          `incompatible daemon broker did not stop within the bounded shutdown window: pid=${existingPid}`,
        );
      }
    }

    await cleanupRuntimeFiles(paths);
    const pid = await driver.spawnBroker(paths, broker);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error("daemon broker process did not expose a valid pid");
    }
    await writeFile(paths.pidFile, `${pid}\n`, "utf8");
    try {
      await waitForReadyFile(paths, driver, pid, broker);
    } catch (error) {
      if (await driver.isAlive(pid)) {
        await driver.stop(pid);
        await waitUntilStopped(driver, pid);
      }
      await cleanupRuntimeFiles(paths);
      throw error;
    }
    return { status: "started", pid, paths, broker };
  } finally {
    await lock.release();
  }
};

export const stopDaemon = async ({
  paths,
  driver,
}: StopDaemonOptions): Promise<DaemonStopResult> => {
  const pid = await readPid(paths.pidFile);
  if (pid === undefined || !(await driver.isAlive(pid))) {
    await cleanupRuntimeFiles(paths);
    return { status: "not-running", paths };
  }

  await driver.stop(pid);
  if (!(await waitUntilStopped(driver, pid))) {
    throw new Error(`daemon broker did not stop within the bounded shutdown window: pid=${pid}`);
  }
  await cleanupRuntimeFiles(paths);
  return { status: "stopped", pid, paths };
};

export const restartDaemon = async (
  options: StartDaemonOptions
): Promise<DaemonStartResult> => {
  await stopDaemon({ paths: options.paths, driver: options.driver });
  return startDaemon(options);
};

export const inspectDaemon = async ({
  paths,
  driver,
}: InspectDaemonOptions): Promise<DaemonInspectResult> => {
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

const waitUntilStopped = async (
  driver: DaemonDriver,
  pid: number,
): Promise<boolean> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await driver.isAlive(pid))) {
      return true;
    }
    await sleep(50);
  }
  return false;
};

const waitForReadyFile = async (
  paths: DaemonPaths,
  driver: DaemonDriver,
  pid: number,
  broker: ResolvedBrokerArtifact,
): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await readReadyMetadata(paths.readyFile);
    if (readyMatchesBroker(ready, paths, pid, broker)) {
      return;
    }
    if (ready !== undefined) {
      throw new Error(
        `daemon readiness artifact identity mismatch: expected=${JSON.stringify(broker.artifactIdentity)} actual=${JSON.stringify(ready.brokerArtifactIdentity)}`,
      );
    }
    if (!(await driver.isAlive(pid))) {
      throw new Error(
        `daemon broker exited before readiness: pid=${pid}; readyFile=${paths.readyFile}; set ${DAEMON_STDIO_ENV}=inherit to inspect broker stderr`,
      );
    }
    await sleep(50);
  }

  throw new Error(`timed out waiting for daemon readiness: ${paths.readyFile}`);
};

const readReadyMetadata = async (
  readyFile: string,
): Promise<BrokerReadyMetadata | undefined> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(readyFile, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
  if (
    !isRecord(value) ||
    !Number.isInteger(value.pid) ||
    typeof value.pid !== "number" ||
    typeof value.endpoint !== "string" ||
    typeof value.packageVersion !== "string" ||
    typeof value.protocolVersion !== "number" ||
    typeof value.appId !== "string" ||
    typeof value.appName !== "string" ||
    typeof value.callerLabel !== "string" ||
    typeof value.executablePath !== "string" ||
    !isBrokerArtifactIdentity(value.brokerArtifactIdentity)
  ) {
    return undefined;
  }
  return {
    pid: value.pid,
    endpoint: value.endpoint,
    packageVersion: value.packageVersion,
    protocolVersion: value.protocolVersion,
    appId: value.appId,
    appName: value.appName,
    callerLabel: value.callerLabel,
    executablePath: value.executablePath,
    brokerArtifactIdentity: value.brokerArtifactIdentity,
  };
};

const readyMatchesBroker = (
  ready: BrokerReadyMetadata | undefined,
  paths: DaemonPaths,
  pid: number,
  broker: ResolvedBrokerArtifact,
): boolean =>
  ready !== undefined &&
  ready.pid === pid &&
  ready.endpoint === paths.endpoint &&
  ready.packageVersion === paths.packageVersion &&
  ready.protocolVersion === paths.protocolVersion &&
  ready.appId === paths.appId &&
  ready.appName === paths.appName &&
  ready.callerLabel === paths.callerLabel &&
  ready.executablePath === broker.executablePath &&
  brokerArtifactIdentityEquals(
    ready.brokerArtifactIdentity,
    broker.artifactIdentity,
  );

const acquireLock = async (
  lockFile: string,
  timeoutMs: number
): Promise<{
  release(): Promise<void>;
}> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const handle = await open(
        lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      );
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
