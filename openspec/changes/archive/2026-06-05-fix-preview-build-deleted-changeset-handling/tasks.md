## 1. Alignment / Investigation

- [x] 1.1 Confirm the current preview workflow can receive deleted `.changeset/*.md` paths from a push diff.
- [x] 1.2 Confirm the planner currently hard-fails when a changed changeset path no longer exists in the checkout.
- [x] 1.3 Confirm this is a build-law robustness gap, not a user-facing feature redesign.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a deleted changed changeset plus one live marked changeset When the planner runs Then missing files are ignored and the live marker still resolves the preview plan.
- [x] 2.2 Scenario: Given automatic preview workflow inspection When the collector is read Then deleted changeset paths are filtered before planner execution.

## 3. Implementation

- [x] 3.1 Update the preview workflow changed-file collector to exclude deleted changeset paths from automatic planning input.
- [x] 3.2 Update the preview planner to ignore `ENOENT` for changed changeset paths while still surfacing other read failures.
- [x] 3.3 Add or update tests proving planner tolerance and workflow filtering.
- [x] 3.4 Update only current-context task checkboxes with matching implementation evidence.

## 4. Verification

- [x] 4.1 Run targeted preview planner/workflow tests.
- [x] 4.2 Run `git diff --check`.
- [x] 4.3 Run `bun run openspec:vision -- validate fix-preview-build-deleted-changeset-handling`.
- [x] 4.4 Run `bun run openspec:vision -- check fix-preview-build-deleted-changeset-handling`.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` comparing deleted-file tolerance against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the structured evidence view.
- [x] 5.3 If review exits normally, archive the change and commit the archive result.
