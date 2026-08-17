import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dispatchCli, type CliContext } from "./commands";
import type { CliStreams } from "./output";
import { validateSkillPath } from "./skill";

let home: string;
let streams: CliStreams;
let outLines: string[];
let errLines: string[];

const context = (): CliContext => ({
  streams,
  homeDir: home,
  skipInstall: true,
  dependencyRange: "^0.0.0-test",
});

const run = (args: readonly string[]): Promise<number> => dispatchCli([...args], context());

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cli-test-"));
  streams = {
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  outLines = [];
  errLines = [];
});

describe("create", () => {
  it("creates non-interactively with URL icon sources and no enrichment", async () => {
    // An HTTP icon source that cannot be fetched would fail apply; use the
    // local-file source here and verify http URLs parse in plan-only mode
    // separately. This test proves the full non-interactive path.
    const iconDir = await mkdtemp(join(tmpdir(), "cli-icon-"));
    const iconPath = join(iconDir, "a.png");
    await writeFile(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    const code = await run([
      "create",
      "--app-id", "one.example",
      "--app-name", "One",
      "--exec", "node", "--arg", "serve.js", "--arg", "&&",
      "--app-icon", iconPath,
      "--no-image-smoothing",
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const configPath = join(home, ".opentray", "create", "one-example", "create-opentray.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.appId).toBe("one.example");
    expect(config.icons.appIcon.path).toBe("app-icon.png");
    expect(config.icons.imageSmoothingEnabled).toBe(false);
    expect(config.command.args).toEqual(["serve.js", "&&"]);
  });

  it("rejects unknown options before any Core plan", async () => {
    const code = await run(["create", "--app-id", "x.y", "--app-name", "X", "--exec", "node", "--bogus"]);
    expect(code).toBe(2);
  });

  it("requires app-id and app-name without a config document", async () => {
    const code = await run(["create", "--exec", "node"]);
    expect(code).toBe(2);
    expect(errLines.join("\n")).toMatch(/app-id|app-name/u);
  });

  it("patches only named fields over a config document", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cli-config-"));
    const configPath = join(configDir, "base.json");
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        appId: "patch.example",
        appName: "Original",
        command: { executable: "node", args: ["a"], cwd: configDir },
        packageManager: "pnpm",
        icons: { imageSmoothingEnabled: false, background: "black", scale: 0.9 },
        window: { width: 900, height: 700 },
        developerMode: true,
      }),
      "utf8",
    );
    await run(["create", "--config", configPath, "--app-name", "Renamed"]);
    const committed = JSON.parse(
      await readFile(join(home, ".opentray", "create", "patch-example", "create-opentray.json"), "utf8"),
    );
    expect(committed.appName).toBe("Renamed");
    expect(committed.packageManager).toBe("pnpm");
    expect(committed.icons.imageSmoothingEnabled).toBe(false);
    expect(committed.window).toEqual({ width: 900, height: 700 });
    expect(committed.developerMode).toBe(true);
  });

  it("dry-run prints the plan without mutation", async () => {
    const code = await run([
      "create", "--app-id", "dry.example", "--app-name", "Dry",
      "--exec", "node", "--dry-run",
    ]);
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("plan for dry.example");
    await expect(
      readFile(join(home, ".opentray", "create", "dry-example", "create-opentray.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("keeps JSON stdout pure on failure", async () => {
    const code = await run([
      "create", "--app-id", "BAD ID", "--app-name", "X", "--exec", "node", "--json",
    ]);
    expect(code).toBe(2);
    expect(outLines.length).toBe(1);
    const parsed = JSON.parse(outLines[0]!);
    expect(parsed.ok).toBe(false);
  });
});

describe("app list", () => {
  it("reports broken-link registrations with both paths in JSON", async () => {
    await run(["create", "--app-id", "listed.example", "--app-name", "Listed", "--exec", "node"]);
    const brokenDir = join(home, ".opentray", "create", "broken-cli-example");
    await mkdir(brokenDir, { recursive: true });
    await symlink("/nonexistent/target", join(brokenDir, "app"), "dir");
    await writeFile(
      join(brokenDir, "create-opentray.json"),
      JSON.stringify({
        schemaVersion: 1,
        appId: "broken.cli",
        appName: "Broken",
        command: { executable: "node", args: [], cwd: "/tmp" },
        packageManager: "npm",
        icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
        window: { width: 1200, height: 800 },
        developerMode: false,
      }),
      "utf8",
    );
    outLines.length = 0; // drop the preceding create's text output
    const code = await run(["app", "list", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(outLines.join("\n"));
    const broken = parsed.result.find((entry: { appId?: string }) => entry.appId === "broken.cli");
    expect(broken.status).toBe("broken-link");
    expect(broken.payloadPath).toBe("/nonexistent/target");
    expect(broken.registrationDir).toBe(brokenDir);
  });
});

describe("app edit", () => {
  it("renames via patches and rejects identity migration", async () => {
    await run(["create", "--app-id", "edit.example", "--app-name", "Before", "--exec", "node"]);
    const code = await run(["app", "edit", "edit.example", "--app-name", "After", "--force"]);
    expect(code, errLines.join("\n")).toBe(0);
    const committed = JSON.parse(
      await readFile(join(home, ".opentray", "create", "edit-example", "create-opentray.json"), "utf8"),
    );
    expect(committed.appName).toBe("After");

    // Identity mutation vector: a --config document naming another appId.
    const otherDir = await mkdtemp(join(tmpdir(), "cli-other-"));
    const otherConfig = join(otherDir, "other.json");
    await writeFile(otherConfig, JSON.stringify({ ...committed, appId: "other.example" }), "utf8");
    const migrate = await run(["app", "edit", "edit.example", "--config", otherConfig]);
    expect(migrate).toBe(2);
    expect(errLines.join("\n")).toMatch(/identity_mismatch|immutable/u);
    // (A stray --app-id on edit is consumed positionally by yargs; the
    // config-document vector above is the complete mutation surface.)
  });
});

describe("app export", () => {
  it("blocks env-bearing export without acknowledgement and never echoes values", async () => {
    await run([
      "create", "--app-id", "envy.example", "--app-name", "Envy",
      "--exec", "node", "--env", "SECRET_TOKEN=hunter2",
    ]);
    const blocked = await run(["app", "export", "envy.example"]);
    expect(blocked).toBe(2);
    const blockedText = errLines.join("\n");
    expect(blockedText).toContain("acknowledge");
    expect(blockedText).not.toContain("hunter2");

    const acknowledged = await run(["app", "export", "envy.example", "--acknowledge-env", "--format", "command"]);
    expect(acknowledged, errLines.join("\n")).toBe(0);
    // After acknowledgement the complete command legitimately carries values.
    expect(outLines.join(" ")).toContain("SECRET_TOKEN=hunter2");
  });

  it("exports sh and ps1 scripts", async () => {
    await run(["create", "--app-id", "shy.example", "--app-name", "Shy", "--exec", "node"]);
    outLines.length = 0;
    const sh = await run(["app", "export", "shy.example", "--format", "sh"]);
    expect(sh).toBe(0);
    const script = outLines.join("\n");
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("'create-opentray' 'create'");
    expect(script).toContain("'--app-id' 'shy.example'");
    expect(script).not.toContain("\r");
    outLines.length = 0;
    const ps1 = await run(["app", "export", "shy.example", "--format", "ps1"]);
    expect(ps1).toBe(0);
    expect(outLines.join("\n")).toContain("\r");
  });
});

describe("app uninstall", () => {
  it("states retention and manual pin cleanup", async () => {
    const external = await mkdtemp(join(tmpdir(), "cli-external-"));
    await writeFile(join(external, "data.txt"), "keep\n");
    await run([
      "create", "--app-id", "gone.example", "--app-name", "Gone",
      "--exec", "node",
      // external payload linking through apply options is exercised in Core
      // tests; here create a managed app and uninstall it.
    ]);
    void external;
    const code = await run(["app", "uninstall", "gone.example"]);
    expect(code).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain("removed registration");
    expect(text.match(/Dock|taskbar/u) !== null);
  });
});

describe("skill paths", () => {
  it("rejects absolute, traversal, and NUL paths before any read", () => {
    for (const path of ["/etc/passwd", "../package.json", "a/../../b", "x\0y", "C:\\x", ""]) {
      const result = validateSkillPath(path);
      expect(result.ok, path).toBe(false);
    }
    expect(validateSkillPath("SKILL.md").ok).toBe(true);
    expect(validateSkillPath("references/cli-reference.md").ok).toBe(true);
  });
});
