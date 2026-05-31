# backend-adapters Specification

## Purpose
TBD - created by archiving change implement-kernel-webview-foundation. Update Purpose after archive.
## Requirements
### Requirement: Backend adapters SHALL implement a shared SurfaceBackend contract

The system SHALL define a platform-agnostic `SurfaceBackend` contract for physical tray operations. The contract SHALL cover creation, icon updates, title/tooltip updates, menu projection updates, visibility, menu display where supported, physical rect retrieval where supported, and backend-originated events. Unsupported operations SHALL be expressed as capability absence or typed errors, not fake success.

#### Scenario: Capability absence is visible

- **GIVEN** a backend cannot return the physical tray rect
- **WHEN** the kernel or extension asks for rect capability
- **THEN** the backend reports that the capability is unavailable
- **AND** the caller can choose a documented fallback without assuming a fake rect.

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

Concrete backend selection SHALL live in `opentray-bin` or an equivalent composition layer. The kernel SHALL accept a backend factory and SHALL not compile conditional product behavior based on npm package names or extension names.

#### Scenario: Kernel test can use fake backend

- **GIVEN** a kernel unit test constructs the broker with a fake backend
- **WHEN** surfaces and trays are created
- **THEN** the test can observe projected backend operations without loading `tray-icon`, `ksni`, or OS GUI event loops.
