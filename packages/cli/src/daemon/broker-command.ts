import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import type { DaemonPaths } from "./paths";

export interface BrokerCommand {
  command: string;
  args: string[];
  cwd?: string;
}

const sourceUrl = import.meta.url;

export const resolveBrokerCommand = async (paths: DaemonPaths): Promise<BrokerCommand> => {
  const explicit = process.env.OPENTRAY_BROKER_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return commandForBinary(explicit, paths);
  }

  const workspaceRoot = await findWorkspaceRoot(dirname(fileURLToPath(sourceUrl)));
  if (workspaceRoot !== undefined) {
    const binary = await ensureDevBrokerBinary(workspaceRoot);
    return commandForBinary(binary, paths, workspaceRoot);
  }

  throw new Error("unable to resolve OpenTray broker binary; set OPENTRAY_BROKER_BIN");
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
