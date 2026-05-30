## 1. Alignment / Investigation

- [ ] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [ ] 1.2 Confirm any destructive migration / cleanup / state reset assumption with the user when it is not already explicitly approved.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given the intent document defines the operator-visible effect When implementation is reviewed Then the behavior can be traced back to the intent and spec.
- [ ] 2.2 Add boundary-condition scenarios for the risky edges identified in the intent document and spec.
- [ ] 2.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- commit-check <change> --phase apply` before product-code work starts and commit ready OpenSpec artifacts.
- [ ] 3.2 Implement the smallest platform-law change or atom needed by the spec.
- [ ] 3.3 Add concise intent comments at critical effect points derived from `plans/plan.md`.
- [ ] 3.4 Implement any required migration / cleanup / reset helper that the approved breaking update needs.
- [ ] 3.5 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [ ] 4.1 Run targeted behavior tests.
- [ ] 4.2 Run `bun run openspec:vision -- validate <change>` for this change.
- [ ] 4.3 Run `bun run openspec:vision -- commit-check <change> --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [ ] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [ ] 5.4 If the review is entering a real loop, run `bun run openspec:vision -- review-state <change>` to persist iteration / recurrence state.
- [ ] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff <change>` and commit the handoff evidence before returning to user discussion.
- [ ] 5.6 If review exits normally, run `openspec archive <change>` and commit the archive result.
- [ ] 5.7 Run `bun run openspec:vision -- check <change>` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
