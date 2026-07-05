# Vision-Driven Self Review

## Review State

- Change: `add-webview-download-suggested-filename`
- Iteration: 1
- Recurring issue counts: none
- Exit-condition judgment: current intent is satisfied for the additive contract change; Windows compile proof remains environment-limited rather than design-blocked
- Next loop action: wait for user review or run a Windows-target compile on a machine with a working Windows Rust stdlib/toolchain

## Intent Alignment

| Intent point                                              | Evidence                                                                                                                                                                                        | Verdict |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Keep `filename` unchanged                                 | Native payload builders still emit the existing `filename` field; TS event types keep `filename` as required.                                                                                   | Aligned |
| Add `suggestedFilename` as a separate field               | macOS events now preserve the substrate suggestion; Windows events add `suggestedFilename` sourced from `Content-Disposition` when available; TS types and README document the field.           | Aligned |
| Preserve source truth instead of erasing it during dedupe | macOS stored metadata now keeps the suggestion separate from the final basename; the Windows path uses `null` instead of inventing a fake suggestion when no distinct source fact is available. | Aligned |
| Keep the contract path-free and on the existing event bus | No payload adds filesystem path; event names remain `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled`.                                       | Aligned |

## Deviations From Intent

1. Windows compile proof was not completed on this host because `cargo check --target x86_64-pc-windows-msvc` failed before compiling the crate with `can't find crate for 'core'`, which indicates a local target/toolchain problem rather than a contract mismatch.

## New Questions For User

1. None required for this round. The next useful confirmation would be whether you want this active change archived immediately after a Windows-host verification pass.

## Evidence

- HTML report: `review/self-review.html`
- Screenshot / command / log path:
  - `cargo test -p opentray-ext-webview`
  - `pnpm --filter @opentray/ext-webview test`
  - `pnpm --filter @opentray/ext-webview typecheck`
  - `bun run openspec:vision -- validate add-webview-download-suggested-filename`
  - `git diff --check`
  - `cargo check -p opentray-ext-webview --target x86_64-pc-windows-msvc` -> environment failure before crate compile: missing `core`
- Git commits reviewed:
  - `3855a81 docs(spec): archive add-webview-download`
- Uncommitted paths, if any:
  - `crates/opentray-ext-webview/src/macos/downloads.rs`
  - `crates/opentray-ext-webview/src/macos/tests.rs`
  - `crates/opentray-ext-webview/src/windows/downloads.rs`
  - `packages/ext-webview/README.md`
  - `packages/ext-webview/src/index.test.ts`
  - `packages/ext-webview/src/index.ts`
  - `openspec/changes/add-webview-download-suggested-filename/**`
- Task checkboxes updated by this working context:
  - Yes. Only tasks completed and verified in this context were checked off.

## HTML Review Report

Create `review/self-review.html` as a separate presentation artifact for screenshots, interaction evidence, structured tables, and any complex review display that does not belong in the Markdown thinking record.

## Exit Handling

- Normal exit: run `openspec archive <change>` and commit the archive result.
- Abnormal exit: run `bun run openspec:vision -- handoff <change>`, commit `HANDOFF.md` evidence, then return to user discussion.
- Operator-authored handoff: use `bun run openspec:vision -- handoff <change> <<'END'` with Here Document content when the exact handoff text must be supplied inline.
- Intent realignment: run `bun run openspec:vision -- rename <old-change> <new-change>` when the change id no longer matches the target.
