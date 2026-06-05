## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, and user Q&A.
- [x] 1.2 Confirm breaking redesign is allowed before the first release and record that assumption in the intent document.
- [x] 1.3 Confirm `window.open()` does not need full DOM-level `WindowProxy` emulation for future follow-up work.
- [x] 1.4 Confirm standard web appearance signals are preferred over a custom JS appearance bridge.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the contract split is reviewed When a developer inspects the public API Then common shell traits are separated from `platform.<family>` substrate controls.
- [x] 2.2 Scenario: Given a page or host requests a platform-specific style family on the wrong runtime When the request is validated Then the runtime rejects with typed unsupported instead of silently accepting it.
- [x] 2.3 Scenario: Given trusted host or page code reads tray placement When the result is returned Then the payload carries `kind`, `source`, and `rect` instead of collapsing to `Rect | null`.
- [x] 2.4 Scenario: Given official docs and examples demonstrate window material/corner usage When they show a macOS substrate control Then they use `style.platform.macos.*` rather than the retired flat shape.
- [x] 2.5 Scenario: Given a tray-anchored example reads tray placement When it positions the WebView Then it uses `trayBounds.rect` from the provenance-bearing result.
- [x] 2.6 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check rebuild-webview-cross-platform-window-contract-and-runtime --phase apply` before product-code work starts.
- [x] 3.2 Redesign the `@opentray/ext-webview` host contract so common shell traits and platform-specific substrate families are modeled separately.
- [x] 3.3 Replace the old flat window style/result types in `packages/ext-webview` with the approved common-vs-platform shapes.
- [x] 3.4 Align the Rust parser/internal style model with the public `platform.macos` / `platform.windows` / `platform.linux` family split.
- [x] 3.5 Implement per-family capability metadata on the page bridge and host bridge so common support and platform-specific support are reported separately.
- [x] 3.6 Reject unsupported platform-specific style families truthfully on the current macOS runtime instead of silently swallowing them.
- [x] 3.7 Redesign tray placement result types on both `TrayHandle` and `navigator.opentray.tray` to carry provenance.
- [x] 3.8 Keep tray placement tray-owned and route it by `(spaceId, trayId)` identity through backend and broker layers.
- [x] 3.9 Refresh official docs, skills, and examples so they teach the nested platform-family contract and the provenance-bearing tray result.
- [x] 3.10 Improve the CLI example environment by sharing local WebView runtime discovery/build helpers.
- [x] 3.11 Add a manual walkthrough document for the maintained CLI examples.
- [x] 3.12 Update only current-context completed task checkboxes with matching code and verification evidence.

## 4. Verification

- [x] 4.1 Run targeted unit tests for `packages/ext-webview`, tray placement result typing, parser/session compatibility logic, and CLI SDK surfaces.
- [x] 4.2 Run targeted native/runtime tests for `crates/opentray-ext-webview` and affected backend adapter crates.
- [x] 4.3 Prepare and verify a manual smoke path for `example:webview-control`, `example:tray-panel`, and `example:daemon-tray` in `packages/cli/examples/EXAMPLE.md`.
- [x] 4.4 Run `pnpm --filter opentray typecheck`.
- [x] 4.5 Run `bun run openspec:vision -- validate rebuild-webview-cross-platform-window-contract-and-runtime`.
- [x] 4.6 Run `bun run openspec:vision -- check rebuild-webview-cross-platform-window-contract-and-runtime`.
- [x] 4.7 Run `git diff --check`.

## 5. Self-Review / Archive

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate `review/self-review.html` as the structured evidence presentation.
- [ ] 5.3 If the review updates OpenSpec artifacts, commit those artifact changes before the final archive commit.
- [ ] 5.4 If the review enters a real loop, persist state with `bun run openspec:vision -- review-state rebuild-webview-cross-platform-window-contract-and-runtime`.
- [x] 5.5 Decide that the current change is complete as a coherent atom and record the deferred families explicitly in self-review instead of pretending they landed here.
- [ ] 5.6 Run `openspec archive rebuild-webview-cross-platform-window-contract-and-runtime`.
- [ ] 5.7 Commit the archive result together with the implementation, docs, examples, and review evidence.
