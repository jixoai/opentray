## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, AppKit API survey, and user Q&A.
- [x] 1.2 Confirm no destructive migration, cleanup, or persisted state reset is required for overlay or drag tracking.
- [x] 1.3 Confirm `startAppRegionDrag` / `stopAppRegionDrag` can map to native AppKit event tracking rather than a fake `moveTo` loop.

## 2. BDD Contract

- [x] 2.1 Scenario: Given native window API and overlay are enabled When page code reads `navigator.opentrayWindow.overlay.getTitlebarAreaRect()` Then the returned rect is viewport-relative and suitable for custom titlebar layout.
- [x] 2.2 Scenario: Given overlay geometry changes When the native titlebar safe area changes Then the page can receive a geometry-change event from the overlay object.
- [x] 2.3 Scenario: Given a custom titlebar pointer-down handler calls `startAppRegionDrag()` When the user drags Then the runtime uses native AppKit drag tracking and not repeated `moveTo` calls.
- [x] 2.4 Scenario: Given app-region drag tracking is active When the mouse is released or `stopAppRegionDrag()` is called Then tracking stops and later mouse movement does not move the window.
- [x] 2.5 Scenario: Given the page calls `minimize`, `maximize`, or `restore` When the platform supports the operation Then the request uses the same extension-owned private invoke path as other window controls.
- [x] 2.6 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.
- [x] 2.7 Scenario: Given custom chrome needs button state When the page calls `getWindowState`, `isMaximized`, or `isMinimized` Then the native state is returned through the same extension-owned private invoke path.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check add-webview-window-overlay-controls-and-drag-tracking --phase apply` before product-code work starts and commit ready OpenSpec artifacts, unless the user explicitly continues without the commit checkpoint. The user explicitly continued interactive implementation without stopping for the apply-phase checkpoint.
- [x] 3.2 Extend `@opentray/ext-webview` TypeScript types with overlay options and new window capability metadata.
- [x] 3.3 Extend `crates/opentray-ext-webview` show-command parsing to carry overlay enablement into the runtime.
- [x] 3.4 Extend the injected bootstrap script with `navigator.opentrayWindow.overlay`, `getTitlebarAreaRect`, overlay events, `startAppRegionDrag`, `stopAppRegionDrag`, `minimize`, `maximize`, and `restore`.
- [x] 3.5 Implement macOS overlay geometry using AppKit titlebar/content layout and standard window button geometry.
- [x] 3.6 Implement macOS app-region drag tracking with native event monitoring and automatic cleanup on mouse-up or slot close.
- [x] 3.7 Implement macOS minimize, maximize, and restore request handling.
- [x] 3.8 Update the webview control demo so the first screen has a custom titlebar, safe-title placement, drag region, and custom window control buttons.
- [x] 3.9 Add concise intent comments at the native drag-tracking and overlay-geometry boundaries.
- [x] 3.11 Extend the injected bootstrap script, native bridge, TypeScript facade, and demo with window-state query methods and typed `windowstatechange` payloads.
- [x] 3.10 Update only current-context completed task checkboxes and commit them with matching implementation and BDD evidence.

## 4. Verification

- [x] 4.1 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.2 Run `cargo test -p opentray-ext-webview`.
- [x] 4.3 Run `bun run openspec:vision -- validate add-webview-window-overlay-controls-and-drag-tracking`.
- [x] 4.4 Run focused grep checks proving `opentray-core` and `opentray-bin` do not contain WebView-specific overlay or drag command parsing.
- [x] 4.5 Run the manual `pnpm --filter opentray example:webview-control` path for human verification.
- [x] 4.6 Run `git diff --check`.
- [x] 4.7 Run `bun run openspec:vision -- commit-check add-webview-window-overlay-controls-and-drag-tracking --phase self-review` before writing final review evidence.
- [x] 4.8 Run focused verification for window-state query, typed facade changes, OpenSpec validation, and the webview-control smoke path.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [x] 5.3 Review did not reopen OpenSpec artifacts or tasks, so no extra apply loop commit was required before continuing to archive.
- [x] 5.4 Review did not enter a real loop, so no `review-state` file was required.
- [x] 5.5 Review exited normally, so no abnormal handoff was required before returning to user discussion.
- [x] 5.6 If review exits normally, run `openspec archive add-webview-window-overlay-controls-and-drag-tracking` and commit the archive result.
- [x] 5.7 Run `bun run openspec:vision -- check add-webview-window-overlay-controls-and-drag-tracking` and decide whether to exit or return to `research-plan` with a backed-up plan revision.
