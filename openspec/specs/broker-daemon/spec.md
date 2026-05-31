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

