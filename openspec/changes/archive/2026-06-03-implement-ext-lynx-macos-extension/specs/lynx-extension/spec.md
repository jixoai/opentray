## ADDED Requirements

### Requirement: Lynx SHALL be an official extension atom

The Lynx capability SHALL live outside the kernel as `@opentray/ext-lynx` plus platform-native package atoms. The daemon SHALL load it through the generic extension host law and SHALL NOT own Lynx command parsing, runtime setup, bundle staging, or process lifecycle.

#### Scenario: Lynx facade routes through the generic extension host

- **GIVEN** a client has a tray handle
- **WHEN** it calls the Lynx facade to show a bundle
- **THEN** the client emits an `ext-command` with `ext: "lynx"`
- **AND** the daemon dispatches that scoped envelope through the generic dynamic extension boundary
- **AND** the daemon does not parse Lynx-specific command fields itself.

### Requirement: Lynx show SHALL stage an external bundle into the runtime sidecar

The Lynx extension SHALL accept a client-owned `.lynx.bundle` path and SHALL stage that bundle into the Lynx runtime app resources before launch. The extension SHALL launch the runtime with the Lynx-local URL form proven by research rather than a raw absolute `file://` bundle path.

#### Scenario: Show command uses the proven Lynx external-bundle URL shape

- **GIVEN** a valid external `.lynx.bundle` path
- **WHEN** the Lynx extension handles `show`
- **THEN** it stages the bundle at `opentray-external/main.lynx.bundle` inside the runtime app resources
- **AND** it launches Lynx Explorer with `file://lynx?local://opentray-external/main.lynx.bundle`
- **AND** it returns a success event only after the launch command succeeds.

### Requirement: Lynx runtime packaging SHALL stay extension-owned

The official macOS Lynx platform packages SHALL contain the native extension dynamic library and the runtime sidecar zip required to launch Lynx Explorer. The daemon SHALL only discover and load the dynamic library generically. It SHALL NOT own or embed the Lynx runtime app bundle itself.

#### Scenario: Missing runtime sidecar is explicit

- **GIVEN** the Lynx extension library is present but the required runtime zip is missing
- **WHEN** a client requests `show`
- **THEN** the extension returns a typed unsupported or rejected error
- **AND** it does not report a fake successful window launch.

### Requirement: Lynx lifecycle SHALL be tray-scoped and cleanup-aware

The Lynx extension SHALL keep runtime state per active tray slot. Re-showing the same tray SHALL replace its previous Lynx process. `hide`, lease cleanup, and extension deinitialization SHALL close active Lynx child processes owned by that extension instance.

#### Scenario: Re-show replaces the previous tray runtime

- **GIVEN** a tray already has an active Lynx process
- **WHEN** the same tray receives another `show`
- **THEN** the extension closes the previous child process for that tray
- **AND** it launches the new bundle cleanly instead of leaking two runtimes.

#### Scenario: Hide closes the active Lynx runtime

- **GIVEN** a tray has an active Lynx process
- **WHEN** the client sends `hide`
- **THEN** the extension terminates that child process
- **AND** it emits a `hidden` lifecycle result instead of leaving an orphaned runtime window behind.

### Requirement: Lynx facade SHALL stay platform-neutral and bundle-path-centric

`@opentray/ext-lynx` SHALL depend only on public OpenTray contracts and typed command/event definitions. It SHALL NOT import platform-native package atoms from public API code. The primary public input SHALL be a `.lynx.bundle` path supplied by the caller.

#### Scenario: Public facade does not import darwin runtime packages

- **GIVEN** the public exports of `@opentray/ext-lynx`
- **WHEN** they are inspected
- **THEN** they expose typed Lynx commands and events over tray handles
- **AND** they do not require direct imports from `@opentray/ext-lynx-darwin-*`.

### Requirement: First-stage Lynx support SHALL be macOS-first and explicit

The first official Lynx extension release SHALL target macOS first. Unsupported platforms or missing runtime capabilities SHALL fail explicitly. The project SHALL NOT claim Linux or Windows visible Lynx support until those runtime paths are actually implemented and proven.

#### Scenario: Unsupported platform does not fake a window

- **GIVEN** a client tries to use Lynx on a platform without an implemented runtime package
- **WHEN** the daemon cannot resolve or the extension cannot launch
- **THEN** the command fails with a typed extension loading or capability error
- **AND** the project does not claim a visible Lynx window appeared.
