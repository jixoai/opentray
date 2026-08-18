## ADDED Requirements

### Requirement: Application discovery SHALL scan the create root for both layouts

The workbench application list SHALL scan every entry under `~/.opentray/create/`: directories carrying a v1 registration config (`create-opentray.json`) SHALL project through the existing registry reader; directories WITHOUT a registration config but WITH the wizard scaffold markers (`opentray.app.json` + `main.mjs`) SHALL project as wizard applications whose project directory is the directory itself. Entries matching neither shape SHALL be ignored. Discovery SHALL be read-only: no disk layout is created, moved, or adopted.

#### Scenario: Wizard app appears in the list

- **GIVEN** `~/.opentray/create/web-dsh-npx/` contains a wizard project (no registration config)
- **WHEN** the workbench lists applications
- **THEN** the entry SHALL appear with its appId/appName from `opentray.app.json` and its project directory
- **AND** registered applications SHALL keep appearing unchanged

#### Scenario: Foreign directories stay invisible

- **GIVEN** a directory under the create root with neither a registration config nor scaffold markers
- **WHEN** the workbench lists applications
- **THEN** the directory SHALL not appear

### Requirement: Wizard projects SHALL expose an edit-ready config projection

A wizard project's frozen `opentray.app.json` SHALL project into the same config shape the workbench edit flow consumes: command executable/args/cwd/env, window size, developer mode, and a package manager inferred from the project's lockfile. The projection SHALL be read-only and SHALL NOT mutate the project. Environment values SHALL never be echoed by list/detail/export surfaces; only key names or presence may be shown.

#### Scenario: Edit jump prefills from a wizard project

- **GIVEN** a wizard project listed in the workbench
- **WHEN** the user opens its edit view
- **THEN** the form SHALL be prefilled from the wizard config projection
- **AND** environment entries SHALL surface only their keys

### Requirement: Listed applications SHALL open through the shared launcher

Every listed application — wizard or registered — SHALL offer an open action that resolves the project directory and launches through the shared open-app contract: the platform launcher when a stable artifact exists, else a detached cold start of the generated entry. The action SHALL NOT require a registration envelope.

#### Scenario: Open a wizard project

- **GIVEN** a listed wizard application that has run at least once (stable bundle exists)
- **WHEN** the user triggers open
- **THEN** the platform launcher SHALL open the bundle

#### Scenario: Open before first run

- **GIVEN** a listed wizard application with no materialized bundle
- **WHEN** the user triggers open
- **THEN** the entry SHALL be spawned detached with the absolute Node runtime
