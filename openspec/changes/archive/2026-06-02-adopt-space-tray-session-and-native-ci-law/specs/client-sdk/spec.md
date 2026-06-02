## ADDED Requirements

### Requirement: TypeScript SDK SHALL expose Space Tray Session public vocabulary

The `opentray` TypeScript package SHALL expose user-facing APIs in `Space / Tray / Session` vocabulary. The primary creation API SHALL be `createSpace`. The primary handle types SHALL be `SpaceHandle` and `TrayHandle`. Public daemon lifecycle and health APIs SHALL describe accepted client connections as sessions.

The SDK MAY keep alpha compatibility aliases such as `createSurface` and `SurfaceHandle`, but aliases SHALL be documented as deprecated and SHALL delegate to the new space API without creating a second concept.

#### Scenario: Developer creates a space through the primary API

- **GIVEN** a developer imports the public SDK from `opentray`
- **WHEN** they create a desktop aggregation boundary
- **THEN** the documented API is `createSpace`
- **AND** the returned handle is a `SpaceHandle`
- **AND** example code does not use `createSurface`.

#### Scenario: Deprecated surface alias is not a parallel law

- **GIVEN** alpha compatibility keeps `createSurface`
- **WHEN** a developer calls the alias
- **THEN** it delegates to the same broker request path as `createSpace`
- **AND** docs mark the alias as deprecated
- **AND** no example teaches both names as equivalent first-class concepts.

### Requirement: Space creation options SHALL separate OpenTray identity from app identity

The primary space creation options SHALL use `id` or `spaceId` for the OpenTray aggregation identity. The old `appId` field SHALL NOT remain the only primary identity field because it confuses app identity with the space identifier. If platform application identity is needed later, it SHALL be added as a separate option with a distinct contract.

#### Scenario: Space option identity is clear

- **GIVEN** a developer reads `SpaceOptions`
- **WHEN** they choose an identifier for the aggregation boundary
- **THEN** the option is named `id` or `spaceId`
- **AND** they do not need to infer that `appId` actually means space identity.

#### Scenario: Returned ref exposes broker identity

- **GIVEN** the broker accepts a create-space request
- **WHEN** the SDK resolves the command
- **THEN** the returned ref includes `spaceId`
- **AND** it does not require an `appId` field unless separate app identity is explicitly requested.

## MODIFIED Requirements

### Requirement: TypeScript SDK SHALL connect to the versioned local broker

The `opentray` TypeScript package SHALL provide a local broker client that resolves the current package version and protocol version, connects to the derived daemon endpoint, sends `init`, and exposes broker-created space and tray handles. The client SHALL NOT return placeholder `pending:*` identities after a successful broker response path exists.

#### Scenario: Client receives broker-created space identity

- **GIVEN** the daemon is running for the current package version
- **WHEN** TypeScript code connects and calls `createSpace`
- **THEN** the client sends a request-correlated protocol command
- **AND** it resolves with the `SpaceRef` returned by the broker.

#### Scenario: Client rejects unsupported broker protocol

- **GIVEN** the client connects to a broker with an unsupported protocol response
- **WHEN** the handshake completes or fails
- **THEN** the client reports a typed connection error
- **AND** it does not create space or tray handles from placeholders.

### Requirement: Human-visible daemon tray example SHALL validate the mainline path

The workspace SHALL provide a human-facing example runnable as `pnpm --filter opentray example:daemon-tray`. The example SHALL auto-start or reuse the same-version daemon, connect through the daemon endpoint, create a space and tray through the public TypeScript SDK, print broker-created identities, and print routed tray/menu events.

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
- **AND** it closes its broker connection so the session cleanup path is exercised.

#### Scenario: Example demonstrates supported menu atoms

- **GIVEN** the daemon tray example creates its menu
- **WHEN** the menu is opened on a supported desktop platform
- **THEN** it includes item, disabled item, check, radio, separator, submenu, and quit actions
- **AND** click-capable items route events through the broker path.
