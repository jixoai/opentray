# Vision-Driven Self Review

## Review State

- Change: `harden-transport-robustness` (issue #11 — transport robustness handoff)
- Iteration: 1 (implementation rounds A→E each internally reviewed; one review-fix loop on Phase A, one hardening addition on Phase B)
- Recurring issue counts: none surviving across rounds
- Exit-condition judgment: exit normally — every W-item has landed evidence; the global acceptance criteria of issue #11 are met to the extent verifiable without a live consumer migration (see Open Questions)

## Implementation vs Intent (macro review)

The intent contract was: a lost reply must surface as a bounded typed
rejection; broker death must surface as an event within bounded time; no
promise may hang; default recovery requires zero consumer code. The landed
shape honors each clause:

- **W1/W3 (Phase A, commits `09cc0e07`+`f059dc7a`)**: per-call deadlines in
  the transport (5s/2s/10s classes), typed `TransportTimeoutError`, stateless
  late-settlement discard, bounded `close()`/`destroy()`. Review round 1
  caught the deferred-operation regression (a >5s user-held dialog would have
  been deadline-killed) and codified the two-phase law into the spec:
  dispatch-to-acceptance is bounded; accepted operations are
  liveness-bounded. This was the single intent-level correction of the round.
- **W7 (Phase B, `c918d704`+`da731621`)**: Unix owner loop no longer touches
  client socket IO (bounded 1024-frame FIFO + writer thread); write
  failures/full queues escalate through the reader's own Disconnected path
  with one-shot dedup; escalation additionally shuts the socket down so a
  parked writer thread exits (orchestrator hardening added in review);
  Windows pump bounded symmetrically. H3 (loop-exited-but-alive broker) was
  proven real by a standalone probe, then fixed (nonblocking accept + 20ms
  poll, 500ms bounded join with detach, `(dev,ino)`-guarded endpoint
  removal). Windows real-machine evidence via the LAN relay: 131/131
  including the five mirrored escalation tests.
- **W2/W4/W5/W6 (Phase C+D, `18bb4e1e`)**: supervised transport with
  idle-gated heartbeat death detection, generation-swapped connections (D3
  per-connection semantics preserved), frame-sniffed declarative journal with
  trayId injection and destroy eviction, recovery through the original
  identity-gated connect path, 3-per-10-min in-memory budget, Tier 1 state
  events, Tier 2 hand-over, and the ext-webview window rebuild with
  synthesized snapshot re-emit. Seven implementation rulings recorded in
  `plans/design-reference.md`.
- **W8 (Phase E, `68dc791f`)**: permanent drill gate — the kill leg runs a
  real broker from this checkout's cargo outputs (loud skip with build
  instructions when absent) and asserts the full recovery cycle with a
  five-line consumer; the exhaustion leg is deterministic and always runs.
- **W9 (Phase E, `ad737c25`)**: consumer reference
  (`skills/opentray/references/transport-robustness.md`) + routing + the cli
  README API contract section.

Issue #11 global acceptance, item by item:

1. Zero-code-change consumer survives `kill -9` — proven by the drill
   (macOS, real process).
2. No public handle method can hang forever — transport-level deadlines
   cover every request path; teardown wall-clocked; deferred completions are
   liveness-bounded (death detection bounds the bad case).
3. Budget exhaustion degrades to fail-fast + event — drill exhaustion leg.
4. The drill is a permanently green gate — `transport-drill.test.ts` in the
   standard suite (185/185 locally with the drill active).
5. pnpm-pub can delete its compensation layers on adoption — the SDK now
   provides every mechanism its `raceTimeout`/watchdog/tray-host layers
   compensated for; the deletion itself belongs to the consumer repo and is
   listed under Open Questions as the adoption follow-up.

## Deviations from intent

1. **Snapshot re-emit covers only queryable families** (visibleChange,
   moved, resized). Focus/style stay edge-only because the frozen v1 command
   surface has no query verbs for them. Documented in the consumer contract;
   not silent.
2. **Incremental post-bootstrap orchestration is not retained** by the
   journal (runtime createWebview/setLayout beyond declared options). The
   declarative surface is covered; the retention layer for imperative
   orchestration is future additive work. Documented.
3. **Budget is per-attempt-debited and in-memory** (rulings 6/7 in
   design-reference) rather than success-refunded or persisted — matches the
   issue's literal window semantics and the "manual restart resets" UX.
4. **The drill's kill leg requires a built broker binary** and skips loudly
   without one (deterministic exhaustion leg always runs). CI legs that
   build Rust get the full drill.
5. **Recovery replays do not re-verify against a broker that lost native
   extension state** beyond the artifact identity gates — the existing
   load-ext identity law is the trust boundary, unchanged by this change.

## New questions requiring user confirmation

1. **Codex review**: taken by default as "not started, zcode-subagent
   cross-review replaced it" (Owner unreachable at the question gate). The
   change is mechanism-level; an Owner may still request a herdr Codex pass
   before release.
2. **Tier-0 default-on in the next minor release** is the issue's core ask
   and is shipped enabled; consumers whose `onConnectionDead` handlers exit
   the process will now race automatic recovery. The changelog and consumer
   reference document this loudly, but Owner sign-off on the release note
   framing is welcome.
3. **pnpm-pub adoption** (deleting its compensation layers) is the
   layering test the issue defines; it belongs to that repository and should
   follow this release.
4. **Windows TS drill leg** auto-skips without a locally built broker
   binary; a relay-host run of the full drill (not only the Rust suite) can
   be scheduled if Owner wants real-machine TS-side evidence there too.

## Evidence

- Local gates: `pnpm --filter opentray test` 185/185; typecheck clean;
  `@opentray/ext-webview` 82/82 + typecheck; `cargo test -p opentray-bin`
  146/146 (also via `mbx test`); Windows relay `cargo test -p opentray-bin`
  131/131; verify legs green (spec-consistency, vision tests 49, binaries,
  schemas, `openspec validate --all --strict` 58 items, `git diff --check`);
  builds green for both changed packages.
- Environment note: the full recursive `pnpm run test` leg surfaces a
  pre-existing local vitest worker-startup flake in `packages/create`
  (4 workers time out; all tests still pass; reproduced identically with
  baseline sources `6dbc6f20` checked out, single-file runs clean, CI green
  at baseline). Not caused by this change; CI remains the authoritative
  gate for that leg.
- Drill transcript: `/tmp/drill-test6.log` (kill leg + exhaustion leg green,
  5.5s); broker log preserved per-run under the drill's temp home
  (`broker.log`, cleaned after the run).
- Commits (main, this change): `918ec9a5`, `90758c46`, `35639433`,
  `09cc0e07`, `f059dc7a`, `ec86c589`, `c918d704`, `b7d8e844`, `da731621`,
  `2b70916e`, `18bb4e1e`, `34d30a01`, `68dc791f`, `ad737c25`, `87f5f8fb`,
  plus the changeset commit. Uncommitted: none (working tree clean except
  the pre-existing untracked `.agents/documents/d19-extension-event-port-design.md`
  left by a prior session, deliberately untouched).
- Task checkboxes updated only for this change's context, each with commit
  and test evidence inline.

## Exit condition judgment

Intent's exit conditions: drill green (met — three consecutive local runs
plus the suite run), no recurrence of the wedge class (the three W7 root
causes each have a structural fix and regression tests), review iterations
under budget (1 formal self-review round; two in-flight review fixes, none
recurring). Recommend archive.
