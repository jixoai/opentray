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

The broker daemon SHALL store runtime state under `~/.opentray/<packageVersion>/runtime/` and SHALL operate only on the endpoint identity for the current package or binary version and protocol version. It SHALL NOT discover, stop, restart, or reuse daemons from another package version.

#### Scenario: Start is isolated by package version

- **GIVEN** `opentray@0.1.0` and `opentray@0.2.0` are installed
- **WHEN** each runs `opentray daemon start`
- **THEN** each resolves a different runtime directory
- **AND** each resolves a different broker endpoint.

#### Scenario: Stop is scoped to current version

- **GIVEN** a broker for `opentray@0.1.0` and a broker for `opentray@0.2.0` are running
- **WHEN** `opentray@0.1.0` runs `opentray daemon stop`
- **THEN** it stops only the `0.1.0` broker
- **AND** it does not touch the `0.2.0` runtime directory.

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

The running broker SHALL bind the endpoint derived from the current package version and protocol version. It SHALL write readiness metadata under the current version runtime directory and SHALL NOT scan or reuse another package version's daemon state.

#### Scenario: Ready metadata matches endpoint identity

- **GIVEN** the current package version is `0.1.0`
- **AND** the protocol version is `1`
- **WHEN** the daemon reports ready
- **THEN** the ready metadata uses `~/.opentray/0.1.0/runtime/`
- **AND** the bound endpoint includes protocol version `p1`.

#### Scenario: Different package versions remain separate brokers

- **GIVEN** `opentray@0.1.0` and `opentray@0.2.0` are installed
- **WHEN** each starts its daemon
- **THEN** each broker owns a different state root
- **AND** each broker owns a different endpoint
- **AND** neither broker dispatches client frames from the other package version's endpoint.

### Requirement: Broker daemon SHALL clean session-owned state on disconnect

When a client transport disconnects or exits after receiving an accepted session, the broker SHALL close that session through the kernel. Cleanup SHALL remove only trays and extension state owned by that session and SHALL resync affected backend projections.

#### Scenario: Disconnect closes only owned session

- **GIVEN** two client sessions have trays on the same space
- **WHEN** one client disconnects
- **THEN** the broker closes only that client's session
- **AND** trays owned by the other session remain mounted.

#### Scenario: Extension cleanup follows session ownership

- **GIVEN** a client session loaded an extension scoped to a space and tray
- **WHEN** that session disconnects
- **THEN** extension cleanup is invoked only for state owned by that session
- **AND** other sessions' extension state is not destroyed.

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

The broker daemon SHALL release itself after a configurable idle timeout when no client transport sessions are connected. Idle shutdown SHALL be owned by the broker composition layer that owns process and event-loop lifecycle. `opentray-core` SHALL NOT own process timers, and TypeScript clients SHALL NOT kill the daemon directly on normal close.

The default idle timeout SHALL be 30 seconds. `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS` SHALL override the timeout in milliseconds. A value of `0` SHALL disable idle shutdown for debugging and operator workflows.

#### Scenario: Daemon started but never used exits after idle timeout

- **GIVEN** the daemon is started
- **AND** no client session connects before the idle timeout
- **WHEN** the idle timeout expires
- **THEN** the broker process exits
- **AND** a later local client can start a fresh same-version daemon.

#### Scenario: Daemon exits after last client disconnects

- **GIVEN** one or more clients connected to the daemon
- **WHEN** the last client disconnects
- **THEN** the broker starts an idle timer
- **AND** the broker exits if no new client connects before the timeout expires.

#### Scenario: New connection cancels pending idle shutdown

- **GIVEN** the broker has scheduled idle shutdown after all sessions disconnected
- **WHEN** a new client connects before the timeout expires
- **THEN** the pending idle shutdown is cancelled
- **AND** the broker continues serving the new session.

#### Scenario: Idle shutdown can be disabled

- **GIVEN** `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0`
- **WHEN** no client sessions are connected
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

