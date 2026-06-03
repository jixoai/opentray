## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects current Lynx upstream layering, current `ext-lynx` runtime law, and the accepted decision to replace borrowed `LynxExplorer.app` with an OpenTray-owned host app.
- [x] 1.2 Confirm the chosen source root for the new host app and runtime build path do not conflict with existing crate/package laws.

## 2. BDD Contract

- [x] 2.1 Scenario: Given maintainers inspect the repository When they trace the macOS Lynx host app source of truth Then it is OpenTray-owned repo code rather than only patch files against upstream Explorer sources.
- [x] 2.2 Scenario: Given the darwin release workflow builds Lynx artifacts When it stages runtime outputs Then it stages an OpenTray-owned runtime host app zip instead of `LynxExplorer.app.zip`.
- [ ] 2.3 Scenario: Given a user runs `opentray smoke daemon-lynx` When the carrier migration is complete Then the visible window-controller and fit-content behaviors accepted in phase two still work.
- [x] 2.4 Scenario: Given the runtime carrier is missing When `ext-lynx` handles `show` Then it fails explicitly instead of pretending launch success.
- [x] 2.5 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check replace-lynx-explorer-with-opentray-runtime-host --phase apply` before product-code work starts and commit the ready OpenSpec artifacts.
- [x] 3.2 Establish the repo-owned macOS Lynx host app source root and move the current host bridge logic there as source of truth.
- [x] 3.3 Refactor `scripts/release/build-lynx-runtime.sh` so it builds the OpenTray-owned host app carrier instead of patching upstream Explorer as the mainline product path.
- [x] 3.4 Update `crates/opentray-ext-lynx` runtime staging and artifact naming to consume the new host app zip without regressing tray-scoped lifecycle.
- [ ] 3.5 Preserve the accepted `navigator.window` / fit-content / frameless behavior while the host carrier changes.
- [x] 3.6 Update release workflow logic, artifact staging helpers, and platform-package expectations for the new runtime zip identity.
- [x] 3.7 Update README and skills so future Lynx runtime work follows the “OpenTray-owned host app” law instead of the borrowed Explorer shell.
- [x] 3.8 Add concise intent comments only at the critical ownership boundaries where maintainers might otherwise mistake upstream Lynx runtime reuse for upstream app-shell ownership.
- [x] 3.9 Update only current-context completed task checkboxes and commit them with matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted Rust, TypeScript, and packaging verification for the renamed/repointed runtime carrier path.
- [ ] 4.2 Run GitHub Actions or workflow-equivalent verification for darwin runtime-host artifact staging because local Xcode is not the release authority.
- [x] 4.3 Run `bun run openspec:vision -- validate replace-lynx-explorer-with-opentray-runtime-host` for this change.
- [ ] 4.4 Run `bun run openspec:vision -- commit-check replace-lynx-explorer-with-opentray-runtime-host --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [ ] 5.2 Generate separate `review/self-review.html` as the screenshot, interaction, and structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state replace-lynx-explorer-with-opentray-runtime-host` to persist iteration and recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff replace-lynx-explorer-with-opentray-runtime-host` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive replace-lynx-explorer-with-opentray-runtime-host` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check replace-lynx-explorer-with-opentray-runtime-host` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
