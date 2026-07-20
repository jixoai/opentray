// Orthogonal intents (updated 2026-07-21; original user requests: detached
// brokers must be caller-scoped, artifact-coherent, and diagnosable by default):
// 1. Start, inspect, restart, and stop one caller-scoped broker under a lock.
// 2. Reject liveness-only reuse through exact ready artifact identity.
// 3. Preserve Darwin stable-bundle live-owner protection.
// 4. Persist detached broker output unless the operator explicitly overrides it.

import { constants } from "node:fs";
import { access, appendFile, mkdir, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

import {
  brokerArtifactIdentityEquals,
  isBrokerArtifactIdentity,
  type BrokerReadyMetadata,
} from "@opentray/spec";

import { resolveBrokerArtifact, type ResolvedBrokerArtifact } from "./broker-command";
import type { DaemonPaths } from "./paths";
import type { AppIcon } from "@opentray/spec";
import type { OpenTrayAppBundleOptions, OpenTrayPackageIdentity } from "@opentray/packaging";
import { clearDarwinAppBundleOwner, writeDarwinAppBundleOwner } from "@opentray/packaging";

const DAEMON_STDIO_ENV = "OPENTRAY_DAEMON_STDIO";
const DEFAULT_DAEMON_LOCK_TIMEOUT_MS = 5_000;

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
  spawnBroker(paths: DaemonPaths, broker: ResolvedBrokerArtifact): Promise<number>;
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

export interface NodeDaemonDriverOptions {
  readonly appBundle?: OpenTrayAppBundleOptions & { readonly path: string };
  readonly appIcon?: AppIcon;
  readonly packageIdentity?: OpenTrayPackageIdentity;
  readonly env?: NodeJS.ProcessEnv;
}

export const createNodeDaemonDriver = (
  cliEntrypoint: string,
  options: NodeDaemonDriverOptions = {},
): DaemonDriver => ({
  async resolveBroker(paths) {
    return resolveBrokerArtifact(paths, {
      ...(options.appBundle === undefined ? {} : { appBundle: options.appBundle }),
      ...(options.appIcon === undefined ? {} : { appIcon: options.appIcon }),
      ...(options.packageIdentity === undefined
        ? {}
        : { packageIdentity: options.packageIdentity }),
    });
  },
  async isAlive(pid) {
    return isProcessAlive(pid);
  },
  async spawnBroker(paths, broker) {
    // The caller label flows to the broker via both a CLI flag and an env var.
    // The broker uses it to bind the per-caller endpoint and to set its own
    // process title so task managers show the owning application.
    const env = options.env ?? process.env;
    const stdio = resolveBrokerStdio(env[DAEMON_STDIO_ENV]);
    if (stdio === "log") await mkdir(paths.runtimeDir, { recursive: true });
    const logHandle = stdio === "log" ? await open(paths.brokerLog, "a") : undefined;
    if (logHandle !== undefined) {
      await logHandle.appendFile(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "broker-spawn",
          command: broker.command,
          cwd: broker.cwd ?? process.cwd(),
          appId: paths.appId,
          appName: paths.appName,
        })}\n`,
        "utf8",
      );
    }
    if (isAbsolute(broker.command)) {
      try {
        await access(
          broker.command,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
      } catch (error) {
        if (stdio === "log") {
          await appendFile(
            paths.brokerLog,
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              event: "broker-spawn-error",
              command: broker.command,
              error: error instanceof Error ? error.message : String(error),
            })}\n`,
            "utf8",
          ).catch(() => undefined);
        }
        await logHandle?.close();
        return 0;
      }
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(broker.command, broker.args, {
        cwd: broker.cwd,
        detached: true,
        env: {
          ...env,
          OPENTRAY_DAEMON_HOME: paths.homeDir,
          OPENTRAY_DAEMON_PACKAGE_VERSION: paths.packageVersion,
          OPENTRAY_DAEMON_CLI_ENTRYPOINT: cliEntrypoint,
          OPENTRAY_DAEMON_APP_ID: paths.appId,
          OPENTRAY_DAEMON_APP_NAME: paths.appName,
          OPENTRAY_DAEMON_CALLER_LABEL: paths.callerLabel,
        },
        stdio:
          logHandle === undefined
            ? stdio === "log"
              ? "ignore"
              : stdio
            : ["ignore", logHandle.fd, logHandle.fd],
      });
    } finally {
      await logHandle?.close();
    }

    child.on("error", (error) => {
      if (stdio !== "log") return;
      void appendFile(
        paths.brokerLog,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "broker-spawn-error",
          command: broker.command,
          error: error.message,
        })}\n`,
        "utf8",
      ).catch(() => undefined);
    });

    child.unref();
    const pid = child.pid ?? 0;
    if (process.platform === "darwin" && options.appBundle !== undefined && pid > 0) {
      await writeDarwinAppBundleOwner(
        options.appBundle.path,
        pid,
        broker.artifactIdentity.executableHash,
      );
    }
    return pid;
  },
  async stop(pid) {
    process.kill(pid, "SIGTERM");
    if (process.platform === "darwin" && options.appBundle !== undefined) {
      await clearDarwinAppBundleOwner(options.appBundle.path, pid);
    }
  },
});

export const resolveBrokerStdio = (value: string | undefined): "log" | "ignore" | "inherit" => {
  if (value === "inherit") return "inherit";
  if (value === "ignore") return "ignore";
  return "log";
};

export const startDaemon = async ({
  paths,
  driver,
  lockTimeoutMs = DEFAULT_DAEMON_LOCK_TIMEOUT_MS,
}: StartDaemonOptions): Promise<DaemonStartResult> => {
  await mkdir(paths.runtimeDir, { recursive: true });

  const lock = await acquireLock(paths.lockFile, lockTimeoutMs);
  try {
    const existingPid = await readPid(paths.pidFile);
    let existingAlive = existingPid !== undefined && (await driver.isAlive(existingPid));
    let broker: ResolvedBrokerArtifact;
    try {
      // Darwin bundle materialization is part of broker resolution. The bundle owner marker
      // rejects an incompatible live owner before any managed file is replaced.
      broker = await driver.resolveBroker(paths);
    } catch (error) {
      if (existingAlive && isBundleInUseError(error) && existingPid !== undefined) {
        await driver.stop(existingPid);
        if (!(await waitUntilStopped(driver, existingPid))) {
          throw new Error(
            `incompatible daemon broker did not stop within the bounded shutdown window: pid=${existingPid}`,
          );
        }
        existingAlive = false;
        broker = await driver.resolveBroker(paths);
      } else {
        throw error;
      }
    }
    if (existingPid !== undefined && existingAlive) {
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

export const restartDaemon = async (options: StartDaemonOptions): Promise<DaemonStartResult> => {
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

const waitUntilStopped = async (driver: DaemonDriver, pid: number): Promise<boolean> => {
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

const readReadyMetadata = async (readyFile: string): Promise<BrokerReadyMetadata | undefined> => {
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
  executablePathsEqual(ready.executablePath, broker.executablePath) &&
  brokerArtifactIdentityEquals(ready.brokerArtifactIdentity, broker.artifactIdentity);

const isBundleInUseError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "bundle_in_use";

export const executablePathsEqual = (
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  if (platform !== "win32") {
    return left === right;
  }

  const normalize = (value: string): string =>
    value
      .replaceAll("\\", "/")
      .replace(/^\/\/?\?\//u, "")
      .toLowerCase();
  return normalize(left) === normalize(right);
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
      const handle = await open(
        lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
