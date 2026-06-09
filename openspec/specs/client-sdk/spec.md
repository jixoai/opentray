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

The same vocabulary rule SHALL apply to tray-owned capability helpers. Geometry, menu display, and other tray-scoped trusted operations SHALL live on `TrayHandle` rather than on `SpaceHandle` or extension-specific facades unless a later product story proves otherwise.

The SDK MAY keep alpha compatibility aliases such as `createSurface` and `SurfaceHandle`, but aliases SHALL be documented as deprecated and SHALL delegate to the new space API without creating a second concept.

#### Scenario: Developer creates a space through the primary API

- **GIVEN** a developer imports the public SDK from `opentray`
- **WHEN** they create a desktop aggregation boundary
- **THEN** the documented API is `createSpace`
- **AND** the returned handle is a `SpaceHandle`
- **AND** example code does not use `createSurface`.

#### Scenario: Tray-owned helper stays on TrayHandle

- **GIVEN** a developer needs the physical anchor of a tray contribution
- **WHEN** they inspect the typed SDK handles
- **THEN** the tray-bounds capability is exposed on `TrayHandle`
- **AND** it is not promoted to `SpaceHandle` where multiple trays would make the geometry ambiguous.

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

### Requirement: CLI SHALL stay daemon-lifecycle focused

The published `opentray` CLI SHALL expose daemon lifecycle and health commands only. It SHALL NOT grow product-specific visual smoke commands. Visual acceptance SHALL be orchestrated by skills, source-tree examples, or explicit SDK scripts so the package CLI remains a small operator surface rather than a demo runner.

#### Scenario: Fresh npm install has pure daemon commands

- **GIVEN** a fresh project installed `opentray` from npm
- **WHEN** the developer runs `opentray daemon health`
- **THEN** the command inspects same-version daemon state without starting a new daemon.

#### Scenario: Product smoke is not a public CLI command

- **GIVEN** a fresh project installed `opentray` from npm
- **WHEN** the developer attempts a product-specific visual smoke subcommand
- **THEN** the CLI rejects the command as unsupported/help
- **AND** official guidance points visual acceptance to the OpenTray skill or source-tree examples instead of a package-owned smoke subcommand.

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

### Requirement: Top-level createTray SHALL forward tray icon sources unchanged

The public `opentray` package entrypoint SHALL accept the typed `TrayOptions.icon` source shape and SHALL forward it to the broker request without doing client-side PNG decoding or file normalization. Icon ergonomics belong to the tray backend adapter, not to the TypeScript facade.

#### Scenario: File-backed tray icon is forwarded through the SDK

- **GIVEN** a developer calls top-level `createTray` with `icon: { type: "file", path: "./tray-icon.png" }`
- **WHEN** the SDK prepares the broker request
- **THEN** the outgoing `create-tray` request still carries the file-backed icon source shape
- **AND** the SDK does not convert it to RGBA locally.

### Requirement: Tray handles SHALL expose tray-bounds capability

The public TypeScript SDK SHALL expose tray placement as a tray-owned capability on `TrayHandle`. The promoted backend API SHALL remain `await tray.getBounds()` for this change, but the returned value SHALL be a richer tray-placement result rather than bare `Rect | null`.

This capability SHALL remain tray-owned rather than WebView-owned. The SDK SHALL NOT require developers to go through `commandExtension("webview", ...)` or another extension-specific facade to query tray placement for a tray they already own.

#### Scenario: Trusted backend code reads tray placement with provenance

- **GIVEN** a developer has a `TrayHandle` for an existing tray contribution
- **WHEN** they call `await tray.getBounds()`
- **THEN** the SDK sends a broker-backed tray placement request for that tray identity
- **AND** it resolves to a result that states placement provenance through `kind` and `source`
- **AND** the result includes the resolved rectangle when one exists.

#### Scenario: Tray placement API remains tray-owned

- **GIVEN** a developer inspects the public SDK surface
- **WHEN** they look for tray geometry
- **THEN** the capability exists on `TrayHandle`
- **AND** it is not modeled as `webview.tray.getBounds()` or another extension-owned API.

### Requirement: Tray menu items SHALL support a primary event role

The public TypeScript protocol SHALL allow a plain menu button item to declare `primaryEvent: true`. A primary item SHALL remain a normal `type: "item"` menu entry: it SHALL still render as a native menu item where the backend shows menus, and choosing it from the menu SHALL emit the same `menuClick` event as before.

The primary role SHALL be additive. Existing menu items without `primaryEvent` SHALL keep their existing behavior. Check, radio, separator, and submenu container items SHALL NOT become primary targets in this change.

#### Scenario: Developer declares a primary menu item

- **GIVEN** a developer creates a tray menu with a plain item `{ type: "item", id: 8, title: "Show Window", primaryEvent: true }`
- **WHEN** TypeScript code type-checks the menu declaration
- **THEN** the declaration is accepted by the public `MenuItem` type
- **AND** the item still has the normal menu item fields such as `id`, `title`, `enabled`, and `shortcut`.

#### Scenario: Primary item still emits menuClick

- **GIVEN** a primary menu item has id `8`
- **WHEN** the native backend activates the primary action
- **THEN** the client receives an `event` frame whose event is `menuClick`
- **AND** the event carries the same `itemId: 8` used by normal menu selection.

### Requirement: Tray placement result SHALL carry provenance in the public SDK

The public TypeScript SDK SHALL expose tray placement through a durable result shape that can represent authoritative native bounds, future inferred placement, and unavailable placement. This result shape SHALL be tray-owned and SHALL be reusable by both trusted host code and page projections.

The result SHALL carry at least the resolved rectangle when available, a provenance kind, and a source identifier or equivalent explanation of how the result was obtained.

#### Scenario: Trusted host code can tell whether tray placement is authoritative

- **GIVEN** a developer has a `TrayHandle` for an existing tray contribution
- **WHEN** they call the tray placement API
- **THEN** the result tells them whether the returned rectangle is authoritative or unavailable through `kind`
- **AND** host code does not have to infer that distinction from `null` versus non-`null` alone.

### Requirement: Tray handles SHALL support typed extension mounting

The public TypeScript SDK SHALL expose a generic `TrayHandle.extend(extension, options)` capability. The base SDK SHALL understand only the generic extension mount contract; it SHALL NOT import or branch on concrete extension packages such as WebView or Lynx.

`extend(...)` SHALL return the original tray handle intersected with the mounted extension capability so TypeScript users only see extension-specific methods after mounting that extension.

#### Scenario: Mounted capability appears on the returned tray handle

- **GIVEN** a tray extension atom declares a typed capability
- **WHEN** a developer calls `tray.extend(extension, options)`
- **THEN** the returned value exposes the extension capability methods
- **AND** an unextended tray handle does not need to know those methods.

### Requirement: Tray handles SHALL expose generic extension loading for extension atoms

The public SDK SHALL expose `TrayHandle.loadExtension({ name, path, mountId })` for extension atoms and advanced callers. This method SHALL send the existing `load-ext` request family and SHALL include `mountId` when provided.

The SDK SHALL keep `commandExtension(ext, data)` available as the generic command dispatch path. Extension facades MAY use it through their mount context, but ordinary WebView docs SHOULD prefer typed extension capabilities.

#### Scenario: Extension mount loads once then commands through mount id

- **GIVEN** a mounted extension has `name: "webview"` and `mountId: "webview.tray-a"`
- **WHEN** the extension sends its first command
- **THEN** the SDK first sends `load-ext` with `name: "webview"` and `mountId: "webview.tray-a"`
- **AND** it sends `ext-command` with `ext: "webview.tray-a"`.

### Requirement: Public SDK guidance SHALL surface the current protocol line selector

The public `opentray` package documentation and examples SHALL explain that `latest` is convenience-only and that `stable-A-B` / `alpha-A-B` are protocol-line compatibility selectors. The guidance SHALL tell consumers and AI agents that when the line advances, the install selector for the affected package closure must move with it. The guidance SHALL not imply that a protocol-line tag is extension-specific.

#### Scenario: Consumer docs show line-pinned install

- **GIVEN** a developer reads the public install guidance
- **WHEN** they want a compatibility-pinned install
- **THEN** the guidance shows a protocol-line selector such as `stable-1-2`
- **AND** it does not suggest a tag such as `stable-webview-1-2`.

#### Scenario: Docs distinguish convenience from compatibility

- **GIVEN** a developer wants the newest package without line pinning
- **WHEN** they read the install guidance
- **THEN** the docs may still mention `latest`
- **AND** they clearly label it as convenience rather than a compatibility contract.
