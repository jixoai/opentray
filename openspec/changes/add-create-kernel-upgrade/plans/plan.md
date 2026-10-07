# add-create-kernel-upgrade — Intent Document (SSOT)

## Why

Generated apps pin a kernel snapshot at creation time (`opentray` + `@opentray/ext-webview`
in their `dependencies`). When OpenTray ships a new release, every existing project must be
hand-upgraded (`npm i opentray@latest …` in each directory). The user asked for one-click
kernel upgrades in the create-opentray webui (single, multi-select, select-all) and the
same capability in the CLI, then a real local upgrade as acceptance.

## Decisions

- **D1 Kernel definition.** The upgrade surface is exactly the generated project's
  `dependencies`: `opentray` and `@opentray/ext-webview` (the two packages every generated
  `package.json` carries). Upgrade = install those at the target spec through the project's
  own package manager (lockfile-derived runner: npm / pnpm / bun), which rewrites the
  project lockfile as a normal install would.
- **D2 Stop before upgrade.** A running entry instance owns the broker endpoint; the
  upgrade reuses `stopLiveAppInstances` (argv-identity probe, bounded death wait) before
  touching node_modules. No manual broker cleanup is part of the upgrade: the runtime's
  existing artifact-identity check replaces a live old broker with the new one on the next
  start (bounded replacement law), so upgrades need no `OPENTRAY_*` surgery.
- **D3 Version truth from node_modules.** `from`/`to` versions are read from the actually
  installed `node_modules/<pkg>/package.json`, never from the lockfile or the dependency
  range: a manifest describes the requested graph, not the installed one (diagnosis law).
  `target` defaults to `latest` and registry resolution belongs to the package manager.
- **D4 One core procedure, two vectors.** `upgradeAppKernel(projectDir, options)` lives in
  `@create-opentray/core`; the CLI (`app upgrade [--all | <app-id>…] [--target <spec>]`
  `[--restart]`) and the webui (`POST /api/apps/:key/upgrade`, driven per-selection by the
  applications page) are thin adapters. Batch = sequential per-project calls with
  per-project results (no parallel installs: package-manager caches and the shared
  `~/.opentray` staging make parallelism a liability, not a win).
- **D5 Failure surfaces are bounded and real.** An install failure reports the package
  manager's output tail (bounded bytes) as the exception surface — same philosophy as the
  first-open observation. The optional `--restart` reopens through `openMaterializedApp`
  with the bounded first-start observation, so a post-upgrade startup failure arrives with
  its `app.log` tail instead of a silent no-window.
- **D6 Upgrade is not a reinstall.** The upgrade never touches config, icons, payload
  files, or the registration envelope; it only advances the dependency graph. `from == to`
  after install is reported as `alreadyUpToDate`, not as an error.

## Non-goals

- No webui wizard-form surface: the applications page owns the entry point.
- No major-version jumps, dist-tag pinning UI, or downgrade flows (a caller may pass an
  explicit `--target` spec; the package manager validates it).
- No scheduling/autoupdate.

## Acceptance

1. Core tests: stop-before-upgrade, version truth, already-up-to-date, install-failure
   surface, restart-with-observation (fake runner seams).
2. CLI test: command tree wiring + `--all` fan-out + JSON output shape.
3. Real-machine acceptance: upgrade the local `remote-ai-z-zcode` project from the
   published previous version to the newly published one via the CLI, verify
   `node_modules` versions advanced and the app reopens.
4. Vision walkthrough of the webui applications page (multi-select + upgrade result
   rendering).
