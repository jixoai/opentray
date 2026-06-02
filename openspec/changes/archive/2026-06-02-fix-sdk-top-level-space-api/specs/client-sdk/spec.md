## ADDED Requirements

### Requirement: Top-level SDK SHALL expose broker-backed convenience entrypoints

The public `opentray` package entrypoint SHALL export top-level convenience APIs for the mainline broker-backed path. A developer importing from `opentray` SHALL be able to call `createSpace` as the primary entrypoint without first constructing a transport or manually creating an `OpenTrayClient`.

The package MAY continue exporting lower-level atoms such as `createClient` and `createSpaceHandle`, but those SHALL NOT be the only documented entrypoints for ordinary SDK consumers.

#### Scenario: Top-level createSpace is importable from opentray

- **GIVEN** a developer installs `opentray` from npm
- **WHEN** they evaluate the public exports of `opentray`
- **THEN** `createSpace` is exported from the top-level package entrypoint
- **AND** calling it uses the same-version local broker connection law
- **AND** the returned handle is a `SpaceHandle`.

#### Scenario: Deprecated surface alias remains a wrapper only

- **GIVEN** alpha compatibility keeps `createSurface`
- **WHEN** a developer imports the alias from `opentray`
- **THEN** it delegates to the same implementation path as `createSpace`
- **AND** the package docs mark it as deprecated.

### Requirement: Top-level createTray SHALL resolve the default space through broker law

The public `opentray` package entrypoint SHALL expose a top-level `createTray` convenience API. When the caller does not provide an explicit target space, the API SHALL resolve the default space through the broker protocol rather than inventing a client-local fake default.

The package MAY also expose an explicit `resolveDefaultSpace` helper so the default-space law is observable and testable from the public SDK surface.

#### Scenario: Top-level createTray uses default space resolution

- **GIVEN** a same-version daemon is available
- **AND** the broker has a default space
- **WHEN** a developer calls top-level `createTray` without an explicit space
- **THEN** the SDK sends the broker request that resolves the default space
- **AND** it creates the tray under the resolved space
- **AND** it does not require the caller to manually create an `OpenTrayClient`.

#### Scenario: Explicit space bypasses default-space lookup

- **GIVEN** a developer already holds a `SpaceRef`
- **WHEN** they call top-level `createTray` with that explicit space
- **THEN** the SDK creates the tray under that space directly
- **AND** it does not send an unnecessary default-space resolution request.
