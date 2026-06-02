# client-sdk Specification

## Purpose
TBD - created by archiving change implement-broker-transport-kernel-dispatch. Update Purpose after archive.
## Requirements
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

The workspace SHALL provide a human-facing example runnable as `pnpm --filter opentray example:daemon-tray`. The example SHALL auto-start or reuse the same-version daemon, connect through the daemon endpoint, create a surface and tray through the public TypeScript SDK, print broker-created identities, and print routed tray/menu events. The example SHALL make its quit action unambiguous and SHALL exit when its quit menu item is routed back as a `menuClick` event. The example SHALL also cover the first-stage `@opentray/ext-webview` package command surface by invoking WebView facade actions through the public tray handle. On macOS, selecting `Show HTML` SHALL open a real native WebView window through the daemon runtime.

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

#### Scenario: Quit item visibly exits the demo

- **GIVEN** the daemon tray example is running
- **WHEN** the user selects the quit menu item
- **THEN** the example prints the routed menu click
- **AND** the example closes its broker connection
- **AND** the example process exits without requiring a manual daemon stop.

#### Scenario: Example includes ext-webview command surface

- **GIVEN** the daemon tray example has created a tray handle
- **WHEN** the user selects WebView menu actions
- **THEN** the example calls `@opentray/ext-webview` facade methods such as `show`, `navigate`, `postMessage`, `evaluate`, and `hide`
- **AND** the extension commands travel through the public `TrayHandle.commandExtension` path
- **AND** the example prints the broker response or extension event output.

#### Scenario: WebView show action opens a real native window

- **GIVEN** the daemon tray example is running on macOS
- **WHEN** the user selects `WebView Commands -> Show HTML`
- **THEN** a real native WebView window appears with the demo HTML
- **AND** the terminal prints the routed menu click and accepted WebView command
- **AND** the implementation keeps `wry` out of `opentray-core`.

#### Scenario: WebView message and evaluate actions visibly update the window

- **GIVEN** the daemon tray example has opened its WebView demo window
- **WHEN** the user selects `WebView Commands -> Post Message`
- **THEN** the WebView document visibly displays the posted payload
- **WHEN** the user selects `WebView Commands -> Evaluate JS`
- **THEN** the WebView document visibly displays the evaluated status
- **AND** these actions still travel through the `@opentray/ext-webview` facade.

### Requirement: CLI daemon health SHALL inspect without starting the daemon

The public CLI SHALL support `opentray daemon health`. The command SHALL inspect the same-version daemon state. If the daemon is not running, the command SHALL report that state without starting a new daemon. If the daemon is running, the command SHALL connect to the local endpoint, request daemon health, and print the daemon pid, endpoint, package/protocol metadata, session count, and session metadata returned by the daemon.

#### Scenario: Health reports not running without auto-start

- **GIVEN** no same-version daemon is running
- **WHEN** the developer runs `opentray daemon health`
- **THEN** the command reports `opentray daemon not running`
- **AND** it does not start a new daemon process.

#### Scenario: Health reports running daemon metadata

- **GIVEN** a same-version daemon is running
- **WHEN** the developer runs `opentray daemon health`
- **THEN** the command prints pid, endpoint, package version, protocol version, and session count
- **AND** it prints session lease metadata where the daemon has it.

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

### Requirement: CLI SHALL resolve installed daemon platform packages

The `opentray` CLI SHALL resolve the daemon executable from the current platform optional package when running from an installed npm package. Resolution priority SHALL be explicit `OPENTRAY_BROKER_BIN`, then installed `@opentray/<os>-<arch>` package artifact, then workspace development build fallback.

The resolver SHALL return a structured error when no platform binary is available. It SHALL NOT silently build from source outside a workspace, and it SHALL NOT download binaries at runtime.

#### Scenario: Installed package uses platform daemon binary

- **GIVEN** `opentray` is installed from npm in a clean project
- **AND** the current platform optional package is installed
- **WHEN** the CLI starts the daemon
- **THEN** it executes the daemon binary from `@opentray/<os>-<arch>/bin/opentray` or `opentray.exe`
- **AND** it passes the version-scoped endpoint and protocol arguments.

#### Scenario: Missing platform binary fails honestly

- **GIVEN** `opentray` is installed from npm
- **AND** no matching platform package binary can be resolved
- **WHEN** the CLI attempts to start the daemon
- **THEN** it fails with a typed message naming the missing platform package
- **AND** it does not fall back to a fake or unrelated daemon.

### Requirement: CLI SHALL provide npm-installable visual smoke

The published `opentray` package SHALL include a public command path that can exercise daemon startup, tray creation, and WebView extension commands from a fresh npm install. The smoke path SHALL NOT require workspace source files or `pnpm --filter`.

#### Scenario: Fresh npm install can run visual smoke

- **GIVEN** a fresh project installed `opentray` and `@opentray/ext-webview` from npm
- **WHEN** the developer runs the documented smoke command
- **THEN** it auto-starts the daemon from the installed platform package
- **AND** it exposes a real tray/WebView flow for human visual verification.

### Requirement: Top-level SDK SHALL expose broker-backed convenience entrypoints

The public `opentray` package entrypoint SHALL export top-level convenience APIs for the mainline broker-backed path. A developer importing from `opentray` SHALL be able to call `createSpace` as the primary entrypoint without first constructing a transport or manually creating an `OpenTrayClient`.

The package MAY continue exporting lower-level atoms such as `createClient` and `createSpaceHandle`, but those SHALL NOT be the only documented entrypoints for ordinary SDK consumers.

#### Scenario: Top-level createSpace is importable from opentray

- **GIVEN** a developer installs `opentray` from npm
- **WHEN** they evaluate the public exports of `opentray`
- **THEN** `createSpace` is exported from the top-level package entrypoint
- **AND** calling it uses the same-version local broker connection law
- **AND** the returned handle is a `SpaceHandle`.

#### Scenario: Deprecated surface alias remains a wrapper only

- **GIVEN** alpha compatibility keeps `createSurface`
- **WHEN** a developer imports the alias from `opentray`
- **THEN** it delegates to the same implementation path as `createSpace`
- **AND** the package docs mark it as deprecated.

### Requirement: Top-level createTray SHALL resolve the default space through broker law

The public `opentray` package entrypoint SHALL expose a top-level `createTray` convenience API. When the caller does not provide an explicit target space, the API SHALL resolve the default space through the broker protocol rather than inventing a client-local fake default.

The package MAY also expose an explicit `resolveDefaultSpace` helper so the default-space law is observable and testable from the public SDK surface.

#### Scenario: Top-level createTray uses default space resolution

- **GIVEN** a same-version daemon is available
- **AND** the broker has a default space
- **WHEN** a developer calls top-level `createTray` without an explicit space
- **THEN** the SDK sends the broker request that resolves the default space
- **AND** it creates the tray under the resolved space
- **AND** it does not require the caller to manually create an `OpenTrayClient`.

#### Scenario: Explicit space bypasses default-space lookup

- **GIVEN** a developer already holds a `SpaceRef`
- **WHEN** they call top-level `createTray` with that explicit space
- **THEN** the SDK creates the tray under that space directly
- **AND** it does not send an unnecessary default-space resolution request.

