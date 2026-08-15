// Orthogonal intents (maintained 2026-07-22; original user request: the Success
// dialog offers an open-app action and a taskbar/Dock pinning hint):
// 1. Open the materialized app per platform: macOS via the stable .app bundle,
//    Windows/Linux via a detached absolute-runtime launch of the generated entry.
// 2. Keep the hint platform-truthful: no Windows shortcut persistence claims.

import { spawn } from "node:child_process";
import { join } from "node:path";

export interface OpenAppInput {
  readonly projectDir: string;
  readonly bundlePath: string | undefined;
  readonly platform?: NodeJS.Platform | undefined;
}

export interface OpenAppResult {
  readonly ok: boolean;
  readonly detail: string;
}

export const openMaterializedApp = async (input: OpenAppInput): Promise<OpenAppResult> => {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin") {
    if (input.bundlePath === undefined) {
      return { ok: false, detail: "stable Darwin app bundle path is unknown" };
    }
    const child = spawn("open", [input.bundlePath], {
      stdio: "ignore",
      windowsHide: true,
    });
    const status = await new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("exit", (code) => resolve(code));
    });
    if (status === 0) {
      return { ok: true, detail: `opened ${input.bundlePath}` };
    }
    return {
      ok: false,
      detail: `open ${input.bundlePath} failed with ${status ?? "spawn error"}`,
    };
  }
  const child = spawn(process.execPath, [join(input.projectDir, "main.mjs")], {
    cwd: input.projectDir,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  // A detached launcher must not surface async spawn errors on the wizard.
  child.once("error", () => {});
  child.unref();
  if (child.pid === undefined) {
    return { ok: false, detail: `failed to spawn ${input.projectDir}/main.mjs` };
  }
  return { ok: true, detail: `launched app entry (pid ${child.pid})` };
};

/** Platform-truthful pinning hint; makes no Windows persistence claim. */
export const pinningHint = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === "darwin") {
    return "右键点击 Dock 中的应用图标，选择“选项 → 在程序坞中保留”，即可固定到 Dock。";
  }
  if (platform === "win32") {
    return "右键点击任务栏中的应用图标，选择“固定到任务栏”即可固定。（OpenTray 尚未生成开始菜单快捷方式）";
  }
  return "可将应用窗口固定到任务栏/收藏夹；Linux 桌面快捷方式生成尚未提供。";
};
