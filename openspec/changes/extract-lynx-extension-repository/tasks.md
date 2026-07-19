# Tasks

## Independent repository

- [x] Move the Lynx facade, Darwin package shells, native crate, carrier sources, patches, build assets, tests, smoke bundle, and durable specification into `jixoai/opentray-ext-lynx`.
- [x] Normalize pnpm, Cargo, changesets, CI, preview, and OIDC release workflows without committing generated native artifacts; Darwin facade atoms use `workspace:*` locally and publish-time rewriting.
- [x] Record Trusted Publishing as configured for `jixoai/opentray-ext-lynx` / `release.yml` / `npm-release` without executing a publish.
- [x] Keep the pre-core-release dependency boundary honest: no fake 0.15 integrity is committed; CI/release bootstrap with `--no-frozen-lockfile` until core `0.15.x` is published.
- [x] Pin Rust `opentray-spec` to `29532da54b410756c449d8d2cf51a44c93ded4ff` and point public package metadata at the independent repository.
- [x] Preserve the current `0.11.1` package line and add the pending `0.12.0` changeset.

## Core repository

- [x] Remove Lynx packages, crate, carrier, patches, smoke assets, examples, workspace aliases, and build scripts.
- [x] Remove Lynx atoms from native planning, staging, package validation, preview, release, and native verification workflows.
- [x] Move durable Lynx behavior ownership to the independent repository and retain only the explicit external-repository pointer in current core documentation.
- [x] Update Cargo lock projections after removing the workspace atoms; the independent pnpm lock is intentionally deferred until the required core `0.15.x` package is published.

## Verification and handoff

- [x] Run independent facade build/typecheck/tests, Rust tests/release build, runtime packaging static tests, metadata validation, and npm pack dry-runs.
- [x] Run focused core native planner and workflow tests after removing Lynx atoms.
- [ ] Publish the core `0.15.x` OpenTray line, then run `pnpm install` in the independent repository and commit its real lockfile before the first Lynx publish; npm currently exposes only `0.14.4`.
- [x] Add the committed independent repository as a root git submodule and verify a fresh recursive checkout.
- [x] Run the full core build/verify/strict OpenSpec gates after the submodule gitlink is present.
- [ ] Smoke the full Darwin carrier produced by the independent CI workflow.

## Self-review evidence

- Independent repository generated outputs remain ignored: `dist`, `node_modules`, `target`, dylibs, runtime zips, and `research/lynx`.
- The independent repository intentionally has no pnpm lockfile until the public core `0.15.x` graph exists; its CI bootstrap uses `--no-frozen-lockfile` and documents this release-order gate.
- The release workflow materializes pending changesets before native builds, builds Darwin arm64/x64 closures separately, stages target-matched dylib/runtime artifacts, inspects packed tar contents, and publishes through configured OIDC provenance.
- The root gitlink and recursive checkout resolve to independent commit `52dc270`; the core migration and verification commit is `47d3afd`.
- Full carrier construction remains a CI/Xcode/network gate and was not executed during this migration.
- The independent facade build/typecheck/tests and Rust tests were verified against the local core `0.15.0` dist; a clean registry install remains blocked until npm publishes that core line, after which the generated pnpm lock must be committed before first Lynx publish.
