## ADDED Requirements

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

## MODIFIED Requirements

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
