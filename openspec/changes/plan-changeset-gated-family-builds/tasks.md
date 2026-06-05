## 1. Alignment / Investigation

- [x] 1.1 Confirm the current preview-build pain is real by reading the current release workflow and locating where `darwin-*` WebView builds also compile Lynx and build the Lynx runtime sidecar.
- [x] 1.2 Confirm the repo already has artifact-family truth in `scripts/binaries/artifacts.ts` / `stage-local.ts`, even though workflows still execute by platform matrix.
- [x] 1.3 Confirm the user explicitly wants build triggering to depend on `.changeset/*.md` file updates, not on branch state.
- [x] 1.4 Confirm the first implementation priority is `ext-webview` preview isolation from Lynx, not a generalized release-pipeline redesign.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a non-changeset push When GitHub evaluates the preview workflow Then it does not auto-start.
- [x] 2.2 Scenario: Given a changed changeset without an OpenTray build marker When the planner runs Then it no-ops without starting heavy native jobs.
- [x] 2.3 Scenario: Given a changed WebView changeset with a build alias When the planner runs Then it infers `ext-webview-native` and uses the family default target set.
- [x] 2.4 Scenario: Given an `ext-webview-native` preview job When the workflow builds native artifacts Then it excludes `opentray-ext-lynx` and the Lynx runtime sidecar.
- [x] 2.5 Scenario: Given multiple changed changesets with enabled build markers in one push When the planner runs Then it fails explicitly instead of silently merging them.
- [x] 2.6 Scenario: Given manual workflow dispatch When overrides are provided Then the same planner law validates families and targets.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check plan-changeset-gated-family-builds --phase research-plan` before product-code work starts and commit the OpenSpec artifacts.
- [ ] 3.2 Introduce a durable artifact-family metadata module for branch preview builds, including default targets and the native artifact set for each supported family.
- [ ] 3.3 Introduce a planner that reads changed changeset files, parses the OpenTray build marker, infers or validates families, and emits a normalized job matrix.
- [ ] 3.4 Add a dedicated preview build workflow that auto-triggers only on `.changeset/*.md` updates and uses the planner output to drive jobs.
- [ ] 3.5 Ensure the `ext-webview-native` family compiles only the broker binary plus WebView native library closure, without Lynx dylib or Lynx runtime work.
- [ ] 3.6 Add manual `workflow_dispatch` overrides that still route through the same planner law.
- [ ] 3.7 Add or update a changeset example / documentation surface that teaches how to request a preview build by updating the changeset alias marker.
- [ ] 3.8 Add or update tests that prove planner parsing, family inference, workflow trigger law, and WebView/Lynx isolation.
- [ ] 3.9 Update only current-context task checkboxes with matching implementation and verification evidence.

## 4. Verification

- [ ] 4.1 Run targeted tests for the new planner / family metadata modules.
- [ ] 4.2 Run targeted workflow static tests proving the preview build workflow is changeset-triggered and that `ext-webview-native` jobs do not invoke Lynx build steps.
- [ ] 4.3 Run `bun run openspec:vision -- validate plan-changeset-gated-family-builds`.
- [ ] 4.4 Run `git diff --check`.
- [ ] 4.5 Run a local planner proof command for at least one changed WebView changeset and record the resulting matrix.
- [ ] 4.6 Run `bun run openspec:vision -- commit-check plan-changeset-gated-family-builds --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing planner law, workflow trigger law, and WebView/Lynx isolation against `plans/plan.md`.
- [ ] 5.2 Generate `review/self-review.html` as the structured evidence presentation for preview-build behavior.
- [ ] 5.3 If review updates OpenSpec artifacts or task state, commit those artifact changes before the next apply loop.
- [ ] 5.4 If review enters a real recurrence loop, run `bun run openspec:vision -- review-state plan-changeset-gated-family-builds`.
- [ ] 5.5 If review cannot exit normally because GitHub Actions or external branch permissions block proof, run `bun run openspec:vision -- handoff plan-changeset-gated-family-builds` and commit the handoff evidence before returning to discussion.
- [ ] 5.6 If review exits normally, run `openspec archive plan-changeset-gated-family-builds` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check plan-changeset-gated-family-builds` and decide whether the build-law objective is complete end to end.
