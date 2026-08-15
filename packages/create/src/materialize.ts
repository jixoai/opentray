// Orthogonal intents (maintained 2026-07-22; original user request: after the
// frozen dialog confirms generation, run a pending pipeline with live logs and
// end in a success state that can open the app):
// 1. Guard the target directory before writing anything.
// 2. Generate the strict AppIcon catalog through the sanctioned vite-plugin generator.
// 3. Install, first-launch with an absolute runtime vector, and gate on the
//    generated entry's ready marker plus the stable Darwin bundle.

import { spawn, type ChildProcess } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  resolveDefaultDarwinAppBundlePath,
  sanitizeAppBundleName,
} from "@opentray/packaging";
import { generateOpenTrayAppIcon } from "@opentray/vite-plugin";

import { tcpProbe } from "./port-scan";
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
  if (input.force !== true && (await isDirectoryOccupied(targetDir))) {
    throw new Error(
      `target directory is not empty: ${targetDir} (pass --force or choose another directory)`,
    );
  }

  step("scaffold", "writing project files");
  const scaffold = await writeScaffold({
    config: input.config,
    targetDir,
    dependencyRange: input.dependencyRange,
    skipInstall: input.skipInstall,
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
      icnsOutputPath: join(scaffold.appIconDir, "app-icon.icns"),
      icoOutputPath: join(scaffold.appIconDir, "app-icon.ico"),
      linuxOutputDirectory: join(scaffold.appIconDir, "linux"),
      manifestOutputPath: join(scaffold.appIconDir, "app-icon.json"),
      outputPath: join(scaffold.appIconDir, "app-icon.png"),
      cachePath: join(scaffold.appIconDir, ".cache.json"),
    });
  let iconMetadata;
  try {
    iconMetadata = await generateIntoScaffold(iconSource);
  } catch (error) {
    if (iconSource === input.iconSourcePath) {
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
export const firstLaunchEntry = async (projectDir: string): Promise<FirstLaunchHandle> => {
  const child: ChildProcess = spawn(process.execPath, [join(projectDir, "main.mjs")], {
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
