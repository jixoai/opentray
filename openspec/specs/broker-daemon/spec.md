# broker-daemon Specification

## Purpose
TBD - created by archiving change implement-local-broker-daemon. Update Purpose after archive.
## Requirements
### Requirement: CLI SHALL expose broker daemon lifecycle commands

The `opentray` package SHALL expose explicit lifecycle commands for the local broker daemon. The canonical command group SHALL be `opentray daemon`, with `start`, `stop`, and `restart` subcommands.

#### Scenario: Start command uses canonical daemon group

- **GIVEN** the operator runs `opentray daemon start`
- **WHEN** no healthy same-version broker is running
- **THEN** the CLI starts a broker for the current package version
- **AND** it binds only the endpoint derived from the current package version and protocol version.

### Requirement: Broker daemon SHALL be version-scoped

The broker daemon SHALL store runtime state under `~/.opentray/<packageVersion>/<callerLabel>/runtime/` and SHALL operate only on the endpoint identity for the current package or binary version, protocol version, AND caller label. It SHALL NOT discover, stop, restart, or reuse daemons from another package version or another caller label. Two different callers of the same package version SHALL resolve to different runtime directories and different broker endpoints.

#### Scenario: Start is isolated by package version

- **GIVEN** `opentray@0.1.0` and `opentray@0.2.0` are installed
- **WHEN** each runs `opentray daemon start`
- **THEN** each resolves a different runtime directory
- **AND** each resolves a different broker endpoint.

#### Scenario: Start is isolated by caller label

- **GIVEN** two host applications both depend on `opentray@0.1.0`
- **AND** one uses caller label `myapp` and the other uses caller label `cli-tool`
- **WHEN** each starts its daemon
- **THEN** each resolves a different runtime directory
- **AND** each resolves a different broker endpoint
- **AND** neither broker serves the other caller's session.

#### Scenario: Stop is scoped to current version and caller

- **GIVEN** a broker for `opentray@0.1.0` caller `myapp` and a broker for `opentray@0.1.0` caller `cli-tool` are running
- **WHEN** the `myapp` host runs its daemon stop
- **THEN** it stops only the `myapp` broker
- **AND** it does not touch the `cli-tool` runtime directory.

### Requirement: Daemon start SHALL be single-writer and idempotent

The daemon lifecycle implementation SHALL use current-version runtime metadata to prevent competing same-version brokers. A healthy existing daemon SHALL win over duplicate starts. Stale pid or lock evidence MAY be cleaned only inside the current-version runtime directory.

#### Scenario: Concurrent starts do not create competing daemons

- **GIVEN** two processes run `opentray daemon start` for the same package version
- **WHEN** both attempt to claim the runtime lock
- **THEN** at most one broker process is started
- **AND** the losing process reports or connects to the healthy existing broker.

#### Scenario: Stale metadata is cleaned only inside current version

- **GIVEN** the current version runtime directory contains a stale pid file
- **WHEN** `opentray daemon start` verifies no such process is alive
- **THEN** it may clean the stale file
- **AND** it must not inspect or clean another version directory.

### Requirement: Broker daemon SHALL run the Rust composition broker

The `opentray daemon` lifecycle SHALL supervise the broker process for the current package version, but the process that owns client transport sessions, `opentray-core::Kernel`, selected backend composition, and native event ingress SHALL be the Rust broker binary or an equivalent composition layer. The Node CLI SHALL NOT reimplement kernel policy.

#### Scenario: Start exposes real broker endpoint

- **GIVEN** the operator runs `opentray daemon start`
- **WHEN** no healthy same-version broker is running
- **THEN** the CLI starts the broker for the current package version and protocol version
- **AND** the endpoint accepts newline-delimited JSON protocol sessions
- **AND** client frames are dispatched by the Rust broker composition layer.

#### Scenario: Node lifecycle does not own kernel policy

- **GIVEN** the Node CLI starts, stops, or restarts the daemon
- **WHEN** client protocol frames are processed
- **THEN** surface, tray, lease, projection, and event routing policy is delegated to the Rust kernel path
- **AND** the Node CLI only supervises process lifecycle and current-version runtime metadata.

### Requirement: Broker daemon SHALL bind only the current versioned endpoint

The running broker SHALL bind the endpoint derived from the current package version, protocol version, and caller label. It SHALL write readiness metadata under the current caller runtime directory and SHALL NOT scan or reuse another package version's or another caller's daemon state. The endpoint identity SHALL incorporate a normalized caller label so that concurrent callers of the same OpenTray version cannot collide on one socket or named pipe.

#### Scenario: Ready metadata matches endpoint identity

- **GIVEN** the current package version is `0.1.0`
- **AND** the protocol version is `1`
- **AND** the caller label is `myapp`
- **WHEN** the daemon reports ready
- **THEN** the ready metadata uses `~/.opentray/0.1.0/myapp/runtime/`
- **AND** the bound endpoint includes protocol version `p1` and the caller component.

#### Scenario: Same version, different callers remain separate brokers

- **GIVEN** two host applications both depend on `opentray@0.1.0`
- **WHEN** each starts its daemon
- **THEN** each broker owns a different state root and endpoint
- **AND** neither broker dispatches client frames from the other caller's endpoint.

### Requirement: Broker daemon SHALL clean session-owned state on disconnect

Because a broker is pinned to exactly one caller session for normal operation, when that client transport disconnects or exits the broker SHALL close the session through the kernel and remove all trays and extension state owned by that session. There is no second session on the same broker whose state must be preserved.

#### Scenario: Disconnect closes the caller session

- **GIVEN** the single caller session has mounted trays
- **WHEN** the client disconnects
- **THEN** the broker closes that session
- **AND** removes the session's trays and extension state
- **AND** resyncs the backend to an empty state or proceeds toward idle shutdown.

### Requirement: Broker daemon SHALL route native events to owning sessions

The daemon SHALL receive native backend events, route them through the kernel, and write resulting event frames only to the session that owns the matching authority. Backend-originated menu events SHALL use space, tray, and item identifiers, not menu item id alone.

Primary tray-icon activation SHALL follow the same rule. When the selected backend maps a tray icon click to a primary menu item, the daemon SHALL route the resulting `menuClick` through the kernel and SHALL send the event only to the owning session.

#### Scenario: Menu click reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **WHEN** the user clicks a menu item for that tray
- **THEN** the daemon routes the event through the kernel
- **AND** only the connection for `session-a` receives the `event` frame.

#### Scenario: Primary tray activation reaches owning session

- **GIVEN** a visible tray was created by client session `session-a`
- **AND** its menu declares item `8` as `primaryEvent`
- **WHEN** the native backend maps a tray icon click to that primary item
- **THEN** the daemon routes `menuClick { itemId: 8 }` through the kernel
- **AND** only `session-a` receives the `event` frame.

#### Scenario: Unknown native event does not broadcast

- **GIVEN** the native backend emits an event for an unknown space or tray
- **WHEN** the daemon routes that event
- **THEN** no client receives a misleading event
- **AND** the daemon may emit a structured diagnostic.

### Requirement: Broker daemon SHALL stay background-only on macOS

On macOS, a daemon started through `opentray daemon start` or local SDK auto-start SHALL NOT present itself as a Dock-visible regular application or create a windowless Dock tile. The broker composition MAY own the native event loop required by the tray backend, but it SHALL use background/accessory activation behavior appropriate for a status-item daemon.

#### Scenario: macOS daemon does not create a Dock tile

- **GIVEN** the operator runs `pnpm --filter opentray cli -- daemon start` on macOS
- **WHEN** the Rust broker creates the native event loop for tray support
- **THEN** the broker runs with accessory/background activation behavior
- **AND** no windowless daemon application appears in the Dock.

### Requirement: Daemon health SHALL report public session state

The daemon health command SHALL report the running broker process using public `Session` vocabulary. The output SHALL include daemon PID, package version, protocol version, endpoint identity, active session count, and per-session state. Internal lease identifiers MAY be included only as diagnostic implementation details when clearly labeled and not required by public API consumers.

#### Scenario: Health output identifies active sessions

- **GIVEN** a same-version daemon is running
- **AND** one or more clients are connected
- **WHEN** the operator runs `opentray daemon health`
- **THEN** the output includes the daemon PID
- **AND** it reports active sessions
- **AND** it does not describe the primary public connection list as leases.

#### Scenario: Health output remains useful during alpha migration

- **GIVEN** the implementation still uses an internal lease id
- **WHEN** health output includes that id for debugging
- **THEN** it labels it as an internal or compatibility diagnostic
- **AND** the stable public lifecycle field remains session-oriented.

### Requirement: Broker daemon SHALL exit after an idle period with no sessions

The broker daemon SHALL release itself after a configurable idle timeout when its single caller session is not connected. Idle shutdown SHALL be owned by the broker composition layer that owns process and event-loop lifecycle. `opentray-core` SHALL NOT own process timers, and TypeScript clients SHALL NOT kill the daemon directly on normal close.

The default idle timeout SHALL be 30 seconds. `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS` SHALL override the timeout in milliseconds. A value of `0` SHALL disable idle shutdown for debugging and operator workflows.

#### Scenario: Daemon started but never connected exits after idle timeout

- **GIVEN** the daemon is started
- **AND** no caller session connects before the idle timeout
- **WHEN** the idle timeout expires
- **THEN** the broker process exits
- **AND** a later caller can start a fresh same-version, same-label daemon.

#### Scenario: Daemon exits after the caller disconnects

- **GIVEN** the single caller session is connected
- **WHEN** that caller disconnects
- **THEN** the broker starts an idle timer
- **AND** the broker exits if the caller does not reconnect before the timeout expires.

#### Scenario: Reconnect cancels pending idle shutdown

- **GIVEN** the broker has scheduled idle shutdown after the caller disconnected
- **WHEN** the same caller reconnects before the timeout expires
- **THEN** the pending idle shutdown is cancelled
- **AND** the broker continues serving the session.

#### Scenario: Idle shutdown can be disabled

- **GIVEN** `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0`
- **WHEN** the caller session is not connected
- **THEN** the broker remains running until stopped by operator control or process termination.

### Requirement: Broker daemon SHALL emit camelCase nested event fields

Broker-originated `event` frames SHALL serialize nested tray event payload fields with the same camelCase contract as TypeScript protocol types. Menu click events SHALL use `surfaceId`, `trayId`, and `itemId` on the wire. The daemon SHALL NOT emit snake_case fields such as `surface_id`, `tray_id`, or `item_id`.

#### Scenario: Menu click frame matches TypeScript event shape

- **GIVEN** a native menu click is routed through the broker
- **WHEN** the daemon serializes the `event` frame
- **THEN** the JSON event payload includes `surfaceId`, `trayId`, and `itemId`
- **AND** the payload does not include `surface_id`, `tray_id`, or `item_id`.

### Requirement: Broker daemon SHALL report health through the local protocol

The broker daemon SHALL accept a request-correlated `health` client frame without changing the protocol version. The daemon composition layer SHALL answer with a `daemon-health` server frame containing daemon process metadata and active transport session metadata. The response SHALL include at least `pid`, `packageVersion`, `protocolVersion`, `endpoint`, `sessionCount`, and `sessions`.

`opentray-core` SHALL NOT own daemon process health state. Health state SHALL be assembled by the runtime composition layer that owns the endpoint, pid, and session map.

#### Scenario: Running daemon reports process and session health

- **GIVEN** a same-version daemon is running
- **AND** a client sends a `health` request frame
- **WHEN** the daemon answers
- **THEN** the response type is `daemon-health`
- **AND** it includes the daemon pid
- **AND** it includes package/protocol metadata and endpoint
- **AND** it includes the current session count and session records where available.

#### Scenario: Health does not require a protocol version bump

- **GIVEN** protocol version `1`
- **WHEN** a client sends a `health` request frame
- **THEN** the daemon accepts the frame as an additive command
- **AND** the endpoint naming and protocol version remain unchanged.

### Requirement: Broker daemon SHALL accept exactly one caller session

A broker SHALL accept exactly one caller session for normal operation. A second connection attempt to a broker that is already serving a session SHALL be rejected with a typed protocol error and SHALL NOT cause the broker to aggregate or share state across callers. Callers that need their own broker SHALL connect to their own per-caller endpoint.

#### Scenario: Second connection is rejected

- **GIVEN** a broker is already serving one caller session
- **WHEN** a second caller connects to the same endpoint
- **THEN** the broker rejects the second connection with a typed protocol error
- **AND** the first session is unaffected.

### Requirement: Broker daemon SHALL expose a caller-derived process name

The broker process SHALL present an operating-system-visible name derived from the caller label, so that task managers and process listings identify the owning application rather than a generic `opentray` name. The label SHALL be injected by the SDK at spawn time and SHALL be sanitized to a filesystem- and process-safe component. When no usable caller label is available, the name SHALL fall back to the neutral broker name rather than impersonating an unrelated application.

The platform mechanism SHALL be chosen per substrate: argv0 on platforms where the process listing reflects it, and a renamed or copied executable image on platforms where the task manager reflects the binary file name.

#### Scenario: Task manager shows caller-derived name

- **GIVEN** a host application starts an OpenTray broker with caller label `myapp`
- **WHEN** the operator inspects the system process list
- **THEN** the broker process name reflects `myapp` (for example `opentray · myapp`)
- **AND** it is distinguishable from a generic `opentray` process.

#### Scenario: Unsafe or empty label falls back neutrally

- **GIVEN** a caller provides an empty or unsafe label
- **WHEN** the broker is spawned
- **THEN** the process name falls back to a neutral broker name
- **AND** it does not impersonate another application.

### Requirement: Daemon health SHALL report the caller label

The broker daemon's `daemon-health` response SHALL include the `callerLabel` of the session it is pinned to, so operators and tooling can confirm which application a given broker serves. The label SHALL be the same sanitized component used for endpoint identity and process naming.

#### Scenario: Health output includes caller label

- **GIVEN** a broker is serving a caller with label `myapp`
- **WHEN** a health request is sent over the local protocol
- **THEN** the `daemon-health` response includes `callerLabel: "myapp"`
- **AND** `sessionCount` is at most 1.

### Requirement: Broker daemon SHALL correlate malformed frame errors to their request

When a client frame fails deserialization, the broker SHALL extract the `requestId` from the raw frame line (when present) and include it in the resulting error response, so the originating client request can reject instead of hanging. An error that cannot be correlated to a `requestId` SHALL still be emitted; the client treats such an error as fatal to all pending requests.

#### Scenario: Malformed create-tray frame rejects the originating request

- **GIVEN** a client sends a `create-tray` frame that omits a required field or is otherwise invalid
- **WHEN** the broker fails to deserialize the frame
- **THEN** the broker emits an error frame carrying the same `requestId` as the malformed request
- **AND** the client rejects the pending `createTray` promise with that error.

#### Scenario: Frame without requestId cannot wedge a client promise

- **GIVEN** a client sends a malformed frame that carries no `requestId`
- **WHEN** the broker fails to deserialize the frame
- **THEN** the broker emits an error frame with no `requestId`
- **AND** the client rejects every pending request rather than hanging indefinitely.

