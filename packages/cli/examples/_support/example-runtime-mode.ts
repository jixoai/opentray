import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ExampleRuntimeMode = "debug" | "release";

const runtimeModeFlags = new Set(["-r", "--release", "--debug"]);

export function resolveExampleRuntimeMode(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ExampleRuntimeMode {
  const envMode = normalizeRuntimeMode(env.OPENTRAY_EXAMPLE_RUNTIME_MODE);
  let mode = envMode ?? "debug";
  for (const arg of args) {
    if (arg === "-r" || arg === "--release") {
      mode = "release";
    } else if (arg === "--debug") {
      mode = "debug";
    }
  }
  return mode;
}

export function stripExampleRuntimeModeArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !runtimeModeFlags.has(arg));
}

export async function prepareExampleBrokerBinary(
  importMetaUrl: string,
  mode: ExampleRuntimeMode = resolveExampleRuntimeMode(),
): Promise<string | undefined> {
  const workspaceRoot = resolveSourceWorkspaceRoot(importMetaUrl);
  if (workspaceRoot === undefined) {
    return undefined;
  }
  await runSourceTreeCargoBuild(workspaceRoot, ["opentray-bin"], mode);
  const binary = sourceTreeArtifactPath(workspaceRoot, mode, localRuntimeArtifactName());
  await access(binary, constants.X_OK);
  if (process.env.OPENTRAY_BROKER_BIN === undefined) {
    process.env.OPENTRAY_BROKER_BIN = binary;
  }
  return binary;
}

export async function runSourceTreeCargoBuild(
  workspaceRoot: string,
  cargoPackages: readonly string[],
  mode: ExampleRuntimeMode,
): Promise<void> {
  const targetDir = sourceTreeTargetDir(workspaceRoot);
  const args = [
    "build",
    ...(mode === "release" ? ["--release"] : []),
    ...cargoPackages.flatMap((pkg) => ["-p", pkg]),
    ...(process.platform === "win32" ? ["--target-dir", targetDir] : []),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("cargo", args, {
      cwd: workspaceRoot,
      stdio:
        process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ||
        process.env.OPENTRAY_BROKER_BUILD_LOGS === "1"
          ? "inherit"
          : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo ${args.join(" ")} failed with code ${code ?? "unknown"}`));
    });
  });
}

export function resolveSourceWorkspaceRoot(moduleUrl: string): string | undefined {
  let currentDir = dirname(fileURLToPath(moduleUrl));
  while (true) {
    if (
      fileExists(join(currentDir, "Cargo.toml")) &&
      fileExists(join(currentDir, "crates/opentray-bin/Cargo.toml"))
    ) {
      return currentDir;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) {
      return undefined;
    }
    currentDir = parent;
  }
}

export function sourceTreeArtifactPath(
  workspaceRoot: string,
  mode: ExampleRuntimeMode,
  artifactName: string,
): string {
  return join(sourceTreeTargetDir(workspaceRoot), mode, artifactName);
}

function sourceTreeTargetDir(workspaceRoot: string): string {
  return process.platform === "win32"
    ? join(workspaceRoot, "target", "opentray-source", `example-${process.pid}`)
    : join(workspaceRoot, "target");
}

export function localRuntimeArtifactName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "opentray.exe" : "opentray";
}

function normalizeRuntimeMode(value: string | undefined): ExampleRuntimeMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "release") {
    return "release";
  }
  if (normalized === "debug") {
    return "debug";
  }
  return undefined;
}

function fileExists(path: string): boolean {
  return existsSync(path);
}
