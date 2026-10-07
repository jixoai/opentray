## ADDED Requirements

### Requirement: Kernel upgrade SHALL be a core procedure over the project dependency graph

`@create-opentray/core` SHALL expose `upgradeAppKernel(projectDir, options)` that advances a generated project's kernel — exactly the `opentray` and `@opentray/ext-webview` entries in its `dependencies` — to a target spec (default `latest`) through the project's own package manager (lockfile-derived npm/pnpm/bun runner). The procedure SHALL stop any live entry instances first (argv-identity probe, bounded death wait — the same replace semantics as open) and SHALL NOT touch config, icons, payload files, or the registration envelope: an upgrade only advances the dependency graph and rewrites the project lockfile like a normal install.

The reported `from`/`to` versions SHALL be read from the actually installed `node_modules/<pkg>/package.json`, never from the lockfile or dependency range (a manifest describes the requested graph, not the installed one). An install failure SHALL report a bounded tail of the package manager's output as the exception surface. When `from == to` after the install, the result SHALL report `alreadyUpToDate` as a successful no-op. No broker cleanup SHALL be part of the upgrade: the runtime's artifact-identity check replaces a live old broker on the next start.

An optional restart SHALL reopen the app through the open path with the bounded first-start observation, so a post-upgrade startup failure surfaces with its `app.log` tail.

#### Scenario: Upgrade advances the installed kernel

- **GIVEN** a generated project whose installed `opentray` is older than the target
- **WHEN** `upgradeAppKernel` runs with the default target
- **THEN** live entry instances are stopped before the install runs
- **AND** the project's package manager installs both kernel packages at the target spec
- **AND** the result reports `from`/`to` versions read from `node_modules`.

#### Scenario: A failed install surfaces its output

- **GIVEN** an upgrade whose package-manager install exits non-zero
- **WHEN** the procedure reports
- **THEN** the failure carries a bounded tail of the install output
- **AND** no partial success is claimed.

### Requirement: Kernel upgrade SHALL be reachable from both the CLI and the webui

The CLI SHALL offer `app upgrade` accepting one or more app ids or `--all` (sequential fan-out over the registration list), a `--target` spec, `--restart`, and `--json`, printing one result block per project. The webui applications page SHALL offer per-row selection with select-all and a single upgrade action over the selection, invoking the per-app upgrade endpoint sequentially and rendering each project's outcome (upgraded to / already up to date / failed with detail) in its result surface. Both vectors SHALL delegate to the same core procedure; no upgrade logic lives in an adapter.

#### Scenario: CLI upgrades every registered app

- **GIVEN** multiple registered apps with outdated kernels
- **WHEN** `app upgrade --all --json` runs
- **THEN** each app is upgraded sequentially and one JSON result is printed per app.

#### Scenario: Webui upgrades a selection

- **GIVEN** the applications page with several apps listed
- **WHEN** the operator selects a subset (or all) and triggers the upgrade action
- **THEN** each selected app upgrades sequentially
- **AND** the page renders each app's per-project outcome, including failure details.
