# transport-robustness Specification

## Purpose

Guarantee that every OpenTray transport failure is bounded, typed, and —
when uninvited — automatically recoverable with zero consumer code: per-call
deadline budgets settle every request, broker death (socket close, error, or
a heartbeat-declared half-open) surfaces as a bounded event, in-process
recovery replays the declarative session state against a respawned broker
and re-emits a full state snapshot, a bounded restart budget degrades to
fail-fast calls plus the terminal `abandoned` state while the app survives
headless, and the broker's own socket writes never block the native owner
loop and never swallow write failures.
## Requirements
### Requirement: Transport round-trips SHALL settle within a bounded deadline

The client transport SHALL enforce a per-call deadline on every outstanding
request-reply correlation. For deferred extension operations the deadline
bounds the dispatch-to-acceptance phase only: once the broker's acceptance
frame arrives, the call awaits native completion that may be legitimately
user-paced (a held modal dialog), so it SHALL NOT be settled by a transport
deadline — it settles with exactly one terminal frame, or with the typed
transport-close rejection when the transport dies. Default budget classes
SHALL be: interactive calls 5 s, teardown-class calls 2 s, and
bootstrap-class calls (connection init and the first tray/webview bring-up)
10 s. Every budget class SHALL be overridable through one optional
configuration object whose keys all have working defaults.

A call whose budget expires SHALL settle with a typed timeout rejection
distinct from transport-lost and broker-rejected rejections. A reply that
arrives after its deadline SHALL be discarded safely without settling
anything. A deadline expiry SHALL NOT by itself declare the transport dead;
it SHALL count as one liveness failure for death detection.

#### Scenario: Never-settling call rejects in budget

- **GIVEN** a transport whose broker never answers a request
- **WHEN** a caller awaits the request promise
- **THEN** the promise rejects with the typed timeout rejection within the
  configured budget, and never remains pending.

#### Scenario: Late reply is discarded

- **GIVEN** a request settled by deadline rejection
- **WHEN** the matching response frame arrives afterwards
- **THEN** the transport discards it without settling any promise and
  without throwing.

#### Scenario: Happy path is unchanged

- **GIVEN** a healthy transport answering within budget
- **WHEN** callers issue interactive requests
- **THEN** no timeout behavior is observable and results resolve exactly as
  before this capability existed.

### Requirement: Transport death SHALL be detected and surfaced as a bounded event

The client transport SHALL run a liveness heartbeat against the broker using
the existing protocol health round-trip, at socket level rather than through
semantic extension APIs. Default cadence SHALL be a 30 s idle interval, a 3 s
probe deadline, and 3 consecutive failures declaring death; all three SHALL
be overridable.

Declared death SHALL reject every in-flight call promptly with the existing
transport-lost rejection family (the plain sentinel for ordinary requests,
the typed `extension_transport_closed` for deferred operations), and SHALL
stop event delivery — preserving the existing single-flight terminal
transition contract. A socket close or error SHALL declare death immediately
without waiting for heartbeat failures.

The runtime SHALL expose a `transportStateChange` event publishing the
supervision state `healthy | recovering | abandoned`. Transitions SHALL be
edge-triggered (no repeated emissions of the same state).

#### Scenario: Half-open transport declared dead in bounded time

- **GIVEN** a broker process that stays alive but stops answering the
  heartbeat (wedged or black-holed transport)
- **WHEN** the configured number of consecutive probe failures completes
- **THEN** the transport declares death within the bounded detection window
- **AND** every in-flight call rejects with the transport-lost family
- **AND** the runtime emits the death through its state-change surface.

#### Scenario: Socket close declares death immediately

- **GIVEN** in-flight requests and a broker socket that closes
- **WHEN** the close event arrives
- **THEN** death is declared at once, in-flight calls reject, and no
  heartbeat cycle is required.

### Requirement: Teardown SHALL be wall-clock bounded

Public teardown paths (`destroy()` on handles, connection `close()`) SHALL
complete within bounded wall-clock budgets: 2 s per native teardown step
including drain of serialized consumer queues, bounded overall so a wedged
handle can never wedge consumer shutdown. Caller-initiated graceful teardown
SHALL keep its exact current end-state semantics: the transport-close
sentinel observed during destroy remains the requested end state, not a
failure. Recovery machinery SHALL NOT trigger on caller-initiated teardown.

#### Scenario: Destroy of a wedged handle stays bounded

- **GIVEN** a handle whose underlying native round-trips never settle
- **WHEN** the consumer calls `destroy()`
- **THEN** the returned promise settles within the teardown budget
- **AND** the native destroy request is still issued.

#### Scenario: Graceful quit remains clean

- **GIVEN** a generated app whose broker exits when its last session closes
- **WHEN** the app destroys its tray during quit
- **THEN** the destroy path treats the transport-close sentinel as success
  exactly as before this capability existed.

### Requirement: Uninvited broker death SHALL recover with zero consumer code

The runtime SHALL treat uninvited transport death (any death not caused by
caller-initiated teardown) as automatically recoverable: wait a cooldown
backoff, respawn the broker through the
existing spawn machinery with its identity gates, reconnect and handshake,
replay the retained declarative journal (tray creation options, last-set
menu/icon/tooltip, app name/icon mutations, extension mounts with their exact
resolved artifacts and identities, webview windows with options, last-set
styles, and event subscriptions), then query native state and re-emit a full
state snapshot so consumers deriving state from event streams can resync.
Recovery SHALL be capped by a budget of 3 respawns per 10-minute window by
default (overridable; in-memory per process).

WebView pages SHALL reload from their URL on recovery; this is contract, not
implementation detail. The lost-events window between death and snapshot
re-emit is acknowledged, and the snapshot re-emit is the resync guarantee.

#### Scenario: Broker kill -9 recovers automatically

- **GIVEN** a consumer app using only `createTray` and extension `attach`
  calls with zero recovery code
- **WHEN** the broker process is killed with an uncatchable signal
- **THEN** the tray and windows return automatically within one recovery
  budget window
- **AND** no consumer promise remains unsettled
- **AND** the failure mode observed by the user is bounded (a flicker or an
  explicit dead state), never silence.

#### Scenario: Declarative state is fully replayed

- **GIVEN** a tray with a menu set after creation, a mounted extension, and
  a shown webview window with a style applied after creation
- **WHEN** recovery replays the journal after respawn
- **THEN** the respawned broker-side state matches the pre-death declarative
  state (menu, icon, extension mounts, window options and styles)
- **AND** event consumers receive a full state snapshot after replay.

#### Scenario: Budget exhaustion degrades to fail-fast

- **GIVEN** a deterministic failure that kills every respawned broker
- **WHEN** the recovery budget is exhausted
- **THEN** the runtime stops respawning (no loop)
- **AND** every handle method fails fast with a typed rejection carrying the
  abandoned reason instead of hanging
- **AND** the final `transportStateChange` state is `abandoned`
- **AND** the consumer process keeps running effectively headless.

### Requirement: Recovery hooks SHALL stay optional and one-shot

The runtime SHALL accept one optional recovery configuration object where
every key has a working default. Tier 1: a `transportStateChange` event
subscription requiring no other code. Tier 2: a `recovery.restartApp`
callback which, when provided, replaces in-process session rebuild — the
runtime tears down its own supervision and hands restart ownership to the
callback. The SDK SHALL NOT embed app-process restart vectors (entry paths,
single-instance protocols) itself.

#### Scenario: Tier 1 health projection is one line

- **GIVEN** an app that projects tray health onto its own IPC/CLI surface
- **WHEN** it subscribes to `transportStateChange`
- **THEN** it receives `healthy`, `recovering`, and `abandoned` transitions
  and nothing else is required.

#### Scenario: Tier 2 replaces in-process rebuild

- **GIVEN** a consumer that supplies `recovery.restartApp`
- **WHEN** uninvited transport death is declared
- **THEN** the runtime does not perform in-process session rebuild and
  invokes the callback exactly once per death.

### Requirement: Broker socket writes SHALL never block the native owner loop

The broker SHALL NOT perform blocking socket writes on the native owner loop
thread. Outbound frames SHALL pass through a bounded per-session outbound
queue drained by a dedicated writer path on every platform. A write or flush
failure SHALL escalate to that session's disconnect handling (session
cleanup, event-source revocation, owned-broker exit behavior) instead of
being discarded. A queue that cannot drain within its bound SHALL escalate
the same way rather than parking the producer. On Windows the existing pump
queue SHALL become bounded with the same escalation semantics.

#### Scenario: Write error escalates to disconnect

- **GIVEN** a broker session whose client socket returns a write error
- **WHEN** the writer path observes the failure
- **THEN** the session is cleaned up through the disconnect path with its
  event sources revoked
- **AND** the failure is observable in broker diagnostics rather than
  silently discarded.

#### Scenario: Stopped-drain client frees the broker

- **GIVEN** a client that stops reading its socket while both processes stay
  alive
- **WHEN** the outbound queue reaches its bound
- **THEN** the broker escalates that session within bounded time
- **AND** the native owner loop keeps servicing other work (no freeze).

### Requirement: The recovery drill SHALL be a permanent acceptance gate

The repository's test suite SHALL contain, and keep green, an integration
drill: a minimal consumer using only `createTray` survives broker
`kill -9` and recovers automatically within one budget window with no
consumer recovery code; a deterministic-bug simulation asserts budget
exhaustion produces fail-fast handles plus the `abandoned` event with no
hang and no respawn loop. Platform-specific evidence stays platform-scoped
per repository law.

#### Scenario: Drill stays green

- **GIVEN** CI or a local run of the transport robustness suite
- **WHEN** the drill executes
- **THEN** both the recovery leg and the exhaustion leg pass without
  consumer recovery code in the fixture.
