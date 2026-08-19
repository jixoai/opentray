# create-workbench-form Specification

## Purpose
TBD - created by archiving change redesign-create-opentray-webui. Update Purpose after archive.
## Requirements
### Requirement: Add form SHALL edit complete Core desired state

The Add route SHALL represent every user-editable v1 desired-state field and SHALL submit normalized input to Core for validation/plan/apply. Browser-only preview, port discovery, app-name/icon suggestions, uploads, and terminal interaction MAY enrich the form but SHALL not become hidden creation requirements. Explicit user values SHALL win over suggestions, and confirmation SHALL freeze the exact normalized plan being applied.

#### Scenario: Create succeeds without preview

- **GIVEN** explicit required identity, command vector, and applicable options
- **WHEN** the user requests a plan without running preview
- **THEN** Core validation and Apply SHALL remain available
- **AND** no port, title, or favicon scrape SHALL be required

### Requirement: Icon controls SHALL expose source, composition, and sampling separately

Application and tray icon source controls SHALL remain independently selectable while tray may explicitly follow app source by default. The advanced icon surface SHALL use appropriate controls for background choice, numeric foreground scale, and `imageSmoothingEnabled`. Sampling SHALL be a labeled binary control whose disabled state explains pixel-art preservation and whose preview uses the same Core rendering recipe/cache identity as Apply.

#### Scenario: Sampling preview matches generated assets

- **GIVEN** an uploaded low-resolution icon and smoothing disabled
- **WHEN** preview and final app/tray assets are compared
- **THEN** both SHALL show equivalent nearest-neighbor edge behavior
- **AND** changing smoothing SHALL invalidate and refresh preview state without moving surrounding layout

### Requirement: Developer mode SHALL be an explicit default-off DevTools control

The form SHALL expose one default-off developer-mode binary control. Its localized label/description SHALL state that it allows WebView DevTools and does not enable terminal, remote debugging, extra logging, address bar, or other development services. Edit SHALL reflect the persisted value exactly.

#### Scenario: Enabling developer mode changes only DevTools admission

- **GIVEN** a plan with developer mode false and every other field fixed
- **WHEN** the user enables developer mode
- **THEN** plan comparison SHALL change only the `developerMode` desired-state field and derived per-window DevTools option

### Requirement: Async form actions SHALL lock and expose lifecycle

Run/interrupt, icon analyze/compose/upload, config load, plan, Apply, stop/restart, copy, and export actions SHALL expose pending/success/error states, prevent duplicate submissions, and preserve usable data on failure. Controls SHALL not resize when labels, loaders, or localized messages change. Stale async responses SHALL not overwrite a newer source, locale, route, or form selection.

#### Scenario: Stale icon response is ignored

- **GIVEN** icon A analysis is pending and the user selects icon B
- **WHEN** A completes after B
- **THEN** A SHALL not replace B's preview, settings, accessible description, or export source

### Requirement: Form structure SHALL use progressive disclosure without hiding consequences

High-frequency command, preview, identity, and primary creation actions SHALL remain directly visible. Lower-frequency command environment, icon composition/sampling, shell/window, package manager, and developer controls MAY live in clearly named progressive sections. Destructive edit force, env-export risk, external target, and process-stop consequences SHALL reappear in the final plan review even when their controls were collapsed.

#### Scenario: Collapsed advanced section cannot hide risk

- **GIVEN** advanced settings contain env values and a running-app stop choice
- **WHEN** the user collapses the section and opens final review
- **THEN** review SHALL still display both consequences and require their applicable acknowledgements

