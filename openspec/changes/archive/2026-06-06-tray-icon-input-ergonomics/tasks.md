## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` matches the current repo truth for `packages/spec`, `packages/cli`, backend tray icon support, and the duplicated visible-icon smoke paths.
- [x] 1.2 Confirm no destructive migration, cleanup, or state reset is required for the tray icon ergonomics change; keep the boundary additive.
- [x] 1.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a developer calls public `createTray` with a supported file-backed tray icon source When the SDK sends the broker request and the tray backend compiles the projection Then the SDK forwards the icon source unchanged and the backend normalizes it into a native-safe `rgba` asset.
- [x] 2.2 Scenario: Given a tray icon source cannot be opened or decoded When the backend attempts projection normalization Then the tray creation path rejects with a typed actionable error that identifies the icon source failure.
- [x] 2.3 Scenario: Given a developer reads the public tray creation docs When they look for the ordinary icon recipe Then the docs show the normalized icon source path first and do not teach raw RGBA construction as the default consumer path.
- [x] 2.4 Scenario: Given the human-visible tray smoke path runs When it creates a tray Then the tray icon is visibly nonblank and the public tray icon input contract is exercised without requiring a separate helper package.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check tray-icon-input-ergonomics --phase apply` before product-code work starts and commit the ready OpenSpec artifacts.
- [x] 3.2 Remove JS-side PNG/icon normalization from `packages/cli` so the SDK remains a thin typed transport facade.
- [x] 3.3 Update the public tray creation docs and tests so ergonomic icon sources are accepted without requiring a separate helper package.
- [x] 3.4 Keep the backend/native path honest: only normalized RGBA assets should reach native tray materialization, and unsupported or undecodable sources should return typed actionable errors.
- [x] 3.5 Consolidate the visible icon generation used by smoke/example paths into one shared workspace-local utility or equivalent internal path so the icon recipe is not duplicated across smoke files.
- [x] 3.6 Update the README and tray example walkthroughs so the normalized icon path is the ordinary recipe and raw RGBA is no longer taught as the primary path.
- [x] 3.7 Add concise intent comments at the normalization boundary and error path.
- [ ] 3.8 Update only current-context completed task checkboxes and commit them with the matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Add or update TypeScript tests that prove a file-backed tray icon is forwarded to transport without local normalization.
- [x] 4.2 Add or update Rust tests that prove supported PNG sources normalize to RGBA and missing or undecodable icon sources fail with typed actionable errors.
- [x] 4.3 Add or update smoke or example verification proving the tray remains visibly nonblank and the docs use the normalized path.
- [x] 4.4 Run `bun run openspec:vision -- validate tray-icon-input-ergonomics` for this change.
- [x] 4.5 Run `bun run openspec:vision -- commit-check tray-icon-input-ergonomics --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state tray-icon-input-ergonomics` to persist iteration and recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff tray-icon-input-ergonomics` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive tray-icon-input-ergonomics` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check tray-icon-input-ergonomics` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
