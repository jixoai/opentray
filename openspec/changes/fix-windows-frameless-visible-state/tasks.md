## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` captures the 2026-07-15 user input, the Windows message-path survey, prior WebView OpenSpec law, and the accepted operational visibility model.
- [x] 1.2 Confirm this is additive API work with no destructive migration or session reset requirement.
- [x] 1.3 Record the renewed user visual report: soft resize is accepted, but frameless still has residual native titlebar pixels.

## 2. BDD Contract

- [x] 2.1 Add facade tests proving host `isClosed`, `isVisible`, and `toVisible` send the extension commands and expose typed `visibleChange` listeners.
- [x] 2.2 Add bootstrap tests proving page `isClosed`, `isVisible`, `toVisible`, and DOM-style `visibleChange` subscription use the existing authorized bridge path.
- [x] 2.3 Add native unit tests for operational visibility projection, idempotent reveal selection, full-client frameless non-client handling, and soft-resize exclusion from shell-state cleanup.
- [x] 2.4 Add macOS bridge tests proving the page command surface remains shape-aligned with Windows; do not claim macOS visual acceptance from this Windows session.
- [x] 2.5 Only check off a task after its code and its stated verification completed in this working context.
- [ ] 2.6 Add a native unit test for the frameless DWM non-client policy selection; retain the existing full-client and no-shell-state tests.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision -- commit-check fix-windows-frameless-visible-state --phase research-plan` and commit the ready OpenSpec artifacts before product-code work.
- [x] 3.2 Add `IsClosed`, `IsVisible`, and `ToVisible` to the extension command model and route them through both native platforms without adding WebView branches to core.
- [x] 3.3 Add cross-platform operational visibility state projection and `visibleChange` emission for close/hide/minimize/show/restore/toVisible transitions.
- [x] 3.4 Extend host/page TypeScript interfaces, bootstrap injection, browser-global types, and event maps with the visibility contract.
- [x] 3.5 Make Windows frameless `WM_NCCALCSIZE` return full client geometry for every message form and retain explicit DWM/no-`WS_THICKFRAME` style projection.
- [x] 3.6 Isolate frameless soft resize from `WindowProcSizeMoveInteraction` white-block shell-state clearing; preserve synchronous bounds and repaint after pointer-driven resize.
- [x] 3.7 Add concise intent comments at the Windows full-client and soft-resize isolation boundaries.
- [x] 3.8 Update `README.md`, WebView extension README, and relevant agent skill/reference guidance with the operational visibility and frameless laws.
- [x] 3.9 Commit current-context task checkboxes with the matching implementation and BDD evidence.
- [ ] 3.10 Apply DWM non-client policy and DWM surface attributes before the final non-shell `SWP_FRAMECHANGED` projection; do not alter the accepted soft-resize lifecycle.

## 4. Verification

- [x] 4.1 Run `cargo test -p opentray-ext-webview`.
- [x] 4.2 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.3 Run the narrow CLI/example tests affected by the facade and documentation changes.
- [ ] 4.4 Run `pnpm --filter opentray example:webview-control -- --frameless --resizable` as the Windows human-visible smoke path, then require renewed user acceptance that initial display, resize, minimize, and restore leave no native titlebar residue.
- [x] 4.5 Run `bun run openspec:vision -- validate fix-windows-frameless-visible-state` and `git diff --check`.

## 5. Consumer Release Follow-up

- [ ] 5.1 After OpenTray is released, update pnpm-pub to use `isVisible()` for Show/Hide menu state, `toVisible()` for Show, and `close()` for Hide.
- [ ] 5.2 Verify pnpm-pub against the published package, publish its compatible release, and record the consumer runtime proof.

## 6. Self-Review Loop

- [ ] 6.1 Generate `review/self-review.md` against `plans/plan.md` after verification and visual acceptance.
- [ ] 6.2 Commit any self-review artifact updates before another implementation loop.
- [ ] 6.3 After user acceptance and release decisions, archive the OpenSpec change in a dedicated archive commit and run `bun run openspec:vision -- check fix-windows-frameless-visible-state`.
