// Codex R3 (2026-09-15, pre-release residual "generated entry's app.log
// queue is unbounded against child output"): the generated-entry queue source
// must run TWO channels — the milestone chain keeps its strictly serial
// happens-before semantics, while supervised-command output coalesces
// (>= 8 KB or 50 ms idle), drops oldest past the 256 KB buffered+in-flight
// cap, and carries one readable drop record on the next successful append.
// Codex R4 (same day, release boundary): drop accounting is
// reservation-safe under concurrent commits, failed/timed-out appends count
// their bytes as dropped, marker bytes stay inside the cap, a >cap single
// chunk drops whole with its exact count, and flush is a bounded quiescence
// barrier (beginOutputShutdown absorbs post-shutdown chunks into the final
// marker). The queue stays a string-embedded source in the generated
// entries, so these tests embed the SAME source into a temp module whose
// fake `appendFile` can stall, reject, or hang OUTPUT appends only — the
// exact embedding contract (host supplies appendFile + appLogPath) the
// generated entries provide.
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
  /** Quiescence barrier: post-shutdown chunks become counted drops. */
  readonly beginOutputShutdown: () => void;
  /** Drains the milestone chain and flushes the output buffer. */
  readonly flushLogQueue: () => Promise<void>;
  /** Landed append payloads, in landing order. */
  readonly appends: readonly string[];
  /** Gate every OUTPUT append (x-prefixed chunks and drop markers) until released. */
  readonly holdOutput: () => void;
  readonly releaseOutput: () => void;
  /** Make every OUTPUT append reject until healed. */
  readonly failOutput: () => void;
  readonly healOutput: () => void;
  /** Make every OUTPUT append hang until failed/released by the harness. */
  readonly hangOutput: () => void;
  /** Reject all currently hanging OUTPUT appends (they never land). */
  readonly failHanging: () => void;
}

const loadQueueHarness = async (
  options?: { readonly appendTimeoutMs?: number },
): Promise<QueueHarness> => {
  const dir = await mkdtemp(join(tmpdir(), "log-queue-"));
  roots.push(dir);
  const file = join(dir, "queue.mjs");
  const source = `
// Harness: output payloads ("x" prefix or drop markers) can be gated, made
// to fail, or made to hang; milestone records never gate — the two channels
// stay independent like in the entry.
const appends = [];
let mode = "open";
let resolveGate = () => {};
let gate = Promise.resolve();
const hanging = [];
const holdOutput = () => { mode = "held"; gate = new Promise((r) => { resolveGate = r; }); };
const releaseOutput = () => { mode = "open"; resolveGate(); };
const failOutput = () => { mode = "fail"; };
const healOutput = () => { mode = "open"; };
const hangOutput = () => { mode = "hang"; };
const failHanging = () => { for (const h of hanging.splice(0)) h.reject(new Error("append failed")); };
const appendFile = async (path, text) => {
  const isOutput = text.startsWith("x") || text.startsWith("[log-queue]");
  if (!isOutput) { appends.push(text); return; }
  if (mode === "fail") throw new Error("append failed");
  if (mode === "hang") {
    await new Promise((resolveAppend, rejectAppend) => {
      hanging.push({ resolve: resolveAppend, reject: rejectAppend });
    });
  } else if (mode === "held") {
    await gate;
  }
  appends.push(text);
};
const appLogPath = "app.log";
${logQueueSource()}
export { logSink, logOutputChunk, beginOutputShutdown, flushLogQueue, appends, holdOutput, releaseOutput, failOutput, healOutput, hangOutput, failHanging };
`;
  await writeFile(file, source, "utf8");
  const envName = "OPENTRAY_TEST_LOG_APPEND_TIMEOUT_MS";
  const saved = process.env[envName];
  if (options?.appendTimeoutMs !== undefined) {
    process.env[envName] = String(options.appendTimeoutMs);
  }
  try {
    return await import(pathToFileURL(file).href) as Promise<QueueHarness>;
  } finally {
    if (saved === undefined) delete process.env[envName];
    else process.env[envName] = saved;
  }
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

describe("log queue output channel hardening (Codex R4)", () => {
  const markersOf = (queue: QueueHarness): string[] =>
    queue.appends.filter((text) => text.startsWith("[log-queue] dropped "));

  it(
    "concurrent flushes carry one drop episode exactly once; later markers survive (Codex repro)",
    async () => {
      // Codex R4 P1 repro shape: a held first append, an 8 KiB in-flight
      // commit, a 262144-byte dropped chunk, TWO flushes racing the held
      // carrier, then a refill to the full cap and a fresh 1024-byte drop.
      // The old global-counter accounting double-carried the episode (two
      // 262144 records), went negative on landing, and suppressed the 1024
      // marker; reservation accounting must emit each episode exactly once.
      const queue = await loadQueueHarness();
      queue.holdOutput();
      queue.logOutputChunk("x".repeat(8192)); // first commit, held mid-append
      queue.logOutputChunk("x".repeat(262144)); // over-cap single chunk: whole drop
      const flushOne = queue.flushLogQueue();
      const flushTwo = queue.flushLogQueue(); // second flush while the first carrier is held
      queue.releaseOutput();
      await Promise.all([flushOne, flushTwo]);
      expect(markersOf(queue)).toEqual(["[log-queue] dropped 262144 output bytes\n"]);

      // Refill in-flight to the full cap, then drop another 1024 bytes: the
      // marker must still land with the exact count (a negative residual
      // would have suppressed it).
      queue.holdOutput();
      for (let i = 0; i < 32; i += 1) {
        queue.logOutputChunk("x".repeat(8192));
      }
      queue.logOutputChunk("x".repeat(1024)); // over-cap: whole drop
      const flushThree = queue.flushLogQueue();
      queue.releaseOutput();
      await flushThree;
      expect(markersOf(queue)).toEqual([
        "[log-queue] dropped 262144 output bytes\n",
        "[log-queue] dropped 1024 output bytes\n",
      ]);
    },
  );

  it("a rejected output append counts its bytes as dropped; flush resolves and the next success reports them", async () => {
    const queue = await loadQueueHarness();
    queue.failOutput();
    queue.logOutputChunk("x".repeat(4096));
    queue.logOutputChunk("x".repeat(4096)); // 8 KB threshold commit -> rejected
    // Lossy-by-design: the flush must resolve (never reject) while appends
    // fail, and the failed bytes must be counted, not silently gone.
    await queue.flushLogQueue();
    expect(queue.appends.length).toBe(0);

    queue.healOutput();
    queue.logOutputChunk("tail");
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["[log-queue] dropped 8192 output bytes\ntail"]);
  });

  it("marker bytes stay inside the in-flight cap: threshold text is evicted whole-chunk to fit the marker budget", async () => {
    const queue = await loadQueueHarness();
    queue.holdOutput();
    for (let i = 0; i < 31; i += 1) {
      queue.logOutputChunk("x".repeat(8192)); // 253952 bytes held in flight
    }
    queue.logOutputChunk("x".repeat(8242)); // 8242 + 253952 > cap: whole drop
    queue.logOutputChunk("x".repeat(8192)); // fills buffered to exactly the remaining budget
    // The threshold commit would submit marker + 8192 bytes over the budget,
    // so the whole 8192-byte chunk is evicted and counted; the marker lands
    // ALONE (marker overhead is inside the cap, never on top of it).
    queue.releaseOutput();
    await queue.flushLogQueue();
    expect(queue.appends.length).toBe(33);
    for (let i = 0; i < 31; i += 1) {
      expect(queue.appends[i]).toBe("x".repeat(8192));
    }
    expect(queue.appends[31]).toBe("[log-queue] dropped 8242 output bytes\n");
    expect(queue.appends[32]).toBe("[log-queue] dropped 8192 output bytes\n");
    for (const payload of queue.appends) {
      expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(8192 + 64);
    }
  });

  it("a single chunk larger than the cap drops whole and its exact byte count lands in the marker", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("x".repeat(262145));
    expect(queue.appends.length).toBe(0);
    queue.logOutputChunk("tail");
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["[log-queue] dropped 262145 output bytes\ntail"]);
  });

  it("a single chunk exactly at the cap is kept whole (boundary)", async () => {
    const queue = await loadQueueHarness();
    queue.logOutputChunk("x".repeat(262144));
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["x".repeat(262144)]);
  });

  it("a chunk arriving during the flush drain is committed by that flush (pre-shutdown)", async () => {
    const queue = await loadQueueHarness();
    queue.holdOutput();
    queue.logOutputChunk("x".repeat(8192));
    const flushing = queue.flushLogQueue();
    queue.logOutputChunk("x".repeat(300)); // arrives after the flush snapshotted its chains
    queue.releaseOutput();
    await flushing;
    // The bounded drain loop picked the late chunk up in a follow-up round;
    // a single-snapshot flush would have resolved before it landed.
    expect(queue.appends).toEqual(["x".repeat(8192), "x".repeat(300)]);
    await sleep(80); // no orphaned idle timer re-commits after the flush
    expect(queue.appends).toEqual(["x".repeat(8192), "x".repeat(300)]);
  });

  it("after beginOutputShutdown, chunks are counted-and-dropped and the final flush marker carries them; flush is idempotent", async () => {
    const queue = await loadQueueHarness();
    queue.beginOutputShutdown();
    queue.logOutputChunk("x".repeat(1024));
    queue.logOutputChunk("x".repeat(1024));
    expect(queue.appends.length).toBe(0);
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["[log-queue] dropped 2048 output bytes\n"]);
    await queue.flushLogQueue();
    await queue.flushLogQueue();
    await sleep(80); // absorbed chunks never scheduled a timer
    expect(queue.appends).toEqual(["[log-queue] dropped 2048 output bytes\n"]);
  });

  it("a hung output append cannot hang the flush: it returns bounded and the loss is counted", async () => {
    const queue = await loadQueueHarness({ appendTimeoutMs: 50 });
    queue.hangOutput();
    queue.logOutputChunk("x".repeat(8192));
    const started = Date.now();
    await queue.flushLogQueue();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(queue.appends.length).toBe(0);

    // The hung appends never land; their bytes stay in the counted loss
    // total and the next successful carrier reports them.
    queue.failHanging();
    queue.healOutput();
    queue.logOutputChunk("late");
    await queue.flushLogQueue();
    expect(queue.appends).toEqual(["[log-queue] dropped 8192 output bytes\nlate"]);
  });
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
