import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export { createVisibleTrayIcon } from "../../src/smoke/visible-tray-icon";

export async function prepareLocalWebviewExtensionPath(importMetaUrl: string): Promise<string | undefined> {
  await prepareLocalWindowsAppRuntimeEnvironment();
  const localWebviewExtension = await resolveLocalWebviewExtension(importMetaUrl);
  if (process.env.OPENTRAY_EXT_PATH === undefined && localWebviewExtension !== undefined) {
    process.env.OPENTRAY_EXT_PATH = localWebviewExtension;
  }
  return localWebviewExtension;
}

async function resolveLocalWebviewExtension(importMetaUrl: string): Promise<string | undefined> {
  const workspaceCargoToml = fileURLToPath(new URL("../../../Cargo.toml", importMetaUrl));
  try {
    await access(workspaceCargoToml, constants.R_OK);
    await runCargoBuild(fileURLToPath(new URL("../../../", importMetaUrl)));
  } catch {
    // Not running from the workspace root layout, so skip the source-build path.
  }

  const artifactName =
    process.platform === "win32"
      ? "opentray_ext_webview.dll"
      : process.platform === "darwin"
        ? "libopentray_ext_webview.dylib"
        : "libopentray_ext_webview.so";
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

function runCargoBuild(workspaceRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", ["build", "-p", "opentray-ext-webview"], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`cargo build -p opentray-ext-webview failed with code ${code ?? "unknown"}`));
    });
  });
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
