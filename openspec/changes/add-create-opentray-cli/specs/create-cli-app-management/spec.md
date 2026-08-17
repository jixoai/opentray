## ADDED Requirements

### Requirement: App commands SHALL project Core registry procedures

The CLI SHALL expose `app list`, `app edit <app-id>`, `app copy <app-id> --app-id <new-id>`, `app export <app-id>`, and `app uninstall <app-id>`. Each handler SHALL call the corresponding Core load/plan/apply/list/export/uninstall procedure and SHALL NOT directly edit configuration, follow/delete links, kill processes, or generate application files.

#### Scenario: Broken registration is visible in list

- **GIVEN** a v1 registration with a broken `app/` link
- **WHEN** `app list` runs
- **THEN** text and JSON output SHALL include its `broken-link` status and registration/payload evidence

### Requirement: Edit SHALL preserve identity and remain non-interactive

`app edit` SHALL load existing v1 desired state and apply explicit config/flag patches without prompts. It SHALL reject an appId mutation and direct users to `app copy`. Payload replacement SHALL use the Core verified-ownership rule; stop-running and restart SHALL require explicit `--stop-running` and `--restart` controls.

#### Scenario: Running edit needs explicit stop

- **GIVEN** a verified running registration
- **WHEN** `app edit` changes desired state without `--stop-running`
- **THEN** the command SHALL return typed `app_running`
- **AND** it SHALL not alter config or payload

### Requirement: Uninstall output SHALL name every destructive effect

`app uninstall` SHALL show or return the resolved registration path, payload/link path, external target when present, process action, and Dock/taskbar limitation before/after execution as appropriate. A linked external target SHALL be retained unless `--purge-target` is explicit. Purge SHALL require Core revalidation; stop-running SHALL remain independently explicit.

#### Scenario: Default linked uninstall states retention

- **GIVEN** a linked external payload
- **WHEN** `app uninstall` succeeds without purge-target
- **THEN** output SHALL explicitly say the link/registration were removed and the external target was retained
- **AND** it SHALL state that OS pin removal remains manual

### Requirement: Export SHALL require explicit environment acknowledgement

`app export` SHALL emit a complete direct command, POSIX shell script, or PowerShell script from the Core export plan. If the configuration contains any environment entry, complete export SHALL fail until the caller supplies a dedicated acknowledgement option. The CLI SHALL not classify env values and SHALL not print them except into the explicitly selected export artifact or direct output after acknowledgement.

#### Scenario: Env-bearing export is blocked by default

- **GIVEN** an application with one or more environment entries
- **WHEN** `app export` is requested without acknowledgement
- **THEN** the command SHALL refuse to emit complete values
- **AND** it SHALL explain the explicit acknowledgement option without echoing those values

### Requirement: Windows management SHALL preserve native path and process semantics

CLI management SHALL accept and report Windows drive, UNC, and directory-junction paths without POSIX reinterpretation. It SHALL use the Core Windows process/link capability and PowerShell export model, never shell through `/bin/sh`, never round-trip file URLs through `.pathname`, and never claim native acceptance from fixture-only tests.

#### Scenario: Windows external target round-trips

- **GIVEN** a Windows registration whose `app/` junction resolves to a path containing spaces
- **WHEN** list, edit plan, export, or uninstall runs
- **THEN** the same canonical Windows target SHALL be reported and passed to Core
- **AND** no duplicated drive prefix or slash-normalization corruption SHALL occur

