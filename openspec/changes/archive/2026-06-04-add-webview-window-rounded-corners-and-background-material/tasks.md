## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, `window-vibrancy` path, and AppKit/CALayer API survey.
- [x] 1.2 Confirm no destructive migration, cleanup, or persisted state reset is required for borderless, material, or rounded-corner support.
- [x] 1.3 Confirm rounded corners can be projected through the existing AppKit/Wry runtime without introducing Tao.

## 2. BDD Contract

- [x] 2.1 Scenario: Given a page calls `setStyle({ cornerRadius: 18 })` When macOS supports layer clipping Then the native runtime applies the rounded content shell and `getStyle()` reports the numeric radius.
- [x] 2.2 Scenario: Given no `cornerRadius` is supplied When the window is created Then platform default corner behavior is preserved instead of using a hard-coded radius.
- [x] 2.3 Scenario: Given a supported material effect is active When the page leaves transparent content Then native blur/material is visible behind the window.
- [x] 2.4 Scenario: Given `style.frameless`, `transparent`, `backgroundEffect`, and `cornerRadius` are declared on `show(...)` When the window is created Then the extension applies them without daemon-side parsing.
- [x] 2.5 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check add-webview-window-rounded-corners-and-background-material --phase apply` before product-code work starts and commit ready OpenSpec artifacts, unless the user explicitly continues without the commit checkpoint. The user explicitly continued interactive implementation without stopping for the apply-phase checkpoint.
- [x] 3.2 Extend `@opentray/ext-webview` TypeScript style and capability types with `cornerRadius` / corner-radius support.
- [x] 3.3 Extend `crates/opentray-ext-webview` show-command parsing and style payload parsing with nullable numeric `cornerRadius`.
- [x] 3.4 Implement macOS rounded-corner projection on the existing content view using layer-backed clipping.
- [x] 3.5 Ensure material/transparent style projection keeps the WebView and window clear when blur/material is active.
- [x] 3.6 Update the webview control demo with a visible material backdrop and a corner-radius control that makes the effect easy to inspect.
- [x] 3.7 Add concise intent comments at the native material and layer-clipping boundaries.
- [x] 3.8 Update README/example docs so `cornerRadius` and real native material semantics are documented.
- [x] 3.9 Update only current-context completed task checkboxes and commit them with matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.2 Run `cargo test -p opentray-ext-webview`.
- [x] 4.3 Run `bun run openspec:vision -- validate add-webview-window-rounded-corners-and-background-material`.
- [x] 4.4 Run focused grep checks proving `opentray-core` and `opentray-bin` do not contain WebView-specific material or corner-radius command parsing.
- [x] 4.5 Run the manual `pnpm --filter opentray example:webview-control` path for human verification.
- [x] 4.6 Run `git diff --check`.
- [x] 4.7 Run `bun run openspec:vision -- commit-check add-webview-window-rounded-corners-and-background-material --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [x] 5.3 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop commit was required before continuing to archive.
- [x] 5.4 Review did not enter a real loop, so no `review-state` file was required.
- [x] 5.5 Review exited normally, so no abnormal handoff was required before returning to user discussion.
- [x] 5.6 If review exits normally, run `openspec archive add-webview-window-rounded-corners-and-background-material` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-webview-window-rounded-corners-and-background-material` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
