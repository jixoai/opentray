<!--
Orthogonal intents (2026-07-21; original user request: manual Dock acceptance
needs daemon logs so failures can be seen and understood):
1. Persist detached broker output by default.
2. Keep explicit interactive and silent diagnostic overrides.
3. Document one deterministic log address per caller runtime.
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
