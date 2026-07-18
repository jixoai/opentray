// Orthogonal intents (maintained 2026-07-19; original user request: `example:webview-control` cannot start):
// 1. Build and connect a source-tree WebView example runtime.
// 2. Mount the typed WebView capability on the example tray.
// 3. Isolate each example invocation from other same-version CLI brokers.
// 4. Close the native runtime before Vite so automatic example exit cannot retain WebView clients.
// 5. Keep descriptive example identities inside native endpoint length limits.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type {
  WebviewIpcMessage,
  WebviewTrayCapability,
  WebviewWindowHandle,
  WebviewWindowOptions,
} from "../../../ext-webview/src/index";
import { WebviewExt } from "../../../ext-webview/src/index";
import { createClient, type EventfulTrayHandle, type Menu } from "../../src/index";
import { connectLocalBroker, type LocalBrokerClient } from "../../src/local-broker";
import {
  type ExampleRuntimeMode,
  prepareExampleBrokerBinary,
  resolveExampleRuntimeMode,
  resolveSourceWorkspaceRoot,
  runSourceTreeCargoBuild,
  sourceTreeArtifactPath,
} from "./example-runtime-mode";
import { createVisibleTrayIcon } from "./visible-tray-icon";

export { createVisibleTrayIcon };

export const EXAMPLE_PRIMARY_ITEM_ID = 1;

/** Reject a Windows-only native composition regression example on other platforms. */
export function requireWindowsExample(
  exampleName: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") {
    throw new Error(`${exampleName} is a Windows-only composition regression example`);
  }
}

export interface ExamplePrimaryMenuOptions {
  readonly visible: boolean;
  readonly primaryItemId?: number;
  readonly trailingItems?: Menu["items"];
}

/** Builds the standard retained-WebView primary action for runnable source examples. */
export function createExamplePrimaryMenu(options: ExamplePrimaryMenuOptions): Menu {
  return {
    items: [
      {
        type: "item",
        id: options.primaryItemId ?? EXAMPLE_PRIMARY_ITEM_ID,
        title: options.visible ? "Hide Example" : "Show Example",
        primaryEvent: true,
      },
      ...(options.trailingItems ?? []),
    ],
  };
}

/** Projects operational window visibility back into the example's primary tray action. */
export async function syncExamplePrimaryMenu(
  tray: Pick<EventfulTrayHandle, "setMenu">,
  options: ExamplePrimaryMenuOptions,
): Promise<void> {
  await tray.setMenu(createExamplePrimaryMenu(options));
}

export interface WebviewExampleRuntimeOptions {
  importMetaUrl: string;
  requestIdPrefix: string;
  homePrefix: string;
  tray: {
    id: string;
    tooltip?: {
      title: string;
      description: string;
    };
    menu: Menu;
  };
  runtimeMode?: ExampleRuntimeMode;
}

export interface WebviewExampleRuntime {
  localWebviewExtension: string | undefined;
  homeDir: string;
  connection: LocalBrokerClient;
  tray: EventfulTrayHandle;
  shutdown(): Promise<void>;
}

/** Close a source WebView example without leaving its Vite server or broker behind. */
export async function shutdownWebviewExample(
  runtime: Pick<WebviewExampleRuntime, "shutdown">,
  devServer: { close(): Promise<void> },
): Promise<void> {
  try {
    await runtime.shutdown();
  } finally {
    await devServer.close();
  }
}

export interface WebviewPageMessageWatch {
  stop(): void;
}

export async function createWebviewExampleRuntime(
  options: WebviewExampleRuntimeOptions,
): Promise<WebviewExampleRuntime> {
  const runtimeMode = options.runtimeMode ?? resolveExampleRuntimeMode();
  const localWebviewExtension = await prepareLocalWebviewExtensionPath(options.importMetaUrl, {
    mode: runtimeMode,
  });
  const homeDir = process.env.OPENTRAY_HOME ?? createShortExampleHome(options.homePrefix);
  const callerLabel = createExampleCallerLabel(options.homePrefix);
  const connection = await connectLocalBroker({ homeDir, callerLabel });
  const client = createClient(connection, {
    requestIdPrefix: options.requestIdPrefix,
  });

  console.log(`connected: endpoint=${connection.endpoint} session=${connection.sessionId}`);
  console.log(`runtime home: ${homeDir}`);
  console.log(`runtime caller: ${connection.callerLabel}`);
  console.log(`runtime mode: ${runtimeMode}`);
  if (process.env.OPENTRAY_BROKER_BIN !== undefined) {
    console.log(`broker binary: ${process.env.OPENTRAY_BROKER_BIN}`);
  }
  if (localWebviewExtension !== undefined) {
    console.log(`webview dylib: ${localWebviewExtension}`);
  }

  const tray = await client.createTray({
    id: options.tray.id,
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

export function mountExampleWebview(
  runtime: Pick<WebviewExampleRuntime, "localWebviewExtension" | "tray">,
  mountId: string,
): WebviewTrayCapability {
  const capability = runtime.tray.extend(WebviewExt, {
    mountId,
    ...(runtime.localWebviewExtension === undefined
      ? {}
      : {
          artifact: {
            kind: "file" as const,
            path: runtime.localWebviewExtension,
            identitySource: WebviewExt.artifact,
          },
        }),
  });
  return {
    ...capability,
    createWebviewWindow(options: WebviewWindowOptions): WebviewWindowHandle {
      return capability.createWebviewWindow(withExampleWebviewWindowDefaults(options));
    },
  };
}

export function withExampleWebviewWindowDefaults(
  options: WebviewWindowOptions,
): WebviewWindowOptions {
  return {
    ...options,
    devtools: true,
  };
}

export function createShortExampleHome(homePrefix: string, pid: number = process.pid): string {
  const invocation = createShortExampleInvocation(homePrefix, pid);
  const candidateRoots = ["/tmp", join(homedir(), ".opentray"), tmpdir()];
  for (const root of candidateRoots) {
    if (root.length <= 16) {
      return join(root, `ot-${invocation}`);
    }
  }
  return join("/tmp", `ot-${invocation}`);
}

/**
 * Derives a caller-scoped broker identity for one source-example invocation.
 * Windows pipe names do not include the home directory, so the process id must
 * remain in the label to avoid attaching to a concurrently running neutral-label runtime.
 */
export function createExampleCallerLabel(homePrefix: string, pid: number = process.pid): string {
  return `example-${createShortExampleInvocation(homePrefix, pid)}`;
}

function createShortExampleInvocation(homePrefix: string, pid: number): string {
  const fingerprint = createHash("sha256").update(homePrefix).digest("hex").slice(0, 8);
  return `${pid}-${fingerprint}`;
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

export async function prepareLocalWebviewExtensionPath(
  importMetaUrl: string,
  options: { mode?: ExampleRuntimeMode } = {},
): Promise<string | undefined> {
  await prepareLocalWindowsAppRuntimeEnvironment();
  const mode = options.mode ?? resolveExampleRuntimeMode();
  // An explicit diagnostic file remains authoritative, but the facade still
  // sends it as one exact artifact so the broker never reconstructs package roots.
  if (hasConfiguredWebviewExtensionPath()) {
    if (!hasConfiguredBrokerBinaryPath()) {
      await prepareExampleBrokerBinary(importMetaUrl, mode);
    }
    return process.env.OPENTRAY_EXT_PATH?.trim();
  }
  const localWebviewExtension = await resolveLocalWebviewExtension(importMetaUrl, mode);
  if (process.env.OPENTRAY_EXT_PATH === undefined && localWebviewExtension !== undefined) {
    process.env.OPENTRAY_EXT_PATH = localWebviewExtension;
  }
  return localWebviewExtension;
}

export function hasConfiguredWebviewExtensionPath(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OPENTRAY_EXT_PATH?.trim().length ?? 0) > 0;
}

/** An explicitly selected broker remains authoritative over source-example defaults. */
export function hasConfiguredBrokerBinaryPath(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OPENTRAY_BROKER_BIN?.trim().length ?? 0) > 0;
}

export async function prepareLocalBadgeExtensionPath(
  importMetaUrl: string,
  options: { mode?: ExampleRuntimeMode } = {},
): Promise<string | undefined> {
  const localBadgeExtension = await resolveLocalBadgeExtension(
    importMetaUrl,
    options.mode ?? resolveExampleRuntimeMode(),
  );
  if (process.env.OPENTRAY_BADGE_EXT_PATH === undefined && localBadgeExtension !== undefined) {
    process.env.OPENTRAY_BADGE_EXT_PATH = localBadgeExtension;
  }
  return localBadgeExtension;
}

async function resolveLocalWebviewExtension(
  importMetaUrl: string,
  mode: ExampleRuntimeMode,
): Promise<string | undefined> {
  const artifactName = localWebviewArtifactName();
  if (artifactName === undefined) {
    return undefined;
  }

  const workspaceRoot = resolveSourceWorkspaceRoot(importMetaUrl);
  if (workspaceRoot === undefined) {
    // Not running from the workspace root layout, so skip the source-build path.
    return undefined;
  }
  await runSourceTreeCargoBuild(workspaceRoot, ["opentray-bin", "opentray-ext-webview"], mode);
  const brokerBinary = sourceTreeArtifactPath(workspaceRoot, mode, localRuntimeArtifactName());
  if (process.env.OPENTRAY_BROKER_BIN === undefined) {
    process.env.OPENTRAY_BROKER_BIN = brokerBinary;
  }

  const candidates = [sourceTreeArtifactPath(workspaceRoot, mode, artifactName)];

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

async function resolveLocalBadgeExtension(
  importMetaUrl: string,
  mode: ExampleRuntimeMode,
): Promise<string | undefined> {
  const artifactName = localBadgeArtifactName();
  if (artifactName === undefined) {
    return undefined;
  }

  const workspaceRoot = resolveSourceWorkspaceRoot(importMetaUrl);
  if (workspaceRoot === undefined) {
    return undefined;
  }
  await runSourceTreeCargoBuild(workspaceRoot, ["opentray-bin", "opentray-ext-badge"], mode);

  const candidates = [sourceTreeArtifactPath(workspaceRoot, mode, artifactName)];
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

function localRuntimeArtifactName(): string {
  return process.platform === "win32" ? "opentray.exe" : "opentray";
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
