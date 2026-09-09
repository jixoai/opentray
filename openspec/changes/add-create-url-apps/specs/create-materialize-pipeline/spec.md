## ADDED Requirements

### Requirement: URL payloads SHALL omit command-hosting assets

A URL application payload SHALL be the same managed project shape as a command application (package.json, opentray.app.json, main.mjs, app-icon/, README, .gitignore) minus every command-hosting asset: its package.json SHALL NOT depend on `@lydell/node-pty`, and the payload SHALL NOT contain `app-shell-server.mjs` or `app-shell/`. The icon catalog, tray icon, dependency install, and transactional swap SHALL remain identical to command applications. Generation SHALL NOT fetch the URL or verify its reachability.

#### Scenario: URL payload drops PTY and shell assets only

- **GIVEN** otherwise identical desired states, one command-sourced and one URL-sourced
- **WHEN** both payloads are materialized
- **THEN** both SHALL contain `main.mjs`, `opentray.app.json`, and a generated icon catalog
- **AND** only the command payload SHALL contain `app-shell-server.mjs`, `app-shell/`, and the `@lydell/node-pty` dependency

#### Scenario: Generation works offline

- **GIVEN** a URL application desired state and no network access
- **WHEN** the payload is materialized
- **THEN** generation SHALL succeed without contacting the URL
