## 1. Alignment / Investigation

- [ ] 1.1 Confirm the latest `interview_plan.md` reflects the code survey, existing OpenSpec survey, and Q&A ledger.
- [ ] 1.2 Confirm this is a `vision2` change unless the user explicitly requested a legacy workflow or the existing change already declares one.
- [ ] 1.3 Confirm any destructive migration / cleanup / state reset assumption with the user when it is not already explicitly approved.

## 2. BDD Contract

- [ ] 2.1 Scenario: Given the interview record defines the operator-visible effect When implementation is reviewed Then the behavior can be traced back to the intent and spec.
- [ ] 2.2 Add boundary-condition scenarios for the risky edges identified in the interview record and spec.
- [ ] 2.3 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision2 -- commit-check <change> --phase apply` before app-code work starts and commit ready OpenSpec artifacts.
- [ ] 3.2 Implement the smallest platform-law change or atom needed by the spec.
- [ ] 3.3 When a new problem surfaces during implementation, create a typed issue with `bun run openspec:vision2 -- issues <change> --new <bug|task|decision|risk|question> --title "<title>"` instead of silently editing the plan.
- [ ] 3.4 Add `--group`, `--label`, `--depends-on`, `--blocks`, `--priority`, or `--owner` when the issue's triage or dependency law matters.
- [ ] 3.5 Do not add legacy plan-backup or self-review-loop artifacts to this workflow.
- [ ] 3.6 Update only current-context completed task checkboxes and commit them with the matching implementation / BDD evidence.

## 4. Verification

- [ ] 4.1 Run targeted behavior tests.
- [ ] 4.2 Run `bun run openspec:vision2 -- validate <change>` for this change.
- [ ] 4.3 Run `bun run openspec:vision2 -- issues <change> --validate` and inspect grouped issue state with `bun run openspec:vision2 -- issues <change> --group-by group`.
- [ ] 4.4 Run `bun run openspec:vision2 -- commit-check <change> --phase close` before writing the closing overview.

## 5. Close

- [ ] 5.1 Generate `toc.md` with a preface plus a footnote reference block that cites every spec file (`[^id]: specs/<cap>/spec.md`).
- [ ] 5.2 Close or resolve every active issue under `issues/*.md` (`state: closed` or `state: resolved` with a `## Resolution` section), with dependency references still valid.
- [ ] 5.3 Run `bun run openspec:vision2 -- check <change>` to verify footnote coverage, issue convergence, and artifact presence.
- [ ] 5.4 If `check` reports open issues or orphan specs, iterate; otherwise archive with `openspec archive <change>` and commit the archive result.
