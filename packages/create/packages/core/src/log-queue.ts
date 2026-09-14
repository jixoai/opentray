// Orthogonal intents (2026-09-15; Codex R2 P1 fix for the
// harden-lifecycle-ownership D5 "Healthy startup writes a readable narrative"
// scenario, extended the same day by the Codex R3 pre-release residual
// "generated entry's app.log queue is unbounded against child output"):
// 1. Render the app.log append queues as one real JS source string embedded
//    verbatim by url-entry-template.ts and entry-template.ts — the same
//    single-source pattern toolbar-carrier.ts uses, so both generated
//    entries share ONE queue implementation by construction, and the toolbar
//    carrier shares it transitively through its `options.event` sink.
// 2. Milestone channel: concurrent appendFile completions have no
//    happens-before, so fire-and-forget records could land out of execution
//    order (listenShell was observed on disk before createTray) and a fast
//    process.exit could drop them. Every milestone append (logSink /
//    logEvent / notes) flows through one promise chain — a record is
//    submitted only after the previous one landed on disk — and every exit
//    path awaits flushLogQueue() before process.exit.
// 3. Output channel (Codex R3): supervised-command PTY/stdout/stderr chunks
//    never enter the milestone chain. logOutputChunk(text) coalesces pending
//    output into one buffer, commits it as ONE append once >= 8 KB has
//    accumulated or 50 ms pass with no new chunk, caps buffered+in-flight
//    bytes at 256 KB (oldest pending data drops past the cap), and carries
//    the dropped total into the next SUCCESSFUL append as one readable
//    "[log-queue] dropped N output bytes" line — a noisy child cannot grow
//    an unbounded chain, drag later milestones, or make the exit flush's
//    latency/memory unbounded.
// 4. The record format (JSON line, step/status fields) and the milestone
//    semantics are unchanged; the healthy-path cost is one sequential await
//    per record, bounded by appendFile itself.
// 5. Test seam (minimal invasion): OPENTRAY_TEST_LOG_JITTER=1 delays each
//    physical append by a random 0–30 ms so the ordering test observes the
//    deterministic narrative an unserialized writer would scramble, and the
//    stress test observes cap drops that a fast local disk would never
//    force.
//
// Embedding contract: the host template supplies `appendFile` (from
// node:fs/promises) and `appLogPath` in scope — the same embedding style the
// toolbar carrier relies on for column/fixed/grow. `Buffer` is the Node
// global; both generated entries run under node.

/** The generated-entry app.log append queues. The milestone chain replaces
 * the old fire-and-forget `appendFile.bind(undefined, appLogPath)` logSink:
 * submission order becomes disk order and exits can await the drain. The
 * bounded output channel keeps a supervised command's stream from costing
 * unbounded memory or exit latency. */
export const logQueueSource = (): string => `// App.log append queues (Codex R2 P1 + R3, 2026-09-15): appendFile
// completions have no happens-before, so milestone records must never race,
// and child output must never share that chain — a noisy child would grow an
// unbounded happens-before list, drag later milestones, and make the exit
// flush unbounded. Milestones keep one strictly serial chain; output records
// flow through their own chain, coalesced and byte-capped.
const appendLogLine = process.env.OPENTRAY_TEST_LOG_JITTER === "1"
  ? async (text) => {
      // Test seam only: random 0-30 ms per-append delay.
      await new Promise((resolveDelay) => { setTimeout(resolveDelay, Math.random() * 30); });
      await appendFile(appLogPath, text, "utf8");
    }
  : (text) => appendFile(appLogPath, text, "utf8");
let logQueueTail = Promise.resolve();
const logSink = (text) => {
  const write = logQueueTail.then(() => appendLogLine(text));
  // A failed append must not kill the chain; the write itself still rejects
  // for callers that await durability (the tail catch also keeps void-ed
  // submissions from becoming unhandled rejections).
  logQueueTail = write.catch(() => {});
  return write;
};

// Bounded child-output channel (Codex R3). Two chains coexist: milestones
// stay strictly ordered among themselves, output records among themselves;
// cross-channel disk order is unspecified (each appendFile is one O_APPEND
// write, so records interleave at line boundaries but never corrupt).
const OUTPUT_COMMIT_BYTES = 8192;
const OUTPUT_COMMIT_IDLE_MS = 50;
const OUTPUT_CAP_BYTES = 262144;
const outputChunks = [];
let outputBufferedBytes = 0;
let outputInFlightBytes = 0;
let outputDroppedBytes = 0;
let outputTimer = null;
let outputTail = Promise.resolve();
const commitOutputBuffer = () => {
  if (outputTimer !== null) { clearTimeout(outputTimer); outputTimer = null; }
  if (outputChunks.length === 0 && outputDroppedBytes === 0) return;
  const text = outputChunks.join("");
  outputChunks.length = 0;
  outputBufferedBytes = 0;
  let carriedDrops = 0;
  let payload = text;
  if (outputDroppedBytes > 0) {
    // One readable record per drop episode, carried by the next append.
    carriedDrops = outputDroppedBytes;
    payload = "[log-queue] dropped " + carriedDrops + " output bytes\\n" + text;
  }
  const payloadBytes = Buffer.byteLength(payload);
  outputInFlightBytes += payloadBytes;
  const write = outputTail.then(() => appendLogLine(payload));
  write.then(
    () => {
      outputInFlightBytes -= payloadBytes;
      // The drop record is durable only now that its carrier append landed.
      if (carriedDrops > 0) outputDroppedBytes -= carriedDrops;
    },
    () => {
      outputInFlightBytes -= payloadBytes;
      // The failed append lost the drop record; the count stays pending so
      // the next successful append re-emits it.
    },
  );
  outputTail = write.catch(() => {});
};
const logOutputChunk = (text) => {
  outputChunks.push(text);
  outputBufferedBytes += Buffer.byteLength(text);
  // Hard cap BEFORE the coalescing thresholds: over-cap data must drop, not
  // graduate into an in-flight append that only the disk can drain.
  while (outputBufferedBytes + outputInFlightBytes > OUTPUT_CAP_BYTES && outputChunks.length > 0) {
    const oldest = outputChunks.shift();
    const size = Buffer.byteLength(oldest);
    outputBufferedBytes -= size;
    outputDroppedBytes += size;
  }
  if (outputTimer !== null) { clearTimeout(outputTimer); outputTimer = null; }
  if (outputBufferedBytes >= OUTPUT_COMMIT_BYTES) {
    commitOutputBuffer();
  } else if (outputBufferedBytes > 0) {
    outputTimer = setTimeout(commitOutputBuffer, OUTPUT_COMMIT_IDLE_MS);
  }
};
const flushLogQueue = async () => {
  // Bounded by construction: one milestone record lands at a time, and the
  // output channel's un-landed bytes are capped, so its pending commits and
  // final flush are finite even when drops occurred.
  commitOutputBuffer();
  await logQueueTail;
  await outputTail;
};
`;
