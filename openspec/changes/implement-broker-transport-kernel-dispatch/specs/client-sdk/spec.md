## ADDED Requirements

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

### Requirement: Human-visible daemon tray example SHALL validate the mainline path

The workspace SHALL provide a human-facing example runnable as `pnpm --filter opentray example:daemon-tray`. The example SHALL connect through the daemon endpoint, create a surface and tray through the public TypeScript SDK, print broker-created identities, and print routed tray/menu events.

#### Scenario: Human can visually accept daemon tray

- **GIVEN** the operator has started the daemon with `opentray daemon start`
- **WHEN** they run `pnpm --filter opentray example:daemon-tray`
- **THEN** a real tray item appears on supported desktop platforms
- **AND** selecting a menu item prints the routed event in the example output.

#### Scenario: Automated smoke can exit without human click

- **GIVEN** `OPENTRAY_EXAMPLE_EXIT_AFTER_MS` is set
- **WHEN** the daemon tray example runs
- **THEN** it exits after the configured duration
- **AND** it closes its broker connection so the lease cleanup path is exercised.
