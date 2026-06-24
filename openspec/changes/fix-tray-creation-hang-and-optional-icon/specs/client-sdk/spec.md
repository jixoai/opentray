# client-sdk Specification Delta

## MODIFIED Requirements

### Requirement: Top-level createTray SHALL forward tray icon sources unchanged

The top-level `createTray` entrypoint SHALL forward the caller's tray options to the broker, including any icon source the caller provides. The `icon` field of `TrayOptions` SHALL be optional: a tray without an icon is a valid title-only status item. When no icon is provided, the SDK SHALL send the tray options as given and the broker SHALL mount a title-only tray.

#### Scenario: createTray without an icon creates a title-only tray

- **GIVEN** a caller invokes `createTray({ trayId, title })` with no `icon`
- **WHEN** the request is sent to the broker
- **THEN** the broker mounts a tray with the given title and no icon
- **AND** `createTray` resolves with a tray handle.

#### Scenario: createTray with an icon forwards the icon source

- **GIVEN** a caller provides an `icon` source
- **WHEN** the request is sent to the broker
- **THEN** the icon source is forwarded unchanged to the broker.

## ADDED Requirements

### Requirement: Client SHALL reject pending requests on an uncorrelated error

When the client receives an error frame that carries no `requestId` and no handshake is pending, the client SHALL reject every pending request with that error rather than swallowing it. This prevents a malformed-frame error from leaving a request promise pending forever.

#### Scenario: Uncorrelated error rejects all pending requests

- **GIVEN** the client has one or more pending requests
- **WHEN** it receives an error frame with no `requestId`
- **THEN** every pending request rejects with that error
- **AND** no promise remains pending.
