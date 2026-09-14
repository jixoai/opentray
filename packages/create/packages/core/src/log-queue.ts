// Orthogonal intents (2026-09-15, Codex R2 P1 fix for the
// harden-lifecycle-ownership D5 "Healthy startup writes a readable narrative"
// scenario):
// 1. Render the serial app.log append queue as one real JS source string
//    embedded verbatim by url-entry-template.ts and entry-template.ts — the
//    same single-source pattern toolbar-carrier.ts uses, so both generated
//    entries share ONE queue implementation by construction, and the toolbar
//    carrier shares it transitively through its `options.event` sink.
// 2. Concurrent appendFile completions have no happens-before: fire-and-forget
//    milestone records could land out of execution order (listenShell was
//    observed on disk before createTray), and a fast process.exit could drop
//    unflushed successful records. Every app.log append therefore flows
//    through one promise chain — a record is submitted only after the
//    previous one landed on disk — and every exit path awaits
//    flushLogQueue() before process.exit.
// 3. The record format (JSON line, step/status fields) and the milestone
//    semantics are unchanged; the healthy-path cost is one sequential await
//    per record, bounded by appendFile itself.
// 4. Test seam (minimal invasion): OPENTRAY_TEST_LOG_JITTER=1 delays each
//    physical append by a random 0–30 ms so the ordering test observes the
//    deterministic narrative an unserialized writer would scramble.
//
// Embedding contract: the host template supplies `appendFile` (from
// node:fs/promises) and `appLogPath` in scope — the same embedding style the
// toolbar carrier relies on for column/fixed/grow.

/** The generated-entry serial app.log append queue. Replaces the old
 * fire-and-forget `appendFile.bind(undefined, appLogPath)` logSink: submission
 * order becomes disk order, and exits can await the drain. */
export const logQueueSource = (): string => `// Serial app.log append queue (Codex R2 P1, 2026-09-15): appendFile
// completions have no happens-before, so milestone records must never race.
// Every append flows through one promise chain — a record is committed only
// after the previous one landed on disk — and exits await flushLogQueue().
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
const flushLogQueue = () => logQueueTail;
`;
