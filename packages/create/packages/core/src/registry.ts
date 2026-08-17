// Fixed-root registration scanning (openspec change unify-create-opentray-core).
//
// The create registry has ONE physical root: `~/.opentray/create/`. A
// registration is a physical directory keyed by the encoded immutable
// appId containing `create-opentray.json` plus a managed `app/` payload
// (physical directory or directory link). Legacy `opentray.app.json`
// projects are outside the v1 registry: never listed, never mutated.

import { access, lstat, readdir, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { toProjectDirectoryName } from "./app-id";
import { CONFIG_FILENAME, parseCreateConfig, type CreateConfigV1 } from "./config";
import { err, ok, type CreateError, type Result } from "./errors";

export const REGISTRY_ROOT_SEGMENTS = [".opentray", "create"] as const;
export const APP_DIRNAME = "app";

/** Resolve the fixed registry root under a home directory (test seam). */
export const registryRoot = (homeDir: string = homedir()): string =>
  join(homeDir, ...REGISTRY_ROOT_SEGMENTS);

/** Encode an immutable appId into its stable registration key. */
export const registrationKey = (appId: string): string => toProjectDirectoryName(appId);

export interface RegistrationPaths {
  /** Fixed registry root. */
  readonly root: string;
  /** Encoded directory key. */
  readonly key: string;
  /** Physical registration directory. */
  readonly dir: string;
  readonly configPath: string;
  /** `<dir>/app` — managed directory or directory link/junction. */
  readonly appDir: string;
}

export const registrationPaths = (appId: string, homeDir?: string): RegistrationPaths => {
  const root = registryRoot(homeDir);
  const key = registrationKey(appId);
  const dir = join(root, key);
  return {
    root,
    key,
    dir,
    configPath: join(dir, CONFIG_FILENAME),
    appDir: join(dir, APP_DIRNAME),
  };
};

export type RegistrationStatus =
  | "healthy"
  | "invalid-config"
  | "incompatible-version"
  | "missing-payload"
  | "broken-link"
  | "running";

export interface RegistrationRecord {
  readonly key: string;
  readonly dir: string;
  readonly configPath: string;
  readonly appDir: string;
  readonly status: RegistrationStatus;
  /** Parsed v1 configuration when readable. */
  readonly config?: CreateConfigV1;
  /** Resolved payload path (link target or the physical app dir). */
  readonly payloadPath?: string;
  /** True when `app/` is a directory link/junction to an external target. */
  readonly isLink: boolean;
  readonly error?: CreateError;
}

export const readRegistrationRecord = async (
  key: string,
  dir: string,
): Promise<RegistrationRecord> => {  const configPath = join(dir, CONFIG_FILENAME);
  const appDir = join(dir, APP_DIRNAME);
  const base = { key, dir, configPath, appDir, isLink: false };

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    return {
      ...base,
      status: "invalid-config",
      error: {
        code: "registry_io",
        message: `cannot read ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ...base,
      status: "invalid-config",
      error: {
        code: "invalid_config",
        message: `${CONFIG_FILENAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  const config = parseCreateConfig(parsed);
  if (!config.ok) {
    return {
      ...base,
      status: config.error.code === "incompatible_version" ? "incompatible-version" : "invalid-config",
      error: config.error,
    };
  }

  // Payload classification: physical dir, valid link, broken link, or absent.
  let appStat: Awaited<ReturnType<typeof lstat>>;
  try {
    appStat = await lstat(appDir);
  } catch {
    return {
      ...base,
      status: "missing-payload",
      config: config.value,
      error: {
        code: "not_found",
        message: `managed payload directory is absent: ${appDir}`,
      },
    };
  }
  if (appStat.isSymbolicLink()) {
    let target: string;
    try {
      target = await readlink(appDir);
    } catch (error) {
      return {
        ...base,
        status: "broken-link",
        isLink: true,
        config: config.value,
        error: {
          code: "registry_io",
          message: `cannot read app link target: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
    // Resolve the target through the registration directory.
    const resolved = resolve(dir, target);
    try {
      const targetStat = await lstat(resolved);
      if (!targetStat.isDirectory()) {
        return {
          ...base,
          status: "broken-link",
          isLink: true,
          config: config.value,
          payloadPath: resolved,
          error: { code: "not_found", message: `app link target is not a directory: ${resolved}` },
        };
      }
    } catch {
      return {
        ...base,
        status: "broken-link",
        isLink: true,
        config: config.value,
        payloadPath: resolved,
        error: { code: "not_found", message: `app link target no longer exists: ${resolved}` },
      };
    }
    return { ...base, status: "healthy", config: config.value, isLink: true, payloadPath: resolved };
  }
  if (!appStat.isDirectory()) {
    return {
      ...base,
      status: "missing-payload",
      config: config.value,
      error: { code: "not_found", message: `app payload is not a directory: ${appDir}` },
    };
  }
  return { ...base, status: "healthy", config: config.value, payloadPath: appDir };
};

const hasV1Config = async (dir: string): Promise<boolean> => {
  try {
    await access(join(dir, CONFIG_FILENAME));
    return true;
  } catch {
    return false;
  }
};

/** Load one registration by encoded key; not_found when absent or legacy. */
export const loadRegistration = async (
  key: string,
  homeDir?: string,
): Promise<Result<RegistrationRecord>> => {
  const dir = join(registryRoot(homeDir), key);
  if (!(await hasV1Config(dir))) {
    return err("not_found", `no v1 registration at ${dir}`, { key });
  }
  return ok(await readRegistrationRecord(key, dir));
};

/**
 * Scan the fixed registry root. Only physical directories containing
 * `create-opentray.json` are v1 registrations; legacy marker-only
 * directories are neither listed nor mutated.
 */
export const listRegistrations = async (
  homeDir?: string,
): Promise<readonly RegistrationRecord[]> => {
  const root = registryRoot(homeDir);
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // absent registry root = empty registry, not an error
  }
  const records: RegistrationRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const dir = join(root, entry.name);
    if (!(await hasV1Config(dir))) {
      continue; // legacy or foreign directory: outside the v1 registry
    }
    records.push(await readRegistrationRecord(entry.name, dir));
  }
  records.sort((a, b) => a.key.localeCompare(b.key));
  return records;
};
