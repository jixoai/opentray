// Extended CLI coverage (openspec change add-create-opentray-cli BDD gaps).
//
// Covers: root/web adapter parity, running-app edit gating, linked uninstall
// retention through the CLI, app copy snapshot re-commitment, edit field
// inheritance, data-URL icons, skill list/read against the real packaged
// tree, and stable exit-code categories.

import { spawn } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dispatchCli, type CliContext } from "./commands";
import type { CliStreams } from "./output";
import { readRuntimeRecord, writeRuntimeRecord } from "@create-opentray/core";
import { exitCodeFor } from "./output";

let home: string;
let outLines: string[];
let errLines: string[];

const streams: CliStreams = {
  out: (line) => outLines.push(line),
  err: (line) => errLines.push(line),
};

const context = (): CliContext => ({
  streams,
  homeDir: home,
  skipInstall: true,
  dependencyRange: "^0.0.0-test",
});

const run = (args: readonly string[]): Promise<number> => dispatchCli([...args], context());
const jsonOut = (): unknown => JSON.parse(outLines.join("\n"));

const configPath = (appId: string): string =>
  join(home, ".opentray", "create", appId.replace(/[^a-z0-9]+/giu, "-"), "create-opentray.json");

const minimalPng = (): Buffer => {
  const png = Buffer.alloc(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  return png;
};

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cli-ext-test-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  outLines = [];
  errLines = [];
});

describe("root and web dispatch", () => {
  it("dispatches the same WebUI adapter for bare root and explicit web", async () => {
    let adapterCalls = 0;
    const webContext = (): CliContext => ({
      ...context(),
      runWeb: async () => {
        adapterCalls += 1;
        return 0;
      },
    });
    // Bare root (no subcommand) → web adapter.
    const bare = await dispatchCli([], webContext());
    expect(bare).toBe(0);
    expect(adapterCalls).toBe(1);
    // Explicit web → the SAME adapter function, flags included.
    const explicit = await dispatchCli(["web"], webContext());
    expect(explicit).toBe(0);
    expect(adapterCalls).toBe(2);

    // Web server flags reach the adapter: --no-open negates, --port binds.
    let lastOptions: { port?: number; open: boolean } | undefined;
    const flagContext = (): CliContext => ({
      ...context(),
      runWeb: async (options) => {
        lastOptions = options;
        return 0;
      },
    });
    const flagged = await dispatchCli(["web", "--no-open", "--port", "4321"], flagContext());
    expect(flagged, errLines.join("\n")).toBe(0);
    expect(lastOptions).toEqual({ port: 4321, open: false });
  });

  it("rejects web-server flags on non-interactive commands", async () => {
    const code = await run([
      "create", "--app-id", "no.web", "--app-name", "X", "--exec", "node", "--port", "1234",
    ]);
    expect(code).toBe(2); // strict yargs: --port is not a create option
  });
});

describe("running-application gating", () => {
  it("blocks edit/uninstall of a live verified app with app_running and no mutation", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    expect(child.pid).toBeDefined();
    const startedAt = await import("@create-opentray/core").then((m) =>
      m.readProcessStartEpochMs(child.pid!),
    );
    await run(["create", "--app-id", "live.gate", "--app-name", "Live", "--exec", "node"]);
    const regDir = join(home, ".opentray", "create", "live-gate");
    await writeRuntimeRecord(regDir, {
      pid: child.pid!,
      token: "t".repeat(32),
      startedAt: startedAt ?? null,
      launchedAt: Date.now(),
    });
    const before = await readFile(configPath("live.gate"), "utf8");

    const edit = await run(["app", "edit", "live.gate", "--app-name", "Blocked", "--force"]);
    expect(edit).toBe(exitCodeFor("app_running"));
    expect(await readFile(configPath("live.gate"), "utf8")).toBe(before); // unmutated

    const uninstall = await run(["app", "uninstall", "live.gate"]);
    expect(uninstall).toBe(exitCodeFor("app_running"));
    expect(await readFile(configPath("live.gate"), "utf8")).toBe(before);

    // --stop-running unblocks: edit proceeds and the child is terminated.
    const stopped = await run(["app", "edit", "live.gate", "--app-name", "Unblocked", "--force", "--stop-running"]);
    expect(stopped, errLines.join("\n")).toBe(0);
    const after = JSON.parse(await readFile(configPath("live.gate"), "utf8"));
    expect(after.appName).toBe("Unblocked");
    const record = await readRuntimeRecord(regDir);
    expect(record).toBeUndefined(); // ownership record cleared
    child.kill("SIGKILL");
  });
});

describe("linked uninstall through the CLI", () => {
  it("retains the external target, states retention explicitly, and names manual pins", async () => {
    const external = await mkdtemp(join(tmpdir(), "cli-ext-external-"));
    await writeFile(join(external, "data.txt"), "precious\n");
    await run(["create", "--app-id", "linked.retention", "--app-name", "Linked", "--exec", "node"]);
    const regDir = join(home, ".opentray", "create", "linked-retention");
    await rm(join(regDir, "app"), { recursive: true, force: true });
    await symlink(external, join(regDir, "app"), "dir");

    const code = await run(["app", "uninstall", "linked.retention"]);
    expect(code).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain(`removed link: ${external}`);
    expect(text).toContain(`external target retained: ${external}`);
    expect(text).toMatch(/Dock.*taskbar|taskbar.*Dock/us);
    expect(await readFile(join(external, "data.txt"), "utf8")).toBe("precious\n");
  });

  it("purges the external target only under explicit --purge-target", async () => {
    const external = await mkdtemp(join(tmpdir(), "cli-ext-purge-"));
    await run(["create", "--app-id", "purge.flag", "--app-name", "Purge", "--exec", "node"]);
    const regDir = join(home, ".opentray", "create", "purge-flag");
    await rm(join(regDir, "app"), { recursive: true, force: true });
    await symlink(external, join(regDir, "app"), "dir");

    const code = await run(["app", "uninstall", "purge.flag", "--purge-target"]);
    expect(code).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain(`external target DELETED: ${external}`);
    await expect(lstat(external)).rejects.toThrow();
  });
});

describe("app copy", () => {
  it("creates a new identity from an existing registration and re-commits snapshots", async () => {
    const iconDir = await mkdtemp(join(tmpdir(), "cli-ext-icon-"));
    const iconPath = join(iconDir, "icon.png");
    await writeFile(iconPath, minimalPng());
    await run([
      "create", "--app-id", "copy.source", "--app-name", "Source", "--exec", "node",
      "--arg", "one", "--app-icon", iconPath, "--env", "K=v",
    ]);
    const code = await run(["app", "copy", "copy.source", "--new-app-id", "copy.dest", "--app-name", "Destination"]);
    expect(code, errLines.join("\n")).toBe(0);
    expect(outLines.join("\n")).toContain("copied to");

    const copyConfig = JSON.parse(await readFile(configPath("copy.dest"), "utf8"));
    expect(copyConfig.appId).toBe("copy.dest");
    expect(copyConfig.appName).toBe("Destination");
    expect(copyConfig.command.args).toEqual(["one"]);       // vector carried over
    expect(copyConfig.command.env).toEqual({ K: vPlaceholder() }); // env carried over
    // Snapshot re-committed under the NEW registration directory.
    const copyDir = join(home, ".opentray", "create", "copy-dest");
    const entries = await readdir(copyDir);
    expect(entries).toContain("app-icon.png");
    // The source registration is untouched.
    const sourceConfig = JSON.parse(await readFile(configPath("copy.source"), "utf8"));
    expect(sourceConfig.appId).toBe("copy.source");
  });
});

const vPlaceholder = (): string => "v";

describe("app edit field inheritance", () => {
  it("changes only the named field and never resets omitted ones", async () => {
    const iconDir = await mkdtemp(join(tmpdir(), "cli-ext-icon2-"));
    const iconPath = join(iconDir, "icon.png");
    await writeFile(iconPath, minimalPng());
    await run([
      "create", "--app-id", "inherit.all", "--app-name", "Before", "--exec", "node",
      "--arg", "a", "--arg", "b", "--env", "TOKEN=secret",
      "--app-icon", iconPath, "--no-image-smoothing", "--developer-mode",
      "--window", "900x600", "--icon-background", "black", "--icon-scale", "0.9",
    ]);
    const code = await run(["app", "edit", "inherit.all", "--app-name", "After", "--force"]);
    expect(code, errLines.join("\n")).toBe(0);
    const after = JSON.parse(await readFile(configPath("inherit.all"), "utf8"));
    expect(after.appName).toBe("After");                     // the one changed field
    expect(after.command.args).toEqual(["a", "b"]);          // vector preserved
    expect(after.command.env).toEqual({ TOKEN: "secret" });  // env preserved
    expect(after.icons.imageSmoothingEnabled).toBe(false);   // icon intent preserved
    expect(after.icons.background).toBe("black");
    expect(after.icons.scale).toBe(0.9);
    expect(after.developerMode).toBe(true);
    expect(after.window).toEqual({ width: 900, height: 600 });
  });
});

describe("icon input modes", () => {
  it("accepts a data-URL app icon and commits a validated snapshot", async () => {
    const dataUrl = `data:image/png;base64,${minimalPng().toString("base64")}`;
    const code = await run([
      "create", "--app-id", "data.icon", "--app-name", "Data", "--exec", "node",
      "--app-icon", dataUrl,
    ]);
    expect(code, errLines.join("\n")).toBe(0);
    const config = JSON.parse(await readFile(configPath("data.icon"), "utf8"));
    expect(config.icons.appIcon.path).toBe("app-icon.png");
    expect(config.icons.appIcon.format).toBe("png");
    expect(config.icons.appIcon.source.kind).toBe("data");
    const committed = await readFile(join(home, ".opentray", "create", "data-icon", "app-icon.png"));
    expect(committed.subarray(0, 8)).toEqual(minimalPng().subarray(0, 8));
  });

  it("rejects non-image data URLs before any registration write", async () => {
    const code = await run([
      "create", "--app-id", "bad.data", "--app-name", "Bad", "--exec", "node",
      "--app-icon", "data:text/plain;base64,aGk=",
    ]);
    expect(code).toBe(exitCodeFor("resource_invalid"));
    await expect(readFile(configPath("bad.data"), "utf8")).rejects.toThrow();
  });
});

describe("skill commands against the packaged tree", () => {
  it("reads SKILL.md by default, lists entries, and reads nested files", async () => {
    const read = await run(["skill"]);
    expect(read).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain("# create-opentray");
    expect(text).toContain("## Non-interactive creation");

    outLines.length = 0;
    const list = await run(["skill", "list"]);
    expect(list).toBe(0);
    const entries = outLines.join("\n");
    expect(entries).toContain("- SKILL.md");
    expect(entries).toContain("d references");
    expect(entries).toContain("- references/cli-reference.md");
    expect(entries).toContain("- references/how-it-works.md");
    expect(entries).not.toContain("\\"); // separators normalized to /

    outLines.length = 0;
    const nested = await run(["skill", "read", "references/how-it-works.md"]);
    expect(nested).toBe(0);
    expect(outLines.join("\n")).toContain("# How create-opentray works");
  });

  it("rejects Windows-style separator escapes and absolute drives before any read", async () => {
    for (const path of [
      "..\\..\\package.json",           // upward traversal via backslashes
      "references\\..\\..\\package.json", // traversal after a valid prefix
      "C:\\x\\SKILL.md",                 // drive-absolute
      "\\\\server\\share",               // UNC-absolute
    ]) {
      const code = await run(["skill", "read", path]);
      expect(code, path).toBe(exitCodeFor("path_escape"));
    }
  });

  it("reports missing files and directory/file mismatches distinctly", async () => {
    const missing = await run(["skill", "read", "references/does-not-exist.md"]);
    expect(missing).toBe(exitCodeFor("not_found"));
    const asDir = await run(["skill", "read", "references"]);
    expect(asDir).toBe(exitCodeFor("not_found")); // directory is not a readable file
  });
});

describe("exit-code categories", () => {
  it("maps every typed failure family to a stable distinct code", () => {
    expect(exitCodeFor("invalid_config")).toBe(2);
    expect(exitCodeFor("env_ack_required")).toBe(2);
    expect(exitCodeFor("not_found")).toBe(4);
    expect(exitCodeFor("ownership_unverified")).toBe(5);
    expect(exitCodeFor("app_running")).toBe(6);
    expect(exitCodeFor("pid_reused")).toBe(7);
    expect(exitCodeFor("resource_invalid")).toBe(8);
    expect(exitCodeFor("path_escape")).toBe(9);
    expect(exitCodeFor("link_unsupported")).toBe(10);
    expect(exitCodeFor("internal")).toBe(1);
  });
});

describe("plan visibility", () => {
  it("dry-run lists every planned effect without touching the registry", async () => {
    // A no-skipInstall context: dry-run only PLANS install/launch, never runs them.
    const runNoSkip = (args: readonly string[]): Promise<number> =>
      dispatchCli([...args], { ...context(), skipInstall: false });
    const code = await runNoSkip([
      "create", "--app-id", "plan.effects", "--app-name", "Planned", "--exec", "node",
      "--arg", "x", "--env", "A=1", "--no-image-smoothing", "--dry-run",
    ]);
    expect(code).toBe(0);
    const text = outLines.join("\n");
    expect(text).toContain("+ registration");
    expect(text).toContain("~ config");
    expect(text).toContain("install dependencies");
    // D1: apply never launches the app — install is the final planned effect.
    expect(text).not.toContain("launch app");
    expect(text).toContain("env entries present: export requires acknowledgement");
    await expect(readFile(configPath("plan.effects"), "utf8")).rejects.toThrow();
  });
});

describe("export regressions", () => {
  it("supports the -o alias for --output (documented in the README)", async () => {
    await run(["create", "--app-id", "alias.out", "--app-name", "Alias", "--exec", "node"]);
    const outDir = await mkdtemp(join(tmpdir(), "cli-ext-out-"));
    const scriptPath = join(outDir, "make.sh");
    const code = await run(["app", "export", "alias.out", "--format", "sh", "-o", scriptPath]);
    expect(code, errLines.join("\n")).toBe(0);
    expect(outLines.join("\n")).toContain(`wrote ${scriptPath}`);
    const content = await readFile(scriptPath, "utf8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("'--app-id' 'alias.out'");
  });

  it("rejects web flags on export that only exist on web", async () => {
    await run(["create", "--app-id", "flag.reject", "--app-name", "F", "--exec", "node"]);
    const code = await run(["app", "export", "flag.reject", "--no-open"]);
    expect(code).toBe(2);
  });
});
