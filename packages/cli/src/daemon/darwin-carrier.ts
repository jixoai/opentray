// Orthogonal intents (2026-07-19; original user report: Dock showed `opentray` + `exec`):
// 1. Materialize one broker-bearing Darwin app bundle per caller identity.
// 2. Keep the materialized executable byte-identical to the resolved broker artifact.
// 3. Reuse a carrier only when its archive, broker, app id, and bootstrap name still match.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  constants,
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { DaemonPaths } from "./paths";

const CARRIER_SCHEMA_VERSION = 1;
const CARRIER_DIRECTORY = "darwin-carrier";
const CARRIER_BUNDLE = "OpenTray.app";
const CARRIER_EXECUTABLE = "Contents/MacOS/opentray";
const CARRIER_INFO_PLIST = "Contents/Info.plist";
const CARRIER_LOCK_TIMEOUT_MS = 5_000;

interface DarwinCarrierMarker {
  schemaVersion: number;
  archiveHash: string;
  brokerHash: string;
  appId: string;
  appName: string;
}

export interface MaterializeDarwinCarrierOptions {
  archivePath: string;
  brokerPath: string;
  paths: DaemonPaths;
}

/** Materializes and returns the caller-owned broker executable inside a macOS app bundle. */
export const materializeDarwinBrokerCarrier = async ({
  archivePath,
  brokerPath,
  paths,
}: MaterializeDarwinCarrierOptions): Promise<string> => {
  assertBundleIdentifier(paths.appId);
  const marker: DarwinCarrierMarker = {
    schemaVersion: CARRIER_SCHEMA_VERSION,
    archiveHash: await hashFile(archivePath),
    brokerHash: await hashFile(brokerPath),
    appId: paths.appId,
    appName: paths.appName,
  };
  const carrierRoot = join(paths.runtimeDir, CARRIER_DIRECTORY);
  const bundlePath = join(carrierRoot, CARRIER_BUNDLE);
  const executablePath = join(bundlePath, CARRIER_EXECUTABLE);
  const markerPath = join(carrierRoot, "materialized.json");

  await mkdir(paths.runtimeDir, { recursive: true });
  const lock = await acquireCarrierLock(join(paths.runtimeDir, "carrier.lock"));
  try {
    if (await reusableCarrier(markerPath, executablePath, marker)) {
      return executablePath;
    }

    const temporaryRoot = `${carrierRoot}.tmp-${process.pid}-${Date.now()}`;
    await rm(temporaryRoot, { force: true, recursive: true });
    await mkdir(temporaryRoot, { recursive: true });
    try {
      await run("/usr/bin/ditto", ["-x", "-k", archivePath, temporaryRoot]);
      const extractedBundle = join(temporaryRoot, CARRIER_BUNDLE);
      const extractedExecutable = join(extractedBundle, CARRIER_EXECUTABLE);
      const extractedPlist = join(extractedBundle, CARRIER_INFO_PLIST);
      await access(extractedExecutable, constants.X_OK);
      if ((await hashFile(extractedExecutable)) !== marker.brokerHash) {
        throw new Error(
          `Darwin carrier broker mismatch: archive=${archivePath} broker=${brokerPath}`,
        );
      }
      await projectBundleIdentity(extractedPlist, paths);

      await rm(carrierRoot, { force: true, recursive: true });
      await mkdir(carrierRoot, { recursive: true });
      await rename(extractedBundle, bundlePath);
      await writeFile(
        markerPath,
        `${JSON.stringify(marker, null, 2)}\n`,
        "utf8",
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
    return executablePath;
  } finally {
    await lock.release();
  }
};

const reusableCarrier = async (
  markerPath: string,
  executablePath: string,
  expected: DarwinCarrierMarker,
): Promise<boolean> => {
  try {
    const current = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
    if (!carrierMarkerEquals(current, expected)) return false;
    await access(executablePath, constants.X_OK);
    return (await hashFile(executablePath)) === expected.brokerHash;
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    if (error instanceof SyntaxError) return false;
    throw error;
  }
};

const projectBundleIdentity = async (
  plistPath: string,
  paths: DaemonPaths,
): Promise<void> => {
  const values = {
    CFBundleIdentifier: paths.appId,
    CFBundleName: paths.appName,
    CFBundleDisplayName: paths.appName,
    CFBundleExecutable: "opentray",
  } as const;
  for (const [key, value] of Object.entries(values)) {
    await run("/usr/bin/plutil", [
      "-replace",
      key,
      "-string",
      value,
      plistPath,
    ]);
  }
  await run("/usr/bin/plutil", ["-lint", plistPath]);
};

const carrierMarkerEquals = (
  value: unknown,
  expected: DarwinCarrierMarker,
): value is DarwinCarrierMarker =>
  isRecord(value) &&
  value.schemaVersion === expected.schemaVersion &&
  value.archiveHash === expected.archiveHash &&
  value.brokerHash === expected.brokerHash &&
  value.appId === expected.appId &&
  value.appName === expected.appName;

const hashFile = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const assertBundleIdentifier = (appId: string): void => {
  if (
    !/^[A-Za-z0-9.-]+$/u.test(appId) ||
    appId.startsWith(".") ||
    appId.endsWith(".")
  ) {
    throw new Error(`invalid Darwin bundle identifier: ${appId}`);
  }
};

const acquireCarrierLock = async (
  lockPath: string,
): Promise<{ release(): Promise<void> }> => {
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      return {
        async release(): Promise<void> {
          await handle.close();
          await rm(lockPath, { force: true });
        },
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= CARRIER_LOCK_TIMEOUT_MS) {
        throw new Error(
          `timed out waiting for Darwin carrier lock: ${lockPath}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
};

const run = (command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "unknown"}`,
        ),
      );
    });
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
