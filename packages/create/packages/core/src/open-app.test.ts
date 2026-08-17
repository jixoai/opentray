import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { openMaterializedApp, pinningHint } from "./open-app";

describe("openMaterializedApp", () => {
  it("fails clearly on darwin without a bundle path", async () => {
    const result = await openMaterializedApp({
      projectDir: "/tmp/x",
      bundlePath: undefined,
      platform: "darwin",
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("bundle");
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
    expect(pinningHint("darwin")).toContain("Dock");
    const windows = pinningHint("win32");
    expect(windows).toContain("任务栏");
    expect(windows).toContain("尚未");
    expect(pinningHint("linux")).toContain("Linux");
  });
});
