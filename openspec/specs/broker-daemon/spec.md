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

### Requirement: Broker daemon SHALL clean lease-owned state on disconnect

When a client transport disconnects or exits after receiving a lease, the broker SHALL close that lease through the kernel. Cleanup SHALL remove only trays and extension state owned by that lease and SHALL resync affected backend projections.

#### Scenario: Disconnect removes owned tray only

- **GIVEN** two client sessions have trays on the same surface
- **WHEN** one client disconnects
- **THEN** the broker closes only that client's lease
- **AND** the other client's tray remains mounted
- **AND** the backend receives the updated projection.

### Requirement: Broker daemon SHALL route backend-originated events to owning clients

The daemon SHALL receive native backend events, route them through the kernel, and write resulting event frames only to the session that owns the matching lease. Backend-originated menu events SHALL use surface, tray, and item identifiers, not menu item id alone.

#### Scenario: Menu click reaches owning session

- **GIVEN** a visible tray was created by client lease `lease-a`
- **WHEN** the native backend emits a menu click for that tray
- **THEN** the daemon asks the kernel to route the event
- **AND** only the connection for `lease-a` receives the `event` frame.

#### Scenario: Unknown backend event is dropped safely

- **GIVEN** the native backend emits an event for an unknown surface or tray
- **WHEN** the daemon routes it through the kernel
- **THEN** no client receives a forged event
- **AND** the broker process remains alive.

### Requirement: Broker daemon SHALL stay background-only on macOS

On macOS, a daemon started through `opentray daemon start` or local SDK auto-start SHALL NOT present itself as a Dock-visible regular application or create a windowless Dock tile. The broker composition MAY own the native event loop required by the tray backend, but it SHALL use background/accessory activation behavior appropriate for a status-item daemon.

#### Scenario: macOS daemon does not create a Dock tile

- **GIVEN** the operator runs `pnpm --filter opentray cli -- daemon start` on macOS
- **WHEN** the Rust broker creates the native event loop for tray support
- **THEN** the broker runs with accessory/background activation behavior
- **AND** no windowless daemon application appears in the Dock.

