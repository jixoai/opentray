import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import type { BrokerArtifactIdentity } from "@opentray/spec";

import type { DaemonPaths } from "./paths";
import {
  type BrokerNativeTarget,
  MissingPlatformBrokerBinaryError,
  resolveBrokerArtifactTarget,
  resolveBrokerNativeTarget,
} from "./native-target";

export interface BrokerCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ResolvedBrokerArtifact extends BrokerCommand {
  executablePath: string;
  artifactIdentity: BrokerArtifactIdentity;
}

const sourceUrl = import.meta.url;
const requireFromSource = createRequire(sourceUrl);

export interface InstalledBrokerBinaryResolution {
  binary?: string;
  binaryPath?: string;
}

export interface ResolveInstalledBrokerBinaryOptions {
  platform?: NodeJS.Platform;
  resolvePackageJson?: (specifier: string) => string;
  assertBinaryAccessible?: (binaryPath: string, platform: NodeJS.Platform) => Promise<void>;
}

export interface ResolveBrokerCommandOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  sourceDir?: string;
  resolveInstalledBrokerBinary?: (
    target: BrokerNativeTarget,
    options: ResolveInstalledBrokerBinaryOptions,
  ) => Promise<InstalledBrokerBinaryResolution>;
  findWorkspaceRoot?: (start: string) => Promise<string | undefined>;
  ensureDevBrokerBinary?: (
    workspaceRoot: string,
    paths: DaemonPaths,
    platform: NodeJS.Platform,
  ) => Promise<string>;
}

export interface ResolveBrokerArtifactOptions extends ResolveBrokerCommandOptions {
  resolveExecutablePath?: (path: string) => Promise<string>;
  readExecutable?: (path: string) => Promise<Uint8Array>;
}

export const resolveBrokerArtifact = async (
  paths: DaemonPaths,
  options: ResolveBrokerArtifactOptions = {},
): Promise<ResolvedBrokerArtifact> => {
  const command = await resolveBrokerCommand(paths, options);
  const executablePath = await (options.resolveExecutablePath ?? realpath)(command.command);
  const bytes = await (options.readExecutable ?? readFile)(executablePath);
  const executableHash = createHash("sha256").update(bytes).digest("hex");
  const artifactIdentity: BrokerArtifactIdentity = {
    packageVersion: paths.packageVersion,
    target: resolveBrokerArtifactTarget(
      options.platform ?? process.platform,
      options.arch ?? process.arch,
    ),
    executableHash,
    buildIdentity: `sha256:${executableHash.slice(0, 16)}`,
  };
  return {
    ...command,
    command: executablePath,
    args: [
      ...command.args,
      "--broker-executable-path",
      executablePath,
      "--broker-artifact-identity",
      JSON.stringify(artifactIdentity),
    ],
    executablePath,
    artifactIdentity,
  };
};

export const resolveBrokerCommand = async (
  paths: DaemonPaths,
  options: ResolveBrokerCommandOptions = {},
): Promise<BrokerCommand> => {
  const env = options.env ?? process.env;
  const explicit = env.OPENTRAY_BROKER_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return commandForBinary(explicit, paths);
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveBrokerNativeTarget(platform, arch);
  const installed = await (options.resolveInstalledBrokerBinary ?? resolveInstalledBrokerBinary)(
    target,
    { platform },
  );
  if (installed.binary !== undefined) {
    return commandForBinary(installed.binary, paths);
  }

  const sourceDir = options.sourceDir ?? dirname(fileURLToPath(sourceUrl));
  const workspaceRoot = await (options.findWorkspaceRoot ?? findWorkspaceRoot)(sourceDir);
  if (workspaceRoot !== undefined) {
    const binary = await (options.ensureDevBrokerBinary ?? ensureDevBrokerBinary)(
      workspaceRoot,
      paths,
      platform,
    );
    return commandForBinary(binary, paths);
  }

  throw new MissingPlatformBrokerBinaryError(
    installed.binaryPath === undefined
      ? `unable to resolve OpenTray broker binary for ${platform}/${arch}; install "${target.packageName}" for this platform or set OPENTRAY_BROKER_BIN`
      : `unable to resolve OpenTray broker binary for ${platform}/${arch}; package "${target.packageName}" was found but binary "${installed.binaryPath}" is not accessible; restage the runtime package or set OPENTRAY_BROKER_BIN`,
    platform,
    arch,
    {
      packageName: target.packageName,
      ...(installed.binaryPath === undefined ? {} : { binaryPath: installed.binaryPath }),
    },
  );
};

export const resolveInstalledBrokerBinary = async (
  target: BrokerNativeTarget,
  options: ResolveInstalledBrokerBinaryOptions = {},
): Promise<InstalledBrokerBinaryResolution> => {
  const platform = options.platform ?? process.platform;
  let packageJsonPath: string;
  try {
    packageJsonPath = (
      options.resolvePackageJson ?? requireFromSource.resolve.bind(requireFromSource)
    )(`${target.packageName}/package.json`);
  } catch (error) {
    if (isNodeError(error) && error.code === "MODULE_NOT_FOUND") {
      return {};
    }
    throw error;
  }

  const binaryPath = join(dirname(packageJsonPath), target.binaryRelativePath);
  try {
    await (options.assertBinaryAccessible ?? assertInstalledBrokerBinaryAccessible)(
      binaryPath,
      platform,
    );
    return { binary: binaryPath, binaryPath };
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM")
    ) {
      return { binaryPath };
    }
    throw error;
  }
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
      "--app-id",
      paths.appId,
      "--app-name",
      paths.appName,
      "--caller-label",
      paths.callerLabel,
    ],
  };
  if (cwd !== undefined) {
    command.cwd = cwd;
  }
  return command;
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

export const resolveDevBrokerBinaryPath = (
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
  callerLabel = "opentray",
): string =>
  join(
    resolveDevBrokerTargetDir(workspaceRoot, platform, callerLabel),
    "debug",
    platform === "win32" ? "opentray.exe" : "opentray",
  );

const resolveDevBrokerTargetDir = (
  workspaceRoot: string,
  platform: NodeJS.Platform,
  callerLabel: string,
): string =>
  platform === "win32"
    ? join(workspaceRoot, "target", "opentray-source", callerLabel)
    : join(workspaceRoot, "target");

const ensureDevBrokerBinary = async (
  workspaceRoot: string,
  paths: DaemonPaths,
  platform: NodeJS.Platform,
): Promise<string> => {
  const targetDir = resolveDevBrokerTargetDir(workspaceRoot, platform, paths.callerLabel);
  const binary = resolveDevBrokerBinaryPath(workspaceRoot, platform, paths.callerLabel);
  await runCargoBuild(workspaceRoot, platform === "win32" ? targetDir : undefined);
  return binary;
};

const runCargoBuild = (workspaceRoot: string, targetDir?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      [
        "build",
        "-p",
        "opentray-bin",
        ...(targetDir === undefined ? [] : ["--target-dir", targetDir]),
      ],
      {
        cwd: workspaceRoot,
        stdio: process.env.OPENTRAY_BROKER_BUILD_LOGS === "1" ? "inherit" : "ignore",
      },
    );
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

const binaryAccessMode = (platform: NodeJS.Platform): number =>
  platform === "win32" ? constants.F_OK : constants.X_OK;

const assertInstalledBrokerBinaryAccessible = async (
  binaryPath: string,
  platform: NodeJS.Platform,
): Promise<void> => {
  await access(binaryPath, binaryAccessMode(platform));
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
