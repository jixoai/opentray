# Vision-Driven Self Review

## Review State

- Change: `plan-selective-release-family-builds`
- Iteration: 1
- Recurring issue counts:
  - none
- Exit-condition judgment: The release build-law objective is met. Preview and release now share one native build graph, the release workflow plans native jobs from pending changesets, and the current WebView-only pending changesets resolve to `daemon + webview` across first-stage targets without any Lynx dylib or Lynx runtime work.
- Next loop action: Archive this change and keep the alpha publish work on top of the new release planner.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| `ext-*` builds should be isolated instead of being dragged by unrelated families. | `scripts/binaries/native-build-graph.ts` models `daemon`, `webview`, `lynx`, and `lynx-runtime` as independent native atoms; `.github/workflows/release.yml` now consumes planner output rather than a hard-coded full family matrix. | Pass |
| WebView-focused work must not be blocked by Lynx builds. | `bun run scripts/binaries/release-plan.ts --root "$PWD"` resolves the current pending changesets to components `["daemon","webview"]` only, with `buildsLynxRuntime: false` for all six release jobs. | Pass |
| Preview and release should not maintain separate build truths. | `scripts/binaries/preview-families.ts` now composes preview families on top of the same `native-build-graph.ts` used by `release-plan.ts` and `build-native-job.ts`. | Pass |
| Release staging and validation should follow selected package atoms only. | `scripts/binaries/stage-release-artifacts.ts`, `validate-package-dirs.ts`, and the updated release workflow stage only the planner-selected package directories. | Pass |

## Deviations From Intent

1. No remote GitHub Actions alpha run was re-executed inside this change. The workflow law, local planner output, and full repo `pnpm run verify` evidence were sufficient to prove the selector behavior, but the next alpha publish should provide the first remote end-to-end proof.

## New Questions For User

1. None. The native build-law scope is implemented and locally verified.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `bun run scripts/binaries/release-plan.ts --root "$PWD"`
  - `bun test scripts/binaries/*.test.ts`
  - `pnpm run verify`
  - `bun run openspec:vision -- validate plan-selective-release-family-builds`
  - `git diff --check`
  - `bun run openspec:vision -- commit-check plan-selective-release-family-builds --phase self-review`
- Git commits reviewed:
  - `896f84d docs(spec): prepare selective release family builds`
  - `f013c42 refactor(ci): derive release native builds from changesets`
- Uncommitted paths, if any:
  - `openspec/changes/plan-selective-release-family-builds/review/self-review.md`
  - `openspec/changes/plan-selective-release-family-builds/review/self-review.html`
- Task checkboxes updated by this working context:
  - `openspec/changes/plan-selective-release-family-builds/tasks.md`

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for structured workflow evidence and the current pending-changeset release plan proof.

## Exit Handling

- Normal exit: run `openspec archive plan-selective-release-family-builds` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff plan-selective-release-family-builds`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff plan-selective-release-family-builds <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
