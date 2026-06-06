## ADDED Requirements

### Requirement: Public tray icon inputs SHALL remain transparent in the SDK boundary

The public `opentray` TypeScript SDK SHALL treat `TrayOptions.icon` as a consumer-facing input contract on the tray creation path and SHALL keep tray icon conversion out of the TypeScript facade. The tray icon field SHALL remain required so tray visibility stays explicit. Ordinary consumers SHALL be able to supply a file-backed or prebuilt tray icon source on the public `createTray` path without manually constructing raw RGBA buffers or importing a separate `ext-icon-helper` package. The SDK SHALL forward supported tray icon sources unchanged to the broker request. The backend and native tray runtime SHALL continue to receive only normalized assets after backend-side projection. Missing, unreadable, or undecodable icon sources SHALL fail with typed actionable errors rather than silently substituting a blank icon or pretending success.

#### Scenario: File-backed tray icon is normalized before broker submission

- **GIVEN** a developer calls public `createTray` with a supported file-backed tray icon source
- **WHEN** the SDK prepares the tray creation request
- **THEN** the icon source is forwarded unchanged in the broker request
- **AND** the developer does not need to import a separate helper package to reach the ordinary path.

#### Scenario: Undecodable tray icon source fails honestly

- **GIVEN** the developer supplies a tray icon source that cannot be opened or decoded
- **WHEN** the backend later attempts normalization
- **THEN** the tray creation call rejects with a typed actionable error
- **AND** the error identifies the icon source failure rather than pretending the tray icon was handled.

### Requirement: Official tray docs and smoke examples SHALL teach the normalized icon path

The workspace README and tray smoke/example walkthroughs SHALL present the normalized tray icon path as the ordinary recipe. They SHALL use a visible, nonblank tray icon in human-verifiable examples, but they SHALL not teach raw pixel-buffer construction as the first-class consumer story. Any shared visible-icon generator used by smoke or example code SHALL stay inside the workspace boundary and SHALL not be presented as a separate public package.

#### Scenario: Public docs show the ergonomic tray icon path

- **GIVEN** a developer reads the public tray creation documentation
- **WHEN** they look for the ordinary tray icon example
- **THEN** the docs show the normalized icon source path first
- **AND** they do not teach raw RGBA construction as the default consumer recipe.

#### Scenario: Human-visible smoke remains nonblank

- **GIVEN** the human-visible tray smoke path runs
- **WHEN** it creates a tray
- **THEN** the tray icon is visibly nonblank
- **AND** the smoke path still exercises the accepted public tray icon input contract.
