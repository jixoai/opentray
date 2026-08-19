<!--
Orthogonal intents (2026-07-21; original user request: manual Dock acceptance
needs daemon logs so failures can be seen and understood):
1. Persist detached broker output by default.
2. Keep explicit interactive and silent diagnostic overrides.
3. Document one deterministic log address per caller runtime.
4. Bound native readiness without terminating a healthy Darwin cold start prematurely.
5. Recover caller locks left by dead processes without deleting a replacement owner's lock.
-->

## ADDED Requirements

### Requirement: Persistent Broker Diagnostics

The Node daemon driver SHALL append detached broker stdout and stderr to
`<runtimeDir>/broker.log` by default. It SHALL create the runtime directory before opening the
log and SHALL preserve output across broker restarts. `OPENTRAY_DAEMON_STDIO=inherit` SHALL retain
interactive terminal output, while `OPENTRAY_DAEMON_STDIO=ignore` SHALL explicitly disable output.
No other value SHALL silently discard diagnostics.

#### Scenario: Default detached broker failure is durable

- **GIVEN** no `OPENTRAY_DAEMON_STDIO` override
- **WHEN** a detached broker prints startup or native-extension failure output
- **THEN** that output SHALL be appended to the caller-scoped `runtime/broker.log`

#### Scenario: Interactive diagnosis remains available

- **GIVEN** `OPENTRAY_DAEMON_STDIO=inherit`
- **WHEN** the broker starts
- **THEN** its stdout and stderr SHALL remain attached to the caller terminal

#### Scenario: Silence is an explicit operator decision

- **GIVEN** `OPENTRAY_DAEMON_STDIO=ignore`
- **WHEN** the broker starts
- **THEN** its stdout and stderr SHALL be discarded intentionally and the documented default
  SHALL remain persistent logging

### Requirement: Bounded Native Broker Readiness

The Node daemon lifecycle SHALL treat broker readiness as a bounded native cold-start phase. Its
default readiness budget SHALL be 10 seconds, and its default caller-lock budget SHALL extend
beyond that readiness window. During the wait it SHALL continue to validate broker PID liveness
and exact ready artifact identity on every poll. It SHALL terminate the spawned broker only after
an early exit, identity mismatch, or readiness timeout is established.

#### Scenario: Healthy Darwin carrier startup exceeds the former polling window

- **GIVEN** a spawned broker remains alive and publishes exact ready metadata after more than two seconds
- **WHEN** it becomes ready within the 10-second native readiness budget
- **THEN** startup SHALL succeed and the lifecycle SHALL NOT terminate the broker

#### Scenario: Early exit remains immediate and diagnosable

- **GIVEN** a spawned broker exits before publishing ready metadata
- **WHEN** the lifecycle observes that its PID is no longer alive
- **THEN** startup SHALL fail without waiting for the remaining readiness budget
- **AND** the error SHALL identify the caller-scoped `broker.log`

#### Scenario: Readiness timeout preserves actionable evidence

- **GIVEN** a spawned broker remains alive but never publishes ready metadata
- **WHEN** the 10-second readiness budget expires
- **THEN** the lifecycle SHALL terminate that broker and clean its runtime readiness files
- **AND** the timeout error SHALL identify the PID, budget, ready path, and caller-scoped `broker.log`

#### Scenario: Concurrent startup lock covers native readiness

- **GIVEN** one caller is starting a broker within the default readiness budget
- **WHEN** the same caller starts concurrently
- **THEN** the second start SHALL wait under a default lock budget longer than the readiness budget
- **AND** it SHALL reuse the first broker only after exact ready artifact identity matches

### Requirement: Recoverable Caller Lock Ownership

The Node daemon lifecycle SHALL write the caller PID and a unique owner token into
`broker.lock`. On contention it SHALL preserve a live owner, but SHALL automatically reclaim a
lock whose recorded owner process is dead. Releasing a lock SHALL remove it only while its current
owner token still matches the releasing caller. A legacy PID-only lock SHALL remain readable for
liveness and stale recovery so previously interrupted callers do not require manual cleanup.

#### Scenario: Dead caller residue does not block the next start

- **GIVEN** `broker.lock` records a caller PID that is no longer alive
- **WHEN** another caller starts the same runtime
- **THEN** it SHALL reclaim the stale lock within the normal lock budget
- **AND** it SHALL continue through broker readiness without operator file deletion

#### Scenario: Live caller remains serialization authority

- **GIVEN** `broker.lock` records a caller PID that is alive
- **WHEN** another caller starts the same runtime
- **THEN** it SHALL wait for the live owner to release the lock
- **AND** it SHALL NOT treat lock age alone as authority to remove it

#### Scenario: Delayed release cannot delete a replacement lock

- **GIVEN** a caller holds a lock with one owner token
- **AND** the lock path later contains a different owner token
- **WHEN** the earlier caller runs its release procedure
- **THEN** it SHALL preserve the replacement lock
