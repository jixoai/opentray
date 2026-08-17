// Orthogonal intents (maintained 2026-07-22; original user request: after the
// frozen dialog confirms generation, run a pending pipeline with live logs and
// end in a success state that can open the app):
// 1. Guard the target directory before writing anything.
// 2. Generate the strict AppIcon catalog through the sanctioned vite-plugin generator.
// 3. Install, first-launch with an absolute runtime vector, and gate on the
//    generated entry's ready marker plus the stable Darwin bundle.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  resolveDefaultDarwinAppBundlePath,
  sanitizeAppBundleName,
} from "@opentray/packaging";
import { generateOpenTrayAppIcon } from "@opentray/vite-plugin";

import { tcpProbe } from "./port-scan";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Prebuilt shell UI: prefer the packaged copy (dist/shell), else the
 *  workspace build next to this package. */
const resolveShellAssetsDir = async (): Promise<string | undefined> => {
  const candidates = [
    join(moduleDirectory, "shell"),
    // Source checkout: moduleDirectory is packages/create/src → ../dist/shell.
    join(moduleDirectory, "..", "dist", "shell"),
    // tsdown chunk layout: moduleDirectory is packages/create/dist → ./shell
    // (covered above) — plus a direct workspace fallback.
    join(moduleDirectory, "..", "create-webui", "dist"),
  ];
  for (const candidate of candidates) {
    if (await access(join(candidate, "index.html")).then(() => true, () => false)) {
      return candidate;
    }
  }
  return undefined;
};
const shellAssetsDir = await resolveShellAssetsDir();
import { composeAppIcon } from "./icon-compose";
import type { IconBackground } from "./icon-compose";
import { writeGlyphIconTemp } from "./scrape";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
import { toProjectDirectoryName } from "./app-id";
import { writeScaffold, type ScaffoldAppConfig, type ScaffoldResult } from "./scaffold";

export type MaterializeLogEvent =
  | { readonly type: "step"; readonly step: string; readonly message: string }
  | { readonly type: "log"; readonly message: string };

export interface MaterializeInput {
  readonly config: ScaffoldAppConfig;
  readonly targetDir: string;
  readonly dependencyRange: string;
  readonly iconSourcePath: string | undefined;
  /** Icon composition (owner round-12): background + foreground scale. */
  readonly iconBackground?: IconBackground;
  readonly iconScale?: number;
  /** Tray icon source; defaults to the app icon source when omitted. */
  readonly trayIconSourcePath?: string;
  /** Generated-app shell options (startup terminal / address bar). */
  readonly shell?: { showTerminal: boolean; showAddressBar: boolean };
  readonly packageManager: "npm" | "pnpm" | "bun";
  readonly skipInstall: boolean;
  readonly force: boolean;
}

export interface MaterializeResult {
  readonly scaffold: ScaffoldResult;
  readonly projectDir: string;
  readonly bundlePath: string | undefined;
  readonly firstLaunch: { readonly pid: number };
}

export interface MaterializeContext {
  readonly log: (event: MaterializeLogEvent) => void;
  readonly generateIcon?: typeof generateOpenTrayAppIcon;
  readonly runInstall?: (options: RunInstallOptions) => Promise<void>;
  readonly firstLaunchEntry?: (projectDir: string) => Promise<FirstLaunchHandle> | FirstLaunchHandle;
  readonly platform?: NodeJS.Platform;
  readonly waitMs?: (ms: number) => Promise<void>;
  readonly bundleTimeoutMs?: number;
}

export interface RunInstallOptions {
  readonly projectDir: string;
  readonly packageManager: "npm" | "pnpm" | "bun";
  readonly log: (message: string) => void;
}

export interface FirstLaunchHandle {
  readonly pid: number;
  /** Resolves when the entry prints its ready marker; rejects on early exit. */
  readonly ready: Promise<void>;
}

export const READY_MARKER_PREFIX = "opentray: ready";

/** True when the directory exists and contains anything beyond ignorable files. */
export const isDirectoryOccupied = async (dir: string): Promise<boolean> => {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }
  const ignorable = new Set([".DS_Store", "Thumbs.db"]);
  return entries.some((entry) => !ignorable.has(entry));
};

/** Detect package manager from lockfiles then npm_config_user_agent. */
export const detectPackageManager = (
  files: readonly string[],
  userAgent: string | undefined,
): "npm" | "pnpm" | "bun" => {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("package-lock.json")) return "npm";
  const agent = (userAgent ?? "").toLowerCase();
  if (agent.includes("pnpm")) return "pnpm";
  if (agent.includes("bun")) return "bun";
  return "npm";
};

/** Expected stable Darwin bundle path for the generated project's identity. */
export const expectedDarwinBundlePath = (config: {
  appName: string;
  appId: string;
}): string =>
  resolveDefaultDarwinAppBundlePath({
    homeDir: homedir(),
    packageName: toProjectDirectoryName(config.appId),
    appName: sanitizeAppBundleName(config.appName),
  });

export const materialize = async (
  input: MaterializeInput,
  context: MaterializeContext,
): Promise<MaterializeResult> => {
  const step = (name: string, message: string): void =>
    context.log({ type: "step", step: name, message });
  const waitMs =
    context.waitMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const targetDir = resolve(input.targetDir);
  step("scaffold", `checking target directory ${targetDir}`);
  if (await isDirectoryOccupied(targetDir)) {
    if (input.force !== true) {
      throw new Error(
        `target directory is not empty: ${targetDir} (pass --force or choose another directory)`,
      );
    }
    // Force is a TRUE overwrite: the generated project is fully wizard-owned
    // and regenerable, so clear the stale tree instead of layering over it.
    step("scaffold", "force: clearing existing target directory");
    await rm(targetDir, { recursive: true, force: true });
  }

  // Tray icon FIRST (owner law: the tray defaults to the app icon): the PNG
  // is written into the target's app-icon dir (created here) so the value is
  // part of the config the entry template renders with — main.mjs previously
  // baked a stale null because the config was amended only AFTER scaffolding.
  const appIconDir = join(targetDir, "app-icon");
  await mkdir(appIconDir, { recursive: true });
  const traySource = input.trayIconSourcePath ?? input.iconSourcePath;
  let trayIconConfig: { path: string; template: boolean } | undefined;
  if (traySource !== undefined) {
    const trayPath = join(appIconDir, "tray-icon.png");
    try {
      const sharpModule = await import("sharp");
      await sharpModule.default(traySource, { failOn: "none" })
        .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(trayPath);
      // Solid-silhouette sources are single-color art: darwin templates let
      // macOS tint them for light/dark menu bars.
      const template = traySource.includes("-solid-");
      trayIconConfig = { path: "app-icon/tray-icon.png", template };
      context.log({
        type: "log",
        message: `tray icon: app-icon/tray-icon.png${template ? " (template)" : ""}`,
      });
    } catch (error) {
      context.log({
        type: "log",
        message: `tray icon unavailable (${errorMessage(error)}); falling back to text tray`,
      });
    }
  }

  // Owner round-12: compose the app icon (foreground over the chosen
  // background) BEFORE the catalog so ICNS encodes from the best-practice
  // 824-in-1024 variant while Windows/Linux use the full 1024 composite.
  let composedIcon:
    | { compositePath: string; macOSPath: string; background: IconBackground }
    | undefined;
  if (input.iconSourcePath !== undefined) {
    try {
      composedIcon = await composeAppIcon({
        foregroundPath: input.iconSourcePath,
        background: input.iconBackground ?? "transparent",
        scale: input.iconScale ?? 0.8,
        outputDir: join(targetDir, "app-icon"),
      });
      context.log({
        type: "log",
        message: `composed app icon (${composedIcon.background} background, macOS 824 / windows 1024)`,
      });
    } catch (error) {
      context.log({
        type: "log",
        message: `icon composition unavailable (${errorMessage(error)}); using source directly`,
      });
    }
  }

  step("scaffold", "writing project files");
  const shell = input.shell;
  const scaffold = await writeScaffold({
    config: {
      ...input.config,
      ...(shell === undefined ? {} : { shell }),
      ...(trayIconConfig === undefined ? {} : { trayIcon: trayIconConfig }),
    },
    targetDir,
    dependencyRange: input.dependencyRange,
    skipInstall: input.skipInstall,
    ...(shellAssetsDir === undefined ? {} : { shellAssetsDir }),
  });
  context.log({ type: "log", message: `wrote ${scaffold.writtenFiles.join(", ")}` });

  step("icon", "generating platform icon catalog");
  const iconSource =
    input.iconSourcePath ??
    (await writeGlyphIconTemp(input.config.appName, scaffold.appIconDir));
  const generate = context.generateIcon ?? generateOpenTrayAppIcon;
  const generateIntoScaffold = async (sourcePath: string) =>
    generate({
      sourcePath,
      // Composed art carries its own background + squircle mask: pass
      // through instead of glyph re-tiling, and give macOS its 824 variant.
      ...(composedIcon === undefined
        ? {}
        : {
            composed: true,
            macosSourcePath: composedIcon.macOSPath,
          }),
      icnsOutputPath: join(scaffold.appIconDir, "app-icon.icns"),
      icoOutputPath: join(scaffold.appIconDir, "app-icon.ico"),
      linuxOutputDirectory: join(scaffold.appIconDir, "linux"),
      manifestOutputPath: join(scaffold.appIconDir, "app-icon.json"),
      outputPath: join(scaffold.appIconDir, "app-icon.png"),
      cachePath: join(scaffold.appIconDir, ".cache.json"),
    });

  const catalogSource =
    composedIcon !== undefined && composedIcon.compositePath !== undefined
      ? composedIcon.compositePath
      : input.iconSourcePath;
  let iconMetadata;
  try {
    iconMetadata = await generateIntoScaffold(
      catalogSource !== undefined ? catalogSource : iconSource,
    );
  } catch (error) {
    if (catalogSource === undefined || catalogSource === input.iconSourcePath) {
      // A user/scraped icon that cannot be decoded must never fail the whole
      // materialization: fall back to the first-letter glyph.
      context.log({
        type: "log",
        message: `icon source unusable (${errorMessage(error)}); falling back to glyph icon`,
      });
      iconMetadata = await generateIntoScaffold(
        await writeGlyphIconTemp(input.config.appName, scaffold.appIconDir),
      );
    } else {
      throw error;
    }
  }
  context.log({
    type: "log",
    message: `icon assets: icns + ico + ${iconMetadata.linuxPngOutputPaths.length} linux pngs`,
  });

  step("icon", "writing tray icon asset");
  if (!input.skipInstall) {
    step("install", `installing dependencies with ${input.packageManager}`);
    const runInstall = context.runInstall ?? runPackageManagerInstall;
    await runInstall({
      projectDir: scaffold.projectDir,
      packageManager: input.packageManager,
      log: (message) => context.log({ type: "log", message }),
    });
  } else {
    step("install", "skipping dependency install (--skip-install)");
  }

  step("launch", "first launch of the generated app");
  const launch = context.firstLaunchEntry ?? firstLaunchEntry;
  const launched = await launch(scaffold.projectDir);
  context.log({ type: "log", message: `app entry spawned (pid ${launched.pid})` });

  step("launch", "waiting for app ready marker");
  await launched.ready;
  context.log({ type: "log", message: `${READY_MARKER_PREFIX} received` });

  const platform = context.platform ?? process.platform;
  let bundlePath: string | undefined;
  if (platform === "darwin") {
    step("bundle", "verifying stable Darwin app bundle");
    const expected = expectedDarwinBundlePath(input.config);
    bundlePath = await waitForDirectory(
      expected,
      context.bundleTimeoutMs ?? 60_000,
      waitMs,
    );
    context.log({ type: "log", message: `stable bundle: ${bundlePath}` });
  }

  return { scaffold, projectDir: scaffold.projectDir, bundlePath, firstLaunch: launched };
};

export const runPackageManagerInstall = async (options: RunInstallOptions): Promise<void> => {
  const commands: Record<"npm" | "pnpm" | "bun", { cmd: string; args: readonly string[] }> = {
    npm: { cmd: "npm", args: ["install", "--no-fund", "--no-audit"] },
    pnpm: { cmd: "pnpm", args: ["install"] },
    bun: { cmd: "bun", args: ["install"] },
  };
  const { cmd, args } = commands[options.packageManager];
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, [...args], {
      cwd: options.projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n").filter(Boolean)) {
        options.log(line);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n").filter(Boolean)) {
        options.log(line);
      }
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? "signal"}`));
    });
  });
};

/**
 * Spawn the generated entry detached with piped stdout, resolving when the
 * entry prints its ready marker. The child is unref'd so the wizard can exit
 * without taking the generated app down.
 */
/**
 * The generated app may embed a native PTY (@lydell/node-pty), which requires
 * a Node host (Bun loads it but never delivers output). Always launch the
 * generated entry with Node: prefer the Node currently executing the wizard,
 * else resolve `node` from PATH.
 */
const nodeExecutable = (): string =>
  process.versions.bun === undefined && process.execPath.includes("node")
    ? process.execPath
    : "node";

export const firstLaunchEntry = async (projectDir: string): Promise<FirstLaunchHandle> => {
  const child: ChildProcess = spawn(nodeExecutable(), [join(projectDir, "main.mjs")], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
    windowsHide: true,
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`failed to spawn generated app entry in ${projectDir}`);
  }
  child.unref();

  let buffer = "";
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    const finish = (error: Error | undefined): void => {
      child.stdout?.removeListener("data", onData);
      if (error !== undefined) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    };
    const onData = (chunk: string): void => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(READY_MARKER_PREFIX)) {
        finish(undefined);
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", onData);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      finish(new Error(`generated app entry exited early with ${code ?? "signal"}`));
    });
  });

  return { pid, ready };
};

const waitForDirectory = async (
  path: string,
  timeoutMs: number,
  waitMs: (ms: number) => Promise<void>,
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        return path;
      }
    } catch {
      // Not materialized yet.
    }
    await waitMs(500);
  }
  throw new Error(`stable Darwin app bundle did not appear within ${timeoutMs}ms: ${path}`);
};

/** TCP readiness helper reused by tests for the supervised service port. */
export const waitForServicePort = async (
  port: number,
  timeoutMs: number,
  probe: (port: number) => Promise<boolean> = (value) => tcpProbe("127.0.0.1", value),
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};
