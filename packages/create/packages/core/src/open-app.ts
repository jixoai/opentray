// Orthogonal intents (maintained 2026-08-19; original user request: the Success
// dialog offers an open-app action and a taskbar/Dock pinning hint; 2026-08-19
// generation no longer first-launches the app, so the first open must also be
// able to cold-start through the entry — decision D1 in
// openspec/changes/create-no-first-launch-force-terminal/plans/plan.md):
// 1. Open the materialized app per platform: macOS via the stable .app bundle
//    when it exists, else a detached cold start of the generated entry.
// 2. Launch the entry with a real Node runtime (a Bun-hosted wizard must not
//    persist its own execPath into the spawned app).
// 3. Keep the hint platform-truthful: no Windows shortcut persistence claims
//    and no Dock-pin claim before the bundle exists.

import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expectedDarwinBundlePath } from "./materialize";

export interface OpenAppInput {
  readonly projectDir: string;
  readonly bundlePath: string | undefined;
  readonly platform?: NodeJS.Platform | undefined;
}

export interface OpenAppResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** The generated entry embeds a native PTY: it needs Node, never a Bun host. */
const nodeExecutable = (): string => {
  if (process.versions.bun === undefined && process.execPath.includes("node")) {
    return process.execPath;
  }
  try {
    const found = spawnSync("which", ["node"], { encoding: "utf8" }).stdout?.trim() ?? "";
    if (found.length > 0) return found;
  } catch {
    /* fall through */
  }
  return "node";
};

/** Expected bundle path for a project's frozen opentray.app.json identity. */
const expectedBundleForProject = async (projectDir: string): Promise<string | undefined> => {
  try {
    const raw = JSON.parse(await readFile(join(projectDir, "opentray.app.json"), "utf8")) as {
      appId?: unknown;
      appName?: unknown;
    };
    if (typeof raw.appId !== "string" || typeof raw.appName !== "string") {
      return undefined;
    }
    return expectedDarwinBundlePath({ appId: raw.appId, appName: raw.appName });
  } catch {
    return undefined;
  }
};

const spawnEntryCold = (projectDir: string): OpenAppResult => {
  const child = spawn(nodeExecutable(), [join(projectDir, "main.mjs")], {
    cwd: projectDir,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  // A detached launcher must not surface async spawn errors on the wizard.
  child.once("error", () => {});
  child.unref();
  if (child.pid === undefined) {
    return { ok: false, detail: `failed to spawn ${projectDir}/main.mjs` };
  }
  return { ok: true, detail: `launched app entry (pid ${child.pid})` };
};

export const openMaterializedApp = async (input: OpenAppInput): Promise<OpenAppResult> => {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin") {
    const bundlePath =
      input.bundlePath ?? (await expectedBundleForProject(input.projectDir));
    if (bundlePath === undefined) {
      // No identity to derive a bundle from: cold-start through the entry.
      return spawnEntryCold(input.projectDir);
    }
    try {
      await stat(bundlePath);
    } catch {
      // Never launched → no materialized bundle yet: the entry's first run
      // creates it, after which Dock pinning becomes available.
      return spawnEntryCold(input.projectDir);
    }
    const child = spawn("open", [bundlePath], {
      stdio: "ignore",
      windowsHide: true,
    });
    const status = await new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("exit", (code) => resolve(code));
    });
    if (status === 0) {
      return { ok: true, detail: `opened ${bundlePath}` };
    }
    return {
      ok: false,
      detail: `open ${bundlePath} failed with ${status ?? "spawn error"}`,
    };
  }
  return spawnEntryCold(input.projectDir);
};

/** Platform-truthful pinning hint; makes no persistence claim before first open. */
export const pinningHint = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === "darwin") {
    return "首次打开应用后，右键点击 Dock 中的应用图标，选择“选项 → 在程序坞中保留”，即可固定到 Dock。";
  }
  if (platform === "win32") {
    return "右键点击任务栏中的应用图标，选择“固定到任务栏”即可固定。（OpenTray 尚未生成开始菜单快捷方式）";
  }
  return "可将应用窗口固定到任务栏/收藏夹；Linux 桌面快捷方式生成尚未提供。";
};
