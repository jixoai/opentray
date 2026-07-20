<!--
Orthogonal intents (2026-07-20; original user request: omitted app launch
configuration uses the current process invocation, while developers may supply
their own launch script):
1. Define the public runtime launch-command shape.
2. Normalize automatic and explicit invocations deterministically.
3. Keep launch state out of the platform-neutral Core projection.
-->

## ADDED Requirements

### Requirement: Runtime App Launch Command

The Node runtime SHALL expose an optional `appLaunch` field on
`OpenTrayRuntimeOptions` with the shape `{ command: string; args?: readonly string[]; cwd?: string }`.
`command` SHALL be an executable path or executable name, not a shell expression. The
runtime SHALL accept `undefined` and `null` as automatic snapshot mode and SHALL NOT add
the launch command to the Core `AppProjection` or tray protocol.

#### Scenario: Omitted launch configuration snapshots the current invocation

- **GIVEN** `appLaunch` is omitted or `null`
- **WHEN** `createTray` initializes a local Darwin runtime
- **THEN** the runtime SHALL normalize the command to `process.execPath`, the arguments to
  `process.argv.slice(1)`, and the working directory to `process.cwd()`

#### Scenario: Explicit launch configuration is normalized without a shell

- **GIVEN** `appLaunch` supplies `command`, optional `args`, and optional `cwd`
- **WHEN** the runtime initializes the local app bundle
- **THEN** it SHALL persist the exact argument vector, resolve a relative `cwd` against the
  current working directory, and SHALL never concatenate or execute the fields through a shell

#### Scenario: Environment secrets are not persisted

- **GIVEN** the current process contains arbitrary environment variables
- **WHEN** the runtime snapshots an automatic or explicit launch command
- **THEN** the persisted command SHALL contain no environment map and the carrier SHALL inherit
  its launch environment at execution time

### Requirement: Last Successful Invocation

The runtime SHALL update the stable app bundle's launch descriptor during local broker
resolution for every successful `createTray` initialization, including when a compatible broker
is reused. A failed bundle validation, broker start, or client initialization SHALL NOT be
reported as a successful launch-state update.

#### Scenario: A later launch uses the latest invocation

- **GIVEN** a stable bundle has a previously persisted launch descriptor
- **WHEN** a new `createTray` call starts with a different normalized command
- **THEN** the descriptor SHALL be atomically overwritten with the new command before the next
  cold launch

#### Scenario: External endpoints do not mutate a local carrier

- **GIVEN** `autoStart` is false or the caller connects to an explicit endpoint
- **WHEN** `createTray` initializes its connection
- **THEN** it SHALL not create or mutate a Darwin app-bundle launch descriptor

