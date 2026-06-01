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
