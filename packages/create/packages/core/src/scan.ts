// Create-root discovery scan + wizard-project uninstall (openspec change
// wizard-share-and-list-scan).
//
// The workbench application list needs BOTH layouts that live under the fixed
// create root `~/.opentray/create/`: v1 registrations (envelope directory
// with create-opentray.json, interpreted exclusively by registry.ts) and
// wizard projects (scaffold markers opentray.app.json + main.mjs directly in
// the keyed directory, no envelope). Discovery itself is a read-only
// projection. Uninstall (user requirement #11, 2026-08-19 revision D6) is
// the one deliberate writer: it deletes a VERIFIED wizard project after
// ownership checks and authorized process teardown — the registry's older
// "legacy never mutated" stance yields to this explicit contract.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { detectPackageManager } from "./materialize";
import { CONFIG_FILENAME, type PackageManagerName } from "./config";
import { registryRoot, readRegistrationRecord, type RegistrationRecord } from "./registry";
import { killProcessTree } from "./runtime-record";
import { SCAFFOLD_MARKER_FILES } from "./scaffold";
import {
  resolveDefaultDarwinAppBundlePath,
  sanitizeAppBundleName,
} from "@opentray/packaging";
import { toProjectDirectoryName } from "./app-id";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/** Edit/export-ready projection of a wizard project's frozen opentray.app.json. */
export interface WizardProjectConfig {
  readonly appId: string;
  readonly appName: string;
  readonly command: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
  };
  readonly window: { readonly width: number; readonly height: number };
  readonly developerMode: boolean;
  /** Inferred from the project's lockfile (scaffold package.json records pm nowhere). */
  readonly packageManager: PackageManagerName;
  /** Informational preview-port hint from the frozen wizard state. */
  readonly servicePort: number;
  /** Stable in-project icon asset used as the share/export icon source. */
  readonly iconSourcePath: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read one wizard project's opentray.app.json into the projection the edit
 * and share flows consume. Undefined when the file is absent or not a
 * recognizable wizard config (the caller decides how to surface that).
 */
export const readWizardProjectConfig = async (
  projectDir: string,
): Promise<WizardProjectConfig | undefined> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(projectDir, "opentray.app.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || typeof raw.appId !== "string" || typeof raw.appName !== "string") {
    return undefined;
  }
  const command = isRecord(raw.command)
    ? raw.command
    : undefined;
  const executable = typeof command?.command === "string" ? command.command : "";
  const args = Array.isArray(command?.args) && command.args.every((a) => typeof a === "string")
    ? (command.args as readonly string[])
    : [];
  const cwd = typeof command?.cwd === "string" ? command.cwd : projectDir;
  const env = isRecord(command?.env)
    ? Object.fromEntries(
        Object.entries(command.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;
  const window = isRecord(raw.window)
    ? {
        width: Number.isFinite(raw.window.width) ? Number(raw.window.width) : 1_200,
        height: Number.isFinite(raw.window.height) ? Number(raw.window.height) : 800,
      }
    : { width: 1_200, height: 800 };
  const service = isRecord(raw.service) && Number.isFinite(raw.service.port)
    ? Number(raw.service.port)
    : 0;
  const files = await readdir(projectDir).catch(() => [] as string[]);
  const iconSourcePath = join(projectDir, "app-icon", "app-icon.png");
  return {
    appId: raw.appId,
    appName: raw.appName,
    command: { executable, args, cwd, ...(env === undefined ? {} : { env }) },
    window,
    developerMode: raw.developerMode === true,
    packageManager: detectPackageManager(files, undefined),
    servicePort: service,
    iconSourcePath: (await exists(iconSourcePath)) ? iconSourcePath : undefined,
  };
};

export interface WizardProjectIcon {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** Absolute provenance path (replaced by the script's embedded temp file). */
  readonly path: string;
}

/** Read the wizard project's stable icon asset for share/export embedding. */
export const readWizardProjectIcon = async (
  projectDir: string,
): Promise<WizardProjectIcon | undefined> => {
  const config = await readWizardProjectConfig(projectDir);
  if (config?.iconSourcePath === undefined) return undefined;
  try {
    const bytes = new Uint8Array(await readFile(config.iconSourcePath));
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      path: config.iconSourcePath,
    };
  } catch {
    return undefined;
  }
};

/** One discovered entry under the create root. */
export type CreateRootEntry =
  | {
      readonly source: "registered";
      readonly key: string;
      readonly record: RegistrationRecord;
    }
  | {
      readonly source: "wizard";
      readonly key: string;
      readonly dir: string;
      readonly config: WizardProjectConfig | undefined;
    };

const hasScaffoldMarkers = async (dir: string): Promise<boolean> => {
  for (const marker of SCAFFOLD_MARKER_FILES) {
    if (!(await exists(join(dir, marker)))) {
      return false;
    }
  }
  return true;
};

/**
 * Scan the fixed create root and project BOTH layouts (decision D2 in
 * openspec/changes/wizard-share-and-list-scan/plans/plan.md). Envelope
 * directories stay owned by registry.ts; wizard marker directories project
 * read-only; everything else stays invisible.
 */
export const listCreateEntries = async (
  homeDir?: string,
): Promise<readonly CreateRootEntry[]> => {
  const root = registryRoot(homeDir);
  let dirents: readonly import("node:fs").Dirent[];
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    return []; // absent root = empty list, not an error
  }
  const entries: CreateRootEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
      continue;
    }
    const dir = join(root, dirent.name);
    if (await exists(join(dir, CONFIG_FILENAME))) {
      entries.push({
        source: "registered",
        key: dirent.name,
        record: await readRegistrationRecord(dirent.name, dir),
      });
      continue;
    }
    if (await hasScaffoldMarkers(dir)) {
      entries.push({
        source: "wizard",
        key: dirent.name,
        dir,
        config: await readWizardProjectConfig(dir),
      });
    }
    // Neither shape: foreign directory, outside both projections.
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
};

/** Resolve one entry by its directory key (workbench endpoints are key-addressed). */
export const findCreateEntry = async (
  key: string,
  homeDir?: string,
): Promise<CreateRootEntry | undefined> => {
  const root = registryRoot(homeDir);
  const dir = join(root, key);
  if (await exists(join(dir, CONFIG_FILENAME))) {
    return { source: "registered", key, record: await readRegistrationRecord(key, dir) };
  }
  if (await hasScaffoldMarkers(dir)) {
    return { source: "wizard", key, dir, config: await readWizardProjectConfig(dir) };
  }
  return undefined;
};

// ─── Wizard-project uninstall (requirement #11 revision D6) ────────────────

export interface WizardUninstallOptions {
  /** Encoded directory key under the create root. */
  readonly key: string;
  readonly homeDir?: string;
  /** Explicitly authorize stopping a verified running entry. */
  readonly stopRunning?: boolean;
  readonly platform?: NodeJS.Platform;
  /** Test seams: pid discovery and tree kill. */
  readonly findPids?: (projectDir: string) => Promise<readonly number[]>;
  readonly killTree?: (pid: number) => Promise<unknown>;
}

export interface WizardUninstallResult {
  readonly projectPath: string;
  readonly projectRemoved: boolean;
  /** OpenTray-home Darwin bundle removed for this identity (darwin only). */
  readonly bundlePath?: string;
  readonly bundleRemoved: boolean;
  readonly stoppedPids: readonly number[];
  readonly manualPinCleanupHint: string;
}

/**
 * Live entry pids for one wizard project: the entry is `node <projectDir>/
 * main.mjs` (absolute vector persisted by open-app/appLaunch), so argv
 * matching against the absolute script path is exact identity — never a
 * name-based guess. POSIX only; win32 reports none (host UIs surface the
 * limitation instead of guessing).
 */
const defaultFindProjectEntryPids = async (projectDir: string): Promise<readonly number[]> => {
  if (process.platform === "win32") return [];
  return await new Promise((resolve) => {
    execFile("pgrep", ["-f", `${projectDir}/main.mjs`], (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split("\n")
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((pid) => Number.isInteger(pid) && pid > 0),
      );
    });
  });
};

/**
 * Uninstall one wizard project. Ownership is proven by the scaffold markers
 * (anything else under the key refuses removal); a running entry blocks with
 * a typed failure unless stopping is authorized, in which case each matched
 * pid is torn down as a whole tree before the directories are removed.
 */
export const uninstallWizardProject = async (
  options: WizardUninstallOptions,
): Promise<
  | { readonly ok: true; readonly value: WizardUninstallResult }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly pids?: readonly number[] } }
> => {
  const entry = await findCreateEntry(options.key, options.homeDir);
  if (entry === undefined || entry.source !== "wizard") {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `no wizard project at key ${options.key} (refusing to remove a non-wizard directory)`,
      },
    };
  }
  const findPids = options.findPids ?? defaultFindProjectEntryPids;
  const killTree = options.killTree ?? ((pid: number) => killProcessTree(pid));
  const pids = [...(await findPids(entry.dir))];
  if (pids.length > 0 && options.stopRunning !== true) {
    return {
      ok: false,
      error: {
        code: "app_running",
        message: `application is running (pid ${pids.join(", ")}); stop it or authorize stop-running`,
        pids,
      },
    };
  }
  for (const pid of pids) {
    await killTree(pid);
  }

  await rm(entry.dir, { recursive: true, force: true });

  // The OpenTray-home Darwin bundle is derived state of this identity;
  // remove it when present (non-darwin hosts have no bundle).
  let bundlePath: string | undefined;
  let bundleRemoved = false;
  const platform = options.platform ?? process.platform;
  if (platform === "darwin" && entry.config !== undefined) {
    const expected = resolveDefaultDarwinAppBundlePath({
      homeDir: options.homeDir ?? homedir(),
      packageName: toProjectDirectoryName(entry.config.appId),
      appName: sanitizeAppBundleName(entry.config.appName),
    });
    if (await exists(expected)) {
      await rm(expected, { recursive: true, force: true });
      bundlePath = expected;
      bundleRemoved = true;
    }
  }

  return {
    ok: true,
    value: {
      projectPath: entry.dir,
      projectRemoved: true,
      ...(bundlePath === undefined ? {} : { bundlePath }),
      bundleRemoved,
      stoppedPids: pids,
      manualPinCleanupHint:
        "macOS Dock pins and Windows taskbar pins are user-managed; remove them manually if present.",
    },
  };
};
