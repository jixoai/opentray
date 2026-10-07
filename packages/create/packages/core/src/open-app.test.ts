import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  observeEntryStartup,
  openMaterializedApp,
  pinningHint,
  stopLiveAppInstances,
} from "./open-app";

describe("openMaterializedApp", () => {
  it("cold-starts the entry on darwin when no bundle exists", async () => {
    // D1: generation never first-launches, so the first open must be able to
    // spawn the entry before any Darwin bundle is materialized.
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: undefined,
      platform: "darwin",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("pid");
    // The replace probe ran and found no live instance for this directory.
    expect(result.detail).not.toContain("replaced");
  });

  it("cold-starts through the entry when the expected bundle is missing", async () => {
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: join(tmpdir(), "no-such-bundle.app"),
      platform: "darwin",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("pid");
  });

  it("reports a detached launch on linux", async () => {
    // Spawn against an existing directory so the child starts (and stays
    // detached) instead of tripping an unhandled ENOENT.
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: undefined,
      platform: "linux",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("pid");
  });

  it("cold-starts the entry when the bundle exists WITHOUT its launch descriptor (2026-10-07 deadlock)", async () => {
    // A first open whose entry died mid-handshake leaves a materialized
    // bundle with no opentray-launch.json — carrier-opening it would
    // flash-quit forever. Bundle presence alone must NOT route to `open`:
    // the open falls back to a detached entry cold start (which writes the
    // descriptor on its successful handshake).
    const dir = await mkdtemp(join(tmpdir(), "open-descriptor-missing-"));
    await mkdir(join(dir, "Stub.app"), { recursive: true });
    const result = await openMaterializedApp({
      projectDir: dir,
      bundlePath: join(dir, "Stub.app"),
      platform: "darwin",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("no launch descriptor");
    expect(result.detail).toContain("pid");
  });
});

describe("observeEntryStartup (first-open deadlock observability)", () => {
  it("reports 'running' for a live entry within the budget", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 1500)"], {
      stdio: "ignore",
    });
    const pid = child.pid as number;
    const observation = await observeEntryStartup({
      projectDir: await mkdtemp(join(tmpdir(), "observe-running-")),
      pid,
      budgetMs: 500,
    });
    expect(observation.outcome).toBe("running");
    expect(observation.pid).toBe(pid);
  });

  it("reports 'exited' with a no-app.log explanation when the entry dies pre-milestone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observe-exited-"));
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    const observation = await observeEntryStartup({ projectDir: dir, pid, budgetMs: 2_000 });
    expect(observation.outcome).toBe("exited");
    expect(observation.logTail).toBeUndefined();
  });

  it("reports 'failed' with the app.log tail when the startup-failure marker is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "observe-failed-"));
    await writeFile(
      join(dir, "app.log"),
      '{"step":"entryStart","status":"ok"}\n[create-opentray] startup failed: Error: kaboom\n',
      "utf8",
    );
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      const observation = await observeEntryStartup({
        projectDir: dir,
        pid: child.pid as number,
        budgetMs: 2_000,
      });
      expect(observation.outcome).toBe("failed");
      expect(observation.logTail).toContain("kaboom");
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("surfaces an observed startup failure through openMaterializedApp (webui shape)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-observe-failed-"));
    await writeFile(
      join(dir, "main.mjs"),
      [
        'import { appendFileSync } from "node:fs";',
        'appendFileSync(new URL("./app.log", import.meta.url), "entryStart ok\\n");',
        'appendFileSync(new URL("./app.log", import.meta.url), "[create-opentray] startup failed: Error: kaboom\\n");',
        "process.exit(1);",
      ].join("\n"),
      "utf8",
    );
    const result = await openMaterializedApp({
      projectDir: dir,
      bundlePath: undefined,
      platform: "linux",
      observeMs: 4_000,
    });
    expect(result.ok).toBe(false);
    expect(result.observed).toBe("failed");
    expect(result.detail).toContain("FAILED during startup");
    expect(result.detail).toContain("kaboom");
  });

  it("surfaces an observed pre-milestone exit through openMaterializedApp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-observe-exited-"));
    await writeFile(join(dir, "main.mjs"), "process.exit(3);\n", "utf8");
    const result = await openMaterializedApp({
      projectDir: dir,
      bundlePath: undefined,
      platform: "linux",
      observeMs: 4_000,
    });
    expect(result.ok).toBe(false);
    expect(result.observed).toBe("exited");
    expect(result.detail).toContain("exited before finishing startup");
    expect(result.detail).toContain("without writing app.log");
  });

  it("keeps ok:true for a still-starting entry (honest non-claim)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-observe-running-"));
    await writeFile(
      join(dir, "main.mjs"),
      "setTimeout(() => process.exit(0), 1500);\n",
      "utf8",
    );
    const result = await openMaterializedApp({
      projectDir: dir,
      bundlePath: undefined,
      platform: "linux",
      observeMs: 500,
    });
    expect(result.ok).toBe(true);
    expect(result.observed).toBe("running");
    expect(result.detail).toContain("entry is running");
  });
});

describe("open replace-before-open (P0: no dual-instance broker race)", () => {
  it("stops a probed live instance before launching and reports the replacement", async () => {
    // A real child stands in for the live instance (the alive-filter must not
    // drop it); the kill seam terminates it for real, so the death wait
    // observes the exit and the launch detail carries the replacement.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const pid = child.pid as number;
    const killed: number[] = [];
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: undefined,
      platform: "linux",
      stopWaitBudgetMs: 8_000,
      probe: {
        findPids: async () => [pid],
        killTree: async (target) => {
          killed.push(target);
          process.kill(target, "SIGKILL");
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(killed).toEqual([pid]);
    expect(result.detail).toContain(`replaced live instance (pid ${pid})`);
    expect(result.detail).not.toContain("WARNING");
  });

  it("kills a REAL live entry tree and waits for its death before launching", async () => {
    // A real child standing in for the Dock-resurrected entry: the default
    // kill (killProcessTree) must terminate it and the wait must observe the
    // exit before the launch result returns.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    expect(child.pid).toBeDefined();
    const pid = child.pid as number;
    const stopped = await stopLiveAppInstances(join(tmpdir(), "open-replace-real"), {
      platform: process.platform,
      probe: { findPids: async () => [pid] },
      waitBudgetMs: 8_000,
    });
    expect(stopped.stoppedPids).toEqual([pid]);
    expect(stopped.hung).toBe(false);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });

  it("flags a hung instance instead of pretending the endpoint is free", async () => {
    // A pid that ignores termination (this test process is a safe stand-in —
    // the kill is a seam no-op) surfaces `hung` so the detail warns.
    const stopped = await stopLiveAppInstances(join(tmpdir(), "open-replace-hung"), {
      platform: process.platform,
      probe: {
        findPids: async () => [process.pid],
        killTree: async () => {
          /* no-op: the "entry" never dies */
        },
      },
      waitBudgetMs: 150,
    });
    expect(stopped.stoppedPids).toEqual([process.pid]);
    expect(stopped.hung).toBe(true);
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: undefined,
      platform: "linux",
      stopWaitBudgetMs: 150,
      probe: {
        findPids: async () => [process.pid],
        killTree: async () => {
          /* no-op */
        },
      },
    });
    expect(result.detail).toContain("WARNING");
  });

  it("treats a dead probe result as no replacement (stale pids never block an open)", async () => {
    const killed: number[] = [];
    const result = await openMaterializedApp({
      projectDir: tmpdir(),
      bundlePath: undefined,
      platform: "linux",
      probe: {
        findPids: async () => [99_999],
        killTree: async (pid) => {
          killed.push(pid);
        },
      },
    });
    // A pid that is not alive is filtered before any kill: no replacement
    // note, no kill, the open proceeds.
    expect(killed).toEqual([]);
    expect(result.detail).not.toContain("replaced");
    expect(result.ok).toBe(true);
  });
});

describe("pinningHint", () => {
  it("is platform-specific and never claims Windows shortcuts", () => {
    const darwin = pinningHint("darwin");
    expect(darwin).toContain("Dock");
    // No bundle exists at generation time: the hint defers pinning to after
    // the first open (D1).
    expect(darwin).toContain("首次打开");
    const windows = pinningHint("win32");
    expect(windows).toContain("任务栏");
    expect(windows).toContain("尚未");
    expect(pinningHint("linux")).toContain("Linux");
  });
});
