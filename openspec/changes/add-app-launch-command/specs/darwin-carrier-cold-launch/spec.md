<!--
Orthogonal intents (2026-07-20; original user request: clicking the persistent
Dock entry must start the application again; updated 2026-07-21 because the
owner could not observe any LaunchServices or consumer failure):
1. Define the no-argument Darwin carrier entry procedure.
2. Execute the persisted vector directly and detach the consumer.
3. Persist cold-carrier and early consumer diagnostics.
4. Keep the live retained-session path and non-Darwin platforms unchanged.
-->

## ADDED Requirements

### Requirement: Darwin Carrier Cold Launch

When the Darwin carrier executable is launched without the private `broker` subcommand, it SHALL
locate `Contents/Resources/opentray-launch.json` relative to its own
`<App>.app/Contents/MacOS/opentray` path, strictly parse and validate the descriptor, spawn the
configured command once with its arguments and working directory, attach the child's stdout and
stderr to the persistent carrier log, and exit. It SHALL never invoke a shell or wait for the
consumer to finish.

#### Scenario: Finder or Dock opens a stable bundle

- **GIVEN** a valid stable `.app` contains a launch descriptor
- **WHEN** macOS starts `Contents/MacOS/opentray` with no arguments
- **THEN** OpenTray SHALL spawn the recorded consumer command once and return success from the
  carrier process

### Requirement: Persistent Cold Launch Diagnostics

The Darwin carrier SHALL append JSON-line diagnostics to
`Contents/Resources/opentray-launch.log` for every no-argument/LaunchServices entry attempt. The
log SHALL include a timestamp, event category, bundle and descriptor paths, command/cwd identity,
and either the spawned child PID or the exact read/parse/spawn error. It SHALL not persist the
process environment. The launched consumer's stdout and stderr SHALL append to the same file so
an early module/runtime failure remains observable after the carrier exits.

#### Scenario: Missing descriptor remains observable without a terminal

- **GIVEN** LaunchServices starts a bundle whose descriptor is missing
- **WHEN** the carrier cannot parse launch state
- **THEN** it SHALL append the exact descriptor error and path to `opentray-launch.log` before
  returning non-zero

#### Scenario: Spawned consumer exits early

- **GIVEN** the descriptor command starts but reports a runtime error to stderr
- **WHEN** the carrier has already returned
- **THEN** the consumer error SHALL remain appended to `opentray-launch.log`

#### Scenario: Missing or invalid descriptor is diagnosed

- **GIVEN** the carrier is launched without `broker` and the descriptor is missing, malformed,
  uses an unsupported schema, or has an empty command/cwd
- **WHEN** the carrier tries to cold-launch
- **THEN** it SHALL return a non-zero error that identifies the stable bundle and descriptor
  path, without starting an arbitrary process

#### Scenario: Broker startup remains unchanged

- **GIVEN** the executable receives the `broker` subcommand and its existing broker flags
- **WHEN** the carrier starts
- **THEN** it SHALL run the existing native broker path and SHALL not spawn the consumer launch
  descriptor

### Requirement: Scope Boundary For Reopen And Other Platforms

This change SHALL guarantee cold launch after the carrier/broker process has exited. It SHALL not
claim that an already-running macOS process receives a second consumer launch on Dock activation,
and it SHALL not claim persistent post-exit taskbar launch behavior for Windows or Linux without a
platform-specific launcher artifact.

#### Scenario: Retained live session is not duplicated

- **GIVEN** the broker and consumer are still alive with a retained WebView session
- **WHEN** the user uses the existing tray primary action or native reveal path
- **THEN** OpenTray SHALL retain the current session lifecycle and SHALL not invoke the cold-launch
  descriptor as a second consumer
