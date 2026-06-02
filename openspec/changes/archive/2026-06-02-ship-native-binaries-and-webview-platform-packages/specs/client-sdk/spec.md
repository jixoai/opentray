## ADDED Requirements

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
