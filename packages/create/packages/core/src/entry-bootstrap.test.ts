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
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
