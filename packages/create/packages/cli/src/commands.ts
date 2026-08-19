// Yargs command tree for create-opentray (openspec change
// add-create-opentray-cli).
//
// yargs owns parsing/validation/help for every command; no hand-written flag
// loop survives. `web` (and the bare root for compatibility) dispatch the
// WebUI adapter; `create` compiles explicit flags into Core v1 desired
// state fully non-interactively; `app …` project Core registry procedures;
// `skill …` expose the packaged English AI Skill read-only.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { CommandModule, Argv } from "yargs";

import {
  applyCreate,
  buildExportPlan,
  buildScriptExport,
  err,
  formatPosixCommandLine,
  listRegistrations,
  loadRegistration,
  ok,
  parseCreateConfig,
  planCreate,
  readResourceBytes,
  registrationKey,
  stopRunningApp,
  uninstallApp,
  type CreateConfigV1,
  type DesiredState,
  type IconBackgroundName,
  type PackageManagerName,
  type ResourceInput,
  type Result,
} from "@create-opentray/core";

import { compileDesiredConfig, type CreateFlagOptions } from "./options";
import { CliOutcome, emitOutcome, emitProgress, type CliStreams } from "./output";
import { listSkillFiles, readSkillFile, resolveSkillRoot, validateSkillPath } from "./skill";

export interface CliContext {
  readonly streams: CliStreams;
  readonly homeDir?: string;
  /** WebUI adapter entry supplied by the create-opentray package. */
  readonly runWeb?: (options: { readonly port?: number; readonly open: boolean }) => Promise<number>;
  /** Test seam: skip real install/launch in apply. */
  readonly skipInstall?: boolean;
  readonly dependencyRange?: string;
  readonly cwd?: string;
  /** Per-dispatch exit recorder; defaults to process.exitCode assignment. */
  readonly setExit?: (code: number) => void;
}

const exitSetter = (context: CliContext): ((code: number) => void) =>
  context.setExit ?? ((code: number) => {
    process.exitCode = code;
  });

/** Emit an outcome AND record its exit code on the dispatch tracker. */
const finish = <T>(
  context: CliContext,
  outcome: CliOutcome<T>,
  json: boolean,
  render?: (result: T) => string,
): void => {
  exitSetter(context)(emitOutcome(outcome, context.streams, json, render));
};

const iconSourceInput = (value: string | undefined): ResourceInput | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (/^https?:\/\//iu.test(value)) {
    return { kind: "http", url: value };
  }
  if (value.startsWith("data:")) {
    return { kind: "data", dataUrl: value };
  }
  return { kind: "file", path: value };
};

const asResourceResult = <T>(result: Result<T>): CliOutcome<T> =>
  result.ok
    ? { ok: true, result: result.value }
    : { ok: false, error: { code: result.error.code, message: result.error.message, ...(result.error.details === undefined ? {} : { details: result.error.details }) } };

const desiredFromConfig = (config: CreateConfigV1, context: CliContext, appIconFlag?: string, trayIconFlag?: string): DesiredState => {
  // Explicit flags win over the config's committed refs; omitted flags fall
  // back to the committed snapshot files (stable references, never re-fetch).
  const appIconSource =
    iconSourceInput(appIconFlag) ??
    (config.icons.appIcon === undefined
      ? undefined
      : { kind: "file", path: join(registrationDir(config, context), config.icons.appIcon.path) } as ResourceInput);
  const trayIconSource =
    iconSourceInput(trayIconFlag) ??
    (config.icons.trayIcon === undefined
      ? undefined
      : { kind: "file", path: join(registrationDir(config, context), config.icons.trayIcon.path) } as ResourceInput);
  return { config, appIconSource, trayIconSource };
};

const registrationDir = (config: CreateConfigV1, context: CliContext): string =>
  join(context.homeDir ?? homedir(), ".opentray", "create", registrationKey(config.appId));

const readDependencyRange = async (): Promise<string> => {
  // Generated apps must stay on the create-opentray release line, not this
  // private CLI package's own version (0.1.0 resolved ancient SDKs).
  for (const pkgUrl of [new URL("../../../package.json", import.meta.url), new URL("../package.json", import.meta.url)]) {
    try {
      const raw = JSON.parse(await readFile(pkgUrl, "utf8")) as { name?: string; version?: string };
      // Only trust the create-opentray manifest; the CLI manifest is private.
      if (raw.name === "create-opentray" && typeof raw.version === "string" && /^\d/u.test(raw.version)) {
        return `^${raw.version}`;
      }
    } catch {
      // try the next candidate
    }
  }
  return "latest";
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

interface CreateArgs {
  readonly config?: string;
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
  readonly force?: boolean;
  readonly stopRunning?: boolean;
  readonly skipInstall?: boolean;
  readonly dryRun?: boolean;
  readonly json?: boolean;
}

const runCreate = async (args: CreateArgs, context: CliContext): Promise<void> => {
  const cwd = context.cwd ?? process.cwd();
  const flags: CreateFlagOptions = {};
  const optional: readonly (keyof CreateFlagOptions)[] = [
    "appId", "appName", "exec", "arg", "cwd", "env", "pm", "appIcon", "trayIcon",
    "iconBackground", "iconScale", "imageSmoothing", "trayTemplate", "developerMode", "window",
  ];
  for (const key of optional) {
    const value = (args as Record<string, unknown>)[key];
    if (value !== undefined) {
      (flags as Record<string, unknown>)[key] = value;
    }
  }
  const compiled = await compileDesiredConfig(flags, args.config, cwd);
  if (!compiled.ok) {
    finish(context, { ok: false, error: { code: compiled.error.code, message: compiled.error.message } }, args.json === true);
    return;
  }

  const desired: DesiredState = {
    config: compiled.value,
    appIconSource: iconSourceInput(args.appIcon),
    trayIconSource: iconSourceInput(args.trayIcon),
  };
  const applyOptions = {
    desired,
    force: args.force === true,
    stopRunning: args.stopRunning === true,
    skipInstall: args.skipInstall === true || context.skipInstall === true,
    ...(context.homeDir === undefined ? {} : { homeDir: context.homeDir }),
    dependencyRange: context.dependencyRange ?? (await readDependencyRange()),
    log: (message: string) => emitProgress(message, context.streams, args.json === true),
  };

  if (args.dryRun === true) {
    const plan = await planCreate(applyOptions);
    finish(context, asResourceResult(plan), args.json === true, (value) =>
      [
        `plan for ${value.appId} (${value.registrationDir})`,
        ...value.effects.map((effect) => {
          switch (effect.type) {
            case "create-registration": return `  + registration ${effect.dir}`;
            case "commit-config": return `  ~ config ${effect.path}`;
            case "import-resource": return `  + resource ${effect.role} → ${effect.filename}`;
            case "replace-payload": return `  ~ payload ${effect.dir}`;
            case "link-payload": return `  + link ${effect.link} → ${effect.target}`;
            case "install-dependencies": return "  + install dependencies";
            case "stop-running": return `  ! stop running pid ${effect.pid}`;
            case "warning": return `  w ${effect.message}`;
          }
        }),
        ...value.warnings.map((warning) => `  w ${warning}`),
        value.blockedByRunningProcess !== undefined ? `  ! BLOCKED by running pid ${value.blockedByRunningProcess.pid}` : "",
        value.requiresEnvAcknowledgement ? "  ! env entries present: export requires acknowledgement" : "",
      ].filter(Boolean).join("\n"),
    );
    return;
  }

  const applied = await applyCreate(applyOptions);
  finish(context, asResourceResult(applied), args.json === true, (value) =>
    [
      `created ${value.registrationDir}`,
      `payload: ${value.payloadDir}${value.isLink ? " (linked)" : ""}`,
    ].join("\n"),
  );
};

const createCommand = (context: CliContext): CommandModule => ({
  command: "create",
  describe: "create a v1 application non-interactively (no browser, no prompts, no sniffing)",
  builder: (yargs: Argv) =>
    yargs
      .option("config", { type: "string", describe: "base v1 config document (explicit flags override named fields)" })
      .option("app-id", { type: "string", describe: "immutable reverse-dotted identity, e.g. app.example" })
      .option("app-name", { type: "string", describe: "display name" })
      .option("exec", { type: "string", describe: "command executable" })
      .option("arg", { type: "array", string: true, describe: "one exact argv element (repeatable)" })
      .option("cwd", { type: "string", describe: "command working directory (default: current)" })
      .option("env", { type: "array", string: true, describe: "environment entry KEY=VALUE (repeatable)" })
      .option("pm", { type: "string", choices: ["npm", "pnpm", "bun"], describe: "package manager" })
      .option("app-icon", { type: "string", describe: "app icon source: file path, http(s) URL, or data URL" })
      .option("tray-icon", { type: "string", describe: "tray icon source (default: follow app icon)" })
      .option("icon-background", { type: "string", choices: ["black", "white", "transparent"] })
      .option("icon-scale", { type: "number", describe: "foreground scale 0.5–0.95" })
      .option("image-smoothing", { type: "boolean", describe: "set false for pixel-art (nearest-neighbor); defaults to the config value or true" })
      .option("tray-template", { type: "boolean", describe: "treat the tray source as a darwin template" })
      .option("developer-mode", { type: "boolean", describe: "admit WebView DevTools in the generated app" })
      .option("window", { type: "string", describe: "window size <width>x<height> (default 1200x800)" })
      .option("force", { type: "boolean", default: false, describe: "replace a VERIFIED existing payload (never adopts user files)" })
      .option("stop-running", { type: "boolean", default: false, describe: "stop a verified running instance before apply" })
      .option("skip-install", { type: "boolean", default: false, describe: "write the project without installing dependencies" })
      .option("dry-run", { type: "boolean", default: false, describe: "print the Core plan without mutation" })
      .option("json", { type: "boolean", default: false, describe: "machine-readable typed result on stdout" })
      .check((argv: Record<string, unknown>) => {
        if (argv.config === undefined && argv["app-id"] === undefined) {
          throw new Error("--app-id is required unless --config supplies a complete document");
        }
        if (argv.config === undefined && argv["app-name"] === undefined) {
          throw new Error("--app-name is required unless --config supplies a complete document");
        }
        return true;
      }),
  handler: async (argv) => {
    await runCreate(argv as unknown as CreateArgs, context);
  },
});

// ---------------------------------------------------------------------------
// app list
// ---------------------------------------------------------------------------

const appListCommand = (context: CliContext): CommandModule => ({
  command: "list",
  describe: "list registered v1 applications with health status",
  builder: (yargs: Argv) => yargs.option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const records = await listRegistrations(context.homeDir);
    const outcome = { ok: true as const, result: records.map((record) => ({
      key: record.key,
      appId: record.config?.appId,
      appName: record.config?.appName,
      status: record.status,
      registrationDir: record.dir,
      payloadPath: record.payloadPath,
      isLink: record.isLink,
      ...(record.error === undefined ? {} : { error: { code: record.error.code, message: record.error.message } }),
    })) };
    finish(context, outcome, json, (records2) =>
      records2.length === 0
        ? "no registered applications"
        : records2
            .map((record) => `${record.status.padEnd(18)} ${record.appId ?? record.key}  ${record.payloadPath ?? ""}${record.isLink ? " (linked)" : ""}`)
            .join("\n"),
    );
  },
});

// ---------------------------------------------------------------------------
// app edit
// ---------------------------------------------------------------------------

interface EditArgs extends CreateArgs {
  readonly appIdPositional?: string;
  readonly restart?: boolean;
}

const appEditCommand = (context: CliContext): CommandModule => ({
  command: "edit <app-id>",
  describe: "apply config/flag patches to an existing registration (non-interactive)",
  builder: (yargs: Argv) =>
    yargs
      .positional("app-id", { type: "string", describe: "existing immutable appId", demandOption: true })
      .option("config", { type: "string" })
      .option("app-name", { type: "string" })
      .option("exec", { type: "string" })
      .option("arg", { type: "array", string: true })
      .option("cwd", { type: "string" })
      .option("env", { type: "array", string: true })
      .option("pm", { type: "string", choices: ["npm", "pnpm", "bun"] })
      .option("app-icon", { type: "string" })
      .option("tray-icon", { type: "string" })
      .option("icon-background", { type: "string", choices: ["black", "white", "transparent"] })
      .option("icon-scale", { type: "number" })
      .option("image-smoothing", { type: "boolean" })
      .option("tray-template", { type: "boolean" })
      .option("developer-mode", { type: "boolean" })
      .option("window", { type: "string" })
      .option("force", { type: "boolean", default: false })
      .option("stop-running", { type: "boolean", default: false })
      .option("restart", { type: "boolean", default: false, describe: "launch again after a stop-running edit" })
      .option("skip-install", { type: "boolean", default: false })
      .option("dry-run", { type: "boolean", default: false })
      .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const args = argv as unknown as EditArgs;
    const json = args.json === true;
    // yargs exposes the positional as "app-id" (hyphenated key).
    const targetId = (argv["app-id"] as string | undefined) ?? args.appIdPositional;
    if (targetId === undefined) {
      finish(context, { ok: false, error: { code: "invalid_config", message: "app edit requires an <app-id> positional" } }, json);
      return;
    }
    const existing = await loadRegistration(registrationKey(targetId), context.homeDir);
    if (!existing.ok) {
      finish(context, { ok: false, error: { code: existing.error.code, message: existing.error.message } }, json);
      return;
    }
    if (existing.value.config === undefined) {
      finish(context, { ok: false, error: { code: "invalid_config", message: `registration ${existing.value.key} has no readable v1 config (${existing.value.error?.message ?? "unknown"})` } }, json);
      return;
    }
    const base = existing.value.config;
    if (args.config !== undefined) {
      let configAppId: string | undefined;
      try {
        const raw = JSON.parse(await readFile(args.config, "utf8")) as { appId?: unknown };
        if (typeof raw.appId === "string") {
          configAppId = raw.appId;
        }
      } catch {
        // invalid JSON surfaces later through the compiler
      }
      if (configAppId !== undefined && configAppId !== base.appId) {
        // Identity is immutable: changing it is a copy, not an edit.
        finish(context, { ok: false, error: { code: "identity_mismatch", message: `appId is immutable: registration holds ${base.appId}; use "app copy --new-app-id ${configAppId}" to create the new identity` } }, json);
        return;
      }
    }
    // Compile patches over the committed document.
    const baseDoc = {
      schemaVersion: 1 as const,
      appId: base.appId,
      appName: base.appName,
      command: base.command,
      packageManager: base.packageManager,
      icons: base.icons,
      window: base.window,
      developerMode: base.developerMode,
    };
    // Write the base to a temp view through compileDesiredConfig by passing
    // it as inline overrides: reuse the compiler with explicit values.
    const patched = {
      appId: base.appId,
      appName: args.appName ?? base.appName,
      exec: args.exec ?? base.command.executable,
      arg: args.arg ?? base.command.args,
      cwd: args.cwd ?? base.command.cwd,
      env: args.env ?? Object.entries(base.command.env ?? {}).map(([k, v]) => `${k}=${v}`),
      pm: args.pm ?? base.packageManager,
      iconBackground: args.iconBackground ?? base.icons.background,
      iconScale: args.iconScale ?? base.icons.scale,
      imageSmoothing: args.imageSmoothing ?? base.icons.imageSmoothingEnabled,
      trayTemplate: args.trayTemplate ?? base.icons.trayTemplate ?? false,
      developerMode: args.developerMode ?? base.developerMode,
      window: args.window ?? `${base.window.width}x${base.window.height}`,
    };
    void baseDoc;
    const cwd = context.cwd ?? process.cwd();
    const compiled = await compileDesiredConfig(patched, undefined, cwd);
    if (!compiled.ok) {
      finish(context, { ok: false, error: { code: compiled.error.code, message: compiled.error.message } }, json);
      return;
    }
    const desired = desiredFromConfig(compiled.value, context, args.appIcon, args.trayIcon);
    const applyOptions = {
      desired,
      force: args.force === true,
      stopRunning: args.stopRunning === true,
      skipInstall: args.skipInstall === true || context.skipInstall === true,
      ...(context.homeDir === undefined ? {} : { homeDir: context.homeDir }),
      dependencyRange: context.dependencyRange ?? (await readDependencyRange()),
      log: (message: string) => emitProgress(message, context.streams, json),
    };
    if (args.dryRun === true) {
      const plan = await planCreate(applyOptions);
      finish(context, asResourceResult(plan), json);
      return;
    }
    const applied = await applyCreate(applyOptions);
    finish(context, asResourceResult(applied), json, (value) => `updated ${value.registrationDir}`);
    if (args.restart === true) {
      await stopRunningApp({ appId: base.appId, ...(context.homeDir === undefined ? {} : { homeDir: context.homeDir }) });
      const relaunched = await applyCreate({ ...applyOptions, stopRunning: false });
      finish(context, asResourceResult(relaunched), json, () => "");
    }
  },
});

// ---------------------------------------------------------------------------
// app copy
// ---------------------------------------------------------------------------

const appCopyCommand = (context: CliContext): CommandModule => ({
  command: "copy <app-id>",
  describe: "create a new registration from an existing one under a new identity",
  builder: (yargs: Argv) =>
    yargs
      .positional("app-id", { type: "string", demandOption: true })
      .option("new-app-id", { type: "string", demandOption: true, describe: "the new immutable appId" })
      .option("app-name", { type: "string", describe: "new display name (default: derived)" })
      .option("force", { type: "boolean", default: false })
      .option("skip-install", { type: "boolean", default: false })
      .option("dry-run", { type: "boolean", default: false })
      .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const sourceId = argv["app-id"] as string;
    const newAppId = argv["new-app-id"] as string;
    const existing = await loadRegistration(registrationKey(sourceId), context.homeDir);
    if (!existing.ok || existing.value.config === undefined) {
      finish(context, { ok: false, error: { code: existing.ok ? "invalid_config" : existing.error.code, message: existing.ok ? "registration unreadable" : existing.error.message } }, json);
      return;
    }
    const config = existing.value.config;
    const desiredConfig: CreateConfigV1 = {
      ...config,
      appId: newAppId,
      appName: (argv["app-name"] as string | undefined) ?? config.appName,
    };
    // Copy must read the SOURCE committed snapshots for the new registration.
    const sourceDir = existing.value.dir;
    const desired: DesiredState = {
      config: desiredConfig,
      appIconSource:
        config.icons.appIcon === undefined
          ? undefined
          : { kind: "file", path: join(sourceDir, config.icons.appIcon.path) },
      trayIconSource:
        config.icons.trayIcon === undefined
          ? undefined
          : { kind: "file", path: join(sourceDir, config.icons.trayIcon.path) },
    };
    const applyOptions = {
      desired,
      force: argv.force === true,
      skipInstall: (argv["skip-install"] as boolean) === true || context.skipInstall === true,
      ...(context.homeDir === undefined ? {} : { homeDir: context.homeDir }),
      dependencyRange: context.dependencyRange ?? (await readDependencyRange()),
      log: (message: string) => emitProgress(message, context.streams, json),
    };
    if ((argv["dry-run"] as boolean) === true) {
      const plan = await planCreate(applyOptions);
      finish(context, asResourceResult(plan), json);
      return;
    }
    const applied = await applyCreate(applyOptions);
    finish(context, asResourceResult(applied), json, (value) => `copied to ${value.registrationDir}`);
  },
});

// ---------------------------------------------------------------------------
// app export
// ---------------------------------------------------------------------------

const appExportCommand = (context: CliContext): CommandModule => ({
  command: "export <app-id>",
  describe: "export a complete create command or self-contained script",
  builder: (yargs: Argv) =>
    yargs
      .positional("app-id", { type: "string", demandOption: true })
      .option("format", { type: "string", choices: ["command", "sh", "ps1"], default: "command", describe: "direct command, POSIX shell script, or PowerShell script" })
      .option("output", { type: "string", alias: "o", describe: "write the script to a file instead of stdout" })
      .option("force-copy", { type: "boolean", default: false, describe: "explicitly allow long embedded data in the direct command" })
      .option("acknowledge-env", { type: "boolean", default: false, describe: "acknowledge that complete output includes environment values" })
      .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const appId = argv["app-id"] as string;
    const format = argv.format as "command" | "sh" | "ps1";
    const existing = await loadRegistration(registrationKey(appId), context.homeDir);
    if (!existing.ok || existing.value.config === undefined) {
      finish(context, { ok: false, error: { code: existing.ok ? "invalid_config" : existing.error.code, message: existing.ok ? "registration unreadable" : existing.error.message } }, json);
      return;
    }
    const config = existing.value.config;
    const envCount = Object.keys(config.command.env ?? {}).length;
    if (envCount > 0 && (argv["acknowledge-env"] as boolean) !== true) {
      finish(context, { ok: false, error: { code: "env_ack_required", message: `this application has ${envCount} environment entrie(s); complete export includes their values — pass --acknowledge-env after reviewing them` } }, json);
      return;
    }
    // Uploaded sources (file provenance) embed their committed bytes.
    const embedded = [];
    const regDir = existing.value.dir;
    for (const ref of [config.icons.appIcon, config.icons.trayIcon]) {
      if (ref === undefined) continue;
      if (ref.source.kind === "http") continue; // URLs stay URLs
      const bytes = await readResourceBytes(regDir, ref);
      if (!bytes.ok) continue;
      embedded.push({ flag: ref === config.icons.appIcon ? "app-icon" : "tray-icon", filename: ref.path.split("/").pop() ?? "icon.png", bytes: bytes.value });
    }
    if (format === "command") {
      const plan = buildExportPlan({ config, embeddedResources: embedded, forceCopy: (argv["force-copy"] as boolean) === true });
      if (!plan.ok) {
        finish(context, { ok: false, error: { code: plan.error.code, message: plan.error.message } }, json);
        return;
      }
      if (plan.value.directCommand === null) {
        finish(context, { ok: false, error: { code: "export_unsafe", message: plan.value.directCommandBlockedReason ?? "direct copy blocked" } }, json);
        return;
      }
      const command = plan.value.directCommand.command;
      finish(
        context,
        { ok: true, result: { command: formatPosixCommandLine(command) } },
        json,
        (value) => value.command,
      );
      return;
    }
    const script = buildScriptExport({ config, embeddedResources: embedded }, format === "sh" ? "sh" : "powershell");
    if (!script.ok) {
      finish(context, { ok: false, error: { code: script.error.code, message: script.error.message } }, json);
      return;
    }
    const outputPath = argv.output as string | undefined;
    if (outputPath !== undefined) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(resolve(context.cwd ?? process.cwd(), outputPath), script.value.content, "utf8");
      finish(context, { ok: true, result: { path: outputPath, bytes: script.value.content.length } }, json, (value) => `wrote ${value.path}`);
      return;
    }
    finish(context, { ok: true, result: { content: script.value.content } }, json, (value) => value.content.replace(/\n$/, ""));
  },
});

// ---------------------------------------------------------------------------
// app uninstall
// ---------------------------------------------------------------------------

const appUninstallCommand = (context: CliContext): CommandModule => ({
  command: "uninstall <app-id>",
  describe: "remove a registration; linked external targets are retained by default",
  builder: (yargs: Argv) =>
    yargs
      .positional("app-id", { type: "string", demandOption: true })
      .option("stop-running", { type: "boolean", default: false })
      .option("purge-target", { type: "boolean", default: false, describe: "ALSO delete a linked external target after revalidation" })
      .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const result = await uninstallApp({
      appId: argv["app-id"] as string,
      ...(context.homeDir === undefined ? {} : { homeDir: context.homeDir }),
      stopRunning: (argv["stop-running"] as boolean) === true,
      purgeTarget: (argv["purge-target"] as boolean) === true,
    });
    finish(context, asResourceResult(result), json, (value) =>
      [
        `removed registration: ${value.registrationPath}`,
        value.linkRemoved ? `removed link: ${value.payloadPath}` : `removed payload: ${value.payloadPath}`,
        value.targetDeleted ? `external target DELETED: ${value.payloadPath}` : value.linkRemoved ? `external target retained: ${value.payloadPath}` : "",
        value.manualPinCleanupHint,
      ].filter(Boolean).join("\n"),
    );
  },
});

const appCommand = (context: CliContext): CommandModule => ({
  command: "app",
  describe: "manage registered applications",
  builder: (yargs: Argv) =>
    yargs
      .command(appListCommand(context))
      .command(appEditCommand(context))
      .command(appCopyCommand(context))
      .command(appExportCommand(context))
      .command(appUninstallCommand(context))
      .demandCommand(1, "app requires a subcommand: list | edit | copy | export | uninstall"),
  handler: () => undefined,
});

// ---------------------------------------------------------------------------
// skill
// ---------------------------------------------------------------------------

const skillReadCommand = (context: CliContext): CommandModule => ({
  command: "read [path]",
  describe: "write one packaged skill file (default SKILL.md)",
  builder: (yargs: Argv) => yargs
    .positional("path", { type: "string", default: "SKILL.md" })
    .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const root = await resolveSkillRoot();
    if (!root.ok) {
      finish(context, { ok: false, error: { code: root.error.code, message: root.error.message } }, json);
      return;
    }
    const validated = validateSkillPath((argv.path as string | undefined) ?? "SKILL.md");
    if (!validated.ok) {
      finish(context, { ok: false, error: { code: validated.error.code, message: validated.error.message } }, json);
      return;
    }
    const content = await readSkillFile(root.value, validated.value);
    finish(context, asResourceResult(content), json, (value) => value.replace(/\n$/, ""));
  },
});

const skillListCommand = (context: CliContext): CommandModule => ({
  command: "list [path]",
  describe: "list logical relative files beneath the packaged skill root",
  builder: (yargs: Argv) => yargs
    .positional("path", { type: "string", default: "" })
    .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    const json = (argv.json as boolean) === true;
    const root = await resolveSkillRoot();
    if (!root.ok) {
      finish(context, { ok: false, error: { code: root.error.code, message: root.error.message } }, json);
      return;
    }
    const listed = await listSkillFiles(root.value, (argv.path as string | undefined) ?? "");
    finish(context, asResourceResult(listed), json, (entries) =>
      entries.map((entry) => `${entry.type === "directory" ? "d" : "-"} ${entry.path}`).join("\n"),
    );
  },
});

const skillCommand = (context: CliContext): CommandModule => ({
  command: "skill",
  describe: "read the packaged English AI Skill (help center)",
  builder: (yargs: Argv) =>
    yargs
      .command(skillListCommand(context))
      .command(skillReadCommand(context))
      .option("json", { type: "boolean", default: false }),
  handler: async (argv) => {
    // Bare `skill` reads SKILL.md.
    const json = (argv.json as boolean) === true;
    const root = await resolveSkillRoot();
    if (!root.ok) {
      finish(context, { ok: false, error: { code: root.error.code, message: root.error.message } }, json);
      return;
    }
    const content = await readSkillFile(root.value, "SKILL.md");
    finish(context, asResourceResult(content), json, (value) => value.replace(/\n$/, ""));
  },
});

// ---------------------------------------------------------------------------
// web + root
// ---------------------------------------------------------------------------

const webCommand = (context: CliContext): CommandModule => ({
  command: "web",
  describe: "start the WebUI wizard on loopback (default when no subcommand is given)",
  builder: (yargs: Argv) =>
    yargs
      .option("port", { type: "number", describe: "bind the wizard server to a specific loopback port" })
      // Idiomatic yargs negation: declaring `open` (default true) makes
      // --no-open its strict-mode-safe negation.
      .option("open", { type: "boolean", default: true, describe: "open the default browser (negate with --no-open)" })
      .option("json", { type: "boolean", default: false, hidden: true }),
  handler: async (argv) => {
    if (context.runWeb === undefined) {
      context.streams.err("web adapter unavailable in this build");
      exitSetter(context)(10);
      return;
    }
    const port = argv.port as number | undefined;
    const open = argv.open !== false; // --no-open negates to false
    exitSetter(context)(await context.runWeb({
      ...(port === undefined ? {} : { port }),
      open,
    }));
  },
});

export const buildRootCommands = (context: CliContext): CommandModule[] => [
  webCommand(context),
  createCommand(context),
  appCommand(context),
  skillCommand(context),
];

/** Parse-and-dispatch entry used by the published bin (non-exiting). */
export const dispatchCli = async (
  argv: readonly string[],
  context: CliContext,
): Promise<number> => {
  const yargs = (await import("yargs")).default as unknown as import("yargs").Argv;
  let exitCode = 0;
  const dispatchContext: CliContext = { ...context, setExit: (code) => { exitCode = code; } };
  if (argv.length === 0) {
    // Bare `create-opentray` keeps dispatching to the WebUI adapter.
    if (context.runWeb === undefined) {
      context.streams.err("web adapter unavailable in this build");
      return 10;
    }
    return dispatchContext.runWeb?.({ open: true }).then((code) => {
      exitCode = code;
      return code;
    }) ?? ((context.streams.err("web adapter unavailable in this build"), 10));
  }
  const parser = yargs(argv.slice(0))
    .scriptName("create-opentray")
    .usage("create-opentray — turn a start command into an OpenTray-hosted desktop app")
    .strict()
    .exitProcess(false)
    .help()
    .command(buildRootCommands(dispatchContext) as never);
  try {
    // parseAsync awaits async command handlers; help/usage text is written
    // by yargs itself. Parse failures surface here as thrown errors.
    await parser.parseAsync(argv.slice(0));
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes("--json")) {
      dispatchContext.streams.out(JSON.stringify({ ok: false, error: { code: "invalid_config", message } }));
    } else {
      dispatchContext.streams.err(message);
    }
    return 2;
  }
};
