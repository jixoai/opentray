# client-sdk delta

## MODIFIED Requirements

### Requirement: TypeScript SDK SHALL connect to the versioned local broker

The `opentray` TypeScript package SHALL provide a local broker client that resolves the current package version, protocol version, and caller label, connects to the derived per-caller daemon endpoint, sends `init`, and exposes broker-created tray handles. The client SHALL NOT return placeholder `pending:*` identities after a successful broker response path exists.

The caller label SHALL be derived with exactly this precedence: an explicit internal diagnostic override (never a public option), then the caller's `appId` normalized to a filesystem-safe slug when app identity is supplied, then the tool fallbacks (`npm_package_name`, script basename, neutral `opentray`). `appName` SHALL NOT participate in endpoint derivation, because display names are not filesystem-safe. `callerLabel` SHALL remain an internal transport field plus diagnostic surface; it SHALL NOT be exposed as a public `createTray` runtime option.

For app-style consumers the endpoint SHALL be stable across every launch method of the same app (CLI open, direct `node` invocation, carrier cold start), because the app identity is the routing truth. The endpoint migration caused by this rule for existing installed apps is one-time and self-cleaning: brokers on legacy endpoints exit when their last session closes, and the shared Darwin bundle is not endpoint-scoped.

#### Scenario: Same app reaches the same broker from every launch method

- **GIVEN** a generated app with `appId com.baidu` started via CLI open, via direct `node entry`, and via carrier cold start
- **WHEN** each entry connects
- **THEN** all three resolve the same `<version>/<app-id-slug>` endpoint
- **AND** the single-session guard protects real single-instance behavior across those launches.

#### Scenario: Display names never become endpoint segments

- **GIVEN** an app whose `appName` contains non-ASCII characters and punctuation
- **WHEN** the endpoint is derived
- **THEN** the label contains only the normalized `appId` slug
- **AND** no path segment is derived from `appName`.

#### Scenario: Two tool consumers stay isolated

- **GIVEN** two host applications use the same `opentray` version with no `appId` and different resolved labels
- **WHEN** each connects
- **THEN** each resolves a different daemon endpoint
- **AND** each session is served by its own broker process.

#### Scenario: Client rejects unsupported broker protocol

- **GIVEN** the client connects to a broker with an unsupported protocol response
- **WHEN** the handshake completes or fails
- **THEN** the client reports a typed connection error
- **AND** it does not create tray handles from placeholders.

## ADDED Requirements

### Requirement: Transport death SHALL terminate every await and listener

When the broker connection dies (socket close, error, or broker process exit), the SDK SHALL propagate a connection-dead state to every surface it handed out: pending command requests reject (existing behavior), event subscriptions and listener surfaces receive a terminal notification or stop delivering and report the death, gap-resync awaits for `(value, seq)` query pairs are cancelled and rejected, and eventful tray/window/webview handles enter a visibly dead state instead of silently absorbing failures.

Fire-and-forget surfaces (best-effort pushes, resync scheduling) SHALL route their failures into the connection-dead state instead of only printing to console. Generated app entries SHALL react to connection death with an explicit policy (exit non-zero or bounded supervised restart) and SHALL never keep serving a shell with a dead backend.

#### Scenario: Every await ends after broker death

- **GIVEN** an SDK consumer holds pending command promises, an active event subscription, and an in-flight `(value, seq)` query await when the broker process is killed
- **WHEN** the connection-dead state fires
- **THEN** each await settles (rejects) within a bounded time
- **AND** the consumer can observe the death through a documented surface rather than silence.

#### Scenario: Zombie entry is impossible

- **GIVEN** a generated app entry whose broker dies while the entry keeps a live shell server
- **WHEN** the connection-dead state fires
- **THEN** the entry exits or restarts per its explicit policy
- **AND** it does not remain alive with a dead backend and no error surface.
