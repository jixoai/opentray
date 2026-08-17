// Flag → Core v1 desired-state compilation (openspec change
// add-create-opentray-cli).
//
// A valid config document supplies the base desired state; explicit field
// options override ONLY their named fields. Destructive/process controls
// stay operation inputs and are never written into v1 config.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CONFIG_SCHEMA_VERSION,
  parseCreateConfig,
  type CreateConfigV1,
  type IconBackgroundName,
  type PackageManagerName,
  type Result,
} from "@create-opentray/core";
import { err, ok } from "@create-opentray/core";

export interface CreateFlagOptions {
  readonly appId?: string;
  readonly appName?: string;
  readonly exec?: string;
  readonly arg?: readonly string[];
  readonly cwd?: string;
  readonly env?: readonly string[];
  readonly pm?: PackageManagerName;
  readonly appIcon?: string;
  readonly trayIcon?: string;
  readonly iconBackground?: IconBackgroundName;
  readonly iconScale?: number;
  readonly imageSmoothing?: boolean;
  readonly trayTemplate?: boolean;
  readonly developerMode?: boolean;
  readonly window?: string;
}

const PACKAGE_MANAGERS: readonly PackageManagerName[] = ["npm", "pnpm", "bun"];
const BACKGROUNDS: readonly IconBackgroundName[] = ["black", "white", "transparent"];

export const parseEnvEntry = (
  entry: string,
): { ok: true; key: string; value: string } | { ok: false; message: string } => {
  const eq = entry.indexOf("=");
  if (eq <= 0) {
    return { ok: false, message: `--env expects KEY=VALUE, got: ${entry}` };
  }
  const key = entry.slice(0, eq);
  if (key.trim().length === 0) {
    return { ok: false, message: `--env key must be non-empty: ${entry}` };
  }
  return { ok: true, key, value: entry.slice(eq + 1) };
};

export const parseWindowSpec = (
  spec: string,
): { ok: true; width: number; height: number } | { ok: false; message: string } => {
  const match = /^(\d{2,5})x(\d{2,5})$/u.exec(spec.trim());
  if (match === null) {
    return { ok: false, message: `--window expects <width>x<height>, got: ${spec}` };
  }
  const width = Number.parseInt(match[1]!, 10);
  const height = Number.parseInt(match[2]!, 10);
  if (width <= 0 || height <= 0) {
    return { ok: false, message: `--window dimensions must be positive: ${spec}` };
  }
  return { ok: true, width, height };
};

/** Compile flags over an optional base config document. */
export const compileDesiredConfig = async (
  options: CreateFlagOptions,
  configPath: string | undefined,
  baseCwd: string,
): Promise<Result<CreateConfigV1>> => {
  let base: CreateConfigV1 | undefined;
  if (configPath !== undefined) {
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch (error) {
      return err("invalid_config", `cannot read config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return err("invalid_config", `config ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = parseCreateConfig(parsed);
    if (!result.ok) {
      return err(result.error.code, `${configPath}: ${result.error.message}`, result.error.details);
    }
    base = result.value;
  }

  const appId = options.appId ?? base?.appId;
  const appName = options.appName ?? base?.appName;
  if (appId === undefined) {
    return err("invalid_config", "--app-id is required (or supply a complete --config document)");
  }
  if (appName === undefined) {
    return err("invalid_config", "--app-name is required (or supply a complete --config document)");
  }

  const executable = options.exec ?? base?.command.executable;
  if (executable === undefined || executable.length === 0) {
    return err("invalid_config", "--exec <executable> is required (or supply a complete --config document)");
  }
  const args =
    options.arg !== undefined
      ? [...options.arg]
      : base?.command.args ?? [];
  const cwd =
    options.cwd !== undefined
      ? resolve(baseCwd, options.cwd)
      : base?.command.cwd ?? baseCwd;

  const env: Record<string, string> = { ...(base?.command.env ?? {}) };
  for (const entry of options.env ?? []) {
    const parsed = parseEnvEntry(entry);
    if (!parsed.ok) {
      return err("invalid_config", parsed.message);
    }
    env[parsed.key] = parsed.value;
  }

  const pm = options.pm ?? base?.packageManager ?? "npm";
  if (!PACKAGE_MANAGERS.includes(pm)) {
    return err("invalid_config", `--pm must be one of ${PACKAGE_MANAGERS.join(", ")}, got: ${pm}`);
  }

  const iconBackground = options.iconBackground ?? base?.icons.background ?? "transparent";
  if (!BACKGROUNDS.includes(iconBackground)) {
    return err("invalid_config", `--icon-background must be one of ${BACKGROUNDS.join(", ")}, got: ${iconBackground}`);
  }
  const iconScale = options.iconScale ?? base?.icons.scale ?? 0.8;
  if (typeof iconScale !== "number" || iconScale < 0.5 || iconScale > 0.95) {
    return err("invalid_config", `--icon-scale must be between 0.5 and 0.95, got: ${String(iconScale)}`);
  }
  const imageSmoothing = options.imageSmoothing ?? base?.icons.imageSmoothingEnabled ?? true;
  const trayTemplate = options.trayTemplate ?? base?.icons.trayTemplate ?? false;
  const developerMode = options.developerMode ?? base?.developerMode ?? false;

  let window = base?.window ?? { width: 1_200, height: 800 };
  if (options.window !== undefined) {
    const parsed = parseWindowSpec(options.window);
    if (!parsed.ok) {
      return err("invalid_config", parsed.message);
    }
    window = { width: parsed.width, height: parsed.height };
  }

  // Assembled documents pass through the SAME strict v1 parser as config
  // files: flag input can never bypass validation.
  return parseCreateConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    appId,
    appName,
    command: {
      executable,
      args,
      cwd,
      ...(Object.keys(env).length === 0 ? {} : { env }),
    },
    packageManager: pm,
    icons: {
      imageSmoothingEnabled: imageSmoothing,
      background: iconBackground,
      scale: iconScale,
      ...(trayTemplate ? { trayTemplate: true } : {}),
      // Resource refs are resolved by Core apply (icon sources below).
    },
    window,
    developerMode,
  });
};
