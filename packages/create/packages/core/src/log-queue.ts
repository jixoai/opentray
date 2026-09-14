// Orthogonal intents (2026-09-15; Codex R2 P1 fix for the
// harden-lifecycle-ownership D5 "Healthy startup writes a readable narrative"
// scenario, extended the same day by the Codex R3 pre-release residual
// "generated entry's app.log queue is unbounded against child output", then
// hardened by the Codex R4 release-boundary findings — concurrent drop-marker
// accounting, failed-append loss counting, marker-inclusive cap, single-chunk
// contract, and a shutdown/quiescence barrier):
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
// 4. R4 hardening of that channel: child output is lossy-by-design — every
//    loss is counted and reported. Drop accounting splits into
//    pending (no carrier has taken it yet) and an in-flight reservation
//    (exactly the amount a submitted carrier is reporting), so concurrent
//    commits can never double-carry an episode or drive the counter
//    negative. The cap is inclusive of marker bytes (whole oldest chunks are
//    evicted to fit the budget; one chunk is the drop granularity
//    everywhere). A rejected or timed-out output append counts its raw
//    bytes as dropped and returns its carried episode to pending. Drop
//    granularity is one whole chunk; the transient memory bound is
//    cap + largest single chunk, and a single chunk larger than the cap is
//    dropped whole with its exact byte count in the marker.
// 5. Quiescence barrier (R4): beginOutputShutdown() stops output ingestion
//    (post-shutdown chunks are counted into the final marker instead of
//    scheduling post-flush commits a fast process.exit would orphan), and
//    flushLogQueue() is a bounded drain — at most FLUSH_MAX_DRAIN_ROUNDS
//    re-snapshot/commit/await rounds plus one final carrier — where each
//    output append is wall-clock bounded (OUTPUT_APPEND_TIMEOUT_MS), so a
//    hung or rejecting appendFile can never hang the exit flush.
// 6. The record format (JSON line, step/status fields) and the milestone
//    semantics are unchanged; the healthy-path cost is one sequential await
//    per record, bounded by appendFile itself.
// 7. Test seams (minimal invasion): OPENTRAY_TEST_LOG_JITTER=1 delays each
//    physical append by a random 0–30 ms so the ordering test observes the
//    deterministic narrative an unserialized writer would scramble, and the
//    stress test observes cap drops that a fast local disk would never
//    force; OPENTRAY_TEST_LOG_APPEND_TIMEOUT_MS (positive integer) shrinks
//    the output-append wall-clock bound so tests exercise timeout loss
//    quickly.
//
// Embedding contract: the host template supplies `appendFile` (from
// node:fs/promises) and `appLogPath` in scope — the same embedding style the
// toolbar carrier relies on for column/fixed/grow. `Buffer` is the Node
// global; both generated entries run under node.

/** The generated-entry app.log append queues. The milestone chain replaces
 * the old fire-and-forget `appendFile.bind(undefined, appLogPath)` logSink:
 * submission order becomes disk order and exits can await the drain. The
 * bounded output channel keeps a supervised command's stream from costing
 * unbounded memory or exit latency — lossy-by-design, with every loss
 * counted and reported (Codex R4). */
export const logQueueSource = (): string => `// App.log append queues (Codex R2 P1 + R3 + R4, 2026-09-15): appendFile
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

// Bounded child-output channel (Codex R3, hardened R4). Two chains coexist:
// milestones stay strictly ordered among themselves, output records among
// themselves; cross-channel disk order is unspecified (each appendFile is one
// O_APPEND write, so records interleave at line boundaries but never corrupt).
//
// LOSS CONTRACT (Codex R4): child output in app.log is lossy-by-design
// diagnostic data; every loss is counted and reported. Losses happen in
// exactly three counted ways: (1) whole-chunk drops at admission or commit
// trim that hold the cap, (2) an output append that rejects or exceeds
// OUTPUT_APPEND_TIMEOUT_MS — its raw bytes re-enter the pending count, and a
// late success after a timeout is conservative over-counting, never
// under-counting, and (3) chunks absorbed after beginOutputShutdown() that no
// bounded flush round managed to carry. Every counted loss resurfaces as one
// readable "[log-queue] dropped N output bytes" line on the next carrier that
// lands.
const OUTPUT_COMMIT_BYTES = 8192;
const OUTPUT_COMMIT_IDLE_MS = 50;
const OUTPUT_CAP_BYTES = 262144;
// Output-append wall-clock bound: a hung appendFile cannot hang the exit
// flush. OPENTRAY_TEST_LOG_APPEND_TIMEOUT_MS is the test seam that shrinks it.
const OUTPUT_APPEND_TIMEOUT_MS = Number(process.env.OPENTRAY_TEST_LOG_APPEND_TIMEOUT_MS) > 0
  ? Number(process.env.OPENTRAY_TEST_LOG_APPEND_TIMEOUT_MS)
  : 5000;
const FLUSH_MAX_DRAIN_ROUNDS = 8;
const outputChunks = [];
let outputBufferedBytes = 0;
let outputInFlightBytes = 0;
// Drop accounting (Codex R4 P1): pending = counted losses no carrier has
// taken yet; the in-flight figure = losses a submitted carrier is reporting
// right now. A commit MOVES pending into its carrier's reservation, and only
// that carrier's own completion retires or returns it, so concurrent commits
// can never double-carry an episode or drive the accounting negative (the
// old single global counter subtracted stale snapshots and suppressed later
// markers).
let outputDroppedBytesPending = 0;
let outputInFlightDropBytes = 0;
let outputShutdown = false;
let outputTimer = null;
let outputTail = Promise.resolve();
// One output append, wall-clock bounded. Resolves true when landed, false
// when rejected or timed out (the bytes then count as lost).
const appendOutputBounded = (payload) => new Promise((resolveWrite) => {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resolveWrite(false);
  }, OUTPUT_APPEND_TIMEOUT_MS);
  appendLogLine(payload).then(
    () => { if (!settled) { settled = true; clearTimeout(timer); resolveWrite(true); } },
    () => { if (!settled) { settled = true; clearTimeout(timer); resolveWrite(false); } },
  );
});
const commitOutputBuffer = () => {
  if (outputTimer !== null) { clearTimeout(outputTimer); outputTimer = null; }
  if (outputChunks.length === 0 && outputDroppedBytesPending === 0) return;
  const carriedDrops = outputDroppedBytesPending;
  outputDroppedBytesPending = 0;
  outputInFlightDropBytes += carriedDrops;
  const marker = carriedDrops > 0
    ? "[log-queue] dropped " + carriedDrops + " output bytes\\n"
    : "";
  // Marker bytes count inside the cap (Codex R4 P2): the whole submitted
  // payload — marker included — must fit the budget not yet taken by
  // in-flight appends. Whole oldest chunks that do not fit drop now and join
  // the NEXT carrier's count (one chunk is the drop granularity everywhere).
  if (Buffer.byteLength(marker) > OUTPUT_CAP_BYTES - outputInFlightBytes) {
    // Even the marker alone does not fit (in-flight holds the full cap):
    // return the episode to pending and keep the chunks buffered; the flush
    // drain loop retries once the held appends land.
    outputDroppedBytesPending += carriedDrops;
    outputInFlightDropBytes -= carriedDrops;
    if (outputBufferedBytes > 0) { outputTimer = setTimeout(commitOutputBuffer, OUTPUT_COMMIT_IDLE_MS); }
    return;
  }
  while (outputChunks.length > 0
      && Buffer.byteLength(marker) + outputBufferedBytes > OUTPUT_CAP_BYTES - outputInFlightBytes) {
    const oldest = outputChunks.shift();
    const size = Buffer.byteLength(oldest);
    outputBufferedBytes -= size;
    outputDroppedBytesPending += size;
  }
  const text = outputChunks.join("");
  outputChunks.length = 0;
  outputBufferedBytes = 0;
  const rawBytes = Buffer.byteLength(text);
  const payloadBytes = Buffer.byteLength(marker) + rawBytes;
  outputInFlightBytes += payloadBytes;
  const write = outputTail.then(() => appendOutputBounded(marker + text));
  write.then((landed) => {
    outputInFlightBytes -= payloadBytes;
    if (landed) {
      // The drop record is durable only now that its carrier append landed.
      outputInFlightDropBytes -= carriedDrops;
    } else {
      // Lossy-by-design (Codex R4): a rejected or timed-out carrier returns
      // its episode to pending and counts its own raw bytes as dropped, so
      // the next successful carrier re-reports the full total.
      outputInFlightDropBytes -= carriedDrops;
      outputDroppedBytesPending += carriedDrops + rawBytes;
    }
  });
  outputTail = write.then(() => {});
};
const beginOutputShutdown = () => { outputShutdown = true; };
const logOutputChunk = (text) => {
  const size = Buffer.byteLength(text);
  if (outputShutdown) {
    // Quiescence barrier (Codex R4): after shutdown begins, chunks never
    // enter the chain and never schedule commits — their bytes join the
    // count the final flush marker carries.
    outputDroppedBytesPending += size;
    return;
  }
  outputChunks.push(text);
  outputBufferedBytes += size;
  // Hard cap BEFORE the coalescing thresholds: over-cap data must drop, not
  // graduate into an in-flight append that only the disk can drain. One
  // whole chunk is the granularity: a single chunk larger than the cap drops
  // whole (its byte count lands in the marker), and the transient memory
  // bound is cap + largest single chunk.
  while (outputBufferedBytes + outputInFlightBytes > OUTPUT_CAP_BYTES && outputChunks.length > 0) {
    const oldest = outputChunks.shift();
    const droppedSize = Buffer.byteLength(oldest);
    outputBufferedBytes -= droppedSize;
    outputDroppedBytesPending += droppedSize;
  }
  if (outputTimer !== null) { clearTimeout(outputTimer); outputTimer = null; }
  if (outputBufferedBytes >= OUTPUT_COMMIT_BYTES) {
    commitOutputBuffer();
  } else if (outputBufferedBytes > 0) {
    outputTimer = setTimeout(commitOutputBuffer, OUTPUT_COMMIT_IDLE_MS);
  }
};
const flushLogQueue = async () => {
  // Bounded drain (Codex R4): each round commits what fits and awaits BOTH
  // chain snapshots; if anything new was submitted — or drops are still
  // uncarried — the next round picks it up, for at most FLUSH_MAX_DRAIN_ROUNDS
  // rounds. Flush is a barrier with a budget: it always resolves, even over a
  // rejecting or hung appendFile (each output append is wall-clock bounded
  // and its loss is counted). Milestone awaits stay bounded by appendFile
  // itself, which remains the durability contract for milestone records.
  for (let round = 0; round < FLUSH_MAX_DRAIN_ROUNDS; round += 1) {
    const logBefore = logQueueTail;
    const outBefore = outputTail;
    commitOutputBuffer();
    await logQueueTail;
    await outputTail;
    if (logQueueTail === logBefore && outputTail === outBefore
        && outputChunks.length === 0 && outputDroppedBytesPending === 0) {
      return;
    }
  }
  // Round budget exhausted while output was still arriving: give the final
  // counted total one last bounded carrier instead of dropping it silently.
  commitOutputBuffer();
  await logQueueTail;
  await outputTail;
};
`;
