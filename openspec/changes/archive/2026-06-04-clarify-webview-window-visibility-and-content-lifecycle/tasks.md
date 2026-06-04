## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm the intended breaking cleanup: repeated `show(...)` should no longer act as implicit content replacement for an existing WebView session.
- [x] 1.3 Confirm this lifecycle fix belongs in a new WebView session-law change rather than being appended to `enrich-webview-window-macos-capabilities`.

## 2. BDD Contract

- [x] 2.1 Add facade and native-runtime coverage proving `show(...)` reuses a compatible hidden session and preserves page runtime instead of reloading content.
- [x] 2.2 Add coverage proving `show(...)` rejects implicit content replacement when an existing session receives different `html` or `url` content.
- [x] 2.3 Add coverage proving an explicit content-replacement command can replace local HTML content without requiring session destruction.
- [x] 2.4 Add coverage proving `navigate(url)` behaves as the URL-focused alias for explicit content replacement rather than a second hidden session path.
- [x] 2.5 Add coverage proving `destroy()` removes the tray-scoped session and that a later `show(...)` creates a fresh runtime.
- [x] 2.6 Add coverage proving bootstrap-immutable lifecycle fields reject incompatible re-show attempts instead of silently recreating the session.
- [x] 2.7 Add coverage proving mutable shell state such as size, title, icon, or supported live style can update on a reused session without destroying page runtime.
- [x] 2.8 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check clarify-webview-window-visibility-and-content-lifecycle --phase research-plan` before product-code work starts and commit ready OpenSpec artifacts unless the user explicitly continues without the commit checkpoint.
- [x] 3.2 Extend `packages/ext-webview/src/index.ts` with explicit host-side lifecycle verbs for `destroy()` and explicit content replacement while preserving platform-neutral ownership.
- [x] 3.3 Extend `crates/opentray-ext-webview/src/lib.rs` command parsing with explicit destroy and content-replacement commands, plus typed rejection for implicit reload attempts on repeated `show(...)`.
- [x] 3.4 Refactor `crates/opentray-ext-webview/src/macos/mod.rs` session handling so `show(...)` manages visibility/session reuse, `hide()` preserves runtime, `destroy()` tears down runtime, and content replacement is explicit.
- [x] 3.5 Persist the minimum session identity/data needed to compare current content descriptors and bootstrap-immutable settings without confusing them with mutable shell state.
- [x] 3.6 Add concise intent comments at the critical effect points where repeated `show(...)` now preserves runtime and where incompatible re-show is rejected explicitly.
- [x] 3.7 Update `packages/cli/examples/tray-panel.ts`, `packages/ext-webview/README.md`, and any related skills/example text so tray-panel reuse is explained as platform law rather than demo-only workaround.
- [x] 3.8 Update only current-context completed task checkboxes and keep them aligned with matching code / BDD evidence.

## 4. Verification

- [x] 4.1 Run targeted TypeScript tests for the ext-webview facade.
- [x] 4.2 Run targeted Rust tests for `opentray-ext-webview`, including the new lifecycle scenarios.
- [x] 4.3 Run a focused human-visible smoke path proving tray-panel reopen preserves page state until explicit destroy or content replacement.
- [x] 4.4 Run `bun run openspec:vision -- validate clarify-webview-window-visibility-and-content-lifecycle`.
- [x] 4.5 Run `git diff --check`.
- [x] 4.6 Run `bun run openspec:vision -- commit-check clarify-webview-window-visibility-and-content-lifecycle --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the structured visual / interaction evidence record.
- [x] 5.3 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop commit was required before continuing to archive.
- [x] 5.4 Review did not enter a real loop, so no `review-state` file was required.
- [x] 5.5 Review exited normally, so no abnormal handoff was required before returning to user discussion.
- [x] 5.6 If review exits normally, run `openspec archive clarify-webview-window-visibility-and-content-lifecycle` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check clarify-webview-window-visibility-and-content-lifecycle` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
