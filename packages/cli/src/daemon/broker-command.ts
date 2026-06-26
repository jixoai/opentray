import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import type { DaemonPaths } from "./paths";
import {
  MissingPlatformBrokerBinaryError,
  resolveBrokerNativeTarget,
} from "./native-target";

export interface BrokerCommand {
  command: string;
  args: string[];
  cwd?: string;
}

const sourceUrl = import.meta.url;

export interface ResolveBrokerCommandOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  sourceDir?: string;
  findWorkspaceRoot?: (start: string) => Promise<string | undefined>;
  ensureDevBrokerBinary?: (workspaceRoot: string) => Promise<string>;
}

export const resolveBrokerCommand = async (
  paths: DaemonPaths,
  options: ResolveBrokerCommandOptions = {}
): Promise<BrokerCommand> => {
  const env = options.env ?? process.env;
  const explicit = env.OPENTRAY_BROKER_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return commandForBinary(explicit, paths);
  }

  const sourceDir = options.sourceDir ?? dirname(fileURLToPath(sourceUrl));
  const workspaceRoot = await (options.findWorkspaceRoot ?? findWorkspaceRoot)(
    sourceDir
  );
  if (workspaceRoot !== undefined) {
    const binary = await (
      options.ensureDevBrokerBinary ?? ensureDevBrokerBinary
    )(workspaceRoot);
    return commandForBinary(binary, paths, workspaceRoot);
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveBrokerNativeTarget(platform, arch);
  throw new MissingPlatformBrokerBinaryError(
    `unable to resolve OpenTray debug broker binary for ${platform}/${arch}; run from the source workspace or set OPENTRAY_BROKER_BIN`,
    platform,
    arch,
    { packageName: target.packageName }
  );
};

const commandForBinary = (
  binary: string,
  paths: DaemonPaths,
  cwd?: string
): BrokerCommand => {
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
      "--caller-label",
      paths.callerLabel,
    ],
  };
  if (cwd !== undefined) {
    command.cwd = cwd;
  }
  return command;
};

const findWorkspaceRoot = async (
  start: string
): Promise<string | undefined> => {
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
  platform: NodeJS.Platform = process.platform
): string =>
  join(
    workspaceRoot,
    "target",
    "debug",
    platform === "win32" ? "opentray.exe" : "opentray"
  );

export const terminateWorkspaceDevBrokerProcess = async (
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  if (platform !== "win32") {
    return;
  }
  await terminateWindowsProcessByExecutable(
    resolveDevBrokerBinaryPath(workspaceRoot, platform)
  );
};

const ensureDevBrokerBinary = async (
  workspaceRoot: string
): Promise<string> => {
  const binary = resolveDevBrokerBinaryPath(workspaceRoot);
  await terminateWorkspaceDevBrokerProcess(workspaceRoot);
  await runCargoBuild(workspaceRoot);
  return binary;
};

const runCargoBuild = (workspaceRoot: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-bin"], {
      cwd: workspaceRoot,
      stdio:
        process.env.OPENTRAY_BROKER_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `cargo build -p opentray-bin failed with code ${code ?? "unknown"}`
        )
      );
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

const terminateWindowsProcessByExecutable = (binary: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath(${powerShellString(binary)})
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'opentray.exe'" | Where-Object {
  $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target)
})
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}
foreach ($process in $processes) {
  Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
}
`;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `failed to stop running dev broker before cargo build: ${
            stderr.trim() || code
          }`
        )
      );
    });
  });

const powerShellString = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
