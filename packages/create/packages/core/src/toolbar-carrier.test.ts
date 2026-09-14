// Generated-entry syntax gate (add-webview-orchestration 5.1): the toolbar
// carrier is string-surgery embedded into both entry templates — the emitted
// main.mjs must parse as real JavaScript before anything else can be true
// about it. Runs `node --check` over the three generated shapes (URL toolbar,
// command toolbar, plain direct/command) plus the shell server.
// The second block (8.5) executes the carrier source itself against fakes
// and freezes the D24 loadState forwarding shape over the channel.
// The third block (P1-3, 2026-09-14 walkthrough) freezes the channel
// self-heal contract: debounced rebuild on close, command-surface reinstall,
// address-bar re-seed, and never a rebuild after stop().
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

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

// harden-lifecycle-ownership D5: the direct URL entry embeds the same
// un-swallowed showWindow gate without the shell/carrier wiring — it must
// parse like every other emitted shape.
const urlDirect: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "direct.example",
  appName: "Direct Example",
  url: "https://example.com/direct",
  service: { port: 0 },
  window: { width: 1000, height: 700, titleFollowsDocument: true, iconFollowsDocument: false },
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
    const cases: readonly {
      readonly name: string;
      readonly config: ScaffoldAppConfig;
      /** URL direct apps host no shell server; every other shape does. */
      readonly hostsShell: boolean;
    }[] = [
      { name: "url-toolbar", config: urlToolbar, hostsShell: true },
      { name: "url-direct", config: urlDirect, hostsShell: false },
      { name: "command-toolbar", config: commandToolbar, hostsShell: true },
      { name: "command-plain", config: commandPlain, hostsShell: true },
    ];
    for (const testCase of cases) {
      const result = await writeScaffold({
        config: testCase.config,
        targetDir: join(root, testCase.name),
        dependencyRange: "^0.18.0",
      });
      const entryError = await checkSyntax(result.entryPath);
      expect(entryError, `${testCase.name} main.mjs must parse`).toBeUndefined();
      // The shell server source only exists when the shell is hosted; a
      // missing file fails --check with MODULE_NOT_FOUND, which is not a
      // syntax verdict for the shapes that never host it.
      const shellPath = join(result.projectDir, "app-shell-server.mjs");
      const shellError = await checkSyntax(shellPath);
      if (testCase.hostsShell) {
        expect(shellError, `${testCase.name} shell server must parse`).toBeUndefined();
      } else {
        expect(shellError, `${testCase.name} must not host a shell server`).toContain(
          "Cannot find module",
        );
      }
    }
  });
});

/** Materialize the carrier source as a real module and import it. The
 *  embedding templates supply `column`/`fixed`/`grow` beside the carrier
 *  (the carrier deliberately imports nothing) — stub them here. */
const loadCarrier = async (): Promise<{
  attachToolbarCarrier: (
    shell: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ content: unknown; stop: () => void }>;
}> => {
  const dir = await mkdtemp(join(tmpdir(), "p85-carrier-"));
  const file = join(dir, "carrier.mjs");
  const prelude = "const column = (rows) => rows; const fixed = () => {}; const grow = () => {};\n";
  await writeFile(file, `${prelude}${toolbarCarrierSource()}\nexport { attachToolbarCarrier };\n`, "utf8");
  const module = await import(pathToFileURL(file).href);
  return module;
};

describe("toolbar carrier loadState forwarding (D24, task 8.5)", () => {
  it("forwards content loadState pushes verbatim as {kind:load-state} channel frames", async () => {
    const { attachToolbarCarrier } = await loadCarrier();
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
        onClose: () => () => {},
        destroy: async () => {},
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

describe("toolbar carrier channel self-heal (P1-3)", () => {
  /** Fake shell whose message channels are recorded endpoints: each
   *  createMessageChannel call mints a new endpoint that records posts,
   *  captures its single onMessage/onClose handler, and records destroy. */
  const mount = () => {
    const endpoints: {
      posts: unknown[];
      messageHandler: ((payload: unknown) => void) | null;
      closeHandler: ((notice: unknown) => void) | null;
      destroyed: boolean;
    }[] = [];
    const contentCommands: { navigate: string[]; back: number; forward: number } = {
      navigate: [],
      back: 0,
      forward: 0,
    };
    const log: string[] = [];
    const shell = {
      createWebview: async (spec: { id: string }) => ({
        onUrlChange: () => {},
        onTitleChange: () => {},
        onLoadState: () => {},
        getUrl: async () => ({ url: `https://example.com/${endpoints.length}`, seq: 1 }),
        navigate: async (url: string) => {
          if (spec.id === "content") contentCommands.navigate.push(url);
        },
        back: async () => {
          contentCommands.back += 1;
        },
        forward: async () => {
          contentCommands.forward += 1;
        },
      }),
      setLayout: async () => {},
      createMessageChannel: vi.fn(async () => {
        const endpoint = {
          posts: [] as unknown[],
          messageHandler: null as ((payload: unknown) => void) | null,
          closeHandler: null as ((notice: unknown) => void) | null,
          destroyed: false,
        };
        endpoints.push(endpoint);
        return {
          post: async (payload: unknown) => {
            endpoint.posts.push(payload);
          },
          onMessage: (handler: (payload: unknown) => void) => {
            endpoint.messageHandler = handler;
            return () => {};
          },
          onClose: (handler: (notice: unknown) => void) => {
            endpoint.closeHandler = handler;
            return () => {};
          },
          destroy: async () => {
            endpoint.destroyed = true;
          },
        };
      }),
      show: async () => {},
    };
    return { shell, endpoints, contentCommands, log };
  };

  it("rebuilds after a debounced close: new channel, reinstalled surface, re-seeded address bar, old tombstone destroyed", async () => {
    vi.useFakeTimers();
    try {
      const { attachToolbarCarrier } = await loadCarrier();
      const { shell, endpoints, contentCommands } = mount();
      const carrier = await attachToolbarCarrier(shell, {
        toolbarUrl: "http://127.0.0.1:1/toolbar.html",
        contentUrl: "https://example.com/start",
        titleFollows: false,
        log: async (message: string) => message,
      });
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(1);
      // Seed landed on the first channel (the getUrl fake reports the live
      // endpoint count — 1 right after the first channel was minted).
      await vi.advanceTimersByTimeAsync(0);
      expect(endpoints[0]!.posts).toContainEqual({ kind: "url", url: "https://example.com/1" });

      // A document death (reload) closes the current channel.
      endpoints[0]!.closeHandler!({ reason: "document_navigated" });
      // Debounce: no rebuild before the window elapses.
      await vi.advanceTimersByTimeAsync(150);
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(2);
      // Old endpoint's state was destroyed (tombstone cleanup).
      expect(endpoints[0]!.destroyed).toBe(true);
      // The rebuilt channel re-seeded the address bar...
      await vi.advanceTimersByTimeAsync(0);
      expect(endpoints[1]!.posts).toContainEqual({ kind: "url", url: "https://example.com/2" });
      // ...and got the full command surface reinstalled.
      expect(endpoints[1]!.messageHandler).not.toBeNull();
      endpoints[1]!.messageHandler!({ kind: "navigate", url: "https://example.com/next" });
      await vi.advanceTimersByTimeAsync(0);
      expect(contentCommands.navigate).toContain("https://example.com/next");

      carrier.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses a close burst into exactly one rebuild", async () => {
    vi.useFakeTimers();
    try {
      const { attachToolbarCarrier } = await loadCarrier();
      const { shell, endpoints } = mount();
      const carrier = await attachToolbarCarrier(shell, {
        toolbarUrl: "http://127.0.0.1:1/toolbar.html",
        contentUrl: "https://example.com/start",
        titleFollows: false,
        log: async (message: string) => message,
      });
      await vi.advanceTimersByTimeAsync(0);
      endpoints[0]!.closeHandler!({ reason: "document_navigated" });
      endpoints[0]!.closeHandler!({ reason: "document_navigated" });
      await vi.advanceTimersByTimeAsync(50);
      endpoints[0]!.closeHandler!({ reason: "queue_overflow" });
      await vi.advanceTimersByTimeAsync(500);
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(2);

      carrier.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never rebuilds after stop() — teardown closes stay final", async () => {
    vi.useFakeTimers();
    try {
      const { attachToolbarCarrier } = await loadCarrier();
      const { shell, endpoints } = mount();
      const carrier = await attachToolbarCarrier(shell, {
        toolbarUrl: "http://127.0.0.1:1/toolbar.html",
        contentUrl: "https://example.com/start",
        titleFollows: false,
        log: async (message: string) => message,
      });
      await vi.advanceTimersByTimeAsync(0);
      carrier.stop();
      // Window teardown closes the channel AFTER stop(): no rebuild, ever.
      endpoints[0]!.closeHandler!({ reason: "window_destroyed" });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() cancels an already-armed rebuild timer", async () => {
    vi.useFakeTimers();
    try {
      const { attachToolbarCarrier } = await loadCarrier();
      const { shell, endpoints } = mount();
      const carrier = await attachToolbarCarrier(shell, {
        toolbarUrl: "http://127.0.0.1:1/toolbar.html",
        contentUrl: "https://example.com/start",
        titleFollows: false,
        log: async (message: string) => message,
      });
      await vi.advanceTimersByTimeAsync(0);
      // Close arms the timer, then teardown stops the carrier mid-window.
      endpoints[0]!.closeHandler!({ reason: "document_navigated" });
      carrier.stop();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(shell.createMessageChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
