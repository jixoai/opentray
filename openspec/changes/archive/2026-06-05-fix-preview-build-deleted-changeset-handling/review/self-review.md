# Vision-Driven Self Review

## Review State

- Change: `fix-preview-build-deleted-changeset-handling`
- Iteration: 1
- Recurring issue counts:
  - none
- Exit-condition judgment: The deleted-changeset failure mode is closed. Automatic preview planning now filters deleted `.changeset/*.md` paths at the workflow boundary and tolerates `ENOENT` inside the planner, while a live marked changeset still resolves the expected `ext-webview-native / darwin-arm64` plan.
- Next loop action: Archive this change. No additional apply loop is needed.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Deleted changeset lifecycle noise should not break the preview build law. | `.github/workflows/preview-native.yml` now uses `--diff-filter=ACMR`; `scripts/binaries/preview-plan.ts` skips `ENOENT` when a changed changeset path no longer exists. | Pass |
| A live marked changeset must still drive preview planning normally even if another changed path was deleted. | `bun run scripts/binaries/preview-plan.ts --root "$PWD" --changed-json '[".changeset/deleted.md",".changeset/webview-alpha-release-truth.md"]'` returned `enabled: true` with `families: ["ext-webview-native"]` and `targets: ["darwin-arm64"]`. | Pass |
| The robustness fix must be proved in tests rather than left as an incidental code tweak. | `scripts/binaries/preview-plan.test.ts` adds the missing-file tolerance scenario; `scripts/binaries/preview-workflow.test.ts` asserts workflow-side deleted-file filtering. | Pass |
| The fix should stay inside the current build law rather than inventing a new control surface. | No public API or marker shape changed; only workflow/planner tolerance behavior was tightened. | Pass |

## Deviations From Intent

1. None. The work stayed inside the intended robustness scope.

## New Questions For User

1. None. This change does not alter the operator-facing contract.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `bun run scripts/binaries/preview-plan.ts --root "$PWD" --changed-json '[".changeset/deleted.md",".changeset/webview-alpha-release-truth.md"]'`
  - `bun test scripts/binaries/preview-plan.test.ts scripts/binaries/preview-workflow.test.ts`
  - `git diff --check`
  - `bun run openspec:vision -- validate fix-preview-build-deleted-changeset-handling`
- Git commits reviewed:
  - `d4fef9b docs(spec): plan deleted changeset preview handling`
  - `3bfed23 fix(ci): tolerate deleted changesets in preview planning`
- Uncommitted paths, if any:
  - `crates/opentray-ext-lynx/src/lib.rs`
  - `crates/opentray-ext-lynx/src/macos.rs`
- Task checkboxes updated by this working context:
  - `openspec/changes/fix-preview-build-deleted-changeset-handling/tasks.md`

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for command evidence and structured review status.

## Exit Handling

- Normal exit: run `openspec archive <change>` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff <change>`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff <change> <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
