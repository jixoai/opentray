## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration / cleanup / state reset is required; this change adds an example verification atom and does not reopen v0.9 kernel laws.
- [ ] 1.3 Audit `packages/cli` example scripts and `packages/ext-*` / `crates/opentray-ext-*` boundaries for stale public `Space`, `surface`, `Lease`, or daemon-owned assumptions.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given the package-level example matrix is inspected When rows are resolved Then it enumerates finite rows without relying on shell wildcard expansion.
- [ ] 2.2 Scenario: Given the visible binding row is selected on a supported host When preflight runs Then it builds and stages `runtime/opentray_runtime.node` before executing the row.
- [ ] 2.3 Scenario: Given a native extension row is unsupported or CI-only on the current host When the matrix runs Then it reports a typed skip reason instead of a false pass.
- [ ] 2.4 Scenario: Given extension rows run through the source-tree debug runtime When output is reviewed Then the rows are labeled as extension/debug-runtime coverage rather than default runtime coverage.
- [ ] 2.5 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check align-ext-examples-v0-9-matrix --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [ ] 3.2 Add an `opentray` package example-matrix entrypoint that prepares generated runtime artifacts and runs finite smoke rows.
- [ ] 3.3 Add focused tests for matrix row selection, preflight planning, skip semantics, and debug-runtime row labeling.
- [ ] 3.4 Update example documentation so default visible binding coverage and extension/debug-runtime coverage are visibly distinct.
- [ ] 3.5 Keep generated `.node`, dylib, DLL, app, and zip artifacts out of git.
- [ ] 3.6 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [ ] 4.1 Run targeted matrix behavior tests.
- [ ] 4.2 Run the improved `opentray` example matrix command and ensure it passes on the current host.
- [ ] 4.3 Run focused extension facade and native crate gates for touched extension families.
- [ ] 4.4 Run `bun run openspec:vision -- validate align-ext-examples-v0-9-matrix`.
- [ ] 4.5 Run `bun run openspec:vision -- commit-check align-ext-examples-v0-9-matrix --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [ ] 5.2 Generate separate `review/self-review.html` as the structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state align-ext-examples-v0-9-matrix` to persist iteration / recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff align-ext-examples-v0-9-matrix` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive align-ext-examples-v0-9-matrix` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check align-ext-examples-v0-9-matrix` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
