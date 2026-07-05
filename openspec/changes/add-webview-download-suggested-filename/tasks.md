## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration, cleanup, or state reset needs extra user approval because the user explicitly chose `suggestedFilename` and required `filename` to remain unchanged.
- [x] 1.3 Confirm each task checkbox in this file will only be updated by the agent that completed and verified that task in the current working context.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the intent requires source truth and compatibility When the spec is reviewed Then download payloads preserve `filename` and add `suggestedFilename` as a separate field.
- [x] 2.2 Scenario: Given a macOS download deduplicates from `backup.json` to `backup (6).json` When lifecycle events are emitted Then `suggestedFilename` remains `backup.json` while `filename` keeps the existing event value.
- [x] 2.3 Scenario: Given Windows lacks a distinct substrate suggestion When lifecycle events are emitted Then `suggestedFilename` is `null` instead of a fabricated second projection.
- [x] 2.4 Scenario: Given the public contract changes When implementation lands Then OpenSpec, TS types, and README describe the same payload shape.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check add-webview-download-suggested-filename --phase research-plan` before product-code work starts and record the current OpenSpec artifact gate.
- [x] 3.2 Commit the ready OpenSpec artifacts for `add-webview-download-suggested-filename` before product-code work starts. (Honored in the wrap-up pass: OpenSpec artifacts and product code are split into separate commits in the correct order, even though the original round wrote code before the artifacts were committed.)
- [x] 3.3 Extend macOS download metadata so `suggestedFilename` survives dedupe, saveAs, progress, completion, cancel, and failure without changing the existing `filename` field.
- [x] 3.4 Extend Windows download metadata so `suggestedFilename` is sourced from a distinct substrate fact when available and stays `null` when no distinct suggestion exists.
- [x] 3.5 Extend the TypeScript event map and public README so every download lifecycle payload documents `suggestedFilename` alongside the unchanged `filename`.
- [x] 3.6 Add concise intent comments at critical effect points where source truth must not be overwritten by final filename projection.
- [x] 3.7 Update only current-context completed task checkboxes and keep them aligned with matching implementation and verification evidence.

## 4. Verification

- [x] 4.1 Run focused Rust tests that cover the changed macOS helper/event behavior.
- [x] 4.2 Run focused TypeScript tests for the public event map contract.
- [x] 4.3 Run `bun run openspec:vision -- validate add-webview-download-suggested-filename`.
- [x] 4.4 Run `git diff --check` to catch formatting and whitespace regressions.
- [x] 4.5 Run `bun run openspec:vision -- commit-check add-webview-download-suggested-filename --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the structured evidence companion.
- [x] 5.3 If review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop. (N/A: the self-review did not reopen any task or alter the spec; the artifact update here is only the task-checkbox completion record, committed with the artifact batch below.)
- [x] 5.4 If review enters a real loop, run `bun run openspec:vision -- review-state add-webview-download-suggested-filename`. (N/A: the review exited normally on iteration 1 with no recurring issues, so no review-state loop was triggered.)
- [x] 5.5 If review cannot exit normally, run `bun run openspec:vision -- handoff add-webview-download-suggested-filename` and commit the handoff evidence. (N/A: the review exited normally and `bun run openspec:vision -- status` reports all 4 artifacts complete, so no handoff was needed.)
- [x] 5.6 If review exits normally and the user asks to close the change, run `openspec archive add-webview-download-suggested-filename` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-webview-download-suggested-filename` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
