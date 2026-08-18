import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openMaterializedApp, pinningHint } from "./open-app";

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
