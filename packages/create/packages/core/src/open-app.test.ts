import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openMaterializedApp, pinningHint, stopLiveAppInstances } from "./open-app";

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
