## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the current worktree code survey, existing OpenSpec survey, release workflow survey, and requirement-bearing user Q&A.
- [x] 1.2 Confirm the current unsupported matrix from the worktree runtime code instead of relying on prior discussion memory.
- [x] 1.3 Confirm that publishing to an npm alpha channel is part of the requested end state, not just a documentation option.
- [x] 1.4 Confirm the current release workflow has no alpha-channel path and therefore needs a deliberate law update rather than an ad hoc one-off command.

## 2. BDD Contract

- [x] 2.1 Scenario: Given WebView capability truth is documented When a developer reads the spec, README, or skills Then runtime absence, family mismatch, declarative gate, and context unavailability remain distinct.
- [x] 2.2 Scenario: Given an unsupported Windows/Linux runtime path When a caller uses `@opentray/ext-webview` Then the runtime fails explicitly instead of being described as stable cross-platform support.
- [x] 2.3 Scenario: Given the alpha release channel is used When a developer installs `opentray@alpha` Then the published docs and skills present the same maturity matrix and unsupported taxonomy as the packages.
- [x] 2.4 Scenario: Given an alpha publish is prepared When changesets versions packages Then the alpha path does not consume the later stable version numbers.
- [ ] 2.5 Scenario: Given release workflow and smoke proof are inspected When alpha and stable evidence are compared Then prerelease evidence is kept distinct from stable release evidence.
- [x] 2.6 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check plan-webview-cross-platform-runtime-and-capability-matrix --phase research-plan` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Update `packages/ext-webview/README.md`, `packages/cli/README.md`, and any published platform-package README surfaces so they explicitly mark current WebView capability maturity (`stable`, `alpha`, `unsupported by design`, `unavailable by context`).
- [x] 3.3 Update repo skills and WebView guidance references so AI-facing documentation teaches the same maturity matrix and unsupported taxonomy as the published package docs.
- [x] 3.4 Add concise intent comments at critical runtime effect points in `crates/opentray-ext-webview` where runtime absence, family mismatch, declarative gate, and context unavailability are intentionally distinguished.
- [x] 3.5 Update release automation to support an alpha publish path that uses changesets snapshot or prerelease semantics and publishes with npm dist-tag `alpha`.
- [x] 3.6 Add or update scripts and tests that verify the alpha release workflow does not consume stable version numbers and keeps alpha/stable evidence distinct.
- [x] 3.7 Add or update a fresh-install alpha smoke path and operator instructions that verify `npm i opentray@alpha` against the published docs and runtime truth.
- [x] 3.8 Add or update the required changeset entries so package-facing doc/release-surface changes are captured in the published package notes.
- [ ] 3.9 Perform the npm alpha publish using the approved release path if local credentials or trusted-publish state permit it; otherwise stop only after proving the exact external-state blocker with command evidence.
- [ ] 3.10 Update only current-context completed task checkboxes with matching implementation and verification evidence.

## 4. Verification

- [x] 4.1 Run targeted tests for release workflow helpers, npm bootstrap/publish helpers, and any updated package or runtime tests affected by the maturity/release changes.
- [x] 4.2 Run targeted docs/contract verification by checking the updated README and skills surfaces for the required maturity matrix and unsupported taxonomy.
- [x] 4.3 Run `bun run openspec:vision -- validate plan-webview-cross-platform-runtime-and-capability-matrix`.
- [x] 4.4 Run `git diff --check`.
- [ ] 4.5 Run the chosen alpha smoke command or fresh-install verification path and record whether it succeeded, failed with typed unsupported runtime truth, or is blocked by missing publish authority.
- [ ] 4.6 Run `bun run openspec:vision -- commit-check plan-webview-cross-platform-runtime-and-capability-matrix --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing implementation and publish evidence against `plans/plan.md`.
- [ ] 5.2 Generate `review/self-review.html` as the structured evidence presentation for docs, workflow, and publish results.
- [ ] 5.3 If review updates OpenSpec artifacts or task state, commit those artifact changes before the next apply loop.
- [ ] 5.4 If review enters a real recurrence loop, run `bun run openspec:vision -- review-state plan-webview-cross-platform-runtime-and-capability-matrix`.
- [ ] 5.5 If review cannot exit normally because npm publish authority or another external dependency is missing, run `bun run openspec:vision -- handoff plan-webview-cross-platform-runtime-and-capability-matrix` and commit the handoff evidence before returning to discussion.
- [ ] 5.6 If review exits normally, run `openspec archive plan-webview-cross-platform-runtime-and-capability-matrix` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check plan-webview-cross-platform-runtime-and-capability-matrix` and decide whether the goal is complete end to end.
