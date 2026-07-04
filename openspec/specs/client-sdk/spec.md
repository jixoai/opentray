# client-sdk Specification

## Purpose

TBD - created by archiving change implement-broker-transport-kernel-dispatch. Update Purpose after archive.
## Requirements
### Requirement: TypeScript SDK SHALL connect to the versioned local broker

The `opentray` TypeScript package SHALL provide a local broker client that resolves the current package version, protocol version, and caller label, connects to the derived per-caller daemon endpoint, sends `init`, and exposes broker-created space and tray handles. The client SHALL NOT return placeholder `pending:*` identities after a successful broker response path exists.

The endpoint SHALL incorporate the caller label so that two host applications using the same OpenTray version connect to distinct brokers and do not share a session.

#### Scenario: Client receives broker-created space identity

- **GIVEN** the daemon is running for the current package version and caller label
- **WHEN** TypeScript code connects and calls `createSpace`
- **THEN** the client sends a request-correlated protocol command
- **AND** it resolves with the `SpaceRef` returned by the broker.

#### Scenario: Client rejects unsupported broker protocol

- **GIVEN** the client connects to a broker with an unsupported protocol response
- **WHEN** the handshake completes or fails
- **THEN** the client reports a typed connection error
- **AND** it does not create space or tray handles from placeholders.

#### Scenario: Same version, different labels connect to different brokers

- **GIVEN** two host applications use the same `opentray` version with different caller labels
- **WHEN** each connects
- **THEN** each resolves a different daemon endpoint
- **AND** each session is served by its own broker process.

### Requirement: TypeScript SDK SHALL expose broker events without stealing command responses

The local broker client SHALL continue separating command responses from broker-originated events. Eventful high-level handles SHALL use the same event stream instead of asking applications to filter raw frames in normal code.

#### Scenario: Menu click is delivered through tray helper

- **GIVEN** a client-created daemon tray is visible
- **WHEN** the user clicks a tray menu item
- **THEN** the owning tray handle can receive the event through `onMenuClick`
- **AND** no pending command promise is resolved by that event.

### Requirement: TypeScript SDK SHALL auto-start the local same-version daemon by default

The local broker client SHALL start or reuse the daemon for the current package version, protocol version, and caller label before connecting to the derived per-caller endpoint. Manual `opentray daemon start|stop|restart` commands SHALL remain available for operator and debugging workflows, but human examples and normal SDK usage SHALL NOT require the developer to start the daemon by hand.

#### Scenario: Example starts daemon automatically

- **GIVEN** a TypeScript example imports the SDK and constructs a client
- **WHEN** it connects without manually starting a daemon
- **THEN** the SDK starts or reuses the caller-scoped daemon
- **AND** proceeds to connect to the caller-scoped endpoint.

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

### Requirement: Top-level SDK SHALL expose tray-first convenience entrypoints

The public `opentray` package entrypoint SHALL export top-level convenience APIs for the tray-first path. A developer importing from `opentray` SHALL be able to call `createTray` as the primary entrypoint without first constructing a transport or manually creating an `OpenTrayClient`.

The package MAY continue exporting lower-level atoms such as `createClient` and `createTrayHandle`, but those SHALL NOT be the only documented entrypoints for ordinary SDK consumers.

#### Scenario: Top-level createTray is importable from opentray

- **GIVEN** a developer installs `opentray` from npm
- **WHEN** they evaluate the public exports of `opentray`
- **THEN** `createTray` is exported from the top-level package entrypoint
- **AND** calling it uses the same-version local broker connection law
- **AND** the returned handle is a `TrayHandle`.

#### Scenario: Top-level createTray uses local broker by default

- **GIVEN** a same-version broker is available or can be started
- **WHEN** a developer calls top-level `createTray` without diagnostic runtime options
- **THEN** the SDK uses the local broker transport
- **AND** it does not require the caller to manually create an `OpenTrayClient`.

#### Scenario: Explicit runtime mode bypasses default local broker selection

- **GIVEN** a developer passes diagnostic runtime options
- **WHEN** they call top-level `createTray`
- **THEN** the SDK uses the requested diagnostic runtime mode
- **AND** it does not invent a second default transport.

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

### Requirement: Top-level createTray SHALL normalize ergonomic menu input

The public `opentray` package MAY accept app-facing menu shorthand in top-level `createTray(...)` and the tray handle returned by that function. This shorthand SHALL normalize to pure protocol `TrayOptions` before crossing the runtime boundary. The `@opentray/spec` package, `TrayOptions`, `Menu`, `MenuItem`, and lower-level `createClient(...)` path SHALL remain protocol-only and SHALL NOT accept callbacks.

App-facing menu shorthand SHALL support plain string items, hyphen-only separator strings, tuple submenus such as `["Group", ["Child"]]`, plain item objects with omitted `type: "item"` and omitted `id`, and item-local `onMenuClick` callbacks. Generated ids SHALL be local implementation detail for callback routing; apps that need stable external identity SHOULD provide explicit ids.

#### Scenario: Shorthand menu becomes pure protocol data

- **GIVEN** a developer calls top-level `createTray(...)` with menu items `"Open"`, `"-"`, and `["Group", ["Child"]]`
- **WHEN** the SDK sends the create-tray request
- **THEN** the request contains only protocol menu items with explicit `type` and generated ids where needed
- **AND** it does not include callback functions.

#### Scenario: Item-local callback routes through menuClick

- **GIVEN** a shorthand item declares `onMenuClick`
- **WHEN** the owning tray receives `menuClick` for the normalized item id
- **THEN** the SDK invokes that item-local callback
- **AND** the protocol event remains a normal `menuClick`.

#### Scenario: setMenu replaces local callback bindings after ACK

- **GIVEN** a top-level tray handle has item-local menu callbacks
- **WHEN** the app calls `tray.setMenu(...)` with ergonomic menu input
- **THEN** the SDK sends normalized protocol menu data
- **AND** it replaces old item-local callback bindings only after the runtime acknowledges the menu update.

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

### Requirement: TypeScript SDK SHALL derive a caller label with explicit precedence

The SDK SHALL determine a caller label using the following precedence, highest first:

1. An explicit label passed by the developer, e.g. `new Client({ label: "myapp" })`.
2. The `npm_package_name` environment value when present.
3. The basename of `process.argv[1]` when it names a script.

The derived label SHALL be sanitized to a filesystem- and process-safe component (restricted to lowercase alphanumerics and hyphens, length-capped) before it is used in endpoint identity, runtime directory naming, and the broker process name. When no usable label is available after precedence resolution and sanitization, the SDK SHALL fall back to a neutral default label rather than impersonating an unrelated application.

#### Scenario: Explicit label wins

- **GIVEN** the environment would imply a different label
- **WHEN** a developer constructs `new Client({ label: "myapp" })`
- **THEN** the SDK uses `myapp` for endpoint identity and process naming.

#### Scenario: npm package name is used when no explicit label is given

- **GIVEN** `npm_package_name` is set to `my-tool`
- **AND** no explicit label is passed
- **WHEN** the client is constructed
- **THEN** the SDK derives the label from `npm_package_name`.

#### Scenario: Unsafe label is sanitized

- **GIVEN** a derived label contains characters outside the safe set
- **WHEN** the SDK sanitizes it
- **THEN** the resulting component is safe for use in socket paths and process names
- **AND** two distinct unsafe inputs do not collapse onto the same sanitized label unless they are genuinely equivalent.

#### Scenario: No usable label falls back neutrally

- **GIVEN** no explicit label, no `npm_package_name`, and no resolvable script basename
- **WHEN** the client is constructed
- **THEN** the SDK uses a neutral default label
- **AND** it does not impersonate another application.

### Requirement: TypeScript SDK SHALL inject the caller label into broker spawn

When the SDK starts the broker daemon, it SHALL pass the sanitized caller label to the broker so that the broker can bind the per-caller endpoint and present the caller-derived process name. The spawn arguments and environment SHALL carry the label; the broker SHALL NOT independently guess the caller.

#### Scenario: Spawn carries the caller label

- **GIVEN** a client with derived label `myapp` starts the daemon
- **WHEN** the SDK spawns the broker
- **THEN** the spawn environment or arguments include the `myapp` label
- **AND** the broker binds the per-caller endpoint derived from that label.

#### Scenario: Broker process name reflects the injected label

- **GIVEN** the SDK has spawned a broker with label `myapp`
- **WHEN** the operator inspects the process list
- **THEN** the broker process name reflects `myapp`
- **AND** is distinguishable from a generic `opentray` process.

### Requirement: Client SHALL reject pending requests on an uncorrelated error

When the client receives an error frame that carries no `requestId` and no handshake is pending, the client SHALL reject every pending request with that error rather than swallowing it. This prevents a malformed-frame error from leaving a request promise pending forever.

#### Scenario: Uncorrelated error rejects all pending requests

- **GIVEN** the client has one or more pending requests
- **WHEN** it receives an error frame with no `requestId`
- **THEN** every pending request rejects with that error
- **AND** no promise remains pending.

### Requirement: v0.9 SDK SHALL remove previous public compatibility surfaces

The v0.9 public SDK SHALL be a breaking tray-first API. It SHALL remove `createSpace`, `resolveDefaultSpace`, `createSurface`, `SpaceOptions`, `SpaceRef`, `SurfaceOptions`, `SurfaceRef`, top-level tray `title`, and public `spaceId`-based creation or routing from the public TypeScript entrypoint. Removed public concepts SHALL NOT remain as deprecated aliases.

The v0.9 protocol-facing SDK SHALL reject or fail to type-check old public input shapes rather than translating them into the new tray-first shape. Compatibility glue is forbidden for this change.

#### Scenario: Removed createSpace API is not exported

- **GIVEN** a developer imports from the v0.9 `opentray` package
- **WHEN** they inspect the public exports
- **THEN** `createSpace`, `resolveDefaultSpace`, and `createSurface` are absent
- **AND** `createTray` is the public creation entrypoint.

#### Scenario: Removed tray title field is rejected

- **GIVEN** a caller invokes v0.9 `createTray` with top-level `title`
- **WHEN** the TypeScript compiler or runtime validator evaluates the input
- **THEN** the old shape is rejected
- **AND** the caller must put visible tray text in `icon`.

### Requirement: Public tray creation SHALL use a unified icon projection field

The public `createTray` API SHALL expose one `icon` field for tray visual projection. The API SHALL NOT introduce a separate `icons`, `display`, `appearance`, or `presentation` field for the same concern.

The existing single-image icon payload SHALL be named `IconImage`. The public `Icon` contract SHALL represent the unified tray projection input: generic image-only candidates, text-only candidates, generic icon-with-text candidates, OS-scoped image and icon-text candidates, and simple fallback material carried through the same `icon` field.

The intended TypeScript shape SHALL preserve the user's intersection-style compression:

```ts
type IconImage =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

type Icons = {
  "icon-only"?: IconImage;
  "text-only"?: string;
  "icon-text"?: IconImage & { text: string };
  "darwin-icon-only"?: IconImage & { isTemplate?: boolean };
  "darwin-icon-text"?: IconImage & { text: string; isTemplate?: boolean };
  "win32-icon-only"?: IconImage;
  "win32-icon-text"?: IconImage & { text: string };
  "linux-icon-only"?: IconImage;
  "linux-icon-text"?: IconImage & { text: string };
};

type SimpleIcon = IconImage & { text?: string };

type Icon = Icons & SimpleIcon;
```

`Icons` SHALL remain a pure explicit-candidate map. It SHALL NOT contain a generic `text` field. Generic fallback text belongs to `SimpleIcon.text`, so fallback image and fallback text share one simple icon atom. Darwin `isTemplate` SHALL be metadata only on Darwin candidates.

Implementation MAY refine the exact TypeScript expression if plain `Icons & SimpleIcon` prevents valid candidate-only values, but it MUST preserve the public contract: one `icon` field, `IconImage` as the image atom, `SimpleIcon` as fallback material, and generic plus OS-scoped candidate maps as part of `Icon` rather than a sibling field.

#### Scenario: Simple icon remains low ceremony

- **GIVEN** a caller invokes `createTray` with `icon` set to a plain image payload
- **WHEN** the SDK serializes the tray options
- **THEN** the image payload is treated as the fallback icon image
- **AND** the caller does not need to write a separate candidate map.

#### Scenario: Responsive icon candidates use the icon field

- **GIVEN** a caller invokes `createTray` with generic icon candidates, OS-scoped icon candidates, or `SimpleIcon` fallback fields
- **WHEN** the SDK and broker evaluate tray display options
- **THEN** those candidates are read from `icon`
- **AND** no separate `icons`, `display`, `appearance`, or `presentation` option is required.

#### Scenario: Darwin template metadata stays scoped to Darwin candidates

- **GIVEN** a caller provides `icon["darwin-icon-only"].isTemplate` or `icon["darwin-icon-text"].isTemplate`
- **WHEN** the public type contract accepts the icon
- **THEN** the template flag belongs to the Darwin candidate
- **AND** generic, Win32, and Linux candidates do not gain template-specific fields.

### Requirement: Public SDK SHALL export application-facing tray types

The `opentray` package SHALL re-export the common application-facing TypeScript types that callers need to author tray code without deriving shapes from runtime functions. At minimum, the public entrypoint SHALL provide `CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, and `TrayBoundsResult`.

Application examples and consumer skills SHALL import these names from `opentray` or the source entrypoint used by repository-local examples. They SHALL NOT teach ordinary app code to derive SDK shapes with `Parameters<typeof createTray>` or import `@opentray/spec` directly for common tray options, icons, menus, tooltips, or events. Direct `@opentray/spec` imports remain valid for low-level protocol tooling and package-internal code.

#### Scenario: App code can name createTray options directly

- **GIVEN** an application imports `createTray` and `CreateTrayOptions` from `opentray`
- **WHEN** it declares its tray options before calling `createTray`
- **THEN** the public type is available without `typeof` inference
- **AND** the type describes the same first argument accepted by `createTray`.

#### Scenario: App code can name icon and menu atoms directly

- **GIVEN** an application exports a helper that builds a tray icon or menu
- **WHEN** it imports `TrayIcon` or `TrayMenu` from `opentray`
- **THEN** the helper can publish a stable application-facing type
- **AND** it does not need a direct `@opentray/spec` dependency for ordinary tray authoring.

### Requirement: Icon candidate selection SHALL prefer current-OS candidates before same-mode generic candidates

The tray projection resolver SHALL derive display candidates from `icon` using deterministic order. It SHALL inspect the following candidate sources:

1. Current-OS `icon["<os>-icon-only"]` and generic `icon["icon-only"]` as the effective icon-only candidate.
2. `icon["text-only"]` as the explicit text-only candidate.
3. Current-OS `icon["<os>-icon-text"]` and generic `icon["icon-text"]` as the effective icon-with-text candidate.
4. `SimpleIcon` fallback fields picked from `icon`, including `type`, `data`, `path`, `width`, `height`, and optional `text`, as fallback material.

When choosing the effective projection for a platform, explicit only-mode candidates SHALL have highest priority for their matching mode because they are authored as "only" projections. The effective priority SHALL be:

```text
effective icon-only
text-only
effective icon-text
fallback
```

The effective icon-only candidate SHALL use the current OS-specific key when present and otherwise use `icon["icon-only"]`. The effective icon-text candidate SHALL use the current OS-specific key when present and otherwise use `icon["icon-text"]`. OS-specific keys for other operating systems SHALL be ignored by the current platform resolver.

The fallback candidate SHALL be computed from `SimpleIcon` fields when present; if those fields are absent, fallback MAY use effective icon-text, effective icon-only, then text-only so explicitly authored candidates can still degrade to another platform-supported mode.

#### Scenario: Explicit icon-only wins for icon-only platforms

- **GIVEN** `icon["icon-only"]` is present
- **AND** the selected platform projection mode is icon-only
- **WHEN** the resolver selects the tray projection
- **THEN** it uses `icon["icon-only"]` before any generic top-level fallback image
- **AND** it does not synthesize an icon from text.

#### Scenario: Current OS icon-only shadows generic icon-only

- **GIVEN** `icon["darwin-icon-only"]` and `icon["icon-only"]` are present
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects an icon-only projection
- **THEN** it uses `icon["darwin-icon-only"]`
- **AND** it does not read `icon["icon-only"]` for that mode.

#### Scenario: Non-current OS candidates do not shadow generic candidates

- **GIVEN** `icon["win32-icon-only"]` and `icon["icon-only"]` are present
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects an icon-only projection
- **THEN** it ignores `icon["win32-icon-only"]`
- **AND** it may use `icon["icon-only"]`.

#### Scenario: Explicit text-only wins for text-only platforms

- **GIVEN** `icon["text-only"]` is present
- **AND** the selected platform projection mode is text-only
- **WHEN** the resolver selects the tray projection
- **THEN** it uses `icon["text-only"]` before `icon["icon-text"].text` or `SimpleIcon.text`
- **AND** it does not require an image payload.

#### Scenario: Icon-text is used before generic fallback when only modes do not apply

- **GIVEN** effective `icon["<os>-icon-text"]` or generic `icon["icon-text"]` is present
- **AND** no applicable `icon-only` or `text-only` projection is selected
- **WHEN** the resolver needs an icon-with-text projection
- **THEN** it uses the effective icon-text candidate
- **AND** the candidate's `text` belongs to the icon projection rather than to a separate `title` ontology.

#### Scenario: Darwin icon-text can carry template metadata and visible text

- **GIVEN** `icon["darwin-icon-text"]` has image data, `text`, and `isTemplate: true`
- **AND** the selected platform is Darwin
- **WHEN** the resolver selects icon-text projection
- **THEN** it uses the Darwin candidate image and text
- **AND** the template flag is preserved for the native Darwin tray backend.

#### Scenario: Explicit candidates can still provide fallback

- **GIVEN** no `SimpleIcon` image fields are present on `icon`
- **AND** one or more explicit candidates are present
- **WHEN** the resolver computes fallback material
- **THEN** it MAY fall back through effective icon-text, effective icon-only, and text-only in that order
- **AND** it MUST preserve the rule that only-mode candidates win for their own projection modes.

### Requirement: Tray visible text SHALL live in icon projection

Tray text that participates in visible tray projection SHALL belong to `SimpleIcon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. The v0.9 `createTray` input SHALL NOT accept top-level `title` as a second source for visible tray text.

If a future API needs a separate human-readable name, window title, diagnostics label, or accessibility label, it SHALL use a field whose name describes that role. It SHALL NOT reuse `title` as a competing tray display text source.

#### Scenario: Top-level title is rejected as tray display text

- **GIVEN** a caller invokes v0.9 `createTray` with a top-level `title`
- **WHEN** the tray projection is resolved
- **THEN** the input is rejected by type checking or runtime validation
- **AND** the caller is directed to use `icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`.

#### Scenario: Icon text is the only visible text source

- **GIVEN** a caller provides `icon["icon-text"].text`
- **WHEN** the backend selects an icon-text projection
- **THEN** that text is the visible tray text
- **AND** no top-level `title` can override or shadow it.

### Requirement: SDK tray handles SHALL bind to runtime host and not a public daemon concept

The public SDK SHALL treat transport and lifecycle as host binding concerns. It SHALL not require callers to understand daemon mode, broker mode, or surface/space ownership in order to create, extend, or destroy a tray. The public TypeScript surface SHALL operate through tray handles and runtime-host-bound transport, not a public daemon object.

#### Scenario: Tray creation stays host-bound

- **GIVEN** a developer imports from the v0.9 `opentray` package
- **WHEN** they create a tray
- **THEN** the returned handle is bound to the current runtime host context
- **AND** the caller does not need to create or manage a public daemon object first.
