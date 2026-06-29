# runtime-host Specification

## Purpose
TBD - created by archiving change opentray-v0-9. Update Purpose after archive.
## Requirements
### Requirement: Runtime host SHALL be version-scoped and app-isolated

The runtime host SHALL store runtime state under `~/.opentray/<packageVersion>/<callerLabel>/runtime/` and SHALL operate only on the identity for the current package or binary version, protocol version, and caller label. In v0.9, the caller label is a sanitized runtime slug derived from the app identity, while the human-facing `app.name` is used for display and process naming. The runtime host SHALL NOT discover, stop, restart, or reuse hosts from another package version or another caller label. Two different callers of the same package version SHALL resolve to different runtime directories and different runtime host endpoints.

#### Scenario: Start is isolated by package version

- **GIVEN** `opentray@0.1.0` and `opentray@0.2.0` are installed
- **WHEN** each starts its runtime host
- **THEN** each resolves a different runtime directory
- **AND** each resolves a different runtime host endpoint.

#### Scenario: Start is isolated by caller label

- **GIVEN** two host applications both depend on `opentray@0.1.0`
- **AND** one uses caller label `myapp` and the other uses caller label `cli-tool`
- **WHEN** each starts its runtime host
- **THEN** each resolves a different runtime directory
- **AND** each resolves a different runtime host endpoint
- **AND** neither host serves the other caller's session.

### Requirement: Runtime distribution SHALL use platform executables

Platform runtime packages SHALL carry the packaged runtime executable at `bin/opentray` or `bin/opentray.exe`. The published `opentray` package SHALL discover and start that executable as the normal app runtime artifact. It SHALL NOT require `runtime/opentray_runtime.node` or any other Node addon on the public path.

Contributor-only build outputs MAY still exist in the source tree for smoke tests and transport diagnostics, but they SHALL NOT become release truth for `opentray` or `@opentray/<os>-<arch>` platform packages.

#### Scenario: Platform package carries an executable runtime

- **GIVEN** `@opentray/darwin-arm64` is staged for publish
- **WHEN** package contents are inspected
- **THEN** the core runtime artifact is `bin/opentray`
- **AND** no `runtime/opentray_runtime.node` binding is required for the normal package runtime path.

#### Scenario: Release graph builds the executable runtime host

- **GIVEN** a changeset releases `opentray`
- **WHEN** the native release planner infers required native work
- **THEN** it selects the `runtime` component
- **AND** it builds `opentray-bin` rather than `opentray-runtime-node`.

### Requirement: Runtime host SHALL accept exactly one caller session for one app identity

A runtime host SHALL accept exactly one caller session for normal operation. The session is pinned to one app identity, one caller label, and one runtime host endpoint. A second connection attempt to a host that is already serving a session SHALL be rejected with a typed protocol error and SHALL NOT cause the host to aggregate or share state across callers.

#### Scenario: Second connection is rejected

- **GIVEN** a runtime host is already serving one caller session
- **WHEN** a second caller connects to the same endpoint
- **THEN** the runtime host rejects the second connection with a typed protocol error
- **AND** the first session is unaffected.

### Requirement: Runtime host SHALL remove visible state when caller authority is lost

Because v0.9 treats the caller app as the only source of action, a detached runtime host process SHALL NOT keep tray, extension, or native event-route state alive after the owning caller session disconnects, exits, or crashes. Caller disconnect SHALL close the session through the kernel, remove all trays and extension state owned by that session, unregister native event routes, and resync the backend to an empty visible state before the host idles or exits.

The runtime host MAY remain alive only as an idle implementation process with no visible app effects and no active event routes. It SHALL NOT preserve interactive tray UI on behalf of a dead caller.

#### Scenario: Caller crash removes trays

- **GIVEN** a caller session has created one or more trays
- **WHEN** the caller process dies and the transport disconnects
- **THEN** the broker closes the caller session
- **AND** removes the trays, extension state, and native event routes for that session
- **AND** no visible tray remains waiting for a handler that no longer exists.

#### Scenario: Idle host has no app effects

- **GIVEN** the host remains alive after caller disconnect
- **WHEN** the operator inspects the desktop tray or native routes
- **THEN** there is no visible tray state owned by the disconnected caller
- **AND** the host is only waiting for idle shutdown or a new explicitly authorized session.

### Requirement: Runtime host SHALL not deliver events without a live owning session

Native backend events SHALL be delivered only to a live session that owns the matching tray identity. If the owning session has disconnected, the runtime host SHALL drop the event or emit a structured diagnostic. It SHALL NOT queue the event for a future process, broadcast it to another connection, or execute callback behavior without a live caller session.

#### Scenario: Event after disconnect is dropped

- **GIVEN** a native backend emits a tray event after the owning caller session disconnected
- **WHEN** the runtime host routes the event
- **THEN** no client receives the event
- **AND** the host does not queue it for a future caller.

#### Scenario: Event is delivered only to live owner

- **GIVEN** a caller session owns a tray
- **AND** that session is still connected
- **WHEN** the native backend emits a matching tray event
- **THEN** the runtime host sends the event only to that live session.

### Requirement: Runtime host SHALL present a caller-derived process name from app name

The runtime host SHALL present an operating-system-visible name derived from `app.name`, so that task managers and process listings identify the owning application rather than a generic `opentray` name. The process title MAY be normalized from `app.name` into a sanitized caller label for platform safety. When no usable app name is available, the process name SHALL fall back to the neutral host name rather than impersonating an unrelated application.

#### Scenario: Task manager shows caller-derived name

- **GIVEN** a host application starts an OpenTray runtime host with app name `myapp`
- **WHEN** the operator inspects the system process list
- **THEN** the runtime host process name reflects `myapp`
- **AND** it is distinguishable from a generic `opentray` process.

#### Scenario: Unsafe or empty name falls back neutrally

- **GIVEN** a caller provides an empty or unsafe app name
- **WHEN** the host is spawned
- **THEN** the process name falls back to a neutral host name
- **AND** it does not impersonate another application.

### Requirement: Runtime host health SHALL report app identity and caller label

The runtime host's `runtime-host-health` response SHALL include the stable `app.id`, the human-readable `app.name`, and the sanitized `callerLabel` of the session it is pinned to, so operators and tooling can confirm which application a given host serves. `sessionCount` SHALL remain at most 1.

#### Scenario: Health output includes app identity

- **GIVEN** a runtime host is serving a caller with app identity `com.example.build`
- **WHEN** a health request is sent over the local protocol
- **THEN** the `runtime-host-health` response includes `appId` and `appName`
- **AND** `sessionCount` is at most 1.
