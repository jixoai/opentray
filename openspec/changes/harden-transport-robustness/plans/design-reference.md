# Design Reference — Phase C/D: Death Detection, Supervision, and Recovery

Working design for W2/W4/W5/W6. Phase A (client deadlines, W1/W3) and Phase B
(broker write discipline, W7) land first; this document freezes the seams
they must have left open and the architecture built on them.

## Implementation rulings (recorded at Phase C/D landing, commit 18bb4e1e)

Deviations from the working design below, adjudicated during implementation:

1. **Rebuild callback signature** is `(context: { generation, sessionId })`:
   replayed show frames and orchestration owner tuples need the fresh
   generation's session id, not just a generation number.
2. **Caller-intent marking** rides the Phase A frozen teardown budget class
   (`deadlineMs === TEARDOWN_CALL_DEADLINE_MS`) instead of requiring destroy
   paths to call `shutdown()` first — otherwise closing first would swallow
   the destroy-tray frame. `shutdown()` still marks synchronously.
3. **`destroy-tray` success evicts the tray's journal entries** — a destroyed
   tray must not resurrect on recovery (journal mirrors declarative state).
   `load-ext` entries survive (mounts are app-scoped, not tray-scoped).
4. **`resolve-default-app` is journaled** and replayed; the new generation's
   default-app response is the appId authority and rewrites later frames.
5. **Snapshot re-emit covers the queryable families** (`visibleChange`,
   `moved`, `resized`); `focus` and style families have no query verb on the
   frozen v1 command surface and stay edge-only (documented, not silent).
6. **Budget debits per attempt** (success also consumes) — the literal
   "3 respawns per window" reading.
7. **Tier 2 state sequence** is `healthy → recovering → abandoned` (death
   edge enters recovering; terminal abandoned after the callback).

Known recovery-scope boundary: the journal covers the declarative surface
(createTray options, last-set mutations, mounts, declared windows/styles).
Incremental post-bootstrap orchestration changes (runtime
createWebview/setLayout/channel mutations beyond the declared options) are
not retained yet — a later retention layer can extend the journal without
contract change.

## Placement

A new supervision layer in `packages/cli` sits between `connectLocalBroker`
and the public `createTray`:

```
sdk.ts createTray()
   └── SupervisedLocalBrokerConnection        (new, packages/cli/src/transport-supervision.ts)
         ├── owns one LocalBrokerConnection at a time
         ├── heartbeat (ClientFrame::Health round-trip, Phase A deadline machinery)
         ├── respawn via existing startDaemon/driver machinery (identity gates unchanged)
         ├── declarative journal (core) + registered rebuild callbacks (extension facades)
         └── state machine: healthy → recovering → (healthy | abandoned)
```

`LocalBrokerConnection` itself stays single-connection and single-lifetime
(its D3 single-flight death contract is per-connection truth). The
supervisor creates a NEW connection per generation — it never resurrects a
dead one. This preserves every existing per-connection law verbatim.

## Heartbeat (W2)

- Round-trip: `request({ type: "health", requestId })` — the frame already
  exists (`ClientFrame::Health`, answered with `runtime-host-health`).
- Cadence: timer fires every `heartbeatIntervalMs` (default 30_000) when no
  other request completed successfully within the interval (idle-gated: a
  busy transport proves its own liveness; the probe budget is only spent on
  silence).
- Probe deadline: `probeDeadlineMs` (default 3_000) through Phase A's
  per-call deadline param.
- Death declaration: `3` consecutive probe failures (deadline expiry,
  transport-lost, or error frame) → supervisor declares death. A socket
  close/error declares death immediately (existing markDead path).
- Phase A seam consumed: the supervisor subscribes to
  `onConnectionDead` + reads the deadline-expiry hook to attribute probe
  failures. No semantic-API probing (`isVisible` polling stays dead).

## State machine and event surface (W6 Tier 1)

```
healthy ──uninvited death──▶ recovering ──reconnect+replay ok──▶ healthy
                                │
                                └──budget exhausted / respawn failed──▶ abandoned (terminal)
```

- `transportStateChange` fires on edges only. Initial state on a successful
  `createTray` is `healthy` (no event for the initial state — consumers
  reading current state use the accessor).
- Surface: runtime-level (`CreateTrayHandle.onTransportStateChange`) since
  the connection is owned by `createTray`, not by individual trays.
  Per-connection `onConnectionDead` keeps firing per generation (consumers
  who used it for cleanup keep working); the supervisor's state events are
  the new, higher-level truth.
- `abandoned` is terminal for the runtime instance: every later handle call
  fails fast with the typed `TransportAbandonedError` (code
  `transport_abandoned`, details `{ recoveries, windowMs }`). A new
  `createTray` call starts a fresh supervisor (fresh budget) — deliberate:
  process-level restart resets budgets; in-process recreation does too.

## Declarative journal (W4)

Two layers, one replay order:

1. **Core journal** (owned by the supervisor, recorded by wrapping the
   client's mutating calls): `resolve-default-app`, `set-app-name`,
   `set-app-icon`, `set-app-icon-variant`, `create-tray` (full options),
   `set-tray-menu`, `set-tray-icon`, `set-tray-tooltip`, `load-ext`
   (name + exact resolved path + expectedIdentity + mountId). Last-write-wins
   per key (menu/icon/tooltip), creation order for trays/mounts.
2. **Facade rebuild callbacks** (extension layers register at `extend()`
   time): `registerRebuild(rebuild: (tools) => Promise<void>)`. ext-webview
   registers one per window: re-`show` with retained `WebviewWindowOptions`,
   re-apply last-set style (initial options + accumulated patches, retained
   facade-side), re-issue event subscriptions (existing
   `resubscribeWindowEvents` shape), then query native state (visibility/
   focus/geometry) and synthesize the full-state snapshot events.

Replay sequence on recovery: reconnect+handshake → core journal replay in
order → facade rebuild callbacks in registration order → snapshot queries →
state events (`healthy`). Any replay step failing typed-fatal (artifact
identity mismatch etc.) counts as a failed respawn attempt (budget tick).

Snapshot re-emit contract: after `healthy` re-fires, event consumers can
resync from the synthesized snapshot; the lost-events window is bounded by
detection (≤ 3×30s+3s idle worst case) + respawn/replay time. ext-webview
page reload from URL is contract.

## Budget and respawn (W5)

- `recovery: { maxRestarts = 3, windowMs = 600_000, cooldownMs = 1_000,
  backoffFactor = 2 (cap 30s) }` — in-memory per supervisor (ruling:
  process memory, matching "manual restart resets budget").
- Respawn uses the existing `startDaemon` path unchanged: lock reclaim,
  artifact identity gates, ready-file budget all apply. The supervisor adds
  only: wait cooldown → attempt → reconnect → replay; on failure count and
  retry within budget.
- Tier 2 `recovery.restartApp`: when provided, on uninvited death the
  supervisor performs bounded teardown (Phase A budgets) then invokes the
  callback exactly once and goes terminal (no in-process rebuild, no
  respawn loop).

## Zero-config ladder

- Tier 0: nothing — supervisor is constructed by `createTray` by default.
  Graceful `destroy()`/`close()` bypasses recovery entirely (caller intent).
- Tier 1: `tray.onTransportStateChange(cb)`.
- Tier 2: `createTray(options, { recovery: { restartApp } })`.
- All keys defaulted; the object is optional; unknown keys ignored
  forward-compatibly.

## Test topology (Phase C/D)

- Half-open fixture: in-process fake broker socket that stops answering
  (assert bounded death declaration + in-flight rejection).
- Kill drill (W8): spawn the real broker via the normal machinery, kill -9
  the process (PID from ready metadata), assert recovery within budget and
  zero consumer recovery code.
- Deterministic wedge: fake respawn that always fails → budget exhaustion →
  fail-fast + `abandoned` + no loop.
- Journal replay: fixture asserting declarative state (menu/icon/mounts/
  window style) after simulated recovery matches pre-death state.

## Explicitly out of scope here

- App-process restart vectors (Tier 2 hands over).
- Cross-restart WebView page-state preservation (reload is contract).
- Persisted budgets, broker-initiated heartbeats, new wire frames
  (Health + existing commands suffice).
