// Deterministic Plan/Apply lifecycle kernel (openspec change
// unify-create-opentray-core).
//
// Plan performs every non-mutating check needed to describe the ordered
// effect set; Apply consumes a validated plan (or revalidates equivalent
// preconditions) before mutation. CLI and WebUI therefore cannot implement
// divergent creation semantics. Force requires VERIFIED create-opentray
// ownership — it can never adopt or clear an unknown non-empty directory.

import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  CONFIG_FILENAME,
  parseCreateConfig,
  serializeCreateConfig,
  type CreateConfigV1,
  type IconResourceRef,
} from "./config";
import { err, ok, type Result } from "./errors";
import {
  materializePayload,
  type MaterializeContext,
  type MaterializeInput,
  type MaterializeResult,
} from "./materialize";
import { createDirectoryLink } from "./links";
import {
  loadRegistration,
  readRegistrationRecord,
  registrationKey,
  registrationPaths,
  type RegistrationRecord,
} from "./registry";
import { importResource, readResourceBytes, type ResourceInput } from "./resources";
import {
  clearRuntimeRecord,
  inspectProcess,
  killProcessTree,
  readRuntimeRecord,
} from "./runtime-record";

export interface DesiredIconInput {
  readonly source: ResourceInput | undefined;
}

/** Structural equality for resource inputs (reference identity is not stable). */
const isSameResourceInput = (a: ResourceInput | undefined, b: ResourceInput | undefined): boolean => {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "file" && b.kind === "file") {
    return a.path === b.path;
  }
  if (a.kind === "http" && b.kind === "http") {
    return a.url === b.url;
  }
  if (a.kind === "data" && b.kind === "data") {
    return a.dataUrl === b.dataUrl;
  }
  if (a.kind === "bytes" && b.kind === "bytes") {
    return a.bytes === b.bytes && a.name === b.name;
  }
  return false;
};

export interface DesiredState {
  readonly config: CreateConfigV1;
  /** App icon source input; undefined → glyph fallback. */
  readonly appIconSource: ResourceInput | undefined;
  /** Tray icon source input; undefined follows the app icon. */
  readonly trayIconSource: ResourceInput | undefined;
}

export type PlanEffect =
  | { readonly type: "create-registration"; readonly dir: string }
  | { readonly type: "commit-config"; readonly path: string }
  | { readonly type: "import-resource"; readonly role: "appIcon" | "trayIcon"; readonly filename: string }
  | { readonly type: "replace-payload"; readonly dir: string; readonly retainedPaths: readonly string[] }
  | { readonly type: "link-payload"; readonly link: string; readonly target: string }
  | { readonly type: "install-dependencies" }
  | { readonly type: "stop-running"; readonly pid: number }
  | { readonly type: "warning"; readonly message: string };

export interface LifecyclePlan {
  readonly effects: readonly PlanEffect[];
  readonly warnings: readonly string[];
  /** Registration paths the plan touches. */
  readonly registrationDir: string;
  readonly appId: string;
  /** True when an existing verified payload will be replaced. */
  readonly replacesExisting: boolean;
  /** Non-empty env overlay → adapters must collect acknowledgement. */
  readonly requiresEnvAcknowledgement: boolean;
  /** True when a verified running process blocks apply without stop-running. */
  readonly blockedByRunningProcess: { readonly pid: number } | undefined;
}

export interface PlanOptions {
  readonly desired: DesiredState;
  /** Apply-time controls; never persisted. */
  readonly force?: boolean;
  readonly stopRunning?: boolean;
  readonly skipInstall?: boolean;
  /** External payload target: `app/` becomes a directory link. */
  readonly externalPayloadDir?: string;
  readonly homeDir?: string;
}

const listFiles = async (dir: string): Promise<readonly string[]> => {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
};

const isDirectoryOccupied = async (dir: string): Promise<boolean> => {
  const entries = await listFiles(dir);
  const ignorable = new Set([".DS_Store", "Thumbs.db"]);
  return entries.some((entry) => !ignorable.has(entry));
};

/** Verified create-opentray ownership: v1 config + immutable identity match. */
const verifyOwnership = async (
  dir: string,
  expectedAppId: string,
  homeDir: string | undefined,
): Promise<{ verified: boolean; record?: RegistrationRecord; reason?: string }> => {
  const record = await readRegistrationRecord(registrationKey(expectedAppId), dir);
  if (record.config === undefined) {
    return { verified: false, record, reason: record.error?.message ?? "no readable v1 configuration" };
  }
  if (record.config.appId !== expectedAppId) {
    return { verified: false, record, reason: `identity mismatch: registration holds ${record.config.appId}, plan targets ${expectedAppId}` };
  }
  return { verified: true, record };
};

/** Plan the effects for a desired state. Pure read; performs no mutation. */
export const planCreate = async (options: PlanOptions): Promise<Result<LifecyclePlan>> => {
  const { desired } = options;
  const home = options.homeDir ?? homedir();
  const paths = registrationPaths(desired.config.appId, home);
  const effects: PlanEffect[] = [];
  const warnings: string[] = [];

  // Existing registration?
  const exists = await lstat(paths.dir).then(
    (info) => info.isDirectory(),
    () => false,
  );
  let replacesExisting = false;
  if (exists) {
    const occupied = await isDirectoryOccupied(paths.dir);
    const ownership = await verifyOwnership(paths.dir, desired.config.appId, home);
    if (!ownership.verified) {
      if (!options.force) {
        return err(
          "ownership_unverified",
          `target registration ${paths.dir} exists but is not a verified create-opentray v1 registration (${ownership.reason ?? "unknown"})`,
          { dir: paths.dir },
        );
      }
      // Force may only replace VERIFIED ownership; an unknown non-empty
      // directory can never be adopted or cleared.
      if (occupied) {
        return err(
          "ownership_unverified",
          `force cannot adopt a non-empty directory without a matching v1 registration: ${paths.dir}`,
          { dir: paths.dir },
        );
      }
      warnings.push(`existing directory ${paths.dir} is not a v1 registration but is empty; claiming it`);
    } else if (ownership.record!.status === "broken-link" || ownership.record!.status === "missing-payload") {
      warnings.push(`existing registration payload is unhealthy (${ownership.record!.status}); regenerating`);
      replacesExisting = true;
    } else {
      replacesExisting = true;
    }
  }

  // Identity immutability: an edit cannot migrate appId (checked above via
  // verifyOwnership mismatch), and healthy registrations carry the same key.

  // Running-process conservation.
  let blockedByRunningProcess: { readonly pid: number } | undefined;
  const runtime = await readRuntimeRecord(paths.dir);
  if (runtime !== undefined) {
    const state = await inspectProcess(runtime.pid, runtime.startedAt);
    if (state === "live" || state === "unverified") {
      if (options.stopRunning !== true) {
        blockedByRunningProcess = { pid: runtime.pid };
      } else {
        effects.push({ type: "stop-running", pid: runtime.pid });
      }
    } else if (state === "reused") {
      warnings.push(
        `recorded pid ${runtime.pid} was reused by an unrelated process; the stale record will be cleared, nothing will be terminated`,
      );
    }
  }

  // Resource imports.
  if (desired.appIconSource !== undefined) {
    effects.push({ type: "import-resource", role: "appIcon", filename: "app-icon" });
  }
  if (
    desired.trayIconSource !== undefined &&
    !isSameResourceInput(desired.trayIconSource, desired.appIconSource)
  ) {
    effects.push({ type: "import-resource", role: "trayIcon", filename: "tray-icon" });
  }
  effects.push({ type: "commit-config", path: paths.configPath });

  // Payload: external link or managed regeneration.
  if (options.externalPayloadDir !== undefined) {
    const target = resolve(options.externalPayloadDir);
    const targetStat = await lstat(target).then(
      (info) => info,
      () => null,
    );
    if (targetStat === null || !targetStat.isDirectory()) {
      return err("not_found", `external payload target is not a directory: ${target}`, { target });
    }
    effects.push({ type: "link-payload", link: paths.appDir, target });
  } else {
    // Retained registration resources survive payload replacement.
    const retained = [
      CONFIG_FILENAME,
      ...((desired.appIconSource !== undefined ? ["app-icon"] : []) as string[]),
      ...((desired.trayIconSource !== undefined &&
      !isSameResourceInput(desired.trayIconSource, desired.appIconSource)
        ? ["tray-icon"]
        : []) as string[]),
      "runtime.json",
    ];
    const existingEntries = await listFiles(paths.appDir);
    const retainedPaths = existingEntries.filter((entry) => !retained.includes(entry));
    if (retainedPaths.length > 0) {
      effects.push({ type: "replace-payload", dir: paths.appDir, retainedPaths });
    }
  }

  if (!exists) {
    effects.unshift({ type: "create-registration", dir: paths.dir });
  }
  if (options.skipInstall !== true) {
    effects.push({ type: "install-dependencies" });
  }

  const envCount = Object.keys(desired.config.command.env ?? {}).length;
  return ok({
    effects,
    warnings,
    registrationDir: paths.dir,
    appId: desired.config.appId,
    replacesExisting,
    requiresEnvAcknowledgement: envCount > 0,
    blockedByRunningProcess,
  });
};

export interface ApplyOptions extends PlanOptions {
  readonly log?: (message: string) => void;
  readonly materializeContext?: Partial<MaterializeContext>;
  /** Range written into the generated app's package.json. */
  readonly dependencyRange: string;
  /** Adapter-owned prebuilt shell UI assets (copied into app-shell/). */
  readonly shellAssetsDir?: string;
  /** opentray package-manager helper reused by adapters. */
  readonly detectPackageManager?: (files: readonly string[], userAgent: string | undefined) => "npm" | "pnpm" | "bun";
}

export interface ApplyResult {
  readonly registrationDir: string;
  readonly payloadDir: string;
  readonly isLink: boolean;
  readonly materialize: MaterializeResult | undefined;
  readonly warnings: readonly string[];
  /** Env values are never echoed here. */
}

const buildMaterializeInput = (
  desired: DesiredState,
  options: ApplyOptions,
  config: CreateConfigV1,
  iconPaths: { appIcon?: string; trayIcon?: string },
): MaterializeInput => ({
  config: {
    schemaVersion: 1,
    appId: config.appId,
    appName: config.appName,
    // Scaffold config persists the launch vector projection of the exact
    // command config (executable/args/cwd/env share the same names).
    command: {
      command: config.command.executable,
      args: config.command.args,
      cwd: config.command.cwd,
      ...(config.command.env === undefined ? {} : { env: config.command.env }),
    },
    service: { port: 0 },
    window: config.window,
    ...(config.developerMode === true ? { developerMode: true } : {}),
  },
  targetDir: registrationPaths(config.appId, options.homeDir).appDir,
  dependencyRange: options.dependencyRange,
  iconSourcePath: iconPaths.appIcon,
  ...(iconPaths.trayIcon === undefined ? {} : { trayIconSourcePath: iconPaths.trayIcon }),
  ...(config.icons.trayTemplate === true ? { trayIconIsSolid: true } : {}),
  iconBackground: config.icons.background,
  iconScale: config.icons.scale,
  ...(config.icons.imageSmoothingEnabled === false ? { imageSmoothingEnabled: false } : {}),
  packageManager: config.packageManager,
  skipInstall: options.skipInstall === true,
  force: true, // ownership was verified during plan
});

/**
 * Apply a desired state. Revalidates the plan's preconditions immediately
 * before mutation, so a stale plan cannot clear a directory whose ownership
 * changed between plan and apply.
 */
export const applyCreate = async (options: ApplyOptions): Promise<Result<ApplyResult>> => {
  const plan = await planCreate(options);
  if (!plan.ok) {
    return plan;
  }
  if (plan.value.blockedByRunningProcess !== undefined) {
    return err(
      "app_running",
      `application is running (pid ${plan.value.blockedByRunningProcess.pid}); stop it or authorize stop-running`,
      { pid: plan.value.blockedByRunningProcess.pid },
    );
  }
  const log = options.log ?? ((): void => undefined);
  const home = options.homeDir ?? homedir();
  const paths = registrationPaths(options.desired.config.appId, home);

  // ---- Phase 1: registration envelope (physical, never linked). ----
  await mkdir(paths.dir, { recursive: true });

  // Stop the verified running process when authorized.
  for (const effect of plan.value.effects) {
    if (effect.type === "stop-running") {
      log(`stopping verified running application (pid ${effect.pid})`);
      const killed = await killProcessTree(effect.pid);
      if (!killed.ok) {
        return killed;
      }
      await clearRuntimeRecord(paths.dir);
    }
  }

  // ---- Phase 2: resource snapshots (transactional, hash-verified). ----
  const iconPaths: { appIcon?: string; trayIcon?: string } = {};
  let appIconRef: IconResourceRef | undefined;
  let trayIconRef: IconResourceRef | undefined;
  if (options.desired.appIconSource !== undefined) {
    const imported = await importResource(options.desired.appIconSource, {
      registrationDir: paths.dir,
      filename: "app-icon",
    });
    if (!imported.ok) {
      return imported;
    }
    appIconRef = imported.value.ref;
    iconPaths.appIcon = join(paths.dir, imported.value.ref.path);
    log(`app icon snapshot: ${imported.value.ref.path}${imported.value.reused ? " (reused)" : ""}`);
  }
  if (options.desired.trayIconSource !== undefined) {
    if (
      isSameResourceInput(options.desired.trayIconSource, options.desired.appIconSource) &&
      appIconRef !== undefined
    ) {
      trayIconRef = appIconRef; // explicit follow: no second mutable copy
      iconPaths.trayIcon = join(paths.dir, appIconRef.path);
    } else {
      const imported = await importResource(options.desired.trayIconSource, {
        registrationDir: paths.dir,
        filename: "tray-icon",
      });
      if (!imported.ok) {
        return imported;
      }
      trayIconRef = imported.value.ref;
      iconPaths.trayIcon = join(paths.dir, imported.value.ref.path);
    }
  }

  // ---- Phase 3: commit the v1 authority LAST-in-envelope (payload may
  // still fail; a committed config without payload is recoverable state). ----
  const finalConfig: CreateConfigV1 = {
    ...options.desired.config,
    icons: {
      ...options.desired.config.icons,
      ...(appIconRef === undefined ? {} : { appIcon: appIconRef }),
      ...(trayIconRef === undefined ? {} : { trayIcon: trayIconRef }),
    },
  };
  const configTemp = `${paths.configPath}.tmp`;
  await writeFile(configTemp, serializeCreateConfig(finalConfig), "utf8");
  await rename(configTemp, paths.configPath);

  // ---- Phase 4: payload — external link or managed regeneration. ----
  let isLink = false;
  let materializeResult: MaterializeResult | undefined;
  if (options.externalPayloadDir !== undefined) {
    const target = resolve(options.externalPayloadDir);
    const linked = await createDirectoryLink(paths.appDir, target);
    if (!linked.ok) {
      return linked;
    }
    isLink = true;
    log(`payload linked to external target: ${target}`);
  } else {
    // Managed regeneration into a sibling staging directory, then an atomic
    // swap: a failed apply leaves the prior payload usable.
    const stagingDir = join(dirname(paths.appDir), `${paths.key}.staging`);
    await rm(stagingDir, { recursive: true, force: true });
    const input = buildMaterializeInput(options.desired, options, finalConfig, iconPaths);
    const context: MaterializeContext = {
      log: (event) => log(event.message),
      ...(options.shellAssetsDir === undefined ? {} : {}),
      ...(options.materializeContext ?? {}),
    };
    const payload = await materializePayload(
      { ...input, targetDir: stagingDir, ...(options.shellAssetsDir === undefined ? {} : { shellAssetsDir: options.shellAssetsDir }) },
      context,
    );
    // Swap: old → .old, staging → app, remove .old.
    const oldDir = `${paths.appDir}.old`;
    await rm(oldDir, { recursive: true, force: true });
    let hadOld = false;
    try {
      await lstat(paths.appDir);
      hadOld = true;
      await rename(paths.appDir, oldDir);
    } catch {
      // no existing payload
    }
    try {
      await rename(stagingDir, paths.appDir);
    } catch (error) {
      if (hadOld) {
        await rename(oldDir, paths.appDir); // roll back to the prior payload
      }
      return err(
        "registry_io",
        `failed to install the generated payload: ${error instanceof Error ? error.message : String(error)}`,
        { dir: paths.appDir },
      );
    }
    await rm(oldDir, { recursive: true, force: true });
    log(`payload regenerated at ${paths.appDir}`);
    // Install already ran inside the staging payload; generation is complete.
    // The command's first real run belongs to the user's first open
    // (decision D1 — no first-launch validation during apply).
    materializeResult = { scaffold: payload.scaffold, projectDir: paths.appDir };
  }

  return ok({
    registrationDir: paths.dir,
    payloadDir: isLink ? resolve(options.externalPayloadDir!) : paths.appDir,
    isLink,
    materialize: materializeResult,
    warnings: plan.value.warnings,
  });
};

export interface StopOptions {
  readonly appId: string;
  readonly homeDir?: string;
}

/** Stop a verified running application; never kills by name or appId alone. */
export const stopRunningApp = async (
  options: StopOptions,
): Promise<Result<{ readonly stopped: boolean; readonly pid?: number }>> => {
  const paths = registrationPaths(options.appId, options.homeDir);
  const record = await readRuntimeRecord(paths.dir);
  if (record === undefined) {
    return ok({ stopped: false });
  }
  const state = await inspectProcess(record.pid, record.startedAt);
  if (state === "dead") {
    await clearRuntimeRecord(paths.dir);
    return ok({ stopped: false });
  }
  if (state === "reused" || state === "unverified") {
    return err(
      "pid_reused",
      `refusing to terminate pid ${record.pid}: live identity could not be verified (${state})`,
      { pid: record.pid, state },
    );
  }
  const killed = await killProcessTree(record.pid);
  if (!killed.ok) {
    return killed;
  }
  await clearRuntimeRecord(paths.dir);
  return ok({ stopped: true, pid: record.pid });
};

export interface UninstallOptions {
  readonly appId: string;
  readonly homeDir?: string;
  /** Explicitly authorize stopping a verified running app first. */
  readonly stopRunning?: boolean;
  /** Explicitly authorize deleting an EXTERNAL link target. */
  readonly purgeTarget?: boolean;
}

export interface UninstallResult {
  readonly registrationPath: string;
  readonly payloadPath: string;
  readonly linkRemoved: boolean;
  readonly targetRetained: boolean;
  /** True when the external target was deleted under purge-target. */
  readonly targetDeleted: boolean;
  readonly manualPinCleanupHint: string;
}

/**
 * Uninstall distinguishes registration removal from target purge: a linked
 * external payload is unlinked and RETAINED unless purge-target explicitly
 * authorizes deletion after a second identity validation.
 */
export const uninstallApp = async (options: UninstallOptions): Promise<Result<UninstallResult>> => {
  const home = options.homeDir ?? homedir();
  const key = registrationKey(options.appId);
  const loaded = await loadRegistration(key, home);
  if (!loaded.ok) {
    return loaded;
  }
  const record = loaded.value;
  const manualPinCleanupHint =
    "macOS Dock pins and Windows taskbar pins are user-managed; remove them manually if present.";

  // Running-process conservation.
  const runtime = await readRuntimeRecord(record.dir);
  if (runtime !== undefined) {
    const state = await inspectProcess(runtime.pid, runtime.startedAt);
    if (state === "live" || state === "unverified") {
      if (options.stopRunning !== true) {
        return err(
          "app_running",
          `application is running (pid ${runtime.pid}); stop it or authorize stop-running`,
          { pid: runtime.pid },
        );
      }
      if (state === "live") {
        const killed = await killProcessTree(runtime.pid);
        if (!killed.ok) {
          return killed;
        }
      }
      await clearRuntimeRecord(record.dir);
    }
  }

  let linkRemoved = false;
  let targetRetained = true;
  let targetDeleted = false;
  const payloadPath = record.payloadPath ?? record.appDir;

  if (record.isLink && record.payloadPath !== undefined) {
    if (options.purgeTarget === true) {
      // Second identity validation immediately BEFORE any deletion.
      const recheck = await readRegistrationRecord(record.key, record.dir);
      if (recheck.payloadPath !== record.payloadPath || !recheck.isLink) {
        return err(
          "ownership_unverified",
          `external target changed during uninstall; refusing to purge ${record.payloadPath}`,
        );
      }
      await rm(record.payloadPath, { recursive: true, force: true });
      targetRetained = false;
      targetDeleted = true;
    }
    // Linked payload: unlink only; the external target survives by default.
    await rm(record.appDir, { force: true });
    linkRemoved = true;
  }

  // Remove the registration envelope (config, snapshots, runtime record).
  await rm(record.dir, { recursive: true, force: true });

  return ok({
    registrationPath: record.dir,
    payloadPath,
    linkRemoved,
    targetRetained,
    targetDeleted,
    manualPinCleanupHint,
  });
};
