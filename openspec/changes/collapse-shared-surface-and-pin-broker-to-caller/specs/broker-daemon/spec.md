# broker-daemon Specification Delta

## MODIFIED Requirements

### Requirement: Broker daemon SHALL be scoped by version and caller identity

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

### Requirement: Broker daemon SHALL bind only the current caller endpoint

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

### Requirement: Broker daemon SHALL clean the single session's state on disconnect

Because a broker is pinned to exactly one caller session for normal operation, when that client transport disconnects or exits the broker SHALL close the session through the kernel and remove all trays and extension state owned by that session. There is no second session on the same broker whose state must be preserved.

#### Scenario: Disconnect closes the caller session

- **GIVEN** the single caller session has mounted trays
- **WHEN** the client disconnects
- **THEN** the broker closes that session
- **AND** removes the session's trays and extension state
- **AND** resyncs the backend to an empty state or proceeds toward idle shutdown.

### Requirement: Broker daemon SHALL exit after an idle period with the single session gone

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

## ADDED Requirements

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
