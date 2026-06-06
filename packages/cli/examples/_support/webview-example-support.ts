import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export { createVisibleTrayIcon } from "../../src/smoke/visible-tray-icon";

export async function prepareLocalWebviewExtensionPath(importMetaUrl: string): Promise<string | undefined> {
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
