# Vision-Driven Self Review

## Review State

- Change:
- Iteration:
- Recurring issue counts:
- Exit-condition judgment:
- Next loop action:

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
|              |          |         |

## Deviations From Intent

1.

## New Questions For User

1.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
- Git commits reviewed:
- Uncommitted paths, if any:
- Task checkboxes updated by this working context:

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for screenshots, interaction evidence, structured tables, and any complex review display that does not belong in the Markdown thinking record.

## Exit Handling

- Normal exit: run `openspec archive <change>` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff <change>`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff <change> <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
