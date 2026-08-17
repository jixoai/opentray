## 1. Alignment / Investigation

- [x] 1.1 Re-read `interview_plan.md`, `add-create-opentray-wizard`, current generated-project templates, registry paths, icon pipeline, and Windows process/link helpers before implementation.
- [x] 1.2 Confirm this Change declares `schema: vision2`, has no `plans/` or review-loop artifacts, and remains the prerequisite for `add-create-opentray-cli` and `redesign-create-opentray-webui`.
- [x] 1.3 Confirm implementation modifies only the create-opentray product family and does not add create-product policy to platform-neutral `opentray-core`.
- [x] 1.4 Record the approved breaking boundary in release notes before apply: no legacy `opentray.app.json` discovery or migration.

## 2. BDD Contract

- [x] 2.1 Scenario: Given semantically identical CLI and WebUI input When each requests a plan Then Core returns equivalent normalized v1 state and ordered effects (spec: create-lifecycle-kernel / deterministic Plan and Apply).
- [x] 2.2 Scenario: Given drifted generated files When Apply runs Then `create-opentray.json` wins and generated files converge without reading a second editable authority (spec: create-project-config / sole authority).
- [x] 2.3 Scenario: Given an unknown non-empty directory When force is requested Then no file is removed and a typed ownership error is returned (spec: create-lifecycle-kernel / verified ownership).
- [x] 2.4 Scenario: Given an external `app/` link When uninstall runs without purge Then only registration/link resources are removed and output says the target was retained (spec: create-lifecycle-kernel / uninstall).
- [x] 2.5 Scenario: Given a reused PID or mismatched runtime token When stop-running is requested Then Core refuses to kill the process (spec: create-lifecycle-kernel / process ownership).
- [x] 2.6 Scenario: Given a foreign listener and an owned HTTP listener When discovery runs Then only the owned verified service is emitted on POSIX and Windows fixtures (spec: create-process-observation / port discovery).
- [x] 2.7 Scenario: Given an unchanged HTTP icon source whose remote bytes drift When an unrelated edit reapplies Then the committed snapshot remains unchanged (spec: create-registration-layout / stable resources).
- [x] 2.8 Scenario: Given a pixel icon with smoothing disabled When app/tray outputs are generated Then both preserve hard pixels and use a distinct cache identity (spec: create-resource-export / sampling intent).
- [x] 2.9 Scenario: Given any non-empty env overlay When export is planned Then acknowledgement is required without keyword classification or value logging (spec: create-resource-export / environment risk).
- [x] 2.10 Scenario: Given an old directory containing only `opentray.app.json` When v1 list runs Then it is neither listed nor mutated (spec: create-registration-layout / breaking boundary).
- [x] 2.11 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision2 -- commit-check unify-create-opentray-core --phase apply` and commit ready OpenSpec artifacts before product-code work.
- [x] 3.2 Add the nested private workspace topology under `packages/create/packages/*`, with one Core package that has no React, yargs, or browser runtime dependency.
- [x] 3.3 Implement one strict v1 parser/normalizer and typed errors/results for config, resource, registry, plan, process, and destructive-action failures.
- [x] 3.4 Implement fixed-root registration scanning, physical registration envelopes, default physical `app/`, external POSIX directory symlinks, Windows directory links/junctions, and canonical containment checks.
- [x] 3.5 Implement source-resource import for file, HTTP URL, and Data URL inputs with byte-format validation, content hashes, relative committed paths, provenance, refresh, and stable-snapshot reuse.
- [x] 3.6 Refactor scaffold/materialize into deterministic plan/apply procedures that replace only verified managed payloads transactionally and leave registration source authority intact.
- [x] 3.7 Implement immutable app identity, typed list health, create/update/copy/uninstall/purge procedures, and exact result reporting for retained/deleted registration and payload paths.
- [x] 3.8 Add generated-runtime PID+token ownership records plus explicit stop/restart procedures that cannot kill unverifiable processes.
- [x] 3.9 Move preview execution, PTY/degraded transport, process-tree collection, listener ownership, HTTP verification, and optional metadata scraping behind Core capability interfaces.
- [x] 3.10 Implement exact argv command storage/execution and remove implicit shell-metacharacter inference from the authoritative path.
- [x] 3.11 Make `imageSmoothingEnabled` govern every app-foreground/tray resize and participate in cache identity; map `developerMode` only to WebView `devtools` admission.
- [x] 3.12 Implement normalized direct-command, POSIX shell, and PowerShell export plans, including embedded uploaded resources, force-copy metadata, shell-safe quoting, and env-risk metadata without value logging.
- [x] 3.13 Delete/supersede legacy config and marker authority in the new path without adding compatibility readers or migrations.
- [ ] 3.14 When a new problem surfaces, create a typed issue with `bun run openspec:vision2 -- issues unify-create-opentray-core --new <bug|task|decision|risk|question> --title "<title>"` instead of silently expanding this plan.
- [x] 3.15 Update only current-context task checkboxes and commit them with matching BDD/implementation evidence; do not add legacy plan backups or self-review loops.

## 4. Verification

- [x] 4.1 Run focused Core unit tests for v1 parsing, normalization, immutable identity, path containment, resource validation/hash behavior, plan equivalence, argv execution, export quoting, and env-risk metadata.
- [x] 4.2 Run filesystem integration tests for physical payloads, POSIX symlinks, broken links, unknown-directory force rejection, transactional replacement, uninstall retention, explicit purge, and failure rollback.
- [x] 4.3 Run process integration tests for PID/token ownership, live/stale/reused PID handling, stop/restart, preview teardown, port attribution, HTTP verification, and foreign-listener exclusion.
- [ ] 4.4 Run Windows parser/process/link tests on the current host as preparatory evidence, then require a Windows agent to verify junction/symlink creation, process-tree stop, listener ownership, PowerShell export execution, and path/quoting behavior before release acceptance.
- [x] 4.5 Run focused icon tests proving smoothing on/off behavior for app and tray outputs and stable cache invalidation.
- [x] 4.6 Run `bun run openspec:vision2 -- validate unify-create-opentray-core`.
- [ ] 4.7 Run `bun run openspec:vision2 -- issues unify-create-opentray-core --validate` and inspect `--group-by group`.
- [x] 4.8 Run the relevant package build/typecheck/tests followed by `pnpm run verify` and `git diff --check`.
- [ ] 4.9 Run `bun run openspec:vision2 -- commit-check unify-create-opentray-core --phase close` before closing overview work.

## 5. Close

- [ ] 5.1 Keep `toc.md` aligned with every Core spec and dependency statement.
- [ ] 5.2 Close or resolve every active issue under `issues/*.md` with valid dependency references.
- [ ] 5.3 Run `bun run openspec:vision2 -- check unify-create-opentray-core`; iterate on structural or open-issue results rather than retrying blindly.
- [ ] 5.4 Archive only after Core implementation, cross-platform evidence, dependent contract compatibility, and normal close gates are complete; commit archive movement separately.

