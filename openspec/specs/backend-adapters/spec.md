# backend-adapters Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Backend adapters SHALL implement a shared SurfaceBackend contract

The system SHALL define a platform-agnostic `SurfaceBackend` contract for physical tray operations. The contract SHALL cover creation, icon updates, title/tooltip updates, menu projection updates, visibility, menu display where supported, backend-originated events, and tray placement retrieval where supported. Tray placement SHALL be keyed by the durable tray identity tuple `(spaceId, trayId)`, not by surface id alone.

Unsupported tray placement SHALL remain explicit as capability absence or an unavailable result path. The contract MUST NOT fabricate a tray rectangle for an unrelated tray contribution.

#### Scenario: Capability absence is visible

- **GIVEN** a backend cannot return a usable tray placement for a named tray
- **WHEN** the kernel or extension asks for that tray's placement
- **THEN** the backend reports that the capability is unavailable
- **AND** the broker projection preserves that absence through an unavailable tray result instead of fake certainty.

#### Scenario: Tray placement is resolved per tray identity

- **GIVEN** one space contains more than one tray contribution
- **WHEN** the backend is asked for placement of one named tray
- **THEN** it resolves placement for that `(spaceId, trayId)` pair
- **AND** it does not return an ambiguous surface-wide rect.

### Requirement: tray-icon SHALL be a macOS and Windows backend atom

The first-stage implementation SHALL use `tauri-apps/tray-icon` as the physical tray backend for macOS and Windows. The adapter SHALL translate OpenTray surface projections into `tray-icon` menus, icons, tooltips, titles, visibility, and tray/menu events. The adapter SHALL not expose `tray-icon` types through public OpenTray APIs.

#### Scenario: tray-icon event is translated into kernel event

- **GIVEN** `tray-icon` emits a click or menu event for a physical surface
- **WHEN** the adapter receives the event
- **THEN** it translates the event into an OpenTray backend event
- **AND** the kernel routes it to the owning lease using surface/tray/menu identifiers.

### Requirement: Linux SHALL use a ksni backend atom by default

The first-stage Linux backend SHALL use `ksni` instead of `tray-icon` by default. This preserves the zero-GTK, zero-libappindicator target from prior research and keeps Linux SNI/DbusMenu behavior behind the same `SurfaceBackend` contract.

#### Scenario: Linux build does not require tray-icon GTK dependencies

- **GIVEN** the Linux backend crate is built for the default OpenTray binary
- **WHEN** dependency metadata is inspected
- **THEN** it does not require `tray-icon` Linux GTK/libappindicator features
- **AND** it depends on the Linux backend atom rather than the macOS/Windows tray-icon adapter.

### Requirement: Backend selection SHALL be owned by the binary composition layer

Concrete backend selection SHALL live in `opentray-bin` or an equivalent composition layer. The kernel SHALL accept a backend factory or backend trait object and SHALL not compile conditional product behavior based on npm package names, extension names, or daemon command names. The broker composition layer SHALL also own any native event loop required by the selected backend.

#### Scenario: Kernel test can use fake backend

- **GIVEN** a kernel unit test constructs the broker with a fake backend
- **WHEN** surfaces and trays are created
- **THEN** the test can observe projected backend operations without loading `tray-icon`, `ksni`, or OS GUI event loops.

#### Scenario: Native event loop stays outside core

- **GIVEN** a platform backend requires a native event loop to create tray handles
- **WHEN** the daemon applies a projection
- **THEN** the event-loop ownership is handled by `opentray-bin` or an equivalent composition layer
- **AND** no native event-loop package is imported by `opentray-core`.

### Requirement: Binary broker composition SHALL apply daemon projections through the selected backend

The broker composition layer SHALL own backend selection and SHALL apply `SurfaceProjection` values emitted by the kernel to the selected backend. The daemon SHALL NOT expose concrete backend handles, `tray-icon` types, `ksni` types, or native event-loop types through public TypeScript APIs or `opentray-core`.

#### Scenario: Daemon tray creation reaches physical backend

- **GIVEN** the daemon is running with a selected backend
- **AND** an accepted client creates a tray
- **WHEN** the kernel syncs the surface projection
- **THEN** the selected backend receives the projection
- **AND** a supported desktop platform creates or updates the visible tray state.

#### Scenario: Core remains backend-neutral

- **GIVEN** daemon broker composition selects `tray-icon`, `ksni`, or a fake backend
- **WHEN** `opentray-core` is compiled and tested
- **THEN** `opentray-core` has no dependency on concrete backend crates
- **AND** kernel tests can still use `FakeBackend`.

### Requirement: Native tray-icon backend SHALL expose honest icon capability boundaries

The native `tray-icon` backend SHALL support `rgba` icon assets for visible tray items. Encoded and file icon asset shapes MAY remain in the shared protocol for future portability, but this backend SHALL return typed unsupported errors for those shapes until decoding and file policy are implemented. Human-visible examples SHALL use a deliberate nonblank RGBA icon rather than a transparent or one-pixel placeholder.

#### Scenario: RGBA icon creates visible tray item

- **GIVEN** a tray projection contains an `rgba` icon asset
- **WHEN** the native `tray-icon` backend applies the projection
- **THEN** it converts the RGBA bytes into the native tray icon type
- **AND** the example icon is visually nonblank.

#### Scenario: Encoded or file icon is not faked

- **GIVEN** a tray projection contains an `encoded` or `file` icon asset
- **WHEN** the native `tray-icon` backend applies the projection
- **THEN** it returns a typed unsupported backend error
- **AND** it does not silently substitute a blank icon.

### Requirement: tray-icon backend SHALL expose tray-scoped native bounds honestly

The `tray-icon` backend SHALL resolve tray geometry from the native tray handle that corresponds to the projected `(spaceId, trayId)` pair. On platforms where the native runtime offers a truthful tray-rect API, the backend SHALL return that rect as a truthful result. On platforms where the runtime does not offer a truthful tray-rect API, the backend SHALL preserve explicit capability absence instead of synthesizing a fake authoritative rect.

#### Scenario: macOS or Windows backend returns truthful tray bounds

- **GIVEN** the native tray backend has a live tray handle for `(spaceId, trayId)`
- **AND** the current platform exposes truthful tray bounds for that handle
- **WHEN** the backend resolves tray geometry
- **THEN** it returns a truthful rect for that tray contribution
- **AND** the rect is associated with the same tray identity used by menu and primary-event routing.

### Requirement: Tray-icon backend SHALL route primary activation to a menu item

The tray-icon backend SHALL compile `primaryEvent: true` plain menu items into a primary activation route. The route SHALL resolve to the same `(spaceId, trayId, itemId)` tuple as the corresponding native menu item id. If more than one enabled item is marked primary, the backend SHALL use the first enabled primary item in menu traversal order and keep the rest as normal menu items.

Disabled primary items SHALL NOT become direct activation targets. If no enabled primary item exists, tray icon click behavior SHALL remain the backend's normal menu behavior.

#### Scenario: Projection records primary route

- **GIVEN** a tray menu contains a primary item with id `8`
- **WHEN** the tray-icon backend compiles the surface projection
- **THEN** the backend route table can resolve native primary activation for that tray icon to `TrayEvent::MenuClick`
- **AND** the event carries item id `8`.

#### Scenario: Disabled primary item is ignored

- **GIVEN** a tray menu contains `{ type: "item", id: 8, enabled: false, primaryEvent: true }`
- **WHEN** the backend compiles primary activation routes
- **THEN** that item is not used as the direct primary target
- **AND** normal menu projection still includes it as a disabled menu item.

### Requirement: Tray-icon native runtime SHALL map platform primary gestures conservatively

On platforms where the native tray runtime exposes tray icon click events, the tray-icon runtime SHALL use the primary route only for platform gestures that are intended to be direct activation:

- On Windows, an enabled primary item MAY disable menu-on-left-click so left-click activates the primary route while right-click can still show the menu.
- On macOS, multi-item menus SHALL keep normal menu-on-left-click behavior. If the menu has exactly one click-capable item and it is an enabled primary item, macOS SHALL avoid attaching native menu chrome to the status item so clicking the status item directly activates the primary route instead of opening a menu.
- On Linux, missing or backend-specific tray icon click support SHALL keep normal menu behavior rather than faking primary activation.

#### Scenario: Windows primary click can bypass menu

- **GIVEN** a Windows tray menu has an enabled primary item
- **WHEN** the user left-clicks the tray icon
- **THEN** the backend may route that tray click to the primary item
- **AND** the normal menu remains available through the platform context-menu gesture.

#### Scenario: macOS multi-item menu stays menu-first

- **GIVEN** a macOS tray menu has multiple click-capable items and one is primary
- **WHEN** the user clicks the status item
- **THEN** the native menu opens normally
- **AND** choosing the primary menu item emits the normal `menuClick`.

#### Scenario: macOS single primary item direct-triggers

- **GIVEN** a macOS tray menu has exactly one click-capable item
- **AND** that item is enabled and marked `primaryEvent: true`
- **WHEN** the user clicks the status item
- **THEN** the backend routes the click to that primary item without showing the menu
- **AND** the native runtime does not attach an `NSMenu` to that direct-primary status item.
