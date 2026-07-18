## ADDED Requirements

### Requirement: Broker reuse SHALL require exact runtime artifact identity

The Node SDK SHALL resolve the broker executable selected for the current start and compute a deterministic artifact identity from its bytes and target. Daemon ready metadata and the protocol ready frame SHALL include that identity.

Under the caller-scoped daemon lock, a live PID SHALL be reusable only when its ready metadata identity equals the currently resolved broker identity. A live broker with missing or mismatched identity SHALL be stopped through the bounded daemon lifecycle, its current caller runtime metadata SHALL be cleaned, and the resolved broker SHALL be started automatically.

Broker artifact identity SHALL govern broker process reuse only. Extension identities SHALL remain per-`load-ext` facts and SHALL NOT be added to the endpoint name.

#### Scenario: Same endpoint with different executable is replaced

- **GIVEN** the caller endpoint has a live broker whose ready metadata contains artifact identity `old`
- **AND** the current OpenTray installation resolves broker artifact identity `current`
- **WHEN** the SDK starts or reuses the daemon
- **THEN** it stops `old` under the existing daemon lock
- **AND** starts `current`
- **AND** reports `started`, not `already-running`.

#### Scenario: Matching executable is reused

- **GIVEN** a live caller-scoped broker ready file contains the currently resolved artifact identity
- **WHEN** another start is attempted
- **THEN** the existing PID is reused
- **AND** no competing broker is spawned.

#### Scenario: Missing identity is incompatible

- **GIVEN** a live broker was written by an identity-free runtime
- **WHEN** the current SDK evaluates its ready metadata
- **THEN** the broker is treated as incompatible and automatically replaced
- **AND** the SDK does not ask the consumer to restart it manually.

### Requirement: Broker artifact evidence SHALL be available without process inspection tools

Ready metadata SHALL record the broker executable path, artifact identity, package version, protocol version, target, caller identity, endpoint, and PID. The ready protocol frame SHALL carry the broker artifact identity so the connected SDK can reject a race or an incompatible manually supplied endpoint.

#### Scenario: Ready metadata proves selected executable

- **GIVEN** a broker has started successfully
- **WHEN** its caller-scoped ready metadata is read
- **THEN** it identifies the exact executable and artifact identity selected by the SDK
- **AND** `lsof` is not required to establish broker identity.

#### Scenario: Connection rejects unexpected broker identity

- **GIVEN** the client expects broker artifact identity `current`
- **WHEN** the ready protocol frame reports another identity
- **THEN** connection initialization rejects with expected and actual identity
- **AND** no tray command is sent on that connection.

## MODIFIED Requirements

### Requirement: Daemon start SHALL be single-writer and idempotent

The daemon lifecycle implementation SHALL use current caller runtime metadata and resolved broker artifact identity to prevent competing or stale same-endpoint brokers. A healthy existing daemon SHALL win over duplicate starts only when its ready artifact identity matches the current resolved executable. Stale PID, ready, lock, or endpoint evidence MAY be cleaned only inside the current caller/version runtime directory.

#### Scenario: Concurrent starts do not create competing daemons

- **GIVEN** two processes start the same caller/version and resolve the same broker artifact
- **WHEN** both attempt to claim the runtime lock
- **THEN** at most one broker process is started
- **AND** the losing process reuses the matching healthy broker.

#### Scenario: Stale metadata is cleaned only inside current version

- **GIVEN** the current caller runtime directory contains stale PID or ready metadata
- **WHEN** start verifies no compatible process is alive
- **THEN** it may clean current runtime files
- **AND** it must not inspect or clean another version or caller directory.

#### Scenario: Live but incompatible broker does not win idempotence

- **GIVEN** a PID is alive for the current endpoint
- **AND** ready metadata does not match the currently resolved broker artifact
- **WHEN** start holds the runtime lock
- **THEN** it performs bounded replacement
- **AND** does not return `already-running` for liveness alone.

### Requirement: Broker daemon SHALL bind only the current versioned endpoint

The running broker SHALL bind the endpoint derived from the current caller package version, protocol version, and caller label. It SHALL write readiness metadata under the current caller runtime directory and SHALL NOT scan or reuse another package version's or another caller's daemon state. The endpoint identity SHALL incorporate a normalized caller label so concurrent callers cannot collide. Reuse inside that endpoint SHALL additionally require exact broker artifact identity.

#### Scenario: Ready metadata matches endpoint identity

- **GIVEN** the SDK resolved a caller/version endpoint and broker executable
- **WHEN** the daemon reports ready
- **THEN** the ready metadata uses that caller runtime directory and endpoint
- **AND** includes the resolved broker artifact identity.

#### Scenario: Same version, different callers remain separate brokers

- **GIVEN** two host applications use the same OpenTray caller package version
- **WHEN** each starts its daemon with a different caller label
- **THEN** each broker owns a different state root and endpoint
- **AND** each independently validates its resolved broker artifact.
