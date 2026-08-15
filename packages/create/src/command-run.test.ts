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

      await waitFor(() => events.some((e) => e.type === "stdout" && e.chunk?.includes("PROMPT>")));
      run.write("hello\n");
      await waitFor(() =>
        events.some((e) => e.type === "stdout" && (e.chunk ?? "").includes("ECHO:hello")),
      );
      const exited = await run.exited;
      expect(exited.code).toBe(0);
      expect(events.some((e) => e.type === "pty-ready")).toBe(true);
    },
    20_000,
  );

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
      await waitFor(() =>
        events.some((e) => e.type === "stdout" && e.chunk?.includes("READY")),
      );
    } finally {
      await run.kill();
      resetPtyProbeCache();
    }
  }, 20_000);
});
