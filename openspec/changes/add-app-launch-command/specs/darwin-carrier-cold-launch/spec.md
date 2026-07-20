<!--
Orthogonal intents (2026-07-20; original user request: clicking the persistent
Dock entry must start the application again):
1. Define the no-argument Darwin carrier entry procedure.
2. Execute the persisted vector directly and detach the consumer.
3. Keep the live retained-session path and non-Darwin platforms unchanged.
-->

## ADDED Requirements

### Requirement: Darwin Carrier Cold Launch

When the Darwin carrier executable is launched without the private `broker` subcommand, it SHALL
locate `Contents/Resources/opentray-launch.json` relative to its own
`<App>.app/Contents/MacOS/opentray` path, strictly parse and validate the descriptor, spawn the
configured command once with its arguments and working directory, detach the child with null
stdio, and exit. It SHALL never invoke a shell or wait for the consumer to finish.

#### Scenario: Finder or Dock opens a stable bundle

- **GIVEN** a valid stable `.app` contains a launch descriptor
- **WHEN** macOS starts `Contents/MacOS/opentray` with no arguments
- **THEN** OpenTray SHALL spawn the recorded consumer command once and return success from the
  carrier process

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

