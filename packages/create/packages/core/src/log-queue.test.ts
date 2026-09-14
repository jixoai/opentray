// Codex R3 (2026-09-15, pre-release residual "generated entry's app.log
// queue is unbounded against child output"): the generated-entry queue source
// must run TWO channels — the milestone chain keeps its strictly serial
// happens-before semantics, while supervised-command output coalesces
// (>= 8 KB or 50 ms idle), drops oldest past the 256 KB buffered+in-flight
// cap, and carries one readable drop record on the next successful append.
// The queue stays a string-embedded source in the generated entries, so these
// tests embed the SAME source into a temp module whose fake `appendFile` can
// stall OUTPUT appends only — the exact embedding contract (host supplies
// appendFile + appLogPath) the generated entries provide.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { logQueueSource } from "./log-queue";

const roots: string[] = [];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

interface QueueHarness {
  /** Milestone-channel sink (serial chain). */
  readonly logSink: (text: string) => Promise<void>;
  /** Bounded output-channel submit. */
  readonly logOutputChunk: (text: string) => void;
  /** Drains the milestone chain and flushes the output buffer. */
  readonly flushLogQueue: () => Promise<void>;
  /** Landed append payloads, in landing order. */
  readonly appends: readonly string[];
  /** Block every OUTPUT append (payloads starting with "x") until released. */
  readonly holdOutput: () => void;
  readonly releaseOutput: () => void;
}

const loadQueueHarness = async (): Promise<QueueHarness> => {
  const dir = await mkdtemp(join(tmpdir(), "log-queue-"));
  roots.push(dir);
  const file = join(dir, "queue.mjs");
  const source = `
// Harness: output-looking payloads ("x" prefix) gate on outputGate; milestone
// records never do — the two channels stay independent like in the entry.
const appends = [];
let resolveGate = () => {};
let gate = Promise.resolve();
const holdOutput = () => { gate = new Promise((r) => { resolveGate = r; }); };
const releaseOutput = () => { resolveGate(); };
const appendFile = async (path, text) => {
  if (text.startsWith("x")) await gate;
  appends.push(text);
};
const appLogPath = "app.log";
${logQueueSource()}
export { logSink, logOutputChunk, flushLogQueue, appends, holdOutput, releaseOutput };
`;
  await writeFile(file, source, "utf8");
  return import(pathToFileURL(file).href) as Promise<QueueHarness>;
};

describe("log queue output channel (Codex R3)", () => {
  it("coalesces small chunks into one append after the 50 ms idle window", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("a");
    queue.logOutputChunk("b");
    queue.logOutputChunk("c");
    await sleep(30);
    expect(queue.appends.length).toBe(0);
    await sleep(100);
    expect(queue.appends).toEqual(["abc"]);
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["abc"]);
  });

  it("resets the idle window on every new chunk", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("a");
    await sleep(25);
    queue.logOutputChunk("b"); // resets: 50 ms counts from HERE
    await sleep(30); // 55 ms since "a" — a non-resetting timer would have fired
    expect(queue.appends.length).toBe(0);
    await sleep(100); // 130 ms since "b" — the reset timer has fired
    expect(queue.appends).toEqual(["ab"]);
  });

  it("commits immediately once 8 KB has accumulated, without waiting for the idle window", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("y".repeat(8192));
    await sleep(10);
    // Landed without flush and without any 50 ms wait.
    expect(queue.appends.length).toBe(1);
    expect(queue.appends[0]).toBe("y".repeat(8192));
    await queue.flushLogQueue();
    expect(queue.appends.length).toBe(1);
  });

  it("flushLogQueue flushes a pending buffer without waiting for the idle window", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("z");
    expect(queue.appends.length).toBe(0);
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["z"]);
  });

  it(
    "drops oldest pending output past the 256 KB buffered+in-flight cap and reports it in one readable record",
    async () => {
      const queue = await loadQueueHarness();
      queue.holdOutput();
      // 300 x 1 KB: 256 KB graduates into gated (in-flight) commits, the
      // remaining 44 KB must DROP, not queue.
      for (let i = 0; i < 300; i += 1) {
        queue.logOutputChunk("x".repeat(1024));
      }
      expect(queue.appends.length).toBe(0);

      queue.releaseOutput();
      await queue.flushLogQueue();
      // 32 committed 8 KB payloads landed, then the flush carried the drop
      // record (nothing else was pending).
      expect(queue.appends.length).toBe(33);
      for (let i = 0; i < 32; i += 1) {
        expect(queue.appends[i]?.length).toBe(8192);
      }
      expect(queue.appends[32]).toBe("[log-queue] dropped 45056 output bytes\n");
    },
  );

  it("keeps milestone records flowing while the output drain is stalled (independent chains)", async () => {
    const queue = await loadQueueHarness();
    queue.holdOutput();
    queue.logOutputChunk("x".repeat(4096));
    queue.logOutputChunk("x".repeat(4096)); // 8 KB -> gated in-flight commit
    await queue.logSink("milestone-a\n");
    await sleep(30);
    // The milestone landed although zero output appends have.
    expect(queue.appends).toEqual(["milestone-a\n"]);

    queue.releaseOutput();
    await queue.flushLogQueue();
    expect(queue.appends.length).toBe(2);
    expect(queue.appends[1]).toBe("x".repeat(8192));
  });

  it("keeps milestone submission order on the serial chain", async () => {
    const queue = await loadQueueHarness();
    await queue.logSink("one\n");
    void queue.logSink("two\n").catch(() => {});
    void queue.logSink("three\n").catch(() => {});
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["one\n", "two\n", "three\n"]);
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
