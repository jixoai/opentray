import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { parseWizardCli } from "./bin";
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

describe("parseWizardCli", () => {
  it("parses flags and positional target", () => {
    const options = parseWizardCli(["my-app", "--no-open", "--pm", "pnpm", "--port", "4321", "--skip-install", "--force"]);
    expect(options).toEqual({
      open: false,
      port: 4321,
      pm: "pnpm",
      skipInstall: true,
      force: true,
      targetDir: "my-app",
    });
  });

  it("defaults to browser-open, no port, cwd target", () => {
    expect(parseWizardCli([])).toEqual({
      open: true,
      port: undefined,
      pm: undefined,
      skipInstall: false,
      force: false,
      targetDir: undefined,
    });
  });

  it("ignores invalid --pm and --port values", () => {
    const options = parseWizardCli(["--pm", "yarn", "--port", "not-a-number"]);
    expect(options.pm).toBeUndefined();
    expect(options.port).toBeUndefined();
  });
});
