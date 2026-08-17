## 1. Alignment / Investigation

- [ ] 1.1 Re-read this interview, `unify-create-opentray-core`, current bin/README/package staging, public `skills/opentray`, and Windows command helpers before implementation.
- [ ] 1.2 Confirm this Change declares `schema: vision2`, depends on the committed implementation-ready Core contract, and introduces no legacy plan/review artifacts.
- [ ] 1.3 Inventory every current root wizard flag and map it deliberately to `web`, shared apply controls, or removal; no flag may silently change meaning.
- [ ] 1.4 Confirm the two provided logo assets are copied into stable README/package-owned locations rather than referenced from `.agents/images`.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given no subcommand or explicit `web` When invoked with equivalent options Then both dispatch the same WebUI adapter (spec: create-cli-command-tree / stable Web).
- [ ] 2.2 Scenario: Given explicit app identity, icon URLs, and argv When `create` runs Then it completes without browser, prompts, name sniffing, or icon sniffing (spec: create-cli-command-tree / non-interactive create).
- [ ] 2.3 Scenario: Given config plus one explicit override When planned Then only that field changes (spec: create-cli-command-tree / precedence).
- [ ] 2.4 Scenario: Given a broken-link v1 app When `app list --json` runs Then stable status and both paths are emitted without mutation (spec: create-cli-app-management / registry procedures).
- [ ] 2.5 Scenario: Given a live app When edit/uninstall runs without stop authorization Then `app_running` is returned and no mutation occurs (spec: create-cli-app-management / edit).
- [ ] 2.6 Scenario: Given a linked target When uninstall runs without purge Then output explicitly says target retained and OS pins remain manual (spec: create-cli-app-management / uninstall).
- [ ] 2.7 Scenario: Given env entries When export lacks acknowledgement Then no complete command/script or env value is emitted (spec: create-cli-app-management / export).
- [ ] 2.8 Scenario: Given `skill`, `skill list`, and `skill read SKILL.md` When run from a packed install Then English AI Skill content and stable relative paths are returned (spec: create-cli-skill).
- [ ] 2.9 Scenario: Given traversal or a Windows separator escape When skill read runs Then access is denied outside the packaged root (spec: create-cli-skill / contained access).
- [ ] 2.10 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision2 -- commit-check add-create-opentray-cli --phase apply` after the Core prerequisite is ready and commit these artifacts before product-code work.
- [ ] 3.2 Create the private nested CLI adapter under `packages/create/packages/*` and make the published create-opentray bin dispatch it.
- [ ] 3.3 Replace the manual parser with yargs commands for root/WebUI compatibility, `web`, `create`, `app`, and `skill`; enable strict command/option validation and generated help.
- [ ] 3.4 Implement explicit flag/config compilation into Core v1 desired state, exact argv delimiter handling, deterministic precedence, dry-run, text output, JSON output, and stable exit categories.
- [ ] 3.5 Implement `app list/edit/copy/export/uninstall` solely through Core procedures, including stop/restart/purge controls and exact retained/deleted path reporting.
- [ ] 3.6 Implement file/HTTP/Data icon options without invoking metadata enrichment and cover separate app/tray sources plus smoothing/developer/window options.
- [ ] 3.7 Require explicit env-risk acknowledgement for complete CLI export, prevent env values from ordinary logs, and write exact values only to the acknowledged destination.
- [ ] 3.8 Author the English public `skills/create-opentray` AI Skill and package it with stable `skill`, `skill list`, and `skill read` contained access.
- [ ] 3.9 Update root and create-opentray READMEs for the new command surface, breaking v1 layout, destructive semantics, Windows limitations, and supplied logo ownership.
- [ ] 3.10 Add Windows-safe path/file-URL/PowerShell handling without `/bin/sh` assumptions or POSIX separator leakage.
- [ ] 3.11 When a new problem surfaces, create a typed issue with `bun run openspec:vision2 -- issues add-create-opentray-cli --new <bug|task|decision|risk|question> --title "<title>"`.
- [ ] 3.12 Update only current-context task checkboxes with matching evidence; do not add plan backups or self-review loops.

## 4. Verification

- [ ] 4.1 Run parser/help snapshot tests covering every command, strict unknown handling, required options, conflicts, config precedence, argv delimiter, and legacy root compatibility.
- [ ] 4.2 Run packed-install integration tests for non-interactive create, URL/Data/file icons, app list/edit/copy/export/uninstall, JSON output purity, env acknowledgement, and no-browser behavior.
- [ ] 4.3 Validate the packaged English Skill with the repository Skill validator and test list/read default, traversal, link escape, Unicode, and Windows separator behavior against the packed artifact.
- [ ] 4.4 Execute generated POSIX shell scripts on POSIX and PowerShell scripts on a Windows agent; verify spaces, quotes, metacharacters, Unicode, drive/UNC paths, embedded resources, and exact env round-trip.
- [ ] 4.5 Run a Windows agent acceptance for create/list/edit/stop/restart/uninstall against a real v1 registration and report it separately from non-Windows fixture evidence.
- [ ] 4.6 Inspect the root repository README and packed create-opentray README to confirm both supplied logos render from stable owned paths.
- [ ] 4.7 Run `bun run openspec:vision2 -- validate add-create-opentray-cli`.
- [ ] 4.8 Run `bun run openspec:vision2 -- issues add-create-opentray-cli --validate` and inspect `--group-by group`.
- [ ] 4.9 Run relevant package build/typecheck/tests, packed consumer verification, `pnpm run verify`, and `git diff --check`.
- [ ] 4.10 Run `bun run openspec:vision2 -- commit-check add-create-opentray-cli --phase close` before closing overview work.

## 5. Close

- [ ] 5.1 Keep `toc.md` aligned with every CLI spec and the Core dependency.
- [ ] 5.2 Close or resolve every active issue with valid dependency references.
- [ ] 5.3 Run `bun run openspec:vision2 -- check add-create-opentray-cli` and resolve structural/open-issue results.
- [ ] 5.4 Archive only after Core compatibility, packed-package evidence, POSIX and Windows acceptance, and normal close gates complete; commit archive movement separately.

