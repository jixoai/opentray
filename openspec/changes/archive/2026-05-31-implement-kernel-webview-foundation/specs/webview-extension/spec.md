## ADDED Requirements

### Requirement: Webview SHALL be an extension atom

The webview capability SHALL live outside the kernel as `@opentray/ext-webview` and an equivalent native extension implementation. It SHALL expose typed commands for showing, hiding, navigating, evaluating JavaScript, and exchanging messages with web content. It SHALL not own surface lifecycle, tray lifecycle, lease cleanup, or backend selection.

#### Scenario: Webview command is routed through extension host

- **GIVEN** a client calls the webview facade for an existing tray
- **WHEN** the facade sends a `show` command
- **THEN** the Node client emits an `ext-command` frame with `ext` set to `webview`
- **AND** the kernel dispatches it through the registered webview extension instance.

### Requirement: Webview positioning SHALL depend on backend capabilities

The webview extension SHALL position a popup relative to the physical surface rect when rect capability is available. If rect capability is unavailable, it SHALL use a documented fallback such as cursor position or platform default anchoring. The fallback SHALL be visible in capability metadata or structured logs.

#### Scenario: Missing rect capability uses fallback

- **GIVEN** the Linux backend cannot provide a reliable physical tray rect
- **WHEN** the webview extension is asked to show a popup
- **THEN** it does not assume a fake rect
- **AND** it uses the configured fallback positioning strategy.

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each popup instance with a surface/tray scope and the owning lease. Lease cleanup SHALL hide or destroy webview state owned by the disconnected client without affecting webview state owned by other leases.

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview instance owned by that lease
- **AND** other clients' webview instances remain unaffected.

### Requirement: Webview facade SHALL be typed and platform-neutral

The TypeScript `@opentray/ext-webview` facade SHALL depend only on `opentray` public contracts and `@opentray/spec` types. It MUST NOT import platform binary packages, Rust backend implementation details, or private kernel protocol internals.

#### Scenario: Webview package stays platform neutral

- **GIVEN** `@opentray/ext-webview` is installed in a project
- **WHEN** its public exports are inspected
- **THEN** they expose typed webview commands and events
- **AND** they do not require importing any `@opentray/<platform>` binary package directly.
