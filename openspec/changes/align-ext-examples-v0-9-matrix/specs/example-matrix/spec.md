# example-matrix Specification Delta

## ADDED Requirements

### Requirement: OpenTray SHALL provide a finite package-level example matrix

The `opentray` package SHALL provide a finite example matrix command that can be run from a source checkout to exercise the package examples without relying on an unexpanded shell wildcard. The matrix command SHALL be owned by `packages/cli` and SHALL run the examples as package scripts or documented commands with deterministic smoke options. It SHALL NOT require the operator to manually stage generated runtime artifacts before the matrix starts.

The matrix SHALL report each row with a stable id, the command it ran, and a result of passed, failed, or skipped. Skips SHALL include an explicit reason such as unsupported platform or missing CI-only artifact. A row that is skipped for a real platform limitation SHALL NOT be reported as passed.

#### Scenario: Matrix command avoids shell wildcard failure

- **GIVEN** an operator wants to exercise the `opentray` examples
- **WHEN** they run the package-level matrix command
- **THEN** the shell does not need to expand `example:*`
- **AND** the command enumerates the intended example rows itself.

#### Scenario: Matrix prepares generated runtime artifacts

- **GIVEN** the visible binding example requires `runtime/opentray_runtime.node`
- **WHEN** the matrix reaches that row on a supported host platform
- **THEN** it builds and stages the generated runtime binding artifact before running the example
- **AND** the generated artifact remains uncommitted source-tree output.

#### Scenario: Matrix reports unsupported rows honestly

- **GIVEN** an example row cannot run on the current platform
- **WHEN** the matrix evaluates that row
- **THEN** it reports the row as skipped with the reason
- **AND** it does not claim native coverage that did not run.

### Requirement: Example matrix SHALL prove v0.9 extension/kernel adaptation boundaries

The matrix SHALL include rows that prove official extension examples still mount through the v0.9 tray/app/session extension host boundary. Extension rows MAY use the contributor debug local broker while native extension loading remains implemented there, but the row label and documentation SHALL identify that transport as debug-runtime extension coverage rather than default app runtime coverage.

The matrix SHALL NOT introduce extension-specific parsing, branching, or runtime ownership into `opentray-core` or the public SDK. WebView, badge, and Lynx semantics SHALL remain owned by their `packages/ext-*` facade packages and `crates/opentray-ext-*` native crates.

#### Scenario: WebView row stays tray-scoped

- **GIVEN** the matrix runs a WebView-backed example
- **WHEN** the example loads and commands `@opentray/ext-webview`
- **THEN** it does so through a tray handle and extension mount
- **AND** no public `Space`, public broker, or extension-specific core branch is required.

#### Scenario: Badge row stays capability-gated

- **GIVEN** the matrix runs the badge debug panel example
- **WHEN** the example commands `@opentray/ext-badge`
- **THEN** unsupported badge features remain explicit capability results or typed failures
- **AND** the WebView panel remains a projection over badge extension state, not badge ontology.

#### Scenario: Lynx row is not faked when carrier proof is unavailable

- **GIVEN** the local machine cannot rebuild or smoke the full Lynx runtime carrier
- **WHEN** the matrix evaluates Lynx coverage
- **THEN** it runs only the locally provable source-side row or skips the row with a clear reason
- **AND** it does not claim CI-only carrier acceptance as local proof.

### Requirement: Example documentation SHALL distinguish default runtime and debug extension runtime

The example documentation SHALL distinguish the default visible Node runtime binding from contributor debug-runtime extension smokes. The default runtime example SHALL prove app-owned host-main-loop tray creation. Extension examples that depend on dynamic native extension loading through the source-tree debug runtime SHALL be documented as extension/debug-runtime rows until the visible binding owns native extension loading.

#### Scenario: Documentation names the runtime owner

- **GIVEN** a developer reads the example documentation
- **WHEN** they choose between visible-binding and extension rows
- **THEN** they can tell which command proves the default app runtime
- **AND** which commands prove source-tree extension behavior through the debug runtime.
