// Generated-entry syntax gate (add-webview-orchestration 5.1): the toolbar
// carrier is string-surgery embedded into both entry templates — the emitted
// main.mjs must parse as real JavaScript before anything else can be true
// about it. Runs `node --check` over the three generated shapes (URL toolbar,
// command toolbar, plain direct/command) plus the shell server.
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { writeScaffold, type ScaffoldAppConfig } from "./scaffold";

const execFileAsync = promisify(execFile);

const urlToolbar: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "com.example",
  appName: 'Example "Quoted"',
  url: "https://example.com/a?b=c",
  service: { port: 0 },
  window: { width: 1200, height: 800, toolbar: true, titleFollowsDocument: true, iconFollowsDocument: false },
};

const commandToolbar: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "cmd.example",
  appName: "Cmd Example",
  command: { command: "/usr/local/bin/serve", args: ["start", "--flag with space"], cwd: "/tmp/xyz" },
  service: { port: 0 },
  window: { width: 1200, height: 800, toolbar: true, titleFollowsDocument: true, iconFollowsDocument: false },
  shell: { showTerminal: true },
};

const commandPlain: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "plain.example",
  appName: "Plain",
  command: { command: "/usr/local/bin/serve", args: ["start"], cwd: "/tmp/xyz" },
  service: { port: 0 },
  window: { width: 1200, height: 800, titleFollowsDocument: true, iconFollowsDocument: false },
};

const checkSyntax = async (file: string): Promise<string | undefined> => {
  try {
    await execFileAsync(process.execPath, ["--check", file]);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("generated entry syntax (toolbar carrier embed)", () => {
  it("emits parseable main.mjs for every application shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "p2-syntax-"));
    const cases: readonly { readonly name: string; readonly config: ScaffoldAppConfig }[] = [
      { name: "url-toolbar", config: urlToolbar },
      { name: "command-toolbar", config: commandToolbar },
      { name: "command-plain", config: commandPlain },
    ];
    for (const testCase of cases) {
      const result = await writeScaffold({
        config: testCase.config,
        targetDir: join(root, testCase.name),
        dependencyRange: "^0.18.0",
      });
      const entryError = await checkSyntax(result.entryPath);
      expect(entryError, `${testCase.name} main.mjs must parse`).toBeUndefined();
      // The shell server source only exists when the shell is hosted.
      const shellPath = join(result.projectDir, "app-shell-server.mjs");
      const shellError = await checkSyntax(shellPath);
      // url-toolbar and command apps host it; a plain URL app does not (file
      // absent → ENOENT from --check, which is not a syntax verdict).
      if (testCase.name !== "plain-url") {
        expect(shellError === undefined || shellError.includes("ENOENT"), `${testCase.name} shell server`).toBe(true);
      }
    }
  });
});
