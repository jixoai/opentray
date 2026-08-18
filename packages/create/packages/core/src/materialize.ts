// Orthogonal intents (maintained 2026-08-19; original user requests: after the
// frozen dialog confirms generation, run a pending pipeline with live logs and
// end in a success state that can open the app; 2026-08-19 the wizard panel's
// own command preview already validates commands, so generation must NOT
// re-run the command — decision D1 in
// openspec/changes/create-no-first-launch-force-terminal/plans/plan.md):
// 1. Guard the target directory before writing anything.
// 2. Generate the strict AppIcon catalog through the sanctioned vite-plugin generator.
// 3. Install dependencies. Install completion IS generation success; the
//    command's first real run happens when the user opens the app.

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  resolveDefaultDarwinAppBundlePath,
  sanitizeAppBundleName,
} from "@opentray/packaging";
import { generateOpenTrayAppIcon } from "@opentray/vite-plugin";

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
  /** True when the tray source is a solid silhouette (darwin template). */
  readonly trayIconIsSolid?: boolean;
  /** Icon composition (owner round-12): background + foreground scale. */
  readonly iconBackground?: IconBackground;
  readonly iconScale?: number;
  /** Nearest-neighbor sampling for pixel-art sources (v1 imageSmoothingEnabled). */
  readonly imageSmoothingEnabled?: boolean;
  /** Tray icon source; defaults to the app icon source when omitted. */
  readonly trayIconSourcePath?: string;
  /** Generated-app shell options (startup terminal / address bar). */
  readonly shell?: { showTerminal: boolean; showAddressBar: boolean };
  /** Adapter-owned prebuilt shell UI directory (copied to app-shell/). */
  readonly shellAssetsDir?: string;
  readonly packageManager: "npm" | "pnpm" | "bun";
  readonly skipInstall: boolean;
  readonly force: boolean;
}

export interface MaterializeResult {
  readonly scaffold: ScaffoldResult;
  readonly projectDir: string;
}

export interface MaterializeContext {
  readonly log: (event: MaterializeLogEvent) => void;
  readonly generateIcon?: typeof generateOpenTrayAppIcon;
  readonly runInstall?: (options: RunInstallOptions) => Promise<void>;
}

export interface RunInstallOptions {
  readonly projectDir: string;
  readonly packageManager: "npm" | "pnpm" | "bun";
  readonly log: (message: string) => void;
}

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

export interface PayloadPhaseResult {
  readonly scaffold: ScaffoldResult;
  readonly projectDir: string;
}

/**
 * Payload phase: guard → tray icon → composed app icon → scaffold → icon
 * catalog → dependency install. This is the WHOLE pipeline: install completion
 * is generation success. Core apply swaps the payload into place
 * transactionally; the command's first real run belongs to the user's first
 * open of the generated app.
 */
export const materializePayload = async (
  input: MaterializeInput,
  context: MaterializeContext,
): Promise<PayloadPhaseResult> => {
  const step = (name: string, message: string): void =>
    context.log({ type: "step", step: name, message });

  const targetDir = resolve(input.targetDir);
  const smoothing = input.imageSmoothingEnabled !== false; // v1 default: true
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
        .resize(128, 128, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          // v1 imageSmoothingEnabled=false keeps pixel-art edges discrete on
          // the tray projection too, not just the app-icon foreground.
          ...(smoothing ? {} : { kernel: sharpModule.default.kernel.nearest }),
        })
        .png()
        .toFile(trayPath);
      // Solid-silhouette sources are single-color art: darwin templates let
      // macOS tint them for light/dark menu bars.
      const template = input.trayIconIsSolid === true;
      trayIconConfig = { path: "app-icon/tray-icon.png", template };
      context.log({
        type: "log",
        message: `tray icon: app-icon/tray-icon.png${template ? " (template)" : ""}${smoothing ? "" : " (nearest-neighbor)"}`,
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
        imageSmoothingEnabled: smoothing,
        outputDir: join(targetDir, "app-icon"),
      });
      context.log({
        type: "log",
        message: `composed app icon (${composedIcon.background} background, macOS 824 / windows 1024${smoothing ? "" : ", nearest-neighbor"})`,
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
    ...(input.shellAssetsDir === undefined ? {} : { shellAssetsDir: input.shellAssetsDir }),
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
    // BOTH routes degrade to the glyph: an undecodable raw source AND an
    // encoder-side failure of a composed source must never fail the whole
    // materialization (the review flagged the asymmetric rethrow).
    context.log({
      type: "log",
      message: `icon source unusable (${errorMessage(error)}); falling back to glyph icon`,
    });
    iconMetadata = await generateIntoScaffold(
      await writeGlyphIconTemp(input.config.appName, scaffold.appIconDir),
    );
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

  return { scaffold, projectDir: scaffold.projectDir };
};

/**
 * Backward-compatible composition used by the wizard adapter: generation is
 * the payload phase. There is no first-launch validation — the wizard panel's
 * command preview is the validator (decision D1).
 */
export const materialize = async (
  input: MaterializeInput,
  context: MaterializeContext,
): Promise<MaterializeResult> => materializePayload(input, context);

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
