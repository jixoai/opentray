## 1. Alignment / Investigation

- [x] 1.1 Read the 2026-07-16 external composition handoff, current Windows host clear path, existing composition report, source WebView lifecycle, and Window card component.
- [x] 1.2 Confirm this phase adds no public API, no destructive migration, and no replacement for the shell-state clear without later user acceptance.
- [x] 1.3 Record the current evidence boundary: manual clear can visibly churn without clearing residue, while a minimal native resize can clear it.

## 2. BDD Contract

- [x] 2.1 Specify that composition diagnostics remain opt-in and extension-owned, with no `opentray-core` or generic broker branch.
- [x] 2.2 Specify records for operation reason, requested surface contract, HWND state/styles/bounds, and clear elapsed time without falsely claiming visual success.
- [x] 2.3 Specify a Windows-only source example that reuses every first Window card control and compares manual clear with a reversible one-pixel native resize pulse.
- [x] 2.4 Specify that a non-shell candidate remains diagnostic-only until it clears the target pixels without flash, focus, input, session, or visibility regressions.
- [x] 2.5 Only check off a task after its implementation and stated verification complete in this working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check investigate-windows-webview-composition-recovery --phase research-plan` and commit the ready research-plan, specs, and tasks before product-code work.
- [x] 3.2 Add `example:win32-bug` as a Windows-only source WebView example that owns the standard caller-scoped broker, Vite server, retained primary action, and teardown lifecycle.
- [x] 3.3 Add `/win32-bug` by reusing the complete `WindowPanel` control surface and add a focused residue-probe component for manual clear, frameless/background transitions, and a reversible current-bounds one-pixel pulse.
- [x] 3.3a Disable automatic shell recovery only for `example:win32-bug`, preserving manual `clearWhiteBlock` as the uncontaminated comparison baseline.
- [x] 3.4 Add Windows-only `OPENTRAY_WINDOWS_COMPOSITION_DIAGNOSTICS=1` records around requested WebView backing/background policy, style projection, shell clear attempts/skips/completions, and explicit resize completion.
- [x] 3.5 Ensure diagnostic mode is observational: it does not alter controller construction, DWM style selection, shell state, focus, capture, or cleanup scheduling.
- [x] 3.6 Add concise intent comments at the one-pixel pulse and native diagnostic emission boundaries; keep candidate repairs out of this first implementation.
- [x] 3.7 Update `AGENTS.md`, WebView Window Patterns, and the diagnostic README/example guidance so human and AI workflows share the same evidence rules.
- [x] 3.8 Update only completed task checkboxes and commit them with matching implementation and BDD evidence.
- [x] 3.9 Add transparent frameless diagnostic chrome with native app-region drag and an operator-controlled self-drawn control cluster.
- [ ] 3.10 Add guarded Windows-only atomic commands and residue-probe buttons for each active recovery stage, including independent raw host-width grow/shrink operations.

## 4. Verification

- [x] 4.1 Run Rust tests covering diagnostic enablement, snapshot/reason shape, and no-op behavior when diagnostics are disabled.
- [x] 4.2 Run CLI TypeScript tests/typecheck covering the Windows-only example declaration and its source lifecycle.
- [x] 4.3 Build isolated `opentray-bin` and `opentray-ext-webview` artifacts, then smoke `example:win32-bug` with diagnostics enabled.
- [x] 4.4 Run `bun run openspec:vision -- validate investigate-windows-webview-composition-recovery` and `git diff --check`.
- [ ] 4.7 Run Rust and source-host smoke evidence that each diagnostic command is guarded and dispatches through the real HWND/WebView2 host.
- [ ] 4.5 Require human Windows evidence for opaque, Mica, and Acrylic across frameless transition, manual clear, and one-pixel pulse. Record residue, flash, focus/input, timing/count, and result in the change research artifact.
- [ ] 4.6 Do not test `SWP_NOCOPYBITS`, controller reparenting, or composition-root reattachment until the baseline matrix is recorded and the user approves one candidate. The approved atomic decomposition of the existing host geometry pulse is not a new candidate.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` against `plans/plan.md` after the baseline matrix and visual evidence exist.
- [ ] 5.2 Commit any review artifact or reopened-task update before another implementation loop.
- [ ] 5.3 Archive only after the user chooses a candidate direction or explicitly accepts the diagnostic baseline as the next handoff.
- [ ] 5.4 Run `bun run openspec:vision -- check investigate-windows-webview-composition-recovery` only after normal review/archive completion.
