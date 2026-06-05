import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function prepareLocalWebviewExtensionPath(importMetaUrl: string): Promise<string | undefined> {
  const localWebviewExtension = await resolveLocalWebviewExtension(importMetaUrl);
  if (process.env.OPENTRAY_EXT_PATH === undefined && localWebviewExtension !== undefined) {
    process.env.OPENTRAY_EXT_PATH = localWebviewExtension;
  }
  return localWebviewExtension;
}

export function createVisibleTrayIcon(): { type: "rgba"; width: number; height: number; data: number[] } {
  const width = 32;
  const height = 32;
  const data: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const inRing = distance >= 9 && distance <= 14;
      const inCore = distance <= 5;
      const inNeedle = Math.abs(dx + dy) <= 1.2 && x >= 9 && x <= 23 && y >= 9 && y <= 23;

      if (inRing || inCore || inNeedle) {
        data.push(inCore ? 255 : 24, inNeedle ? 240 : 132, inRing ? 72 : 96, 255);
      } else {
        data.push(0, 0, 0, 0);
      }
    }
  }

  return { type: "rgba", width, height, data };
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
