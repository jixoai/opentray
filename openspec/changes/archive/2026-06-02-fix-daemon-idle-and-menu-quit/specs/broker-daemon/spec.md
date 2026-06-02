## ADDED Requirements

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
