# packaging-plugin Specification

## Purpose
TBD - created by archiving change opentray-v0-9. Update Purpose after archive.
## Requirements
### Requirement: OpenTray SHALL define a bundler packaging contract for app-owned runtime bindings

The system SHALL define a shared packaging contract that bundler adapters use to stage the OpenTray runtime binding, native sidecars, and companion assets into an app's distributable output. The packaging contract SHALL be bundler-neutral. Vite SHALL be the first supported adapter, but the contract SHALL remain reusable by `tsdown`, `esbuild`, `webpack`, and `turbopack` adapters without changing the manifest schema.

The packaging contract SHALL treat `app.id` as the primary artifact address key and `app.name` as the human label. The contract SHALL derive output directories and executable basenames from `app.id` through a deterministic sanitizer. It SHALL NOT use `opentray` as a generic output name for packaged applications.

The packaging contract SHALL keep runtime artifacts isolated per app identity. Two different app identities SHALL never resolve to the same runtime artifact directory. A build that cannot prove collision-free naming SHALL fail.

#### Scenario: Plugin stages runtime artifacts by app identity

- **GIVEN** a packaging adapter is configured with `app.id = "com.example.build"`
- **WHEN** the adapter prepares distributable output
- **THEN** it writes runtime artifacts into an app-specific output location derived from that id
- **AND** it does not reuse a shared `opentray` artifact path for unrelated apps.

#### Scenario: Missing stable app identity fails packaging

- **GIVEN** a production packaging build cannot resolve a stable `app.id`
- **WHEN** the adapter validates build configuration
- **THEN** it fails with a typed packaging error
- **AND** it does not invent a generic fallback identity for the release artifact.

### Requirement: Packaging adapters SHALL emit an app manifest for runtime binding discovery

The packaging contract SHALL emit a machine-readable app manifest next to the distributable output. The manifest SHALL include the stable `app.id`, the human-readable `app.name`, the chosen runtime binding artifact name or path, the entry module or bundle identity, and the staged native artifact paths needed by the runtime host.

The manifest SHALL be the source of truth for runtime artifact discovery. Runtime code MAY derive filenames from `app.id`, but it SHALL read the manifest for the final staged locations rather than guessing them from the workspace layout.
The manifest SHALL also record the packaging adapter name and build mode so runtime diagnostics can report how the host was assembled.

#### Scenario: Runtime host resolves staged artifacts from the manifest

- **GIVEN** a packaged app contains an emitted OpenTray manifest
- **WHEN** the runtime host starts
- **THEN** it reads the manifest to locate its staged runtime binding and sidecar artifacts
- **AND** it does not depend on a hard-coded `opentray` filename.

#### Scenario: app.id and app.name remain separate

- **GIVEN** a packaged app declares both `app.id` and `app.name`
- **WHEN** the adapter emits the manifest and staged filenames
- **THEN** `app.id` drives addressing and collision-safe naming
- **AND** `app.name` remains the human-facing label in the manifest and UI-facing metadata.

### Requirement: Vite SHALL be the first supported packaging adapter

The first shipped packaging adapter SHALL target Vite. It SHALL use the shared packaging contract, stage the runtime host and native artifacts into the Vite output, and expose a minimal configuration surface that accepts the shared app identity metadata.

The Vite adapter SHALL NOT invent its own identity model. It SHALL consume the shared manifest fields and SHALL keep the same staged artifact naming law that future adapters must follow.
The Vite adapter SHALL support only the minimum surface needed to prove the shared contract: app identity input, artifact staging, manifest emission, and deterministic naming.

#### Scenario: Vite adapter stages the same manifest shape as future adapters

- **GIVEN** a project uses the Vite packaging adapter
- **WHEN** it builds a distributable app
- **THEN** the adapter emits the shared OpenTray manifest shape
- **AND** the staged runtime host naming follows the same `app.id`-derived rule future adapters must use.

#### Scenario: Vite adapter fails without the shared metadata

- **GIVEN** a project enables the Vite adapter but omits required app identity metadata
- **WHEN** the adapter validates the build
- **THEN** it fails explicitly
- **AND** it does not silently fall back to a generic bundle name.

### Requirement: Packaging adapters SHALL remain separate from kernel and runtime law

The packaging plugin contract SHALL stay in the build layer. It SHALL stage artifacts, name outputs, and emit manifests, but it SHALL NOT own tray lifecycle, session policy, backend selection, or extension dispatch.

#### Scenario: Build adapter does not become a runtime host

- **GIVEN** the packaging adapter completes a build
- **WHEN** the app later starts
- **THEN** the runtime host owns tray lifecycle and event routing
- **AND** the packaging adapter does not remain active as a hidden runtime service.

