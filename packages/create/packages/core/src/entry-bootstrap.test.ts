// harden-lifecycle-ownership D5 (trace: generated-app-entry MODIFIED "Entry
// startup failures SHALL persist to app.log"): the generated entries must not
// swallow the initial window.show() and must leave one structured milestone
// record per carrier bootstrap step in app.log, so any later failure is
// attributable to a specific step without on-site archaeology (plan §5 D5,
// F7 evidence). Three layers:
// 1. carrier-level: milestone records in order + failed-step abort;
// 2. executed URL toolbar entry (fake opentray/ext-webview modules): healthy
//    narrative + show-failure abort, real app.log on disk;
// 3. source-level isomorphism: both templates wire the same milestones.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { toolbarCarrierSource } from "./toolbar-carrier";
import { writeScaffold, type ScaffoldAppConfig } from "./scaffold";

const urlToolbar: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "bootstrap.example",
  appName: "Bootstrap Example",
  url: "https://example.com/a?b=c",
  service: { port: 0 },
  window: {
    width: 1200,
    height: 800,
    toolbar: true,
    titleFollowsDocument: true,
    iconFollowsDocument: false,
  },
};

const commandToolbar: ScaffoldAppConfig = {
  schemaVersion: 1,
  appId: "cmdbootstrap.example",
  appName: "Cmd Bootstrap",
  command: { command: "/usr/local/bin/serve", args: ["start"], cwd: "/tmp/xyz" },
  service: { port: 0 },
  window: {
    width: 1200,
    height: 800,
    toolbar: true,
    titleFollowsDocument: true,
    iconFollowsDocument: false,
  },
  shell: { showTerminal: false },
};

const roots: string[] = [];

const remember = (root: string): string => {
  roots.push(root);
  return root;
};

const loadCarrier = async (): Promise<{
  attachToolbarCarrier: (
    shell: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<{ content: unknown; stop: () => void }>;
}> => {
  const dir = await mkdtemp(join(tmpdir(), "d5-carrier-"));
  remember(dir);
  const file = join(dir, "carrier.mjs");
  const prelude = "const column = (rows) => rows; const fixed = () => {}; const grow = () => {};\n";
  await writeFile(file, `${prelude}${toolbarCarrierSource()}\nexport { attachToolbarCarrier };\n`, "utf8");
  return import(pathToFileURL(file).href);
};

describe("toolbar carrier bootstrap milestones (D5)", () => {
  const mountShell = (failToolbarWebview = false) => {
    const calls: string[] = [];
    const shell = {
      createWebview: async (spec: { id: string }) => {
        calls.push(`createWebview:${spec.id}`);
        if (spec.id === "toolbar" && failToolbarWebview) {
          throw new Error("toolbar webview rejected");
        }
        return {
          onUrlChange: () => {},
          onTitleChange: () => {},
          onLoadState: () => {},
          getUrl: async () => ({ url: "https://example.com/start", seq: 1 }),
          navigate: async () => {},
          back: async () => {},
          forward: async () => {},
        };
      },
      setLayout: async () => {
        calls.push("setLayout");
      },
      createMessageChannel: async () => {
        calls.push("createMessageChannel");
        return {
          post: async () => {},
          onMessage: () => () => {},
          onClose: () => () => {},
          destroy: async () => {},
        };
      },
      show: async () => {},
    };
    return { shell, calls };
  };

  it("writes one structured record per milestone in order on a healthy attach", async () => {
    const { attachToolbarCarrier } = await loadCarrier();
    const { shell } = mountShell();
    const events: Record<string, unknown>[] = [];
    await attachToolbarCarrier(shell, {
      toolbarUrl: "http://127.0.0.1:1/toolbar.html",
      contentUrl: "https://example.com/start",
      titleFollows: false,
      log: async () => {},
      event: (record: Record<string, unknown>) => {
        events.push(record);
      },
    });
    expect(events.filter((event) => event.status === "ok").map((event) => event.step)).toEqual([
      "createWebviewToolbar",
      "createWebviewContent",
      "setLayout",
      "openChannel",
    ]);
  });

  it("records the failed milestone and stops the bootstrap without later steps", async () => {
    const { attachToolbarCarrier } = await loadCarrier();
    const { shell, calls } = mountShell(true);
    const events: Record<string, unknown>[] = [];
    await expect(
      attachToolbarCarrier(shell, {
        toolbarUrl: "http://127.0.0.1:1/toolbar.html",
        contentUrl: "https://example.com/start",
        titleFollows: false,
        log: async () => {},
        event: (record: Record<string, unknown>) => {
          events.push(record);
        },
      }),
    ).rejects.toThrow("toolbar webview rejected");
    expect(calls).toEqual(["createWebview:toolbar"]);
    expect(events).toContainEqual(
      expect.objectContaining({
        step: "createWebviewToolbar",
        status: "failed",
        error: "toolbar webview rejected",
      }),
    );
    expect(events.filter((event) => event.status === "ok")).toEqual([]);
  });
});

/** Fake `opentray` / `@opentray/ext-webview` modules so the generated entry
 * runs for real against recorded window calls; show() can be made to fail. */
const FAKE_OPENTRAY = `
import { appendFile } from "node:fs/promises";
const trace = (record) => appendFile(process.env.FAKE_OPENTRAY_TRACE, JSON.stringify(record) + "\\n", "utf8").catch(() => {});
const childWebview = (id) => ({
  id,
  onUrlChange: () => {},
  onTitleChange: () => {},
  onLoadState: () => {},
  getUrl: async () => ({ url: "https://example.com/start", seq: 1 }),
  navigate: async () => {},
  back: async () => {},
  forward: async () => {},
});
export const createTray = async () => {
  const deadHandlers = [];
  const fireDead = () => {
    for (const handler of [...deadHandlers]) {
      try { handler(new Error("broker connection closed")); } catch { /* listener defect */ }
    }
  };
  const handle = {
    extend: () => ({
      createWebviewWindow: (windowOptions) => ({
        show: async () => {
          await trace({ call: "window.show", windowOnly: windowOptions.windowOnly === true });
          if (process.env.FAKE_OPENTRAY_SHOW_FAIL === "1") {
            throw new Error("fake show failure");
          }
        },
        createWebview: async (spec) => {
          await trace({ call: "createWebview", id: spec.id });
          return childWebview(spec.id);
        },
        setLayout: async () => {
          await trace({ call: "setLayout" });
        },
        createMessageChannel: async () => ({
          post: async () => {},
          onMessage: () => () => {},
          onClose: () => () => {},
          destroy: async () => {},
        }),
        evaluate: async () => {},
        isVisible: async () => true,
        close: async () => {},
        toVisible: async () => {},
        focus: async () => {},
        destroy: async () => {
          await trace({ call: "window.destroy" });
        },
      }),
    }),
    onMenuClick: () => {},
    // Real SDK semantics: the terminal notification fires exactly once, both
    // for a dead transport and after a graceful close completes.
    onConnectionDead: (handler) => {
      deadHandlers.push(handler);
      return () => {};
    },
    destroy: async () => {
      await trace({ call: "tray.destroy" });
      fireDead();
    },
  };
  if (process.env.FAKE_OPENTRAY_CONN_DEAD === "1") {
    setTimeout(fireDead, 300);
  }
  return handle;
};
`;

const FAKE_EXT_WEBVIEW = `
export const WebviewExt = "webview-ext-fake";
export const column = (rows) => rows;
export const fixed = (name, size) => ({ name, size });
export const grow = (name) => ({ name });
`;

const writeFakeModules = async (projectDir: string): Promise<void> => {
  await mkdir(join(projectDir, "node_modules/opentray"), { recursive: true });
  await mkdir(join(projectDir, "node_modules/@opentray/ext-webview"), { recursive: true });
  await writeFile(
    join(projectDir, "node_modules/opentray/package.json"),
    `${JSON.stringify({ name: "opentray", type: "module", main: "index.mjs" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(projectDir, "node_modules/opentray/index.mjs"), FAKE_OPENTRAY, "utf8");
  await writeFile(
    join(projectDir, "node_modules/@opentray/ext-webview/package.json"),
    `${JSON.stringify(
      { name: "@opentray/ext-webview", type: "module", main: "index.mjs" },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(projectDir, "node_modules/@opentray/ext-webview/index.mjs"),
    FAKE_EXT_WEBVIEW,
    "utf8",
  );
};

interface BootstrapEvent {
  readonly event?: string;
  readonly step?: string;
  readonly status?: string;
  readonly [key: string]: unknown;
}

const readAppLogEvents = async (projectDir: string): Promise<BootstrapEvent[]> => {
  try {
    const text = await readFile(join(projectDir, "app.log"), "utf8");
    return text
      .split("\n")
      .filter((line) => line.includes('"event":"bootstrap"'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as BootstrapEvent];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
};

const readTrace = async (projectDir: string): Promise<Record<string, unknown>[]> => {
  try {
    const text = await readFile(join(projectDir, "fake-trace.jsonl"), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
};

interface RunOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}

const spawnEntry = (projectDir: string, env: NodeJS.ProcessEnv): ChildProcess =>
  spawn(process.execPath, [join(projectDir, "main.mjs")], {
    cwd: projectDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });

const collectStderr = (child: ChildProcess, sink: { text: string }): void => {
  child.stderr?.on("data", (chunk) => {
    sink.text += chunk;
  });
};

const materializeUrlToolbarApp = async (): Promise<string> => {
  const dir = remember(await mkdtemp(join(tmpdir(), "d5-url-toolbar-")));
  await writeScaffold({ config: urlToolbar, targetDir: dir, dependencyRange: "^0.27.0" });
  await writeFakeModules(dir);
  return dir;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Materialize a command app whose supervised child floods stdout (~16 KB
 * every 1 ms for `noiseMs`, then stays alive for the quit-path teardown). */
const materializeNoisyCommandApp = async (): Promise<{ readonly dir: string; readonly noiseMs: number }> => {
  const dir = remember(await mkdtemp(join(tmpdir(), "r3-noisy-")));
  const noiseMs = 1200;
  const noisy = join(dir, "noisy.mjs");
  await writeFile(
    noisy,
    [
      "// Stress child (Codex R3): ~16 KB of stdout every 1 ms for a bounded",
      "// window, then idle alive until the supervisor's quit path tears it down.",
      'const block = "x".repeat(16384);',
      `const deadline = Date.now() + ${noiseMs};`,
      "const tick = () => {",
      "  process.stdout.write(block);",
      "  if (Date.now() < deadline) { setTimeout(tick, 1); }",
      "};",
      "tick();",
      "",
    ].join("\n"),
    "utf8",
  );
  const config: ScaffoldAppConfig = {
    schemaVersion: 1,
    appId: "stress.noisy.example",
    appName: "Noisy Stress",
    command: { command: process.execPath, args: [noisy], cwd: dir },
    service: { port: 0 },
    window: {
      width: 900,
      height: 560,
      toolbar: false,
      titleFollowsDocument: true,
      iconFollowsDocument: false,
    },
    shell: { showTerminal: false },
  };
  await writeScaffold({ config, targetDir: dir, dependencyRange: "^0.27.0" });
  await writeFakeModules(dir);
  return { dir, noiseMs };
};

describe("executed URL toolbar entry bootstrap (D5)", () => {
  it(
    "healthy startup writes one structured milestone record per step to app.log",
    { timeout: 30_000 },
    async () => {
      const projectDir = await materializeUrlToolbarApp();
      const env = { FAKE_OPENTRAY_TRACE: join(projectDir, "fake-trace.jsonl") };
      const child = spawnEntry(projectDir, env);
      const stderrSink = { text: "" };
      collectStderr(child, stderrSink);

      // Wait for the full bootstrap narrative (openChannel is the last step).
      const deadline = Date.now() + 20_000;
      let events: BootstrapEvent[] = [];
      while (Date.now() < deadline) {
        events = await readAppLogEvents(projectDir);
        if (events.some((event) => event.step === "openChannel" && event.status === "ok")) break;
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      child.kill("SIGTERM");
      const outcome = await new Promise<RunOutcome>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: stderrSink.text }));
      });

      const steps = events.filter((event) => event.status === "ok").map((event) => event.step);
      // Execution order for the URL entry: the tray is created before the
      // toolbar shell host listens. Every milestone has exactly one record,
      // in the order the steps actually ran.
      expect(steps, `app.log narrative was: ${JSON.stringify(events)}`).toEqual([
        "createTray",
        "listenShell",
        "showWindow",
        "createWebviewToolbar",
        "createWebviewContent",
        "setLayout",
        "openChannel",
      ]);
      const listenShell = events.find((event) => event.step === "listenShell");
      expect(typeof listenShell?.port).toBe("number");
      expect(outcome.exitCode).toBe(0);
    },
  );

  it(
    "milestone records keep execution order under randomized append delays (serial queue, Codex R2 P1)",
    { timeout: 30_000 },
    async () => {
      // Happens-before gate: every physical app.log append is delayed by a
      // random 0-30 ms (OPENTRAY_TEST_LOG_JITTER), so the old
      // fire-and-forget appendFile writer would scramble record order
      // (listenShell racing ahead of createTray was observed in the wild).
      // The generated entry's serial append queue must keep one record per
      // milestone, exactly in execution order, with no duplicates.
      const projectDir = await materializeUrlToolbarApp();
      const env = {
        FAKE_OPENTRAY_TRACE: join(projectDir, "fake-trace.jsonl"),
        OPENTRAY_TEST_LOG_JITTER: "1",
      };
      const child = spawnEntry(projectDir, env);
      const stderrSink = { text: "" };
      collectStderr(child, stderrSink);

      const deadline = Date.now() + 20_000;
      let events: BootstrapEvent[] = [];
      while (Date.now() < deadline) {
        events = await readAppLogEvents(projectDir);
        if (events.some((event) => event.step === "openChannel" && event.status === "ok")) break;
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      child.kill("SIGTERM");
      const outcome = await new Promise<RunOutcome>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: stderrSink.text }));
      });

      const steps = events.filter((event) => event.status === "ok").map((event) => event.step);
      // The exact 7-milestone narrative (toEqual also fails on duplicates
      // and on out-of-order records).
      expect(steps, `app.log narrative was: ${JSON.stringify(events)}`).toEqual([
        "createTray",
        "listenShell",
        "showWindow",
        "createWebviewToolbar",
        "createWebviewContent",
        "setLayout",
        "openChannel",
      ]);
      expect(new Set(steps).size).toBe(steps.length);
      expect(outcome.exitCode).toBe(0);
    },
  );

  it(
    "a failed initial show() aborts the carrier, attaches no child webviews, and exits non-zero",
    { timeout: 30_000 },
    async () => {
      const projectDir = await materializeUrlToolbarApp();
      const env = {
        FAKE_OPENTRAY_TRACE: join(projectDir, "fake-trace.jsonl"),
        FAKE_OPENTRAY_SHOW_FAIL: "1",
      };
      const child = spawnEntry(projectDir, env);
      const stderrSink = { text: "" };
      collectStderr(child, stderrSink);
      const outcome = await new Promise<RunOutcome>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: stderrSink.text }));
      });

      expect(outcome.exitCode).toBe(1);
      const appLog = await readFile(join(projectDir, "app.log"), "utf8");
      expect(appLog).toContain("startup failed");
      const events = await readAppLogEvents(projectDir);
      expect(events).toContainEqual(
        expect.objectContaining({ step: "showWindow", status: "failed", error: "fake show failure" }),
      );
      // The carrier bootstrap never started against the failed session.
      expect(events.map((event) => event.step)).not.toContain("createWebviewToolbar");
      expect(events.map((event) => event.step)).not.toContain("openChannel");
      const trace = await readTrace(projectDir);
      expect(trace).toContainEqual(expect.objectContaining({ call: "window.show" }));
      expect(trace.filter((entry) => entry.call === "createWebview")).toEqual([]);
    },
  );

  it(
    "broker connection death records the milestone and exits non-zero; graceful quit stays on exit(0)",
    { timeout: 30_000 },
    async () => {
      // Death after bootstrap: the entry must not keep serving a shell over a
      // dead backend.
      const deadDir = await materializeUrlToolbarApp();
      const deadChild = spawnEntry(deadDir, {
        FAKE_OPENTRAY_TRACE: join(deadDir, "fake-trace.jsonl"),
        FAKE_OPENTRAY_CONN_DEAD: "1",
      });
      const deadSink = { text: "" };
      collectStderr(deadChild, deadSink);
      const deadOutcome = await new Promise<RunOutcome>((resolve, reject) => {
        deadChild.once("error", reject);
        deadChild.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: deadSink.text }));
      });
      expect(deadOutcome.exitCode).toBe(1);
      const deadEvents = await readAppLogEvents(deadDir);
      expect(deadEvents).toContainEqual(
        expect.objectContaining({
          step: "connectionDead",
          status: "failed",
          error: "broker connection closed",
        }),
      );

      // Graceful quit: tray.destroy() also reaches the terminal state, but
      // the quitting flag keeps the entry on its exit(0) course with no
      // connectionDead record.
      const quitDir = await materializeUrlToolbarApp();
      const quitChild = spawnEntry(quitDir, {
        FAKE_OPENTRAY_TRACE: join(quitDir, "fake-trace.jsonl"),
      });
      const quitSink = { text: "" };
      collectStderr(quitChild, quitSink);
      const quitDeadline = Date.now() + 20_000;
      let quitEvents: BootstrapEvent[] = [];
      while (Date.now() < quitDeadline) {
        quitEvents = await readAppLogEvents(quitDir);
        if (quitEvents.some((event) => event.step === "openChannel" && event.status === "ok")) break;
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      quitChild.kill("SIGTERM");
      const quitOutcome = await new Promise<RunOutcome>((resolve, reject) => {
        quitChild.once("error", reject);
        quitChild.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: quitSink.text }));
      });
      expect(quitOutcome.exitCode).toBe(0);
      const finalEvents = await readAppLogEvents(quitDir);
      expect(finalEvents.map((event) => event.step)).not.toContain("connectionDead");
    },
  );
});

describe("executed command entry noisy-output stress (Codex R3)", () => {
  it(
    "a noisy supervised command keeps milestones ordered, bounds app.log, and exits in bounded time",
    { timeout: 60_000 },
    async () => {
      const { dir, noiseMs } = await materializeNoisyCommandApp();
      // The jitter seam is the slow consumer: every physical append takes a
      // random 0-30 ms, so the output drain rate (~1 MB/s) falls far below
      // the ~16 MB/s production rate and the 256 KB cap MUST drop output. A
      // fast local disk would drain everything and prove nothing about the
      // bound.
      const child = spawnEntry(dir, {
        FAKE_OPENTRAY_TRACE: join(dir, "fake-trace.jsonl"),
        OPENTRAY_TEST_LOG_JITTER: "1",
      });
      const stderrSink = { text: "" };
      collectStderr(child, stderrSink);

      const deadline = Date.now() + 20_000;
      let events: BootstrapEvent[] = [];
      while (Date.now() < deadline) {
        events = await readAppLogEvents(dir);
        if (events.some((event) => event.step === "createTray" && event.status === "ok")) break;
        await sleep(100);
      }
      // Let the noisy child saturate the output channel past the cap.
      await sleep(noiseMs + 300);

      const killStarted = Date.now();
      child.kill("SIGTERM");
      const outcome = await new Promise<RunOutcome>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stderr: stderrSink.text }));
      });
      const quitMs = Date.now() - killStarted;

      // Milestone order survives the storm: listenShell -> createTray (no
      // service ports, so no showWindow records), exactly once each — the
      // output storm never touches the milestone chain.
      const steps = events.filter((event) => event.status === "ok").map((event) => event.step);
      expect(steps, `app.log narrative was: ${JSON.stringify(events)}`).toEqual([
        "listenShell",
        "createTray",
      ]);
      // SIGTERM -> quit -> teardown -> bounded flush -> exit(0).
      expect(outcome.exitCode).toBe(0);
      expect(quitMs).toBeLessThan(10_000);
      // The cap dropped output and said so in readable records; the file is
      // drain-bounded (~2 MB), not production-bounded (~19 MB written).
      const appLogFile = join(dir, "app.log");
      const appLog = await readFile(appLogFile, "utf8");
      expect(appLog).toContain("[log-queue] dropped ");
      expect(appLog.length).toBeLessThan(4_000_000);
    },
  );
});

describe("template milestone isomorphism (D5)", () => {
  it("both templates log the same milestones and never swallow the initial show()", async () => {
    const urlDir = remember(await mkdtemp(join(tmpdir(), "d5-iso-url-")));
    const commandDir = remember(await mkdtemp(join(tmpdir(), "d5-iso-command-")));
    await writeScaffold({ config: urlToolbar, targetDir: urlDir, dependencyRange: "^0.27.0" });
    await writeScaffold({
      config: commandToolbar,
      targetDir: commandDir,
      dependencyRange: "^0.27.0",
    });
    const urlEntry = await readFile(join(urlDir, "main.mjs"), "utf8");
    const commandEntry = await readFile(join(commandDir, "main.mjs"), "utf8");

    for (const [name, entry] of [
      ["url", urlEntry],
      ["command", commandEntry],
    ] as const) {
      // Shared structured-record writer and identical template milestones.
      expect(entry, name).toContain('const logEvent = (record) => logSink(JSON.stringify({ time:');
      // The serial append queue (Codex R2 P1) plus the bounded output channel
      // (Codex R3) are embedded identically in both templates: ordered
      // milestone records, coalesced/capped child output, exits awaiting the
      // drain, jitter seam.
      expect(entry, name).toContain("let logQueueTail = Promise.resolve();");
      expect(entry, name).toContain("const logOutputChunk = (text) => {");
      expect(entry, name).toContain("const OUTPUT_CAP_BYTES = 262144;");
      expect(entry, name).toContain("const flushLogQueue = async () => {");
      expect(entry, name).toContain("OPENTRAY_TEST_LOG_JITTER");
      expect(entry, name).toContain("await flushLogQueue();");
      expect(entry, name).toContain('step: "listenShell"');
      expect(entry, name).toContain('step: "createTray"');
      expect(entry, name).toContain('step: "showWindow"');
        // The carrier receives the same structured sink in both templates.
      expect(entry, name).toContain("event: logEvent");
      // The swallowed initial show is gone; failures are recorded, then abort.
      expect(entry, name).not.toContain(".show().catch(() => {})");
      // The connection-death policy is part of both templates (D3).
      expect(entry, name).toContain("tray.onConnectionDead?.((");
      expect(entry, name).toContain('step: "connectionDead"');
    }
    // The carrier milestones live once, in the shared carrier source.
    expect(urlEntry).toContain('milestone("createWebviewToolbar"');
    expect(commandEntry).toContain('milestone("createWebviewToolbar"');
    // Codex R3: the COMMAND entry routes every child-output chunk through
    // the bounded output channel; no raw chunk rides the milestone chain.
    expect(commandEntry).toContain("logOutputChunk(chunk);");
    expect(commandEntry).not.toContain('logSink(chunk, "utf8")');
    // The URL entry supervises no command: the channel is defined by the
    // shared queue source but never invoked there.
    expect(urlEntry).not.toContain("logOutputChunk(chunk)");
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
