# Vision-Driven Self Review

## Review State

- Change: `plan-changeset-gated-family-builds`
- Iteration: 1
- Recurring issue counts:
  - none
- Exit-condition judgment: The build-law objective is met. A changed WebView changeset carrying `<!-- opentray-preview {"alias":"webview-preview-20260605-1"} -->` now triggers a dedicated preview workflow on push, the planner resolves only `ext-webview-native / darwin-arm64`, and remote run `27006342558` completed successfully without compiling `opentray-ext-lynx` or entering the Lynx runtime sidecar path.
- Next loop action: Archive this change and keep the wider alpha-release work separate.

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Preview builds should start because a changeset file was updated, not because a branch happens to contain changesets. | `.github/workflows/preview-native.yml` auto-triggers on `push.paths: [".changeset/*.md"]`; remote run `27006342558` started immediately after pushing commit `8ff6233`, which changed `.changeset/webview-alpha-release-truth.md`. | Pass |
| The operator should be able to request a fresh preview build by changing a lightweight alias field. | `.changeset/webview-alpha-release-truth.md` now contains `<!-- opentray-preview {"alias":"webview-preview-20260605-1"} -->`; `scripts/binaries/preview-plan.ts` treats the alias marker as the enabling signal and keeps the rest of the plan inferred by law. | Pass |
| `ext-webview` preview builds must not be blocked by Lynx builds. | Local planner proof resolves only `ext-webview-native / darwin-arm64`; remote run `27006342558` named its only build job `Preview build (ext-webview-native / darwin-arm64)` and skipped `Restore Lynx caches`, `Seed Googlesource hosts`, `Save Lynx caches`, and `Upload Lynx build logs`. | Pass |
| Family semantics must live in scripts, not be scattered as workflow-only conditionals. | `scripts/binaries/preview-families.ts`, `preview-plan.ts`, and `build-preview-job.ts` now own family metadata, planning, and execution; `preview-native.yml` delegates to those scripts instead of hard-coding package-specific build branches. | Pass |

## Deviations From Intent

1. Manual `workflow_dispatch` could not be exercised directly from the GitHub API before this new workflow existed on the default branch; `gh workflow run preview-native.yml --ref enrich-webview-window-macos-capabilities ...` returned a 404. This is a GitHub workflow-registration boundary, not a repository planning flaw. The automatic push-trigger proof still covered the critical path.

## New Questions For User

1. None. The build-law scope is now implemented and proven.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `bun test scripts/binaries/*.test.ts`
  - `bun run scripts/binaries/preview-plan.ts --root "$PWD" --changed-json '[".changeset/webview-alpha-release-truth.md"]'`
  - `bun run openspec:vision -- validate plan-changeset-gated-family-builds`
  - `git diff --check`
  - `bun run openspec:vision -- commit-check plan-changeset-gated-family-builds --phase self-review`
  - `gh run list --workflow "Preview native build" --branch enrich-webview-window-macos-capabilities --limit 10 --json databaseId,workflowName,displayTitle,headSha,status,conclusion,event,createdAt,url`
  - `gh run view 27006342558 --json status,conclusion,jobs,url`
- Git commits reviewed:
  - `576e038 docs(spec): plan changeset-gated family builds`
  - `8ff6233 feat(ci): add changeset-gated family preview builds`
- Uncommitted paths, if any:
  - `openspec/changes/plan-changeset-gated-family-builds/review/self-review.md`
  - `openspec/changes/plan-changeset-gated-family-builds/review/self-review.html`
  - `openspec/changes/plan-changeset-gated-family-builds/tasks.md`
- Task checkboxes updated by this working context:
  - `openspec/changes/plan-changeset-gated-family-builds/tasks.md`

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for structured workflow evidence and the final remote-run proof.

## Exit Handling

- Normal exit: run `openspec archive plan-changeset-gated-family-builds` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff plan-changeset-gated-family-builds`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff plan-changeset-gated-family-builds <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
