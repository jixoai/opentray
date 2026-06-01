# client-sdk Specification

## Purpose
TBD - created by archiving change implement-broker-transport-kernel-dispatch. Update Purpose after archive.
## Requirements
### Requirement: TypeScript SDK SHALL connect to the versioned local broker

The `opentray` TypeScript package SHALL provide a local broker client that resolves the current package version and protocol version, connects to the derived daemon endpoint, sends `init`, and exposes broker-created handles. The client SHALL NOT return placeholder `pending:*` identities after a successful broker response path exists.

#### Scenario: Client receives broker-created surface identity

- **GIVEN** the daemon is running for the current package version
- **WHEN** TypeScript code connects and calls `createSurface`
- **THEN** the client sends a request-correlated protocol command
- **AND** it resolves with the `SurfaceRef` returned by the broker.

#### Scenario: Client rejects unsupported broker protocol

- **GIVEN** the client connects to a broker with an unsupported protocol response
- **WHEN** the handshake completes or fails
- **THEN** the client reports a typed connection error
- **AND** it does not create surface or tray handles from placeholders.

### Requirement: TypeScript SDK SHALL expose broker events without stealing command responses

The local broker client SHALL separate command responses from broker-originated events. Command promises SHALL resolve or reject only from frames with matching `requestId`. Event frames SHALL be delivered through an explicit event subscription or async event stream.

#### Scenario: Menu click is delivered as event

- **GIVEN** a client-created daemon tray is visible
- **WHEN** the user clicks a tray menu item
- **THEN** the client receives an event frame
- **AND** no pending command promise is incorrectly resolved by that event.

### Requirement: TypeScript SDK SHALL auto-start the local same-version daemon by default

The local broker client SHALL start or reuse the daemon for the current package version and protocol version before connecting to the derived endpoint. Manual `opentray daemon start|stop|restart` commands SHALL remain available for operator and debugging workflows, but human examples and normal SDK usage SHALL NOT require the developer to start the daemon by hand.

#### Scenario: Example starts daemon automatically

- **GIVEN** no healthy same-version daemon is running
- **WHEN** the developer runs `pnpm --filter opentray example:daemon-tray`
- **THEN** the local broker client starts the current-version broker before connecting
- **AND** the example can create a daemon-owned tray without a separate manual `daemon start` command.

#### Scenario: Explicit endpoint can opt out of lifecycle ownership

- **GIVEN** a caller passes an explicit broker endpoint and disables auto-start
- **WHEN** the local broker client connects
- **THEN** it attempts to connect to that endpoint directly
- **AND** it does not start a daemon for the derived current-version endpoint.

### Requirement: Human-visible daemon tray example SHALL validate the mainline path

The workspace SHALL provide a human-facing example runnable as `pnpm --filter opentray example:daemon-tray`. The example SHALL auto-start or reuse the same-version daemon, connect through the daemon endpoint, create a surface and tray through the public TypeScript SDK, print broker-created identities, and print routed tray/menu events.

#### Scenario: Human can visually accept daemon tray

- **GIVEN** the developer runs `pnpm --filter opentray example:daemon-tray`
- **WHEN** the example connects to the local broker
- **THEN** a real tray item appears on supported desktop platforms
- **AND** the daemon is started automatically if no same-version daemon was already running
- **AND** selecting a menu item prints the routed event in the example output.

#### Scenario: Automated smoke can exit without human click

- **GIVEN** `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` is set
- **WHEN** the daemon tray example runs
- **THEN** it exits after the configured duration
- **AND** it closes its broker connection so the lease cleanup path is exercised.

#### Scenario: Example demonstrates supported menu atoms

- **GIVEN** the daemon tray example creates its menu
- **WHEN** the menu is opened on a supported desktop platform
- **THEN** it includes item, disabled item, check, radio, separator, submenu, and quit actions
- **AND** click-capable items route events through the broker path.

