## MODIFIED Requirements

### Requirement: Wizard projects SHALL expose an edit-ready config projection

A wizard project's frozen `opentray.app.json` SHALL project into the same config shape the workbench edit flow consumes: command executable/args/cwd/env when the project has a command source, the `url` when it is a URL project, window size, developer mode, and a package manager inferred from the project's lockfile. The projection SHALL be read-only and SHALL NOT mutate the project. A project with no command object SHALL project as a URL application without synthesizing command defaults. Environment values SHALL never be echoed by list/detail/export surfaces; only key names or presence may be shown.

#### Scenario: Edit jump prefills from a wizard project

- **GIVEN** a wizard project listed in the workbench
- **WHEN** the user opens its edit view
- **THEN** the form SHALL be prefilled from the wizard config projection
- **AND** environment entries SHALL surface only their keys

#### Scenario: URL project projects without command defaults

- **GIVEN** a wizard project whose `opentray.app.json` carries `url` and no `command`
- **WHEN** its config projection is read
- **THEN** the projection SHALL expose the url and no executable/args/cwd values
- **AND** the project SHALL list as healthy, not invalid
