// Orthogonal intents (2026-07-20; original user request: stable caller-owned
// Darwin app bundles must carry the correct name, icon, and broker):
// 1. Generate a stable `.app` directory from a minimal Info.plist template.
// 2. Validate plugin-built bundles without mutating prebuilt artifacts.
// 3. Atomically replace OpenTray-owned files and commit the manifest last.

import { createHash } from "node:crypto";
import {
  access,
  chmod,
  constants,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { build as buildPlist, parse as parsePlist, type PlistValue } from "plist";

import type { AppIcon, AppIconAsset, AppIconSource } from "@opentray/spec";

const APP_BUNDLE_SCHEMA_VERSION = 1;
const APP_BUNDLE_MANIFEST = "Contents/Resources/opentray-app-bundle.json";
const APP_BUNDLE_EXECUTABLE = "Contents/MacOS/opentray";
const APP_BUNDLE_PLIST = "Contents/Info.plist";
const APP_BUNDLE_ICON = "Contents/Resources/AppIcon.icns";
const APP_BUNDLE_LOCK_TIMEOUT_MS = 5_000;
const APP_BUNDLE_OWNER_SUFFIX = ".opentray-owner.json";

export interface DarwinAppBundleTarget {
  readonly os: "darwin";
  readonly arch: "arm64" | "x64";
}

/** Caller-facing control for the stable Darwin bundle location and ownership mode. */
export interface OpenTrayAppBundleOptions {
  readonly path?: string | URL;
  /** Defaults to true. False validates a plugin-generated bundle read-only. */
  readonly reinitialize?: boolean;
}

export interface DarwinAppBundleOptions {
  readonly bundlePath: string;
  readonly packageName: string;
  readonly appId: string;
  readonly appName: string;
  readonly target: DarwinAppBundleTarget;
  readonly brokerPath: string;
  readonly templatePath: string;
  readonly appIcon?: AppIcon;
  readonly reinitialize?: boolean;
}

export interface OpenTrayDarwinAppBundleResult {
  readonly bundlePath: string;
  readonly executablePath: string;
}

export interface DarwinAppBundleManifest {
  readonly schemaVersion: 1;
  readonly packageName: string;
  readonly appId: string;
  readonly appName: string;
  readonly target: DarwinAppBundleTarget;
  readonly templateHash: string;
  readonly broker: {
    readonly path: typeof APP_BUNDLE_EXECUTABLE;
    readonly hash: string;
  };
  readonly icon?: {
    readonly path: typeof APP_BUNDLE_ICON;
    readonly hash: string;
  };
}

export type DarwinAppBundleErrorCode =
  | "missing_bundle"
  | "invalid_bundle"
  | "incompatible_bundle"
  | "bundle_in_use"
  | "bundle_lock_timeout";

export class DarwinAppBundleError extends Error {
  constructor(
    readonly code: DarwinAppBundleErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DarwinAppBundleError";
  }
}

/** Generates or validates the caller-owned Darwin bundle and returns its executable. */
export const ensureDarwinAppBundle = async (
  options: DarwinAppBundleOptions,
): Promise<string> => {
  const expected = await resolveExpectedBundle(options);
  const lockPath = `${options.bundlePath}.opentray.lock`;
  // The default package-derived path may not exist on first launch. Create only
  // the lock parent; managed files are still written through the normal bundle
  // generation transaction below.
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await acquireBundleLock(lockPath);
  try {
    if (options.reinitialize === false) {
      await validateDarwinAppBundle(options, expected);
    } else {
      await generateDarwinAppBundle(options, expected);
    }
    return join(options.bundlePath, APP_BUNDLE_EXECUTABLE);
  } finally {
    await lock.release();
  }
};

/** Build-plugin result shape shared by Vite, esbuild, webpack, and tsdown adapters. */
export const buildDarwinAppBundle = async (
  options: DarwinAppBundleOptions,
): Promise<OpenTrayDarwinAppBundleResult> => ({
  bundlePath: options.bundlePath,
  executablePath: await ensureDarwinAppBundle({ ...options, reinitialize: true }),
});

/** Reads and validates a prebuilt bundle without writing any file inside it. */
export const validateDarwinAppBundle = async (
  options: DarwinAppBundleOptions,
  expected?: ResolvedDarwinAppBundle,
): Promise<DarwinAppBundleManifest> => {
  const resolved = expected ?? (await resolveExpectedBundle(options));
  const manifestPath = join(options.bundlePath, APP_BUNDLE_MANIFEST);
  const executablePath = join(options.bundlePath, APP_BUNDLE_EXECUTABLE);
  const plistPath = join(options.bundlePath, APP_BUNDLE_PLIST);
  const iconPath = join(options.bundlePath, APP_BUNDLE_ICON);
  let manifest: DarwinAppBundleManifest;
  try {
    manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof DarwinAppBundleError) throw error;
    throw new DarwinAppBundleError(
      "invalid_bundle",
      `unable to read Darwin app bundle manifest: ${manifestPath}`,
      { cause: error },
    );
  }
  if (
    manifest.packageName !== options.packageName ||
    manifest.appId !== options.appId ||
    manifest.appName !== options.appName ||
    manifest.target.os !== options.target.os ||
    manifest.target.arch !== options.target.arch ||
    manifest.templateHash !== resolved.templateHash ||
    manifest.broker.hash !== resolved.brokerHash
  ) {
    throw incompatibleBundle(options.bundlePath, "manifest identity or hash does not match the current runtime");
  }
  await assertAccessible(executablePath, constants.X_OK, "broker executable");
  if ((await hashFile(executablePath)) !== resolved.brokerHash) {
    throw incompatibleBundle(options.bundlePath, "embedded broker hash does not match the current runtime");
  }
  const plist = await readBundlePlist(plistPath);
  if (
    plist.CFBundleIdentifier !== options.appId ||
    plist.CFBundleName !== options.appName ||
    plist.CFBundleDisplayName !== options.appName ||
    plist.CFBundleExecutable !== "opentray"
  ) {
    throw incompatibleBundle(options.bundlePath, "Info.plist identity does not match the current runtime");
  }
  const expectedIcon = resolved.icon;
  if (expectedIcon !== undefined) {
    if (manifest.icon === undefined) {
      throw incompatibleBundle(options.bundlePath, "prebuilt bundle has no default Darwin app icon");
    }
    await assertAccessible(iconPath, constants.F_OK, "app icon");
    if ((await hashFile(iconPath)) !== expectedIcon.hash) {
      throw incompatibleBundle(options.bundlePath, "embedded app icon does not match the declared appIcon");
    }
    if (manifest.icon.hash !== expectedIcon.hash) {
      throw incompatibleBundle(options.bundlePath, "app icon manifest hash does not match the declared appIcon");
    }
  } else if (manifest.icon !== undefined) {
    await assertAccessible(iconPath, constants.F_OK, "app icon");
    if ((await hashFile(iconPath)) !== manifest.icon.hash) {
      throw incompatibleBundle(options.bundlePath, "embedded app icon hash is invalid");
    }
  }
  return manifest;
};

interface ResolvedDarwinAppBundle {
  readonly templateHash: string;
  readonly brokerHash: string;
  readonly icon?: { readonly bytes: Buffer; readonly hash: string };
}

const resolveExpectedBundle = async (
  options: DarwinAppBundleOptions,
): Promise<ResolvedDarwinAppBundle> => {
  const icon = await resolveDefaultIcon(options.appIcon);
  return {
    templateHash: await hashFile(options.templatePath),
    brokerHash: await hashFile(options.brokerPath),
    ...(icon === undefined ? {} : { icon }),
  };
};

const generateDarwinAppBundle = async (
  options: DarwinAppBundleOptions,
  expected: ResolvedDarwinAppBundle,
): Promise<void> => {
  await assertBundleOwnerAvailable(options.bundlePath, expected.brokerHash);
  const plistPath = join(options.bundlePath, APP_BUNDLE_PLIST);
  const executablePath = join(options.bundlePath, APP_BUNDLE_EXECUTABLE);
  const iconPath = join(options.bundlePath, APP_BUNDLE_ICON);
  const manifestPath = join(options.bundlePath, APP_BUNDLE_MANIFEST);
  const template = await readBundlePlist(options.templatePath);
  const plist: Record<string, PlistValue> = { ...template };
  plist.CFBundleIdentifier = options.appId;
  plist.CFBundleName = options.appName;
  plist.CFBundleDisplayName = options.appName;
  plist.CFBundleExecutable = "opentray";
  plist.CFBundlePackageType = "APPL";
  if (expected.icon !== undefined) {
    plist.CFBundleIconFile = "AppIcon.icns";
    plist.CFBundleIconName = "AppIcon";
  } else {
    delete plist.CFBundleIconFile;
    delete plist.CFBundleIconName;
  }
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(dirname(executablePath), { recursive: true });
  await atomicWrite(plistPath, buildPlist(plist));
  await atomicCopy(options.brokerPath, executablePath, 0o755);
  if (expected.icon !== undefined) {
    await mkdir(dirname(iconPath), { recursive: true });
    await atomicWrite(iconPath, expected.icon.bytes);
  } else {
    await rm(iconPath, { force: true });
  }
  const manifest: DarwinAppBundleManifest = {
    schemaVersion: APP_BUNDLE_SCHEMA_VERSION,
    packageName: options.packageName,
    appId: options.appId,
    appName: options.appName,
    target: options.target,
    templateHash: expected.templateHash,
    broker: { path: APP_BUNDLE_EXECUTABLE, hash: expected.brokerHash },
    ...(expected.icon === undefined
      ? {}
      : { icon: { path: APP_BUNDLE_ICON as typeof APP_BUNDLE_ICON, hash: expected.icon.hash } }),
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

/** Called by the Node daemon driver after spawning the broker. */
export const writeDarwinAppBundleOwner = async (
  bundlePath: string,
  pid: number,
  brokerHash: string,
): Promise<void> => {
  await atomicWrite(
    `${bundlePath}${APP_BUNDLE_OWNER_SUFFIX}`,
    `${JSON.stringify({ pid, brokerHash })}\n`,
  );
};

/** Removes an owner marker only when it still belongs to the stopped process. */
export const clearDarwinAppBundleOwner = async (
  bundlePath: string,
  pid: number,
): Promise<void> => {
  const markerPath = `${bundlePath}${APP_BUNDLE_OWNER_SUFFIX}`;
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
    if (isRecord(marker) && marker.pid === pid) await rm(markerPath, { force: true });
  } catch (error) {
    if (!isNodeError(error) || (error.code !== "ENOENT" && !(error instanceof SyntaxError))) {
      throw error;
    }
  }
};

const assertBundleOwnerAvailable = async (
  bundlePath: string,
  brokerHash: string,
): Promise<void> => {
  const markerPath = `${bundlePath}${APP_BUNDLE_OWNER_SUFFIX}`;
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    if (error instanceof SyntaxError) {
      await rm(markerPath, { force: true });
      return;
    }
    throw error;
  }
  if (!isRecord(marker) || typeof marker.pid !== "number" || typeof marker.brokerHash !== "string") {
    await rm(markerPath, { force: true });
    return;
  }
  if (!isProcessAlive(marker.pid)) {
    await rm(markerPath, { force: true });
    return;
  }
  if (marker.brokerHash !== brokerHash) {
    throw new DarwinAppBundleError(
      "bundle_in_use",
      `Darwin app bundle is owned by a live incompatible broker: ${bundlePath} (pid=${marker.pid})`,
    );
  }
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
};

const readBundlePlist = async (path: string): Promise<Record<string, PlistValue>> => {
  try {
    const parsed = parsePlist(await readFile(path, "utf8"));
    if (!isRecord(parsed)) throw new Error("plist root is not a dictionary");
    return { ...(parsed as Record<string, PlistValue>) };
  } catch (error) {
    if (error instanceof DarwinAppBundleError) throw error;
    throw new DarwinAppBundleError("invalid_bundle", `invalid Darwin Info.plist: ${path}`, { cause: error });
  }
};

const parseManifest = (value: unknown): DarwinAppBundleManifest => {
  if (!isRecord(value) || value.schemaVersion !== APP_BUNDLE_SCHEMA_VERSION) {
    throw new DarwinAppBundleError("invalid_bundle", "invalid Darwin app bundle manifest schema");
  }
  const target = value.target;
  const broker = value.broker;
  if (
    typeof value.packageName !== "string" ||
    typeof value.appId !== "string" ||
    typeof value.appName !== "string" ||
    !isRecord(target) ||
    target.os !== "darwin" ||
    (target.arch !== "arm64" && target.arch !== "x64") ||
    !isRecord(broker) ||
    broker.path !== APP_BUNDLE_EXECUTABLE ||
    typeof broker.hash !== "string"
  ) {
    throw new DarwinAppBundleError("invalid_bundle", "invalid Darwin app bundle manifest fields");
  }
  const iconValue = value.icon;
  const icon =
    iconValue === undefined
      ? undefined
      : !isRecord(iconValue) || iconValue.path !== APP_BUNDLE_ICON || typeof iconValue.hash !== "string"
        ? (() => {
            throw new DarwinAppBundleError("invalid_bundle", "invalid Darwin app bundle icon manifest");
          })()
        : { path: APP_BUNDLE_ICON as typeof APP_BUNDLE_ICON, hash: iconValue.hash };
  if (typeof value.templateHash !== "string") {
    throw new DarwinAppBundleError("invalid_bundle", "invalid Darwin app bundle template hash");
  }
  return {
    schemaVersion: APP_BUNDLE_SCHEMA_VERSION,
    packageName: value.packageName,
    appId: value.appId,
    appName: value.appName,
    target: { os: "darwin", arch: target.arch },
    templateHash: value.templateHash,
    broker: { path: APP_BUNDLE_EXECUTABLE, hash: broker.hash },
    ...(icon === undefined ? {} : { icon }),
  };
};

const resolveDefaultIcon = async (
  appIcon: AppIcon | undefined,
): Promise<ResolvedDarwinAppBundle["icon"]> => {
  const asset = selectDefaultDarwinIcon(appIcon);
  if (asset === undefined) return undefined;
  const bytes = await readIconSource(asset.source);
  return { bytes, hash: hashBytes(bytes) };
};

const selectDefaultDarwinIcon = (
  appIcon: AppIcon | undefined,
): AppIconAsset & { readonly platform: "darwin"; readonly format: "icns" } | undefined =>
  appIcon?.find((asset) => {
    if (asset.platform !== "darwin" || asset.format !== "icns") return false;
    const variants = asset.variant === undefined ? ["default"] : typeof asset.variant === "string" ? [asset.variant] : asset.variant;
    return variants.includes("default");
  }) as (AppIconAsset & { readonly platform: "darwin"; readonly format: "icns" }) | undefined;

const readIconSource = async (source: AppIconSource): Promise<Buffer> => {
  if (source.type === "file") return readFile(source.path);
  return Buffer.from(source.data instanceof Uint8Array ? source.data : Array.from(source.data));
};

const assertAccessible = async (path: string, mode: number, label: string): Promise<void> => {
  try {
    await access(path, mode);
  } catch (error) {
    throw new DarwinAppBundleError("missing_bundle", `Darwin app bundle ${label} is unavailable: ${path}`, { cause: error });
  }
};

const incompatibleBundle = (path: string, reason: string): DarwinAppBundleError =>
  new DarwinAppBundleError("incompatible_bundle", `incompatible Darwin app bundle at ${path}: ${reason}`);

const hashFile = async (path: string): Promise<string> => hashBytes(await readFile(path));

const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

let temporaryFileCounter = 0;
const atomicWrite = async (path: string, value: string | Uint8Array, mode?: number): Promise<void> => {
  const temporary = `${path}.next-${process.pid}-${temporaryFileCounter++}`;
  try {
    await writeFile(temporary, value);
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

const atomicCopy = async (source: string, destination: string, mode?: number): Promise<void> =>
  atomicWrite(destination, await readFile(source), mode);

const acquireBundleLock = async (lockPath: string): Promise<{ release(): Promise<void> }> => {
  const deadline = Date.now() + APP_BUNDLE_LOCK_TIMEOUT_MS;
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
  throw new DarwinAppBundleError("bundle_lock_timeout", `timed out acquiring Darwin app bundle lock: ${lockPath}`);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
