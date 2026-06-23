import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Menu } from "@opentray/spec";

import type { WebviewIpcMessage, WebviewWindowHandle } from "../../../ext-webview/src/index";
import { terminateWorkspaceDevBrokerProcess } from "../../src/daemon/broker-command";
import {
  createClient,
  type EventfulSpaceHandle,
  type EventfulTrayHandle,
  type OpenTrayEventfulClient,
} from "../../src/index";
import { connectLocalBroker, type LocalBrokerClient } from "../../src/node";
import { createVisibleTrayIcon } from "./visible-tray-icon";

export { createVisibleTrayIcon };

export interface WebviewExampleRuntimeOptions {
  importMetaUrl: string;
  requestIdPrefix: string;
  homePrefix: string;
  space: {
    id: string;
    title: string;
    default?: boolean;
  };
  tray: {
    trayId: string;
    title: string;
    tooltip?: {
      title: string;
      description: string;
    };
    menu: Menu;
  };
}

export interface WebviewExampleRuntime {
  localWebviewExtension: string | undefined;
  homeDir: string;
  connection: LocalBrokerClient;
  client: OpenTrayEventfulClient;
  space: EventfulSpaceHandle;
  tray: EventfulTrayHandle;
  shutdown(): Promise<void>;
}

export interface WebviewPageMessageWatch {
  stop(): void;
}

export async function createWebviewExampleRuntime(
  options: WebviewExampleRuntimeOptions,
): Promise<WebviewExampleRuntime> {
  const localWebviewExtension = await prepareLocalWebviewExtensionPath(options.importMetaUrl);
  const homeDir = process.env.OPENTRAY_HOME ?? createShortExampleHome(options.homePrefix);
  const connection = await connectLocalBroker({ homeDir });
  const client = createClient(connection, { requestIdPrefix: options.requestIdPrefix });

  console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);
  console.log(`broker home: ${homeDir}`);
  if (localWebviewExtension !== undefined) {
    console.log(`webview dylib: ${localWebviewExtension}`);
  }

  const space = await client.createSpace({
    id: options.space.id,
    title: options.space.title,
    default: options.space.default ?? true,
  });
  console.log(`space: ${JSON.stringify(space.space)}`);

  const tray = await space.createTray({
    trayId: options.tray.trayId,
    title: options.tray.title,
    ...(options.tray.tooltip === undefined ? {} : { tooltip: options.tray.tooltip }),
    icon: createVisibleTrayIcon(),
    menu: options.tray.menu,
  });
  console.log(`tray: ${tray.trayId}`);

  let closed = false;
  return {
    localWebviewExtension,
    homeDir,
    connection,
    client,
    space,
    tray,
    async shutdown() {
      if (closed) {
        return;
      }
      closed = true;
      await connection.close();
    },
  };
}

function createShortExampleHome(homePrefix: string): string {
  const candidateRoots = ["/tmp", join(homedir(), ".opentray"), tmpdir()];
  for (const root of candidateRoots) {
    if (root.length <= 16) {
      return join(root, `${homePrefix}-${process.pid}`);
    }
  }
  return join("/tmp", `${homePrefix}-${process.pid}`);
}

export function listenWebviewIpcMessages(
  window: Pick<WebviewWindowHandle, "drainIpcMessages">,
  handler: (message: WebviewIpcMessage) => void | Promise<void>,
  options: { intervalMs?: number } = {},
): WebviewPageMessageWatch {
  let active = true;
  let draining = false;
  const intervalMs = Math.max(16, Math.round(options.intervalMs ?? 100));
  const drain = async (): Promise<void> => {
    if (!active || draining) {
      return;
    }
    draining = true;
    try {
      const messages = await window.drainIpcMessages();
      for (const message of messages) {
        await handler(message);
      }
    } catch {
      // The window may be closed or hidden while the example is shutting down.
    } finally {
      draining = false;
    }
  };
  const timer = setInterval(() => {
    void drain();
  }, intervalMs);
  void drain();
  return {
    stop() {
      active = false;
      clearInterval(timer);
    },
  };
}

export async function prepareLocalWebviewExtensionPath(importMetaUrl: string): Promise<string | undefined> {
  await prepareLocalWindowsAppRuntimeEnvironment();
  const localWebviewExtension = await resolveLocalWebviewExtension(importMetaUrl);
  if (process.env.OPENTRAY_EXT_PATH === undefined && localWebviewExtension !== undefined) {
    process.env.OPENTRAY_EXT_PATH = localWebviewExtension;
  }
  return localWebviewExtension;
}

export async function prepareLocalBadgeExtensionPath(importMetaUrl: string): Promise<string | undefined> {
  const localBadgeExtension = await resolveLocalBadgeExtension(importMetaUrl);
  if (process.env.OPENTRAY_BADGE_EXT_PATH === undefined && localBadgeExtension !== undefined) {
    process.env.OPENTRAY_BADGE_EXT_PATH = localBadgeExtension;
  }
  return localBadgeExtension;
}

async function resolveLocalWebviewExtension(importMetaUrl: string): Promise<string | undefined> {
  const artifactName = localWebviewArtifactName();
  if (artifactName === undefined) {
    return undefined;
  }

  const workspaceCargoToml = fileURLToPath(new URL("../../../Cargo.toml", importMetaUrl));
  try {
    await access(workspaceCargoToml, constants.R_OK);
  } catch {
    // Not running from the workspace root layout, so skip the source-build path.
    return undefined;
  }
  await runSourceTreeExampleBuild(fileURLToPath(new URL("../../../", importMetaUrl)));

  const candidates = [
    fileURLToPath(new URL(`../../../target/debug/${artifactName}`, importMetaUrl)),
    fileURLToPath(new URL(`../../../target/release/${artifactName}`, importMetaUrl)),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function runSourceTreeExampleBuild(workspaceRoot: string): Promise<void> {
  await terminateWorkspaceDevBrokerProcess(workspaceRoot);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-bin", "-p", "opentray-ext-webview"], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `cargo build -p opentray-bin -p opentray-ext-webview failed with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function resolveLocalBadgeExtension(importMetaUrl: string): Promise<string | undefined> {
  const artifactName = localBadgeArtifactName();
  if (artifactName === undefined) {
    return undefined;
  }

  const workspaceCargoToml = fileURLToPath(new URL("../../../Cargo.toml", importMetaUrl));
  try {
    await access(workspaceCargoToml, constants.R_OK);
  } catch {
    return undefined;
  }
  await runSourceTreeBadgeBuild(fileURLToPath(new URL("../../../", importMetaUrl)));

  const candidates = [
    fileURLToPath(new URL(`../../../target/debug/${artifactName}`, importMetaUrl)),
    fileURLToPath(new URL(`../../../target/release/${artifactName}`, importMetaUrl)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function runSourceTreeBadgeBuild(workspaceRoot: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-bin", "-p", "opentray-ext-badge"], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `cargo build -p opentray-bin -p opentray-ext-badge failed with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

function localWebviewArtifactName(): string | undefined {
  if (process.platform === "win32") {
    return "opentray_ext_webview.dll";
  }
  if (process.platform === "darwin") {
    return "libopentray_ext_webview.dylib";
  }
  return undefined;
}

function localBadgeArtifactName(): string | undefined {
  if (process.platform === "win32") {
    return "opentray_ext_badge.dll";
  }
  if (process.platform === "darwin") {
    return "libopentray_ext_badge.dylib";
  }
  return undefined;
}

async function prepareLocalWindowsAppRuntimeEnvironment(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  if (process.env.OPENTRAY_WINDOWS_APP_RUNTIME_DIR === undefined) {
    const runtimeDir = resolveWindowsAppRuntimeInstallLocation();
    if (runtimeDir !== undefined) {
      process.env.OPENTRAY_WINDOWS_APP_RUNTIME_DIR = runtimeDir;
    }
  }

  if (process.env.OPENTRAY_WINDOWS_APP_RUNTIME_BOOTSTRAP_DLL === undefined) {
    const bootstrapDll = resolveWindowsAppRuntimeBootstrapDll();
    if (bootstrapDll !== undefined) {
      process.env.OPENTRAY_WINDOWS_APP_RUNTIME_BOOTSTRAP_DLL = bootstrapDll;
    }
  }
}

function resolveWindowsAppRuntimeInstallLocation(): string | undefined {
  const script = String.raw`
    $package = Get-AppxPackage -Name Microsoft.WindowsAppRuntime.1.8 |
      Where-Object { $_.InstallLocation -like '*_x64__8wekyb3d8bbwe' } |
      Sort-Object Version -Descending |
      Select-Object -First 1 -ExpandProperty InstallLocation
    if ($package) {
      Write-Output $package
    }
  `;
  const result = runPowerShell(script);
  return result?.trim() || undefined;
}

function resolveWindowsAppRuntimeBootstrapDll(): string | undefined {
  return firstExistingPath([
    "C:\\Program Files\\WSL\\wslsettings\\Microsoft.WindowsAppRuntime.Bootstrap.dll",
    "C:\\Program Files\\Microsoft Office\\root\\vfs\\ProgramFilesCommonX64\\Microsoft Shared\\OFFICE16\\AI\\SDK\\Microsoft.WindowsAppRuntime.Bootstrap.dll",
  ]);
}

function firstExistingPath(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function runPowerShell(script: string): string | undefined {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );
  if (result.error !== undefined || result.status !== 0) {
    return undefined;
  }
  const output = result.stdout.trim();
  return output.length > 0 ? output : undefined;
}
