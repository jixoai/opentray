# Transport Robustness

What the OpenTray runtime guarantees when the connection to its broker
process fails, and the small surface for apps that want to observe or
override recovery. Applies to every app created through `createTray()`.

## What you get with zero code (Tier 0)

Upgrade with no code changes and every transport failure becomes bounded and
observable:

- **Every call settles.** Each request the runtime sends to the broker has a
  deadline. A reply that never arrives rejects with a typed
  `TransportTimeoutError` carrying the request id and the budget — never a
  promise that hangs forever.
- **Death is an event, not silence.** A broker process that dies, or a
  connection that goes silent (half-open), is detected within a bounded
  window and surfaced immediately.
- **Automatic recovery.** An *uninvited* death (anything except your own
  `destroy()`/shutdown) triggers: cooldown → broker respawn → replay of your
  declarative state (tray options, last-set menu/icon/tooltip, app name and
  icon, loaded extensions, WebView windows with their last-set styles and
  event subscriptions) → a full state snapshot re-emit → resume.
- **A bounded budget.** Recovery attempts are capped per sliding window.
  When the budget is exhausted the runtime stops retrying (no loop), every
  later call fails fast with a typed `TransportAbandonedError`, and your
  process keeps running effectively headless — you decide what to do.
- **Teardown never wedges.** `destroy()` and connection close are
  wall-clock bounded; a stuck broker cannot hang your shutdown path.

Failure modes become "a flicker while state is rebuilt" or "an explicitly
dead runtime with typed errors" — never a silent wedge.

## Default budgets

| Budget | Default | Notes |
| --- | --- | --- |
| Interactive calls | 5 s | Menu/icon/tooltip/state queries and extension commands |
| Teardown calls | 2 s | `destroy()` round-trips and connection close |
| Bootstrap calls | 10 s | Connection handshake and first bring-up |
| Heartbeat probe cadence | 30 s idle / 3 s probe deadline / 3 consecutive failures | A busy transport proves its own liveness; probes only run on silence |
| Recovery attempts | 3 per 10 min window | In-memory per runtime; a fresh process start resets it |
| Recovery cooldown | 1 s, doubling per failed attempt, capped at 30 s | |

Every value is overridable through the optional `recovery` runtime option —
and omitting the object entirely is the recommended, fully-protected default.

## The rejection taxonomy

| Rejection | Meaning |
| --- | --- |
| `TransportTimeoutError` | One call's budget expired without a correlated reply. Settles that call only; the transport itself is not declared dead. |
| Transport-lost (close sentinel family, typed `extension_transport_closed` for deferred extension operations) | The connection died while calls were pending. All in-flight calls reject promptly. |
| Broker-rejected (`BrokerServerError`, `ExtensionOperationError`) | The broker answered with a typed error — unchanged behavior. |
| `TransportAbandonedError` (code `transport_abandoned`) | The recovery budget is exhausted; every later call fails fast with `{ recoveries, windowMs }` details. |

Deferred operations that hold user interaction (dialogs, notification
authorization) follow a two-phase rule: the deadline bounds the
dispatch-to-acceptance phase only. Once the broker accepts the operation, it
runs for as long as your user holds it — a modal open for minutes settles
with its result, or with the typed transport-close rejection if the
transport dies in between. It is never killed by a transport deadline.

## Tier 1 — project health onto your own surfaces (one event)

```ts
const tray = await createTray({ id: "status", /* ... */ });

tray.onTransportStateChange?.((state) => {
  // "healthy" | "recovering" | "abandoned" — edge-triggered
  myIpc.broadcast("trayHealth", state);
});
```

Transitions are edge-triggered; the initial healthy state does not fire.
`recovering` means a death was declared and in-process recovery is running;
`abandoned` is terminal for this runtime instance (fail-fast calls, headless
survival). The per-connection `onConnectionDead` event keeps its existing
meaning (one notification per connection generation) — code using it for
cleanup keeps working.

## Tier 2 — own the restart yourself (one function)

```ts
const tray = await createTray(
  { id: "status" },
  {
    recovery: {
      restartApp: () => {
        spawn(process.execPath, [entrypoint], { detached: true, stdio: "ignore" }).unref();
        process.exit(0);
      },
    },
  },
);
```

When `restartApp` is provided it *replaces* in-process recovery: on an
uninvited death the runtime performs a bounded teardown, invokes the callback
exactly once, and goes terminal. The SDK never embeds app-process restart
vectors (entry paths and single-instance protocols are yours).

## The recovery contract, precisely

- **WebView pages reload from their URL on recovery.** This is contract, not
  implementation detail — same as a user refresh. Plan page state
  accordingly (persist what matters before it matters).
- **The lost-events window is bounded and resyncable.** Events between death
  and recovery are gone by definition; after the rebuild the runtime
  re-emits a full state snapshot for the queryable families
  (`visibleChange`, `moved`, `resized`). Focus and style changes stay
  edge-only (no query verb exists for them); derive durable state from the
  snapshot, not from counting edges.
- **Declarative state is replayed; imperative one-shot commands are not.**
  Menus, icons, tooltips, app identity, extension mounts, and WebView
  windows (creation options plus last-set styles and subscriptions) come
  back automatically. A destroyed tray stays destroyed. Incremental
  orchestration performed after window bootstrap (children/layout added at
  runtime beyond the declared options) is not yet retained — re-assert it in
  a `transportStateChange` handler if you rely on it.
- **Tray identity is stable across recovery.** Handles keep their tray ids;
  the broker-side assignment is replayed with the original id.
- **Your own teardown never triggers recovery.** `destroy()` and explicit
  shutdown mark the runtime caller-initiated; only uninvited deaths recover.

## Opting out

```ts
const tray = await createTray(
  { id: "status" },
  { recovery: { enabled: false } },
);
```

`enabled: false` keeps death detection (heartbeat + immediate socket-death
events, per-connection notifications) but degrades to today's fail-fast
behavior: no respawn, no state transitions. Useful when an outer supervisor
(such as a service manager) owns process-level recovery.

## Troubleshooting

- A `recovering` → `abandoned` sequence inside the budget window means every
  respawn attempt failed deterministically — check the caller-scoped broker
  log (the default `OPENTRAY_DAEMON_STDIO` log mode appends it under your
  OpenTray home) for the spawn/readiness rejection.
- `TransportTimeoutError` on individual calls while the state stays
  `healthy` points to slow-but-alive broker work (for example, cold native
  bring-up), not a dead transport.
- After `abandoned`, the process is intentionally still running headless:
  surface the state through Tier 1 and decide whether to exit, keep serving
  non-tray surfaces, or re-`createTray` (a fresh runtime gets a fresh
  budget).
