# client-sdk Specification Delta

## MODIFIED Requirements

### Requirement: TypeScript SDK SHALL connect to the caller-scoped local broker

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

### Requirement: TypeScript SDK SHALL auto-start the caller-scoped local daemon by default

The local broker client SHALL start or reuse the daemon for the current package version, protocol version, and caller label before connecting to the derived per-caller endpoint. Manual `opentray daemon start|stop|restart` commands SHALL remain available for operator and debugging workflows, but human examples and normal SDK usage SHALL NOT require the developer to start the daemon by hand.

#### Scenario: Example starts daemon automatically

- **GIVEN** a TypeScript example imports the SDK and constructs a client
- **WHEN** it connects without manually starting a daemon
- **THEN** the SDK starts or reuses the caller-scoped daemon
- **AND** proceeds to connect to the caller-scoped endpoint.

## ADDED Requirements

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
