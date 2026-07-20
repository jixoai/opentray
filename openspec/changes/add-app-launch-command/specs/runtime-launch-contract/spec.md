<!--
Orthogonal intents (2026-07-20; original user request: omitted app launch
configuration uses the current process invocation, while developers may supply
their own launch script; updated 2026-07-21 after nested `pnpm --dir` execution
addressed the stable bundle to the wrong workspace package):
1. Define the public runtime launch-command shape.
2. Normalize automatic and explicit invocations deterministically.
3. Keep launch state out of the platform-neutral Core projection.
4. Resolve stable Bundle ownership from the running consumer package.
5. Restore complete development launch graphs when a consumer explicitly configures a package-manager command.
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

#### Scenario: Development mode restores its frontend supervisor

- **GIVEN** a consumer runs under a Vite development supervisor
- **WHEN** it configures its OpenTray app launch command
- **THEN** the persisted vector SHALL invoke the package-manager development script from the
  repository root (for example, an absolute `pnpm` executable with `args: ["dev"]`)
- **AND** a cold Dock launch SHALL restore the supervisor, daemon, proxy, and WebView URL together
- **AND** it SHALL not persist only the daemon child entry as a substitute

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

### Requirement: Running Consumer Package Identity

The Node runtime SHALL derive the default stable app-bundle address from the package nearest to
the running consumer script. Explicit `packageRoot`/`packageName` or `projectRoot` metadata SHALL
remain authoritative. When the default script path and ambient package-manager metadata disagree,
the script package SHALL win because `npm_package_json` may describe a nested workspace command
rather than the process that owns `createTray()`.

#### Scenario: Nested workspace command does not rename the app-bundle owner

- **GIVEN** `pnpm --dir webui dev` supplies `npm_package_json` for `webui`
- **AND** the running script belongs to the root `skill-creator` package
- **WHEN** OpenTray resolves the default Darwin app-bundle path
- **THEN** it SHALL use the `skill-creator` package identity and SHALL not create an
  `.opentray/apps/webui` bundle

#### Scenario: Explicit package metadata remains authoritative

- **GIVEN** a build adapter or runtime explicitly supplies package root/name metadata
- **WHEN** OpenTray resolves the app-bundle owner
- **THEN** it SHALL use the explicit package metadata before script, environment, or cwd discovery
