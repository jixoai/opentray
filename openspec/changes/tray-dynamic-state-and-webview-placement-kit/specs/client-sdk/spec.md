## ADDED Requirements

### Requirement: Tray handles SHALL expose dynamic tray state setters

The public TypeScript SDK SHALL expose `setMenu`, `setTooltip`, `setIcon`, and `setTitle` on broker-backed tray handles. Each setter SHALL send a tray-scoped broker request using the handle's `spaceId` and `trayId`, and SHALL resolve only after the broker acknowledges the projection update.

#### Scenario: Developer updates tray state without raw frames

- **GIVEN** a developer holds a `TrayHandle`
- **WHEN** they call `tray.setMenu(...)`, `tray.setTooltip(...)`, `tray.setIcon(...)`, or `tray.setTitle(...)`
- **THEN** the SDK sends the matching tray-scoped protocol request
- **AND** the caller does not need to construct a raw broker frame.

### Requirement: Protocol SHALL support tray title mutation

The OpenTray protocol SHALL include a `set-tray-title` request that updates the title of one lease-owned tray contribution. The Rust kernel SHALL store the updated title in tray options and sync the backend projection.

#### Scenario: Broker applies tray title mutation

- **GIVEN** a session owns a tray
- **WHEN** it sends `set-tray-title` for that tray
- **THEN** the broker updates the tray projection title
- **AND** it returns an `ack` for the matching request id.

### Requirement: Tray event helpers SHALL require a trusted event source

The SDK SHALL distinguish request-only transports from eventful broker connections. Tray-scoped event helpers SHALL be available only when a handle was created with an event source capable of receiving broker event frames.

#### Scenario: Tray handle filters own events

- **GIVEN** a tray handle created from a real broker connection
- **WHEN** the connection receives `menuClick`, `trayClick`, or `trayDoubleClick` events for multiple trays
- **THEN** `tray.listen(...)` and convenience helpers invoke handlers only for the matching `spaceId` and `trayId`.

### Requirement: Tray click events SHALL carry tray identity

`trayClick` and `trayDoubleClick` events SHALL carry `trayId` in addition to `spaceId`, button, and coordinates so consumers can safely bind tray-scoped handlers.

#### Scenario: Parser rejects ambiguous tray click events

- **GIVEN** an event frame claims to be `trayClick` or `trayDoubleClick`
- **WHEN** it lacks `trayId`
- **THEN** the TypeScript parser rejects it as an invalid server frame.

## MODIFIED Requirements

### Requirement: TypeScript SDK SHALL expose broker events without stealing command responses

The local broker client SHALL continue separating command responses from broker-originated events. Eventful high-level handles SHALL use the same event stream instead of asking applications to filter raw frames in normal code.

#### Scenario: Menu click is delivered through tray helper

- **GIVEN** a client-created daemon tray is visible
- **WHEN** the user clicks a tray menu item
- **THEN** the owning tray handle can receive the event through `onMenuClick`
- **AND** no pending command promise is resolved by that event.
