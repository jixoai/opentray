// Generated-entry syntax gate (add-webview-orchestration 5.1): the toolbar
// carrier is string-surgery embedded into both entry templates — the emitted
// main.mjs must parse as real JavaScript before anything else can be true
// about it. Runs `node --check` over the three generated shapes (URL toolbar,
// command toolbar, plain direct/command) plus the shell server.
// The second block (8.5) executes the carrier source itself against fakes
// and freezes the D24 loadState forwarding shape over the channel.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { toolbarCarrierSource } from "./toolbar-carrier";
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

describe("toolbar carrier loadState forwarding (D24, task 8.5)", () => {
  /** Materialize the carrier source as a real module and import it. The
   *  embedding templates supply `column`/`fixed`/`grow` beside the carrier
   *  (the carrier deliberately imports nothing) — stub them here. */
  const loadCarrier = async (): Promise<(shell: unknown, options: unknown) => Promise<unknown>> => {
    const dir = await mkdtemp(join(tmpdir(), "p85-carrier-"));
    const file = join(dir, "carrier.mjs");
    const prelude = "const column = (rows) => rows; const fixed = () => {}; const grow = () => {};\n";
    await writeFile(file, `${prelude}${toolbarCarrierSource()}\nexport { attachToolbarCarrier };\n`, "utf8");
    const module = await import(pathToFileURL(file).href);
    return module.attachToolbarCarrier;
  };

  it("forwards content loadState pushes verbatim as {kind:load-state} channel frames", async () => {
    const attachToolbarCarrier = await loadCarrier();
    const posts: unknown[] = [];
    const loadHandlers: ((event: Record<string, unknown>) => void)[] = [];
    const shell = {
      createWebview: async (spec: { id: string }) => ({
        onUrlChange: () => {},
        onTitleChange: () => {},
        onLoadState: (handler: (event: Record<string, unknown>) => void) => {
          if (spec.id === "content") loadHandlers.push(handler);
        },
        getUrl: async () => ({ url: "https://example.com/start", seq: 1 }),
        navigate: async () => {},
        back: async () => {},
        forward: async () => {},
      }),
      setLayout: async () => {},
      createMessageChannel: async () => ({
        post: async (payload: unknown) => {
          posts.push(payload);
        },
        onMessage: () => () => {},
      }),
      show: async () => {},
    };
    await attachToolbarCarrier(shell, {
      toolbarUrl: "http://127.0.0.1:1/toolbar.html",
      contentUrl: "https://example.com/start",
      titleFollows: false,
      log: async () => {},
    });
    // Seed push (get-url answer) has landed; loadState frames flow async.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(posts).toContainEqual({ kind: "url", url: "https://example.com/start" });
    expect(posts.filter((m) => (m as { kind: string }).kind === "load-state")).toEqual([]);

    // started without observed progress (Windows shape): exactly kind/phase/url.
    for (const handler of [...loadHandlers]) {
      handler({ phase: "started", url: "https://example.com/slow" });
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(posts).toContainEqual({ kind: "load-state", phase: "started", url: "https://example.com/slow" });

    // finished with progress, failed with errorCode: forwarded verbatim.
    for (const handler of [...loadHandlers]) {
      handler({ phase: "finished", url: "https://example.com/slow", progress: 1 });
      handler({ phase: "failed", url: "https://example.com/other", errorCode: -999 });
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(posts).toContainEqual({
      kind: "load-state",
      phase: "finished",
      url: "https://example.com/slow",
      progress: 1,
    });
    expect(posts).toContainEqual({
      kind: "load-state",
      phase: "failed",
      url: "https://example.com/other",
      errorCode: -999,
    });
  });
});
