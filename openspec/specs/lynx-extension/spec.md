# lynx-extension Specification

## Purpose

Define the official OpenTray Lynx extension family, its macOS-first runtime packaging law, and its tray-scoped lifecycle over the generic extension host boundary.
## Requirements
### Requirement: Lynx SHALL be an official extension atom

The Lynx capability SHALL live outside the kernel as `@opentray/ext-lynx` plus platform-native package atoms. The daemon SHALL load it through the generic extension host law and SHALL NOT own Lynx command parsing, runtime setup, bundle staging, or process lifecycle.

#### Scenario: Lynx facade routes through the generic extension host

- **GIVEN** a client has a tray handle
- **WHEN** it calls the Lynx facade to show a bundle
- **THEN** the client emits an `ext-command` with `ext: "lynx"`
- **AND** the daemon dispatches that scoped envelope through the generic dynamic extension boundary
- **AND** the daemon does not parse Lynx-specific command fields itself.

### Requirement: Lynx show SHALL stage an external bundle into the runtime sidecar

The Lynx extension SHALL accept a client-owned `.lynx.bundle` path and SHALL stage that bundle into an OpenTray-owned Lynx runtime host app before launch. The extension SHALL launch the runtime with the Lynx-local URL form proven by research rather than a raw absolute `file://` bundle path.

The runtime carrier SHALL be an OpenTray-maintained minimal host app rather than a long-term dependency on the upstream `LynxExplorer.app` shell. Upstream Lynx runtime libraries and resources MAY still be reused, but the app bundle identity, host bridge ownership, and release artifact provenance SHALL belong to OpenTray.

#### Scenario: Show command uses the OpenTray-owned runtime host app

- **GIVEN** a valid external `.lynx.bundle` path
- **WHEN** the Lynx extension handles `show`
- **THEN** it stages the bundle at `opentray-external/main.lynx.bundle` inside the OpenTray Lynx runtime host app resources
- **AND** it launches the host app with `file://lynx?local://opentray-external/main.lynx.bundle`
- **AND** it returns a success event only after the launch command succeeds.

### Requirement: Lynx runtime packaging SHALL stay extension-owned

The official macOS Lynx platform packages SHALL contain the native extension dynamic library and the runtime sidecar zip required to launch the OpenTray-owned Lynx host app. The daemon SHALL only discover and load the dynamic library generically. It SHALL NOT own or embed the Lynx runtime app bundle itself.

The runtime sidecar SHALL remain an app bundle on macOS. This law does not require an in-process-only dylib runtime equivalent to the WebView extension.

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

### Requirement: Lynx host app source ownership SHALL belong to OpenTray

The macOS Lynx runtime sidecar SHALL be built from OpenTray-maintained host-app sources stored in this repository. OpenTray MAY reuse upstream Lynx shared libraries, resource bundles, and embedder APIs, but it SHALL NOT treat upstream `LynxExplorer.app` sources as the long-term product carrier.

#### Scenario: Host bridge source of truth is repo-owned

- **GIVEN** maintainers inspect the repository for the Lynx runtime host app source
- **WHEN** they review the source-of-truth implementation for window bridge, app delegate, bundle metadata, and resource packaging
- **THEN** those files live under an OpenTray-owned source root in this repository
- **AND** they are not represented only as patches against upstream Explorer app files.

### Requirement: Lynx public capability behavior SHALL survive the carrier migration

Changing the macOS runtime carrier from a borrowed Explorer shell to an OpenTray-owned host app SHALL NOT regress the public Lynx capability surface already accepted in OpenTray, including window-controller APIs, fit-content defaulting, tray-scoped lifecycle, and typed unsupported errors.

#### Scenario: Runtime carrier refactor preserves visible behavior

- **GIVEN** a developer runs the Lynx smoke flow after the carrier migration
- **WHEN** the runtime host app launches
- **THEN** `navigator.window` and `navigator.opentrayWindow` continue to work when enabled
- **AND** fit-content default behavior still avoids obvious dead margin
- **AND** explicit fixed-size mode still works
- **AND** unsupported style features still fail explicitly.
