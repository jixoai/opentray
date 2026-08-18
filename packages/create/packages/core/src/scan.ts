// Create-root discovery scan (openspec change wizard-share-and-list-scan).
//
// The workbench application list needs BOTH layouts that live under the fixed
// create root `~/.opentray/create/`: v1 registrations (envelope directory
// with create-opentray.json, interpreted exclusively by registry.ts) and
// wizard projects (scaffold markers opentray.app.json + main.mjs directly in
// the keyed directory, no envelope). The scan is a read-only projection: it
// never creates, moves, adopts, or mutates anything on disk.

import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { detectPackageManager } from "./materialize";
import { CONFIG_FILENAME, type PackageManagerName } from "./config";
import { registryRoot, readRegistrationRecord, type RegistrationRecord } from "./registry";
import { SCAFFOLD_MARKER_FILES } from "./scaffold";

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
