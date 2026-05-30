## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm any destructive migration / cleanup / state reset assumption with the user when it is not already explicitly approved.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the intent document defines package naming law When package manifests are inspected Then `packages/cli` maps to `opentray` and all other packages map to `@opentray/*`.
- [x] 2.2 Add boundary-condition scenarios for the risky edges identified in the intent document and spec.
- [x] 2.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check <change> --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [x] 3.2 Implement the smallest platform-law change or atom needed by the spec.
- [x] 3.3 Add concise intent comments at critical effect points derived from `plans/plan.md`.
- [x] 3.4 Implement any required migration / cleanup / reset helper that the approved breaking update needs.
- [x] 3.5 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted behavior tests.
- [x] 4.2 Run `bun run openspec:vision -- validate <change>` for this change.
- [x] 4.3 Run `bun run openspec:vision -- commit-check <change> --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [x] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state <change>` to persist iteration / recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff <change>` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive <change>` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check <change>` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
