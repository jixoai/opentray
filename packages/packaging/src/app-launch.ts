// Orthogonal intents (2026-07-20; original user request: persist the latest
// app launch invocation while keeping explicit launch scripts shell-free):
// 1. Define the public launch options and strict durable descriptor.
// 2. Persist runtime launch state separately from bundle compatibility identity.
// 3. Atomically replace the descriptor inside the stable caller-owned bundle.

import { access, constants, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DARWIN_APP_LAUNCH_DESCRIPTOR = "Contents/Resources/opentray-launch.json";
const DARWIN_APP_BUNDLE_MANIFEST = "Contents/Resources/opentray-app-bundle.json";

/** Caller-facing launch vector. It is executed directly; no shell is involved. */
export interface OpenTrayAppLaunchOptions {
  /** Executable path or name. OpenTray never interprets it as shell source. */
  readonly command: string;
  /** Arguments passed directly to the executable. Defaults to an empty list. */
  readonly args?: readonly string[];
  /** Child working directory. Relative paths resolve from the current cwd. */
  readonly cwd?: string;
}

/** Strict versioned launch state persisted inside a stable Darwin app bundle. */
export interface OpenTrayAppLaunchDescriptor {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export const resolveDarwinAppLaunchDescriptorPath = (bundlePath: string): string =>
  join(bundlePath, DARWIN_APP_LAUNCH_DESCRIPTOR);

/** Replaces the runtime-owned launch descriptor atomically under the stable-bundle lock. */
export const updateDarwinAppLaunchDescriptor = async (
  bundlePath: string,
  descriptor: OpenTrayAppLaunchDescriptor,
): Promise<void> => {
  const lockPath = `${bundlePath}.opentray.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await acquireDescriptorLock(lockPath);
  try {
    const normalized = parseDarwinAppLaunchDescriptor(descriptor);
    await access(join(bundlePath, DARWIN_APP_BUNDLE_MANIFEST), constants.F_OK);
    const path = resolveDarwinAppLaunchDescriptorPath(bundlePath);
    const temporary = `${path}.next-${process.pid}-${temporaryFileCounter++}`;
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  } finally {
    await lock.release();
  }
};

export const readDarwinAppLaunchDescriptor = async (
  bundlePath: string,
): Promise<OpenTrayAppLaunchDescriptor> => {
  const path = resolveDarwinAppLaunchDescriptorPath(bundlePath);
  return parseDarwinAppLaunchDescriptor(JSON.parse(await readFile(path, "utf8")) as unknown);
};

export const parseDarwinAppLaunchDescriptor = (value: unknown): OpenTrayAppLaunchDescriptor => {
  if (!isRecord(value)) throw invalidDescriptor("descriptor must be an object");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["args", "command", "cwd", "schemaVersion"].join("\0")) {
    throw invalidDescriptor("descriptor contains unknown or missing fields");
  }
  if (value.schemaVersion !== 1) throw invalidDescriptor("unsupported descriptor schemaVersion");
  if (
    typeof value.command !== "string" ||
    value.command.trim().length === 0 ||
    value.command.includes("\u0000")
  ) {
    throw invalidDescriptor("descriptor command must be a non-empty string without NUL");
  }
  if (
    typeof value.cwd !== "string" ||
    value.cwd.trim().length === 0 ||
    value.cwd.includes("\u0000")
  ) {
    throw invalidDescriptor("descriptor cwd must be a non-empty string without NUL");
  }
  if (
    !Array.isArray(value.args) ||
    value.args.some((arg) => typeof arg !== "string" || arg.includes("\u0000"))
  ) {
    throw invalidDescriptor("descriptor args must be strings without NUL");
  }
  return {
    schemaVersion: 1,
    command: value.command,
    args: [...value.args],
    cwd: value.cwd,
  };
};

const invalidDescriptor = (message: string): Error =>
  new Error(`invalid Darwin app launch descriptor: ${message}`);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const acquireDescriptorLock = async (
  lockPath: string,
): Promise<{ readonly release: () => Promise<void> }> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
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
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out acquiring Darwin app launch descriptor lock: ${lockPath}`);
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

let temporaryFileCounter = 0;
