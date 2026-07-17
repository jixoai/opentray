## 1. Alignment / Investigation

- [x] 1.1 Confirm `plans/plan.md` captures the 2026-07-15 user input, the Windows message-path survey, prior WebView OpenSpec law, and the accepted operational visibility model.
- [x] 1.2 Confirm this is additive API work with no destructive migration or session reset requirement.
- [x] 1.3 Record the renewed user visual report: soft resize is accepted, but frameless still has residual native titlebar pixels.
- [x] 1.4 Record the primary `Show Example` / `Hide Example` requirement and safe frameless post-transition artifact-clear boundary.

## 2. BDD Contract

- [x] 2.1 Add facade tests proving host `isClosed`, `isVisible`, and `toVisible` send the extension commands and expose typed `visibleChange` listeners.
- [x] 2.2 Add bootstrap tests proving page `isClosed`, `isVisible`, `toVisible`, and DOM-style `visibleChange` subscription use the existing authorized bridge path.
- [x] 2.3 Add native unit tests for operational visibility projection, idempotent reveal selection, full-client frameless non-client handling, and soft-resize exclusion from shell-state cleanup.
- [x] 2.4 Add macOS bridge tests proving the page command surface remains shape-aligned with Windows; do not claim macOS visual acceptance from this Windows session.
- [x] 2.5 Only check off a task after its code and its stated verification completed in this working context.
- [x] 2.6 Add a native unit test for the frameless DWM non-client policy selection; retain the existing full-client and no-shell-state tests.
- [x] 2.7 Add native predicate tests for frameless post-transition artifact clear and TypeScript tests for dynamic primary example menus.
- [x] 2.8 Prove primary visibility listeners are attached only after first `show()` and disposed before example runtime shutdown.

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
- [x] 3.10 Apply DWM non-client policy and DWM surface attributes before the final non-shell `SWP_FRAMECHANGED` projection; do not alter the accepted soft-resize lifecycle.
- [x] 3.11 Make every runnable retained-session CLI WebView example use one dynamic `Show Example` / `Hide Example` primary item backed by `isVisible`, `toVisible`, `close`, and `visibleChange`.
- [x] 3.12 Generalize Windows automatic artifact clearing to visible non-maximized frameless windows after style projection and after soft-resize capture release, without clearing during capture.
- [x] 3.13 Update ext-webview README, WebView window-pattern skill guidance, and AGENTS platform laws with the tray-primary and frameless artifact-clear practices.

## 4. Verification

- [x] 4.1 Run `cargo test -p opentray-ext-webview`.
- [x] 4.2 Run `pnpm --filter @opentray/ext-webview test`.
- [x] 4.3 Run the narrow CLI/example tests affected by the facade and documentation changes.
- [ ] 4.4 Run `pnpm --filter opentray example:webview-control -- --frameless --resizable` as the Windows human-visible smoke path, then require renewed user acceptance that initial display, resize, minimize, and restore leave no native titlebar residue.
- [x] 4.5 Run `bun run openspec:vision -- validate fix-windows-frameless-visible-state` and `git diff --check`.
- [ ] 4.6 Run the focused Rust/TypeScript tests and a Windows `--frameless --resizable` source smoke; require renewed visual acceptance for primary labels and post-resize cleanup.
- [ ] 4.7 Run focused native tests for `WM_SIZE` visibility synchronization and queued post-reveal cleanup, then verify a minimized `example:webview-control -- --frameless --resizable` changes to `Show Example` and restores acrylic without a manual resize.

## 5. Consumer Release Follow-up

- [ ] 5.1 After OpenTray is released, update pnpm-pub to use `isVisible()` for Show/Hide menu state, `toVisible()` for Show, and `close()` for Hide.
- [ ] 5.2 Verify pnpm-pub against the published package, publish its compatible release, and record the consumer runtime proof.

## 6. Self-Review Loop

- [ ] 6.1 Generate `review/self-review.md` against `plans/plan.md` after verification and visual acceptance.
- [ ] 6.2 Commit any self-review artifact updates before another implementation loop.
- [ ] 6.3 After user acceptance and release decisions, archive the OpenSpec change in a dedicated archive commit and run `bun run openspec:vision -- check fix-windows-frameless-visible-state`.

## 7. Native Completion Repair

- [x] 7.1 Add one shared Windows operational-visibility tracker used by command emission and `WM_SIZE` completion; ensure a minimized window emits one false transition.
- [x] 7.2 Queue frameless artifact cleanup after `show()` / `toVisible()` and frameless style projection; clear the pending flag before predicate evaluation and skip active soft-resize capture.
- [x] 7.3 Update Windows-facing README, agent skill guidance, and `AGENTS.md` with the native-completion and post-reveal laws.

## 8. Composition Investigation

- [x] 8.1 Write a source-backed report that separates confirmed OpenTray recovery churn, documented WebView2 behavior, and unproven composition hypotheses.
- [ ] 8.2 Add temporary observability for cleanup reason/count/cost and run the terminal-only, trailing-delay, and existing-live-clear A/B matrix on material and opaque cases.
- [ ] 8.3 Decide the next repair policy with user approval before changing the native hosting architecture or removing an accepted residue workaround.
- [x] 8.4 Implement the approved terminal-only native resize recovery: record `WM_SIZE`, queue one recovery after observed `WM_EXITSIZEMOVE`, and remove the 120ms live shell-reset throttle.
- [x] 8.5 Implement one bounded delayed reveal recovery for retained `close() -> toVisible()` sessions. The 100ms HWND timer must be one-shot, cancel on hide, and never run from `WM_SIZE`, `WM_EXITSIZEMOVE`, or active soft-resize capture.
- [ ] 8.6 Add focused native tests and run the Windows material/frameless resize plus retained-show smoke; require user visual acceptance before testing a resize delay or composition host.

## 9. Comparator Frameless Top Edge

- [x] 9.1 Recover the historical `WM_NCCALCSIZE` repair and identify the comparator exclusion that restored the Win11 caption inset.
- [x] 9.2 Add focused tests for default, production full-client, and comparator native-frame client-area projections.
- [x] 9.3 Preserve comparator `WS_THICKFRAME` / native resize ownership while projecting only the top client edge to `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`.
- [x] 9.4 Update the Windows material-host spec, README, agent law, and Chinese terminology with the top-only projection rule.
- [x] 9.5 Build the source broker and extension, then run `example:webview-control -- --frameless --resizable --no-overlay` geometry smoke; the bridge reported `gap=2x2`.
- [ ] 9.6 Require renewed Windows visual acceptance that top/side gaps are 0-4 logical pixels and native edge/corner resize remains continuous.
