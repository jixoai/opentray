# Intent Document

## Current Round

- Round: 1
- Status: research-plan drafted (awaiting Owner rulings on open questions)
- Previous plan backup: none (first version)

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## User's Original Requirement

Source: GitHub issue #11 ("Transport robustness handoff: bounded round-trips,
broker-death detection, zero-config in-process session rebuild"), filed from
the pnpm-pub 2026-09-15→09-18 silent-wedge incident. Owner's handoff
(2026-09-19) designates #11 as the body of the next version. Key verbatim
contract:

> A lost/never-delivered transport reply must surface as a **bounded, typed
> rejection**. Broker death must surface as an **event** within a bounded time.
> Neither may ever manifest as a promise that never settles. And the default
> recovery must require **zero consumer code**.

And the integration-cost answer:

> Tier 0 — default-on, no code change on upgrade … Failure modes become
> "flicker" or "explicitly dead" — never silence.

Design intent quote: "mechanism goes into opentray (deadlines, death
detection, broker supervision, session rebuild); policy stays in the app
(restart vectors, budgets-as-configured, health vocabulary projection). Done
right, consumers **net-delete code** on adoption."

The incident's cost driver, in the Owner's framing: not the lost reply, but
**zero observability** and **unsettling promises** (queued ops that never
start produce no failure log at all).

## Owner Language System (vocabulary to preserve)

- 零配置 (zero-config) ladder: Tier 0 default-on / Tier 1 one-event-hook /
  Tier 2 one-function-hook.
- "flicker or explicitly dead — never silence" (闪一下或明确死掉，绝不静默).
- 机制进 SDK、策略留应用 (mechanism into the SDK, policy stays in the app).
- In-process session rebuild replaces app-process restart for most consumers.
- Full state snapshot re-emit after recovery (the "lost events window" must be
  resyncable).
- Budget exhaustion ⇒ fail-fast handles + `abandoned` event, app survives
  headless (保持无头运行).
- half-open transport (半开运输): both processes alive, neither direction
  delivered — distinct from the already-handled socket-close case.

## Facts (code evidence, surveyed 2026-09-19/20)

### Client transport (`packages/cli/src/local-broker.ts`)

- Request-reply correlation exists (`pending` map, `dispatchFrame`); the
  socket-close family is fully handled: single-flight `markDead()`
  (local-broker.ts:610), post-death requests reject immediately (:411-413),
  deferred operations reject typed `extension_transport_closed` (:94-99).
  This is the 0.24-0.28 + F2 (2026-09-14) work. **It only covers a socket
  that actually closes.**
- No per-call deadline exists anywhere in the client: a half-open transport
  holds `pending` entries forever; `close()` waits on `socket.end` forever.
- No heartbeat: nothing sends `ClientFrame::Health` spontaneously (it exists
  on the wire purely as a request the CLI health command issues).
- `LocalBrokerClient` already publishes `connectionDead` +
  `onConnectionDead` (:131-137); `EventfulTrayHandle.onConnectionDead`
  surfaces it (client.ts:160, :462-464). This is the seam W2 extends.

### Broker transport (Rust, `crates/opentray-bin`) — W7 evidence

Survey pinned to 0.27.4 (`63c8782b`) and re-checked at HEAD; the incident-era
topology is unchanged:

- Unix writer is a synchronous blocking `write_all` under a per-session
  mutex, executed **inline on the winit/AppKit owner loop thread**
  (unix_transport.rs:520-525). All call sites of `write_frame` on macOS run
  on that one thread (main.rs write sites: 860, 886, 912, 954, 1087, 1103,
  1126, 1150, 1270).
- **Write errors are discarded**: `pub fn write_frame(&mut self, frame) {
  let _ = write_frame(&self.writer, &frame); }` (unix_transport.rs:96-98).
  The broker log line `opentray app reopen requested` (main.rs:1259-1274)
  only proves the `eprintln` ran — it is **not** evidence the frame reached
  the client. This alone explains the incident's "3 reopen logs, client saw
  none".
- Reader threads block on `BufReader::lines()` with no timeout; only a real
  EOF/error produces `TransportEvent::Disconnected` (unix_transport.rs:487-518).
  AF_UNIX has no keepalive. A half-open connection = reader blocked forever,
  session never cleaned.
- No heartbeat/keepalive/idle-write-timeout exists anywhere in the crate
  (grep-verified). Broker never probes clients.
- If the client stops draining, the ~8 KB kernel socket buffer fills and the
  next owner-loop `write_all` **blocks the AppKit main thread forever holding
  the writer mutex** — the whole broker freezes while staying alive.
- Windows is asymmetric: an **unbounded** `mpsc` queue + dedicated pipe-pump
  thread (windows_transport.rs:30, :168-224), so the owner loop never blocks,
  but a dead client grows the queue without bound; pump write errors go
  unobserved in the same "silent" way.
- `event hub shutdown` log line = winit loop exit marker, printed from
  `exiting()` (event_hub.rs:508-529, main.rs:825-837). Its presence in the
  wedge window proves some broker generation's loop had exited while the
  process tree stayed alive.
- Known post-incident divergence: the App Nap activity assertion
  (`54d61b9d`, 2026-09-15) postdates 0.27.4 and was already ruled out as the
  primary cause by the D6/D7 investigation notes.

**W7 root-cause hypothesis ranking** (from the above):

1. **H1 dead-session black hole** — half-open socket + swallowed write
   errors + no liveness detection. Broker "healthy", writes go to a kernel
   black hole or return swallowed EPIPE; client sees nothing. Explains all
   three observations with zero broker-side errors.
2. **H2 owner-loop write freeze** — client stops draining first; buffer
   fills; `write_all` parks the AppKit thread forever. Broker freezes after
   the reopen logs stop. (Falsifiable against the incident log: if any broker
   output continues after the third reopen line, H2 is out.)
3. **H3 loop-exited-but-process-alive** — `exiting()` + `listener.shutdown()`
   join can hang when the endpoint file was rebound; reader threads keep
   swallowing client frames with `proxy.send_event` errors discarded
   (main.rs:665-667). Explains the `event hub shutdown` lines.

All three are killed by the same three broker-side repairs: (a) escalate
write failure to session disconnect, (b) never block the owner loop on
socket writes (bounded outbound queue + writer thread, Unix), (c) a
liveness round-trip the client can rely on (existing `Health` frame
suffices; detection lives client-side where the incident's victim lived).

### Client SDK surface (`packages/cli/src/client.ts`, `sdk.ts`)

- `createTray()` (sdk.ts:63) owns its connection; `destroy()` removes the
  tray then closes the connection exactly once, treating the transport-close
  sentinel as the desired end state (P3.6). This caller-initiated path must
  keep its exact semantics — recovery never triggers on it.
- Handles are thin closures over `transport.request` with no retained
  declarative state at the core layer (client.ts:311-434); `sdk.ts` retains
  initial menu handler bindings but not last-set mutations.
- `@opentray/ext-webview` retains `WebviewWindowOptions` per window handle
  closure (index.ts:1036-1054), already has `resubscribeWindowEvents`
  (:1107-1111), and window events are push/subscription-based since D19 —
  the pieces a replay-based rebuild needs exist in embryo.
- Extension mounts carry exact resolved artifact paths + expected identity
  through `loadExtension` (client.ts:357-370) — replayable by construction.

### pnpm-pub reference implementation (consumer side)

Local at `/Users/kzf/Dev/GitHub/pnpm-pub`, commits `3db0eff` (impl+tests) and
`36a5843` (spec) present. Field-validated constants for SDK defaults:
interactive deadline 5 s, teardown 2 s, bootstrap `show()` 10 s, probe 3 s
deadline × 3 consecutive failures @ 30 s interval, recovery budget 3
restarts / 10 min. Its `raceTimeout` is race-only (no cancellation); its
watchdog probes `isVisible()` because the SDK exposes no cheaper liveness —
both are compensations W1/W2 delete. Its process-respawn machinery (env
marker, IPC socket release wait, budget file) is app policy and stays out.

## Inferences

- The client-side death machinery is sound but blind: it needs (1) a
  deadline on every outstanding call and (2) a heartbeat to convert
  "half-open forever" into "dead within bounded time". Both belong in
  `LocalBrokerConnection` / a supervision layer above it — not in every
  handle method (per-method wrapping is exactly the pnpm-pub mistake of
  mechanism-in-the-app).
- Broker-side repairs (a)/(b)/(c) are prerequisites for honest W2/W8: client
  heartbeat deadlines only bound the client's exposure because the broker
  currently has failure modes where it cannot answer anything (H2) or where
  answers vanish silently (H1). Fixing the client without the broker leaves
  the drill (kill -9) green but the original incident class (wedge with both
  alive) only half-covered — the client would recover by respawning, which
  is W4 doing the cleanup. That is acceptable defense-in-depth, but the
  broker-side discipline is the road repair the issue explicitly demands
  (W7).
- In-process rebuild is feasible without wire protocol changes: reconnect →
  replay declarative journal (tray options, last-set menu/icon/tooltip,
  extension mounts with exact artifact identity, webview windows with
  options+styles) → re-subscribe events → query native state → synthesize
  full-state snapshot events. The WebView page reload semantics are already
  the documented contract (issue: "same as a user refresh").
- Tier-0 default-on recovery changes observable behavior for consumers who
  today treat `onConnectionDead` as terminal. The graceful split is:
  caller-initiated `close()`/`destroy()` never recovers; only uninvited
  death does. `onConnectionDead`'s contract stays true per-connection; the
  supervisor adds a new, higher-level state (`transportStateChange`) rather
  than mutating the old event's meaning.

## Decisions (this change's design direction)

1. **New capability spec `transport-robustness`** owns the cross-cutting
   contract family (deadlines, liveness, bounded teardown, recovery ladder,
   broker write discipline). Client public API deltas land in the same spec's
   scenarios; `client-sdk` existing requirements are not rewritten.
2. **W1 — per-call deadlines in the transport layer.**
   `LocalBrokerConnection.request()` races every pending entry against a
   deadline (default 5 s; init/bootstrap budget 10 s+ ready-file cold start
   already covered by the existing readiness budget; teardown-class frames
   2 s). Late settlements after a deadline are discarded safely (the pending
   entry is gone). Typed rejection taxonomy: `TransportTimeoutError` (no
   answer in budget) vs transport-lost (`BROKER_CONNECTION_CLOSED_MESSAGE`
   family / typed `extension_transport_closed` for deferred ops) vs
   broker-rejected (`BrokerServerError` / `ExtensionOperationError` —
   unchanged). A W1 timeout does NOT itself declare the transport dead; it
   is one heartbeat-failure-class signal for W2.
3. **W2 — liveness + death detection.** A client-side heartbeat using the
   existing `ClientFrame::Health` round-trip (socket-level truth; not a
   semantic API probe — the issue's explicit note that `isVisible()` polling
   was a heuristic compensation). Idle-interval 30 s, deadline 3 s, 3
   consecutive failures ⇒ declare dead (same numbers as the field-validated
   reference; overridable). On declared death: reject all in-flight
   promptly (existing `markDead` path), emit `transportStateChange`. Broker
   side: write errors escalate to `Disconnected` (no `let _ =`); Unix owner
   loop never performs blocking socket writes (bounded outbound queue +
   writer thread); Windows queue becomes bounded with the same escalation.
4. **W3 — bounded teardown.** Wall-clock bounds on `destroy()` /
   `close()` paths (2 s per native teardown + queue drain, 10 s total
   stop-path budget at the runtime level) so a wedged handle can never wedge
   consumer shutdown. Graceful-close sentinel semantics (P3.6) preserved.
5. **W4 — auto-respawn + in-process session rebuild (Tier 0).** On
   uninvited transport death: cooldown backoff → respawn broker through the
   existing spawn machinery (`startDaemon` + driver + identity gates) →
   reconnect + handshake → replay the declarative journal (core mutations +
   extension mounts + ext-webview windows/styles/subscriptions) → query
   native state → re-emit full state snapshot → resume. Consumers without
   Tier-1 subscriptions are unaware except a WebView page reload.
6. **W5 — recovery budget + give-up.** 3 respawns / 10 min window (defaults
   overridable). In-memory per-process by default — matching the semantics
   "a manual app restart resets the budget" (persistence across app
   restarts would fight exactly that; see Open Questions). Exhaustion ⇒
   supervisor stops recovering, every handle method fails fast with a typed
   `transport_abandoned`-family rejection, final `transportStateChange:
   "abandoned"` fires, app keeps running headless.
7. **W6 — hooks.** Tier 1: `onTransportStateChange` event surface
   (`healthy | recovering | abandoned`). Tier 2: `createTray(options, {
   recovery: { restartApp: () => … } })` — when provided, replaces in-process
   rebuild (the supervisor hands over after teardown). One optional config
   object; every key defaulted; not configuring = full protection.
8. **W7 — broker-side road repair** (same change; see phasing below):
   write-error escalation, owner-loop write discipline, plus the H3
   join-hang investigation folded into the same Rust batch.
9. **W8 — the drill as a permanent gate.** Integration test: minimal
   ~5-line `createTray` app, `kill -9` the broker, assert auto-recovery
   within one budget window with zero consumer recovery code; deterministic
   wedge simulation asserts budget exhaustion → fail-fast + `abandoned`
   (no hang, no loop). Runs on macOS CI/local; Windows acceptance via the
   LAN relay per repo law.
10. **W9 — docs.** `skills/opentray` consumer docs: page-reload-on-recovery
    as contract, lost-events window + snapshot re-emit guarantee, defaults
    table, Tier 0/1/2 ladder. Repo-internal laws land in AGENTS.md at
    archive time.

### Law vs atom

This change is a **regular atom under existing platform laws**, not a
paradigm shift — but it adds a new law family at archive time (transport
robustness: "no public handle method may hang forever"; "broker socket
writes never block the native owner loop"; "uninvited transport death is a
recoverable event, caller-initiated teardown is not"). Session authority,
single-writer bundle lock, endpoint identity, and the extension ABI are all
untouched. The closest prior law is the EventPort law's "an idle session
must deliver page-to-host messages without any command in flight" — this
change extends the same honesty to the reverse direction (host-to-client
delivery and request settlement).

## Intent-Driven Plan (phase → work items)

Phase A — client transport correctness (W1, W3):
  A1. Deadline race + late-settlement discard + typed timeout rejection in
      `LocalBrokerConnection` (per-call budget plumbing from handle level
      where needed: bootstrap vs interactive vs teardown classes).
  A2. Bounded `close()`/`destroy()` wall-clocks with P3.6 semantics intact.
  A3. Unit tests: never-settling calls reject in budget; late replies
      discarded; happy path adds no observable latency; teardown of a wedged
      handle stays bounded (port pnpm-pub scenario shapes).

Phase B — broker-side road repair (W7):
  B1. Unix: outbound frames move to a bounded per-session queue + dedicated
      writer thread; write/flush errors escalate to `Disconnected` through
      the existing transport-event path (session cleanup + ExitOwnedBroker
      behavior preserved).
  B2. Windows: pump queue becomes bounded; pump write failures escalate the
      same way (no unbounded growth against a dead client).
  B3. H3 investigation: listener-shutdown join path hardened so a rebound
      endpoint cannot park a loop-exited broker alive; evidence note in the
      change docs either way.
  B4. Rust tests: write-failure → disconnect escalation; owner-loop never
      blocks (queue-full policy = escalate, not park); half-open fixture
      (client stops reading) frees the broker within bounded time.

Phase C — death detection + state surface (W2, W6 Tier 1):
  C1. Client heartbeat (Health round-trip) with the default cadence; failure
      classification; declared death funnels into `markDead` + state event.
  C2. `transportStateChange` surface on the runtime/handle level; state
      machine `healthy → recovering → (healthy | abandoned)`.
  C3. Tests: half-open fixture (server that stops answering) declares death
      in bounded time and rejects in-flight calls promptly.

Phase D — recovery (W4, W5, W6 Tier 2):
  D1. Declarative journal at the supervision layer: core tray/app mutations,
      extension mounts (exact resolved artifacts), ext-webview window
      options/styles/subscriptions.
  D2. Respawn + reconnect + replay + snapshot re-emit sequence, with
      cooldown backoff and the in-process budget; fail-fast + `abandoned`
      on exhaustion.
  D3. `recovery.restartApp` Tier-2 hand-over.
  D4. ext-webview facade: drain/subscription lifecycle follows supervisor
      state; full state snapshot synthesized from native queries after
      rebuild.

Phase E — acceptance + docs (W8, W9):
  E1. The kill -9 drill as a permanent integration gate (macOS local + CI;
      Windows via relay).
  E2. Deterministic-bug simulation → budget exhaustion path.
  E3. Consumer docs in `skills/opentray`; changelog via changeset; version
      bump per monorepo law.

Phasing rationale: A and B are independently shippable robustness (promises
settle; broker stops lying); C needs B for honesty; D needs C; E gates D.
W7 stays in-change because W2/W8's acceptance depends on it (Open Questions
row 1 lets the Owner split it out if release timing demands).

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Enable Codex review (herdr + gpt-5.6-terra) for this change's design/implementation rounds? | Handoff says #11 is mechanism-level and recommends asking; last two changes shipped without Codex. | Ask before implementation round; if declined, zcode-subagents replace it. |
| Does W7 (broker-side Rust repair) ship in this change or as a separate fast-follow? | Same-change keeps W2/W8 honest; splitting gets client protections out sooner. | Same change (Phase B), per acceptance-criteria coupling. |
| Recovery budget persisted to disk (pnpm-pub style) or in-memory per process? | Persisted fights "manual restart resets budget"; in-memory matches in-process rebuild semantics. | In-memory per process. |
| Tier-0 default-on recovery in a minor release (0.x) — confirm acceptable behavior change for consumers who treat death as terminal? | `onConnectionDead` stays terminal per-connection, but apps that self-exit on it will now race auto-recovery. | Default-on (the issue's core ask); document loudly. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Per-handle-method deadline wrappers (pnpm-pub's shape at SDK scale) | Mechanism-in-every-method is the compensation being deleted; any new method reintroduces the incident shape. Deadlines belong in the transport's request path. |
| Polling a semantic API (`isVisible`) as the liveness probe | Issue's own note: heuristic that false-positives on a busy-but-alive broker. Socket-level `Health` round-trip is the truth source. |
| Broker-initiated heartbeat | The victim of the incident was the client; broker-side keepalive duplicates state for no additional coverage once client heartbeat + write escalation exist. Broker answers Health, as today. |
| App-process restart inside the SDK | SDK can never know entry paths/single-instance protocols; Tier 2 hook hands over instead. |
| Persisting recovery budget across app restarts by default | Breaks the validated "manual stop+start resets the budget" recovery UX; optional later. |
| Keeping synchronous owner-loop socket writes on Unix with only a write timeout | A timeout turns H2 into frame loss on the AppKit thread; the queue+writer-thread discipline is the structural fix (and matches the Windows topology already in-tree). |
| Protocol/wire changes (new frames for recovery) | Everything needed (Health, declarative replay through existing commands, event re-subscription) already exists on the wire; recovery is a client-side supervision concern. |

## Exit Conditions

- Default max review iterations: 3 (per repo review-state convention).
- Issue recurrence threshold: no reopen of the wedge class; the drill gate
  stays green 3 consecutive runs.
- Custom exit condition from intent: issue #11's global acceptance —
  (1) zero-code-change consumer survives broker `kill -9`; (2) no public
  handle method can hang forever; (3) budget exhaustion degrades to
  fail-fast + event; (4) the drill is a permanently green gate; (5) pnpm-pub
  can delete its compensation layers on adoption (net-negative consumer
  code).
