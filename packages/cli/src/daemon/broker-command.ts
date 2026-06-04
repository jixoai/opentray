import { access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import type { DaemonPaths } from "./paths";
import { MissingPlatformBrokerBinaryError, resolveBrokerNativeTarget } from "./native-target";

export interface BrokerCommand {
  command: string;
  args: string[];
  cwd?: string;
}

const sourceUrl = import.meta.url;
const requireFromSource = createRequire(sourceUrl);

export interface ResolveBrokerCommandOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  sourceDir?: string;
  resolvePackageJson?: (packageName: string) => string | undefined;
  findWorkspaceRoot?: (start: string) => Promise<string | undefined>;
  ensureDevBrokerBinary?: (workspaceRoot: string) => Promise<string>;
}

export const resolveBrokerCommand = async (
  paths: DaemonPaths,
  options: ResolveBrokerCommandOptions = {},
): Promise<BrokerCommand> => {
  const env = options.env ?? process.env;
  const explicit = env.OPENTRAY_BROKER_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return commandForBinary(explicit, paths);
  }

  const sourceDir = options.sourceDir ?? dirname(fileURLToPath(sourceUrl));
  const workspaceRoot = await (options.findWorkspaceRoot ?? findWorkspaceRoot)(sourceDir);
  if (workspaceRoot !== undefined) {
    const binary = await (options.ensureDevBrokerBinary ?? ensureDevBrokerBinary)(workspaceRoot);
    return commandForBinary(binary, paths, workspaceRoot);
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const installedBinary = await resolveInstalledBrokerBinary({
    platform,
    arch,
    resolvePackageJson: options.resolvePackageJson ?? resolvePackageJson,
  });
  if (installedBinary !== undefined) {
    return commandForBinary(installedBinary, paths);
  }

  const target = resolveBrokerNativeTarget(platform, arch);
  throw new MissingPlatformBrokerBinaryError(
    `unable to resolve OpenTray broker binary for ${platform}/${arch}; install ${target.packageName} or set OPENTRAY_BROKER_BIN`,
    platform,
    arch,
    { packageName: target.packageName },
  );
};

const commandForBinary = (binary: string, paths: DaemonPaths, cwd?: string): BrokerCommand => {
  const command: BrokerCommand = {
    command: binary,
    args: [
      "broker",
      "--endpoint",
      paths.endpoint,
      "--ready-file",
      paths.readyFile,
      "--package-version",
      paths.packageVersion,
      "--protocol-version",
      `${paths.protocolVersion}`,
    ],
  };
  if (cwd !== undefined) {
    command.cwd = cwd;
  }
  return command;
};

interface ResolveInstalledBrokerBinaryOptions {
  platform: NodeJS.Platform;
  arch: string;
  resolvePackageJson: (packageName: string) => string | undefined;
}

export const resolveInstalledBrokerBinary = async ({
  platform,
  arch,
  resolvePackageJson,
}: ResolveInstalledBrokerBinaryOptions): Promise<string | undefined> => {
  const target = resolveBrokerNativeTarget(platform, arch);
  const packageJsonPath = resolvePackageJson(target.packageName);
  if (packageJsonPath === undefined) {
    return undefined;
  }

  const binary = join(dirname(packageJsonPath), target.binaryRelativePath);
  if (!(await exists(binary))) {
    throw new MissingPlatformBrokerBinaryError(
      `OpenTray broker package ${target.packageName} is installed but missing ${target.binaryRelativePath}`,
      platform,
      arch,
      {
        packageName: target.packageName,
        binaryPath: binary,
      },
    );
  }

  if (platform !== "win32") {
    await chmod(binary, 0o755);
  }

  return binary;
};

const resolvePackageJson = (packageName: string): string | undefined => {
  try {
    return requireFromSource.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (isNodeError(error) && error.code === "MODULE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
};

const findWorkspaceRoot = async (start: string): Promise<string | undefined> => {
  let current = start;
  while (true) {
    if (await exists(join(current, "Cargo.toml"))) {
      if (await exists(join(current, "crates", "opentray-bin", "Cargo.toml"))) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const ensureDevBrokerBinary = async (workspaceRoot: string): Promise<string> => {
  const binary = join(
    workspaceRoot,
    "target",
    "debug",
    process.platform === "win32" ? "opentray.exe" : "opentray",
  );
  await runCargoBuild(workspaceRoot);
  return binary;
};

const runCargoBuild = (workspaceRoot: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-bin"], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_BROKER_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo build -p opentray-bin failed with code ${code ?? "unknown"}`));
    });
  });

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
