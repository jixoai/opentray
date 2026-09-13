// Orthogonal intents (maintained 2026-08-19; original user request: the Success
// dialog offers an open-app action and a taskbar/Dock pinning hint; 2026-08-19
// generation no longer first-launches the app, so the first open must also be
// able to cold-start through the entry — decision D1 in
// openspec/changes/create-no-first-launch-force-terminal/plans/plan.md;
// 2026-09-14 walkthrough P0: an open now REPLACES a live instance of the same
// app instead of racing it into OPENTRAY_BROKER_SINGLE_SESSION — a Dock-pinned
// carrier cold-starts the entry after the original instance exited, and that
// resurrected instance owns the broker session and a stale shell server):
// 1. Open the materialized app per platform: macOS via the stable .app bundle
//    when it exists, else a detached cold start of the generated entry.
// 2. Launch the entry with a real Node runtime (a Bun-hosted wizard must not
//    persist its own execPath into the spawned app).
// 3. Keep the hint platform-truthful: no Windows shortcut persistence claims
//    and no Dock-pin claim before the bundle exists.
// 4. Replace any live entry instance first (Dev Launch Law replace semantics):
//    probe by argv identity (`<projectDir>/main.mjs`), stop the tree, and wait
//    bounded for PID release before spawning the new instance.

import { execFile, spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expectedDarwinBundlePath } from "./materialize";
import { killProcessTree } from "./runtime-record";
import { userMessages, type UiLocale } from "./user-messages";

const execFileAsync = promisify(execFile);

export interface OpenAppInput {
  readonly projectDir: string;
  readonly bundlePath: string | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  /** Test seams for the replace-before-open probe (defaults: pgrep/CIM + tree kill). */
  readonly probe?: OpenAppProbeSeams | undefined;
  /** Budget for the replace-path pid-death wait (default 5000ms). */
  readonly stopWaitBudgetMs?: number | undefined;
}

/** Test seams over the live-instance probe (the real default shells out). */
export interface OpenAppProbeSeams {
  readonly findPids?: (projectDir: string, platform: NodeJS.Platform) => Promise<readonly number[]>;
  readonly killTree?: (pid: number) => Promise<unknown>;
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

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Live entry pids for one payload by argv identity: the entry is always
 * `node <projectDir>/main.mjs` (the carrier's opentray-launch.json vector and
 * the cold-start spawn both use the absolute script path), so matching the
 * script path is exact identity — never a name-based guess. POSIX uses
 * `pgrep -f`; Windows a bounded CIM CommandLine query (best effort — a probe
 * failure reports no live instances instead of guessing).
 */
const defaultFindEntryPids = async (
  projectDir: string,
  platform: NodeJS.Platform,
): Promise<readonly number[]> => {
  const scriptPath = join(projectDir, "main.mjs");
  const own = process.pid;
  if (platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${scriptPath.replaceAll("'", "''")}*' } | Select-Object -ExpandProperty ProcessId`,
        ],
        { timeout: 10_000, windowsHide: true },
      );
      return stdout
        .split(/\r?\n/u)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== own);
    } catch {
      return [];
    }
  }
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", scriptPath], { timeout: 5_000 });
    return stdout
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== own);
  } catch {
    // pgrep exits 1 on no match; any other failure means "no verified live".
    return [];
  }
};

/** Bounded wait for every stopped pid to actually exit (100ms cadence). */
const waitForExit = async (pids: readonly number[], budgetMs: number): Promise<boolean> => {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (!pids.some(isPidAlive)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
};

export interface StopLiveInstancesOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly probe?: OpenAppProbeSeams | undefined;
  /** Total budget for the post-kill pid-death wait (default 5000ms). */
  readonly waitBudgetMs?: number | undefined;
}

export interface StopLiveInstancesResult {
  readonly stoppedPids: readonly number[];
  /** True when a pid failed to exit within the wait budget. */
  readonly hung: boolean;
}

/**
 * Replace-semantics stop for one payload's live entry instances (Dev Launch
 * Law): probe by argv identity, terminate each tree, and wait bounded for the
 * pids (and behind them the broker session) to release before a new start may
 * claim the endpoint. A probe that finds nothing is a no-op.
 */
export const stopLiveAppInstances = async (
  projectDir: string,
  options: StopLiveInstancesOptions = {},
): Promise<StopLiveInstancesResult> => {
  const platform = options.platform ?? process.platform;
  const findPids = options.probe?.findPids ?? defaultFindEntryPids;
  const killTree = options.probe?.killTree ?? ((pid: number) => killProcessTree(pid, platform));
  const pids = [...new Set(await findPids(projectDir, platform))].filter(isPidAlive);
  if (pids.length === 0) {
    return { stoppedPids: [], hung: false };
  }
  for (const pid of pids) {
    await killTree(pid);
  }
  const exited = await waitForExit(pids, options.waitBudgetMs ?? 5_000);
  if (!exited) {
    return { stoppedPids: pids, hung: true };
  }
  // Small settle so the broker observes the client disconnect and closes the
  // session before the replacement start races the endpoint.
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  return { stoppedPids: pids, hung: false };
};

export const openMaterializedApp = async (input: OpenAppInput): Promise<OpenAppResult> => {
  const platform = input.platform ?? process.platform;
  // Replace first (P0): never race a live instance of this app for its broker
  // session. Applies to every launch vector below (bundle open + cold spawn).
  const replaced = await stopLiveAppInstances(input.projectDir, {
    platform,
    probe: input.probe,
    waitBudgetMs: input.stopWaitBudgetMs,
  });
  const replacedNote = replaced.stoppedPids.length === 0
    ? ""
    : `replaced live instance (pid ${replaced.stoppedPids.join(", ")})${replaced.hung ? " — WARNING: pid still alive after stop" : ""}; `;
  if (platform === "darwin") {
    const bundlePath =
      input.bundlePath ?? (await expectedBundleForProject(input.projectDir));
    if (bundlePath === undefined) {
      // No identity to derive a bundle from: cold-start through the entry.
      return withNote(spawnEntryCold(input.projectDir), replacedNote);
    }
    try {
      await stat(bundlePath);
    } catch {
      // Never launched → no materialized bundle yet: the entry's first run
      // creates it, after which Dock pinning becomes available.
      return withNote(spawnEntryCold(input.projectDir), replacedNote);
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
      return { ok: true, detail: `${replacedNote}opened ${bundlePath}` };
    }
    return {
      ok: false,
      detail: `${replacedNote}open ${bundlePath} failed with ${status ?? "spawn error"}`,
    };
  }
  return withNote(spawnEntryCold(input.projectDir), replacedNote);
};

const withNote = (result: OpenAppResult, note: string): OpenAppResult =>
  note === "" ? result : { ...result, detail: `${note}${result.detail}` };

/**
 * Platform-truthful pinning hint; makes no persistence claim before first
 * open. `locale` localizes the wizard/webui projection; the default keeps
 * direct core consumers (CLI) on their historical output.
 */
export const pinningHint = (
  platform: NodeJS.Platform = process.platform,
  locale: UiLocale = "zh-CN",
): string => {
  const messages = userMessages(locale);
  if (platform === "darwin") {
    return messages.pinHintDarwin;
  }
  if (platform === "win32") {
    return messages.pinHintWindows;
  }
  return messages.pinHintOther;
};
