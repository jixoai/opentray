import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadPtyModule,
  needsShell,
  resetPtyProbeCache,
  startCommandRun,
  type CommandRunEvent,
} from "./command-run";

const echoServerScript = `const http = require("node:http");
const server = http.createServer((req, res) => { res.writeHead(200); res.end("ok"); });
server.listen(0, "127.0.0.1", () => process.stdout.write("READY " + server.address().port + "\\n"));
`;

const collectEvents = (): { events: CommandRunEvent[]; onEvent: (e: CommandRunEvent) => void } => {
  const events: CommandRunEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 8_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met before timeout");
};

describe("needsShell", () => {
  it("flags shell metacharacters", () => {
    expect(needsShell(["echo", "a;b"])).toBe(true);
    expect(needsShell(["node", "server.js"])).toBe(false);
  });
});

/** Concatenate transported output chunks (they are already strings). */
const allDecoded = (events: readonly CommandRunEvent[]): string =>
  events
    .filter((e) => e.type === "stdout" || e.type === "stderr")
    .map((e) => e.chunk ?? "")
    .join("");

describe("startCommandRun Bun.Terminal backend", () => {
  interface StubRun {
    dataListener?: (data: Uint8Array) => void;
    writes: string[];
    resizes: { cols: number; rows: number }[];
    closed: boolean;
  }

  const installBunStub = (): { run: StubRun; exitNow: (code: number) => void } => {
    const run: StubRun = { writes: [], resizes: [], closed: false };
    let exitListener: ((code: number) => void) | undefined;
    const terminalInstance = {
      write: (data: string) => {
        run.writes.push(data);
        return data.length;
      },
      resize: (cols: number, rows: number) => {
        run.resizes.push({ cols, rows });
      },
      close: () => {
        run.closed = true;
      },
    };
    const previous = (globalThis as { Bun?: unknown }).Bun;
    (globalThis as { Bun?: unknown }).Bun = {
      Terminal: class {
        constructor(options: { data?: (t: unknown, d: Uint8Array) => void }) {
          run.dataListener = (data) => options.data?.(this, data);
        }
        write = (data: string) => {
          run.writes.push(data);
          return data.length;
        };
        resize = (cols: number, rows: number) => {
          run.resizes.push({ cols, rows });
        };
        close = () => {
          run.closed = true;
        };
      },
      spawn: (command: readonly string[], options: { terminal: unknown }) => {
        void options;
        return {
          pid: 777,
          exited: new Promise<number>((resolve) => {
            exitListener = resolve;
          }),
          kill: () => {
            exitListener?.(0);
          },
        };
      },
    };
    return {
      run,
      exitNow: (code) => exitListener?.(code),
    };
  };

  it("prefers Bun.Terminal when present and forwards bytes both ways", async () => {
    const { run, exitNow } = installBunStub();
    try {
      const { events, onEvent } = collectEvents();
      const started = startCommandRun({
        tokens: [process.execPath, "stub.cjs"],
        cwd: "/tmp",
        onEvent,
      });
      const commandRun = await started;
      expect(commandRun.pty).toBe(true);
      expect(commandRun.pid).toBe(777);
      expect(events.some((e) => e.type === "pty-ready")).toBe(true);

      // PTY output → stdout chunk verbatim.
      run.dataListener?.(new TextEncoder().encode("hello-from-bun-terminal"));
      expect(allDecoded(events)).toContain("hello-from-bun-terminal");

      // Input → terminal.write verbatim; resize → terminal.resize.
      commandRun.write("hi\n");
      commandRun.resize({ cols: 120, rows: 40 });
      expect(run.writes).toEqual(["hi\n"]);
      expect(run.resizes).toEqual([{ cols: 120, rows: 40 }]);

      // Process exit → exit event with code.
      exitNow(3);
      const exited = await commandRun.exited;
      expect(exited.code).toBe(3);
      expect(events.some((e) => e.type === "exit" && e.code === 3)).toBe(true);

      // Kill closes the terminal too.
      await commandRun.kill();
      expect(run.closed).toBe(true);
    } finally {
      delete (globalThis as { Bun?: unknown }).Bun;
      void (globalThis as { Bun?: unknown }).Bun;
    }
  });
});

describe("startCommandRun PTY mode", () => {
  it(
    "attaches through a PTY, forwards stdin, and streams responses",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "pty-run-test-"));
      const scriptPath = join(workDir, "echo-line.cjs");
      await writeFile(
        scriptPath,
        [
          "process.stdout.write('PROMPT> ');",
          "process.stdin.once('data', (d) => {",
          "  process.stdout.write('ECHO:' + d.toString().trim() + '\\n');",
          "  setTimeout(() => process.exit(0), 100);",
          "});",
        ].join("\n"),
        "utf8",
      );

      const { events, onEvent } = collectEvents();
      const run = await startCommandRun({
        tokens: [process.execPath, scriptPath],
        cwd: workDir,
        onEvent,
      });
      expect(run.pty).toBe(true);
      expect(run.pid).toBeGreaterThan(0);

      await waitFor(() => allDecoded(events).includes("PROMPT>"));
      run.write("hello\n");
      await waitFor(() => allDecoded(events).includes("ECHO:hello"));
      const exited = await run.exited;
      expect(exited.code).toBe(0);
      expect(events.some((e) => e.type === "pty-ready")).toBe(true);
    },
    20_000,
  );

  it("transports output verbatim with zero server-side interpretation", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pty-bytes-test-"));
    const scriptPath = join(workDir, "raw-bytes.cjs");
    await writeFile(
      scriptPath,
      [
        "// Invalid UTF-8 first, then a split emoji across delayed writes.",
        "process.stdout.write(Buffer.from([0xff, 0xfe]));",
        "setTimeout(() => {",
        "  process.stdout.write(Buffer.from([0xf0]));", // emoji lead byte alone
        "  setTimeout(() => {",
        "    process.stdout.write(Buffer.from([0x9f, 0x8e, 0x89, 0x0a]));", // completes 🎉
        "    setTimeout(() => process.exit(0), 100);",
        "  }, 60);",
        "}, 40);",
      ].join("\n"),
      "utf8",
    );

    const { events, onEvent } = collectEvents();
    const run = await startCommandRun({
      tokens: [process.execPath, scriptPath],
      cwd: workDir,
      onEvent,
    });
    await run.exited;
    const transported = allDecoded(events);

    // Split multibyte char: joined by the binding, transported whole.
    expect(transported.includes("\u{1F389}")).toBe(true);
    // Invalid bytes: the binding's own U+FFFD replacement passes through —
    // and crucially, no double-mangling (a binary re-encode would turn
    // U+FFFD into \u00FD garbage).
    expect(transported.includes("\uFFFD\uFFFD")).toBe(true);
    expect(transported.includes("\u00FD")).toBe(false);
    // Exact reference: identical to consuming @lydell/node-pty directly.
    expect(transported).toBe(await referencePtyCapture(workDir, scriptPath));
  }, 20_000);

  it("resizes the pseudo-terminal without throwing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "pty-resize-test-"));
    const serverPath = join(workDir, "server.cjs");
    await writeFile(serverPath, echoServerScript, "utf8");
    const { onEvent } = collectEvents();
    const run = await startCommandRun({
      tokens: [process.execPath, serverPath],
      cwd: workDir,
      onEvent,
    });
    try {
      expect(run.pty).toBe(true);
      run.resize({ cols: 120, rows: 40 });
    } finally {
      await run.kill();
    }
  });
});

describe("startCommandRun fallback mode", () => {
  it("degrades to pipes with a pty-unavailable notice when the PTY cannot load", async () => {
    resetPtyProbeCache();
    await loadPtyModule(async () => undefined);
    const { events, onEvent } = collectEvents();
    const workDir = await mkdtemp(join(tmpdir(), "pipe-run-test-"));
    const serverPath = join(workDir, "server.cjs");
    await writeFile(serverPath, echoServerScript, "utf8");
    const run = await startCommandRun({
      tokens: [process.execPath, serverPath],
      cwd: workDir,
      onEvent,
    });
    try {
      expect(run.pty).toBe(false);
      expect(events.some((e) => e.type === "pty-unavailable")).toBe(true);
      // Input endpoints are no-ops in fallback, not crashes.
      run.write("ignored");
      run.resize({ cols: 80, rows: 24 });
      await waitFor(() => allDecoded(events).includes("READY"));
    } finally {
      await run.kill();
      resetPtyProbeCache();
    }
  }, 20_000);
});

/** Capture what the PTY binding delivers directly, as the objectivity reference. */
const referencePtyCapture = async (cwd: string, scriptPath: string): Promise<string> => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pty = require("@lydell/node-pty") as {
    spawn: (
      file: string,
      args: readonly string[],
      options: {
        name: string;
        cols: number;
        rows: number;
        cwd: string;
        env: Record<string, string>;
      },
    ) => {
      onData(listener: (data: string) => void): void;
      onExit(listener: (event: { exitCode: number }) => void): void;
    };
  };
  const proc = pty.spawn(process.execPath, [scriptPath], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });
  let captured = "";
  return await new Promise<string>((resolve) => {
    proc.onData((data) => {
      captured += data;
    });
    proc.onExit(() => resolve(captured));
  });
};
